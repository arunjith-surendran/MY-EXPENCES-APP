/**
 * Turns the text of a bank statement (PDF text or CSV) into transactions.
 *
 * Statements differ per bank, so this is heuristic:
 *  - a transaction starts on a line that begins with a date; following lines without a
 *    date continue its description (wrapped narration);
 *  - money values look like 1,234.56; when a running balance is present (last number on the
 *    line), the change in balance tells us whether the row was money out or money in;
 *  - otherwise CR/DR markers and words like "salary" or "refund" decide.
 * The import screen always shows a preview, so a wrong guess can be unticked.
 */

export type StatementTxn = {
  date: number; // unix ms, local noon
  description: string; // raw narration
  merchant: string; // cleaned, for display
  amount: number; // always positive
  kind: 'debit' | 'credit';
};

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/** Arabic month names as UAE banks print them, including spellings without hamza. */
const AR_MONTHS: Record<string, number> = {
  يناير: 0,
  فبراير: 1,
  مارس: 2,
  أبريل: 3,
  ابريل: 3,
  إبريل: 3,
  مايو: 4,
  يونيو: 5,
  يوليو: 6,
  أغسطس: 7,
  اغسطس: 7,
  سبتمبر: 8,
  أكتوبر: 9,
  اكتوبر: 9,
  نوفمبر: 10,
  ديسمبر: 11,
};

const DATE_PATTERNS: {
  re: RegExp;
  parse: (m: RegExpMatchArray) => Date | null;
}[] = [
  // 2026-10-05
  {
    re: /\b(\d{4})-(\d{2})-(\d{2})\b/,
    parse: m => mk(+m[1], +m[2] - 1, +m[3]),
  },
  // 05/10/2026, 05-10-2026, 05.10.26 (UAE banks use day first)
  {
    re: /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/,
    parse: m => mk(year(m[3]), +m[2] - 1, +m[1]),
  },
  // 05 Oct 2026, 05-Oct-26, 5 October 2026
  {
    re: /\b(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-,]*(\d{4}|\d{2})\b/,
    parse: m => {
      const mon =
        MONTHS[
          m[2]
            .slice(0, m[2].toLowerCase().startsWith('sept') ? 4 : 3)
            .toLowerCase()
        ];
      return mon == null ? null : mk(year(m[3]), mon, +m[1]);
    },
  },
  // Oct 05, 2026
  {
    re: /\b([A-Za-z]{3,9})\s(\d{1,2}),?\s(\d{4})\b/,
    parse: m => {
      const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
      return mon == null ? null : mk(+m[3], mon, +m[2]);
    },
  },
  // 03 نوفمبر 2026 (Arabic month names)
  {
    re: new RegExp(`(\\d{1,2})[\\s-](${Object.keys(AR_MONTHS).join('|')})[\\s-،,]*(\\d{4}|\\d{2})`),
    parse: m => mk(year(m[3]), AR_MONTHS[m[2]], +m[1]),
  },
  // 05OCT26, 05OCT2026
  {
    re: /\b(\d{2})([A-Za-z]{3})(\d{4}|\d{2})\b/,
    parse: m => {
      const mon = MONTHS[m[2].toLowerCase()];
      return mon == null ? null : mk(year(m[3]), mon, +m[1]);
    },
  },
];

/**
 * Card statements often leave the year out ("05 Oct", "05/10"). These are only tried at
 * the start of a line, with the year taken from the statement (see yearHint).
 */
const YEARLESS_PATTERNS: {
  re: RegExp;
  parse: (m: RegExpMatchArray, y: number) => Date | null;
}[] = [
  // 05 Oct, 05-OCT, 5 October
  {
    re: /^(?:\d{1,3}\s+)?(\d{1,2})[\s-]([A-Za-z]{3,9})\b/,
    parse: (m, y) => {
      const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
      return mon == null ? null : mk(y, mon, +m[1]);
    },
  },
  // Oct 05
  {
    re: /^(?:\d{1,3}\s+)?([A-Za-z]{3,9})\s(\d{1,2})\b/,
    parse: (m, y) => {
      const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
      return mon == null ? null : mk(y, mon, +m[2]);
    },
  },
  // 05/10 (day first, as UAE banks print it)
  {
    re: /^(?:\d{1,3}\s+)?(\d{1,2})\/(\d{1,2})(?![/\d])/,
    parse: (m, y) => mk(y, +m[2] - 1, +m[1]),
  },
];

