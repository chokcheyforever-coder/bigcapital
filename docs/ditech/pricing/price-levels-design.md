# Price Levels: design

Status: decisions taken 2026-10-20 (§5); waiting for the go-ahead to build.

## 1. Goal

Let a company sell (and buy) the same item at different prices depending on who
the customer or vendor is, the quantity and the date, without typing the price
by hand on every invoice. Examples: wholesale customers pay 15% less; VIP
customer X pays $850 for a laptop instead of $900; 10+ units cost $8 each
instead of $10; a promotion price for November.

## 2. What modern systems do

| | QuickBooks Online (Plus/Advanced) | Zoho Books | Odoo 18 | ERPNext |
|---|---|---|---|---|
| Name | Price rules / price levels | Price lists | Pricelists | Price lists + pricing rules |
| Percentage up/down on all items | yes | yes (markup / markdown) | yes (discount, negative = markup) | yes (pricing rule) |
| Fixed price per item | yes (custom price) | yes (individual item rates) | yes | yes (item price) |
| By item group / category | yes (product category) | no | yes (category) | yes (item group) |
| Quantity breaks | not native | per-item volume ranges | yes (min qty) | yes (min/max qty) |
| Start / end dates | yes | no | yes | yes |
| Rounding | yes (per rule or global) | yes | yes (round to multiple + extra fee, e.g. x.99) | no |
| Assigned to | customers or customer types | customers / vendors | customers | customers, groups, territories |
| Currency | one | per list | per list | per list |
| Purchase side | no | yes (vendors) | yes (vendor pricelists) | yes (buying price lists) |
| Choose per line | no | optional setting | no | no |

Common ground: a named list; either a percentage on the normal price or fixed
prices per item; assigned to a customer; applied automatically when an item is
added to a document, and the user can still change the rate. The better ones
add quantity breaks, dates, rounding and a purchase side.

## 3. Proposal

### 3.1 Price level

- `name`, `description`, `active`.
- `type`: **sales** (customers) or **purchase** (vendors).
- `method`:
  - **percentage**: mark the normal price up or down by N%. Applies to all
    items, or only to the chosen item categories.
  - **per item**: a fixed price per item, optionally with **quantity breaks**
    (from 1 unit $10, from 10 units $8, from 50 units $7). Items not listed
    fall back to the normal price.
- `currency`: the base currency by default. A per-item list in another
  currency is offered only on documents in that currency.
- `rounding`: none, nearest 0.01 / 0.05 / 0.10 / 0.50 / 1, or "ends in .99".
- `valid_from` / `valid_to` (optional) for promotions.

### 3.2 Where it applies

- A default price level on each **customer** (sales list) and **vendor**
  (purchase list); bulk assignment from the customer list.
- The document header shows the price level (prefilled from the contact, can be
  changed) on estimates, invoices, sales receipts, credit notes, bills and
  vendor credits.
- When an item is added or its quantity changes, the rate comes from the price
  level. Which price wins, most specific first:
  1. a rate the user typed on that line (never overwritten);
  2. the document's price level: per-item quantity break, then per-item price,
     then percentage (category rule before all-items rule);
  3. the item's normal sell / cost price (today's behaviour).
- Changing the price level on a document asks "Update the rates of N lines?"
  rather than changing them silently.
- Saved documents are never repriced. Each document line stores the price level
  used and the normal price, so the discount given is reportable.
- Server-side: one `resolve` endpoint calculates prices, so the webapp, the API
  and imports all get the same answer. The rate on a document stays an ordinary
  number, so the ledger, taxes and reports work exactly as today.

### 3.3 Screens

- Settings › Price levels: list, create/edit (percentage or per-item table with
  quantity breaks), activate/deactivate.
- Excel export / import of a per-item list (same pattern as the budget import).
- Customer and vendor forms: a "Price level" field.
- Document forms: a "Price level" selector in the header; lines show a small
  marker when the rate came from a price level.
- Report: **Sales by price level** (quantity, normal price amount, charged
  amount, discount given) per customer / item.
- English and Khmer labels.

### 3.4 Permissions and plan

