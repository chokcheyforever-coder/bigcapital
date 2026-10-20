// @ts-nocheck
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Intent, NavbarDivider, Tag, Tooltip } from '@blueprintjs/core';
import { useFormikContext } from 'formik';
import { resolvePrices } from '@bigcapital/sdk-ts';
import { useApiFetcher } from '@/hooks/useRequest';
import { usePriceLevels } from '@/hooks/query/price-levels';
import { useCustomer } from '@/hooks/query/customers';
import { useVendor } from '@/hooks/query/vendors';
import { PriceLevelSelect } from './PriceLevelSelect';
import { usePriceLevelsEnabled } from './hooks';

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const same = (a, b) => a != null && b != null && Math.abs(Number(a) - Number(b)) < 1e-6;
/** After a line's item, quantity or level changes, a late write of the normal price (item fetch) is corrected for this long. */
const SETTLE_MS = 4000;

function LevelButton({ text }) {
  return <Button text={`Price level: ${text}`} minimal={true} small={true} icon={'tag'} />;
}

/**
 * 103 DiTech: the document's price level, in the form top bar. It is filled
 * from the customer's (or vendor's) default price level and fills line rates
 * from it: a blank rate, the item's normal price or a rate it set itself is
 * replaced; a rate the user typed is never overwritten. Changing the level on
 * a document with lines asks before repricing them. Renders nothing when the
 * plan has no price levels.
 */
export function DocumentPriceLevel(props: {
  type: 'sales' | 'purchase';
  contactField: string;
  dateField: string;
  isNewMode: boolean;
  divider?: boolean;
}) {
  const enabled = usePriceLevelsEnabled();
  return enabled ? <DocumentPriceLevelField {...props} /> : null;
}

function DocumentPriceLevelField({ type, contactField, dateField, isNewMode, divider = false }) {
  const { values, setFieldValue } = useFormikContext();
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  const { data: levels = [], isLoading } = usePriceLevels({ type, active: 'all' });

  const levelId = values.priceLevelId ?? null;
  const contactId = num(values[contactField]);
  const { data: customer } = useCustomer(type === 'sales' ? contactId : null);
  const { data: vendor } = useVendor(type === 'purchase' ? contactId : null);
  const contact = type === 'sales' ? customer : vendor;

  // --- The contact's default level, when the contact is chosen or changed (not when opening a saved document).
  const lastContact = useRef(isNewMode ? undefined : contactId);
  useEffect(() => {
    if (isLoading || !contactId || !contact || Number(contact.id) !== contactId) return;
    if (lastContact.current === contactId) return;
    lastContact.current = contactId;
    const preferred = contact.priceLevelId ?? null;
    const next = preferred && levels.some((l) => l.id === preferred && l.active) ? preferred : null;
    if (next !== levelId) setFieldValue('priceLevelId', next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, contactId, contact]);

  // --- Line rates.
  const entries = values.entries ?? [];
  const date = values[dateField];
  const linesKey = entries.map((e) => `${e.itemId}|${e.quantity}|${e.rate}`).join(';');
  const rows = useRef<Record<number, { sig: string; auto: number | null; until: number }>>({});
  const lastLevel = useRef(undefined);
  const forceAll = useRef(false);
  const [prompt, setPrompt] = useState<null | { count: number }>(null);
  const [currencyMismatch, setCurrencyMismatch] = useState(false);

  const currentLines = () =>
    entries
      .map((e, i) => ({ i, itemId: num(e.itemId), quantity: num(e.quantity) || 1, rate: num(e.rate) }))
      .filter((l) => l.itemId);
  const sigOf = (l) => `${l.itemId}|${l.quantity}|${levelId}|${date}`;
  const keepAsTheyAre = (lines) => {
    rows.current = Object.fromEntries(lines.map((l) => [l.i, { sig: sigOf(l), auto: l.rate, until: 0 }]));
  };

  useEffect(() => {
    if (prompt) return;
    const lines = currentLines();

    if (lastLevel.current === undefined) {
      // Opening the form: the rates already there stay as they are.
      lastLevel.current = levelId;
      keepAsTheyAre(lines);
      return;
    }
    if (lastLevel.current !== levelId) {
      lastLevel.current = levelId;
      if (lines.length > 0) {
        setPrompt({ count: lines.length });
        return;
      }
    }
    // Without a level, rates are left alone, unless the user asked to go back to the normal prices.
    if (!levelId && !forceAll.current) {
      setCurrencyMismatch(false);
      keepAsTheyAre(lines);
      return;
    }
    const now = Date.now();
    const force = forceAll.current;
    const todo = lines.filter((l) => {
      const r = rows.current[l.i];
      return force || !r || r.sig !== sigOf(l) || (now < r.until && !same(l.rate, r.auto));
    });
    if (todo.length === 0) return;

    const timer = setTimeout(async () => {
      forceAll.current = false;
      try {
        const res = await resolvePrices(fetcher, {
          type,
          priceLevelId: levelId,
          date,
          lines: todo.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
        });
        if (values.currencyCode && res.currencyCode && values.currencyCode !== res.currencyCode) {
          setCurrencyMismatch(true);
          return;
        }
        setCurrencyMismatch(false);
        todo.forEach((l, k) => {
          const out = res.lines[k];
          const prev = rows.current[l.i];
          const changed = !prev || prev.sig !== sigOf(l);
          const replaceable = force || l.rate == null || same(l.rate, out.standardRate) || (prev && same(l.rate, prev.auto));
          rows.current[l.i] = { sig: sigOf(l), auto: out.rate, until: changed ? Date.now() + SETTLE_MS : prev.until };
          if (replaceable && !same(l.rate, out.rate)) setFieldValue(`entries[${l.i}].rate`, out.rate);
        });
      } catch {
        // Rates can still be typed by hand.
      }
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelId, date, linesKey, values.currencyCode, prompt]);

  const options = levels.filter((l) => l.active || l.id === levelId);
  const current = levels.find((l) => l.id === levelId);

  return (
    <>
      {divider && <NavbarDivider />}
      <PriceLevelSelect
        name={'priceLevelId'}
        levels={options}
        input={LevelButton}
        popoverProps={{ minimal: true }}
        fill={false}
      />
      {currencyMismatch && (
        <Tooltip content={`The price level's prices are in ${current?.currencyCode ?? 'another currency'}; rates were not changed.`}>
          <Tag minimal intent={Intent.WARNING} icon={'warning-sign'}>
            Other currency
          </Tag>
        </Tooltip>
      )}
      <Alert
        isOpen={!!prompt}
        icon={'tag'}
        intent={Intent.PRIMARY}
        confirmButtonText={'Update rates'}
        cancelButtonText={'Keep current rates'}
        onConfirm={() => {
          forceAll.current = true;
          rows.current = {};
          setPrompt(null);
        }}
        onCancel={() => {
          keepAsTheyAre(currentLines());
          setPrompt(null);
        }}
      >
        <p>
          Update the rates of {prompt?.count} {prompt?.count === 1 ? 'line' : 'lines'} to{' '}
          {current ? <b>{current.name}</b> : 'the normal item prices'}?
        </p>
      </Alert>
    </>
  );
}
