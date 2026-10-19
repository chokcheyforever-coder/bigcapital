/**
 * Budget forecasts and notifications (DiTech, docs/ditech/budgeting/phase-1-design.md §15).
 *
 * Additive only. A forecast version remembers how it was made (method, as-of
 * month, parameters) so it can be refreshed. Notifications are written in the
 * same transaction as the change they report and sent by email afterwards;
 * they double as the in-app list. `budget_settings` holds small company-wide
 * settings as key/value JSON (email notifications on/off, alert level).
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('budget_versions', (table) => {
    table.string('forecast_method', 16).nullable();
    table.date('forecast_as_of').nullable();
    table.text('forecast_params').nullable(); // JSON: { runRateMonths, growthPercent, baseVersionNo }
  });
  await knex.schema
    .createTable('budget_notifications', (table) => {
      table.increments('id');
      table.integer('budget_id').unsigned().nullable().references('id').inTable('budgets').onDelete('CASCADE');
      table.string('kind', 32).notNullable();
      table.integer('user_id').unsigned().notNullable(); // system user id of the recipient
      table.string('email', 255).nullable();
      table.string('subject', 255).notNullable();
      table.text('body').notNullable();
      table.string('link', 255).nullable();
      table.string('status', 16).notNullable().defaultTo('pending').index(); // pending | sent | failed | skipped
      table.text('error').nullable();
      table.datetime('sent_at').nullable();
      table.datetime('read_at').nullable();
      table.datetime('created_at').notNullable();
      table.index(['user_id', 'read_at']);
    })
    .createTable('budget_settings', (table) => {
      table.string('key', 64).primary();
      table.text('value').notNullable();
      table.datetime('updated_at').notNullable();
    });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('budget_settings').dropTableIfExists('budget_notifications');
  await knex.schema.alterTable('budget_versions', (table) => {
    table.dropColumn('forecast_method');
    table.dropColumn('forecast_as_of');
    table.dropColumn('forecast_params');
  });
};
