import { cleanMerchant, isSalary, parseStatement } from '../src/lib/statement';

const day = (t: { date: number }) => new Date(t.date).getDate();

describe('parseStatement – PDF text', () => {
  it('uses the running balance to tell money out from money in', () => {
    const text = `
      Account Statement
      Date Description Debit Credit Balance
      Opening Balance 10,000.00
      01/10/2026 POS PURCHASE CARREFOUR MOE 4567XXXXXXXX1234 142.50 9,857.50
      02/10/2026 SALARY OCT 2026 ACME LLC 15,000.00 24,857.50
      03/10/2026 ENOC 1023 DUBAI 90.00 24,767.50
      Closing Balance 24,767.50
    `;
    const txns = parseStatement(text);
    expect(txns.map(t => [day(t), t.amount, t.kind])).toEqual([
      [1, 142.5, 'debit'],
      [2, 15000, 'credit'],
      [3, 90, 'debit'],
    ]);
    expect(isSalary(txns[1])).toBe(true);
    expect(txns[0].merchant).toBe('Carrefour Moe');
  });

  it('handles newest-first statements with month names', () => {
    const text = `
      05 Oct 2026 TALABAT DUBAI 58.00 1,942.00
      04 Oct 2026 REFUND AMAZON 100.00 2,000.00
      03 Oct 2026 NOON.COM 210.00 1,900.00
    `;
    const txns = parseStatement(text);
    expect(txns.map(t => [day(t), t.amount, t.kind])).toEqual([
      [3, 210, 'debit'],
      [4, 100, 'credit'],
      [5, 58, 'debit'],
    ]);
  });

  it('joins wrapped narration lines and reads CR/DR markers', () => {
    const text = `
      12-Oct-26 PURCHASE APPLE.COM/BILL
      CORK IE 4.99 DR
      13-Oct-26 CASHBACK REWARD 25.00 CR
    `;
    const txns = parseStatement(text);
    expect(txns).toHaveLength(2);
    expect(txns[0]).toMatchObject({ amount: 4.99, kind: 'debit' });
    expect(txns[0].description).toContain('CORK IE');
    expect(txns[1]).toMatchObject({ amount: 25, kind: 'credit' });
  });
});

describe('parseStatement – PDFKit layout', () => {
  // Real PDFKit output: balance wraps onto its own line, column headings trail at the end.
  it('joins wrapped balances and ignores trailing column headings', () => {
    const text = [
      'Statement period: 01/10/2026 to 31/10/2026 Date Description Opening Balance 5,000.00',
      '01/10/2026 POS PURCHASE CARREFOUR MOE 4567XXXXXXXX1234 142.50',
      '4,857.50',
      '02/10/2026 SALARY OCT 2026 ACME LLC 15,000.00',
      '19,857.50',
      '21/10/2026 AMAZON.AE REFUND 49.00',
      '19,906.50',
      '28/10/2026 NOON.COM ONLINE PURCHASE 210.00',
      '19,696.50 Closing Balance 19,696.50',
      'Debit Credit Balance',
    ].join('\n');
    expect(parseStatement(text).map(t => [t.amount, t.kind])).toEqual([
      [142.5, 'debit'],
      [15000, 'credit'],
      [49, 'credit'],
      [210, 'debit'],
    ]);
  });
});

describe('parseStatement – CSV', () => {
  it('reads separate debit and credit columns', () => {
    const csv = [
      'Transaction Date,Description,Debit,Credit,Balance',
      '01/11/2026,"LULU HYPERMARKET, AL BARSHA",86.25,,4913.75',
      '02/11/2026,SALARY NOV,,12000.00,16913.75',
    ].join('\n');
    const txns = parseStatement(csv);
    expect(txns.map(t => [t.amount, t.kind])).toEqual([
      [86.25, 'debit'],
      [12000, 'credit'],
    ]);
    expect(txns[0].merchant).toBe('Lulu Hypermarket, Al Barsha');
  });

  it('reads a signed amount column', () => {
    const csv = [
      'Date,Details,Amount',
      '2026-11-03,Careem ride,-34.00',
      '2026-11-04,Refund,12.00',
    ].join('\n');
    const txns = parseStatement(csv);
    expect(txns.map(t => [t.amount, t.kind])).toEqual([
      [34, 'debit'],
      [12, 'credit'],
    ]);
  });
});

