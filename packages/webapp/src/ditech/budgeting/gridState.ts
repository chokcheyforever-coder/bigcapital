import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BudgetVersionDetail } from '@bigcapital/sdk-ts';
import { fromMilli, Milli, sum, toMilli } from './money';

export interface GridAccount {
  id: number;
  code: string | null;
  name: string;
  accountType: string;
  rootType: string;
}

export interface GridLine {
  /** account:branch:project — unique within a version, like the server. */
  key: string;
  id: number | null;
  account: GridAccount;
  branchId: number | null;
  projectId: number | null;
  note: string | null;
  assumption: string | null;
  values: Record<string, Milli | null>;
  /** Cells whose typed text is not a valid amount, by month. */
  invalid: Record<string, string>;
}

export const lineKey = (accountId: number, branchId?: number | null, projectId?: number | null) =>
  `${accountId}:${branchId || 0}:${projectId || 0}`;

const fromServer = (detail: BudgetVersionDetail): GridLine[] =>
  detail.lines.map((l) => ({
    key: lineKey(l.accountId, l.branchId, l.projectId),
    id: l.id,
    account: { id: l.account.id, code: l.account.code, name: l.account.name, accountType: l.account.accountType, rootType: l.account.rootType },
    branchId: l.branchId,
    projectId: l.projectId,
    note: l.note,
    assumption: l.assumption,
    // The server reports every month (0 when nothing is stored).
    values: Object.fromEntries(detail.months.map((m) => [m, toMilli(l.months[m] ?? 0)])),
    invalid: {},
  }));

const draftKey = (budgetId: number, versionNo: number) => `ditech.budget-draft.${budgetId}.${versionNo}`;

interface Draft {
  lockVersion: number;
  savedAt: string;
  lines: GridLine[];
  removedIds: number[];
}

/**
 * Editing state of one budget version: the lines as edited, the last saved
 * snapshot, and the minimal request to save the difference.
 */
