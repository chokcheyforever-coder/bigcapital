import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import * as moment from 'moment';
import * as XLSX from 'xlsx';
import { keyBy } from 'lodash';
import { TenancyContext } from '@/modules/Tenancy/TenancyContext.service';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { SaleInvoice } from '@/modules/SaleInvoices/models/SaleInvoice';
import { SaleReceipt } from '@/modules/SaleReceipts/models/SaleReceipt';
import { Bill } from '@/modules/Bills/models/Bill';
import { CreditNote } from '@/modules/CreditNotes/models/CreditNote';
import { VendorCredit } from '@/modules/VendorCredit/models/VendorCredit';
import { Expense } from '@/modules/Expenses/models/Expense.model';
import { Account } from '@/modules/Accounts/models/Account.model';
import { ManualJournal } from '@/modules/ManualJournals/models/ManualJournal';
import { CreateManualJournalService } from '@/modules/ManualJournals/commands/CreateManualJournal.service';
import { ServiceError } from '@/modules/Items/ServiceError';
import { TENANCY_DB_CONNECTION } from '@/modules/Tenancy/TenancyDB/TenancyDB.constants';
import { TaxProfileService, TaxProfileView } from '@/modules/TaxCompliance/TaxProfile.service';
import { WithholdingTaxService } from '@/modules/TaxCompliance/WithholdingTax.service';
import { TaxPrepayment } from './models/TaxPrepayment.model';
import { BookDoc, BookRow, bookAoa, expenseDoc, itemDoc, worksheet } from './calc/returns';

export const TAX_RETURN_ERRORS = {
  NOTHING_TO_POST: 'TAX_PREPAYMENT_NOTHING_TO_POST',
};

const ACCOUNTS = {
  prepaid: { name: 'Prepaid Tax on Income', slug: 'prepaid-tax-on-income', accountType: 'other-current-asset' },
  payable: { name: 'Prepayment of Tax on Income Payable', slug: 'prepayment-tax-payable', accountType: 'tax-payable' },
};

/**
 * 103 DiTech part C3: the monthly VAT books (sales and purchases, in the GDT
 * e-VAT layout), the return worksheet and the 1% prepayment of tax on income.
 */
@Injectable()
export class TaxReturnsService {
  constructor(
    private readonly profiles: TaxProfileService,
    private readonly withholding: WithholdingTaxService,
    private readonly createJournal: CreateManualJournalService,
    private readonly tenancyContext: TenancyContext,

    @Inject(SaleInvoice.name)
    private readonly invoiceModel: TenantModelProxy<typeof SaleInvoice>,

    @Inject(SaleReceipt.name)
    private readonly receiptModel: TenantModelProxy<typeof SaleReceipt>,

    @Inject(Bill.name)
    private readonly billModel: TenantModelProxy<typeof Bill>,

    @Inject(CreditNote.name)
    private readonly creditNoteModel: TenantModelProxy<typeof CreditNote>,

    @Inject(VendorCredit.name)
    private readonly vendorCreditModel: TenantModelProxy<typeof VendorCredit>,

    @Inject(Expense.name)
    private readonly expenseModel: TenantModelProxy<typeof Expense>,

    @Inject(Account.name)
    private readonly accountModel: TenantModelProxy<typeof Account>,

    @Inject(ManualJournal.name)
    private readonly journalModel: TenantModelProxy<typeof ManualJournal>,

    @Inject(TaxPrepayment.name)
    private readonly prepaymentModel: TenantModelProxy<typeof TaxPrepayment>,

    @Inject(TENANCY_DB_CONNECTION)
    private readonly tenantKnex: () => Knex,
  ) {}

  private range(month: string) {
    const from = moment(`${month}-01`).format('YYYY-MM-DD');
    return [from, moment(from).endOf('month').format('YYYY-MM-DD')];
  }

  /** Riel per unit of each document currency on a date: the document's own rate first. */
  private rateFinder(profile: TaxProfileView) {
    const cache = new Map<string, number | null>();
    return async (currency: string, date: string, own?: number | null): Promise<number | null> => {
      if (!currency || currency.toUpperCase() === 'KHR') return 1;
      if (own && Number(own) > 0) return Number(own);
      const key = `${currency}:${date}`;
      if (!cache.has(key)) {
        const found = await this.profiles.khrRate(currency, date, profile).catch(() => null);
        cache.set(key, found?.rate ?? null);
      }
      return cache.get(key) ?? null;
    };
  }

