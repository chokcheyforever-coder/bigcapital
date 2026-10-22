import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import * as moment from 'moment';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { Account } from '@/modules/Accounts/models/Account.model';
import { AuditLogService } from '@/modules/AuditLogs/AuditLog.service';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { ServiceError } from '@/modules/Items/ServiceError';
import { TenancyContext } from '@/modules/Tenancy/TenancyContext.service';
import { TENANCY_DB_CONNECTION } from '@/modules/Tenancy/TenancyDB/TenancyDB.constants';
import { WhtCode } from './models/WhtCode.model';
import { EditWhtCodeDto } from './dtos/WhtCode.dto';
import { DEFAULT_WHT_CODES, WHT_LABELS, whtAmount } from './calc/wht';
import { label } from './calc/compliance';
import { TaxProfileService } from './TaxProfile.service';

export const WHT_ERRORS = {
  CODE_NOT_FOUND: 'WHT_CODE_NOT_FOUND',
  ACCOUNT_NOT_FOUND: 'WHT_ACCOUNT_NOT_FOUND',
  TOO_MUCH: 'WHT_AMOUNT_EXCEEDS_DOCUMENT',
};

const PAYABLE_ACCOUNT = { name: 'Withholding Tax Payable', slug: 'withholding-tax-payable' };

export interface WhtFields {
  whtCodeId: number | null;
  whtRate: number | null;
  whtAmount: number;
}

export interface WhtDocumentRow {
  type: 'Bill' | 'Expense';
  id: number;
  number: string | null;
  date: string;
  vendorId: number;
  codeId: number;
  base: number;
  rate: number;
  amount: number;
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * 103 DiTech part C2: withholding tax on bills and expenses. The vendor is
 * owed the amount less the tax, which goes to Withholding Tax Payable; the
 * company files it by the 20th of the next month and gives the vendor a
 * certificate.
 */
@Injectable()
export class WithholdingTaxService {
  constructor(
    private readonly auditLog: AuditLogService,
    private readonly profiles: TaxProfileService,
    private readonly tenancyContext: TenancyContext,

    @Inject(WhtCode.name)
    private readonly codeModel: TenantModelProxy<typeof WhtCode>,

    @Inject(Account.name)
    private readonly accountModel: TenantModelProxy<typeof Account>,

    @Inject(TENANCY_DB_CONNECTION)
    private readonly tenantKnex: () => Knex,
  ) {}

  async list() {
    await this.ensureDefaults();
    const codes = await this.codeModel().query().orderBy('id');
    return codes.map((c) => ({ ...c.toJSON(), rate: Number(c.rate), active: !!c.active }));
  }

  async edit(id: number, dto: EditWhtCodeDto) {
    const code = await this.codeModel().query().findById(id);
    if (!code) throw new ServiceError(WHT_ERRORS.CODE_NOT_FOUND, 'The withholding tax code was not found.');
    if (dto.accountId && !(await this.accountModel().query().findById(dto.accountId))) {
      throw new ServiceError(WHT_ERRORS.ACCOUNT_NOT_FOUND, 'The payable account was not found.');
    }
    const patch = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    await this.codeModel().query().patchAndFetchById(id, patch);
    await this.auditLog.record({
      action: 'edited',
      subject: AbilitySubject.Preferences,
      subjectId: id,
      metadata: { whtCode: { code: code.code, before: { rate: code.rate, accountId: code.accountId, active: code.active }, after: patch } },
    });
    return (await this.list()).find((c) => c.id === id);
  }

  /**
   * The WHT of a bill or expense. `requested` is the code sent with the
   * document: undefined uses the vendor's usual code, null means none.
   * `base` excludes VAT.
   */
  async resolve(requested: number | null | undefined, vendorId: number | null | undefined, base: number, trx?: Knex.Transaction): Promise<WhtFields> {
    let codeId = requested;
    if (codeId === undefined && vendorId) {
      const vendor = await this.tenantKnex()('contacts').where('id', vendorId).first('defaultWhtCodeId');
      codeId = vendor?.defaultWhtCodeId ?? vendor?.default_wht_code_id ?? null;
    }
    if (!codeId) return { whtCodeId: null, whtRate: null, whtAmount: 0 };
    const code = await this.codeModel().query(trx).findById(codeId);
    if (!code) throw new ServiceError(WHT_ERRORS.CODE_NOT_FOUND, 'The withholding tax code was not found.');
    if (!code.active) return { whtCodeId: null, whtRate: null, whtAmount: 0 };
    const rate = Number(code.rate);
    return { whtCodeId: code.id, whtRate: rate, whtAmount: whtAmount(base, rate) };
  }

