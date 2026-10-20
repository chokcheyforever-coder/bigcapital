import { BaseModel } from '@/models/Model';

/** A fixed price for one item in a per-item price level; minQuantity above 1 is a quantity break. */
export class PriceLevelItem extends BaseModel {
  priceLevelId!: number;
  itemId!: number;
  minQuantity!: number | string;
  price!: number | string;

  static get tableName() {
    return 'price_level_items';
  }
}
