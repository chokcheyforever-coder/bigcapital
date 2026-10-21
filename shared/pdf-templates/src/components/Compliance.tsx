import { x } from '@xstyled/emotion';
import { Box } from '../lib/layout/Box';
import { Group } from '../lib/layout/Group';
import { Stack } from '../lib/layout/Stack';

/**
 * 103 DiTech: the parts of a Cambodian tax document (Prakas 723, Notification
 * 4908 GDT), filled by the server's TaxDocumentPdfService. When a template
 * gets no `compliance` prop it prints exactly as before.
 */
export interface ComplianceParty {
  name: string;
  nameKm?: string | null;
  address?: string | null;
  addressKm?: string | null;
  tin?: string | null;
}

export interface ComplianceProps {
  language: 'km_en' | 'km' | 'en';
  title: string;
  subtitle?: string;
  seller: ComplianceParty;
  buyer: ComplianceParty;
  labels: Record<string, string>;
  khr?: { label: string; rate: string; source: string; date: string; subtotal: string; tax: string; total: string };
  signatory?: { name?: string | null; title?: string | null };
}

const muted = '#5f6b7c';

function Party({ heading, party, tinLabel, language }: { heading: string; party: ComplianceParty; tinLabel: string; language: ComplianceProps['language'] }) {
  const showKm = language !== 'en';
  const showEn = language !== 'km';
  return (
    <Stack spacing={2}>
      <x.div color={muted} whiteSpace={'pre-line'}>
        {heading}
      </x.div>
      {showKm && party.nameKm && <x.div fontWeight={600}>{party.nameKm}</x.div>}
      {(showEn || !party.nameKm) && <x.div fontWeight={showKm && party.nameKm ? 400 : 600}>{party.name}</x.div>}
      {showKm && party.addressKm && <x.div>{party.addressKm}</x.div>}
      {(showEn || !party.addressKm) && party.address && <x.div>{party.address}</x.div>}
      {party.tin && (
        <x.div mt={'4px'}>
          <x.span color={muted}>{tinLabel.split('\n')[language === 'km' ? 0 : tinLabel.split('\n').length - 1]}: </x.span>
          <x.span fontWeight={600}>{party.tin}</x.span>
        </x.div>
      )}
    </Stack>
  );
}

/** Seller and buyer, each with its TIN. */
export function ComplianceParties({ compliance }: { compliance: ComplianceProps }) {
  return (
    <Group spacing={24} align={'flex-start'} data-testid="compliance-parties">
      <Box flex={1}>
        <Party heading={compliance.labels.seller} party={compliance.seller} tinLabel={compliance.labels.tin} language={compliance.language} />
      </Box>
      <Box flex={1}>
        <Party heading={compliance.labels.buyer} party={compliance.buyer} tinLabel={compliance.labels.tin} language={compliance.language} />
      </Box>
    </Group>
  );
}

/** Amounts in riel with the rate, its source and date. */
export function ComplianceKhrBox({ compliance }: { compliance: ComplianceProps }) {
  const khr = compliance.khr;
  if (!khr) return null;
  const row = (label: string, value: string, strong = false) => (
    <x.div display={'flex'} padding={'2px 0'}>
      <x.div flex={1} whiteSpace={'pre-line'} color={strong ? '#111' : '#333'}>
        {label}
      </x.div>
      <x.div textAlign={'right'} fontWeight={strong ? 600 : 400}>
        {value}
      </x.div>
    </x.div>
  );
  return (
    <x.div ml={'auto'} w={'300px'} mt={'12px'} border={'1px solid #dadada'} p={'8px 10px'} data-testid="compliance-khr">
      <x.div fontWeight={600} mb={'4px'} whiteSpace={'pre-line'}>
        {khr.label}
      </x.div>
      {row(compliance.labels.khrRate, khr.rate)}
      <x.div color={muted} fontSize={'11px'} mb={'4px'}>
        {[khr.source, khr.date].filter(Boolean).join(' · ')}
      </x.div>
      {row(compliance.labels.khrSubtotal, khr.subtotal)}
      {row(compliance.labels.khrTax, khr.tax)}
      {row(compliance.labels.khrTotal, khr.total, true)}
    </x.div>
  );
}

/** Seller's signature (name and title from the tax profile) and the buyer's. */
export function ComplianceSignatures({ compliance }: { compliance: ComplianceProps }) {
  const box = (label: string, name?: string | null, title?: string | null) => (
    <Box flex={1}>
      <x.div h={'60px'} borderBottom={'1px solid #999'} />
      <x.div mt={'4px'} color={muted} whiteSpace={'pre-line'}>
        {label}
      </x.div>
      {name && <x.div>{name}</x.div>}
      {title && <x.div color={muted}>{title}</x.div>}
    </Box>
  );
  return (
    <Group spacing={48} align={'flex-start'} data-testid="compliance-signatures">
      {box(compliance.labels.buyerSignature)}
      {box(compliance.labels.sellerSignature, compliance.signatory?.name, compliance.signatory?.title)}
    </Group>
  );
}