  /** Bills (open) and expenses (published) with tax withheld in the month, in the base currency. */
  async documents(month: string, vendorId?: number): Promise<WhtDocumentRow[]> {
    const from = moment(`${month}-01`).format('YYYY-MM-DD');
    const to = moment(`${month}-01`).endOf('month').format('YYYY-MM-DD');
    const knex = this.tenantKnex();
    const bills = await knex('bills')
      .where('whtAmount', '>', 0)
      .whereNotNull('openedAt')
      .whereBetween('billDate', [from, to])
      .modify((q) => (vendorId ? q.where('vendorId', vendorId) : q))
      .select('id', 'billNumber', 'billDate', 'vendorId', 'whtCodeId', 'whtRate', 'whtAmount', 'exchangeRate', 'amount', 'discount', 'discountType');
    const expenses = await knex('expenses_transactions')
      .where('whtAmount', '>', 0)
      .whereNotNull('publishedAt')
      .whereBetween('paymentDate', [from, to])
      .modify((q) => (vendorId ? q.where('payeeId', vendorId) : q))
      .select('id', 'referenceNo', 'paymentDate', 'payeeId', 'whtCodeId', 'whtRate', 'whtAmount', 'exchangeRate', 'totalAmount');
    const g = (row: any, camel: string) => row[camel] ?? row[camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)];
    const local = (row: any, n: number) => n * (Number(g(row, 'exchangeRate')) || 1);
    const rows: WhtDocumentRow[] = [
      ...bills.map((b) => {
        const rate = Number(g(b, 'whtRate'));
        const amount = local(b, Number(g(b, 'whtAmount')));
        return { type: 'Bill' as const, id: b.id, number: g(b, 'billNumber'), date: moment(g(b, 'billDate')).format('YYYY-MM-DD'), vendorId: g(b, 'vendorId'), codeId: g(b, 'whtCodeId'), rate, amount, base: rate ? (amount * 100) / rate : 0 };
      }),
      ...expenses.map((e) => {
        const rate = Number(g(e, 'whtRate'));
        const amount = local(e, Number(g(e, 'whtAmount')));
        return { type: 'Expense' as const, id: e.id, number: g(e, 'referenceNo'), date: moment(g(e, 'paymentDate')).format('YYYY-MM-DD'), vendorId: g(e, 'payeeId'), codeId: g(e, 'whtCodeId'), rate, amount, base: rate ? (amount * 100) / rate : 0 };
      }),
    ];
    return rows.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  }

  /** The month's withholding: by vendor and code, with totals by code (what the monthly return needs). */
  async report(month: string) {
    const rows = await this.documents(month);
    const codes = await this.codeModel().query();
    const vendorIds = [...new Set(rows.map((r) => r.vendorId).filter(Boolean))];
    const vendors = vendorIds.length
      ? await this.tenantKnex()('contacts').whereIn('id', vendorIds).select('id', 'displayName', 'taxNumber')
      : [];
    const codeOf = (id: number) => codes.find((c) => c.id === id);
    const vendorOf = (id: number) => vendors.find((v) => v.id === id) as any;
    const byVendor = new Map<string, any>();
    for (const r of rows) {
      const key = `${r.vendorId}:${r.codeId}`;
      const code = codeOf(r.codeId);
      const vendor = vendorOf(r.vendorId);
      const line = byVendor.get(key) ?? {
        vendorId: r.vendorId,
        vendorName: vendor?.displayName ?? vendor?.display_name ?? '',
        vendorTin: vendor?.taxNumber ?? vendor?.tax_number ?? null,
        codeId: r.codeId,
        code: code?.code ?? '',
        name: code?.name ?? '',
        rate: r.rate,
        base: 0,
        amount: 0,
        documents: [] as WhtDocumentRow[],
      };
      line.base += r.base;
      line.amount += r.amount;
      line.documents.push(r);
      byVendor.set(key, line);
    }
    const byCode = new Map<number, any>();
    for (const r of rows) {
      const code = codeOf(r.codeId);
      const t = byCode.get(r.codeId) ?? { codeId: r.codeId, code: code?.code ?? '', name: code?.name ?? '', paymentType: code?.paymentType ?? 'other', base: 0, amount: 0 };
      t.base += r.base;
      t.amount += r.amount;
      byCode.set(r.codeId, t);
    }
    const metadata = await this.tenancyContext.getTenantMetadata();
    return {
      month,
      currencyCode: metadata?.baseCurrency ?? 'USD',
      dueDate: moment(`${month}-20`).add(1, 'month').format('YYYY-MM-DD'),
      lines: [...byVendor.values()],
      totals: [...byCode.values()],
      total: rows.reduce((s, r) => s + r.amount, 0),
    };
  }