- New permission subject "Price levels": view, create, edit, delete.
- Optional company setting "Only users with *Override price* may change a rate
  set by a price level".
- Plan feature `price_levels`, on Business and above (like projects and
  budgeting).

## 4. Build phases

| Phase | Content | Done when |
|---|---|---|
| A. Server | migration (price_levels, price_level_items with qty breaks, price_level_categories, contact default, line fields), CRUD API, resolve endpoint, document fields, plan feature gate | unit tests of the price formula fixtures + e2e: invoice for a wholesale customer gets the list price and posts the right GL |
| B. Webapp | settings pages, contact field, document header selector, auto rates, reprice prompt | Playwright: create a level, assign it, the invoice line shows the level price |
| C. Extras | Excel import/export, Sales by price level report, override permission, control-plane plan feature + Khmer | report total equals the sales on those invoices |
| Deploy | merge, staging deploy with backup + migration + smoke tests | user click-through on DiTech / 103WI sample data |

## 5. Decisions (user, 2026-10-20)

1. The price level is chosen **per document** (prefilled from the contact), not per line.
2. **Quantity breaks are in the first release.**
3. **Per-customer / per-vendor assignment with bulk assign**; customer groups later.
4. **Sales and purchase** price levels in the first release; plan feature on **Business and above**.

## 6. Formula fixture

`modules/PriceLevels/calc/price-level.spec.ts` and `test/price-levels.e2e-spec.ts`.
Items: Laptop 900 (cost 650, category "Computers"), Printer ink 25 (cost 12).

| Level | Line | Rate |
|---|---|---|
| −15%, no rounding | Laptop / Ink | 765 / 21.25 |
| −15%, ends in .99 | Laptop / Ink | 764.99 / 20.99 |
| +12.5%, nearest whole | Router 120 | 135 |
| −10%, nearest 0.05 | 24.99 | 22.50 |
| −15%, category Computers only | Laptop / Ink | 765 / 25 (normal) |
| Per item: Ink 1+ 10, 10+ 8, 50+ 7; Laptop 850 | Ink qty 1, 9, 10, 49, 50 | 10, 10, 8, 8, 7 |
| same | Router (not listed) | 120 (normal) |
| +10%, nearest whole, valid November | Laptop on 15 Nov / 1 Dec | 990 / 900 |
| Purchase, per item Laptop 600 | Laptop / Ink (cost) | 600 / 12 |

Invoice with "−15%, ends in .99": 2 laptops + 4 ink = 1,613.94 posted as income;
Sales by price level shows normal 1,900.00, charged 1,613.94, difference −286.06.

## 7. As built (2026-10-20)

- Server `modules/PriceLevels`: migration `20261024000000_price_levels`
  (price_levels, price_level_items, price_level_categories; `price_level_id` on
  contacts and the six documents; `items_entries.standard_rate`).
  `/api/price-levels` CRUD, `POST /:id/assign`, `POST /resolve` (signed-in users,
  no extra permission: anyone preparing a document needs it),
  `GET /reports/sales`. The plan feature `price_levels` gates every route.
- Percentage rounding applies to percentage levels only; fixed item prices are
  used as entered. A level that is inactive or outside its dates gives the
  normal prices. Deleting is refused once anything uses a level (deactivate).
- Documents keep the rate they are sent. The level on a document and on a
  contact is checked in the document's transaction (exists, right type, active
  unless unchanged). After saving, each line stores the item's normal price.
- Sales by price level: delivered invoices and closed receipts less open
  credit notes, quantity × rate before line discounts, in the base currency.
- Excel/CSV: `GET /:id/export` (a level with no prices exports every item
  with an empty price, as the template) and `POST /:id/import` (replaces the
  prices; items by code, else name; all rows or none).
- Webapp: Items › Price levels (list, editor, assign, report, export/import), price level on
  customer/vendor forms, price level in the top bar of the six document forms.
  Rates fill automatically; a typed rate is never overwritten.
- Not in this release: a per-item currency picker in the editor (the API takes
  `currencyCode`; documents in another currency keep their rates and show
  "Other currency"), the optional "override price" permission, customer groups.
