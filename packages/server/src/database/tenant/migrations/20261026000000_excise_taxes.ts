/**
 * Cambodian taxes charged before VAT on sales lines: Specific Tax,
 * Accommodation Tax and Public Lighting Tax (DiTech part C1, shared
 * pdf-templates ExciseTax.ts).
 *
 * Additive only: the company's codes, the codes assigned to items, the rates
 * a line was charged at (kept on the line so later rate changes do not alter
 * issued invoices) and the invoice's total of these taxes.
 */
const EXCISE_ENTRY_COLUMNS = ['specific_tax', 'plt'];

exports.up = async (knex) => {
  await knex.schema.createTable('excise_tax_codes', (table) => {
    table.increments('id');
    table.string('kind', 16).notNullable(); // specific | accommodation | plt
    table.string('code', 20).notNullable().unique();
    table.string('name', 120).notNullable();
    table.string('name_km', 120).nullable();
    table.decimal('rate', 8, 4).notNullable();
    table.decimal('base_percent', 7, 4).notNullable().defaultTo(100);
    table.integer('account_id').unsigned().nullable();
    table.boolean('active').notNullable().defaultTo(true);
    table.timestamps();
  });
  await knex.schema.table('items', (table) => {
    table.integer('specific_tax_code_id').unsigned().nullable();
    table.integer('plt_code_id').unsigned().nullable();
  });
  await knex.schema.table('items_entries', (table) => {
    for (const prefix of EXCISE_ENTRY_COLUMNS) {
      table.integer(`${prefix}_code_id`).unsigned().nullable();
      table.decimal(`${prefix}_rate`, 8, 4).nullable();
      table.decimal(`${prefix}_base`, 7, 4).nullable();
    }
  });
  await knex.schema.table('sales_invoices', (table) => {
    table.decimal('excise_amount', 13, 3).notNullable().defaultTo(0);
  });
};

exports.down = async (knex) => {
  await knex.schema.table('sales_invoices', (table) => {
    table.dropColumn('excise_amount');
  });
  await knex.schema.table('items_entries', (table) => {
    for (const prefix of EXCISE_ENTRY_COLUMNS) {
      table.dropColumn(`${prefix}_code_id`);
      table.dropColumn(`${prefix}_rate`);
      table.dropColumn(`${prefix}_base`);
    }
  });
  await knex.schema.table('items', (table) => {
    table.dropColumn('specific_tax_code_id');
    table.dropColumn('plt_code_id');
  });
  await knex.schema.dropTable('excise_tax_codes');
};
