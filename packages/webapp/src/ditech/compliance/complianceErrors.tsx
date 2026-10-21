// 103 DiTech: Cambodian tax document refusals (missing TIN or riel rate when an
// invoice, receipt or credit note is issued; deleting an issued one). Shown
// once for every form, with a link to where it is fixed.
import { Intent } from '@blueprintjs/core';
import { AppToaster } from '@/components';

export const TAX_COMPLIANCE_ERRORS = ['SELLER_TIN_MISSING', 'BUYER_TIN_MISSING', 'KHR_RATE_MISSING', 'TAX_DOCUMENT_ISSUED'];

/** Shows a tax document refusal; returns true when the errors held one. */
export function showTaxComplianceError(errors: Array<{ type?: string; message?: string }> | undefined): boolean {
  const error = errors?.find((e) => e.type && TAX_COMPLIANCE_ERRORS.includes(e.type));
  if (!error) return false;
  const toSettings = error.type === 'SELLER_TIN_MISSING' || error.type === 'KHR_RATE_MISSING';
  AppToaster.show({
    intent: Intent.DANGER,
    timeout: 12000,
    message: error.message ?? 'This is not a valid tax document yet.',
    action: toSettings ? { text: 'Tax compliance settings', onClick: () => (window.location.href = '/preferences/tax-compliance') } : undefined,
  });
  return true;
}
