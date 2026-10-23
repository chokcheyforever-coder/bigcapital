import { BookRow, bookAoa, expenseDoc, itemDoc, worksheet } from './returns';

const row = (extra: Partial<BookRow>): BookRow => ({
  no: 1, date: '2026-11-05', number: 'X', type: 'invoice', id: 1, party: 'taxpayer', partyTin: 'K001-1', partyNameKm: null, partyName: 'A',
  currencyCode: 'USD', khrRate: 4000, nonTaxable: 0, taxable: 0, vat: 0, specificTax: 0, accommodationTax: 0, plt: 0, total: 0,
  taxableKhr: 0, vatKhr: 0, totalKhr: 0, ...extra,
});

/** Monthly return worksheet (DiTech part C3). */
describe('worksheet', () => {
  const sales = [
    row({ taxable: 1000, vat: 100, specificTax: 50, plt: 3, total: 1153, vatKhr: 400000 }),
    row({ nonTaxable: 200, total: 200, vatKhr: 0 }),
  ];
  const purchases = [row({ type: 'bill', taxable: 400, vat: 40, total: 440, vatKhr: 160000 })];
  const wht = [{ code: 'WHT-RENT', name: 'Rent', base: 1000, amount: 100 }];

  it('nets output and input VAT', () => {
    const out = worksheet('2026-11', sales, purchases, wht);
    expect(out.vat).toMatchObject({ taxableSales: 1000, nonTaxableSales: 200, outputVat: 100, inputVat: 40, payable: 60, outputVatKhr: 400000, inputVatKhr: 160000 });
  });

  it('charges the 1% prepayment on turnover excluding VAT and the taxes before VAT', () => {
    expect(worksheet('2026-11', sales, purchases, wht).prepayment).toEqual({ turnover: 1200, rate: 1, amount: 12 });
  });

  it('carries withholding, Specific Tax and PLT, and is due on the 20th of the next month', () => {
    const out = worksheet('2026-12', sales, purchases, wht);
    expect(out.withholding.total).toBe(100);
    expect(out.specificTax).toBe(50);
    expect(out.publicLightingTax).toBe(3);
    expect(out.dueDate).toBe('2027-01-20');
  });

  it('shows a VAT credit when input is larger', () => {
    expect(worksheet('2026-11', [], purchases, []).vat.payable).toBe(-40);
  });

  it('has no riel total when a row has no rate', () => {
    expect(worksheet('2026-11', [row({ vat: 10, vatKhr: null })], [], []).vat.outputVatKhr).toBeNull();
  });
});

describe('bookAoa', () => {
  it('writes the header and one line per document', () => {
    const aoa = bookAoa('sales', [row({ taxable: 10, vat: 1, total: 11 })]);
    expect(aoa[0][0]).toBe('No.');
    expect(aoa).toHaveLength(2);
    expect(aoa[1].slice(0, 5)).toEqual([1, '2026-11-05', 'X', '1 - Taxpayer', 'K001-1']);
  });
});

describe('itemDoc / expenseDoc', () => {
  const entries = [
    { specificTaxAmount: 20, pltAmount: 3, specificTaxCode: { kind: 'specific' } },
    { specificTaxAmount: 4, pltAmount: 0, specificTaxCode: { kind: 'accommodation' } },
  ];

  it('takes VAT, the taxable value after discount and the taxes before VAT from a document', () => {
    const doc = itemDoc(
      { id: 7, currencyCode: 'USD', exchangeRate: 1, khrRate: 4100, subtotal: 200, discountAmount: 10, taxAmountWithheld: 21.7, total: 238.7, entries },
      { type: 'credit_note', date: '2026-11-03', number: 'CN-1', contactId: 5, sign: -1 },
    );
    expect(doc).toMatchObject({ taxable: 190, vat: 21.7, specificTax: 20, accommodationTax: 4, plt: 3, total: 238.7, sign: -1, khrRate: 4100, date: '2026-11-03' });
  });

  it('ignores a stored riel rate when asked to (purchases use the rate of the date)', () => {
    expect(itemDoc({ id: 1, khrRate: 4100, subtotal: 1, total: 1 }, { type: 'bill', date: '2026-11-03', number: 'B', contactId: null, ownRate: false }).khrRate).toBeNull();
  });

  it('reads an expense without VAT as non-taxable, with its payee', () => {
    expect(expenseDoc({ id: 3, totalAmount: 50, payeeId: 9, paymentDate: '2026-11-04', currencyCode: 'USD', exchangeRate: 1 })).toMatchObject({
      number: 'EXP-3', taxable: 50, vat: 0, total: 50, contactId: 9,
    });
  });
});

describe('worksheet with credits', () => {
  it('nets credit notes out of sales and vendor credits out of purchases', () => {
    const sales = [row({ taxable: 1000, vat: 100, total: 1100 }), row({ type: 'credit_note', taxable: -100, vat: -10, total: -110 })];
    const purchases = [row({ type: 'bill', taxable: 400, vat: 40, total: 440 }), row({ type: 'vendor_credit', taxable: -40, vat: -4, total: -44 })];
    const out = worksheet('2026-11', sales, purchases, []);
    expect(out.vat).toMatchObject({ taxableSales: 900, outputVat: 90, inputVat: 36, payable: 54 });
    expect(out.prepayment.turnover).toBe(900);
  });
});
