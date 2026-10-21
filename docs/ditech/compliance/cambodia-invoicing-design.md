# Cambodia invoice and tax compliance + invoice designer: plan (DRAFT)

Status: part A built 2026-10-21 (§7); B (designer) and C (tax reports) to come.
Not legal advice: the rules below come from secondary sources (law-firm and
tax-firm summaries); confirm the final field list with a Cambodian tax adviser
or the GDT before release.

## 1. What the rules ask for

**Invoices (Prakas 723 MEF, in force 1 Jan 2020)**

| Item | VAT invoice | Commercial invoice |
|---|---|---|
| Who issues | Medium/large taxpayers, to a **registered** buyer | Medium/large taxpayers to unregistered buyers; small taxpayers to everyone |
| Seller name, address, TIN | yes | yes |
| Invoice number, sequential (chronological) | yes | yes |
| Date of issue | yes | yes |
| Buyer name, address | yes, **plus buyer TIN** | yes |
| Description, quantity, unit price | yes | yes |
| Price | **excluding** transaction taxes | **including** all taxes |
| VAT, Public Lighting Tax, Specific Tax, Accommodation Tax | **each on its own line** | not itemised |
| Seller name and signature | yes | yes |
| Language | Khmer, or Khmer with English **below** | same |
| Keep for | 10 years (medium/large), 3 years (small) | same |

A non-compliant VAT invoice gives the buyer no VAT input credit, and a
missing invoice can be fined up to KHR 10 million.

**Riel (Notification 4908 GDT, 2019)**: invoices in a foreign currency must show
the amount payable in KHR (sources differ: VAT only, or total including VAT;
plan: show subtotal, VAT and total in KHR), using the GDT monthly rate of the
previous month or a market rate not below the NBC daily rate, and say which.

**Accounting records (Law on Accounting and Auditing 2016, Sub-decree 79,
Circular 009)**: records in Khmer and riel, unless the software has no Khmer
support and the company has notified ACAR (fines from KHR 1.5 million).
Supporting documents in Khmer (English may be attached).

**Other taxes our customers file monthly (by the 20th)**: prepayment of tax on
income 1%, withholding tax (residents: 15% services without a VAT invoice,
10% rent, 15% interest/royalties; non-residents 14%), VAT returns with the
e-VAT purchase/sales books.

**E-invoicing (CamInvoice, GDT)**: clearance model (UBL XML validated by the
platform, QR code). Live since May 2025 for central government; phased to
sub-national government and selected private taxpayers in 2026–2027; general
B2B voluntary for now.

## 2. Gaps in our product

| Area | Today | Gap |
|---|---|---|
| Company tax profile | Name, address, "tax number" in settings | TIN not printed; no taxpayer size or VAT-registered flag; no Khmer name/address |
| Customer / vendor | Name, addresses | No TIN, no "registered taxpayer" flag, no Khmer name/address |
| Document title | "Invoice" (label can be renamed) | No automatic VAT invoice / Commercial invoice choice |
| Taxes | One tax rate per line, VAT in totals | PLT / Specific / Accommodation not shown on separate lines |
| Riel | NBC/MEF rates exist (fork), not on documents | No KHR totals or rate on the PDF |
| Language | Labels editable, English only; PDF font has no Khmer | No bilingual Khmer-over-English layout, no Khmer font |
| Signature | None | Seller signature / stamp area |
| Numbering | Auto-increment, manual allowed | Warn on gaps / out-of-order numbers for tax documents |
| Retention | Documents can be deleted | Issued (delivered) invoices: void with a credit note, never deleted; 10-year retention note |
| Tax reports | Sales tax summary (upstream) | WHT, prepayment 1%, VAT sales/purchase books (e-VAT format), monthly return worksheet |
| E-invoicing | None | CamInvoice (UBL), later phase |
| Template | Colours, logo, show/hide fields, labels | No drag and drop, no layout control |

## 3. Proposal A: compliant tax documents (first)

1. **Company tax profile** (Settings › Tax): TIN (VATTIN), taxpayer size
   (small / medium / large), VAT registered yes/no, Khmer company name and
   address, default KHR rate source (GDT monthly / NBC daily).
2. **Customer and vendor**: TIN, "registered taxpayer", Khmer name and address.
3. **Document type, automatic**: VAT-registered seller + registered buyer with
   TIN → **VAT Invoice / វិក្កយបត្រអាករ** (prices excluding tax, each tax on its
   line). Otherwise **Commercial Invoice / វិក្កយបត្រ** (prices including tax).
   Same for sales receipts (**Receipt / បង្កាន់ដៃ**) and credit notes.
   Can be overridden per document with a warning.
4. **Riel box** on foreign-currency documents: rate, its source and date,
   subtotal / VAT / total in KHR. The rate is stored on the document.
5. **Bilingual layout**: every printed label in Khmer with English below
   (or Khmer only); Khmer font (Noto Sans Khmer / Kantumruy Pro) installed in
   the PDF renderer.
