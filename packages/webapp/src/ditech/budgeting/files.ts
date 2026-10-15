// Budget file endpoints (export, template, import) use plain fetch: binary
// downloads and multipart uploads, with the same auth headers as the SDK.
import { useCallback } from 'react';
import { useAuthOrganizationId, useAuthToken } from '@/hooks/state';

export function useBudgetFiles() {
  const token = useAuthToken();
  const organizationId = useAuthOrganizationId();
  const headers = { Authorization: `Bearer ${token}`, 'organization-id': organizationId ?? '' };

  const download = useCallback(
    async (path: string, fallbackName: string) => {
      const res = await fetch(path, { headers });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') ?? '';
      const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? fallbackName;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, organizationId],
  );

  const upload = useCallback(
    async (path: string, file: File, fields: Record<string, string> = {}) => {
      const form = new FormData();
      form.append('file', file);
      for (const [k, v] of Object.entries(fields)) form.append(k, v);
      const res = await fetch(path, { method: 'POST', headers, body: form });
      const body = await res.json().catch(() => null);
      return { status: res.status, ok: res.ok, body };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, organizationId],
  );

  return { download, upload };
}
