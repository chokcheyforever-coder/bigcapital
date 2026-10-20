# Security review: DiTech modules (Phase 7)

Date: 2026-10-21. Scope: the code DiTech added to the BigCapital fork
(`modules/DiTech`, `Projects`, `Budgeting`, `PriceLevels`, the tenant migrations
`20261016…20261024`, `src/ditech` in the webapp) and the dependencies it relies
on. Upstream BigCapital code was only looked at where DiTech code calls it.

## Method

- Every controller route: guard and permission metadata (unit specs, below).
- Every raw SQL string: where each interpolated value comes from.
- Every upload, export and e-mail: size, type and content handling.
- Tenant isolation: DiTech gateway guard, SSO, service API (covered end to end
  by `infra/tests/isolation.mjs` in the control-plane repo, passing on staging).
- Dependencies used on untrusted input (spreadsheet parsing).

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | High | `xlsx` 0.18.5 (last version on npm) parses uploaded files in budget import, price level import and upstream Import. Known issues: prototype pollution from a crafted file (CVE-2023-30533, fixed 0.19.3) and ReDoS (CVE-2024-22363, fixed 0.20.2). | **Fixed**: `xlsx` 0.20.3 from the SheetJS CDN tarball (`packages/server/package.json`). |
| 2 | Medium | CSV exports (budget versions, budget reports, price levels) wrote user text as is: a name such as `=HYPERLINK(...)` runs as a formula when the file is opened in a spreadsheet (CSV/formula injection). | **Fixed**: `csvSafe` prefixes text starting with `= + - @ TAB CR` with an apostrophe; imports remove it again (`csvUnsafe`), so an exported file imports unchanged. XLSX exports keep text cells as text. Unit spec in `BudgetSheet.spec.ts`. |
| 3 | Medium | `tenants:migrate:rollback` (upstream) undoes the last migration batch. For a company created after a migration was added, its first batch holds its whole schema, so a rollback after a bad deploy could drop every table of the newest companies. | **Fixed**: new `tenants:migrate:down --to <timestamp>` undoes only migrations newer than the target, newest first. The deployment checklist uses it; rehearsed on a copy of staging data. |
| 4 | Low | The Projects controller had no permission spec (Budgeting and Price levels have one). Permissions were correct, but nothing would catch a route added without one. | **Fixed**: `Projects.controller.spec.ts`. |
| 5 | Low | `POST /price-levels/resolve` needs only a signed-in user: someone without access to bills could ask for a purchase level's cost prices. | **Accepted**: anyone who can open a bill or invoice form already sees these prices; the endpoint only answers for levels and items of the same company. Revisit with the "override price" permission. |
| 6 | Info | Raw SQL in DiTech code interpolates only constants (table and column names chosen in code) and a database name passed through `sanitizeDatabaseName`; every user value is a bound parameter. | No change. |
| 7 | Info | SSO tokens: 256-bit random, single use (`GETDEL`), 60 s lifetime. Service API: bearer token compared in constant time. | No change. |
| 8 | Info | Uploads: 2 MB limit, one file, `.csv/.xlsx/.xls` only, parsed in memory, all rows validated before anything is saved. | No change. |
| 9 | Info | Budget e-mails: message text and link are HTML-escaped (`escapeHtml`, unit spec). The webapp's DiTech screens render no raw HTML. | No change. |
| 10 | Info | Every DiTech route sits behind `AuthorizationGuard` + `PermissionGuard` with a declared permission (controller specs for Budgeting, Projects, Price levels); the plan gate (`FEATURE_ROUTES`) blocks the routes of features a plan does not include, checked on staging. | No change. |

## Out of scope, noted

- The upstream `Prettier` and `ESLint` CI checks have failed since the fork's
  first PR on DiTech files; they are style checks, not security checks.
- Upstream BigCapital modules were not reviewed line by line; they are tracked
  through upstream releases.
