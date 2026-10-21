import { Transformer } from '@/modules/Transformer/Transformer';
import { SaleInvoice } from '../models/SaleInvoice';
import { ItemEntryTransformer } from '../../TransactionItemEntry/ItemEntry.transformer';
import { AttachmentTransformer } from '../../Attachments/Attachment.transformer';
import { SaleInvoiceTaxEntryTransformer } from './SaleInvoiceTaxEntry.transformer';
import { DiscountType } from '@/common/types/Discount';

export class SaleInvoiceTransformer extends Transformer {
  /**
   * Include these attributes to sale invoice object.
   * @returns {Array}
   */
  public includeAttributes = (): string[] => {
    return [
      'invoiceDateFormatted',
      'dueDateFormatted',
      'createdAtFormatted',
      'dueAmountFormatted',
      'paymentAmountFormatted',
      'balanceAmountFormatted',
      'exchangeRateFormatted',
      'subtotalFormatted',
      'subtotalLocalFormatted',
      'subtotalExludingTaxFormatted',
      'taxAmountWithheldFormatted',
      'taxAmountWithheldLocalFormatted',
      'totalFormatted',
      'totalLocalFormatted',
      'discountAmountFormatted',
      'discountPercentageFormatted',
      'adjustmentFormatted',
      'taxes',
      'exciseAmountFormatted',
      'exciseTaxes',
      'entries',
      'attachments',
    ];
  };

  /**
   * Retrieve formatted invoice date.
   * @param {ISaleInvoice} invoice
   * @returns {String}
   */
  protected invoiceDateFormatted = (invoice: SaleInvoice): string => {
    return this.formatDate(invoice.invoiceDate);
  };

  /**
   * Retrieve formatted due date.
   * @param {ISaleInvoice} invoice
   * @returns {string}
   */
  protected dueDateFormatted = (invoice: SaleInvoice): string => {
    return this.formatDate(invoice.dueDate);
  };

  /**
   * Retrieve the formatted created at date.
   * @param invoice
   * @returns {string}
   */
  protected createdAtFormatted = (invoice: SaleInvoice): string => {
    return this.formatDate(invoice.createdAt);
  };

  /**
   * Retrieve formatted invoice due amount.
   * @param {ISaleInvoice} invoice
   * @returns {string}
   */
  protected dueAmountFormatted = (invoice: SaleInvoice): string => {
    return this.formatNumber(invoice.dueAmount, {
      currencyCode: invoice.currencyCode,
      money: true,
    });
  };

  /**
   * Retrieve formatted payment amount.
   * @param {ISaleInvoice} invoice
   * @returns {string}
   */
  protected paymentAmountFormatted = (invoice: SaleInvoice): string => {
    return this.formatNumber(invoice.paymentAmount, {
      currencyCode: invoice.currencyCode,
    });
  };

  /**
   * Retrieve the formatted invoice balance.
   * @param {ISaleInvoice} invoice
   * @returns {string}
   */
  protected balanceAmountFormatted = (invoice: SaleInvoice): string => {
    return this.formatNumber(invoice.balanceAmount, {
      currencyCode: invoice.currencyCode,
    });
  };

  /**
   * Retrieve the formatted exchange rate.
   * @param {ISaleInvoice} invoice
   * @returns {string}
   */
  protected exchangeRateFormatted = (invoice: SaleInvoice): string => {
    return this.formatNumber(invoice.exchangeRate, { money: false });
  };

  /**
   * Retrieves formatted subtotal in base currency.
   * (Tax inclusive if the tax inclusive is enabled)
   * @param invoice
   * @returns {string}
   */
  protected subtotalFormatted = (invoice: SaleInvoice): string => {
    return this.formatNumber(invoice.subtotal, {
      currencyCode: this.context.organization.baseCurrency,
    });
  };

  /**
   * Retrieves formatted subtotal in foreign currency.
   * (Tax inclusive if the tax inclusive is enabled)
   * @param invoice
   * @returns {string}
   */
  protected subtotalLocalFormatted = (invoice: SaleInvoice): string => {
    return this.formatNumber(invoice.subtotalLocal, {
      currencyCode: invoice.currencyCode,
    });
  };

  /**
   * Retrieves formatted subtotal excluding tax in foreign currency.
   * @param invoice
   * @returns {string}
   */
  protected subtotalExludingTaxFormatted = (invoice: SaleInvoice): string => {
    return this.formatNumber(invoice.subtotalExludingTax, {
      currencyCode: invoice.currencyCode,
    });
  };

  /**
   * Retrieves formatted tax amount withheld in foreign currency.
   * @param invoice
   * @returns {string}
   */
  protected taxAmountWithheldFormatted = (invoice: SaleInvoice): string => {
    return this.formatNumber(invoice.taxAmountWithheld, {
      currencyCode: invoice.currencyCode,
    });
  };

