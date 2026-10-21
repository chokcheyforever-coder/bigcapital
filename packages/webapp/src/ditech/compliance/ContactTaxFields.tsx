// @ts-nocheck
import { FCheckbox, FFormGroup, FInputGroup, FTextArea } from '@/components';

/**
 * 103 DiTech: a customer's or vendor's Cambodian tax details. A registered
 * taxpayer with a TIN gets VAT invoices; the Khmer name and address are
 * printed on tax documents.
 */
export function ContactTaxFields() {
  return (
    <>
      <FFormGroup name={'taxNumber'} label={'TIN (VATTIN)'} inline>
        <FInputGroup name={'taxNumber'} placeholder={'K001-123456789'} />
      </FFormGroup>
      <FFormGroup name={'registeredTaxpayer'} label={' '} inline>
        <FCheckbox name={'registeredTaxpayer'} label={'Registered taxpayer (gets VAT invoices)'} />
      </FFormGroup>
      <FFormGroup name={'displayNameKm'} label={'Name in Khmer'} inline>
        <FInputGroup name={'displayNameKm'} />
      </FFormGroup>
      <FFormGroup name={'billingAddressKm'} label={'Address in Khmer'} inline>
        <FTextArea name={'billingAddressKm'} growVertically />
      </FFormGroup>
    </>
  );
}
