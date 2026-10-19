// @ts-nocheck
import React, { useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Classes, Icon, Tooltip } from '@blueprintjs/core';
import styled from 'styled-components';
import { editText, formatAmount, Milli, parseAmount, sum } from './money';
import { GridLine, lineTotal } from './gridState';

export type GridView = 'months' | 'quarters' | 'year';

const GROUP_LABELS = { income: 'Income', expense: 'Expenses', asset: 'Assets', liability: 'Liabilities', equity: 'Equity' };
const GROUP_ORDER = ['income', 'expense', 'asset', 'liability', 'equity'];
const monthHeader = (m: string) => new Date(`${m}T00:00:00`).toLocaleString('en-US', { month: 'short', year: '2-digit' });

/**
 * One editable amount. Shows the formatted amount; while focused, the plain
 * number. Commits on blur/Enter; invalid text stays visible and marked.
 */
function AmountCell({ value, invalid, readOnly, decimals, row, col, onCommit, onPaste, onNavigate }) {
  const [text, setText] = useState<string | null>(null);
  const shown = text !== null ? text : invalid !== undefined ? invalid : formatAmount(value, decimals);

  const commit = () => {
    if (text === null) return;
    const parsed = parseAmount(text, decimals);
    onCommit(parsed.ok ? { value: parsed.value } : { invalidText: text, error: parsed.error });
    setText(null);
  };

  return (
    <CellInput
      data-row={row}
      data-col={col}
      className={invalid !== undefined ? 'is-invalid' : ''}
      value={shown}
      readOnly={readOnly}
      inputMode="decimal"
      aria-label={`Amount row ${row + 1} column ${col + 1}`}
      title={invalid !== undefined ? 'Not a valid amount' : undefined}
      onFocus={(e) => {
        if (readOnly) return;
        setText(invalid !== undefined ? invalid : editText(value));
        requestAnimationFrame(() => e.target.select());
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onPaste={(e) => {
        if (readOnly) return;
        const data = e.clipboardData.getData('text/plain');
        if (data.includes('\t') || data.trim().includes('\n')) {
          e.preventDefault();
          setText(null);
          onPaste(data);
        }
      }}
      onKeyDown={(e) => {
        const el = e.currentTarget;
        const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
        const atEnd = el.selectionStart === el.value.length;
        const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], Enter: [e.shiftKey ? -1 : 1, 0] };
        if (e.key === 'ArrowLeft' && (atStart || el.selectionEnd - el.selectionStart === el.value.length)) moves.ArrowLeft = [0, -1];
        if (e.key === 'ArrowRight' && (atEnd || el.selectionEnd - el.selectionStart === el.value.length)) moves.ArrowRight = [0, 1];
        if (e.key === 'Escape') {
          setText(null);
          el.blur();
          return;
        }
        const move = moves[e.key];
        if (move) {
          e.preventDefault();
          commit();
          onNavigate(row + move[0], col + move[1]);
        }
      }}
    />
  );
}

