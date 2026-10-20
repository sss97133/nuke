/**
 * /supplier-invite/:token (and /invite/:token): a business opens the link a customer shared. Signed out, it asks for
 * sign-in. Signed in, "Open the invite" redeems it (redeem_supplier_invite: single use, never by its creator), then shows
 * the business, the need it was invited to, and the claim (claim_organization). Redeeming changes no membership.
 */
import React, { useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { Masthead, Row, Rows, Text } from '../../kit';
import { PrefetchLink } from '../../components/PrefetchLink';
import { useAuth } from '../../hooks/useAuth';
import { usePageTitle } from '../../hooks/usePageTitle';
import { obj, sentence, str, type JsonObject } from '../jobs/jobRead';
import { refusal } from '../jobs/signDrafts';
import { supabase } from '../../lib/supabase';
import { ClaimBusinessSheet } from './BusinessClaim';
import '../jobs/job-page.css';
import '../jobs/jobs.css';

export default function SupplierInvitePage() {
  usePageTitle('Invitation to Nuke');
  const { token = '' } = useParams<{ token: string }>();
  const location = useLocation();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [invite, setInvite] = useState<JsonObject | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);

  const redeem = async () => {
    setBusy(true); setFailure(null);
    const { data, error } = await supabase.rpc('redeem_supplier_invite', { p_token: token });
    setBusy(false);
    if (error) { setFailure(refusal(error)); return; }
    setInvite(obj(data));
  };

  const org = obj(invite?.organization);
  const name = str(org?.name) ?? 'This business';
  const req = obj(invite?.requirement);
  const claim = obj(invite?.claim);
  const onNuke = obj(invite?.on_nuke);
  const orgId = str(org?.organization_id) ?? str(obj(claim?.args)?.p_organization_id);

  return <article className="jb-page jb-scope" aria-label="Invitation to Nuke">
    <Masthead><Text role="entity" as="h1">{invite ? `${name} is invited to Nuke` : 'You were invited to Nuke'}</Text></Masthead>
    {!invite && <div className="job-block">
      <Text role="body" as="p">A customer who has bought from you shared this link so you can see a job's need and claim your business on Nuke. Nuke sent nothing; the link works once.</Text>
      {!user && <Text role="body" as="p"><a className="job-link" href={`/login?returnUrl=${encodeURIComponent(location.pathname)}`}>Sign up or sign in</a> to open it.</Text>}
      {user && <div className="jb-actions"><button type="button" className="btn-base btn-md btn-primary" disabled={busy} onClick={redeem}>
        <Text role="label">{busy ? 'Opening…' : 'Open the invite'}</Text></button></div>}
      <div role="alert" className="jb-live">{failure && <Text role="body" className="jb-warn">{failure}</Text>}</div>
    </div>}
    {invite && <>
      <Rows title="The need you were invited to">
        <Row label="Kind">{sentence(str(req?.kind) ?? 'need')}</Row>
        <Row label="Need">{str(req?.description) ?? 'Not described'}</Row>
        <Row label="Still open">{req?.still_open === false ? 'No — the job has closed' : 'Yes'}</Row>
      </Rows>
      {str(req?.work_order_id) && <Text role="body" as="p"><PrefetchLink className="job-link" to={`/jobs/${encodeURIComponent(str(req?.work_order_id)!)}`}>Open the job</PrefetchLink></Text>}
      <Rows title="Your business on Nuke">
        <Row label="Business">{orgId ? <PrefetchLink className="job-link" to={`/org/${encodeURIComponent(orgId)}`}>{name}</PrefetchLink> : name}</Row>
        <Row label="On Nuke">{claimed ? 'Claimed' : str(onNuke?.label) ?? 'Not on Nuke yet'}</Row>
        {claim?.domain_email_qualifies === true && <Row label="Fast claim">Your sign-in e-mail is at its website domain: you can claim it in one step.</Row>}
      </Rows>
      {orgId && !claimed && onNuke?.state !== 'claimed' && <div className="jb-actions">
        <button type="button" className="btn-base btn-md btn-primary" onClick={() => setClaiming(true)}><Text role="label">Claim {name}</Text></button></div>}
      <Text role="caption" as="p">Opening the invite did not make you a member; claiming does. Nobody was told your e-mail address.</Text>
      {claiming && orgId && <ClaimBusinessSheet organizationId={orgId} name={name} claim={{ ...(obj(onNuke?.claim) ?? {}), methods: claim?.methods ?? obj(onNuke?.claim)?.methods ?? ['document'] }}
        domainQualifies={typeof claim?.domain_email_qualifies === 'boolean' ? claim.domain_email_qualifies as boolean : null}
        onClose={() => setClaiming(false)} onDone={() => setClaimed(true)} />}
    </>}
  </article>;
}
