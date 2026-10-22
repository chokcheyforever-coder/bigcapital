import type { ReactNode } from 'react';
import { x } from '@xstyled/emotion';
import { Box } from '../lib/layout/Box';
import { Group } from '../lib/layout/Group';
import { Stack } from '../lib/layout/Stack';
import type { DocumentLayout, LayoutColumnId } from './DocumentLayout';

/** 103 DiTech: a free text block placed by the designer (bank details, a thank-you note, ...). */
export function CustomText({ text }: { text?: string }) {
  if (!text?.trim()) return null;
  return <x.div whiteSpace={'pre-line'}>{text}</x.div>;
}

/** Signature lines for documents that are not Cambodian tax documents. */
export function PlainSignatures() {
  const box = (label: string) => (
    <Box flex={1}>
      <x.div h={'60px'} borderBottom={'1px solid #999'} />
      <x.div mt={'4px'} color={'#5f6b7c'}>
        {label}
      </x.div>
    </Box>
  );
  return (
    <Group spacing={48} align={'flex-start'}>
      {box("Customer's signature")}
      {box('Authorized signature')}
    </Group>
  );
}

/**
 * The blocks of a document in the layout's order. Lines, totals and the riel
 * box sit together (no gap) when they follow each other, as in the original
 * templates.
 */
export function LayoutStack({ view, renderers }: { view: DocumentLayout; renderers: Record<string, () => ReactNode> }) {
  const TIGHT = new Set(['lines', 'totals', 'khr']);
  const groups: string[][] = [];
  for (const block of view.blocks.filter((b) => b.visible)) {
    const last = groups[groups.length - 1];
    if (last && TIGHT.has(block.id) && TIGHT.has(last[last.length - 1])) last.push(block.id);
    else groups.push([block.id]);
  }
  return (
    <Stack spacing={24}>
      {groups.map((group) =>
        group.length > 1 ? (
          <Stack spacing={0} key={group.join('-')}>
            {group.map((id) => (
              <Box key={id}>{renderers[id]?.()}</Box>
            ))}
          </Stack>
        ) : (
          <Box key={group[0]}>{renderers[group[0]]?.()}</Box>
        ),
      )}
    </Stack>
  );
}

/**
 * A template's table columns (`ids[i]` names `base[i]`) in the layout's order
 * and visibility. Without a saved layout the columns stay as the template
 * defines them (including its own discount switch).
 */
export function layoutColumns<C extends { visible?: boolean }>(view: DocumentLayout, ids: LayoutColumnId[], base: C[], hasLayout: boolean): C[] {
  if (!hasLayout) return base;
  const byId = new Map(ids.map((id, i) => [id, base[i]]));
  return view.columns
    .filter((c) => byId.has(c.id) && c.visible)
    .map((c) => ({ ...byId.get(c.id)!, visible: true }));
}
