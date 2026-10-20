import type { ApiFetcher } from './fetch-utils';
import { paths } from './schema';

// 103 DiTech: price levels (docs/ditech/pricing/price-levels-design.md).
export const PRICE_LEVELS_ROUTES = {
  LIST: '/api/price-levels',
  BY_ID: '/api/price-levels/{id}',
  ASSIGN: '/api/price-levels/{id}/assign',
  RESOLVE: '/api/price-levels/resolve',
} as const satisfies Record<string, keyof paths>;

export type PriceLevelType = 'sales' | 'purchase';
export type PriceLevelMethod = 'percentage' | 'per_item';
export type PriceLevelRounding = 'none' | '0.01' | '0.05' | '0.10' | '0.50' | '1' | 'x.99';
export type PriceSource = 'item_price' | 'quantity_break' | 'percentage' | 'standard' | 'unknown_item';

export interface PriceLevel {
  id: number;
  name: string;
  description: string | null;
  type: PriceLevelType;
  method: PriceLevelMethod;
  percentage: number | null;
  currencyCode: string | null;
  rounding: PriceLevelRounding;
  validFrom: string | null;
  validTo: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PriceLevelListItem extends PriceLevel {
  itemPricesCount: number;
  contactsCount: number;
}

export interface PriceLevelItemPrice {
  itemId: number;
  itemName: string;
  itemCode: string | null;
  standardPrice: number;
  minQuantity: number;
  price: number;
}

export interface PriceLevelDetail extends PriceLevel {
  categories: Array<{ id: number; name: string }>;
  items: PriceLevelItemPrice[];
}

export interface PriceLevelBody {
  name: string;
  description?: string | null;
  type: PriceLevelType;
  method: PriceLevelMethod;
  percentage?: number | null;
  currencyCode?: string | null;
  rounding?: PriceLevelRounding;
  validFrom?: string | null;
  validTo?: string | null;
  active?: boolean;
  categoryIds?: number[];
  items?: Array<{ itemId: number; minQuantity?: number; price: number }>;
}

export interface GetPriceLevelsQuery {
  type?: PriceLevelType;
  active?: 'true' | 'false' | 'all';
  search?: string;
}

export interface ResolvePricesBody {
  type: PriceLevelType;
  priceLevelId?: number | null;
  contactId?: number | null;
  date?: string;
  lines: Array<{ itemId: number; quantity?: number }>;
}

export interface ResolvedPrices {
  priceLevelId: number | null;
  priceLevelName: string | null;
  /** False when the level is inactive or outside its dates on that date: normal prices. */
  applies: boolean;
  currencyCode: string;
  lines: Array<{ itemId: number; quantity: number; standardRate: number; rate: number; source: PriceSource }>;
}

export async function fetchPriceLevels(fetcher: ApiFetcher, query?: GetPriceLevelsQuery): Promise<PriceLevelListItem[]> {
  const get = fetcher.path(PRICE_LEVELS_ROUTES.LIST).method('get').create();
  const { data } = await get((query ?? {}) as never);
  return data as unknown as PriceLevelListItem[];
}

export async function fetchPriceLevel(fetcher: ApiFetcher, id: number | string): Promise<PriceLevelDetail> {
  const get = fetcher.path(PRICE_LEVELS_ROUTES.BY_ID).method('get').create();
  const { data } = await get({ id: Number(id) } as never);
  return data as unknown as PriceLevelDetail;
}

export async function createPriceLevel(fetcher: ApiFetcher, values: PriceLevelBody): Promise<PriceLevelDetail> {
  const post = fetcher.path(PRICE_LEVELS_ROUTES.LIST).method('post').create();
  const { data } = await post(values as never);
  return data as unknown as PriceLevelDetail;
}

export async function editPriceLevel(fetcher: ApiFetcher, id: number | string, values: PriceLevelBody): Promise<PriceLevelDetail> {
  const put = fetcher.path(PRICE_LEVELS_ROUTES.BY_ID).method('put').create();
  const { data } = await put({ id: Number(id), ...values } as never);
  return data as unknown as PriceLevelDetail;
}

export async function deletePriceLevel(fetcher: ApiFetcher, id: number | string): Promise<void> {
  const del = fetcher.path(PRICE_LEVELS_ROUTES.BY_ID).method('delete').create();
  await del({ id: Number(id) } as never);
}

export async function assignPriceLevel(fetcher: ApiFetcher, id: number | string, contactIds: number[]): Promise<{ assigned: number }> {
  const post = fetcher.path(PRICE_LEVELS_ROUTES.ASSIGN).method('post').create();
  const { data } = await post({ id: Number(id), contactIds } as never);
  return data as unknown as { assigned: number };
}

export async function resolvePrices(fetcher: ApiFetcher, body: ResolvePricesBody): Promise<ResolvedPrices> {
  const post = fetcher.path(PRICE_LEVELS_ROUTES.RESOLVE).method('post').create();
  const { data } = await post(body as never);
  return data as unknown as ResolvedPrices;
}
