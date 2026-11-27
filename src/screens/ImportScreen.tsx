import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Modal,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  SectionList,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { RootStackParamList } from '../../App';
import {
  getSalaryInfo,
  listSimilarExpenses,
  insertExpenses,
  salaryFor,
  setSalary,
} from '../lib/db';
import { monthKey, monthLabel } from '../lib/months';
import {
  categoryResolver,
  type CategoryResolver,
  rememberCategory,
  useCategories,
} from '../lib/categories';
import { addIncome, incomeKind } from '../lib/income';
import { sameShop } from '../lib/merchants';
import { formatMoney, guessCategory, isSpending } from '../lib/parse';
import {
  isSalary,
  parseStatement,
  repairOcrText,
  type StatementTxn,
} from '../lib/statement';
import { categoryStyle, glow, useTheme } from '../lib/theme';
import { useTrackFeature } from '../lib/usage';

type Props = NativeStackScreenProps<RootStackParamList, 'Import'>;

type Picked = { name: string; path: string } | null;
const Importer = NativeModules.StatementImporter as {
  pick(): Promise<Picked>;
  /** Rebuilds table rows from character positions (see StatementImporter.m). */
  extractText(path: string, password: string | null): Promise<string>;
  /** PDFKit's own text order; missing on builds before the layout reader. */
  extractRawText?(path: string, password: string | null): Promise<string>;
  /** Reads the rendered pages with on-device OCR; missing on older builds. */
  extractOcrText?(path: string, password: string | null): Promise<string>;
  pageCount?(path: string, password: string | null): Promise<number>;
  extractOcrPage?(
    path: string,
    password: string | null,
    page: number,
  ): Promise<string>;
};

/** OCR page by page, reporting progress; falls back to all at once on older builds. */
async function readPages(
  path: string,
  password: string | null,
  onPage: (page: number, of: number) => void,
): Promise<string | null> {
  if (Importer.pageCount && Importer.extractOcrPage) {
    const pages = Math.min(await Importer.pageCount(path, password), 60);
    const parts: string[] = [];
    for (let i = 0; i < pages; i++) {
      onPage(i + 1, pages);
      parts.push(await Importer.extractOcrPage(path, password, i));
    }
    return parts.join('\n');
  }
  return Importer.extractOcrText
    ? Importer.extractOcrText(path, password)
    : null;
}

type Row = StatementTxn & { key: string; duplicate: boolean };

function askPassword(message: string): Promise<string | null> {
  return new Promise(resolve =>
    Alert.prompt(
      'Statement password',
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
        { text: 'Open', onPress: (value?: string) => resolve(value ?? '') },
      ],
      'secure-text',
    ),
  );
}

