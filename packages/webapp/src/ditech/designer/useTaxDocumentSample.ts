// 103 DiTech: whether the company issues Cambodian tax documents, and a sample
// tax block (TINs, riel box, Khmer/English labels) for the designer preview.
import { useQuery } from '@tanstack/react-query';
import { useAuthOrganizationId, useAuthToken } from '@/hooks/state';
import { transformToCamelCase } from '@/utils';

export function useTaxDocumentSample() {
  const token = useAuthToken();
  const organizationId = useAuthOrganizationId();
  return useQuery({
    queryKey: ['TAX_DOCUMENT_SAMPLE', organizationId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await fetch('/api/tax-compliance/sample', {
        headers: { Authorization: `Bearer ${token}`, 'organization-id': organizationId ?? '', accept: 'application/json' },
      });
      if (!res.ok) return null;
      const body = await res.json();
      // Empty object: tax documents are off.
      return body && body.title ? transformToCamelCase(body) : null;
    },
  });
}
