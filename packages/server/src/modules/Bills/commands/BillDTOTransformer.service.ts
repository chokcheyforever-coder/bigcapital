import { Inject, Injectable } from '@nestjs/common';
import { omit, sumBy } from 'lodash';
import * as moment from 'moment';
import * as R from 'ramda';
import * as composeAsync from 'async/compose';
import { formatDateFields } from '@/utils/format-date-fields';
import { BranchTransactionDTOTransformer } from '@/modules/Branches/integrations/BranchTransactionDTOTransform';
import { WarehouseTransactionDTOTransform } from '@/modules/Warehouses/Integrations/WarehouseTransactionDTOTransform';
import { ItemEntry } from '@/modules/TransactionItemEntry/models/ItemEntry';
import { Item } from '@/modules/Items/models/Item';
import { Vendor } from '@/modules/Vendors/models/Vendor';
import { ItemEntriesTaxTransactions } from '@/modules/TaxRates/ItemEntriesTaxTransactions.service';
import { Bill } from '../models/Bill';
import { assocItemEntriesDefaultIndex } from '@/utils/associate-item-entries-index';
import { TenancyContext } from '@/modules/Tenancy/TenancyContext.service';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { CreateBillDto } from '../dtos/Bill.dto';
import { WithholdingTaxService } from '@/modules/TaxCompliance/WithholdingTax.service';

@Injectable()
export class BillDTOTransformer {
  constructor(
    private branchDTOTransform: BranchTransactionDTOTransformer,
    private warehouseDTOTransform: WarehouseTransactionDTOTransform,
    private taxDTOTransformer: ItemEntriesTaxTransactions,
    private tenancyContext: TenancyContext,
    private withholdingTax: WithholdingTaxService,

    @Inject(ItemEntry.name)
    private itemEntryModel: TenantModelProxy<typeof ItemEntry>,

    @Inject(Item.name) private itemModel: TenantModelProxy<typeof Item>,
  ) {}

  /**
   * Retrieve the bill entries total.
   * @param {IItemEntry[]} entries
   * @returns {number}
   */
  private getBillEntriesTotal(entries: ItemEntry[]): number {
    return sumBy(entries, (e) => this.itemEntryModel().calcAmount(e));
  }

  /**
   * Converts create bill DTO to model.
   * @param {IBillDTO} billDTO
   * @param {IBill} oldBill
   * @returns {IBill}
   */
  public async billDTOToModel(
    billDTO: CreateBillDto,
    vendor: Vendor,
    oldBill?: Bill,
  ): Promise<Bill> {
    const amount = sumBy(billDTO.entries, (e) =>
      this.itemEntryModel().calcAmount(e),
    );

    // Retrieve the authorized user.
    const authorizedUser = await this.tenancyContext.getSystemUser();

    // Bill number from DTO or frprom auto-increment.
    const billNumber = billDTO.billNumber || oldBill?.billNumber;

    const initialEntries = billDTO.entries.map((entry) => ({
      referenceType: 'Bill',
      isInclusiveTax: billDTO.isInclusiveTax,
      ...omit(entry, ['amount']),
    }));
    const asyncEntries = await composeAsync(
      // Associate tax rate from tax id to entries.
      this.taxDTOTransformer.assocTaxRateFromTaxIdToEntries,
      // Associate tax rate id from tax code to entries.
      this.taxDTOTransformer.assocTaxRateIdFromCodeToEntries,
      // Sets the default cost account to the bill entries.
      this.setBillEntriesDefaultAccounts(),
    )(initialEntries);

    const entries = R.compose(
      // Remove tax code from entries.
      R.map(R.omit(['taxCode'])),
      // Associate the default index to each item entry line.
      assocItemEntriesDefaultIndex,
    )(asyncEntries);

    const initialDTO = {
      ...formatDateFields(omit(billDTO, ['open', 'entries', 'attachments']), [
        'billDate',
        'dueDate',
      ]),
      amount,
      landedCostAmount: 0,
      currencyCode: vendor.currencyCode,
      exchangeRate: billDTO.exchangeRate || 1,
      billNumber,
      entries,
      // Avoid rewrite the open date in edit mode when already opened.
      ...(billDTO.open &&
        !oldBill?.openedAt && {
          openedAt: moment().toMySqlDateTime(),
        }),
      userId: authorizedUser.id,
    };

    const asyncDto = await composeAsync(
      this.branchDTOTransform.transformDTO<Bill>,
      this.warehouseDTOTransform.transformDTO<Bill>,
    )(initialDTO);

    const model = R.compose(
      // Associates tax amount withheld to the model.
      this.taxDTOTransformer.assocTaxAmountWithheldFromEntries,
    )(asyncDto) as Bill;

    // 103 DiTech: withholding tax on the amount excluding VAT, after the
    // discount. An edit that does not send a code keeps the bill's code.
    const requestedWht =
      billDTO.whtCodeId !== undefined
        ? billDTO.whtCodeId
        : oldBill
          ? (oldBill.whtCodeId ?? null)
          : undefined;
    const draft = Bill.fromJson({ ...model, entries: [] } as any);
    const whtBase = Math.max(
      (Number(draft.subtotalExcludingTax) || 0) -
        (Number(draft.discountAmount) || 0),
      0,
    );
    return Object.assign(
      model,
      await this.withholdingTax.resolve(requestedWht, vendor.id, whtBase),
    );
  }

  /**
   * Sets the default cost account to the bill entries.
   */
  private setBillEntriesDefaultAccounts() {
    return async (entries: ItemEntry[]) => {
      const entriesItemsIds = entries.map((e) => e.itemId);
      const items = await this.itemModel()
        .query()
        .whereIn('id', entriesItemsIds);

      return entries.map((entry) => {
        const item = items.find((i) => i.id === entry.itemId);

        return {
          ...entry,
          ...(item.type !== 'inventory' && {
            costAccountId: entry.costAccountId || item.costAccountId,
          }),
        };
      });
    };
  }
}
