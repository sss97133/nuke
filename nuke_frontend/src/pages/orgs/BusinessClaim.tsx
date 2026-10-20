/**
 * Businesses join Nuke by claiming their organization (claim_organization), and customers invite a business that is not on
 * Nuke yet by sharing a single-use link themselves (create_supplier_invite) — Nuke sends nothing. No e-mail address is
 * shown, sent or stored by these sheets; the domain rule is the server's.
 */
import React, { useState } from 'react';
import { Text } from '../../kit';
import { SignSheet } from '../jobs/SignSheet';
import { day, sentence, str, strings, type JsonObject } from '../jobs/jobRead';
import { DOCUMENT_TYPES, claimArgs } from './claimDrafts';
import { useWriter } from '../jobs/useWriter';

/** claim_organization, offered from the organization's on_nuke.claim (methods and domain rule). */
export function ClaimBusinessSheet({ organizationId, name, claim, domainQualifies, onClose, onDone }: {
  organizationId: string; name: string; claim: JsonObject | null; domainQualifies?: boolean | null; onClose: () => void; onDone: () => void;
}) {
  const methods = strings(claim?.methods).filter(m => m === 'domain_email' || m === 'document');
  const [method, setMethod] = useState(methods.includes('domain_email') && domainQualifies !== false ? 'domain_email' : methods[0] ?? 'document');
  const [docType, setDocType] = useState('business_license');
  const [docUrl, setDocUrl] = useState('');
  const w = useWriter();
  const domain = str(claim?.domain);
  const says = method === 'domain_email'
    ? [`You run ${name}: your confirmed sign-in e-mail is at ${domain ?? 'its website domain'}, which makes you an owner on Nuke now.`]
    : [`You run ${name}, as the document you link shows. Nuke reviews it before you become an owner.`];
  const doesNotSay = ['Your e-mail address: Nuke checks only its domain and never shows or stores it', 'Any job, offer or payment', 'No money moves'];
  const send = async () => {
    const built = claimArgs(organizationId, method, docType, docUrl);
    if (!built.ok) { w.setFailure(built.error); return; }
    await w.run('claim_organization', built.args);
  };
  const state = str(w.done?.state);
  return <SignSheet title={`Claim ${name}`} says={says} doesNotSay={doesNotSay} confirmLabel="Claim this business" onConfirm={send}
    onClose={w.done ? () => { onDone(); onClose(); } : onClose} busy={w.busy} failure={w.failure}
    done={w.done && <Text role="body" className="jb-done">{state === 'pending_review'
      ? 'Claim received. Nuke reviews your document; you become an owner when it is approved.'
      : w.done.duplicate === true ? 'You already run this business on Nuke.' : `Claimed. You run ${name} on Nuke and can receive requests for it.`}</Text>}>
    {!w.done && <>
      {methods.length > 1 && <div className="jb-choice" role="radiogroup" aria-label="How you prove it">
        {methods.map(m => <label key={m}><input type="radio" name="claim-method" checked={method === m} onChange={() => setMethod(m)} />
          <Text role="body">{m === 'domain_email' ? `My sign-in e-mail is at ${domain ?? 'its domain'}` : 'Upload proof: a document link'}</Text></label>)}
      </div>}
      {method === 'domain_email' && <Text role="caption">{str(claim?.domain_email_rule) ?? "Your confirmed sign-in e-mail must be at this business's website domain."}
        {domainQualifies === false ? " Yours isn't; claim with a document instead." : ''}</Text>}
      {method === 'document' && <>
        <label className="jb-field"><Text role="label">Document</Text>
          <select className="jb-input k-body" aria-label="Document type" value={docType} onChange={e => setDocType(e.target.value)}>
            {DOCUMENT_TYPES.map(t => <option key={t} value={t}>{sentence(t)}</option>)}</select></label>
        <label className="jb-field"><Text role="label">Link to the document (https)</Text>
          <input className="jb-input k-body" aria-label="Document link" inputMode="url" value={docUrl} onChange={e => setDocUrl(e.target.value)} /></label>
        <Text role="caption">Only Nuke's reviewers open the document. It is not shown on the business page.</Text>
      </>}
    </>}
  </SignSheet>;
}

/** create_supplier_invite: a single-use, 14-day link the customer copies and shares with the business. Nuke sends nothing. */
export function InviteSupplierSheet({ organizationId, name, requirementId, onClose }: { organizationId: string; name: string; requirementId: string; onClose: () => void }) {
  const w = useWriter();
  const [copied, setCopied] = useState(false);
  const send = async () => { await w.run('create_supplier_invite', { p_organization_id: organizationId, p_requirement_id: requirementId }); };
  const path = str(w.done?.share_path);
  const link = path && typeof window !== 'undefined' ? `${window.location.origin}${path.startsWith('/') ? path : `/${path}`}` : null;
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); }
  };
  const done = w.done && (w.done.available === false
    ? <Text role="body">{str(w.done.reason) === 'already_on_nuke' ? `${name} is on Nuke now: contact them through Nuke instead.` : 'This invite is not available.'}</Text>
    : <div className="jb-field">
      <Text role="body" className="jb-done">Invite ready. Share this link with {name} yourself — Nuke sends nothing.</Text>
      <input className="jb-input k-body" aria-label="Invite link" readOnly value={link ?? ''} onFocus={e => e.target.select()} />
      <div className="jb-actions"><button type="button" className="btn-base btn-sm btn-primary" onClick={copy}><Text role="label">{copied ? 'Copied' : 'Copy link'}</Text></button></div>
      <Text role="caption">{`Works once${day(str(w.done.expires_at)) ? `, until ${day(str(w.done.expires_at))}` : ', for 14 days'}. It shows them this need and lets them claim the business.`}</Text>
    </div>);
  return <SignSheet title={`Invite ${name}`} says={[`You invite ${name} to see this need on Nuke and claim their business, with a link you share yourself.`]}
    doesNotSay={['That Nuke contacts them: Nuke sends nothing', 'Your contact details, or theirs', 'Any order or payment']}
    confirmLabel="Create invite link" onConfirm={send} onClose={onClose} busy={w.busy} failure={w.failure} done={done}>
    <Text role="body">{`${name} is not on Nuke yet, so it can't receive requests here.`}</Text>
  </SignSheet>;
}

