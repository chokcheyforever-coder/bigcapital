import type { ReactNode } from 'react';
import { isEmpty } from 'lodash';
import {
  PaperTemplate,
  PaperTemplateProps,
  PaperTemplateTotalBorder,
} from './PaperTemplate';
import { Box } from '../lib/layout/Box';
import { Text } from '../lib/text/Text';
import { Stack } from '../lib/layout/Stack';
import { Group } from '../lib/layout/Group';
import {
  DefaultPdfTemplateTerms,
  DefaultPdfTemplateItemDescription,
  DefaultPdfTemplateStatement,
  DefaultPdfTemplateItemName,
  DefaultPdfTemplateAddressBilledTo,
  DefaultPdfTemplateAddressBilledFrom,
} from './_constants';
import { ComplianceKhrBox, ComplianceParties, ComplianceProps, ComplianceSignatures } from './Compliance';
import { DocumentLayout, effectiveLayout } from './DocumentLayout';
import { CustomText, PlainSignatures } from './LayoutBlocks';

interface InvoiceLine {
  item?: string;
  description?: string;
  quantity?: string;
  rate?: string;
  total?: string;
  discount?: string;
}

interface InvoiceTaxLine {
  label: string;
  amount: string;
}

export interface InvoicePaperTemplateProps extends PaperTemplateProps {
  primaryColor?: string;
  secondaryColor?: string;

  // Company
  showCompanyLogo?: boolean;
  companyLogoUri?: string;

  // Invoice number
  showInvoiceNumber?: boolean;
  invoiceNumber?: string;
  invoiceNumberLabel?: string;

  // Date of issue
  showDateIssue?: boolean;
  dateIssue?: string;
  dateIssueLabel?: string;

  // Due date
  showDueDate?: boolean;
  dueDate?: string;
  dueDateLabel?: string;

  companyName?: string;
  bigtitle?: string;

  // Address
  showCustomerAddress?: boolean;
  customerAddress?: string;

  showCompanyAddress?: boolean;
  companyAddress?: string;

  billedToLabel?: string;

  // Entries
  lineItemLabel?: string;
  lineQuantityLabel?: string;
  lineRateLabel?: string;
  lineTotalLabel?: string;

  // # Line Discount
  lineDiscountLabel?: string;
  showLineDiscount?: boolean;

  // Total
  showTotal?: boolean;
  totalLabel?: string;
  total?: string;

  // Discount
  showDiscount?: boolean;
  discountLabel?: string;
  discount?: string;

  // Adjustment
  showAdjustment?: boolean;
  adjustmentLabel?: string;
  adjustment?: string;

  // Subtotal
  showSubtotal?: boolean;
  subtotalLabel?: string;
  subtotal?: string;

  // Payment made
  showPaymentMade?: boolean;
  paymentMadeLabel?: string;
  paymentMade?: string;

  showTaxes?: boolean;

  // Due Amount
  showDueAmount?: boolean;
  dueAmountLabel?: string;
  dueAmount?: string;

  // Footer
  termsConditionsLabel?: string;
  showTermsConditions?: boolean;
  termsConditions?: string;

  // Statement
  statementLabel?: string;
  showStatement?: boolean;
  statement?: string;

  lines?: Array<InvoiceLine>;
  taxes?: Array<InvoiceTaxLine>;

  /** 103 DiTech: Cambodian tax document (title, TINs, riel, Khmer/English labels, signatures). */
  compliance?: ComplianceProps;

  /** 103 DiTech: block order and visibility from the designer (Branding › Customize › Layout). */
  layout?: Partial<DocumentLayout> | null;
}

