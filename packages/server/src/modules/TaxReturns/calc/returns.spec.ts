import { BookRow, bookAoa, worksheet } from './returns';

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