export function BudgetGrid({
  months,
  quarters,
  view,
  lines,
  decimals,
  readOnly,
  showNetIncome,
  closing = false,
  selected,
  onToggleSelect,
  onToggleSelectAll,
  onCell,
  onPasteBlock,
  onSpreadTotal,
  onEditMeta,
  dimensionLabel,
}: {
  months: string[];
  quarters: Array<{ label: string; months: string[] }>;
  view: GridView;
  lines: GridLine[];
  decimals: number;
  readOnly: boolean;
  showNetIncome: boolean;
  /** Balance sheet budgets: amounts are month-end balances, so a quarter or the year shows its last month. */
  closing?: boolean;
  selected: Set<string>;
  onToggleSelect: (key: string) => void;
  onToggleSelectAll: (keys: string[], on: boolean) => void;
  onCell: (key: string, month: string, result: { value?: Milli | null; invalidText?: string }) => void;
  onPasteBlock: (updates: Array<{ key: string; month: string; value: Milli | null; invalidText?: string }>) => void;
  onSpreadTotal: (key: string, amount: Milli) => void;
  onEditMeta: (line: GridLine) => void;
  dimensionLabel: (line: GridLine) => string;
}) {
  const tableRef = useRef<HTMLTableElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const byRoot = new Map<string, GridLine[]>();
    for (const l of lines) byRoot.set(l.account.rootType, [...(byRoot.get(l.account.rootType) ?? []), l]);
    return [...byRoot.entries()]
      .sort((a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0]))
      .map(([rootType, items]) => ({
        rootType,
        items: [...items].sort((a, b) => String(a.account.code ?? '').localeCompare(String(b.account.code ?? '')) || a.key.localeCompare(b.key)),
      }));
  }, [lines]);

  // Visible rows in order (for keyboard navigation and paste).
  const visible = useMemo(() => groups.flatMap((g) => (collapsed.has(g.rootType) ? [] : g.items)), [groups, collapsed]);

  const focusCell = (row: number, col: number) => {
    const el = tableRef.current?.querySelector(`input[data-row="${row}"][data-col="${col}"]`) as HTMLInputElement | null;
    el?.focus();
  };

  const pasteAt = (row: number, col: number) => (text: string) => {
    const rows = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((r) => r.split('\t'));
    const updates = [];
    rows.forEach((cells, r) => {
      const line = visible[row + r];
      if (!line) return;
      cells.forEach((cell, c) => {
        const month = months[col + c];
        if (!month) return;
        const parsed = parseAmount(cell, decimals);
        updates.push(parsed.ok ? { key: line.key, month, value: parsed.value } : { key: line.key, month, value: null, invalidText: cell });
      });
    });
    onPasteBlock(updates);
  };

  const columns =
    view === 'months'
      ? months.map((m) => ({ id: m, label: monthHeader(m), months: [m] }))
      : view === 'quarters'
        ? quarters.map((q) => ({ id: q.label, label: q.label, months: q.months }))
        : [];

  const span = (ms: string[]) => (closing ? ms.slice(-1) : ms);
  const subtotal = (items: GridLine[], ms: string[]) => sum(items.map((l) => sum(span(ms).map((m) => l.values[m]))));
  const signed = (rootType: string) => (rootType === 'income' ? 1 : rootType === 'expense' ? -1 : 0);
  const netOf = (ms: string[]) => sum(lines.map((l) => signed(l.account.rootType) * sum(span(ms).map((m) => l.values[m]))));
  const allKeys = visible.map((l) => l.key);
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));

  let rowIndex = -1;
  return (
    <GridScroll>
      <GridTable ref={tableRef} className={Classes.HTML_TABLE}>
        <thead>
          <tr>
            <th className="sel">
              {!readOnly && (
                <Checkbox
                  checked={allSelected}
                  indeterminate={!allSelected && allKeys.some((k) => selected.has(k))}
                  onChange={() => onToggleSelectAll(allKeys, !allSelected)}
                  aria-label="Select all lines"
                />
              )}
            </th>
            <th className="account">Account</th>
            {columns.map((c) => (
              <th key={c.id} className="num">
                {c.label}
              </th>
            ))}
            <th className="num total">{closing ? 'Closing' : view === 'year' ? 'Year (type to spread)' : 'Total'}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.rootType);
            return (
              <React.Fragment key={g.rootType}>
                <tr className="group">
                  <td />
                  <td>
                    <Button
                      minimal
                      small
                      icon={isCollapsed ? 'chevron-right' : 'chevron-down'}
                      onClick={() =>
                        setCollapsed((prev) => {
                          const next = new Set(prev);
                          next.has(g.rootType) ? next.delete(g.rootType) : next.add(g.rootType);
                          return next;
                        })
                      }
                      text={`${GROUP_LABELS[g.rootType] ?? g.rootType} (${g.items.length})`}
                    />
                  </td>
                  {columns.map((c) => (
                    <td key={c.id} className="num">
                      {formatAmount(subtotal(g.items, c.months), decimals)}
                    </td>
                  ))}
                  <td className="num total">{formatAmount(subtotal(g.items, months), decimals)}</td>
                </tr>
                {!isCollapsed &&
                  g.items.map((line) => {
                    rowIndex += 1;
                    const row = rowIndex;
                    const total = lineTotal(line, span(months));
                    const dims = dimensionLabel(line);
                    return (
                      <tr key={line.key} className={selected.has(line.key) ? 'selected' : ''} data-testid="budget-line">
                        <td className="sel">
                          {!readOnly && (
                            <Checkbox checked={selected.has(line.key)} onChange={() => onToggleSelect(line.key)} aria-label={`Select ${line.account.name}`} />
                          )}
                        </td>
                        <td className="account">
                          <div className="account-cell">
                            <span className="code">{line.account.code}</span>
                            <span className="name">{line.account.name}</span>
                            {dims && <span className={`${Classes.TEXT_MUTED} dims`}>{dims}</span>}
                            {line.id === null && <span className="new-tag">new</span>}
                            <Tooltip content={line.note || line.assumption ? [line.note, line.assumption].filter(Boolean).join(' — ') : 'Add a note or assumption'}>
                              <Button minimal small icon={<Icon icon="comment" color={line.note || line.assumption ? undefined : '#bbb'} />} onClick={() => onEditMeta(line)} aria-label="Note" />
                            </Tooltip>
                          </div>
                        </td>
                        {view === 'months'
                          ? months.map((m, col) => (
                              <td key={m} className="num">
                                <AmountCell
                                  value={line.values[m]}
                                  invalid={line.invalid[m]}
                                  readOnly={readOnly}
                                  decimals={decimals}
                                  row={row}
                                  col={col}
                                  onCommit={(r) => onCell(line.key, m, r)}
                                  onPaste={pasteAt(row, col)}
                                  onNavigate={focusCell}
                                />
                              </td>
                            ))
                          : columns.map((c) => (
                              <td key={c.id} className="num">
                                {formatAmount(sum(span(c.months).map((m) => line.values[m])), decimals)}
                              </td>
                            ))}
                        <td className="num total">
                          {view === 'year' && !readOnly && !closing ? (
                            <AmountCell
                              value={total}
                              invalid={undefined}
                              readOnly={false}
                              decimals={decimals}
                              row={row}
                              col={0}
                              onCommit={(r) => r.value !== undefined && r.value !== null && r.value !== total && onSpreadTotal(line.key, r.value)}
                              onPaste={() => undefined}
                              onNavigate={focusCell}
                            />
                          ) : (
                            formatAmount(total, decimals)
                          )}
                          {Object.keys(line.invalid).length > 0 && <Icon icon="error" intent="danger" className="row-error" />}
                        </td>
                      </tr>
                    );
                  })}
              </React.Fragment>
            );
          })}
        </tbody>
        <tfoot>
          {showNetIncome && (
            <tr className="net">
              <td />
              <td>Net income</td>
              {columns.map((c) => (
                <td key={c.id} className="num">
                  {formatAmount(netOf(c.months), decimals)}
                </td>
              ))}
              <td className="num total">{formatAmount(netOf(months), decimals)}</td>
            </tr>
          )}
          <tr className="grand">
            <td />
            <td>Total of all lines</td>
            {columns.map((c) => (
              <td key={c.id} className="num">
                {formatAmount(subtotal(lines, c.months), decimals)}
              </td>
            ))}
            <td className="num total">{formatAmount(subtotal(lines, months), decimals)}</td>
          </tr>
        </tfoot>
      </GridTable>
    </GridScroll>
  );
}

