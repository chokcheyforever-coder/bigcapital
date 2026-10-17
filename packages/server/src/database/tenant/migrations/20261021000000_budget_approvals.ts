/**
 * Budget approvals (DiTech, docs/ditech/budgeting/phase-1-design.md §12).
 *
 * New tables only, plus the submission counter on our own `budget_versions`.
 * Rules pick the approval steps by the version's gross amount; each submission
 * gets one row per step, so earlier submissions keep their decisions.
 */
exports.up = (knex) => {
  return knex.schema
    .createTable('budget_approval_rules', (table) => {
      table.increments('id');
      table.decimal('min_amount', 13, 3).notNullable().defaultTo(0);
      table.decimal('max_amount', 13, 3).nullable();
      table.text('steps').notNullable(); // JSON: [{ order, roleId, label }]
      table.boolean('prevent_self_approval').notNullable().defaultTo(true);
      table.timestamps();
    })
    .createTable('budget_approval_steps', (table) => {
      table.increments('id');
      table.integer('version_id').unsigned().notNullable().references('id').inTable('budget_versions').onDelete('CASCADE');
      table.integer('submission_no').unsigned().notNullable();
      table.integer('step_order').unsigned().notNullable();
      table.string('label', 80).notNullable();
      table.integer('role_id').unsigned().nullable();
      table.integer('assigned_user_id').unsigned().nullable();
      table.integer('delegated_from_user_id').unsigned().nullable();
      table.boolean('prevent_self_approval').notNullable().defaultTo(true);
      table.string('decision', 16).notNullable().defaultTo('pending').index();
      table.text('comment').nullable();
      table.integer('decided_by').unsigned().nullable();
      table.datetime('decided_at').nullable();
      table.timestamps();
      table.unique(['version_id', 'submission_no', 'step_order']);
    })
    .table('budget_versions', (table) => {
      table.integer('submission_no').unsigned().notNullable().defaultTo(0);
    });
};

exports.down = (knex) => {
  return knex.schema
    .table('budget_versions', (table) => {
      table.dropColumn('submission_no');
    })
    .dropTableIfExists('budget_approval_steps')
    .dropTableIfExists('budget_approval_rules');
};
