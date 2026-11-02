/**
 * Owner view: invite a contributor (create_contributor_invite) and read what came back through their link
 * (get_contributor_intake): opens with the device, answers with their attestation, documents.
 * The link is shown once, to copy and text from the owner's own phone. Nuke sends nothing.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { day, Row, Rows, Text, themeVars, vehicleTheme, type ThemeSource } from '../../kit';
import { supabase } from '../../lib/supabase';
import { arr, num, obj, str, type JsonObject } from '../jobs/jobRead';
import { useWriter } from '../jobs/useWriter';
import { IntakeLadder, movedText, readProgress } from '../contribute/IntakeLadder';
import '../jobs/jobs.css';
import '../jobs/job-page.css';
import '../contribute/contribute.css';

const RELATIONSHIPS: Array<[string, string]> = [['builder', 'Builder'], ['previous_owner', 'Previous owner'], ['shop', 'Shop'], ['appraiser', 'Appraiser']];

/** "iPhone, iOS, America/Los_Angeles" from a device attestation; never the address hash. */
export function deviceSummary(d: unknown): string {
  const o = obj(d);
  if (!o) return 'device not recorded';
  const ua = str(o.user_agent) ?? '';
  const kind = str(o.model_hint) ?? (/iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows computer' : null);
  const s = obj(o.screen);
  const screen = num(s?.w) && num(s?.h) ? `${num(s?.w)}×${num(s?.h)}` : null;
  return [kind, str(o.platform), screen, str(o.timezone)].filter(Boolean).join(', ') || 'device not identified';
}

export default function ContributorIntakeCard({ vehicleId, vehicle }: { vehicleId: string; vehicle?: (ThemeSource & { model?: unknown }) | null }) {
  const w = useWriter();
  const theme = vehicleTheme(vehicle);
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('builder');
  const [phone, setPhone] = useState('');
  const [copied, setCopied] = useState(false);
  const [intake, setIntake] = useState<JsonObject | null>(null);

  const read = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_contributor_intake', { p_vehicle_id: vehicleId });
    if (!error) setIntake(obj(data));
  }, [vehicleId]);
  useEffect(() => { void read(); }, [read]);

  const create = async () => {
    if (!name.trim()) return;
    setCopied(false);
    const ok = await w.run('create_contributor_invite', { p_vehicle_id: vehicleId, p_display_name: name.trim(), p_relationship: relationship, p_phone: phone.trim() || null });
    if (ok) { setPhone(''); void read(); }
  };
  const path = str(w.done?.path);
  const link = path && typeof window !== 'undefined' ? `${window.location.origin}${path.startsWith('/') ? path : `/${path}`}` : null;
  const copy = async () => { if (!link) return; try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); } };

  const invites = arr(intake?.invites).map(obj).filter((x): x is JsonObject => !!x);
  const visits = arr(intake?.visits).map(obj).filter((x): x is JsonObject => !!x);
  const answers = arr(intake?.answers).map(obj).filter((x): x is JsonObject => !!x);
  const uploads = arr(intake?.uploads).map(obj).filter((x): x is JsonObject => !!x);
  const progress = readProgress(intake?.progress);

  return <div className="job-block ct-page" aria-label="Contributors" style={themeVars(theme)} data-theme-key={theme.key}>
    {progress && <IntakeLadder progress={progress} moved={movedText(progress)} audience="owner" subject={str(vehicle?.model)} />}
    <div className="jb-field">
      <label className="jb-field"><Text role="label">Name</Text>
        <input className="jb-input k-body" value={name} onChange={e => setName(e.target.value)} autoComplete="off" /></label>
      <label className="jb-field"><Text role="label">Relationship</Text>
        <select className="jb-input k-body" value={relationship} onChange={e => setRelationship(e.target.value)}>
          {RELATIONSHIPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="jb-field"><Text role="label">Phone (optional, stored only as a hash)</Text>
        <input className="jb-input k-body" type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="off" /></label>
      <div className="jb-actions"><button type="button" className="btn-base btn-sm btn-primary" disabled={w.busy || !name.trim()} onClick={() => void create()}>
        <Text role="label">{w.busy ? 'Creating…' : 'Invite a contributor'}</Text></button></div>
      <div role="alert" className="jb-live">{w.failure && <Text role="body" className="jb-warn">{w.failure}</Text>}</div>
    </div>
    {link && <div className="jb-field">
      <Text role="body" className="jb-done">Link ready. Text it from your phone; Nuke sends nothing. It is shown only this once.</Text>
      <input className="jb-input k-body" aria-label="Contributor link" readOnly value={link} onFocus={e => e.target.select()} />
      <div className="jb-actions"><button type="button" className="btn-base btn-sm btn-primary" onClick={() => void copy()}><Text role="label">{copied ? 'Copied' : 'Copy link'}</Text></button></div>
      {day(str(w.done?.expires_at)) && <Text role="caption">{`Works until ${day(str(w.done?.expires_at))}.`}</Text>}
    </div>}

    <Rows title="Invited" count={invites.length}>
      {invites.map((i, n) => <Row key={str(i.invite_id) ?? str(i.id) ?? n} label={`${str(i.display_name) ?? 'Contributor'}${str(i.relationship) ? `, ${str(i.relationship)!.replace('_', ' ')}` : ''}`}>
        {str(i.revoked_at) ? 'revoked' : str(i.first_opened_at) ? `opened ${day(str(i.first_opened_at))}, ${num(i.open_count) ?? 1} times` : `not opened yet${day(str(i.expires_at)) ? `, works until ${day(str(i.expires_at))}` : ''}`}
      </Row>)}
    </Rows>
    <Rows title="Opens" count={visits.length}>
      {visits.slice(0, 20).map((v, n) => <Row key={n} label={day(str(v.seen_at)) || 'when unknown'} role="caption">{deviceSummary(v.device)}</Row>)}
    </Rows>
    <Rows title="Answers" count={answers.length}>
      {answers.map((a, n) => <div key={str(a.id) ?? n} className="jb-line">
        <Text role="label">{str(a.prompt) ?? str(a.question_key) ?? 'Answer'}</Text>
        <Text role="body" as="p">{str(a.answer_text) ?? str(obj(a.payload)?.answer_text) ?? ''}</Text>
        <Text role="caption">{`${str(a.recorded_by_user_id) ? 'typed by you during a call' : 'through their link'}, ${day(str(a.observed_at) ?? str(a.created_at))}, ${deviceSummary(a.device_attestation)}`}</Text>
      </div>)}
    </Rows>
    <Rows title="Documents" count={uploads.length}>
      {uploads.map((u, n) => <Row key={str(u.image_id) ?? str(u.id) ?? n} label={str(u.file_name) ?? 'document'} role="caption">{`${day(str(u.created_at)) || ''} ${deviceSummary(u.device)}`.trim()}</Row>)}
    </Rows>
  </div>;
}
