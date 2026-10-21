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
  DefaultPdfTemplateItemName,
  DefaultPdfTemplateAddressBilledTo,
  DefaultPdfTemplateAddressBilledFrom,
} from './_constants';
import { ComplianceKhrBox, ComplianceParties, ComplianceProps, ComplianceSignatures } from './Compliance';

interface CreditNoteLine {
  item?: string;
  description?: string;
  quantity?: string;
  rate?: string;
  total?: string;
}

export interface CreditNotePaperTemplateProps extends PaperTemplateProps {
  /** 103 DiTech: Cambodian tax document (title, TINs, riel, Khmer/English labels, signatures). */
  compliance?: ComplianceProps;

  primaryColor?: string;
  secondaryColor?: string;

  // Company
  showCompanyLogo?: boolean;
  companyLogoUri?: string;

  companyName?: string;

  // Credit Note number
  showCreditNoteNumber?: boolean;
  creditNoteNumebr?: string;
  creditNoteNumberLabel?: string;

  // Credit Note date
  showCreditNoteDate?: boolean;
  creditNoteDate?: string;
  creditNoteDateLabel?: string;

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

  // Subtotal
  showSubtotal?: boolean;
  subtotalLabel?: string;
  subtotal?: string;

  // Total
  showTotal?: boolean;
  totalLabel?: string;
  total?: string;

  // Customer Note
  showCustomerNote?: boolean;
  customerNote?: string;
  customerNoteLabel?: string;

  // Terms & Conditions
  showTermsConditions?: boolean;
  termsConditions?: string;
  termsConditionsLabel?: string;

  lines?: Array<CreditNoteLine>;
}

export function CreditNotePaperTemplate({
  // # Colors
  primaryColor,
  secondaryColor,

  showCompanyLogo = true,
  companyLogoUri = '',

  // # Credit Note number
  creditNoteNumberLabel = 'Credit Note Number',
  creditNoteNumebr = '346D3D40-0001',
  showCreditNoteNumber = true,

  // # Credit Note date
  creditNoteDate = 'September 3, 2024',
  creditNoteDateLabel = 'Credit Note Date',
  showCreditNoteDate = true,

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

  // Subtotal
  subtotalLabel = 'Subtotal',
  showSubtotal = true,
  subtotal = '1000.00',

  // Total
  totalLabel = 'Total',
  showTotal = true,
  total = '$1000.00',

  // Customer Note
  showCustomerNote = true,
  customerNote = '',
  customerNoteLabel = 'Customer Note',

  // Terms & Conditions
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
  compliance,
  ...props
}: CreditNotePaperTemplateProps) {
  const L = compliance?.labels;
  const title = compliance ? [compliance.title, compliance.subtitle].filter(Boolean).join('\n') : 'Credit Note';
  return (
    <PaperTemplate
      primaryColor={primaryColor}
      secondaryColor={secondaryColor}
      {...props}
    >
      <Stack spacing={24}>
        <Group align="start" spacing={10}>
          <Stack flex={1}>
            <PaperTemplate.BigTitle title={title} />

            <PaperTemplate.TermsList>
              {showCreditNoteNumber && (
                <PaperTemplate.TermsItem label={L?.creditNoteNumber ?? creditNoteNumberLabel}>
                  {creditNoteNumebr}
                </PaperTemplate.TermsItem>
              )}
              {showCreditNoteDate && (
                <PaperTemplate.TermsItem label={L?.dateIssue ?? creditNoteDateLabel}>
                  {creditNoteDate}
                </PaperTemplate.TermsItem>
              )}
            </PaperTemplate.TermsList>
          </Stack>

          {companyLogoUri && showCompanyLogo && (
            <PaperTemplate.Logo logoUri={companyLogoUri} />
          )}
        </Group>

        {compliance ? (
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
        )}

        <Stack spacing={0}>
          <PaperTemplate.Table
            columns={[
              {
                label: L?.item ?? lineItemLabel,
                accessor: (data) => (
                  <Stack spacing={2}>
                    <Text>{data.item}</Text>
                    {data.description && (
                      <Text color={'#5f6b7c'} fontSize={12}>
                        {data.description}
                      </Text>
                    )}
                  </Stack>
                ),
                thStyle: { width: '60%' },
              },
              {
                label: L?.quantity ?? lineQuantityLabel,
                accessor: 'quantity',
                align: 'right',
              },
              { label: L?.rate ?? lineRateLabel, accessor: 'rate', align: 'right' },
              { label: L?.total ?? lineTotalLabel, accessor: 'total', align: 'right' },
            ]}
            data={lines}
          />
          <PaperTemplate.Totals>
            {showSubtotal && (
              <PaperTemplate.TotalLine
                label={L?.subtotal ?? subtotalLabel}
                amount={subtotal}
                border={PaperTemplateTotalBorder.Gray}
              />
            )}
            {showTotal && (
              <PaperTemplate.TotalLine
                label={L?.totalInclTax ?? totalLabel}
                amount={total}
                border={PaperTemplateTotalBorder.Dark}
                style={{ fontWeight: 500 }}
              />
            )}
          </PaperTemplate.Totals>
          {compliance && <ComplianceKhrBox compliance={compliance} />}
        </Stack>

        <Stack spacing={0}>
          {showCustomerNote && customerNote && (
            <PaperTemplate.Statement label={customerNoteLabel}>
              {customerNote}
            </PaperTemplate.Statement>
          )}

          {showTermsConditions && termsConditions && (
            <PaperTemplate.Statement label={termsConditionsLabel}>
              {termsConditions}
            </PaperTemplate.Statement>
          )}
        </Stack>

        {compliance && <ComplianceSignatures compliance={compliance} />}
      </Stack>
    </PaperTemplate>
  );
}
