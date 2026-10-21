/**
 * Cambodia tax documents (DiTech, docs/ditech/compliance/cambodia-invoicing-design.md).
 *
 * Additive only: the company's tax profile (one row), the TIN and Khmer name
 * and address of customers and vendors, and on sales documents the document
 * type that was issued (VAT invoice / commercial invoice) with the riel rate
 * used for its KHR amounts.
 */
const DOCUMENT_TABLES = ['sales_invoices', 'sales_receipts', 'credit_notes'];

exports.up = async (knex) => {
  await knex.schema.createTable('tax_profile', (table) => {
    table.integer('id').unsigned().primary(); // always 1
    table.boolean('enabled').notNullable().defaultTo(false);
    table.string('tin', 40).nullable();
    table.string('taxpayer_size', 10).nullable(); // small | medium | large
    table.boolean('vat_registered').notNullable().defaultTo(false);
    table.string('company_name_km', 255).nullable();
    table.text('address_km').nullable();
    table.text('address_en').nullable();
    table.string('document_language', 6).notNullable().defaultTo('km_en'); // km_en | km | en
    table.string('rate_source', 12).notNullable().defaultTo('nbc_daily'); // nbc_daily | gdt_monthly
    table.text('gdt_rates').nullable(); // JSON [{ month: 'YYYY-MM', rate }]
    table.string('signatory_name', 120).nullable();
    table.string('signatory_title', 120).nullable();
    table.datetime('updated_at').nullable();
  });
  await knex.schema.table('contacts', (table) => {
    table.string('tax_number', 40).nullable();
    table.boolean('registered_taxpayer').notNullable().defaultTo(false);
    table.string('display_name_km', 255).nullable();
    table.text('billing_address_km').nullable();
  });
  for (const name of DOCUMENT_TABLES) {
    await knex.schema.table(name, (table) => {
      table.string('document_kind', 20).nullable(); // vat_invoice | commercial_invoice
      table.decimal('khr_rate', 15, 6).nullable();
      table.string('khr_rate_source', 12).nullable();
      table.date('khr_rate_date').nullable();
    });
  }
};

exports.down = async (knex) => {
  for (const name of DOCUMENT_TABLES) {
    await knex.schema.table(name, (table) => {
      table.dropColumn('document_kind');
      table.dropColumn('khr_rate');
      table.dropColumn('khr_rate_source');
      table.dropColumn('khr_rate_date');
    });
  }
  await knex.schema.table('contacts', (table) => {
    table.dropColumn('tax_number');
    table.dropColumn('registered_taxpayer');
    table.dropColumn('display_name_km');
    table.dropColumn('billing_address_km');
  });
  await knex.schema.dropTable('tax_profile');
};
