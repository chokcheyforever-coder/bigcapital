// @ts-nocheck
// 103 DiTech: the company's Specific Tax, Accommodation Tax and PLT codes
// (GET /tax-compliance/excise-codes, snake_case on the wire).
import { useQuery } from '@tanstack/react-query';
import { useTaxApi } from '../compliance/useTaxApi';

export const EXCISE_CODES_QUERY_KEY = ['EXCISE_TAX_CODES'];

export interface ExciseTaxCode {
  id: number;
  kind: 'specific' | 'accommodation' | 'plt';
  code: string;
  name: string;
  name_km: string | null;
  rate: number;
  base_percent: number;
  account_id: number | null;
  active: boolean;
  item_ids: number[];
}

export function useExciseTaxCodes(options = {}) {
  const api = useTaxApi();
  return useQuery<ExciseTaxCode[]>({
    queryKey: EXCISE_CODES_QUERY_KEY,
    queryFn: () => api('GET', '/excise-codes'),
    staleTime: 60_000,
    ...options,
  });
}
