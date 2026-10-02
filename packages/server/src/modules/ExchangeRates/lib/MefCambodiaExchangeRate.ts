import Axios from 'axios';
import { ServiceError } from '@/modules/Items/ServiceError';
import { EchangeRateErrors, IExchangeRateService } from './types';

// 103 DiTech: the official daily rates of the National Bank of Cambodia, as
// published by the Ministry of Economy and Finance (public, no key). Each
// entry is the riel price of `unit` units of a currency (JPY per 100, VND per
// 1,000, ...); any pair is computed through the riel.
export const MEF_EXCHANGE_RATE_URL =
  'https://data.mef.gov.kh/api/v1/realtime-api/exchange-rate';
const CACHE_TTL_MS = 30 * 60_000; // rates change once a day (around 21:00)

interface MefRate {
  currency_id: string;
  unit: number;
  bid: number;
  ask: number;
  average: number;
  valid_date: string;
}

let cache: { at: number; khrPer: Map<string, number> } | null = null;

/** For tests. */
export const clearMefRateCache = () => {
  cache = null;
};

export class MefCambodiaExchangeRate implements IExchangeRateService {
  constructor(
    private readonly fallback?: IExchangeRateService,
    private readonly fetchRates: () => Promise<MefRate[]> = async () =>
      (await Axios.get(MEF_EXCHANGE_RATE_URL, { timeout: 10_000 })).data?.data ?? [],
  ) {}

  /** Riel price of one unit of each published currency (KHR itself is 1). */
  private async khrPerUnit(): Promise<Map<string, number>> {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.khrPer;
    const rates = await this.fetchRates();
    const khrPer = new Map<string, number>([['KHR', 1]]);
    for (const r of rates) {
      const mid = r.average || (r.bid + r.ask) / 2;
      if (r.currency_id && mid > 0 && r.unit > 0) {
        khrPer.set(r.currency_id.toUpperCase(), mid / r.unit);
      }
    }
    if (khrPer.size > 1) cache = { at: Date.now(), khrPer };
    return khrPer;
  }

  public async latest(baseCurrency: string, toCurrency: string): Promise<number> {
    const from = baseCurrency.toUpperCase();
    const to = toCurrency.toUpperCase();
    if (from === to) return 1;

    let khrPer: Map<string, number>;
    try {
      khrPer = await this.khrPerUnit();
    } catch (error) {
      if (this.fallback) return this.fallback.latest(from, to);
      throw new ServiceError(
        EchangeRateErrors.EX_RATE_SERVICE_NOT_ALLOWED,
        'The National Bank of Cambodia rates are unavailable right now. Enter the rate manually or try again later.',
      );
    }
    const fromKhr = khrPer.get(from);
    const toKhr = khrPer.get(to);
    if (fromKhr && toKhr) {
      // Six significant decimals: KHR -> USD is about 0.000247.
      return Number((fromKhr / toKhr).toPrecision(6));
    }
    if (this.fallback) return this.fallback.latest(from, to);
    throw new ServiceError(
      EchangeRateErrors.EX_RATE_SERVICE_NOT_ALLOWED,
      `The National Bank of Cambodia does not publish a rate for ${!fromKhr ? from : to}. Enter the rate manually.`,
    );
  }
}