describe('cleanMerchant', () => {
  it('drops card numbers, references and amounts', () => {
    expect(
      cleanMerchant(
        'POS 4567XXXXXXXX1234 STARBUCKS DUBAI MALL 12:41 AED 21.00 REF 99887766',
      ),
    ).toBe('Starbucks Dubai Mall');
  });
});

describe('more statement layouts', () => {
  it('reads table rows rebuilt from the PDF layout', () => {
    const text = [
      'Date   Description   Debit   Credit   Balance',
      'Opening Balance   5,000.00',
      '03/11/2026   CARREFOUR MOE DUBAI   245.50      4,754.50',
      '04/11/2026   SALARY NOV         12,000.00   16,754.50',
      '05/11/2026   ENOC 1023 DUBAI   80.00      16,674.50',
    ].join('\n');
    const txns = parseStatement(text);
    expect(txns.map(x => [x.amount, x.kind])).toEqual([
      [245.5, 'debit'],
      [12000, 'credit'],
      [80, 'debit'],
    ]);
  });

  it('reads compact dates like 05NOV26', () => {
    const txns = parseStatement(
      '05NOV26 TALABAT DUBAI 54.00\n06NOV26 NOON.COM 120.00',
    );
    expect(txns).toHaveLength(2);
    expect(new Date(txns[0].date).getMonth()).toBe(10);
  });

  it('reads card statements without a year, using the statement year', () => {
    const text = [
      'Statement period 01/10/2025 - 31/10/2025',
      '05 Oct   STARBUCKS MALL OF EMIRATES   32.00',
      '17 Oct   ADNOC 554   150.25',
    ].join('\n');
    const txns = parseStatement(text);
    expect(txns.map(x => x.amount)).toEqual([32, 150.25]);
    expect(new Date(txns[0].date).getFullYear()).toBe(2025);
  });
});

describe('Arabic statements', () => {
  // What the layout reader (ios/Expences/StatementLayout.h) produced from a generated
  // right-to-left Arabic statement PDF: rows in reading order, date first.
  const arabic = [
    'تفاصيل كشف الحساب',
    'الفترة من 01/11/2026 إلى 30/11/2026',
    'التاريخ   الوصف   مدين   دائن   الرصيد',
    'الرصيد الافتتاحي   5,000.00',
    '03/11/2026   شراء كارفور دبي   245.50   4,754.50',
    '04/11/2026   راتب شهر نوفمبر   12,000.00   16,754.50',
    '05/11/2026   ENOC 1023 DUBAI   80.00   16,674.50',
  ].join('\n');

  it('reads the rows, money out and in, from the running balance', () => {
    const txns = parseStatement(arabic);
    expect(txns.map(x => [day(x), x.amount, x.kind])).toEqual([
      [3, 245.5, 'debit'],
      [4, 12000, 'credit'],
      [5, 80, 'debit'],
    ]);
    expect(isSalary(txns[1])).toBe(true);
    expect(txns[0].merchant).toBe('شراء كارفور دبي');
  });

  it('reads Arabic-Indic digits', () => {
    const txns = parseStatement(
      'الرصيد الافتتاحي ١٬٠٠٠٫٠٠\n٠٣/١١/٢٠٢٦   مطعم   ٤٥٫٥٠   ٩٥٤٫٥٠',
    );
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ amount: 45.5, kind: 'debit' });
  });
});

describe('Arabic month names', () => {
  it('reads "03 نوفمبر 2026"', () => {
    const txns = parseStatement('03 نوفمبر 2026   مطعم البيك   38.00');
    expect(txns).toHaveLength(1);
    expect(new Date(txns[0].date).getMonth()).toBe(10);
  });
});
