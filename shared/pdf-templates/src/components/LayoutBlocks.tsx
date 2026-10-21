import { x } from '@xstyled/emotion';
import { Box } from '../lib/layout/Box';
import { Group } from '../lib/layout/Group';

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
