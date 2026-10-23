import { Injectable } from '@nestjs/common';
import { sumBy } from 'lodash';
import { ItemEntriesTaxTransactions } from '@/modules/TaxRates/ItemEntriesTaxTransactions.service';
import { ItemEntry } from '@/modules/TransactionItemEntry/models/ItemEntry';
import { ExciseTaxService } from './ExciseTax.service';

/**
 * VAT and Specific/Accommodation Tax + PLT on documents that upstream
 * BigCapital keeps without tax (DiTech compliance gaps G2/G3): the same
 * steps the invoice DTO transformer runs, for credit notes, vendor credits
 * and sales receipts.
 */
@Injectable()
export class DocumentTaxesService {
  constructor(
    private readonly taxTransactions: ItemEntriesTaxTransactions,
    private readonly exciseTax: ExciseTaxService,
  ) {}

  /**
   * Each line's VAT rate (from its tax rate id or code) and, with `excise`,
   * its Specific/Accommodation Tax and PLT codes and rates.
   */
  async assocEntries<T extends { itemId?: number }>(entries: T[], isInclusiveTax?: boolean, { excise = true } = {}): Promise<T[]> {
    const withExcise = excise ? await this.exciseTax.assocExciseToEntries(entries, isInclusiveTax) : entries;
    const withIds = await this.taxTransactions.assocTaxRateIdFromCodeToEntries(withExcise);
    const withRates = await this.taxTransactions.assocTaxRateFromTaxIdToEntries(withIds);
    return withRates.map(({ taxCode, ...entry }: any) => ({ ...entry, isInclusiveTax: !!isInclusiveTax }));
  }

  /** The document's VAT and excise totals from its lines. */
  totals(entries: any[]): { taxAmountWithheld: number; exciseAmount: number } {
    const lines = entries.map((entry) => ItemEntry.fromJson(entry));
    return {
      taxAmountWithheld: sumBy(lines, (line) => line.taxAmount || 0),
      exciseAmount: sumBy(lines, (line) => line.exciseAmount || 0),
    };
  }

  /** Lines plus the taxes added on top of them: what a credit can be used for. */
  creditable(model: { amount: number; isInclusiveTax?: boolean; taxAmountWithheld?: number; exciseAmount?: number }): number {
    const vat = model.isInclusiveTax ? 0 : Number(model.taxAmountWithheld) || 0;
    return (Number(model.amount) || 0) + vat + (Number(model.exciseAmount) || 0);
  }
}
