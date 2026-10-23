/**
 * VAT, Specific/Accommodation Tax and PLT on credit notes and vendor credits
 * (DiTech compliance gaps G2), as invoices and bills carry them: a credit
 * reverses the taxes of the sale or purchase it corrects.
 *
 * Additive only: existing credits keep no tax (exclusive, zero amounts).
 */
const CREDIT_TAX_TABLES = ['credit_notes', 'vendor_credits'];

exports.up = async (knex) => {
  for (const name of CREDIT_TAX_TABLES) {
    await knex.schema.table(name, (table) => {
      table.boolean('is_inclusive_tax').notNullable().defaultTo(false);
      table.decimal('tax_amount_withheld', 13, 2).notNullable().defaultTo(0);
      table.decimal('excise_amount', 13, 3).notNullable().defaultTo(0);
    });
  }
};

exports.down = async (knex) => {
  for (const name of CREDIT_TAX_TABLES) {
    await knex.schema.table(name, (table) => {
      table.dropColumn('is_inclusive_tax');
      table.dropColumn('tax_amount_withheld');
      table.dropColumn('excise_amount');
    });
  }
};
