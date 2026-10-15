import { Inject, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import * as moment from 'moment';
import { ServiceError } from '@/modules/Items/ServiceError';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { Account } from '@/modules/Accounts/models/Account.model';
import { Branch } from '@/modules/Branches/models/Branch.model';
import { Project } from '@/modules/Projects/models/Project.model';
import { BUDGET_TYPE_ACCOUNT_TYPES, BudgetType } from '../Budgeting.types';
import { BudgetCalcError, periodMonths, toMilli } from '../calc/budget-calc';
import { BudgetQueriesService } from '../queries/BudgetQueries.service';
import { BudgetValidator } from './BudgetValidator.service';
import { BudgetCommandsService, currencyDecimals, dateOnly, lineKey } from './BudgetCommands.service';

export type SheetFormat = 'csv' | 'xlsx';

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const FIXED_HEADERS = ['Account code', 'Account name', 'Branch', 'Project'];
const TAIL_HEADERS = ['Total', 'Note', 'Assumption'];
const monthLabel = (month: string) => month.slice(0, 7); // 2031-01-01 -> 2031-01

export interface ImportRowReport {
  row: number;
  accountCode: string | null;
  accountName: string | null;
  branch: string | null;
  project: string | null;
  months: number;
  status: 'ok' | 'error';
  errors: Array<{ column: string | null; message: string }>;
}

export interface ImportReport {
  committed: boolean;
  lockVersion?: number;
  fileErrors: string[];
  ignoredColumns: string[];
  rows: ImportRowReport[];
  summary: { rows: number; valid: number; invalid: number; months: string[]; cells: number };
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Month of a header cell: "2031-01", "2031-01-01", an Excel date, "Jan 2031" or "January 2031". */
export function headerMonth(cell: unknown): string | null {
  if (cell instanceof Date && !isNaN(cell.getTime())) return moment(cell).format('YYYY-MM-01');
  const text = String(cell ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})(?:-01)?$/.exec(text);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${m[2].padStart(2, '0')}-01`;
  m = /^([a-z]+)[\s\-/]+(\d{4})$/i.exec(text);
  if (m) {
    const idx = MONTHS_SHORT.indexOf(m[1].slice(0, 3).toLowerCase());
    if (idx >= 0 && (m[1].length === 3 || moment.months()[idx].toLowerCase() === m[1].toLowerCase())) {
      return `${m[2]}-${String(idx + 1).padStart(2, '0')}-01`;
    }
  }
  return null;
}

/** Amount of a cell: numbers as they are; text may use thousands separators ("1,250.50"). */
export function cellAmount(cell: unknown): number | string | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'number') return cell;
  const text = String(cell).trim();
  if (text === '') return null;
  return /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text) ? text.replace(/,/g, '') : text;
}

/**
 * Budget sheets (DiTech Phase 3): export a version, a blank template, and
 * import with a preview. An import is all-or-nothing: any invalid row means
 * nothing is saved, and the report says which rows and cells are wrong.
 * Empty cells leave a month unchanged; a 0 sets it to zero.
 */
@Injectable()
export class BudgetSheetService {
  constructor(
    private readonly validator: BudgetValidator,
    private readonly queries: BudgetQueriesService,
    private readonly commands: BudgetCommandsService,
    @Inject(Account.name) private readonly accountModel: TenantModelProxy<typeof Account>,
    @Inject(Branch.name) private readonly branchModel: TenantModelProxy<typeof Branch>,
    @Inject(Project.name) private readonly projectModel: TenantModelProxy<typeof Project>,
  ) {}

  // ------------------------------------------------------------ export

  async exportVersion(budgetId: number, versionNo: number, format: SheetFormat) {
    const v = await this.queries.getVersion(budgetId, versionNo);
    const names = await this.dimensionNames();
    const header = [...FIXED_HEADERS, ...v.months.map(monthLabel), ...TAIL_HEADERS];
    const rows = v.lines.map((l) => [
      l.account.code ?? '',
      l.account.name,
      l.branchId ? names.branches.get(l.branchId) ?? String(l.branchId) : '',
      l.projectId ? names.projects.get(l.projectId) ?? String(l.projectId) : '',
      ...v.months.map((m) => l.months[m] ?? 0),
      l.total,
      l.note ?? '',
      l.assumption ?? '',
    ]);
    const totals = ['', 'Total', '', '', ...v.months.map((m) => v.totals.grand.months[m] ?? 0), v.totals.grand.total, '', ''];
    const name = `${v.budget.reference}-v${v.version.versionNo}`;
    return this.write([header, ...rows, totals], format, name, 'Budget');
  }

  async template(budgetId: number, format: SheetFormat) {
    const budget = await this.validator.getBudgetOrThrow(budgetId);
    const months = periodMonths(dateOnly(budget.startDate), dateOnly(budget.endDate));
    const accounts = await this.accountModel()
      .query()
      .whereIn('accountType', BUDGET_TYPE_ACCOUNT_TYPES[budget.type as BudgetType] ?? [])
      .where('active', true)
      .orderBy('code');
    const header = [...FIXED_HEADERS, ...months.map(monthLabel), ...TAIL_HEADERS];
    const rows = accounts.map((a) => [a.code ?? '', a.name, '', '', ...months.map(() => null), null, '', '']);
    return this.write([header, ...rows], format, `${budget.reference}-template`, 'Budget');
  }

  private write(aoa: unknown[][], format: SheetFormat, baseName: string, sheetName: string) {
    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    if (format === 'csv') {
      return { body: Buffer.from(XLSX.utils.sheet_to_csv(sheet), 'utf8'), filename: `${baseName}.csv`, contentType: 'text/csv; charset=utf-8' };
    }
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, sheetName);
    const body: Buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
    return {
      body,
      filename: `${baseName}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  // ------------------------------------------------------------ import

  async importFile(budgetId: number, versionNo: number, file: Buffer, opts: { dryRun: boolean; lockVersion?: number }): Promise<ImportReport> {
    const budget = await this.validator.getBudgetOrThrow(budgetId);
    const version = await this.validator.getVersionOrThrow(budgetId, versionNo);
    if (!opts.dryRun) this.validator.ensureEditable(version);
    const budgetMonths = new Set(periodMonths(dateOnly(budget.startDate), dateOnly(budget.endDate)));
    const decimals = currencyDecimals(budget.currencyCode);

    let table: unknown[][];
    try {
      // raw: CSV values stay text (no guessing that "2031-01" is a date); Excel cells keep their types.
      const book = XLSX.read(file, { type: 'buffer', cellDates: true, raw: true });
      const sheet = book.Sheets[book.SheetNames[0]];
      table = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: false }) as unknown[][];
    } catch {
      throw new ServiceError('BUDGET_IMPORT_UNREADABLE', 'The file could not be read. Use the CSV or Excel template.');
    }

    const report: ImportReport = {
      committed: false,
      fileErrors: [],
      ignoredColumns: [],
      rows: [],
      summary: { rows: 0, valid: 0, invalid: 0, months: [], cells: 0 },
    };
    const header = (table[0] ?? []).map((c) => c);
    const col = (names: string[]) => header.findIndex((h) => names.includes(norm(h)));
    const cCode = col(['account code', 'code']);
    const cName = col(['account name', 'account']);
    const cBranch = col(['branch']);
    const cProject = col(['project']);
    const cNote = col(['note', 'notes']);
    const cAssumption = col(['assumption', 'assumptions']);
    const known = new Set([cCode, cName, cBranch, cProject, cNote, cAssumption, col(['total'])]);

    const monthCols: Array<{ index: number; month: string; label: string }> = [];
    header.forEach((h, index) => {
      if (known.has(index) || h === null || String(h).trim() === '') return;
      const month = headerMonth(h);
      if (!month) report.ignoredColumns.push(String(h));
      else if (!budgetMonths.has(month)) report.fileErrors.push(`Column "${h}" is not a month of this budget (${[...budgetMonths][0].slice(0, 7)} to ${[...budgetMonths].pop().slice(0, 7)}).`);
      else if (monthCols.some((c) => c.month === month)) report.fileErrors.push(`The month ${month.slice(0, 7)} appears in two columns.`);
      else monthCols.push({ index, month, label: String(h) });
    });
    if (cCode < 0 && cName < 0) report.fileErrors.push('Add an "Account code" or "Account name" column.');
    if (monthCols.length === 0) report.fileErrors.push('No month columns found (headers like 2031-01 or Jan 2031).');
    const dataRows = table.slice(1);
    if (dataRows.length > MAX_IMPORT_ROWS) report.fileErrors.push(`At most ${MAX_IMPORT_ROWS} rows per import.`);
    report.summary.months = monthCols.map((c) => c.month);
    if (report.fileErrors.length > 0) return report;

    // Lookups: accounts the budget type allows, branches and projects by code or name.
    const allAccounts = await this.accountModel().query();
    const allowed = new Set(BUDGET_TYPE_ACCOUNT_TYPES[budget.type as BudgetType] ?? []);
    const branches = await this.branchModel().query();
    const projects = await this.projectModel().query();
    const find = <T extends { code?: string | null; name: string }>(list: T[], value: string): T[] => {
      const byCode = list.filter((x) => x.code && norm(x.code) === norm(value));
      return byCode.length ? byCode : list.filter((x) => norm(x.name) === norm(value));
    };

    const lines: any[] = [];
    const seen = new Map<string, number>();
    dataRows.forEach((cells, i) => {
      const rowNo = i + 2; // spreadsheet row numbers, after the header
      const get = (c: number) => (c >= 0 ? cells[c] : null);
      const text = (c: number) => {
        const v = get(c);
        return v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim();
      };
      const code = text(cCode);
      const name = text(cName);
      // A totals row ("Total" with no code) from an export is skipped.
      if (!code && norm(name) === 'total') return;
      const row: ImportRowReport = {
        row: rowNo, accountCode: code, accountName: name, branch: text(cBranch), project: text(cProject), months: 0, status: 'ok', errors: [],
      };
      const fail = (column: string | null, message: string) => row.errors.push({ column, message });

      let account: Account | undefined;
      const matches = code ? allAccounts.filter((a) => a.code && norm(a.code) === norm(code)) : name ? allAccounts.filter((a) => norm(a.name) === norm(name)) : [];
      if (!code && !name) fail('Account code', 'The account is missing.');
      else if (matches.length === 0) fail(code ? 'Account code' : 'Account name', `No account "${code ?? name}".`);
      else if (matches.length > 1) fail('Account name', `Several accounts are named "${name}"; use the account code.`);
      else if (!allowed.has(matches[0].accountType)) fail(code ? 'Account code' : 'Account name', `"${matches[0].name}" (${matches[0].accountType}) does not belong in this type of budget.`);
      else account = matches[0];

      let branchId: number | null = null;
      if (row.branch) {
        const b = find(branches, row.branch);
        if (b.length !== 1) fail('Branch', b.length ? `Several branches match "${row.branch}".` : `No branch "${row.branch}".`);
        else branchId = b[0].id;
      }
      let projectId: number | null = null;
      if (row.project) {
        const p = find(projects as any[], row.project);
        if (p.length !== 1) fail('Project', p.length ? `Several projects match "${row.project}".` : `No project "${row.project}".`);
        else projectId = p[0].id;
      }

      const amounts: Array<{ month: string; amount: number | string }> = [];
      for (const c of monthCols) {
        const value = cellAmount(get(c.index));
        if (value === null) continue;
        try {
          toMilli(value, decimals);
          amounts.push({ month: c.month, amount: value });
        } catch (err) {
          if (!(err instanceof BudgetCalcError)) throw err;
          fail(c.label, err.code === 'TOO_MANY_DECIMALS' ? `"${value}" has more than ${decimals} decimals.` : `"${value}" is not an amount.`);
        }
      }
      row.months = amounts.length;

      if (account) {
        const key = lineKey(account.id, branchId, projectId);
        if (seen.has(key)) fail(null, `Same account, branch and project as row ${seen.get(key)}.`);
        else seen.set(key, rowNo);
      }
      if (row.errors.length > 0) row.status = 'error';
      else {
        lines.push({
          accountId: account.id,
          branchId,
          projectId,
          amounts,
          // Empty note/assumption cells leave the existing text, like empty months.
          ...(text(cNote) !== null ? { note: text(cNote) } : {}),
          ...(text(cAssumption) !== null ? { assumption: text(cAssumption) } : {}),
        });
        report.summary.cells += amounts.length;
      }
      report.rows.push(row);
    });

    report.summary.rows = report.rows.length;
    report.summary.invalid = report.rows.filter((r) => r.status === 'error').length;
    report.summary.valid = report.summary.rows - report.summary.invalid;
    if (report.summary.rows === 0) report.fileErrors.push('The file has no rows to import.');
    if (opts.dryRun || report.summary.invalid > 0 || report.fileErrors.length > 0) return report;

    const saved = await this.commands.saveLines(budgetId, versionNo, { lockVersion: opts.lockVersion ?? -1, lines } as any);
    return { ...report, committed: true, lockVersion: saved.lockVersion };
  }

  private async dimensionNames() {
    const branches = await this.branchModel().query();
    const projects = await this.projectModel().query();
    return {
      branches: new Map(branches.map((b) => [b.id, b.code || b.name])),
      projects: new Map(projects.map((p) => [p.id, p.code || p.name])),
    };
  }
}
