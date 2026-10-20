# 103 DiTech Cloud Accounting: Projects, Budgets and Price levels

User guide for the features 103 DiTech added. They are part of the Business,
Professional and Enterprise plans; on other plans the menu shows them with a
🔒 and an **Upgrade plan** button. What each user may do is set in
**Preferences › Users › Roles** (permissions "Projects", "Budgets", "Price levels").

---

## 1. Projects

A project tags income and expenses so you can see profit and loss per project
(a client job, a branch opening, a campaign).

1. **Financial › Projects › New project**: name, optional code (shown in
   pickers), customer, start and end dates.
2. On an **invoice, receipt, credit note, bill or vendor credit**, choose the
   project in the bar above the form (**Project: …**). On **expenses and manual
   journals**, choose it on each line.
3. **Reports › Profit & Loss** (also General Ledger, Trial Balance): filter by
   one or more projects. In the project list, **Profit & loss for this project**
   opens the report already filtered.
4. A finished project: **Close project**. Closed projects take no new
   transactions but keep their history. A project used by transactions cannot
   be deleted.

---

## 2. Budgets

### 2.1 Create and fill a budget

1. **Financial › Budgets › New budget**: name, type (Profit & Loss, Revenue,
   Operating expenses, Operational, CAPEX, Balance sheet, Cash flow), fiscal
   year, optional branch or project.
2. The planning grid shows one row per account (optionally per branch and
   project) and one column per month. Type amounts, or paste from Excel.
   Quarter and year totals update as you type.
3. To fill quickly:
   - **Prefill › From actuals**: last year's real figures (optionally + growth %).
   - **Prefill › From another budget**.
   - **Allocate** a yearly amount: equally, by percentages, seasonally, or with growth.
   - **Import**: download the template (Excel or CSV), fill it, upload. The
     preview shows each row; nothing is saved unless every row is valid.
4. **Save**. If someone else saved the same budget meanwhile, you are told and
   can reload; nothing is overwritten silently.

### 2.2 Approval, versions and locking

1. **Submit** sends the budget through the approval steps set in
   **Budgets › Settings › Approval rules** (e.g. finance manager, then director,
   depending on the amount). Approvers see it under **Budgets › Approvals**
   and can **Approve**, **Reject** (with a reason) or **Delegate**.
2. An approved budget is read-only. **Revise** creates a new version (v2, v3 …);
   **Compare** shows two versions side by side. **Scenarios** hold best/worst
   case copies that are never approved.
3. **Lock** freezes a budget completely (only users with the Lock permission).
4. **History** lists every change: who, when, what.

### 2.3 Spending control

In **Budgets › Settings › Spending control**, choose (as the company default,
or per budget) what happens when a bill, expense or journal would go over the
budget:

| Mode | Effect |
|---|---|
| Off | Nothing is checked |
| Inform | Saved; a warning is shown and the alert levels (e.g. 75%, 90%) notify the budget owner |
| Warn and approve | Not saved until an **override** for this document is approved; the user requests it from the message |
| Block | Not saved |

Draft bills and expenses already count as committed spending. Overrides are
approved under **Budgets › Approvals**.

### 2.4 Forecasts, reports and dashboard

- **Version › New forecast**: actuals up to a month, then a forecast for the
  rest of the year (budget remainder, run rate, growth or seasonal).
  **Forecast vs budget** and **Rolling 12-month forecast** open from the same menu.
- **Budgets › Reports**: Budget vs Actual, Monthly Variance, Budget by Branch,
  Budget by Project, Revenue Achievement, Expense Utilization, CAPEX, Exceptions.
  Each can be exported to Excel or CSV. Balance sheet budgets show month-end
  balances; cash flow budgets show money in, money out and the cash position.
- **Budgets › Dashboard**: the key figures, the monthly chart, the largest
  variances and the year-end projection. Its numbers are the reports' numbers.
- **Notifications**: approvals, rejections, overrides and spending alerts appear
  under **Budgets › Approvals › Notifications** and by e-mail.

---

## 3. Price levels

A price level gives some customers (or vendors) other prices than the normal
item prices: wholesale −15%, a VIP price list, a November promotion, cheaper
prices from 10 units.

### 3.1 Create a price level

**Items › Price levels › New price level**

- **For**: Sales (customers) or Purchases (vendors).
- **Prices**:
  - **Percentage of the normal price**: decrease or increase by a percent,
    for all items or only some item categories, with rounding (nearest 0.05,
    nearest whole amount, ends in .99 …).
  - **Fixed price per item**: a price per item. Add the same item again with a
    higher **From qty** for a quantity break (e.g. 1+ at 10, 10+ at 8).
    Items not listed keep their normal price.
- **Valid from / to** (optional): for promotions; outside the dates the normal
  prices apply.

Per-item prices can also be kept in Excel: **⋯ › Export prices (Excel)**, edit,
**⋯ › Import prices…** (replaces the level's prices; nothing is saved if any row
is wrong).

### 3.2 Give it to customers or vendors

- On the customer (or vendor) form: **Price level**.
- For many at once: **⋯ › Assign to customers** on the price level.

### 3.3 On documents

On estimates, invoices, receipts and credit notes (sales) and bills and vendor
credits (purchases), the bar above the form shows **Price level: …**:

- It is filled from the customer's or vendor's price level; you can change it.
- When you add an item or change its quantity, the rate comes from the level.
- A rate you type yourself is never changed.
- Changing the level on a document that already has lines asks
  **Update rates** or **Keep current rates**.
- Saved documents are never repriced later.

### 3.4 Report

**Items › Price levels › Sales by price level**: for a period, per level,
customer and item, the amount at normal prices, the amount charged and the
difference (the discount given).

### 3.5 Deactivate or delete

**⋯ › Deactivate** stops offering a level on new documents; documents that
already use it keep it. A level used by customers, vendors or documents cannot
be deleted.
