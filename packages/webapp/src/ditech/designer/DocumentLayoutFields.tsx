// @ts-nocheck
// 103 DiTech: Branding › Customize › Layout. Drag blocks and table columns
// into order, show or hide them, add free text; on a Cambodian tax document
// the required parts stay on (compliance lock).
import { Callout, Classes, FormGroup, HTMLSelect, Icon, Intent, Switch, TextArea, Tooltip } from '@blueprintjs/core';
import { useFormikContext } from 'formik';
import { ReactSortable } from 'react-sortablejs';
import {
  effectiveLayout,
  LAYOUT_BLOCK_LABELS,
  LAYOUT_COLUMN_LABELS,
  REQUIRED_BLOCKS,
  REQUIRED_COLUMNS,
} from './layout';
import { Stack } from '@/components';
import { useTaxDocumentSample } from './useTaxDocumentSample';

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 8px',
  marginBottom: 4,
  border: '1px solid var(--color-element-customize-divider, #dadada)',
  borderRadius: 3,
  background: 'var(--color-element-customize-header-tabs-background, #fff)',
};

function SortableRows({ items, labels, required, locked, onChange, testId }) {
  // react-sortablejs needs plain objects with an id; we keep the order and flags.
  const list = items.map((item) => ({ ...item }));
  return (
    <ReactSortable list={list} setList={(next) => onChange(next.map(({ chosen, selected, ...rest }) => rest))} handle={'.ditech-drag'} animation={150}>
      {list.map((item) => {
        const lockedReason = locked ? required[item.id] : undefined;
        return (
          <div key={item.id} style={rowStyle} data-testid={`${testId}-${item.id}`}>
            <Icon icon={'drag-handle-vertical'} className={'ditech-drag'} style={{ cursor: 'grab' }} />
            <span style={{ flex: 1 }}>{labels[item.id]}</span>
            {lockedReason ? (
              <Tooltip content={lockedReason} placement={'left'}>
                <Icon icon={'lock'} intent={Intent.PRIMARY} />
              </Tooltip>
            ) : (
              <Switch
                checked={!!item.visible}
                style={{ margin: 0 }}
                aria-label={`Show ${labels[item.id]}`}
                onChange={(e) => onChange(items.map((i) => (i.id === item.id ? { ...i, visible: e.currentTarget.checked } : i)))}
              />
            )}
          </div>
        );
      })}
    </ReactSortable>
  );
}

export function DocumentLayoutFields() {
  const { values, setFieldValue } = useFormikContext<{ layout?: any }>();
  const { data: sample } = useTaxDocumentSample();
  const taxDocument = !!sample;
  const layout = effectiveLayout(values.layout, false);
  const save = (patch) => setFieldValue('layout', { ...layout, ...patch });
  const textBlock = (id) => layout.blocks.find((b) => b.id === id);

  return (
    <Stack spacing={16} style={{ padding: 20 }} data-testid="document-layout-fields">
      {taxDocument && (
        <Callout intent={Intent.PRIMARY} icon={'lock'}>
          Tax documents are on: the parts a VAT invoice must show are locked on.
        </Callout>
      )}

      <FormGroup label={'Blocks'} helperText={'Drag to change the order; switch off what you do not want printed.'}>
        <SortableRows
          items={layout.blocks}
          labels={LAYOUT_BLOCK_LABELS}
          required={REQUIRED_BLOCKS}
          locked={taxDocument}
          onChange={(blocks) => save({ blocks })}
          testId={'layout-block'}
        />
      </FormGroup>

      {['text1', 'text2'].map((id) =>
        textBlock(id)?.visible ? (
          <FormGroup key={id} label={LAYOUT_BLOCK_LABELS[id]}>
            <TextArea
              fill
              growVertically
              value={textBlock(id).text ?? ''}
              placeholder={'e.g. bank details, a thank-you note'}
              onChange={(e) => save({ blocks: layout.blocks.map((b) => (b.id === id ? { ...b, text: e.target.value } : b)) })}
            />
          </FormGroup>
        ) : null,
      )}

      <FormGroup label={'Line item columns'} helperText={'Drag to change the column order.'}>
        <SortableRows
          items={layout.columns}
          labels={LAYOUT_COLUMN_LABELS}
          required={REQUIRED_COLUMNS}
          locked={taxDocument}
          onChange={(columns) => save({ columns })}
          testId={'layout-column'}
        />
      </FormGroup>

      <FormGroup label={'Text size'} inline>
        <HTMLSelect
          value={String(layout.fontSize)}
          onChange={(e) => save({ fontSize: Number(e.currentTarget.value) })}
          options={[10, 11, 12, 13, 14].map((n) => ({ value: String(n), label: `${n} px${n === 12 ? ' (default)' : ''}` }))}
        />
      </FormGroup>

      <div className={Classes.TEXT_MUTED}>The preview shows the PDF exactly as it prints.</div>
    </Stack>
  );
}