  /**
   * Retrieves formatted tax amount withheld in base currency.
   * @param invoice
   * @returns {string}
   */
  protected taxAmountWithheldLocalFormatted = (
    invoice: SaleInvoice,
  ): string => {
    return this.formatNumber(invoice.taxAmountWithheldLocal, {
      currencyCode: this.context.organization.baseCurrency,
    });
  };

  /**
   * Retrieves formatted total in foreign currency.
   * @param invoice
   * @returns {string}
   */
  protected totalFormatted = (invoice: SaleInvoice): string => {
    return this.formatNumber(invoice.total, {
      currencyCode: invoice.currencyCode,
      money: true,
    });
  };

  /**
   * Retrieves formatted total in base currency.
   * @param invoice
   * @returns {string}
   */
  protected totalLocalFormatted = (invoice: SaleInvoice): string => {
    return this.formatNumber(invoice.totalLocal, {
      currencyCode: this.context.organization.baseCurrency,
    });
  };

  /**
   * Retrieves formatted discount amount.
   * @param invoice
   * @returns {string}
   */
  protected discountAmountFormatted = (invoice: SaleInvoice): string => {
    return this.formatNumber(invoice.discountAmount, {
      currencyCode: invoice.currencyCode,
    });
  };

  /**
   * Retrieves formatted discount percentage.
   * @param invoice
   * @returns {string}
   */
  protected discountPercentageFormatted = (invoice: SaleInvoice): string => {
    return invoice.discountType === DiscountType.Percentage
      ? `${invoice.discount}%`
      : '';
  };

  /**
   * Retrieves formatted adjustment amount.
   * @param invoice
   * @returns {string}
   */
  protected adjustmentFormatted = (invoice: SaleInvoice): string => {
    return this.formatNumber(invoice.adjustment, {
      currencyCode: invoice.currencyCode,
    });
  };

  /**
   * 103 DiTech: Specific/Accommodation Tax + PLT formatted.
   * @param {SaleInvoice} invoice
   * @returns {string}
   */
  protected exciseAmountFormatted = (invoice: SaleInvoice): string => {
    return this.formatNumber(Number(invoice.exciseAmount) || 0, {
      currencyCode: invoice.currencyCode,
    });
  };

  /**
   * 103 DiTech: the taxes charged before VAT, one line per code and rate.
   * @param {SaleInvoice} invoice
   */
  protected exciseTaxes = (invoice: SaleInvoice) => {
    const lines = new Map<string, { code: string; name: string; nameKm: string | null; rate: number; amount: number }>();
    for (const entry of invoice.entries ?? []) {
      const parts = [
        { code: (entry as any).specificTaxCode, rate: entry.specificTaxRate, amount: entry.specificTaxAmount },
        { code: (entry as any).pltCode, rate: entry.pltRate, amount: entry.pltAmount },
      ];
      for (const part of parts) {
        if (!part.amount) continue;
        const key = `${part.code?.code ?? '?'}@${Number(part.rate)}`;
        const line = lines.get(key) ?? { code: part.code?.code ?? '', name: part.code?.name ?? '', nameKm: part.code?.nameKm ?? null, rate: Number(part.rate), amount: 0 };
        line.amount += part.amount;
        lines.set(key, line);
      }
    }
    return [...lines.values()].map((line) => ({
      ...line,
      amountFormatted: this.formatNumber(line.amount, { currencyCode: invoice.currencyCode }),
    }));
  };

  /**
   * Retrieve the taxes lines of sale invoice.
   * @param {ISaleInvoice} invoice
   */
  protected taxes = (invoice: SaleInvoice) => {
    return this.item(invoice.taxes, new SaleInvoiceTaxEntryTransformer(), {
      // 103 DiTech: VAT is charged on the Specific Tax and PLT too.
      subtotal: invoice.subtotal + (Number(invoice.exciseAmount) || 0),
      isInclusiveTax: invoice.isInclusiveTax,
      currencyCode: invoice.currencyCode,
    });
  };

  /**
   * Retrieves the entries of the sale invoice.
   * @param {ISaleInvoice} invoice
   * @returns {}
   */
  protected entries = (invoice: SaleInvoice) => {
    return this.item(invoice.entries, new ItemEntryTransformer(), {
      currencyCode: invoice.currencyCode,
    });
  };

  /**
   * Retrieves the sale invoice attachments.
   * @param {ISaleInvoice} invoice
   * @returns
   */
  protected attachments = (invoice: SaleInvoice) => {
    return this.item(invoice.attachments, new AttachmentTransformer());
  };
}
