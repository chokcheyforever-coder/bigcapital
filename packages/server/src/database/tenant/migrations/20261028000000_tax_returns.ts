/**
 * Monthly tax returns (DiTech part C3): the 1% prepayment of tax on income
 * posted for a month (one journal per month).
 */
exports.up = async (knex) => {
  await knex.schema.createTable('tax_prepayments', (table) => {
    table.increments('id');
    table.string('month', 7).notNullable().unique(); // YYYY-MM
    table.decimal('turnover', 15, 3).notNullable();
    table.decimal('rate', 8, 4).notNullable();
    table.decimal('amount', 15, 3).notNullable();
    table.integer('manual_journal_id').unsigned().nullable();
    table.timestamps();
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTable('tax_prepayments');
};
