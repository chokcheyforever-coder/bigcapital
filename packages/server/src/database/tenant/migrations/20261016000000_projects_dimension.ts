/**
 * Projects as an accounting dimension (DiTech).
 *
 * Additive only: the `projects` table and the `project_id` columns on the
 * ledger, invoices, bills, expense lines and journal lines exist since 2022;
 * this adds the project's code, description and start date, and a project on
 * the documents that never had one (receipts, credit notes, vendor credits).
 */
exports.up = (knex) => {
  return knex.schema
    .table('projects', (table) => {
      table.string('code', 40).nullable().unique();
      table.text('description').nullable();
      table.date('start_date').nullable();
    })
    .table('sales_receipts', (table) => {
      table.integer('project_id').unsigned().nullable().references('id').inTable('projects');
    })
    .table('credit_notes', (table) => {
      table.integer('project_id').unsigned().nullable().references('id').inTable('projects');
    })
    .table('vendor_credits', (table) => {
      table.integer('project_id').unsigned().nullable().references('id').inTable('projects');
    });
};

exports.down = (knex) => {
  return knex.schema
    .table('vendor_credits', (table) => {
      table.dropForeign(['project_id']);
      table.dropColumn('project_id');
    })
    .table('credit_notes', (table) => {
      table.dropForeign(['project_id']);
      table.dropColumn('project_id');
    })
    .table('sales_receipts', (table) => {
      table.dropForeign(['project_id']);
      table.dropColumn('project_id');
    })
    .table('projects', (table) => {
      table.dropUnique(['code']);
      table.dropColumn('code');
      table.dropColumn('description');
      table.dropColumn('start_date');
    });
};
