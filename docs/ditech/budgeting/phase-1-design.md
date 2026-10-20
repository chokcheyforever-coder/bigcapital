# Budget Planning & Control: Phase 1 assessment and design

Status: **approved 2026-10-15** with the decisions in §10. Nothing is implemented yet.
Fork: `chokcheyforever-coder/bigcapital`, branch `ditech/main` (based on v0.25.42).

## 1. Repository assessment

| Area | What exists | Where |
|---|---|---|
| Stack | NestJS server (Knex migrations, Objection.js), React SPA (Vite, BlueprintJS, Redux, React Router v5), pnpm + Lerna | `AGENTS.md` |
| Tenancy | One MariaDB database per organization; system DB separate. Budgets live in the tenant DB, so company isolation is physical | `src/database/tenant/migrations` (104 migrations) |
| General ledger | `accounts_transactions`: `debit`/`credit` decimal(13,3) in **base currency**, `account_id`, `date`, `branch_id`, `project_id`, `currency_code`, `exchange_rate`, `reference_type/id` | `modules/Accounts/models/AccountTransaction.model.ts` |
| Posting rules | Only posted documents write ledger rows. Drafts never do; deleting, un-publishing or editing a document deletes/rewrites its rows (`LedgerStorage.service.ts`). There is no "void" row state to filter | `modules/Ledger` |
| P&L query | Sums `credit`/`debit` grouped by account, optionally by month (`groupByDateFormat`), date range and branches. **Accrual only**: `basis` is accepted but not used | `FinancialStatements/modules/ProfitLossSheet/ProfitLossSheetRepository.ts` |
| Account types | Each type has `normal` (debit/credit), `rootType`, `incomeSheet`/`balanceSheet`. P&L types: income, other-income (credit); cost-of-goods-sold, expense, other-expense (debit) | `src/constants/accounts.ts` |
| Dimensions | **Branch** only (feature `multi_branch`). `project_id` columns exist but there is **no Projects module** in server or webapp, so nothing ever sets them. No departments or locations in the ledger (warehouses are inventory only) | migrations `20220125…branch…`, `20220429…projects…` |
| Fiscal year | Organization setting `fiscalYear` = starting month | `Organization.types.ts` |
| Permissions | CASL abilities per subject with custom extra actions; `@RequirePermission(action, subject)` on controllers; roles editable in Preferences | `modules/Roles` |
| Audit | `audit_logs` (user, action, subject, subject_id, JSON metadata, ip) + `AuditLogService.record()` + viewer UI | `modules/AuditLogs` |
| Import/Export | Generic resource import (upload → mapping → preview → commit, transactional) and export registry (CSV/XLSX/PDF) | `modules/Import`, `modules/Export` |
| In-transaction hooks | Bills, expenses and manual journals emit `onCreating/onEditing/onPublishing` (bills also `onOpening`) **with the Knex `trx`**: a subscriber can lock rows and throw to block, atomically | `common/events/events.ts` |
| Commitments | **No purchase orders.** Unposted spending documents: draft bills (`opened_at` null) and draft expenses (`published_at` null) | `modules/Bills`, `modules/Expenses` |
| Plan gating (DiTech) | `FEATURE_ROUTES` blocks routes by plan feature before controllers run | `modules/DiTech/DiTech.types.ts` |
| Tests | Jest unit specs; server e2e suite (`packages/server/test`, 65 files) against real MariaDB with GL helpers (`test/_utils/gl.ts`). The `Server Tests` workflow runs on `main`/`develop` only, **not on `ditech/main`** | `.github/workflows/server-tests.yml` |
| Existing budgeting | **None** (one marketing string in `webapp/src/constants/subscriptionModels.tsx`) | |

## 2. Gap analysis

