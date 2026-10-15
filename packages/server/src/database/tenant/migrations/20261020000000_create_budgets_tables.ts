/**
 * Budget planning core (DiTech, docs/ditech/budgeting/phase-1-design.md §4).
 *
 * New tables only. A budget has versions (original, revisions, forecasts,
 * scenarios); a version has one line per account × branch × project, and a
 * line stores one amount per month (quarters and years are computed).
 * `branch_key` / `project_key` are 0 when there is no branch/project, so the
 * unique index also holds for lines without them.
 */
exports.up = (knex) => {
  return knex.schema
    .createTable('budgets', (table) => {
      table.increments('id');
      table.string('reference', 40).notNullable().unique();
      table.string('name', 120).notNullable();
      table.string('type', 32).notNullable().index();
      table.integer('fiscal_year').notNullable().index();
      table.date('start_date').notNullable();
      table.date('end_date').notNullable();
      table.string('currency_code', 3).notNullable();
      table.integer('branch_id').unsigned().nullable().references('id').inTable('branches');
      table.integer('project_id').unsigned().nullable().references('id').inTable('projects');
      table.integer('owner_user_id').unsigned().nullable();
      table.text('description').nullable();
      table.text('notes').nullable();
      table.integer('active_version_id').unsigned().nullable();
      table.integer('created_by').unsigned().nullable();
      table.timestamps();
      table.datetime('deleted_at').nullable().index();
    })
    .createTable('budget_versions', (table) => {
      table.increments('id');
      table.integer('budget_id').unsigned().notNullable().references('id').inTable('budgets').onDelete('CASCADE');
      table.integer('version_no').notNullable();
      table.string('kind', 16).notNullable().defaultTo('original');
      table.string('scenario', 16).nullable();
      table.string('label', 120).nullable();
      table.integer('source_version_id').unsigned().nullable();
      table.text('revision_reason').nullable();
      table.string('status', 16).notNullable().defaultTo('draft').index();
      table.datetime('submitted_at').nullable();
      table.integer('submitted_by').unsigned().nullable();
      table.datetime('approved_at').nullable();
      table.integer('approved_by').unsigned().nullable();
      table.datetime('locked_at').nullable();
      table.integer('locked_by').unsigned().nullable();
      table.integer('lock_version').unsigned().notNullable().defaultTo(0);
      table.integer('created_by').unsigned().nullable();
      table.timestamps();
      table.unique(['budget_id', 'version_no']);
    })
    .createTable('budget_lines', (table) => {
      table.increments('id');
      table.integer('version_id').unsigned().notNullable().references('id').inTable('budget_versions').onDelete('CASCADE');
      table.integer('account_id').unsigned().notNullable().references('id').inTable('accounts');
      table.integer('branch_id').unsigned().nullable().references('id').inTable('branches');
      table.integer('project_id').unsigned().nullable().references('id').inTable('projects');
      table.integer('branch_key').unsigned().notNullable().defaultTo(0);
      table.integer('project_key').unsigned().notNullable().defaultTo(0);
      table.text('note').nullable();
      table.text('assumption').nullable();
      table.timestamps();
      table.unique(['version_id', 'account_id', 'branch_key', 'project_key']);
    })
    .createTable('budget_line_amounts', (table) => {
      table.integer('line_id').unsigned().notNullable().references('id').inTable('budget_lines').onDelete('CASCADE');
      table.date('month').notNullable();
      table.decimal('amount', 13, 3).notNullable();
      table.primary(['line_id', 'month']);
    });
};

exports.down = (knex) => {
  return knex.schema
    .dropTableIfExists('budget_line_amounts')
    .dropTableIfExists('budget_lines')
    .dropTableIfExists('budget_versions')
    .dropTableIfExists('budgets');
};
