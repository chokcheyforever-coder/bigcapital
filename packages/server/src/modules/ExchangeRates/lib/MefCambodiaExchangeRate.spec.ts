import { MefCambodiaExchangeRate, clearMefRateCache } from './MefCambodiaExchangeRate';

const rates = [
  { currency_id: 'USD', unit: 1, bid: 4056, ask: 4056, average: 4056, valid_date: '2026-10-02' },
  { currency_id: 'THB', unit: 1, bid: 120, ask: 122, average: 121, valid_date: '2026-10-02' },
  { currency_id: 'JPY', unit: 100, bid: 2562, ask: 2588, average: 2575, valid_date: '2026-10-02' },
];

describe('MefCambodiaExchangeRate', () => {
  beforeEach(() => clearMefRateCache());

  it('converts through the riel, honouring the quoted unit', async () => {
    const mef = new MefCambodiaExchangeRate(undefined, async () => rates);
    expect(await mef.latest('USD', 'KHR')).toBe(4056);
    expect(await mef.latest('KHR', 'USD')).toBeCloseTo(1 / 4056, 9);
    expect(await mef.latest('USD', 'THB')).toBeCloseTo(4056 / 121, 3);
    expect(await mef.latest('JPY', 'KHR')).toBe(25.75); // 2575 per 100 yen
    expect(await mef.latest('usd', 'usd')).toBe(1);
  });

  it('fetches once and caches', async () => {
    let calls = 0;
    const mef = new MefCambodiaExchangeRate(undefined, async () => (calls++, rates));
    await mef.latest('USD', 'KHR');
    await mef.latest('THB', 'KHR');
    expect(calls).toBe(1);
  });

  it('uses the fallback for currencies the NBC does not publish', async () => {
    const fallback = { latest: jest.fn(async () => 0.9) };
    const mef = new MefCambodiaExchangeRate(fallback, async () => rates);
    expect(await mef.latest('USD', 'XAU')).toBe(0.9);
    expect(fallback.latest).toHaveBeenCalledWith('USD', 'XAU');
  });

  it('explains when a currency is not published and there is no fallback', async () => {
    const mef = new MefCambodiaExchangeRate(undefined, async () => rates);
    await expect(mef.latest('USD', 'XAU')).rejects.toMatchObject({ message: expect.stringContaining('XAU') });
  });

  it('falls back when the MEF service is down', async () => {
    const fallback = { latest: jest.fn(async () => 4100) };
    const mef = new MefCambodiaExchangeRate(fallback, async () => {
      throw new Error('ECONNRESET');
    });
    expect(await mef.latest('USD', 'KHR')).toBe(4100);
  });
});
