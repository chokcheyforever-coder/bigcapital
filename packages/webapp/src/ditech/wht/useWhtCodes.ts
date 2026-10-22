// @ts-nocheck
// 103 DiTech part C2: the company's withholding tax codes
// (GET /tax-compliance/wht-codes, snake_case on the wire).
import { useQuery } from '@tanstack/react-query';
import { useTaxApi } from '../compliance/useTaxApi';

export const WHT_CODES_QUERY_KEY = ['WHT_CODES'];

export interface WhtCode {
  id: number;
  code: string;
  name: string;
  name_km: string | null;
  payment_type: string;
  rate: number;
  account_id: number | null;
  active: boolean;
}

export function useWhtCodes(options = {}) {
  const api = useTaxApi();
  return useQuery<WhtCode[]>({
    queryKey: WHT_CODES_QUERY_KEY,
    queryFn: () => api('GET', '/wht-codes'),
    staleTime: 60_000,
    ...options,
  });
}

/** Tax withheld on a base (excluding VAT), to the cent, as the server does. */
export const whtAmount = (base: number, rate: number | null | undefined) =>
  rate ? Math.round((Number(base) || 0) * Number(rate)) / 100 : 0;

/** Form value ('' = none) to request value. */
export const whtCodeToRequest = (value: unknown) => (value ? Number(value) : null);

/** Server value to form value. */
export const whtCodeToForm = (value: unknown) => (value ? String(value) : '');
