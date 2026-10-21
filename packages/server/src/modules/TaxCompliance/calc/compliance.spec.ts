import { documentKind, gdtRateFor, issueProblems, label, LABELS, previousMonth, toKhr } from './compliance';

const vatSeller = { enabled: true, tin: 'K001-123456789', taxpayerSize: 'medium' as const, vatRegistered: true };
const registered = { taxNumber: 'K001-987654321', registeredTaxpayer: true };
const consumer = { taxNumber: null, registeredTaxpayer: false };

describe('document kind (Prakas 723)', () => {
  it('VAT invoice only from a VAT-registered medium/large taxpayer to a registered buyer', () => {
    expect(documentKind(vatSeller, registered)).toBe('vat_invoice');
    expect(documentKind({ ...vatSeller, taxpayerSize: 'large' }, registered)).toBe('vat_invoice');
  });

  it('commercial invoice otherwise', () => {
    expect(documentKind(vatSeller, consumer)).toBe('commercial_invoice');
    expect(documentKind(vatSeller, null)).toBe('commercial_invoice');
    expect(documentKind({ ...vatSeller, taxpayerSize: 'small' }, registered)).toBe('commercial_invoice');
    expect(documentKind({ ...vatSeller, vatRegistered: false }, registered)).toBe('commercial_invoice');
  });
});

describe('issue checks', () => {
  const ok = { kind: 'vat_invoice' as const, seller: vatSeller, buyer: registered, foreignCurrency: true, khrRate: 4100 };

  it('passes when everything is there', () => {
    expect(issueProblems(ok)).toEqual([]);
  });

  it('needs the seller TIN, the buyer TIN on a VAT invoice, and a riel rate for foreign currency', () => {
    const codes = (ctx) => issueProblems(ctx).map((p) => p.code);
    expect(codes({ ...ok, seller: { ...vatSeller, tin: ' ' } })).toEqual(['SELLER_TIN_MISSING']);
    expect(codes({ ...ok, buyer: { ...registered, taxNumber: '' } })).toEqual(['BUYER_TIN_MISSING']);
    expect(codes({ ...ok, kind: 'commercial_invoice', buyer: consumer })).toEqual([]);
    expect(codes({ ...ok, khrRate: null })).toEqual(['KHR_RATE_MISSING']);
    expect(codes({ ...ok, foreignCurrency: false, khrRate: null })).toEqual([]);
  });
});

describe('riel', () => {
  it('uses the previous month for the GDT monthly rate', () => {
    expect(previousMonth('2026-10-21')).toBe('2026-09');
    expect(previousMonth('2027-01-05')).toBe('2026-12');
    const rates = [{ month: '2026-09', rate: 4105 }, { month: '2026-10', rate: 4110 }];
    expect(gdtRateFor('2026-10-21', rates)).toBe(4105);
    expect(gdtRateFor('2026-12-01', rates)).toBeNull();
  });

  it('rounds to whole riel', () => {
    expect(toKhr(764.99, 4105)).toBe(3140284);
    expect(toKhr(0.01, 4105)).toBe(41);
  });
});

describe('labels', () => {
  it('Khmer above English by default, or one language', () => {
    expect(label(LABELS.invoiceNumber, 'km_en')).toBe('លេខវិក្កយបត្រ\nInvoice No.');
    expect(label(LABELS.invoiceNumber, 'km')).toBe('លេខវិក្កយបត្រ');
    expect(label(LABELS.invoiceNumber, 'en')).toBe('Invoice No.');
  });
});
