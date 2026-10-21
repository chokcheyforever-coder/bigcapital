import { DEFAULT_EXCISE_TAX_CODES, exciseAmounts } from '@bigcapital/pdf-templates';
import { ItemEntry } from '@/modules/TransactionItemEntry/models/ItemEntry';

/** Specific Tax and PLT before VAT (shared pdf-templates ExciseTax.ts). */
describe('exciseAmounts', () => {
  it('charges nothing without codes', () => {
    expect(exciseAmounts(100, null)).toEqual({ specificTax: 0, plt: 0, total: 0 });
  });

  it('charges PLT on the amount plus Specific Tax', () => {
    const out = exciseAmounts(100, { specificTaxRate: 35, pltRate: 3 });
    expect(out.specificTax).toBeCloseTo(35);
    expect(out.plt).toBeCloseTo(4.05); // (100 + 35) × 3%
    expect(out.total).toBeCloseTo(39.05);
  });

  it('applies the base percentage (a reseller pays PLT on 20%)', () => {
    expect(exciseAmounts(1000, { pltRate: 3, pltBase: 20 }).plt).toBeCloseTo(6);
    expect(exciseAmounts(1000, { specificTaxRate: 20, specificTaxBase: 90 }).specificTax).toBeCloseTo(180);
  });

  it('reads decimal columns that arrive as strings', () => {
    expect(exciseAmounts(100, { specificTaxRate: '35.0000' as any, specificTaxBase: '100.0000' as any }).specificTax).toBeCloseTo(35);
  });

  it('has a code of each kind to start from', () => {
    expect(new Set(DEFAULT_EXCISE_TAX_CODES.map((c) => c.kind))).toEqual(new Set(['specific', 'accommodation', 'plt']));
  });
});

describe('ItemEntry with Specific Tax and PLT', () => {
  const entry = (extra: Record<string, any>) =>
    ItemEntry.fromJson({ quantity: 2, rate: 50, taxRate: 10, discount: 0, ...extra } as any);

  it('charges VAT on the amount plus the excise taxes', () => {
    const line = entry({ specificTaxRate: 35, pltRate: 3 });
    expect(line.exciseAmount).toBeCloseTo(39.05);
    expect(line.taxAmount).toBeCloseTo(13.905); // (100 + 39.05) × 10%
    expect(line.total).toBeCloseTo(152.955);
    expect(line.totalExcludingTax).toBeCloseTo(100); // income stays the price
  });

  it('is unchanged without codes', () => {
    const line = entry({});
    expect(line.exciseAmount).toBe(0);
    expect(line.taxAmount).toBeCloseTo(10);
    expect(line.total).toBeCloseTo(110);
  });
});
