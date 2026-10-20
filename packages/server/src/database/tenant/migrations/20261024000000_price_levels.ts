/**
 * Price levels (DiTech, design docs/ditech/pricing/price-levels-design.md).
 *
 * Additive only: new tables, plus nullable columns for a contact's default
 * price level, the price level of a sales/purchase document, and each document
 * line's normal price at the time it was saved (for "discount given" reports).
 */
const DOCUMENT_TABLES = ['sales_estimates', 'sales_invoices', 'sales_receipts', 'credit_notes', 'bills', 'vendor_credits'];

exports.up = async (knex) => {
  await knex.schema.createTable('price_levels', (table) => {
    table.increments('id');
    table.string('name', 120).notNullable().unique();
    table.text('description').nullable();
    table.string('type', 10).notNullable(); // sales | purchase
    table.string('method', 12).notNullable(); // percentage | per_item
    table.decimal('percentage', 9, 4).nullable(); // +markup / -markdown
    table.string('currency_code', 3).nullable(); // null = base currency
    table.string('rounding', 6).notNullable().defaultTo('none');
    table.date('valid_from').nullable();
    table.date('valid_to').nullable();
    table.boolean('active').notNullable().defaultTo(true);
    table.timestamps();
  });
  await knex.schema.createTable('price_level_items', (table) => {
    table.increments('id');
    table.integer('price_level_id').unsigned().notNullable().references('id').inTable('price_levels').onDelete('CASCADE');
    table.integer('item_id').unsigned().notNullable().references('id').inTable('items').onDelete('CASCADE');
    table.decimal('min_quantity', 13, 3).notNullable().defaultTo(1);
    table.decimal('price', 13, 3).notNullable();
    table.unique(['price_level_id', 'item_id', 'min_quantity']);
  });
  await knex.schema.createTable('price_level_categories', (table) => {
    table.integer('price_level_id').unsigned().notNullable().references('id').inTable('price_levels').onDelete('CASCADE');
    table.integer('category_id').unsigned().notNullable().references('id').inTable('items_categories').onDelete('CASCADE');
    table.primary(['price_level_id', 'category_id']);
  });
  await knex.schema.table('contacts', (table) => {
    table.integer('price_level_id').unsigned().nullable().references('id').inTable('price_levels');
  });
  for (const name of DOCUMENT_TABLES) {
    await knex.schema.table(name, (table) => {
      table.integer('price_level_id').unsigned().nullable().references('id').inTable('price_levels');
    });
  }
  await knex.schema.table('items_entries', (table) => {
    table.decimal('standard_rate', 15, 5).nullable();
  });
};

exports.down = async (knex) => {
  await knex.schema.table('items_entries', (table) => {
    table.dropColumn('standard_rate');
  });
  for (const name of [...DOCUMENT_TABLES, 'contacts']) {
    await knex.schema.table(name, (table) => {
      table.dropForeign(['price_level_id']);
      table.dropColumn('price_level_id');
    });
  }
  await knex.schema.dropTable('price_level_categories');
  await knex.schema.dropTable('price_level_items');
  await knex.schema.dropTable('price_levels');
};
