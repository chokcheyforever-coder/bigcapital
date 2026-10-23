import { documentTaxLines } from './taxLines';

describe('documentTaxLines', () => {
  it('groups VAT by rate and excise by code, excise first', () => {
    const plt = { code: 'PLT', name: 'Public Lighting Tax', nameKm: null, kind: 'plt' };
    const lines = documentTaxLines([
      { taxRateId: 1, taxRate: 10, taxAmount: 10.3, tax: { code: 'VAT10', name: 'VAT' }, pltCode: plt, pltRate: 3, pltAmount: 3 },
      { taxRateId: 1, taxRate: 10, taxAmount: 5, tax: { code: 'VAT10', name: 'VAT' } },
      { taxRateId: null, taxAmount: 0 },
    ]);
    expect(lines).toEqual([
      { kind: 'plt', taxRateId: null, code: 'PLT', name: 'Public Lighting Tax', nameKm: null, rate: 3, amount: 3 },
      { kind: 'vat', taxRateId: 1, code: 'VAT10', name: 'VAT', nameKm: null, rate: 10, amount: 15.3 },
    ]);
  });
});