export function useBudgetGrid(budgetId: number, versionNo: number, detail: BudgetVersionDetail | undefined) {
  const [base, setBase] = useState<GridLine[]>([]);
  const [lines, setLines] = useState<GridLine[]>([]);
  const [removedIds, setRemovedIds] = useState<number[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);

  // (Re)load from the server; offer a browser draft of the same version if one exists.
  useEffect(() => {
    if (!detail) return;
    const fresh = fromServer(detail);
    setBase(fresh);
    setLines(fresh);
    setRemovedIds([]);
    try {
      const raw = window.localStorage.getItem(draftKey(budgetId, versionNo));
      const saved: Draft | null = raw ? JSON.parse(raw) : null;
      setDraft(saved && saved.lines?.length ? saved : null);
    } catch {
      setDraft(null);
    }
  }, [detail, budgetId, versionNo]);

  const baseByKey = useMemo(() => new Map(base.map((l) => [l.key, l])), [base]);

  /** Lines and months that differ from the saved version. */
  const changes = useMemo(() => {
    const out: Array<{ line: GridLine; months: string[]; meta: boolean }> = [];
    for (const line of lines) {
      const old = baseByKey.get(line.key);
      const months = Object.keys(line.values).filter((m) => (old?.values[m] ?? null) !== line.values[m]);
      const meta = !old || (old.note ?? null) !== (line.note ?? null) || (old.assumption ?? null) !== (line.assumption ?? null);
      if (months.length > 0 || meta || !old) out.push({ line, months, meta });
    }
    return out;
  }, [lines, baseByKey]);

  const invalidCount = useMemo(() => lines.reduce((n, l) => n + Object.keys(l.invalid).length, 0), [lines]);
  const changedCells = useMemo(() => changes.reduce((n, c) => n + c.months.length, 0), [changes]);
  const isDirty = changes.length > 0 || removedIds.length > 0;

  // Keep a browser copy of unsaved edits, so a failed save or a closed tab loses nothing.
  useEffect(() => {
    if (!detail) return;
    try {
      if (isDirty) {
        const value: Draft = { lockVersion: detail.version.lockVersion, savedAt: new Date().toISOString(), lines, removedIds };
        window.localStorage.setItem(draftKey(budgetId, versionNo), JSON.stringify(value));
      }
    } catch {
      /* storage may be unavailable; editing still works */
    }
  }, [isDirty, lines, removedIds, detail, budgetId, versionNo]);

  const clearDraft = useCallback(() => {
    try {
      window.localStorage.removeItem(draftKey(budgetId, versionNo));
    } catch {
      /* ignore */
    }
    setDraft(null);
  }, [budgetId, versionNo]);

  const restoreDraft = useCallback(() => {
    if (!draft) return;
    setLines(draft.lines);
    setRemovedIds(draft.removedIds ?? []);
    setDraft(null);
  }, [draft]);

  const setCell = useCallback((key: string, month: string, value: Milli | null, invalidText?: string) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const invalid = { ...l.invalid };
        if (invalidText !== undefined) invalid[month] = invalidText;
        else delete invalid[month];
        return { ...l, values: invalidText !== undefined ? l.values : { ...l.values, [month]: value }, invalid };
      }),
    );
  }, []);

  /** Sets several cells at once (paste, allocation, prefill). */
  const setMany = useCallback((updates: Array<{ key: string; month: string; value: Milli | null; invalidText?: string }>) => {
    setLines((prev) => {
      const byKey = new Map(updates.map((u) => [u.key, [] as typeof updates]));
      for (const u of updates) byKey.get(u.key)!.push(u);
      return prev.map((l) => {
        const mine = byKey.get(l.key);
        if (!mine) return l;
        const values = { ...l.values };
        const invalid = { ...l.invalid };
        for (const u of mine) {
          if (u.invalidText !== undefined) invalid[u.month] = u.invalidText;
          else {
            values[u.month] = u.value;
            delete invalid[u.month];
          }
        }
        return { ...l, values, invalid };
      });
    });
  }, []);

  const setMeta = useCallback((key: string, meta: { note?: string | null; assumption?: string | null }) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...meta } : l)));
  }, []);

  /** Adds lines that are not there yet; existing keys are left alone. */
  const addLines = useCallback((added: Array<Omit<GridLine, 'key' | 'id' | 'invalid' | 'values'> & { values?: GridLine['values'] }>, months: string[]) => {
    setLines((prev) => {
      const keys = new Set(prev.map((l) => l.key));
      const next = [...prev];
      for (const a of added) {
        const key = lineKey(a.account.id, a.branchId, a.projectId);
        if (keys.has(key)) continue;
        keys.add(key);
        next.push({ ...a, key, id: null, invalid: {}, values: a.values ?? Object.fromEntries(months.map((m) => [m, null])) });
      }
      return next;
    });
    // A re-added line that was removed before saving is no longer removed.
    setRemovedIds((prev) => prev.filter((id) => !added.some((a) => base.find((b) => b.id === id && b.key === lineKey(a.account.id, a.branchId, a.projectId)))));
  }, [base]);

  const removeLines = useCallback((keys: string[]) => {
    setLines((prev) => {
      const gone = prev.filter((l) => keys.includes(l.key));
      setRemovedIds((ids) => [...new Set([...ids, ...gone.filter((l) => l.id).map((l) => l.id as number)])]);
      return prev.filter((l) => !keys.includes(l.key));
    });
  }, []);

  const discard = useCallback(() => {
    setLines(base);
    setRemovedIds([]);
    clearDraft();
  }, [base, clearDraft]);

  /** The save request: only changed months, new lines, removed lines. */
  const buildSave = useCallback(
    (lockVersion: number) => ({
      lockVersion,
      removeLineIds: removedIds,
      lines: changes.map(({ line, months, meta }) => ({
        accountId: line.account.id,
        branchId: line.branchId,
        projectId: line.projectId,
        ...(meta ? { note: line.note ?? null, assumption: line.assumption ?? null } : {}),
        amounts: months.map((m) => ({ month: m, amount: line.values[m] === null ? null : fromMilli(line.values[m] as Milli) })),
      })),
    }),
    [changes, removedIds],
  );

  return {
    lines,
    isDirty,
    changedCells,
    changedLines: changes.length,
    removedCount: removedIds.length,
    invalidCount,
    draft,
    restoreDraft,
    clearDraft,
    setCell,
    setMany,
    setMeta,
    addLines,
    removeLines,
    discard,
    buildSave,
  };
}

export const lineTotal = (line: GridLine, months: string[]) => sum(months.map((m) => line.values[m]));