export function InvoicePaperTemplate({
  // # Colors
  primaryColor,
  secondaryColor,

  showCompanyLogo = true,
  companyLogoUri = '',

  // # Due date
  dueDate = 'September 3, 2024',
  dueDateLabel = 'Date due',
  showDueDate = true,

  // # Issue date.
  dateIssue = 'September 3, 2024',
  dateIssueLabel = 'Date of issue',
  showDateIssue = true,

  // Invoice #,
  invoiceNumberLabel = 'Invoice number',
  invoiceNumber = '346D3D40-0001',
  showInvoiceNumber = true,

  // Address
  showCustomerAddress = true,
  customerAddress = DefaultPdfTemplateAddressBilledTo,

  showCompanyAddress = true,
  companyAddress = DefaultPdfTemplateAddressBilledFrom,

  billedToLabel = 'Billed To',

  // Entries
  lineItemLabel = 'Item',
  lineQuantityLabel = 'Qty',
  lineRateLabel = 'Rate',
  lineTotalLabel = 'Total',

  totalLabel = 'Total',
  subtotalLabel = 'Subtotal',
  discountLabel = 'Discount',
  adjustmentLabel = 'Adjustment',
  paymentMadeLabel = 'Payment Made',
  dueAmountLabel = 'Balance Due',

  // # Line Discount
  lineDiscountLabel = 'Discount',
  showLineDiscount = false,

  // Totals
  showTotal = true,
  total = '$662.75',

  showSubtotal = true,
  showDiscount = true,
  showTaxes = true,
  showPaymentMade = true,
  showDueAmount = true,
  showAdjustment = true,

  subtotal = '630.00',
  discount = '0.00',
  adjustment = '',
  paymentMade = '100.00',
  dueAmount = '$562.75',

  // Footer paragraphs.
  termsConditionsLabel = 'Terms & Conditions',
  showTermsConditions = true,
  termsConditions = DefaultPdfTemplateTerms,

  lines = [
    {
      item: DefaultPdfTemplateItemName,
      description: DefaultPdfTemplateItemDescription,
      rate: '1',
      quantity: '1000',
      total: '$1000.00',
    },
  ],
  taxes = [
    { label: 'Sample Tax1 (4.70%)', amount: '11.75' },
    { label: 'Sample Tax2 (7.00%)', amount: '21.74' },
  ],

  // # Statement
  statementLabel = 'Statement',
  showStatement = true,
  statement = DefaultPdfTemplateStatement,
  compliance,
  layout,
  ...props
}: InvoicePaperTemplateProps) {
  // A tax document prints its own title and bilingual labels.
  const L = compliance?.labels;
  const title = compliance ? [compliance.title, compliance.subtitle].filter(Boolean).join('\n') : 'Invoice';
  // 103 DiTech: blocks and columns in the order the designer saved; required
  // ones stay on for a tax document. Without a saved layout: the default order.
  const view = effectiveLayout(layout, !!compliance);
  const columnVisible = (id: string) => view.columns.find((c) => c.id === id)?.visible !== false;

  type TableColumn = Parameters<typeof PaperTemplate.Table>[0]['columns'][number];
  const columnDefs: Record<string, TableColumn> = {
    item: {
      label: L?.item ?? lineItemLabel,
      accessor: (data: Record<string, any>) => (
        <Stack spacing={2}>
          <Text>{data.item}</Text>
          <Text color={'#5f6b7c'} fontSize={12}>
            {data.description}
          </Text>
        </Stack>
      ),
      thStyle: { width: '60%' },
    },
    quantity: { label: L?.quantity ?? lineQuantityLabel, accessor: 'quantity', align: 'right' },
    rate: { label: L?.rate ?? lineRateLabel, accessor: 'rate', align: 'right' },
    // Without a saved layout the discount column follows the template switch.
    discount: { label: lineDiscountLabel, accessor: 'discount', align: 'right', visible: layout ? columnVisible('discount') : showLineDiscount },
    total: { label: L?.total ?? lineTotalLabel, accessor: 'total', align: 'right' },
  };
  const columns = view.columns
    .filter((c) => c.id === 'discount' || c.visible)
    .map((c) => columnDefs[c.id]);

  const renderers: Record<string, () => ReactNode> = {
    header: () => (
      <Group align="start" spacing={10}>
        <Stack flex={1}>
          <PaperTemplate.BigTitle title={title} />

          <PaperTemplate.TermsList>
            {showInvoiceNumber && (
              <PaperTemplate.TermsItem label={L?.invoiceNumber ?? invoiceNumberLabel}>
                {invoiceNumber}
              </PaperTemplate.TermsItem>
            )}
            {showDateIssue && (
              <PaperTemplate.TermsItem label={L?.dateIssue ?? dateIssueLabel}>
                {dateIssue}
              </PaperTemplate.TermsItem>
            )}
            {showDueDate && (
              <PaperTemplate.TermsItem label={L?.dueDate ?? dueDateLabel}>
                {dueDate}
              </PaperTemplate.TermsItem>
            )}
          </PaperTemplate.TermsList>
        </Stack>

        {companyLogoUri && showCompanyLogo && (
          <PaperTemplate.Logo logoUri={companyLogoUri} />
        )}
      </Group>
    ),
    parties: () =>
      compliance ? (
        <ComplianceParties compliance={compliance} />
      ) : (
        <PaperTemplate.AddressesGroup>
          {showCompanyAddress && (
            <PaperTemplate.Address>
              <Box dangerouslySetInnerHTML={{ __html: companyAddress }} />
            </PaperTemplate.Address>
          )}
          {showCustomerAddress && (
            <PaperTemplate.Address>
              <strong>{billedToLabel}</strong>
              <Box dangerouslySetInnerHTML={{ __html: customerAddress }} />
            </PaperTemplate.Address>
          )}
        </PaperTemplate.AddressesGroup>
      ),
    lines: () => <PaperTemplate.Table columns={columns} data={lines} />,
    totals: () => (
      <PaperTemplate.Totals>
        {showSubtotal && (
          <PaperTemplate.TotalLine
            label={L?.subtotal ?? subtotalLabel}
            amount={subtotal}
            border={PaperTemplateTotalBorder.Gray}
          />
        )}
        {showDiscount && !isEmpty(discount) && (
          <PaperTemplate.TotalLine
            label={L?.discount ?? discountLabel}
            amount={discount}
          />
        )}
        {showAdjustment && !isEmpty(adjustment) && (
          <PaperTemplate.TotalLine
            label={adjustmentLabel}
            amount={adjustment}
          />
        )}
        {showTaxes && (
          <>
            {taxes.map((tax, index) => (
              <PaperTemplate.TotalLine
                key={index}
                label={tax.label}
                amount={tax.amount}
              />
            ))}
          </>
        )}
        {showTotal && (
          <PaperTemplate.TotalLine
            label={L?.grandTotal ?? totalLabel}
            amount={total}
            border={PaperTemplateTotalBorder.Dark}
            style={{ fontWeight: 500 }}
          />
        )}
        {showPaymentMade && (
          <PaperTemplate.TotalLine
            label={L?.paymentMade ?? paymentMadeLabel}
            amount={paymentMade}
          />
        )}
        {showDueAmount && (
          <PaperTemplate.TotalLine
            label={L?.dueAmount ?? dueAmountLabel}
            amount={dueAmount}
            border={PaperTemplateTotalBorder.Dark}
            style={{ fontWeight: 500 }}
          />
        )}
      </PaperTemplate.Totals>
    ),
    khr: () => (compliance ? <ComplianceKhrBox compliance={compliance} /> : null),
    notes: () => (
      <Stack spacing={0}>
        {showTermsConditions && termsConditions && (
          <PaperTemplate.Statement label={termsConditionsLabel}>
            {termsConditions}
          </PaperTemplate.Statement>
        )}

        {showStatement && statement && (
          <PaperTemplate.Statement label={statementLabel}>
            {statement}
          </PaperTemplate.Statement>
        )}
      </Stack>
    ),
    // Without a tax profile, signature lines only print when a layout asks for them.
    signatures: () =>
      compliance ? (
        <ComplianceSignatures compliance={compliance} />
      ) : layout ? (
        <PlainSignatures />
      ) : null,
    text1: () => <CustomText text={view.blocks.find((b) => b.id === 'text1')?.text} />,
    text2: () => <CustomText text={view.blocks.find((b) => b.id === 'text2')?.text} />,
  };

  // Lines, totals and the riel box sit together when they follow each other.
  const TIGHT = new Set(['lines', 'totals', 'khr']);
  const groups: string[][] = [];
  for (const block of view.blocks.filter((b) => b.visible)) {
    const last = groups[groups.length - 1];
    if (last && TIGHT.has(block.id) && TIGHT.has(last[last.length - 1])) last.push(block.id);
    else groups.push([block.id]);
  }

  return (
    <PaperTemplate
      primaryColor={primaryColor}
      secondaryColor={secondaryColor}
      {...(layout ? { fontSize: `${view.fontSize}px` } : {})}
      {...props}
    >
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
    </PaperTemplate>
  );
}