6. **Other transaction taxes** as tax types (PLT, Specific, Accommodation) with
   their own lines and order of calculation (Specific → PLT → VAT base).
7. **Signature and stamp**: seller signature image and name, optional customer
   signature line.
8. **Integrity**: delivered invoices cannot be deleted (void with a credit
   note); numbering gaps or out-of-order numbers flagged; audit log.
9. **Checks before issue**: missing seller TIN, missing buyer TIN on a VAT
   invoice, missing KHR rate: shown as errors on the form.

## 4. Proposal B: invoice designer (drag and drop)

A block-based designer (Settings › Branding › Design), not a free-form canvas:

- The page is a list of **blocks**: company header (logo, Khmer/English name,
  TIN), document title, document details, customer, line table, totals,
  **riel box**, payment details/QR (KHQR), notes and terms, signatures,
  footer, custom text, custom image.
- **Drag and drop** to reorder blocks, and to place them in one or two
  columns; resize the logo; show/hide; edit every label (Khmer + English).
- Line table: choose and **reorder columns** by drag and drop (item, code,
  description, quantity, unit, unit price, discount, tax, amount), column widths.
- Theme: colours, font, font size, paper (A4 / A5 / Letter / 80 mm receipt),
  margins.
- **Live preview** with a real document; several named designs, one default
  per document type, choose per customer or per document.
- **Compliance lock**: on a VAT invoice the required blocks and fields cannot
  be hidden (seller TIN, buyer TIN, tax lines, KHR box, signature); the
  designer shows which are required and why.
- Stored as JSON (version-tracked), rendered by the same React template
  through Gotenberg, so the PDF, e-mail and print are identical.

Why blocks and not free placement: free placement breaks with long Khmer
text, many lines and page breaks, and makes compliance checks impossible;
the major tools (QuickBooks, Xero, Zoho) also use sections, not free canvas.

## 5. Proposal C: tax reports (after A and B)

- Withholding tax on bills and expenses (rates per payment type, resident /
  non-resident, WHT payable account, WHT certificate PDF).
- Prepayment of tax on income (1% of monthly turnover).
- VAT purchase and sales books in the GDT e-VAT import layout; monthly
  return worksheet (VAT, WHT, prepayment, PLT, Specific Tax).
- CamInvoice readiness (UBL export, then API submission when the mandate
  reaches our customers).

## 6. Decisions (user, 2026-10-21)

1. **Compliance first** (A), then the designer (B), then tax reports (C).
2. Designer: **block-based drag and drop with a compliance lock**.
3. Documents: **Khmer above English** by default; a company can switch to Khmer only or English only.
4. Riel: **subtotal, VAT and total in KHR**, with the rate, its source and date.

## 7. Part A as built (2026-10-21)

- **Off by default.** Nothing changes for a company until Preferences ›
  Tax compliance is switched on.
- Migration `20261025000000_tax_compliance`: `tax_profile` (single row);
  `contacts.tax_number`, `registered_taxpayer`, `display_name_km`,
  `billing_address_km`; on `sales_invoices`, `sales_receipts`, `credit_notes`:
  `document_kind`, `khr_rate`, `khr_rate_source`, `khr_rate_date`.
- `modules/TaxCompliance`: `calc/compliance.ts` (document kind, issue checks,
  rates, Khmer/English titles and labels; spec), `TaxProfileService`
  (`GET/PUT /api/tax-compliance/profile`, Preferences permission to save;
  `GET /api/tax-compliance/khr-rate`), `TaxDocumentsSubscriber`,
  `TaxDocumentPdfService`.
- Issuing = delivering an invoice, closing a receipt, opening a credit note.
  Refused (400, `SELLER_TIN_MISSING`, `BUYER_TIN_MISSING`, `KHR_RATE_MISSING`)
  until valid. Drafts are never blocked. Deleting an issued document:
  `TAX_DOCUMENT_ISSUED` (cancel with a credit note).
- Kind and riel rate are written on save and frozen once the document is
  issued, so a reprint is identical.
- Riel rate: GDT monthly (previous month, entered in the profile, USD only)
  or NBC daily (MEF API, the rate of the day the document is saved).
- Receipts have no tax lines in BigCapital: they always print as commercial
  invoices (with "Receipt" under the title); a VAT invoice for a cash sale is
  an invoice plus a payment. Credit notes print as credit notes.
- PDFs: `shared/pdf-templates/src/components/Compliance.tsx` (parties with
  TIN, riel box, signatures) used by the invoice, receipt and credit note
  templates when the server passes `compliance`; Khmer fonts Kantumruy Pro /
  Noto Sans Khmer.

Not yet: Public Lighting / Specific / Accommodation tax lines (needs tax
types with their own order of calculation), numbering-gap warnings, the
designer (B), tax reports (C).
