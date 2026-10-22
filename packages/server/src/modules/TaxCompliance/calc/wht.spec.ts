import { DEFAULT_WHT_CODES, whtAmount } from './wht';

/** Withholding tax (DiTech part C2). */
describe('whtAmount', () => {
  it('is the base times the rate, to the cent', () => {
    expect(whtAmount(1000, 10)).toBe(100);
    expect(whtAmount(333.33, 15)).toBe(50);
    expect(whtAmount(200, '15.0000' as any)).toBe(30);
  });

  it('is zero without a rate', () => {
    expect(whtAmount(1000, null)).toBe(0);
    expect(whtAmount(1000, 0)).toBe(0);
  });

  it('starts with the payment types of the Law on Taxation', () => {
    expect(DEFAULT_WHT_CODES.map((c) => [c.paymentType, c.rate])).toEqual([
      ['service', 15],
      ['royalty', 15],
      ['interest', 15],
      ['rent', 10],
      ['non_resident', 14],
    ]);
  });
});