| Requirement (brief §) | Status | Plan / limitation |
|---|---|---|
| Budget header, multiple per year (§4) | New | `budgets` table. Company = the tenant. Currency = **base currency only**: actuals are stored in base currency. |
| Budget types (§4) | New | Release 1: **Profit & Loss, Revenue, Operating Expenses, Operational, CAPEX**. All are period *movements* on accounts, which the ledger gives exactly. CAPEX = debits to fixed-asset accounts (additions), disposals shown separately. **Balance Sheet** (period-end balances, opening balance included) and **Cash Flow** (movements on cash/bank accounts by direct method) come in Phase 6 with their own actual rules. |
| Dimensions (§4) | Partial | **Branch** (multi-branch plans) and **Project** (built first, Phase 1b). Departments and locations are not in the ledger, so not budgetable. |
| Planning grid (§5) | New | Store **monthly amounts only**; quarters and year are computed. Unique key (version, account, branch). |
| Allocation methods (§5) | New | Pure functions on the server (one implementation, tested), previewed in the grid before saving. |
| Prefill, Excel (§6) | New, reuses Import/Export | Import goes through the existing import pipeline (mapping, preview, transactional commit) plus budget-specific validation. |
| Versions and scenarios (§7) | New | `budget_versions`; approved and locked versions are read-only in the DB layer (service guard + check in every write path). |
| Approval workflow (§8) | New | Draft → Submitted → Under review → Approved → Locked; Rejected, Cancelled. Steps from rules by amount threshold, each step names a role. Self-approval blocked by default. Notifications by email through the existing mail module, plus in-app list. |
| GL integration (§9) | Reuse | Actuals use the **same query as the P&L** (`accounts_transactions`, same date and branch filters), so totals reconcile by construction. Drill-down reuses the General Ledger report filtered by account, period and branch. |
| Formulas (§10) | New | See §5 below. |
| Spending control (§11) | New | Subscribers on bill/expense/manual-journal creating, editing, publishing and opening events, in the document's transaction, with a row lock. |
| Commitments (§11) | Limited | No purchase orders. Commitments = **draft bills and draft expenses** that hit a budgeted account, computed live (not copied), so posting converts them to actuals with no double count. |
| Forecasting (§12) | New, Phase 6 | Forecast versions: actuals to date + remaining months from a method (run-rate, budget remainder, growth, seasonality). Headcount planning is out of scope (no payroll data). |
| Reports and dashboard (§13) | New | All 14 reports; the Project Budget Report needs Phase 1b. |
| Security (§14) | Reuse | New ability subject `Budget` with 10 actions; tenant DB gives company isolation; DiTech plan feature `budgeting`. |
| Reporting basis (§9) | Limitation | Accrual only, same as BigCapital's statements. |
| Foreign currency (§9) | Documented | Ledger amounts are base currency at the transaction's rate. Realized FX gains and losses are posted to their own accounts and appear as actuals there. Budgets are in base currency. |

## 3. Architecture

- **Server:** new module `packages/server/src/modules/Budgeting/`, with these parts: `models`, `commands`, `queries`, `subscribers` (spending control), `calc` (pure formula and allocation functions), `dtos` and controllers under `/api/budgets…`. It is self-contained to keep upstream merges easy. The only edits to core files are registering the module, the ability subject, the DiTech feature route, and the webapp menu and routes.
- **Actuals service:** `BudgetActualsService` runs one grouped query per report: `SUM(debit)`, `SUM(credit)` grouped by `account_id`, month and `branch_id`, filtered by date range. There are no per-account queries (N+1) and no GL rows go to the browser. Natural-side amount = `credit − debit` for credit-normal accounts, `debit − credit` for debit-normal accounts.
- **Webapp:** `packages/webapp/src/ditech/budgeting/` holds pages, the grid and reports. It reuses BlueprintJS, the `DataTable`/financial-report components and the existing ability checks for the menu. The grid is a virtualized editable table with keyboard navigation and clipboard paste (TSV).
- **No ledger writes.** Budgets and forecasts never create journal entries.

## 4. Database schema (tenant migrations, additive only)

All amounts are `decimal(13,3)`, like the ledger. All tables are new; no existing table changes.

