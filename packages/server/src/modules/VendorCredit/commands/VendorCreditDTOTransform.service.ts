import * as moment from 'moment';
import { omit } from 'lodash';
import * as R from 'ramda';
import * as composeAsync from 'async/compose';
import { ERRORS } from '../constants';
import { ItemsEntriesService } from '@/modules/Items/ItemsEntries.service';
import { BranchTransactionDTOTransformer } from '@/modules/Branches/integrations/BranchTransactionDTOTransform';
import { WarehouseTransactionDTOTransform } from '@/modules/Warehouses/Integrations/WarehouseTransactionDTOTransform';
import { VendorCredit } from '../models/VendorCredit';
import { DocumentTaxesService } from '@/modules/TaxCompliance/DocumentTaxes.service';
import { assocItemEntriesDefaultIndex } from '@/utils/associate-item-entries-index';
import { formatDateFields } from '@/utils/format-date-fields';
import { VendorCreditAutoIncrementService } from './VendorCreditAutoIncrement.service';
import { ServiceError } from '@/modules/Items/ServiceError';
import { Injectable } from '@nestjs/common';
import {
  CreateVendorCreditDto,
  EditVendorCreditDto,
  VendorCreditEntryDto,
} from '../dtos/VendorCredit.dto';

@Injectable()
export class VendorCreditDTOTransformService {
  /**
   * @param {ItemsEntriesService} itemsEntriesService - The items entries service.
   * @param {BranchTransactionDTOTransformer} branchDTOTransform - The branch transaction DTO transformer.
   * @param {WarehouseTransactionDTOTransform} warehouseDTOTransform - The warehouse transaction DTO transformer.
   * @param {VendorCreditAutoIncrementService} vendorCreditAutoIncrement - The vendor credit auto increment service.
   */
  constructor(
    private itemsEntriesService: ItemsEntriesService,
    private branchDTOTransform: BranchTransactionDTOTransformer,
    private warehouseDTOTransform: WarehouseTransactionDTOTransform,
    private vendorCreditAutoIncrement: VendorCreditAutoIncrementService,
    private documentTaxes: DocumentTaxesService,
  ) {}

  /**
   * Transforms the credit/edit vendor credit DTO to model.
   * @param {IVendorCreditCreateDTO | IVendorCreditEditDTO} vendorCreditDTO
   * @param {string} vendorCurrencyCode -
   * @param {IVendorCredit} oldVendorCredit -
   * @returns {VendorCredit}
   */
  public transformCreateEditDTOToModel = async (
    vendorCreditDTO: CreateVendorCreditDto | EditVendorCreditDto,
    vendorCurrencyCode: string,
    oldVendorCredit?: VendorCredit,
  ): Promise<VendorCredit> => {
    // Calculates the total amount of items entries.
    const amount = this.itemsEntriesService.getTotalItemsEntries(
      vendorCreditDTO.entries,
    );
    const initialEntries = R.compose(
      // Associate the default index to each item entry.
      assocItemEntriesDefaultIndex,

      // Associate the reference type to item entries.
      R.map((entry: VendorCreditEntryDto) => ({
        referenceType: 'VendorCredit',
        ...entry,
      })),
    )(vendorCreditDTO.entries);

    // 103 DiTech: VAT on the lines. The supplier's Specific Tax/PLT is part
    // of the cost (bills), so it comes with purchase excise.
    const entries = await this.documentTaxes.assocEntries(
      initialEntries,
      vendorCreditDTO.isInclusiveTax,
      { excise: false },
    );

    // Retreive the next vendor credit number.
    const autoNextNumber =
      await this.vendorCreditAutoIncrement.getNextCreditNumber();

    // Detarmines the credit note number.
    const vendorCreditNumber =
      vendorCreditDTO.vendorCreditNumber ||
      oldVendorCredit?.vendorCreditNumber ||
      autoNextNumber;

    const initialDTO = {
      ...formatDateFields(omit(vendorCreditDTO, ['open', 'attachments']), [
        'vendorCreditDate',
      ]),
      amount,
      currencyCode: vendorCurrencyCode,
      exchangeRate: vendorCreditDTO.exchangeRate || 1,
      isInclusiveTax: !!vendorCreditDTO.isInclusiveTax,
      ...this.documentTaxes.totals(entries),
      vendorCreditNumber,
      entries,
      ...(vendorCreditDTO.open &&
        !oldVendorCredit?.openedAt && {
          openedAt: moment().toMySqlDateTime(),
        }),
    };
    return composeAsync(
      this.branchDTOTransform.transformDTO<VendorCredit>,
      this.warehouseDTOTransform.transformDTO<VendorCredit>,
    )(initialDTO) as VendorCredit;
  };

  /**
   * Validate the credit note remaining amount.
   * @param {ICreditNote} creditNote
   * @param {number} amount
   */
  public validateCreditRemainingAmount = (
    vendorCredit: VendorCredit,
    amount: number,
  ) => {
    if (vendorCredit.creditsRemaining < amount) {
      throw new ServiceError(ERRORS.VENDOR_CREDIT_HAS_NO_REMAINING_AMOUNT);
    }
  };

  /**
   * Validates the new vendor credit amount is not smaller than the already
   * refunded and applied-to-bills amounts.
   * @param {VendorCredit} vendorCredit
   * @param {number} newAmount
   */
  public validateCreditAmountNotBelowUsed = (
    vendorCredit: VendorCredit,
    newAmount: number,
  ) => {
    const usedAmount =
      vendorCredit.refundedAmount + vendorCredit.invoicedAmount;

    if (newAmount < usedAmount) {
      throw new ServiceError(ERRORS.VENDOR_CREDIT_AMOUNT_SMALLER_THAN_USED);
    }
  };

  /**
   * What the credit can be used for, lines plus their taxes (103 DiTech).
   * @param {{ amount: number }} model - The transformed credit.
   * @returns {number}
   */
  public creditable = (model: any): number => this.documentTaxes.creditable(model);

}
