import { DEFAULT_DOCUMENT_LAYOUT, effectiveLayout } from '@bigcapital/pdf-templates';

/** The designer's layout rules (shared/pdf-templates DocumentLayout.ts). */
describe('effectiveLayout', () => {
  it('is the default order without a saved layout', () => {
    expect(effectiveLayout(null, false)).toEqual(DEFAULT_DOCUMENT_LAYOUT);
  });

  it('keeps the saved order and adds blocks and columns it does not know', () => {
    const out = effectiveLayout({ blocks: [{ id: 'notes', visible: true }, { id: 'header', visible: false }], columns: [{ id: 'total', visible: true }] }, false);
    expect(out.blocks.slice(0, 2)).toEqual([{ id: 'notes', visible: true }, { id: 'header', visible: false }]);
    expect(out.blocks.map((b) => b.id)).toEqual(['notes', 'header', 'parties', 'lines', 'totals', 'khr', 'signatures', 'text1', 'text2']);
    expect(out.columns.map((c) => c.id)).toEqual(['total', 'item', 'quantity', 'rate', 'discount']);
  });

  it('drops unknown ids and clamps the font size', () => {
    const out = effectiveLayout({ blocks: [{ id: 'nope' as any, visible: true }], fontSize: 99 }, false);
    expect(out.blocks.some((b) => (b.id as string) === 'nope')).toBe(false);
    expect(out.fontSize).toBe(16);
  });

  it('switches required blocks and columns back on for a tax document', () => {
    const hidden = { blocks: DEFAULT_DOCUMENT_LAYOUT.blocks.map((b) => ({ ...b, visible: false })), columns: DEFAULT_DOCUMENT_LAYOUT.columns.map((c) => ({ ...c, visible: false })) };
    const out = effectiveLayout(hidden, true);
    const on = (list) => list.filter((x) => x.visible).map((x) => x.id);
    expect(on(out.blocks)).toEqual(['header', 'parties', 'lines', 'totals', 'khr', 'signatures']);
    expect(on(out.columns)).toEqual(['item', 'quantity', 'rate', 'total']);
    // Optional ones stay as saved.
    expect(on(effectiveLayout(hidden, false).blocks)).toEqual([]);
  });
});