export default function ImportScreen({ navigation, route }: Props) {
  const t = useTheme();
  const track = useTrackFeature();
  // Opened from a month: only that month's transactions are offered by default.
  const month = route.params?.month ?? null;
  const inMonth = (r: { date: number }) =>
    month == null || monthKey(new Date(r.date)) === month;
  const [showAll, setShowAll] = useState(month == null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [useSalary, setUseSalary] = useState(true);
  // Payments in (not salary) are saved as money in.
  const [useIncome, setUseIncome] = useState(true);
  // The text read from a statement that couldn't be parsed, shown to help diagnose it.
  const [readText, setReadText] = useState<string | null>(null);
  // Merchants the user has categorised before keep that category.
  const [resolveCategory, setResolveCategory] = useState<CategoryResolver>(
    () => (_merchant: string, description?: string) =>
      guessCategory(description ?? _merchant),
  );
  useEffect(() => {
    categoryResolver().then(resolve => setResolveCategory(() => resolve));
  }, []);
  // Categories the user changed on a row before importing, by row key.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const categoryList = useCategories();
  const categoryOf = (r: Row) =>
    overrides[r.key] ?? resolveCategory(r.merchant, r.description, r.amount);

  const changeCategory = (r: Row) => {
    const options = categoryList.all;
    const set = (c: string) => setOverrides(prev => ({ ...prev, [r.key]: c }));
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: r.merchant,
          message: 'Category for this payment',
          options: [...options, 'Cancel'],
          cancelButtonIndex: options.length,
        },
        i => options[i] && set(options[i]),
      );
    } else {
      Alert.alert(r.merchant, 'Category for this payment', [
        ...options.map(c => ({ text: c, onPress: () => set(c) })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  };

  const choose = async () => {
    try {
      const picked = await Importer.pick();
      if (!picked) return;
      setBusy('Reading statement…');
      let password: string | null = null;
      let text: string | null = null;
      for (let attempt = 0; text == null; attempt++) {
        try {
          text = await Importer.extractText(picked.path, password);
        } catch (err: any) {
          if (err?.code !== 'PASSWORD') throw err;
          setBusy(null);
          password = await askPassword(
            attempt === 0
              ? 'This PDF is locked. Enter the password your bank gave you (often in the statement email).'
              : 'Wrong password, try again.',
          );
          if (password == null) return;
          setBusy('Reading statement…');
        }
      }
      let txns = parseStatement(text);
      // Some PDFs read better in PDFKit's own order; try that before giving up.
      if (txns.length === 0 && Importer.extractRawText) {
        const raw = await Importer.extractRawText(picked.path, password).catch(
          () => null,
        );
        if (raw) {
          txns = parseStatement(raw);
          if (txns.length === 0)
            text = `${text}\n\n----- PDF order -----\n\n${raw}`;
        }
      }
      // Some banks draw the statement's text as shapes (only a few Arabic lines are real
      // text): read the pages themselves, on the phone.
      if (
        txns.length === 0 &&
        Importer.extractOcrText &&
        /\.pdf$/i.test(picked.name)
      ) {
        setBusy('Reading the pages…');
        const seen = await readPages(picked.path, password, (page, of) =>
          setBusy(
            page === 1
              ? `Reading page 1 of ${of}…\nThe first time takes a little longer.`
              : `Reading page ${page} of ${of}…`,
          ),
        ).catch(() => null);
        if (seen) {
          txns = parseStatement(repairOcrText(seen));
          if (txns.length === 0)
            text = `${text}\n\n----- Read from the pages -----\n\n${seen}`;
        }
      }
      if (txns.length === 0) {
        setBusy(null);
        const readText = text;
        Alert.alert(
          'No transactions found',
          "This statement's layout isn't recognised yet. Try the CSV/Excel export from your bank. You can also see exactly what the app read from the file — a screenshot of it (with amounts hidden if you like) helps teach the reader this format.",
          [
            { text: 'See what was read', onPress: () => setReadText(readText) },
            { text: 'OK', style: 'cancel' },
          ],
        );
        return;
      }
      setBusy('Checking for duplicates…');
      const withFlags: Row[] = [];
      for (const [i, txn] of txns.entries()) {
        // Already logged: same amount within two days, at the same shop (by name).
        const duplicate =
          txn.kind === 'debit' &&
          (await listSimilarExpenses(txn.amount, txn.date)).some(e =>
            sameShop(e.merchant, txn.merchant),
          );
        withFlags.push({ ...txn, key: String(i), duplicate });
      }
      setRows(withFlags);
      // Transfers and cash withdrawals start unticked: they move money, they aren't spending.
      setSelected(
        new Set(
          withFlags
            .filter(
              r =>
                r.kind === 'debit' &&
                !r.duplicate &&
                inMonth(r) &&
                isSpending(
                  resolveCategory(r.merchant, r.description, r.amount),
                ),
            )
            .map(r => r.key),
        ),
      );
      if (month && !withFlags.some(inMonth)) {
        Alert.alert(
          `Nothing from ${monthLabel(month)}`,
          `This statement has ${
            withFlags.length
          } transaction(s), but none in ${monthLabel(
            month,
          )}. They're listed below if you want to import them anyway.`,
        );
        setShowAll(true);
      }
      setFileName(picked.name);
    } catch (err: any) {
      Alert.alert("Couldn't read the statement", err?.message ?? String(err));
    } finally {
      setBusy(null);
    }
  };

  const visible = useMemo(
    () => (showAll ? rows : rows.filter(inMonth)),
    // inMonth only depends on `month`, which is fixed for this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, showAll],
  );
  const hiddenCount = rows.length - visible.length;
  const debits = useMemo(
    () => visible.filter(r => r.kind === 'debit'),
    [visible],
  );
  const salaries = useMemo(() => visible.filter(isSalary), [visible]);
  const otherCredits = useMemo(
    () => visible.filter(r => r.kind === 'credit' && !isSalary(r)),
    [visible],
  );
  const notSpendingCount = visible.filter(
    r => r.kind === 'debit' && !isSpending(categoryOf(r)),
  ).length;

  const toggleShowAll = () => {
    const next = !showAll;
    setShowAll(next);
    const others = rows.filter(
      r =>
        !inMonth(r) &&
        r.kind === 'debit' &&
        !r.duplicate &&
        isSpending(categoryOf(r)),
    );
    setSelected(prev => {
      const s = new Set(prev);
      for (const r of others) {
        if (next) s.add(r.key);
        else s.delete(r.key);
      }
      return s;
    });
  };

  const sections = useMemo(() => {
    const byMonth = new Map<string, Row[]>();
    for (const r of debits) {
      const key = monthKey(new Date(r.date));
      byMonth.set(key, [...(byMonth.get(key) ?? []), r]);
    }
    return [...byMonth.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([month, data]) => ({
        month,
        data: [...data].sort((a, b) => b.date - a.date),
        total: data
          .filter(r => selected.has(r.key))
          .reduce((s, r) => s + r.amount, 0),
      }));
  }, [debits, selected]);

  const chosen = debits.filter(r => selected.has(r.key));
  const chosenTotal = chosen.reduce((s, r) => s + r.amount, 0);

  const toggle = (key: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const doImport = async () => {
    setBusy('Importing…');
    try {
      track('statement_import');
      const added = await insertExpenses(
        chosen.map(r => ({
          amount: r.amount,
          currency: 'AED',
          merchant: r.merchant,
          card: null,
          category: categoryOf(r),
          source: 'statement',
          note: r.description.slice(0, 200),
          created_at: r.date,
        })),
      );
      // Categories changed here are remembered for the merchant next time.
      for (const r of chosen) {
        if (overrides[r.key]) {
          await rememberCategory(r.merchant, overrides[r.key]).catch(() => {});
        }
      }
      let incomeAdded = 0;
      if (useIncome && otherCredits.length) {
        incomeAdded = await addIncome(
          otherCredits.map(r => ({
            amount: r.amount,
            source: r.merchant,
            kind: incomeKind(r.description),
            note: r.description.slice(0, 200),
            created_at: r.date,
          })),
        );
      }
      let salaryMonths = 0;
      if (useSalary && salaries.length) {
        const info = await getSalaryInfo();
        // One salary per month: the biggest salary credit in that month.
        const perMonth = new Map<string, number>();
        for (const s of salaries) {
          const key = monthKey(new Date(s.date));
          perMonth.set(key, Math.max(perMonth.get(key) ?? 0, s.amount));
        }
        for (const [month, amount] of perMonth) {
          if (salaryFor(info, month) == null) {
            await setSalary(month, amount, false);
            salaryMonths++;
          }
        }
      }
      Alert.alert(
        'Statement imported',
        `${added} expense(s) added` +
          (incomeAdded
            ? `, ${incomeAdded} payment(s) in saved as money in`
            : '') +
          (salaryMonths
            ? ` and salary set for ${salaryMonths} month(s).`
            : '.'),
        [{ text: 'Done', onPress: () => navigation.goBack() }],
      );
    } catch (err: any) {
      Alert.alert('Import failed', err?.message ?? String(err));
    } finally {
      setBusy(null);
    }
  };

  if (busy) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <ActivityIndicator color={t.accent} size="large" />
        <Text style={[styles.busy, { color: t.muted }]}>{busy}</Text>
      </View>
    );
  }

  if (!fileName) {
    return (
      <View style={[styles.flex, styles.intro, { backgroundColor: t.bg }]}>
        <Text style={[styles.h1, { color: t.text }]}>
          {month ? `${monthLabel(month)} statement` : 'Import a bank statement'}
        </Text>
        <Text style={[styles.p, { color: t.muted }]}>
          {month
            ? `Choose your bank statement that covers ${monthLabel(
                month,
              )}. Only that month's transactions are imported; anything else in the file is skipped.`
            : 'Fill in past months from your bank statement.'}{' '}
          Download it from your bank's app or statement email (PDF or CSV), save
          it to Files, then choose it here.
        </Text>
        <View
          style={[
            styles.note,
            { borderColor: t.border, backgroundColor: t.card },
          ]}
        >
          <Text style={[styles.noteText, { color: t.muted }]}>
            • Read on your phone only, nothing is uploaded.{'\n'}•
            Password-protected PDFs work, you'll be asked for the password.
            {'\n'}• You'll see every transaction before anything is saved.{'\n'}
            • Payments already logged with Apple Pay are skipped.
          </Text>
        </View>
        <Pressable
          onPress={choose}
          style={[styles.button, { backgroundColor: t.accent }, glow(t.accent)]}
        >
          <Text style={[styles.buttonText, { color: t.onAccent }]}>
            Choose statement file
          </Text>
        </Pressable>

        <Modal
          visible={readText != null}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setReadText(null)}
        >
          <View style={[styles.flex, { backgroundColor: t.bg }]}>
            <View style={[styles.sheetHead, { borderBottomColor: t.border }]}>
              <Text style={[styles.sheetTitle, { color: t.text }]}>
                What the app read
              </Text>
              <Pressable onPress={() => setReadText(null)} hitSlop={10}>
                <Text style={[styles.bold, { color: t.accent }]}>Close</Text>
              </Pressable>
            </View>
            <Text style={[styles.sheetNote, { color: t.muted }]}>
              Only on your phone. Each line should be one transaction with its
              date and amount. If dates, names and amounts are on separate
              lines, or there are no amounts at all, that's why nothing was
              found.
            </Text>
            <ScrollView contentContainerStyle={styles.sheetBody}>
              <Text selectable style={[styles.mono, { color: t.text }]}>
                {(readText ?? '').slice(0, 15000) || '(The file had no text.)'}
              </Text>
            </ScrollView>
            <View style={[styles.sheetFoot, { borderTopColor: t.border }]}>
              <Pressable
                onPress={() =>
                  Share.share({ message: (readText ?? '').slice(0, 15000) })
                }
                style={[styles.button, { backgroundColor: t.accent }]}
              >
                <Text style={[styles.buttonText, { color: t.onAccent }]}>
                  Share this text…
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <SectionList
        sections={sections}
        keyExtractor={r => r.key}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View>
            <Text style={[styles.file, { color: t.muted }]} numberOfLines={1}>
              {fileName}
            </Text>
            <View style={styles.summary}>
              <Summary
                label="Payments"
                value={String(debits.length)}
                color={t.accent}
              />
              <Summary
                label="Months"
                value={String(sections.length)}
                color={t.secondary}
              />
              <Summary
                label="Duplicates"
                value={String(debits.filter(r => r.duplicate).length)}
                color={t.warning}
              />
            </View>

            {salaries.length > 0 && (
              <Pressable
                onPress={() => setUseSalary(v => !v)}
                style={[
                  styles.salary,
                  {
                    backgroundColor: t.card,
                    borderColor: useSalary ? t.success : t.border,
                  },
                ]}
              >
                <Check on={useSalary} color={t.success} />
                <View style={styles.flex}>
                  <Text style={[styles.bold, { color: t.text }]}>
                    Salary found in{' '}
                    {
                      new Set(salaries.map(s => monthKey(new Date(s.date))))
                        .size
                    }{' '}
                    month(s)
                  </Text>
                  <Text style={[styles.meta, { color: t.muted }]}>
                    {salaries
                      .map(
                        s =>
                          `${monthLabel(
                            monthKey(new Date(s.date)),
                          )}: ${formatMoney(s.amount)}`,
                      )
                      .join('\n')}
                    {'\n'}Use as salary for those months (only where none is
                    set).
                  </Text>
                </View>
              </Pressable>
            )}
            {month != null && (hiddenCount > 0 || showAll) && (
              <Pressable
                onPress={toggleShowAll}
                style={[
                  styles.salary,
                  {
                    backgroundColor: t.card,
                    borderColor: showAll ? t.accent : t.border,
                  },
                ]}
              >
                <Check on={showAll} color={t.accent} />
                <View style={styles.flex}>
                  <Text style={[styles.bold, { color: t.text }]}>
                    Also import other months
                  </Text>
                  <Text style={[styles.meta, { color: t.muted }]}>
                    {showAll
                      ? `Showing everything in this file, not just ${monthLabel(
                          month,
                        )}.`
                      : `${hiddenCount} transaction(s) in this file are from other months.`}
                  </Text>
                </View>
              </Pressable>
            )}
            {otherCredits.length > 0 && (
              <Pressable
                onPress={() => setUseIncome(v => !v)}
                style={[
                  styles.salary,
                  {
                    backgroundColor: t.card,
                    borderColor: useIncome ? t.success : t.border,
                  },
                ]}
              >
                <Check on={useIncome} color={t.success} />
                <View style={styles.flex}>
                  <Text style={[styles.bold, { color: t.text }]}>
                    Save {otherCredits.length} payment
                    {otherCredits.length === 1 ? '' : 's'} in as money in
                  </Text>
                  <Text style={[styles.meta, { color: t.muted }]}>
                    {formatMoney(
                      otherCredits.reduce((s, r) => s + r.amount, 0),
                    )}{' '}
                    from transfers and refunds. Shown as money in for the month,
                    never as spending.
                  </Text>
                </View>
              </Pressable>
            )}
            {notSpendingCount > 0 && (
              <Text
                style={[styles.meta, styles.creditsNote, { color: t.muted }]}
              >
                {notSpendingCount} transfer(s) and cash withdrawal(s) are
                unticked: they move money but aren't spending. Tick any that
                were.
              </Text>
            )}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.monthHeader}>
            <Text style={[styles.monthTitle, { color: t.text }]}>
              {monthLabel(section.month)}
            </Text>
            <Text style={[styles.monthTotal, { color: t.accent }]}>
              {formatMoney(section.total)}
            </Text>
          </View>
        )}
        renderItem={({ item: r }) => {
          const on = selected.has(r.key);
          const category = categoryOf(r);
          const c = categoryStyle(category, t);
          return (
            <Pressable
              onPress={() => toggle(r.key)}
              style={[
                styles.row,
                {
                  backgroundColor: t.card,
                  borderColor: t.border,
                  opacity: on ? 1 : 0.55,
                },
              ]}
            >
              <Check on={on} color={t.accent} />
              <View style={styles.flex}>
                <Text
                  style={[styles.bold, { color: t.text }]}
                  numberOfLines={1}
                >
                  {r.merchant}
                </Text>
                <Text
                  style={[styles.meta, { color: t.muted }]}
                  numberOfLines={1}
                >
                  {new Date(r.date).toLocaleDateString('en-AE', {
                    day: 'numeric',
                    month: 'short',
                  })}
                  {' · '}
                  <Text
                    onPress={() => changeCategory(r)}
                    suppressHighlighting={false}
                    style={[styles.categoryLink, { color: c.color }]}
                  >
                    {category} ▾
                  </Text>
                  {isSpending(category) ? '' : ' · not spending'}
                  {r.duplicate ? ' · already logged' : ''}
                </Text>
              </View>
              <Text style={[styles.amount, { color: t.text }]}>
                {formatMoney(r.amount)}
              </Text>
            </Pressable>
          );
        }}
      />
      <View
        style={[
          styles.footer,
          { backgroundColor: t.bg, borderTopColor: t.border },
        ]}
      >
        <Pressable
          onPress={doImport}
          disabled={chosen.length === 0 && !(useSalary && salaries.length)}
          style={[
            styles.button,
            { backgroundColor: t.accent },
            glow(t.accent),
            chosen.length === 0 && styles.dim,
          ]}
        >
          <Text style={[styles.buttonText, { color: t.onAccent }]}>
            Import {chosen.length} expense(s) · {formatMoney(chosenTotal)}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function Check({ on, color }: { on: boolean; color: string }) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.check,
        {
          borderColor: on ? color : t.muted,
          backgroundColor: on ? color : 'transparent',
        },
      ]}
    >
      {on && <Text style={[styles.checkMark, { color: t.onAccent }]}>✓</Text>}
    </View>
  );
}