```
budgets
  id, reference (unique), name, type, fiscal_year (int), start_date, end_date,
  currency_code, branch_id null, owner_user_id, description, notes,
  active_version_id null, created_by, created_at, updated_at, deleted_at null

budget_versions
  id, budget_id, version_no, kind (original|revision|forecast|scenario),
  scenario (base|best|worst|custom) null, label, source_version_id null,
  revision_reason, status (draft|submitted|under_review|approved|locked|rejected|cancelled),
  submitted_at/by, approved_at/by, locked_at/by, lock_version (optimistic concurrency),
  created_by, created_at, updated_at
  unique (budget_id, version_no)

budget_lines
  id, version_id, account_id, branch_id null, project_id null,
  branch_key / project_key (0 when null, for the unique index),
  note, assumption, created_at, updated_at
  unique (version_id, account_id, branch_key, project_key)

budget_line_amounts
  line_id, month (date, first of month), amount
  primary key (line_id, month)

budget_approval_rules        -- settings: which steps a budget needs, by total amount
  id, min_amount, max_amount null, steps (json: [{order, role_id, label}]), prevent_self_approval

budget_approval_steps        -- one row per step per submission
  id, version_id, submission_no, step_order, role_id, assigned_user_id null,
  delegated_from_user_id null, decision (pending|approved|rejected), comment, decided_by, decided_at

budget_control_policies
  id, budget_id null (null = default), mode (inform|warn_approve|block),
  thresholds (json: [{percent:70,level:"info"},…]), period_basis (month|ytd|year),
  transaction_types (json: ["bill","expense","manual_journal"])

budget_overrides             -- "warning plus approval" requests
  id, version_id, account_id, branch_key, reference_type, reference_id, amount,
  status (pending|approved|rejected), requested_by, decided_by, decided_at, comment

budget_spend_locks           -- one row per (version, account, branch_key); row-locked during checks
  version_id, account_id, branch_key, primary key (…)

forecast_assumptions (Phase 6)
  id, version_id, account_id null, kind (growth|inflation|seasonal|run_rate), value, months json
```

Audit history goes to the existing `audit_logs`, with subject `Budget` and old/new values in `metadata`.

**Rollback:** every migration has a `down` that drops only these new tables. No existing data is touched, so rolling back removes the budgeting data only. Run `backup.sh` before migrating, as for any upgrade.

## 5. Calculations (`calc/`, unit-tested against hand-made fixtures)

- Every account uses its natural side: `actual = Σ(credit − debit)` for credit-normal accounts and `Σ(debit − credit)` for debit-normal ones. Budgets are entered on the same natural side.
- Variance amount = Actual − Budget.
- Variance % = (Actual − Budget) / |Budget| × 100, and **n/a when Budget = 0**. It is never shown as ∞ or 0%.
- Utilization % = Actual / Budget × 100, for expense, cost-of-goods, other-expense and CAPEX lines. It is n/a when Budget = 0, and an actual against a zero budget is flagged "unbudgeted spend".
- Available = Budget − Actual − Open commitments.
- Projected year-end = Actual to date + forecast for the remaining months.
- **Favorable:** variance ≥ 0 for income accounts; variance ≤ 0 for expense, cost-of-goods and CAPEX accounts. A contra or negative-balance case follows the account's type and is shown with its sign, never flipped silently.
- **Rounding:** sums are taken in SQL decimal and rounded only for display. Allocations distribute the remainder to the last month, so the months always add up to the annual figure exactly.

## 6. Spending control

- **Trigger:** a subscriber on bill, expense and manual-journal `onCreating`, `onEditing`, `onPublishing` and `onOpening`. Draft documents are counted as commitments and not checked. A document is checked when it would post.
- **In the document's transaction:** `SELECT … FOR UPDATE` on `budget_spend_locks` for each affected (version, account, branch), in a fixed order to avoid deadlocks. Then compute available (Actual + commitments, excluding this document's own previous amounts on edit), then apply the policy:
  - `inform`: allow; warnings are returned with the response.
  - `warn_approve`: block until an approved `budget_override` exists for this document.
  - `block`: throw `BUDGET_EXCEEDED` (HTTP 400), which rolls back the document.
- Two users spending the last of a budget at the same time are serialized by the row lock; the second one sees the first one's posting.
- Only the **active approved/locked version** of each budget controls spending, and only the transaction types the policy lists.

## 7. API and permissions

Ability subject `Budget`, actions: `View`, `Create`, `EditDraft`, `Delete` (draft budgets; added in Phase 2), `Submit`, `Approve`, `Revise`, `Lock`, `ImportExport`, `ViewAudit`, `ConfigurePolicy`.

