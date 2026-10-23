import { CreditNotePdfTemplateAttributes } from './types/CreditNotes.types';
import { CreditNoteResponseDto } from './dtos/CreditNoteResponse.dto';
import { contactAddressTextFormat } from '@/utils/address-text-format';

export const transformCreditNoteToPdfTemplate = (
  creditNote: CreditNoteResponseDto,
): Partial<CreditNotePdfTemplateAttributes> => {
  return {
    creditNoteDate: creditNote.formattedCreditNoteDate,
    creditNoteNumebr: creditNote.creditNoteNumber,

    // 103 DiTech: the total after discount and taxes, with each tax on its line.
    total: (creditNote as any).totalFormatted ?? creditNote.formattedAmount,
    subtotal: creditNote.formattedSubtotal,
    discount: (creditNote as any).discountAmount
      ? (creditNote as any).discountAmountFormatted
      : undefined,
    taxes: ((creditNote as any).taxLines ?? []).map((tax) => ({
      label: `${tax.name} [${tax.rate}%]`,
      amount: tax.amountFormatted,
    })),

    lines: creditNote.entries?.map((entry) => ({
      item: entry.item.name,
      description: entry.description,
      rate: entry.rateFormatted,
      quantity: entry.quantityFormatted,
      total: entry.totalFormatted,
    })),
    customerNote: creditNote.note,
    termsConditions: creditNote.termsConditions,
    customerAddress: contactAddressTextFormat(creditNote.customer),
  };
};

export const transformCreditNoteToMailDataArgs = (creditNote: any) => {
  return {
    'Customer Name': creditNote.customer?.displayName,
    'Credit Note Number': creditNote.creditNoteNumber,
    'Credit Note Date': creditNote.formattedCreditNoteDate,
    'Credit Note Amount': creditNote.formattedAmount,
  };
};