  private async contacts(ids: number[]) {
    if (!ids.length) return {} as Record<number, any>;
    const rows = await this.tenantKnex()('contacts').whereIn('id', ids).select('id', 'displayName', 'displayNameKm', 'taxNumber', 'registeredTaxpayer');
    const g = (r: any, camel: string, snake: string) => r[camel] ?? r[snake];
    return keyBy(
      rows.map((r) => ({
        id: r.id,
        name: g(r, 'displayName', 'display_name') ?? '',
        nameKm: g(r, 'displayNameKm', 'display_name_km') ?? null,
        tin: g(r, 'taxNumber', 'tax_number') ?? null,
        registered: !!g(r, 'registeredTaxpayer', 'registered_taxpayer'),
      })),
      'id',
    );
  }

  /**
   * One book row from a document's own-currency figures. Credit notes and
   * vendor credits come in with sign -1 so they reduce the month's totals.
   */
  private async row(doc: BookDoc, parties: Record<number, any>, rateOf: ReturnType<TaxReturnsService['rateFinder']>): Promise<BookRow> {
    const fx = Number(doc.exchangeRate) || 1;
    const k = doc.sign * fx;
    const khr = await rateOf(doc.currencyCode, doc.date, doc.khrRate);
    const party = doc.contactId ? parties[doc.contactId] : undefined;
    const taxableDoc = doc.vat ? doc.taxable : 0;
    return {
      no: 0,
      date: doc.date,
      number: doc.number,
      type: doc.type,
      id: doc.id,
      party: party?.registered ? 'taxpayer' : 'non_taxpayer',
      partyTin: party?.tin ?? null,
      partyNameKm: party?.nameKm ?? null,
      partyName: party?.name ?? '',
      currencyCode: doc.currencyCode,
      khrRate: khr,
      nonTaxable: doc.vat ? 0 : doc.taxable * k,
      taxable: taxableDoc * k,
      vat: doc.vat * k,
      specificTax: doc.specificTax * k,
      accommodationTax: doc.accommodationTax * k,
      plt: doc.plt * k,
      total: doc.total * k,
      taxableKhr: khr ? Math.round(taxableDoc * khr) * doc.sign : null,
      vatKhr: khr ? Math.round(doc.vat * khr) * doc.sign : null,
      totalKhr: khr ? Math.round(doc.total * khr) * doc.sign : null,
    };
  }

  private async rows(docs: BookDoc[]): Promise<BookRow[]> {
    const profile = await this.profiles.get();
    const rateOf = this.rateFinder(profile);
    const parties = await this.contacts(docs.map((d) => d.contactId).filter(Boolean) as number[]);
    const rows: BookRow[] = [];
    for (const doc of docs) rows.push(await this.row(doc, parties, rateOf));
    return this.number(rows);
  }

  /**
   * The sales book: delivered invoices, closed receipts and open credit notes
   * (negative) dated in the month.
   */
  async salesBook(month: string): Promise<BookRow[]> {
    const [from, to] = this.range(month);
    const invoices = await this.invoiceModel()
      .query()
      .whereBetween('invoiceDate', [from, to])
      .whereNotNull('deliveredAt')
      .withGraphFetched('entries.[specificTaxCode, pltCode]');
    const receipts = await this.receiptModel().query().whereBetween('receiptDate', [from, to]).whereNotNull('closedAt').withGraphFetched('entries.[specificTaxCode, pltCode]');
    const creditNotes = await this.creditNoteModel().query().whereBetween('creditNoteDate', [from, to]).whereNotNull('openedAt').withGraphFetched('entries.[specificTaxCode, pltCode]');
    return this.rows([
      ...invoices.map((inv) =>
        itemDoc(inv, {
          type: 'invoice',
          date: inv.invoiceDate,
          number: inv.invoiceNo,
          contactId: inv.customerId,
          subtotalExcludingTax: (inv as any).subtotalExludingTax,
        }),
      ),
      ...receipts.map((rec) => itemDoc(rec, { type: 'receipt', date: rec.receiptDate, number: rec.receiptNumber, contactId: rec.customerId })),
      ...creditNotes.map((cn) => itemDoc(cn, { type: 'credit_note', date: cn.creditNoteDate, number: cn.creditNoteNumber, contactId: cn.customerId, sign: -1 })),
    ]);
  }