/** The statement's year: the most common 20xx year in it, else this year. */
export function yearHint(text: string, now = new Date()): number {
  const counts = new Map<number, number>();
  for (const m of text.matchAll(/\b(20\d{2})\b/g)) {
    const y = Number(m[1]);
    if (y <= now.getFullYear() + 1) counts.set(y, (counts.get(y) ?? 0) + 1);
  }
  let best = now.getFullYear();
  let most = 0;
  for (const [y, n] of counts) {
    if (n > most) {
      best = y;
      most = n;
    }
  }
  return best;
}

/** A date at the start of a line without a year; December lines in a January statement go back a year. */
function findYearlessDate(
  line: string,
  hint: number,
  now = new Date(),
): { date: Date; index: number; length: number } | null {
  for (const p of YEARLESS_PATTERNS) {
    const m = line.match(p.re);
    if (!m) continue;
    let date = p.parse(m, hint);
    if (date && date.getTime() > now.getTime() + 2 * 86_400_000) {
      date = p.parse(m, hint - 1);
    }
    if (date) return { date, index: 0, length: m[0].length };
  }
  return null;
}

function year(s: string) {
  const n = Number(s);
  return s.length === 2 ? 2000 + n : n;
}

function mk(y: number, m: number, d: number): Date | null {
  if (m < 0 || m > 11 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const date = new Date(y, m, d, 12);
  return date.getMonth() === m ? date : null;
}

/** Finds the first date in `s` and where it is. */
export function findDate(
  s: string,
): { date: Date; index: number; length: number } | null {
  let best: { date: Date; index: number; length: number } | null = null;
  for (const p of DATE_PATTERNS) {
    const m = s.match(p.re);
    if (!m || m.index == null) continue;
    const date = p.parse(m);
    if (date && (!best || m.index < best.index)) {
      best = { date, index: m.index, length: m[0].length };
    }
  }
  return best;
}

const MONEY =
  /(?<![\d.,])(-?\d{1,3}(?:,\d{3})*(?:\.\d{2})|-?\d+\.\d{2})(?![\d])(\s?(?:CR|DR|Cr|Dr)\b)?/g;

type Money = { value: number; marker: 'CR' | 'DR' | null };

function moneyIn(s: string): Money[] {
  const out: Money[] = [];
  for (const m of s.matchAll(MONEY)) {
    const value = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    const marker = m[2] ? (m[2].trim().toUpperCase() as 'CR' | 'DR') : null;
    out.push({ value, marker });
  }
  return out;
}

// Arabic words have no \b word boundaries in JS regexes, so they're matched as plain text.
const CREDIT_WORDS =
  /\b(salary|payroll|wps|credited|refund|reversal|cash ?back|deposit|inward|transfer from|received|interest paid)\b|راتب|رواتب|إيداع|ايداع|تحويل وارد|حوالة واردة|استرداد|مسترد|فائدة مدفوعة/i;
const SKIP_ROWS =
  /\b(opening|closing|available|ledger)\s+balance\b|brought forward|carried forward|balance b\/f|balance c\/f|^total\b|statement (period|date)|الرصيد الافتتاحي|رصيد افتتاحي|الرصيد الختامي|رصيد ختامي|الرصيد المتاح|رصيد مرحل|الرصيد المرحل|^المجموع|^الإجمالي/i;
/** "Opening balance" in English or Arabic: its amount is where running balances start. */
const OPENING =
  /opening balance|balance brought forward|balance b\/f|الرصيد الافتتاحي|رصيد افتتاحي|رصيد مرحل|الرصيد المرحل/i;
// A line made only of column headings, e.g. "Debit Credit Balance".
const HEADER_ONLY =
  /^(?:(?:date|value date|posting date|description|narration|details|particulars|debit|credit|withdrawals?|deposits?|balance|amount|aed|ref(?:erence)?|cheque no\.?|التاريخ|تاريخ القيمة|تاريخ العملية|الوصف|التفاصيل|البيان|مدين|دائن|الرصيد|المبلغ|المرجع|سحب|إيداع|درهم)\s*)+$/i;
const SALARY = /\b(salary|payroll|wps|sal\b)|راتب|رواتب/i;

/** Arabic-Indic digits and separators ("١٬٢٣٤٫٥٠") to "1,234.50". */
export function westernDigits(text: string): string {
  return text
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u066B/g, '.')
    .replace(/\u066C/g, ',');
}

