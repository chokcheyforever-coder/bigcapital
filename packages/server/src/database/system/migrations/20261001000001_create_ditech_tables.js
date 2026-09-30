/**
 * 103 DiTech: per-tenant policy pushed by the control plane (status, pinned
 * host, plan entitlements) and idempotency records for provisioning calls.
 */
exports.up = function (knex) {
  return knex.schema
    .createTable('ditech_policies', (table) => {
      table
        .bigInteger('tenant_id')
        .unsigned()
        .primary()
        .references('id')
        .inTable('tenants')
        .onDelete('CASCADE');
      table.string('company_ref', 40).notNullable();
      table.string('pinned_host', 255).notNullable();
      table.enum('status', ['active', 'read_only', 'suspended']).notNullable();
      table.json('entitlements').notNullable();
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    })
    .createTable('ditech_idempotency', (table) => {
      table.string('key', 64).primary();
      table
        .bigInteger('tenant_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('tenants')
        .onDelete('CASCADE');
      table.json('response').notNullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists('ditech_idempotency')
    .dropTableIfExists('ditech_policies');
};
