import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { ServiceError } from '@/modules/Items/ServiceError';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { PriceLevel } from '../models/PriceLevel.model';
import { ERRORS, PriceLevelType } from '../PriceLevels.types';

@Injectable()
export class PriceLevelValidator {
  constructor(
    @Inject(PriceLevel.name)
    private readonly priceLevelModel: TenantModelProxy<typeof PriceLevel>,
  ) {}

  async getOrThrow(id: number, trx?: Knex.Transaction): Promise<PriceLevel> {
    const level = await this.priceLevelModel().query(trx).findById(id);
    if (!level) {
      throw new ServiceError(ERRORS.PRICE_LEVEL_NOT_FOUND, 'The price level was not found.', null, 404);
    }
    return level;
  }

  /**
   * A customer, vendor or document may only take an existing level of the
   * right type (sales for customers and sales documents, purchase for vendors
   * and purchase documents) that is active. Keeping the level a record already
   * has is always allowed, so deactivating a level never blocks editing.
   */
  async validateUse(
    priceLevelId: number | null | undefined,
    type: PriceLevelType,
    currentId: number | null | undefined,
    trx?: Knex.Transaction,
  ) {
    if (!priceLevelId) return;
    const level = await this.priceLevelModel().query(trx).findById(priceLevelId);
    if (!level) {
      throw new ServiceError(ERRORS.PRICE_LEVEL_NOT_FOUND, 'The price level was not found.', { priceLevelId });
    }
    if (level.type !== type) {
      throw new ServiceError(
        ERRORS.PRICE_LEVEL_WRONG_TYPE,
        type === 'sales' ? 'Use a sales price level here.' : 'Use a purchase price level here.',
        { priceLevelId },
      );
    }
    if (!level.active && priceLevelId !== currentId) {
      throw new ServiceError(ERRORS.PRICE_LEVEL_INACTIVE, 'The price level is inactive.', { priceLevelId });
    }
  }
}