  /**
   * The purchase book: open bills, published expenses and open vendor credits
   * (negative) dated in the month.
   */
  async purchaseBook(month: string): Promise<BookRow[]> {
    const [from, to] = this.range(month);
    const bills = await this.billModel().query().whereBetween('billDate', [from, to]).whereNotNull('openedAt').withGraphFetched('entries.[specificTaxCode, pltCode]');
    const vendorCredits = await this.vendorCreditModel()
      .query()
      .whereBetween('vendorCreditDate', [from, to])
      .whereNotNull('openedAt')
      .withGraphFetched('entries.[specificTaxCode, pltCode]');
    const expenses = await this.expenseModel().query().whereBetween('paymentDate', [from, to]).whereNotNull('publishedAt');
    return this.rows([
      ...bills.map((bill) =>
        itemDoc(bill, { type: 'bill', date: bill.billDate, number: bill.billNumber || bill.referenceNo || `#${bill.id}`, contactId: bill.vendorId, ownRate: false }),
      ),
      ...vendorCredits.map((vc) =>
        itemDoc(vc, {
          type: 'vendor_credit',
          date: vc.vendorCreditDate,
          number: vc.vendorCreditNumber || vc.referenceNo || `#${vc.id}`,
          contactId: vc.vendorId,
          sign: -1,
          ownRate: false,
        }),
      ),
      ...expenses.map((exp) => expenseDoc(exp)),
    ]);
  }

  private number(rows: BookRow[]) {
    return rows.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id).map((r, i) => ({ ...r, no: i + 1 }));
  }

  async worksheet(month: string) {
    const [sales, purchases, wht] = await Promise.all([this.salesBook(month), this.purchaseBook(month), this.withholding.report(month)]);
    const sheet = worksheet(
      month,
      sales,
      purchases,
      wht.totals.map((t) => ({ code: t.code, name: t.name, base: t.base, amount: t.amount })),
    );
    const posted = await this.postedPrepayment(month);
    return { ...sheet, currencyCode: wht.currencyCode, prepayment: { ...sheet.prepayment, posted } };
  }

  /** Both books as one workbook (sheets "Sales" and "Purchases"). */
  async booksWorkbook(month: string): Promise<{ body: Buffer; filename: string }> {
    const [sales, purchases] = await Promise.all([this.salesBook(month), this.purchaseBook(month)]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(bookAoa('sales', sales)), 'Sales');
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(bookAoa('purchases', purchases)), 'Purchases');
    return { body: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), filename: `VAT-books-${month}.xlsx` };
  }

  private async postedPrepayment(month: string) {
    const row = await this.prepaymentModel().query().findOne({ month });
    if (!row) return null;
    const journal = row.manualJournalId ? await this.journalModel().query().findById(row.manualJournalId) : null;
    if (!journal) return null; // The journal was deleted: it can be posted again.
    return { journalId: journal.id, journalNumber: (journal as any).journalNumber ?? null, amount: Number(row.amount) };
  }

  /**
   * Posts the month's 1% prepayment of tax on income: Prepaid Tax on Income
   * against Prepayment of Tax on Income Payable, dated the last day of the
   * month. Once per month (again only if that journal was deleted).
   */
  async postPrepayment(month: string) {
    const existing = await this.postedPrepayment(month);
    if (existing) return existing;
    const sheet = await this.worksheet(month);
    const amount = sheet.prepayment.amount;
    if (!(amount > 0)) throw new ServiceError(TAX_RETURN_ERRORS.NOTHING_TO_POST, 'There is no turnover in this month, so no prepayment to post.');
    const prepaid = await this.findOrCreate(ACCOUNTS.prepaid);
    const payable = await this.findOrCreate(ACCOUNTS.payable);
    const date = moment(`${month}-01`).endOf('month').format('YYYY-MM-DD');
    const journal = await this.createJournal.makeJournalEntries({
      date: date as any,
      // The journal validator requires a number even with auto-increment on.
      journalNumber: `TOI-PREPAY-${month}`,
      reference: `TOI-PREPAY-${month}`,
      description: `Prepayment of tax on income ${sheet.prepayment.rate}% of ${month} turnover (${sheet.prepayment.turnover.toFixed(2)})`,
      publish: true,
      entries: [
        { index: 1, accountId: prepaid.id, debit: amount, note: `Prepayment of tax on income ${month}` },
        { index: 2, accountId: payable.id, credit: amount, note: `Due ${sheet.dueDate}` },
      ],
    } as any);
    const row = await this.prepaymentModel().query().findOne({ month });
    const values = { month, turnover: sheet.prepayment.turnover, rate: sheet.prepayment.rate, amount, manualJournalId: journal.id };
    if (row) await this.prepaymentModel().query().patchAndFetchById(row.id, values);
    else await this.prepaymentModel().query().insert(values as any);
    return { journalId: journal.id, journalNumber: (journal as any).journalNumber ?? null, amount };
  }

  private async findOrCreate(spec: { name: string; slug: string; accountType: string }) {
    const found = await this.accountModel().query().findOne({ slug: spec.slug });
    if (found) return found;
    // In the base currency: journals reject accounts without a currency.
    const metadata = await this.tenancyContext.getTenantMetadata();
    return this.accountModel()
      .query()
      .insertAndFetch({ ...spec, currencyCode: metadata?.baseCurrency, description: '', active: true, index: 1, predefined: false } as any);
  }
}