Monthly amounts are sent as a list, `amounts: [{ "month": "2027-01", "amount": 1250.5 }]`, not as an object keyed by month: the server camel-cases request keys, which would turn `2027-01` into `202701`. Responses use month keys (`"months": { "2027-01-01": 1250.5 }`).

| Endpoint | Ability |
|---|---|
| `GET /api/budgets`, `GET /api/budgets/:id`, `GET /api/budgets/:id/versions/:v` | View |
| `POST /api/budgets` | Create |
| `PUT /api/budgets/:id` (header), `DELETE /api/budgets/:id` (draft budgets only, soft delete) | EditDraft / Delete |
| `PUT /api/budgets/:id/versions/:v/lines` (bulk upsert, `lock_version` required), `POST /api/budgets/:id/allocate` (preview only), `POST …/prefill` (Phase 3) | EditDraft |
| `POST …/versions/:v/submit` | Submit |
| `POST …/versions/:v/approve`, `…/reject`, `…/delegate` | Approve (and the step's role) |
| `POST /api/budgets/:id/revisions`, `…/scenarios` | Revise |
| `POST …/versions/:v/lock`, `…/unlock` | Lock |
| `GET …/export`, `POST /api/budgets/import…` (existing import flow) | ImportExport |
| `GET /api/budgets/reports/:report` (budget vs actual, variance, …) with drill-down to `/api/reports/general-ledger` | View |
| `GET /api/budgets/:id/audit` | ViewAudit |
| `GET/PUT /api/budgets/settings/policies`, `…/approval-rules` | ConfigurePolicy |

Each controller uses `@RequirePermission`. The DiTech guard blocks `/api/budgets` unless the plan has `budgeting`.

## 8a. Phase 1b: Projects as an accounting dimension

Upstream history: the Express server had a Projects service (projects, tasks,
time entries, billable expenses). It was not carried into the NestJS rewrite
(`55fcc908e`, 2025-04-07), and the webapp UI was removed upstream on 2026-09-02
(`c8804e075`, PR #1328). What survives: the `projects` table, `project_id` on
`accounts_transactions`, `manual_journals_entries`, `expense_transaction_categories`
and `items_entries`, `projectId` in the ledger entry builder (`Ledger/utils.ts`)
and in the expense, item-entry and manual-journal DTOs.

Scope (no tasks, time tracking or project billing):

- `modules/Projects`: list, create, edit, archive and delete (refused once the project is used). Fields: name, code, customer (optional), status, dates, description. Ability subject `Project` already exists.
- A project field on lines of invoices, receipts, credit notes, bills, vendor credits, expenses and manual journals, validated server-side (it must exist and be active).
- GL builders pass the line's project to its ledger rows: revenue/expense legs carry the project, while AR/AP/cash legs do not.
- Report filter: P&L, General Ledger and Trial Balance accept `projectsIds`, the same way as branches.
- Webapp: Projects list/detail pages, a project picker column in the entry tables, a project filter in those reports.
- Plan gate: feature `projects` (Business and above), like `multi_branch`.
- Accepted when e2e posts documents with projects, the P&L filtered by project equals the sum of those lines, and documents without a project are unchanged (existing regression suite green).

## 8. Phases and acceptance criteria

Each phase merges to `ditech/main` only when its tests pass in CI and it has been checked on staging. Production deployment needs your approval.

| Phase | Scope | Accepted when |
|---|---|---|
| **2. Core** | Migrations, models, CRUD, lines bulk upsert, monthly/quarterly/annual totals, allocations, permissions, audit, plan gate, CI runs server e2e on `ditech/main` | e2e: create/edit, duplicate line refused, totals exact, allocation sums exact, other company's IDs return 404, each permission enforced |
| **3. Editor and data** | Grid (keyboard, paste, bulk, search, groups, notes), prefill (prior actuals, prior budget, version, growth %), Excel/CSV template, import with preview and error report, export | Playwright: build a 12-month budget from paste; import with bad rows shows errors and saves nothing; prefill equals the P&L for last year |
| **4. Budget vs actual** | Actuals service, budget vs actual, monthly variance, branch report, revenue achievement, expense utilization, CAPEX, exception report, drill-down, CSV/XLSX export | e2e posts real invoices, bills, expenses and journals (plus a deleted and an unpublished one) and checks budget-vs-actual actuals = P&L report totals, month by month and by branch |
| **5. Control** | Approval workflow and rules, versions, revisions, immutability, original vs revised, approval status report, audit history, spending policies, commitments, overrides | Approved version cannot be changed by any API; self-approval refused; block mode refuses an over-budget bill; two concurrent bills for the last $100 → exactly one succeeds; draft → posted bill counted once |
| **6. Forecast and dashboard** | Forecast versions and scenarios, rolling 12 months, forecast vs budget, Balance Sheet and Cash Flow types, dashboard KPIs, email notifications | Forecast formulas match documented fixtures; dashboard numbers equal the report totals |
| **7. Release** | Load test (10k lines, 1M ledger rows), security review, migration up/down on a copy of staging data, user guide (EN/KM), deployment checklist | All above green on staging; rollback rehearsed |

**Rough size:** Phases 2 to 4 are the usable core, about 3 to 4 weeks of focused work. Phases 5 to 7 are about the same again.

## 9. Licence

The fork is AGPL-3.0 and public. The portal footer already links to our modified source. New files carry no extra licence; the module is published with the fork. Upstream contributions are optional and need Bigcapital's CLA if we ever offer them.

## 10. Decisions (2026-10-15)

1. **Dimensions:** Branch, plus Project. Projects are built first, as an accounting dimension (§8a).
2. **Commitments:** draft bills and draft expenses on budgeted accounts, computed live.
3. **Release 1 types:** P&L, Revenue, OpEx, Operational, CAPEX. Balance Sheet and Cash Flow come in Phase 6.
4. **Plans:** `budgeting` (and `projects`) on Business and above. Starter shows them locked with "Upgrade plan".

## 11. Phase 4 decisions (budget vs actual, 2026-10-16)

- **Endpoints:** `GET /api/budgets/reports/:report?budgetId=…` and `…/:report/export?format=xlsx|csv`, reports `budget-vs-actual`, `monthly-variance`, `branch`, `project`, `revenue-achievement`, `expense-utilization`, `capex`, `exceptions`. Permission: Budget `View` (reading a report, including its export). Query: `versionNo` (default: active version, else latest approved/locked, else latest), `fromMonth`/`toMonth` (inside the budget period), `branchesIds`, `projectsIds`, `columns` (`total`/`quarter`/`month`), `thresholdPercent` (exceptions, default 10), `nearPercent` (utilization, default 90), `includeUnbudgeted` (default true).
- **Each ledger amount counts once.** Actuals are grouped by account, month, branch and project in one query, then given to the *most specific* budget line of the account that matches (branch + project > branch > project > neither). Amounts no line matches form an **unbudgeted** row per account. With unbudgeted rows included, report actuals equal the P&L for the same period and branches (e2e `budgets-actuals.e2e-spec.ts`, by year, by month and by branch).
- **Branch and project reports:** budget by the line's branch/project (or the budget's); actuals by the branch/project they were **posted** to. A company-wide line's actuals appear under the branches that spent them, without a budget there.
- **Branch/project filter:** keeps lines of that branch/project (or company-wide lines only when the budget itself is for it). Spending of the branch on accounts budgeted only company-wide shows as unbudgeted; the page says so.
- **CAPEX:** actual = debits to the asset accounts (additions); credits are reported as **disposals**, not netted. The CAPEX report needs a CAPEX budget (`BUDGET_REPORT_NOT_FOR_TYPE`).
- **Percentages** round to 2 decimals and are `null` (shown "n/a") when the budget is 0. Utilization status: `over` (actual > budget), `near` (≥ `nearPercent`), `on_track`, `unbudgeted`, `no_activity`.
- **Drill-down** gives General Ledger filters (`fromDate`, `toDate`, `accountsIds`, `branchesIds`, `projectsIds`). `exact: false` when the GL view also includes rows that belong to another line of the account (the GL has no "not these branches" filter) or rows without a branch/project.
- **Commitments** (draft bills/expenses) are not in Phase 4 reports; "Available = Budget − Actual − Commitments" comes with Phase 5.
- Ledger fact noted while testing: a manual journal's branch is taken from **each entry**, not the journal header.

## 12. Phase 5a decisions (approval workflow and versions, 2026-10-17)

- **Statuses:** draft → `submit` → submitted → (first step approved) under_review → (last step approved) approved → `lock` → locked. `unlock` returns locked to approved (still read-only). `reject` (comment required) → rejected, which is editable and can be resubmitted; `withdraw` takes a version in review back to draft; `cancel` ends a draft or rejected revision or scenario (the original cannot be cancelled: delete the budget instead). Only draft and rejected versions accept line changes, import or deletion of the budget.
- **Rules** (`PUT /api/budgets/settings/approval-rules`, Budget `ConfigurePolicy`) pick 1–5 ordered steps by the version's **gross amount** (sum of every monthly amount, sign ignored), on ranges `[min, max)` that must not overlap. Each step names a role or, when empty, anyone with Budget `Approve`. The predefined admin role may decide any step. Rules apply to later submissions; each submission stores its own steps (`budget_approval_steps.submission_no`), so earlier decisions stay in the history.
- **No rule matching** → one step, anyone with `Approve`, self-approval refused. A one-person company adds a rule with "prevent self-approval" off.
- **Prevent self-approval** (default on, per rule): the submitter cannot approve or reject, and one person cannot approve two steps of the same submission.
- **Delegation:** whoever can decide the current step can hand it to one active user whose role has Budget `Approve`; then only that user (or an admin) decides it.
- **Active version:** approving a version makes it the budget's active version (reports and, in Phase 5b, spending control use it). The previous one keeps its status.
- **Revisions** (`POST /api/budgets/:id/revisions`, reason required) copy an approved/locked version or a scenario into a new draft; one revision in progress at a time, and only after something has been approved. **Scenarios** (`…/scenarios`, base/best/worst/custom) copy any version into a what-if draft that is never submitted; to adopt one, revise from it.
- **Reports:** `GET /api/budgets/approvals` is the approval status report (waiting step, days waiting, gross amount; `mine=true` = what I can decide now). `GET /api/budgets/:id/compare` compares two versions line by line (default original vs active). `GET /api/budgets/:id/audit` (Budget `ViewAudit`) lists the budget's audit history.
- Approvals are in-app only for now; email notifications come with Phase 6.
- Tests: rule and step logic in `workflow/approval.spec.ts` (roles and delegates, since the e2e tenant has one user); `test/budgets-workflow.e2e-spec.ts` covers self-approval, multi-step approval, every write refused on an approved version, revisions, scenarios, compare and audit.

## 13. Phase 5b decisions (spending control, 2026-10-17)

- **Policies** (`PUT /api/budgets/settings/policies`, Budget `ConfigurePolicy`): one company default (no budget) and optional per-budget policies that replace it. `mode` = `off` | `inform` | `warn_approve` | `block`; `thresholds` (1–5 percentages, default 75 and 90); `periodBasis` = `month` | `ytd` | `year`; `transactionTypes` ⊆ bill, expense, manual_journal. With no policy, or `off`, nothing is checked.
- **What is controlled:** documents that post (open bills, published expenses and manual journals), against the **active version** of each budget when that version is approved or locked, for document months inside the budget period and inside the budget's own branch/project. Each ledger leg goes to the most specific matching line (§11), so control and reports agree. Accounts without a line in the budget are not controlled (unbudgeted spend shows in the reports). A document that lowers spending on a line is never refused.
- **Amounts** come from the document's own GL builder (`BillGLEntries.getBillLedger`, extracted from `writeBillGLEntries` with the same behavior; `ExpenseGLEntriesService`; `ManualJournalGL`), so control sees exactly what posts. CAPEX counts debits only, as in the reports.
- **Used before the document** = actuals (ledger, this document's own rows left out, so an edit never counts its old amounts) + open commitments (draft bills and draft expenses in the period, built the same way, the document itself left out). A draft that is posted therefore counts once.
- **Concurrency:** the design's per-line `budget_spend_locks` is replaced by one row, `budget_control_lock`, taken `FOR UPDATE` on the document's "-ing" event when any policy is on. The affected lines are not known before the ledger is built, and the lock has to be taken before any ledger row is written to avoid deadlocks; small companies post few documents at once, so serializing checked documents per company costs little. The actuals read is a locking read (`LOCK IN SHARE MODE`), which sees documents committed after the transaction's snapshot. Two bills for the last amount: exactly one passes (e2e).
- **Outcomes** when a line is exceeded: `block` → `BUDGET_EXCEEDED` (400, the document rolls back; payload lists budget, available, document amount and excess); `warn_approve` → `BUDGET_APPROVAL_REQUIRED` unless an **approved override** for this document and line covers the excess; `inform` → allowed. Every level reached (info, warning, exceeded) by a posted document is recorded in `budget_control_events` (`GET /api/budgets/alerts`).
- **Overrides:** save the document as a draft, then `POST /api/budgets/overrides` (any user with Budget `View`); the server computes the excess per line and creates pending requests (replacing older pending ones for that document). Approving or rejecting needs Budget `Approve`; self-approval follows the approval rule for the override amount (§12).
- **Availability:** `GET /api/budgets/:id/availability?month=&basis=` gives budget, actual, open commitments and available (= budget − actual − commitments) per line of the active version.
- Not in 5b: a pre-save check endpoint for the forms (the webapp shows the error and availability instead), purchase orders, and email notifications (Phase 6). If a company's plan loses `budgeting`, existing policies keep working until removed.

## 14. Phase 5c (webapp, 2026-10-17)

- **Budget editor:** a workflow bar under the header shows the approval steps (or the rejection reason, or who approved and whether the version is active) with Submit / Approve / Reject, and a **Version** menu: delegate, withdraw, lock/unlock, new revision, new scenario, cancel version, compare versions, available to spend, spending control (per-budget policy), approval history and audit history.
- **Budgets › Approvals** (`/budgets/approvals`): Waiting for me, Approval status (in review or every submitted version), Override requests (request one for a draft document; approve/reject) and Alerts.
- **Budgets › Settings** (`/budgets/settings`): approval rules editor and the company default spending policy.
- Spending control refusals from bills, expenses and manual journals are shown once for every form by the shared API error handler (`useApiFetcherOnError` → `ditech/budgeting/controlErrors.tsx`), with a link to the override requests or the budget's report.
- Playwright: `e2e/budgets-workflow.spec.ts` (two-step approval, approvals list, revision, comparison, availability).

## 15. Phase 6 decisions (forecasts, balance sheet and cash flow, dashboard, notifications, 2026-10-19)

**Forecasts**

- A forecast is a version of kind `forecast` (`POST /api/budgets/:id/forecasts`, Budget `Revise`). It starts from a base version (default: the active one, else the latest approved, else the latest plan) and stores how it was made: method, as-of month, run-rate window, growth and base version (`budget_versions.forecast_*`).
- Every line keeps the **posted actuals up to the as-of month** (matched to lines exactly as in the reports, §11). The months after it come from one method (`calc/forecast.ts`):
  - `budget`: the base version's amount for that month (budget remainder);
  - `run_rate`: the average of the last *n* actual months (default 3; months without activity count as 0), every month;
  - `growth`: the same month a year earlier × (1 + growth %);
  - `seasonal`: run rate × remaining months, spread like the same months a year earlier (evenly when those are all zero or mix signs); the remainder goes to the last month, so the total is exact.
- Accounts with actuals but no line get their own forecast line (unbudgeted spend is forecast too). Forecasts are **never submitted, approved or active** and never control spending; to adopt one, create a revision from it. A draft forecast can be edited in the grid, or refreshed (`POST …/versions/:v/forecast/refresh`, Budget `EditDraft`, `lockVersion` required), which recomputes and **replaces** its amounts with current actuals.
- The as-of month defaults to last month and must lie between the month before the period and its last month. Balance sheet budgets have no forecasts (`BUDGET_NOT_FOR_TYPE`).
- **Forecast vs budget** (`GET /api/budgets/:id/forecast-vs-budget`): per line, budget for the whole period, *live* actuals to the as-of month, the forecast of the months after it, projected = actual + forecast (design §5), variance and favorable as in §5. **Rolling forecast** (`GET …/rolling-forecast`): the 12 months after the as-of month from actuals only (run rate, growth or seasonal), across budget years; budget amounts are shown for months inside this budget's period.
- Reports never fall back to a forecast or cancelled version when no version is chosen.

**Fixture** (`calc/forecast.spec.ts`, and the same numbers posted for real in `test/budgets-forecast.e2e-spec.ts`): budget 110 a month; last year's actuals 100 a month except December 200; this year's actuals January 120, February 90, March 150; as of March; 2-decimal currency.

| Method | April–November | December | Year |
|---|---|---|---|
| Budget remainder | 110 | 110 | 1,350 |
| Run rate (3 months) | 120 | 120 | 1,440 |
| Growth +10 % | 110 | 220 | 1,460 |
| Seasonal | 108 | 216 | 1,440 |

Forecast vs budget for that line (run rate): budget 1,320, actual to date 360, forecast ahead 1,080, projected 1,440, variance +120 (unfavorable for an expense).

**Balance sheet and cash flow budgets**

- **Balance sheet** (`balance_sheet`): asset, liability and equity accounts; each amount is the planned **month-end balance**. Actual = everything posted up to the end of the month (opening balance included), on the account's natural side, so it equals the Balance Sheet report. A quarter, the year and version totals show the **last month** (closing), never a sum; approval rules size a balance sheet version by its closing balances. Prefill from actuals copies last year's month-end balances.
- **Cash flow** (`cash_flow`): cash and bank accounts; each amount is the planned **net movement** (money in − money out) of the month. Reports add inflows (debits) and outflows (credits), and a **cash position**: opening cash (all cash and bank accounts before the period) and closing cash per column, actual and budgeted (actual opening + budgeted movements).
- Favorable: more assets, equity and cash is favorable; more liabilities is not. Neither type has a net income line, utilization status or spending control (`BUDGET_NOT_FOR_TYPE` on a policy). Reports offered for them: budget vs actual, monthly variance, branch, project and exceptions.

**Dashboard** (`GET /api/budgets/dashboard?budgetId=&asOfMonth=`, Budget `View`)

- One budget at a time (default: the latest with an active version) and a year-to-date month (default: last month, inside the period). Every figure is taken from the reports: budget vs actual for the whole period by month and for the year to date, exceptions to date, and forecast vs budget of the latest forecast. So the dashboard equals the reports by construction (e2e compares them).
- KPIs: revenue achievement, expense utilization (to date and of the year) and remaining budget, net income (P&L-style budgets); totals by account group (every type); cash position (cash flow); lines over, near the limit, unbudgeted and exceptions. Also budget/actual by month with a running total, the five largest variances, the year-end projection, and workflow counts (waiting for me, override requests, alerts in 30 days, unread notifications).

**Notifications**

- Written in the **same transaction** as the change they report (`budget_notifications`), so a refused or rolled-back change notifies nobody; they form the in-app list (`GET /api/budgets/notifications`, `POST …/notifications/read`, Budgets › Approvals › Notifications) and a BullMQ job (`budget-notifications`, 5 s delay) emails the pending ones, claiming each row before sending. Links use the company's own 103 DiTech host.
- Who hears what: a version waiting on a step → whoever can decide it (its delegate; else the users of its role, or admins when nobody holds it; else everyone who can approve), minus the submitter and earlier approvers when self-approval is prevented; final approval or rejection → submitter and budget owner; delegation → the delegate; override request → approvers (minus the requester when the rule for that amount prevents self-approval); override decision → requester; spending alert → the budget owner, **the first time** a line reaches the level in a period. The person who made the change is never notified about it.
- Company settings (`GET/PUT /api/budgets/settings/notifications`, Budget `ConfigurePolicy` to change): email on/off (default on) and alert level `off` / `exceeded` (default) / `warning`.
- Without SMTP, emails fail and the rows say so (`failed`); the in-app list is unaffected. A crash between claiming and sending leaves a row in `sending`.

## 16. Phase 7 (release), 2026-10-21

Results in `docs/ditech/release/phase-7-results.md`: load test within limits, rollback rehearsed on a copy of staging data, security review (`release/security-review.md`), deployment checklist (`release/deployment-checklist.md`), user guide EN/KM (`user-guide/`).
