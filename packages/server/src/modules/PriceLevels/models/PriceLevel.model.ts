import { Model } from 'objection';
import { BaseModel } from '@/models/Model';

/**
 * A price level: a named set of sales or purchase prices for some customers or
 * vendors, either a percentage on the normal item price or fixed per-item
 * prices with quantity breaks.
 */
export class PriceLevel extends BaseModel {
  name!: string;
  description!: string | null;
  type!: string;
  method!: string;
  percentage!: number | string | null;
  currencyCode!: string | null;
  rounding!: string;
  validFrom!: Date | string | null;
  validTo!: Date | string | null;
  active!: boolean;
  createdAt!: Date;
  updatedAt!: Date;

  items?: Array<import('./PriceLevelItem.model').PriceLevelItem>;

  static get tableName() {
    return 'price_levels';
  }

  get timestamps() {
    return ['createdAt', 'updatedAt'];
  }

  static get modifiers() {
    return {
      search(query, term: string) {
        query.where('name', 'like', `%${term}%`);
      },
    };
  }

  static get relationMappings() {
    const { PriceLevelItem } = require('./PriceLevelItem.model');

    return {
      items: {
        relation: Model.HasManyRelation,
        modelClass: PriceLevelItem,
        join: { from: 'price_levels.id', to: 'price_level_items.priceLevelId' },
      },
    };
  }
}
