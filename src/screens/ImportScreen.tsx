import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  NativeModules,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { RootStackParamList } from '../../App';
import {
  getSalaryInfo,
  hasSimilarExpense,
  insertExpenses,
  salaryFor,
  setSalary,
} from '../lib/db';
import { monthKey, monthLabel } from '../lib/months';
import { formatMoney, guessCategory } from '../lib/parse';
import { isSalary, parseStatement, type StatementTxn } from '../lib/statement';
import { categoryStyle, glow, useTheme } from '../lib/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Import'>;

type Picked = { name: string; path: string } | null;
const Importer = NativeModules.StatementImporter as {
  pick(): Promise<Picked>;
  extractText(path: string, password: string | null): Promise<string>;
};

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
      const txns = parseStatement(text);
      if (txns.length === 0) {
        setBusy(null);
        Alert.alert(
          'No transactions found',
          "This statement's layout isn't recognised yet. Try the CSV/Excel export from your bank, or share a sample so the reader can be taught this format.",
        );
        return;
      }
      setBusy('Checking for duplicates…');
      const withFlags: Row[] = [];
      for (const [i, txn] of txns.entries()) {
        const duplicate =
          txn.kind === 'debit' &&
          (await hasSimilarExpense(txn.amount, txn.date));
        withFlags.push({ ...txn, key: String(i), duplicate });
      }
      setRows(withFlags);
      setSelected(
        new Set(
          withFlags
            .filter(r => r.kind === 'debit' && !r.duplicate && inMonth(r))
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

  const toggleShowAll = () => {
    const next = !showAll;
    setShowAll(next);
    const others = rows.filter(
      r => !inMonth(r) && r.kind === 'debit' && !r.duplicate,
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
      const added = await insertExpenses(
        chosen.map(r => ({
          amount: r.amount,
          currency: 'AED',
          merchant: r.merchant,
          card: null,
          category: guessCategory(r.description),
          source: 'statement',
          note: r.description.slice(0, 200),
          created_at: r.date,
        })),
      );
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
              <Text
                style={[styles.meta, styles.creditsNote, { color: t.muted }]}
              >
                {otherCredits.length} other incoming payment(s) (refunds,
                transfers in) are not counted as expenses.
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
          const c = categoryStyle(guessCategory(r.description), t);
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
                  <Text style={{ color: c.color }}>
                    {guessCategory(r.description)}
                  </Text>
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
  meta: { fontSize: 12, marginTop: 3, lineHeight: 17 },
  amount: { fontWeight: '800', fontSize: 15 },
  footer: {
    padding: 16,
    paddingBottom: 34,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  button: { padding: 16, borderRadius: 14, alignItems: 'center' },
  buttonText: { fontWeight: '800', fontSize: 16 },
  dim: { opacity: 0.5 },
});
