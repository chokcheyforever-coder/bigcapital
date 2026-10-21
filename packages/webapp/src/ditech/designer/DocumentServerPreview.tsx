// @ts-nocheck
// 103 DiTech: the designer preview, rendered by the server with the same
// template and code as the PDF (POST /api/tax-compliance/preview/invoice), so
// what is shown is what prints. Updates shortly after each change.
import { useEffect, useState } from 'react';
import { Spinner } from '@blueprintjs/core';
import { useFormikContext } from 'formik';
import { useAuthOrganizationId, useAuthToken } from '@/hooks/state';
import { useElementCustomizeContext } from '@/containers/ElementCustomize/ElementCustomizeProvider';

export function DocumentServerPreview({ resource = 'invoice' }: { resource?: 'invoice' }) {
  const { values } = useFormikContext();
  const { brandingState } = useElementCustomizeContext();
  const token = useAuthToken();
  const organizationId = useAuthOrganizationId();
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const key = JSON.stringify(values);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const { templateName, ...attributes } = values as any;
        const res = await fetch(`/api/tax-compliance/preview/${resource}`, {
          method: 'POST',
          signal: controller.signal,
          headers: { Authorization: `Bearer ${token}`, 'organization-id': organizationId ?? '', 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ attributes: { ...brandingState, ...attributes } }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        setHtml(body.html_content ?? body.htmlContent);
        setFailed(false);
      } catch (e) {
        if (e?.name !== 'AbortError') setFailed(true);
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (failed && !html) return <div style={{ padding: 20 }}>The preview could not be loaded.</div>;
  if (!html) return <Spinner style={{ margin: 40 }} />;
  return (
    <iframe
      title={'Document preview'}
      data-testid="document-server-preview"
      srcDoc={html}
      style={{ width: 860, height: 1180, border: 0, display: 'block', margin: '24px auto', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.15)' }}
    />
  );
}
