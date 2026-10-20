// Query key constants
export const PRICE_LEVELS = 'PRICE_LEVELS';
export const PRICE_LEVEL = 'PRICE_LEVEL';

// Query key factory
export const priceLevelsKeys = {
  all: () => [PRICE_LEVELS] as const,
  list: (query?: Record<string, unknown>) => [PRICE_LEVELS, query] as const,
  detail: (id: number | string | null | undefined) => [PRICE_LEVEL, id] as const,
};