const GridScroll = styled.div`
  overflow: auto;
  max-height: calc(100vh - 260px);
  border: 1px solid var(--color-border, #e1e4e8);
  border-radius: 4px;
`;

const GridTable = styled.table`
  border-collapse: separate;
  border-spacing: 0;
  width: max-content;
  min-width: 100%;
  font-size: 13px;

  th,
  td {
    padding: 2px 6px !important;
    white-space: nowrap;
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
    vertical-align: middle;
  }
  thead th {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--color-background, #fff);
    font-weight: 600;
  }
  th.sel,
  td.sel {
    position: sticky;
    left: 0;
    z-index: 1;
    background: inherit;
    width: 32px;
  }
  th.account,
  td.account {
    position: sticky;
    left: 32px;
    z-index: 1;
    background: var(--color-background, #fff);
    min-width: 260px;
    max-width: 340px;
  }
  thead th.sel,
  thead th.account {
    z-index: 3;
  }
  .account-cell {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
  }
  .account-cell .code {
    color: #888;
    min-width: 44px;
  }
  .account-cell .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .account-cell .dims {
    font-size: 11px;
  }
  .new-tag {
    font-size: 10px;
    color: #0d8050;
    border: 1px solid #0d8050;
    border-radius: 3px;
    padding: 0 3px;
  }
  .num {
    text-align: right;
    min-width: 96px;
  }
  .total {
    font-weight: 600;
    background: rgba(0, 0, 0, 0.02);
  }
  tr.group td {
    background: rgba(0, 0, 0, 0.035);
    font-weight: 600;
  }
  tr.selected td {
    background: rgba(19, 124, 189, 0.08);
  }
  tfoot td {
    font-weight: 700;
    border-top: 2px solid rgba(0, 0, 0, 0.15);
    position: sticky;
    bottom: 0;
    background: var(--color-background, #fff);
  }
  .row-error {
    margin-left: 4px;
  }
`;

const CellInput = styled.input`
  width: 92px;
  text-align: right;
  border: 1px solid transparent;
  background: transparent;
  padding: 3px 4px;
  font: inherit;
  font-variant-numeric: tabular-nums;
  color: inherit;
  border-radius: 2px;

  &:hover:not([readonly]) {
    border-color: rgba(0, 0, 0, 0.15);
  }
  &:focus {
    outline: none;
    border-color: #137cbd;
    background: var(--color-background, #fff);
    box-shadow: 0 0 0 2px rgba(19, 124, 189, 0.25);
  }
  &.is-invalid {
    border-color: #db3737;
    background: rgba(219, 55, 55, 0.08);
  }
`;
