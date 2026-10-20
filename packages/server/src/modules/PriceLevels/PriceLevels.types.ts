export enum PriceLevelAction {
  View = 'View',
  Create = 'Create',
  Edit = 'Edit',
  Delete = 'Delete',
}

export const PRICE_LEVEL_TYPES = ['sales', 'purchase'] as const;
export type PriceLevelType = (typeof PRICE_LEVEL_TYPES)[number];

/** percentage: the normal price up or down by N%; per_item: fixed prices per item, with quantity breaks. */
export const PRICE_LEVEL_METHODS = ['percentage', 'per_item'] as const;
export type PriceLevelMethod = (typeof PRICE_LEVEL_METHODS)[number];

/** Applied to percentage prices only; fixed per-item prices are used as entered. */
export const ROUNDINGS = ['none', '0.01', '0.05', '0.10', '0.50', '1', 'x.99'] as const;
export type Rounding = (typeof ROUNDINGS)[number];

/** Which documents take which price level type, and which item price is "normal" for them. */
export const DOCUMENT_TYPES = {
  SaleEstimate: { table: 'sales_estimates', levelType: 'sales', basePrice: 'sellPrice' },
  SaleInvoice: { table: 'sales_invoices', levelType: 'sales', basePrice: 'sellPrice' },
  SaleReceipt: { table: 'sales_receipts', levelType: 'sales', basePrice: 'sellPrice' },
  CreditNote: { table: 'credit_notes', levelType: 'sales', basePrice: 'sellPrice' },
  Bill: { table: 'bills', levelType: 'purchase', basePrice: 'costPrice' },
  VendorCredit: { table: 'vendor_credits', levelType: 'purchase', basePrice: 'costPrice' },
} as const;
export type PriceDocumentType = keyof typeof DOCUMENT_TYPES;

/** Tables whose rows can point at a price level (all columns are `price_level_id`). */
export const PRICE_LEVEL_USAGE_TABLES = ['contacts', ...Object.values(DOCUMENT_TYPES).map((d) => d.table)];

export const ERRORS = {
  PRICE_LEVEL_NOT_FOUND: 'PRICE_LEVEL_NOT_FOUND',
  PRICE_LEVEL_NAME_EXISTS: 'PRICE_LEVEL_NAME_EXISTS',
  PRICE_LEVEL_INACTIVE: 'PRICE_LEVEL_INACTIVE',
  PRICE_LEVEL_WRONG_TYPE: 'PRICE_LEVEL_WRONG_TYPE',
  PRICE_LEVEL_IN_USE: 'PRICE_LEVEL_IN_USE',
  PRICE_LEVEL_INVALID: 'PRICE_LEVEL_INVALID',
  PRICE_LEVEL_CONTACT_NOT_FOUND: 'PRICE_LEVEL_CONTACT_NOT_FOUND',
};