function Summary({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  const t = useTheme();
  return (
    <View
      style={[styles.sumBox, { borderColor: color, backgroundColor: t.card }]}
    >
      <Text style={[styles.sumLabel, { color: t.muted }]}>{label}</Text>
      <Text style={[styles.sumValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  busy: { fontSize: 15, fontWeight: '600' },
  intro: { padding: 20, gap: 16 },
  h1: { fontSize: 24, fontWeight: '800' },
  p: { fontSize: 15, lineHeight: 22 },
  note: {
    padding: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  noteText: { fontSize: 14, lineHeight: 22 },
  list: { padding: 16, paddingBottom: 120 },
  file: { fontSize: 13, marginBottom: 12 },
  summary: { flexDirection: 'row', gap: 8 },
  sumBox: { flex: 1, borderWidth: 1, borderRadius: 14, padding: 10 },
  sumLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  sumValue: { fontSize: 18, fontWeight: '800', marginTop: 2 },
  salary: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  creditsNote: { marginTop: 10 },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 8,
  },
  monthTitle: { fontSize: 16, fontWeight: '800' },
  monthTotal: { fontSize: 15, fontWeight: '800' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: { fontSize: 14, fontWeight: '900', marginTop: -1 },
  bold: { fontWeight: '700' },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: { fontSize: 17, fontWeight: '800' },
  sheetNote: { fontSize: 13, lineHeight: 18, padding: 16, paddingBottom: 4 },
  sheetBody: { padding: 16 },
  mono: { fontFamily: 'Menlo', fontSize: 11, lineHeight: 15 },
  sheetFoot: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  categoryLink: { fontWeight: '700' },
  meta: { fontSize: 12, marginTop: 3, lineHeight: 17 },
  amount: { fontWeight: '800', fontSize: 15 },
  footer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  button: { padding: 16, borderRadius: 14, alignItems: 'center' },
  buttonText: { fontWeight: '800', fontSize: 16 },
  dim: { opacity: 0.5 },
});
