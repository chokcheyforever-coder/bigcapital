/**
 * Budget spending control (DiTech, docs/ditech/budgeting/phase-1-design.md §13).
 *
 * New tables only. Policies say how each budget reacts to over-spending
 * (a row with no budget is the company default); overrides are approvals to
 * post one document over its budget; control events record every threshold
 * reached; the single `budget_control_lock` row serializes checked documents.
 */
exports.up = async (knex) => {
  await knex.schema
    .createTable('budget_control_policies', (table) => {
      table.increments('id');
      table.integer('budget_id').unsigned().nullable().unique().references('id').inTable('budgets').onDelete('CASCADE');
      table.string('mode', 16).notNullable().defaultTo('off');
      table.text('thresholds').notNullable(); // JSON: [75, 90]
      table.string('period_basis', 8).notNullable().defaultTo('month');
      table.text('transaction_types').notNullable(); // JSON: ["bill", "expense", "manual_journal"]
      table.timestamps();
    })
    .createTable('budget_overrides', (table) => {
      table.increments('id');
      table.integer('budget_id').unsigned().notNullable().references('id').inTable('budgets').onDelete('CASCADE');
      table.integer('version_id').unsigned().notNullable();
      table.integer('line_id').unsigned().notNullable();
      table.integer('account_id').unsigned().notNullable();
      table.string('reference_type', 20).notNullable();
      table.integer('reference_id').unsigned().notNullable();
      table.date('period_from').notNullable();
      table.date('period_to').notNullable();
      table.decimal('amount', 13, 3).notNullable();
      table.text('reason').nullable();
      table.string('status', 16).notNullable().defaultTo('pending').index();
      table.integer('requested_by').unsigned().nullable();
      table.integer('decided_by').unsigned().nullable();
      table.datetime('decided_at').nullable();
      table.text('comment').nullable();
      table.timestamps();
      table.index(['reference_type', 'reference_id']);
    })
    .createTable('budget_control_events', (table) => {
      table.increments('id');
      table.integer('budget_id').unsigned().notNullable().references('id').inTable('budgets').onDelete('CASCADE');
      table.integer('version_id').unsigned().notNullable();
      table.integer('line_id').unsigned().notNullable();
      table.integer('account_id').unsigned().notNullable();
      table.string('reference_type', 20).notNullable();
      table.integer('reference_id').unsigned().notNullable();
      table.date('period_from').notNullable();
      table.date('period_to').notNullable();
      table.decimal('budget_amount', 13, 3).notNullable();
      table.decimal('used_before', 13, 3).notNullable();
      table.decimal('document_amount', 13, 3).notNullable();
      table.decimal('percent_after', 9, 2).nullable();
      table.string('level', 16).notNullable().index();
      table.string('mode', 16).notNullable();
      table.string('outcome', 16).notNullable();
      table.integer('created_by').unsigned().nullable();
      table.datetime('created_at').notNullable();
      table.index(['budget_id', 'created_at']);
    })
    .createTable('budget_control_lock', (table) => {
      table.integer('id').unsigned().primary();
    });
  await knex('budget_control_lock').insert({ id: 1 });
};

exports.down = (knex) => {
  return knex.schema
    .dropTableIfExists('budget_control_lock')
    .dropTableIfExists('budget_control_events')
    .dropTableIfExists('budget_overrides')
    .dropTableIfExists('budget_control_policies');
};
