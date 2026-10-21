# Deployment checklist: BigCapital fork (cell) + control plane

For every release of `ditech/main` to a cell (staging first, then production).
Production needs explicit approval from the owner before step 1.
Paths are on the server, under `/srv/ditech/infra`.

## 0. Before the day

- [ ] PR merged into `ditech/main`; CI green: TypeCheck, Server Tests, E2E,
      and for releases that touch budgets or ledgers, **DiTech load test**.
- [ ] `DiTech images` workflow green for the merge commit (images
      `bigcapital-server` / `bigcapital-webapp` tags `ditech-main` and `sha-<7>`).
- [ ] Note the new tenant migrations (`packages/server/src/database/tenant/migrations`)
      and the **last migration timestamp before them** (the rollback target).
- [ ] For a release with migrations: rehearsal passed on a copy of the target's
      latest backup (step 8, "Rehearsal").
- [ ] Control plane: new plan features (`apps/api/src/plans/entitlements.ts`) and
      their labels pushed to `master`, CI green.
- [ ] Users told about the window if the release has migrations (a few minutes;
      requests during the migration can fail and are retried by users).

## 1. Backup (always)

```bash
cd /srv/ditech/infra/cells/pooled && bash scripts/backup.sh /srv/backups
cd /srv/ditech/infra/control-plane && COMPOSE_FILE=docker-compose.yml:docker-compose.staging.yml bash scripts/backup.sh /srv/backups
```

- [ ] Both print the backup folder; the cell one lists every company database
      (`databases dumped: N`, N = companies + system). Write the folder down.

## 2. Pin the images (production)

- [ ] In `cells/pooled/.env`, set `BIGCAPITAL_SERVER_IMAGE` / `BIGCAPITAL_WEBAPP_IMAGE`
      to the `sha-<7>` tags of the merge commit (staging may follow `ditech-main`).
      Keep the previous tags in the change log: they are the rollback images.

## 3. Cell: pull, restart, migrate

```bash
cd /srv/ditech/infra/cells/pooled
C="-f docker-compose.yml"            # staging adds: -f docker-compose.dev.yml
docker compose $C pull server webapp
docker compose $C up -d server webapp
./scripts/migrate.sh                 # system + every tenant; ends "All tenants are migrated."
./scripts/migrate.sh | tail -1       # second run: nothing left to do
```

- [ ] `docker ps`: both server replicas `healthy`, webapp up.
- [ ] Image revision label = merge commit:
      `docker inspect <server container> --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'`
- [ ] No errors in `docker logs --since 10m <server container>`.

## 4. Control plane

```bash
cd /srv/ditech/infra/control-plane && export COMPOSE_FILE=docker-compose.yml:docker-compose.staging.yml
docker compose pull api admin portal && docker compose run --rm api npx prisma migrate deploy && docker compose up -d api admin portal
```

- [ ] `api` healthy. New plan features: in **Admin › Plans**, tick the feature
      on the plans that include it and save with **Apply to existing subscriptions**.
- [ ] **Admin › Cells**: the cell has room (`companies / max` below the max),
      or new companies fail with "no pooled cell has capacity".

## 5. Smoke tests (from a workstation, see infra/README.md)

- [ ] `infra/tests/accounting.mjs`: "all accounting checks passed".
- [ ] `infra/tests/isolation.mjs`: "all checks passed", provisioning under 2 minutes.
- [ ] One real company: sign in, open the changed screens (for budgets/price
      levels: Budgets › Dashboard, an invoice with a price level).

## 6. Done

- [ ] Change log: date, merge commit, image tags, backup folders, migrations, results.

## 7. Rollback

Decide within the window. Two levels:

**A. Code only, no migration in the release** (or the migrations are fine):
put the previous image tags back in `.env`, `docker compose $C up -d server webapp`.

**B. The release's migrations must go:**

```bash
cd /srv/ditech/infra/cells/pooled
docker compose $C stop server webapp                       # no writes meanwhile
docker compose $C run --rm migrate node dist/cli.js tenants:migrate:down --to <last timestamp before the release> --dry_run
docker compose $C run --rm migrate node dist/cli.js tenants:migrate:down --to <last timestamp before the release>
# previous image tags in .env, then:
docker compose $C up -d server webapp
```

- Run `tenants:migrate:down` with the **new** image (it has the new migrations'
  `down` code), then switch to the old images.
- **Never use `tenants:migrate:rollback`** here: it undoes the last batch, which
  for companies created after a migration is their whole schema.
- Data written into the tables or columns the migrations removed is gone after
  `down`. If that data matters, restore the company databases from step 1
  instead (`scripts/restore-tenant.sh`, one company at a time, or all).
- Images built before `tenants:migrate:down` existed: use
  `scripts/migrations-down.cjs` (same logic) mounted into the image, as
  `scripts/rehearse-migrations.sh` does.

## 8. Rehearsal (before a release with migrations)

```bash
cd /srv/ditech/infra/cells/pooled
./scripts/rehearse-migrations.sh /srv/backups/<cell>/<latest> <new server image> <last timestamp before the release>
```

Restores the backup into a throwaway MariaDB (own network, nothing live
touched), runs down → up → down → up, and compares checksums of every table.
Passes when both directions work on every company, repeat runs give identical
tables, and the tables no migration touches are unchanged throughout. It takes
about 10–15 minutes for 100 companies on the staging server.
