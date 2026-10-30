import React, { useEffect, useRef, useState } from 'react';
import { Section, Text } from '../../kit';
import { JobReaders, type RetainedWorkRead } from './jobsReaders';

/** Original document rows remain scope evidence; billing labels never become task status. */
export function RetainedWorkSection({ workOrderId, initial }: { workOrderId: string; initial: RetainedWorkRead }) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const paging = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  async function more() {
    if (paging.current || !data.next_after_source_id) return;
    paging.current = true; setBusy(true); setError(null);
    const result = await JobReaders.retainedWorkSources(workOrderId, data.next_after_source_id);
    if (!active.current) return;
    paging.current = false; setBusy(false);
    if (result.refusal) { setError(result.refusal.message); return; }
    // A withheld response clears this mounted private read instead of showing an old page.
    if (result.data.visibility !== 'included') { setData(result.data); return; }
    setData(previous => {
      const rows = new Map((previous.scope_entries ?? []).map(row => [row.source_observation_id, row]));
      for (const row of result.data.scope_entries ?? []) rows.set(row.source_observation_id, row);
      return { ...result.data, scope_entries: [...rows.values()] };
    });
  }

  if (data.visibility !== 'included') return null;
  const rows = data.scope_entries ?? [];
  const reports = data.responsibility_reports ?? [];
  if (!rows.length && !reports.length) return null;
  return <div id="retained-work"><Section title="Build records" coverage={{ n: rows.length,
    of: data.coverage?.total_source_entries ?? rows.length, grain: 'source entries', as_of: data.as_of ?? null }}>
    {reports.map(report => <div key={report.binding_id}>
      <Text role="body" as="p">{report.provider_label} owes {report.client_label} delivery of the completed vehicle.</Text>
      <Text role="caption" as="p">Owner report dated {new Date(report.reported_at).toLocaleDateString('en-US', { timeZone: 'UTC' })}
        {report.payment_state === 'paid_in_full' ? ' · payment reported settled' : ''}. This report is separate from a completion or delivery sign-off.</Text>
      <details className="job-details"><summary>Responsibility source</summary><Text role="caption">Observation {report.source_observation_id}</Text></details>
    </div>)}
    {rows.length > 0 && <>
      <Text role="body" as="p">Original build-log scope. Billing columns, including “Done,” describe billing; physical progress requires work evidence.</Text>
      <ul className="job-list">{rows.map(row => <li key={row.source_observation_id}>
        <Text role="body">{row.item}{row.category ? ` · ${row.category}` : ''}</Text>
        <Text role="caption">{row.billing_column ? `Billing: ${row.billing_column} · ` : ''}Physical progress not established by this entry</Text>
        <details className="job-details"><summary>Source: row {row.document_row}</summary>
          <Text role="caption" as="p">{row.document_label}</Text>
          <Text role="caption" as="p">Observation {row.source_observation_id} · {row.source_pointer}</Text>
        </details>
      </li>)}</ul>
    </>}
    {error && <Text role="body" as="p" aria-live="polite">{error}</Text>}
    {data.next_after_source_id && <button type="button" className="job-button" disabled={busy} onClick={() => void more()}>
      <Text role="label">{busy ? 'Loading build records…' : 'More build records'}</Text>
    </button>}
  </Section></div>;
}
