/**
 * PostJobSheet — "Post a job" for a vehicle the viewer owns, added or has access to (post_work_request),
 * sent only from the server's own post_work_request action. The client's own words, a contact-details
 * warning, open or invite only, an optional needed-by date. The answer's suggested cost is shown as
 * hours only: its rate is a placeholder, so no dollar figure is derived from it.
 */
import React, { useState } from 'react';
import { Text, Rows, Row } from '../../kit';
import { PrefetchLink } from '../../components/PrefetchLink';
import { SignSheet } from './SignSheet';
import { JobSigns, NO_SHOP_RATE, hasContactDetails, jobHref, postArgs, rangeHours, requirementKind, type JobAction, type PostedJob } from './jobsReaders';

const SAYS = ['Your job is listed on Nuke in your own words, for this vehicle.', 'Technicians can offer to do it; you choose whether to accept.'];
const NOT = ['That anyone is booked', 'Any payment', 'A price — any hours shown are a rough guide'];

export function PostedJobView({ posted }: { posted: PostedJob }) {
  const cost = posted.suggested_cost;
  return <div className="jb-says" aria-label="Job posted">
    <Text role="body" className="jb-done">{posted.duplicate ? 'You already posted this exact job.' : 'Your job is posted.'}</Text>
    <Text role="body">{posted.listed_in_open_requirements
      ? <>It is listed on <PrefetchLink to="/jobs">Jobs looking for someone</PrefetchLink>.</>
      : posted.visibility === 'invite_only' ? "It isn't listed; you choose whom to ask." : "It isn't listed publicly because this vehicle is private."}</Text>
    <PrefetchLink to={jobHref(posted.work_order_id)}><Text role="body">Open the job</Text></PrefetchLink>
    <Text role="caption">No one is booked and no one has been notified. Technicians offer; you decide.</Text>
    {posted.operations && posted.operations.length > 0 && <Rows title="What you asked for">
      {posted.operations.map(o => <Row key={o.line_number} label={`Item ${o.line_number}`}>{o.text}</Row>)}
    </Rows>}
    {posted.requirements && posted.requirements.length > 0 && <Rows title="Who or what it needs">
      {posted.requirements.map(r => <Row key={r.requirement_id} label={requirementKind(r.kind)}>{r.description}</Row>)}
    </Rows>}
    {cost?.lines && cost.lines.length > 0 && <Rows title="Rough hours">
      {cost.lines.map(l => <Row key={l.line_number} label={l.text ?? `Item ${l.line_number}`} role="measure">{rangeHours(l.hours) ?? 'no reference hours'}</Row>)}
    </Rows>}
    {cost && <Text role="caption">Rough guide from reference hours, not a quote. {NO_SHOP_RATE}</Text>}
  </div>;
}

export default function PostJobSheet({ action, vehicleTitle, onClose }: { action: JobAction; vehicleTitle: string; onClose: () => void }) {
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'open' | 'invite_only'>('open');
  const [neededBy, setNeededBy] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [posted, setPosted] = useState<PostedJob | null>(null);

  const post = async () => {
    setFailure(null);
    const built = postArgs(action, description, neededBy || null, visibility);
    if ('error' in built) { setFailure(built.error); return; }
    setBusy(true);
    const r = await JobSigns.postWorkRequest(built.args);
    setBusy(false);
    if (r.refusal) setFailure(`Not posted. ${r.refusal.message}`);
    else setPosted(r.data);
  };

  return <SignSheet title={posted ? 'Job posted' : 'Post a job'} says={SAYS} doesNotSay={NOT} confirmLabel="Post the job" onConfirm={post} onClose={onClose}
    busy={busy} failure={failure} done={posted && <PostedJobView posted={posted} />}>
    <div className="jb-field"><Text role="label">Vehicle</Text><Text role="body">{vehicleTitle}</Text></div>
    {!posted && <>
      <label className="jb-field"><Text role="label">The work, in your own words</Text>
        <textarea className="jb-input k-body" value={description} maxLength={4000} onChange={e => setDescription(e.target.value)} /></label>
      {hasContactDetails(description)
        ? <Text role="body" className="jb-warn">This looks like a phone number or email. Take it out; people reach you through Nuke.</Text>
        : <Text role="caption">Don't include phone numbers or emails — people reach you through Nuke. One sentence per thing to do helps technicians see each part.</Text>}
      <div className="jb-field" role="radiogroup" aria-label="Who can see it">
        <Text role="label">Who can see it</Text>
        <div className="jb-choice">
          <label><input type="radio" name="jb-visibility" checked={visibility === 'open'} onChange={() => setVisibility('open')} /> <Text role="body">Open</Text></label>
          <label><input type="radio" name="jb-visibility" checked={visibility === 'invite_only'} onChange={() => setVisibility('invite_only')} /> <Text role="body">Invite only</Text></label>
        </div>
        <Text role="caption">{visibility === 'open' ? 'Open: technicians can see it on Jobs.' : "Invite only: it isn't listed; you choose whom to ask."}</Text>
      </div>
      <label className="jb-field"><Text role="label">Needed by (optional)</Text>
        <input type="date" className="jb-input k-body" value={neededBy} onChange={e => setNeededBy(e.target.value)} /></label>
    </>}
  </SignSheet>;
}
