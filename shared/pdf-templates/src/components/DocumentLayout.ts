/**
 * 103 DiTech: the block layout of a printed document, edited by drag and drop
 * in Branding › Customize › Layout (design docs/ditech/compliance/
 * cambodia-invoicing-design.md §4). Stored in the branding template's
 * attributes as `layout`; a template without one prints the default order.
 */
export type LayoutBlockId = 'header' | 'parties' | 'lines' | 'totals' | 'khr' | 'notes' | 'signatures' | 'text1' | 'text2';
export type LayoutColumnId = 'item' | 'quantity' | 'rate' | 'discount' | 'total';

export interface LayoutBlock {
  id: LayoutBlockId;
  visible: boolean;
  /** Custom text blocks only. */
  text?: string;
}

export interface LayoutColumn {
  id: LayoutColumnId;
  visible: boolean;
}

export interface DocumentLayout {
  version: 1;
  blocks: LayoutBlock[];
  columns: LayoutColumn[];
  /** Base font size in px (the default template uses 12). */
  fontSize?: number;
}

export const LAYOUT_BLOCK_LABELS: Record<LayoutBlockId, string> = {
  header: 'Header: title, number, dates, logo',
  parties: 'Seller and customer',
  lines: 'Line items',
  totals: 'Totals',
  khr: 'Amounts in riel (KHR)',
  notes: 'Notes and terms',
  signatures: 'Signatures',
  text1: 'Custom text 1',
  text2: 'Custom text 2',
};

export const LAYOUT_COLUMN_LABELS: Record<LayoutColumnId, string> = {
  item: 'Item and description',
  quantity: 'Quantity',
  rate: 'Unit price',
  discount: 'Discount',
  total: 'Amount',
};

export const DEFAULT_DOCUMENT_LAYOUT: DocumentLayout = {
  version: 1,
  blocks: [
    { id: 'header', visible: true },
    { id: 'parties', visible: true },
    { id: 'lines', visible: true },
    { id: 'totals', visible: true },
    { id: 'khr', visible: true },
    { id: 'notes', visible: true },
    { id: 'signatures', visible: true },
    { id: 'text1', visible: false, text: '' },
    { id: 'text2', visible: false, text: '' },
  ],
  columns: [
    { id: 'item', visible: true },
    { id: 'quantity', visible: true },
    { id: 'rate', visible: true },
    { id: 'discount', visible: false },
    { id: 'total', visible: true },
  ],
  fontSize: 12,
};

/** What a tax document (Prakas 723) must show: these cannot be hidden while tax documents are on. */
export const REQUIRED_BLOCKS: Partial<Record<LayoutBlockId, string>> = {
  header: 'The title, invoice number and date are required on a tax document.',
  parties: 'The seller and the buyer with their TIN are required on a tax document.',
  lines: 'The description, quantity and price of each item are required.',
  totals: 'The totals and each tax are required.',
  khr: 'Amounts in riel are required on documents in another currency.',
  signatures: "The seller's name and signature are required.",
};
export const REQUIRED_COLUMNS: Partial<Record<LayoutColumnId, string>> = {
  item: 'The description of each item is required.',
  quantity: 'The quantity is required.',
  rate: 'The unit price is required.',
  total: 'The line amount is required.',
};

/**
 * The layout to print: the saved one completed with any block or column it
 * does not know (added in later versions), and, on a tax document, every
 * required block and column switched back on.
 */
export function effectiveLayout(saved: Partial<DocumentLayout> | null | undefined, taxDocument: boolean): DocumentLayout {
  const base = DEFAULT_DOCUMENT_LAYOUT;
  const merge = <T extends { id: string; visible: boolean }>(savedItems: T[] | undefined, defaults: T[]): T[] => {
    const known = (savedItems ?? []).filter((s) => defaults.some((d) => d.id === s.id));
    const missing = defaults.filter((d) => !known.some((s) => s.id === d.id));
    return [...known.map((s) => ({ ...defaults.find((d) => d.id === s.id)!, ...s })), ...missing];
  };
  const blocks = merge(saved?.blocks, base.blocks).map((b) => (taxDocument && REQUIRED_BLOCKS[b.id] ? { ...b, visible: true } : b));
  const columns = merge(saved?.columns, base.columns).map((c) => (taxDocument && REQUIRED_COLUMNS[c.id] ? { ...c, visible: true } : c));
  const fontSize = Math.min(16, Math.max(9, Number(saved?.fontSize) || base.fontSize!));
  return { version: 1, blocks, columns, fontSize };
}
