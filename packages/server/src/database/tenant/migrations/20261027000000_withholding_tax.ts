/**
 * Withholding tax on bills and expenses (DiTech part C2).
 *
 * Additive only: the company's WHT codes, a vendor's usual code, and on bills
 * and expenses the code, rate and amount withheld (kept on the document so
 * later rate changes do not alter it).
 */
const WHT_DOCUMENT_TABLES = ['bills', 'expenses_transactions'];

exports.up = async (knex) => {
  await knex.schema.createTable('wht_codes', (table) => {
    table.increments('id');
    table.string('code', 20).notNullable().unique();
    table.string('name', 120).notNullable();
    table.string('name_km', 120).nullable();
    table.string('payment_type', 20).notNullable(); // service | rent | interest | royalty | non_resident | other
    table.decimal('rate', 8, 4).notNullable();
    table.integer('account_id').unsigned().nullable();
    table.boolean('active').notNullable().defaultTo(true);
    table.timestamps();
  });
  await knex.schema.table('contacts', (table) => {
    table.integer('default_wht_code_id').unsigned().nullable();
  });
  for (const name of WHT_DOCUMENT_TABLES) {
    await knex.schema.table(name, (table) => {
      table.integer('wht_code_id').unsigned().nullable();
      table.decimal('wht_rate', 8, 4).nullable();
      table.decimal('wht_amount', 13, 3).notNullable().defaultTo(0);
    });
  }
};

exports.down = async (knex) => {
  for (const name of WHT_DOCUMENT_TABLES) {
    await knex.schema.table(name, (table) => {
      table.dropColumn('wht_code_id');
      table.dropColumn('wht_rate');
      table.dropColumn('wht_amount');
    });
  }
  await knex.schema.table('contacts', (table) => {
    table.dropColumn('default_wht_code_id');
  });
  await knex.schema.dropTable('wht_codes');
};