export function isSalary(t: StatementTxn) {
  return t.kind === 'credit' && SALARY.test(t.description);
}

/** Tidies a narration into a short merchant-like name. */
export function cleanMerchant(desc: string): string {
  let s = desc
    .replace(/\b\d{4,6}[X*]{2,}\d{2,4}\b/gi, ' ') // masked card numbers
    .replace(/[X*]{4,}\d{4}/gi, ' ')
    .replace(/\b\d{2}:\d{2}(:\d{2})?\b/g, ' ') // times
    .replace(/\b(AED|USD|EUR|GBP|INR)\s?-?\d[\d,]*(\.\d+)?/gi, ' ') // amounts with currency
    .replace(/-?\d{1,3}(,\d{3})*\.\d{2}/g, ' ') // stray amounts
    .replace(
      /\b(POS|PURCHASE|PURCHASES|DEBIT CARD|CREDIT CARD|CARD NO\.?|CARD|APPLE PAY|E-?COM(MERCE)?|ATM|TXN|TRANSACTION|REF(ERENCE)?( NO\.?)?|VALUE DATE|AUTH(ORI[SZ]ATION)?( CODE)?)\b[:#]?/gi,
      ' ',
    )
    .replace(/\b\d{6,}\b/g, ' ') // long references
    .replace(/[|]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  for (const p of DATE_PATTERNS) s = s.replace(p.re, ' ').trim();
  s = s.replace(/^[\s:,.\-/]+|[\s:,.\-/]+$/g, '').replace(/\s{2,}/g, ' ');
  if (!s) return 'Bank transaction';
  // Banks print narrations in capitals; make them readable.
  if (s === s.toUpperCase()) {
    s = s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
  }
  return s.length > 40 ? `${s.slice(0, 39).trim()}…` : s;
}

type Row = { date: Date; text: string };

function textRows(text: string): { rows: Row[]; opening: number | null } {
  const hint = yearHint(text);
  const rows: Row[] = [];
  let opening: number | null = null;
  let current: Row | null = null;
  let continuation = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (OPENING.test(line)) {
      const nums = moneyIn(line);
      if (nums.length && opening == null) opening = nums[nums.length - 1].value;
    }
    const found = findDate(line) ?? findYearlessDate(line, hint);
    // A transaction line starts with its date (allow a short serial number before it).
    if (found && found.index <= 6) {
      current = { date: found.date, text: line };
      rows.push(current);
      continuation = 0;
    } else if (current && continuation < 2 && !HEADER_ONLY.test(line)) {
      if (!SKIP_ROWS.test(line)) {
        current.text += ` ${line}`;
        continuation++;
      } else {
        // e.g. "19,163.50 Closing Balance 19,163.50": keep the row's own balance in front.
        const lead = line.match(/^-?\d{1,3}(?:,\d{3})*\.\d{2}/);
        if (lead) current.text += ` ${lead[0]}`;
        current = null;
      }
    }
  }
  return { rows, opening };
}

function fromTextRows(rows: Row[], opening: number | null): StatementTxn[] {
  // Process in date order; many statements list newest first.
  if (
    rows.length > 1 &&
    rows[0].date.getTime() > rows[rows.length - 1].date.getTime()
  ) {
    rows = [...rows].reverse();
  }
  const out: StatementTxn[] = [];
  let prevBalance = opening;
  for (const row of rows) {
    if (SKIP_ROWS.test(row.text)) {
      const nums = moneyIn(row.text);
      if (nums.length) prevBalance = nums[nums.length - 1].value;
      continue;
    }
    const nums = moneyIn(row.text);
    if (nums.length === 0) continue;

    let amount: Money;
    let kind: 'debit' | 'credit' | null = null;
    if (nums.length >= 2) {
      const balance = nums[nums.length - 1].value;
      const candidates = nums.slice(0, -1);
      amount = candidates[0];
      if (prevBalance != null) {
        const delta = Math.round((balance - prevBalance) * 100) / 100;
        const match = candidates.find(
          c => Math.abs(Math.abs(c.value) - Math.abs(delta)) < 0.011,
        );
        if (match && delta !== 0) {
          amount = match;
          kind = delta > 0 ? 'credit' : 'debit';
        }
      }
      prevBalance = balance;
    } else {
      amount = nums[0];
    }
    if (!kind) {
      if (amount.marker) kind = amount.marker === 'CR' ? 'credit' : 'debit';
      else if (amount.value < 0) kind = 'debit';
      else kind = CREDIT_WORDS.test(row.text) ? 'credit' : 'debit';
    }
    const value = Math.abs(amount.value);
    if (value === 0) continue;
    out.push({
      date: row.date.getTime(),
      description: row.text,
      merchant: cleanMerchant(row.text),
      amount: value,
      kind,
    });
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';' || c === '\t') {
      cells.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function num(s: string | undefined): number | null {
  if (!s) return null;
  const v = s.trim();
  // Only cells that are just a money value, e.g. "1,234.50", "-34.00", "(12.00)", "AED 5.00".
  if (!/^\(?-?(?:[A-Z]{3}\s?)?-?[\d,]+(?:\.\d+)?\)?$/i.test(v)) return null;
  const neg = /^\(.*\)$/.test(v) || v.includes('-');
  const n = Number(v.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n === 0) return null;
  return neg ? -n : n;
}

function fromCsv(text: string): StatementTxn[] | null {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  // A real CSV header has several delimited cells, one of them a date column.
  const headerAt = lines.findIndex(l => {
    const cells = splitCsvLine(l.toLowerCase());
    return (
      cells.length >= 3 &&
      cells.some(c => /date/.test(c)) &&
      cells.some(c => /(debit|withdraw|amount|credit)/.test(c))
    );
  });
  if (headerAt < 0) return null;
  const header = splitCsvLine(lines[headerAt]).map(h => h.toLowerCase());
  const col = (re: RegExp, not?: RegExp) =>
    header.findIndex(h => re.test(h) && !(not && not.test(h)));
  const dateCol =
    col(/transaction date|txn date|posting date|^date/) >= 0
      ? col(/transaction date|txn date|posting date|^date/)
      : col(/date/);
  const descCol = col(
    /desc|narration|details|particulars|merchant|remarks|reference/,
  );
  const debitCol = col(/debit|withdraw|money out|paid out/);
  const creditCol = col(/credit|deposit|money in|paid in/, /card/);
  const amountCol = col(/amount/, /debit|credit|balance/);
  if (dateCol < 0 || (debitCol < 0 && amountCol < 0)) return null;

  const out: StatementTxn[] = [];
  for (const line of lines.slice(headerAt + 1)) {
    const cells = splitCsvLine(line);
    const found = findDate(cells[dateCol] ?? '');
    if (!found) continue;
    const desc =
      descCol >= 0
        ? cells[descCol] ?? ''
        : cells.filter((_, i) => i !== dateCol).join(' ');
    if (SKIP_ROWS.test(desc)) continue;
    const debit = debitCol >= 0 ? num(cells[debitCol]) : null;
    const credit = creditCol >= 0 ? num(cells[creditCol]) : null;
    let amount: number;
    let kind: 'debit' | 'credit';
    if (debit) {
      amount = Math.abs(debit);
      kind = 'debit';
    } else if (credit) {
      amount = Math.abs(credit);
      kind = 'credit';
    } else {
      const a = num(cells[amountCol]);
      if (!a) continue;
      amount = Math.abs(a);
      kind = a < 0 ? 'debit' : CREDIT_WORDS.test(desc) ? 'credit' : 'debit';
    }
    out.push({
      date: found.date.getTime(),
      description: desc,
      merchant: cleanMerchant(desc),
      amount,
      kind,
    });
  }
  return out;
}

export function parseStatement(raw: string): StatementTxn[] {
  const text = westernDigits(raw);
  const csv = fromCsv(text);
  if (csv && csv.length) return csv;
  const { rows, opening } = textRows(text);
  return fromTextRows(rows, opening);
}
