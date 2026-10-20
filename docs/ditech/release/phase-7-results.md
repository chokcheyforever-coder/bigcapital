# Phase 7 (release): results

Date: 2026-10-21. Acceptance (design §8): load test, security review, migration
up/down on a copy of staging data, user guide (EN/KM), deployment checklist;
all green on staging, rollback rehearsed.

## Load test

`.github/workflows/ditech-load.yml` → `packages/server/test/load/budget-load.mjs`
(run 39515729853, commit fe2adc718, GitHub runner: 2 vCPU, 7 GB, MariaDB 10.6).
A 10,000-line operating-expense budget (100 accounts × 100 projects × 12 months)
saved through the API, on a company with 1,000,000 ledger rows (500,000
balanced journal pairs over 2026). Median of 3 runs for the reads.

| Step | Seconds | Limit |
|---|---:|---:|
| Save 5,000 lines (1st / 2nd half) | 10.33 / 11.17 | 60 |
| Open budget version (10k lines) | 3.30 | 10 |
| Budget vs Actual (year) | 8.93 | 20 |
| Budget vs Actual (by month) | 18.32 | 20 |
| Budget by Project | 8.89 | 20 |
| Budget Exceptions | 8.45 | 20 |
| Profit & Loss (year) | 1.87 | 20 |
| Budget dashboard | 15.37 | 30 |
| Export version to Excel | 1.29 | 30 |

Found and fixed: the default 100 kB JSON limit refused saves over about 250
lines (now 10 MB, `main.ts`). Watch: Budget vs Actual by month is closest to
its limit; it reads the ledger once per report and groups 10k lines × 12
months in memory. If budgets this large appear in practice, cache the ledger
aggregation per request.

## Migration rehearsal

`infra/cells/pooled/scripts/rehearse-migrations.sh` (control-plane repo) on the
staging server, from backup `/srv/backups/stg1/20261020-090049` (104
databases, 103 companies, taken before the price levels deploy), in a
throwaway MariaDB: down to `20261015999999` (all DiTech migrations) → up →
down → up, table checksums compared.

```
PASS  down is repeatable (F3 == F1)
PASS  up is repeatable (F4 == F2)
PASS  tables DiTech does not touch are unchanged in F1 … F4
PASS  no DiTech tables left after down (0 found)
REHEARSAL PASSED
```

8,446 tables restored; 7,210 after down; 8,755 after up (the price level
tables added). About 2 minutes per direction for 103 companies.

## Security review

`security-review.md`: 3 fixes (xlsx CVEs, CSV formula injection, safe
migrations down), 1 test added, 1 low risk accepted, 1 limit raised.

## Documents

- `deployment-checklist.md`: deploy, smoke tests, rollback (A: images, B:
  `tenants:migrate:down`, never `tenants:migrate:rollback`), rehearsal.
- `../user-guide/en.md`, `../user-guide/km.md`: Projects, Budgets, Price levels.
  The Khmer text needs a native speaker's review before customers see it.

## Open before production

- Owner approval for the production deploy.
- Native Khmer review of the user guide.
- Clean up staging test companies (pool1 at 102 / 150).
