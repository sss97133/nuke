/**
 * A job's publication (work_order_publication_read / vehicle_work_publication_read): its visibility, and the publish or
 * unpublish steps the server offers the customer or vehicle owner as viewer.actions. When the server attaches a refusal
 * reason (names or contact details block 'open'), the step shows that reason instead of a confirm.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Text } from '../../kit';
import { PrefetchLink } from '../../components/PrefetchLink';
import { SignSheet } from './SignSheet';
import { arr, obj, parseActions, str, type JobAction, type JsonObject } from './jobRead';
import { lastSignLine, listingLine, publicationTitle, visibilityWords } from './publicationWords';
import { readJob } from './readJob';
import { termsOf, useWriter } from './useWriter';

function PublishSheet({ action, current, onClose, onDone }: { action: JobAction; current: string | null; onClose: () => void; onDone: () => void }) {
  const w = useWriter();
  const { says, doesNotSay } = termsOf(action);
  const title = publicationTitle(action, current);
  const send = async () => {
    const id = str(action.args.p_work_order_id);
    if (!id || !['publish_work_order', 'unpublish_work_order'].includes(action.rpc ?? '')) { w.setFailure('This job changed. Reload and try again.'); return; }
    await w.run(action.rpc!, action.rpc === 'publish_work_order' ? { p_work_order_id: id, p_visibility: str(action.args.p_visibility) } : { p_work_order_id: id });
  };
  const derived = arr(w.done?.requirements_derived).length;
  return <SignSheet title={title} says={says} doesNotSay={doesNotSay} confirmLabel={title} onConfirm={send}
    onClose={w.done ? () => { onDone(); onClose(); } : onClose} busy={w.busy} failure={w.failure}
    done={w.done && <Text role="body" className="jb-done">{w.done.visibility === 'open'
      ? `Open. ${derived ? `${derived} need${derived === 1 ? '' : 's'} recorded from your description. ` : ''}Technicians near you can now offer.`
      : 'Invite only. Its needs stay on record but are not listed.'}</Text>}>
    <div className="jb-field"><Text role="label">Now</Text><Text role="body">{visibilityWords(current)}</Text></div>
  </SignSheet>;
}

/** The publication steps for one job, as buttons; a refused step shows the server's reason instead. */
export function PublicationActions({ state, onChanged }: { state: JsonObject | null; onChanged: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const actions = parseActions(obj(state?.viewer)?.actions);
  const current = str(state?.visibility);
  if (!actions.length) return null;
  return <div className="jb-actions" role="group" aria-label="Publish this job">
    {actions.map((a, i) => {
      const refused = str(a.raw.refused_reason);
      return <div key={i} className="job-block">
        <button type="button" className="btn-base btn-sm btn-secondary" disabled={!!refused} onClick={() => setOpen(i)}>
          <Text role="label">{publicationTitle(a, current)}</Text></button>
        {refused && <Text role="caption">{refused}</Text>}
      </div>;
    })}
    {open !== null && actions[open] && <PublishSheet action={actions[open]} current={current} onClose={() => setOpen(null)} onDone={onChanged} />}
  </div>;
}

/** The job page's publication block: visibility for everyone who can read the job, steps for the publication party. */
export function JobPublication({ workOrderId }: { workOrderId: string }) {
  const [state, setState] = useState<JsonObject | null>(null);
  const load = useCallback(() => { readJob('work_order_publication_read', { p_work_order_id: workOrderId }).then(l => setState(l.status === 'loaded' ? l.data : null)); }, [workOrderId]);
  useEffect(() => { load(); }, [load]);
  if (!state) return null;
  const listing = listingLine(state);
  return <div className="job-block" role="group" aria-label="Publication">
    <Text role="label">Publication</Text>
    <Text role="body">{visibilityWords(str(state.visibility))}</Text>
    {(listing || lastSignLine(state)) && <Text role="caption">{[listing, lastSignLine(state)].filter(Boolean).join(' · ')}</Text>}
    {state.listed_in_open_requirements === true && <PrefetchLink className="job-link" to="/jobs"><Text role="caption">See it on Jobs</Text></PrefetchLink>}
    <PublicationActions state={state} onChanged={load} />
  </div>;
}

/** A vehicle Work row's publication line and steps. */
export function PublicationRow({ state, onChanged }: { state: JsonObject | null; onChanged: () => void }) {
  if (!state) return null;
  return <>
    <Text role="caption">{[visibilityWords(str(state.visibility)), listingLine(state)].filter(Boolean).join(' · ')}</Text>
    <PublicationActions state={state} onChanged={onChanged} />
  </>;
}
