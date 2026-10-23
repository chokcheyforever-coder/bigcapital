import { AttachmentTransformer } from '@/modules/Attachments/Attachment.transformer';
import { ItemEntryTransformer } from '@/modules/TransactionItemEntry/ItemEntry.transformer';
import { Transformer } from '@/modules/Transformer/Transformer';
import { documentTaxLines } from '@/modules/TaxCompliance/calc/taxLines';

export class CreditNoteTransformer extends Transformer {
  /**
   * Include these attributes to sale credit note object.
   * @returns {Array}
   */
  public includeAttributes = (): string[] => {
    return [
      'formattedCreditsRemaining',
      'formattedCreditNoteDate',
      'formattedCreatedAt',
      'formattedCreatedAt',
      'formattedAmount',
      'formattedCreditsUsed',
      'formattedSubtotal',

      'discountAmountFormatted',
      'discountAmountLocalFormatted',

      'discountPercentageFormatted',

      'adjustmentFormatted',
      'adjustmentLocalFormatted',

      'totalFormatted',

      // 103 DiTech: VAT and Specific/Accommodation Tax + PLT.
      'subtotalExcludingTaxFormatted',
      'taxAmountWithheldFormatted',
      'exciseAmountFormatted',
      'taxLines',
      'totalLocalFormatted',

      'entries',
      'attachments',
    ];
  };

  /**
   * Retrieve formatted credit note date.
   * @param {ICreditNote} credit
   * @returns {String}
   */
  protected formattedCreditNoteDate = (credit): string => {
    return this.formatDate(credit.creditNoteDate);
  };

  /**
   * Retrieve formatted created at date.
   * @param credit
   * @returns {string}
   */
  protected formattedCreatedAt = (credit): string => {
    return this.formatDate(credit.createdAt);
  };

  /**
   * Retrieve formatted invoice amount.
   * @param {ICreditNote} credit
   * @returns {string}
   */
  protected formattedAmount = (credit): string => {
    return this.formatNumber(credit.amount, {
      currencyCode: credit.currencyCode,
    });
  };

  /**
   * Retrieve formatted credits remaining.
   * @param {ICreditNote} credit
   * @returns {string}
   */
  protected formattedCreditsRemaining = (credit) => {
    return this.formatNumber(credit.creditsRemaining, {
      currencyCode: credit.currencyCode,
    });
  };

  /**
   * Retrieve formatted credits used.
   * @param {ICreditNote} credit
   * @returns {string}
   */
  protected formattedCreditsUsed = (credit) => {
    return this.formatNumber(credit.creditsUsed, {
      currencyCode: credit.currencyCode,
    });
  };

  /**
   * Retrieves the formatted subtotal.
   * @param {ICreditNote} credit
   * @returns {string}
   */
  protected formattedSubtotal = (credit): string => {
    return this.formatNumber(credit.amount);
  };

  /**
   * Retrieves formatted discount amount.
   * @param credit
   * @returns {string}
   */
  protected discountAmountFormatted = (credit): string => {
    return this.formatNumber(credit.discountAmount, {
      currencyCode: credit.currencyCode,
      excerptZero: true,
    });
  };

  /**
   * Retrieves the formatted discount amount in local currency.
   * @param {ICreditNote} credit
   * @returns {string}
   */
  protected discountAmountLocalFormatted = (credit): string => {
    return this.formatNumber(credit.discountAmountLocal, {
      currencyCode: credit.currencyCode,
      excerptZero: true,
    });
  };

  /**
   * Retrieves formatted discount percentage.
   * @returns {string}
   */
  protected discountPercentageFormatted = (credit): string => {
    return credit.discountPercentage ? `${credit.discountPercentage}%` : '';
  };

  /**
   * Retrieves formatted adjustment amount.
   * @returns {string}
   */
  protected adjustmentFormatted = (credit): string => {
    return this.formatNumber(credit.adjustment, {
      currencyCode: credit.currencyCode,
      excerptZero: true,
    });
  };

  /**
   * Retrieves the formatted adjustment amount in local currency.
   * @param {ICreditNote} credit
   * @returns {string}
   */
  protected adjustmentLocalFormatted = (credit): string => {
    return this.formatNumber(credit.adjustmentLocal, {
      currencyCode: this.context.organization.baseCurrency,
      excerptZero: true,
    });
  };

  /**
   * Retrieves the formatted total.
   * @param credit
   * @returns {string}
   */
  protected totalFormatted = (credit): string => {
    return this.formatNumber(credit.total, {
      currencyCode: credit.currencyCode,
      money: true,
    });
  };

  /**
   * Retrieves the formatted total in local currency.
   * @param credit
   * @returns {string}
   */
  protected totalLocalFormatted = (credit): string => {
    return this.formatNumber(credit.totalLocal, {
      currencyCode: credit.currencyCode,
      money: true,
    });
  };

  /**
   * Retrieves the entries of the credit note.
   * @param {ICreditNote} credit
   * @returns {}
   */
  protected entries = (credit) => {
    return this.item(credit.entries, new ItemEntryTransformer(), {
      currencyCode: credit.currencyCode,
    });
  };

  /**
   * Retrieves the credit note attachments.
   * @param {ISaleInvoice} invoice
   * @returns
   */
  protected attachments = (creditNote) => {
    return this.item(creditNote.attachments, new AttachmentTransformer());
  };

  /**
   * Subtotal excluding VAT, formatted (103 DiTech).
   */
  protected subtotalExcludingTaxFormatted = (credit: any): string => {
    return this.formatNumber(credit.subtotalExcludingTax, {
      currencyCode: credit.currencyCode,
    });
  };

  /**
   * VAT, formatted (103 DiTech).
   */
  protected taxAmountWithheldFormatted = (credit: any): string => {
    return this.formatNumber(Number(credit.taxAmountWithheld) || 0, {
      currencyCode: credit.currencyCode,
    });
  };

  /**
   * Specific/Accommodation Tax + PLT, formatted (103 DiTech).
   */
  protected exciseAmountFormatted = (credit: any): string => {
    return this.formatNumber(Number(credit.exciseAmount) || 0, {
      currencyCode: credit.currencyCode,
    });
  };

  /**
   * The taxes as lines, excise then VAT by rate (103 DiTech).
   */
  protected taxLines = (credit: any) => {
    return documentTaxLines(credit.entries ?? []).map((line) => ({
      ...line,
      amountFormatted: this.formatNumber(line.amount, {
        currencyCode: credit.currencyCode,
      }),
    }));
  };
}