  /** The certificate given to a vendor for the month (HTML; the controller can make a PDF of it). */
  async certificateHtml(vendorId: number, month: string): Promise<string> {
    const report = await this.report(month);
    const lines = report.lines.filter((l) => l.vendorId === vendorId);
    const profile = await this.profiles.get();
    const metadata = await this.tenancyContext.getTenantMetadata();
    const lang = profile.documentLanguage;
    const L = (k: keyof typeof WHT_LABELS) => esc(label(WHT_LABELS[k], lang)).replace(/\n/g, '<br/>');
    const vendor = lines[0] ?? (await this.tenantKnex()('contacts').where('id', vendorId).first('displayName', 'taxNumber'));
    const vendorName = (vendor as any)?.vendorName ?? (vendor as any)?.displayName ?? (vendor as any)?.display_name ?? '';
    const vendorTin = (vendor as any)?.vendorTin ?? (vendor as any)?.taxNumber ?? (vendor as any)?.tax_number ?? '';
    const docs = lines.flatMap((l) => l.documents.map((d) => ({ ...d, name: l.name })));
    const total = docs.reduce((s, d) => s + d.amount, 0);
    const rowsHtml = docs
      .map(
        (d) =>
          `<tr><td>${esc(d.date)}</td><td>${esc(d.type === 'Bill' ? 'Bill' : 'Expense')} ${esc(d.number ?? `#${d.id}`)}</td><td>${esc(d.name)}</td><td class="n">${money(d.base)}</td><td class="n">${d.rate}%</td><td class="n">${money(d.amount)}</td></tr>`,
      )
      .join('');
    return `<!doctype html><html lang="km"><head><meta charset="utf-8"/><title>${esc(WHT_LABELS.certificate.en)} ${esc(month)}</title>
<style>
body{font-family:'Noto Sans Khmer','Khmer OS Battambang',system-ui,sans-serif;font-size:12px;color:#111;margin:32px}
h1{font-size:18px;text-align:center;margin:0 0 4px}
.sub{text-align:center;color:#555;margin-bottom:20px}
.parties{display:flex;gap:24px;margin-bottom:16px}.parties>div{flex:1;border:1px solid #ccc;padding:8px 10px}
.k{color:#555;font-size:11px}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:5px 6px;vertical-align:top}th{background:#f3f3f3;text-align:left;font-weight:600}
.n{text-align:right;white-space:nowrap}tfoot td{font-weight:700}
.sign{margin-top:48px;display:flex;justify-content:flex-end}.sign div{width:240px;border-top:1px solid #333;padding-top:6px;text-align:center}
</style></head><body data-testid="wht-certificate">
<h1>${L('certificate')}</h1>
<div class="sub">${L('month')}: ${esc(month)} · ${esc(report.currencyCode)}</div>
<div class="parties">
<div><div class="k">${L('withholder')}</div><strong>${esc(metadata?.name ?? '')}</strong>${profile.companyNameKm ? `<div>${esc(profile.companyNameKm)}</div>` : ''}<div>${L('tin')}: ${esc(profile.tin ?? '')}</div></div>
<div><div class="k">${L('recipient')}</div><strong>${esc(vendorName)}</strong><div>${L('tin')}: ${esc(vendorTin)}</div></div>
</div>
<table><thead><tr><th>${L('date')}</th><th>${L('document')}</th><th>${L('paymentType')}</th><th class="n">${L('base')}</th><th class="n">${L('rate')}</th><th class="n">${L('withheld')}</th></tr></thead>
<tbody>${rowsHtml || '<tr><td colspan="6">—</td></tr>'}</tbody>
<tfoot><tr><td colspan="5">${L('total')}</td><td class="n">${money(total)}</td></tr></tfoot></table>
<div class="sign"><div>${L('signature')}${profile.signatoryName ? `<br/>${esc(profile.signatoryName)}` : ''}${profile.signatoryTitle ? `<br/>${esc(profile.signatoryTitle)}` : ''}</div></div>
</body></html>`;
  }

  async ensureDefaults(trx?: Knex.Transaction) {
    if ((await this.codeModel().query(trx).resultSize()) > 0) return;
    let account = await this.accountModel().query(trx).findOne({ slug: PAYABLE_ACCOUNT.slug });
    if (!account) {
      // In the base currency: journals reject accounts without a currency.
      const metadata = await this.tenancyContext.getTenantMetadata();
      account = await this.accountModel()
        .query(trx)
        .insertAndFetch({ ...PAYABLE_ACCOUNT, accountType: 'tax-payable', currencyCode: metadata?.baseCurrency, description: '', active: true, index: 1, predefined: false } as any);
    }
    // One by one: objection's batch insert is not supported on MySQL.
    for (const c of DEFAULT_WHT_CODES) {
      await this.codeModel()
        .query(trx)
        .insert({ ...c, accountId: account.id, active: true } as any);
    }
  }
}
