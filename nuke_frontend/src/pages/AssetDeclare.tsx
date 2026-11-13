// /assets/new: the holder declares a work in their own words. One Sign (declare_held_asset) records a holding claim, not authorship
// (PR #3190: authorship is a separate statement on the work's page); private by default. With ?confirm=<id> the person whose photos
// found a work keeps it as documentation (confirm_held_asset): no role claim, never "yours". No price field exists on purpose: a declared work carries no market figure until a public sale is
// recorded (case ledger §21.1). Phone first: one column, 44px controls, the kit's roles.
import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PrefetchLink } from '../components/PrefetchLink';
import { useAuth } from '../hooks/useAuth';
import { usePageTitle } from '../hooks/usePageTitle';
import { supabase } from '../lib/supabase';
import { Text } from '../kit';
import './jobs/jobs.css';
import './asset-declare.css';

const TYPES: Array<{ key: string; label: string }> = [
  { key: 'artwork', label: 'Artwork (painting, drawing, print, photograph, sculpture)' },
  { key: 'publication', label: 'Publication (a book, a zine, a portfolio)' },
  { key: 'automobilia', label: 'Automobilia (signs, pumps, posters, models)' },
  { key: 'memorabilia', label: 'Memorabilia' },
];
const VISIBILITY: Array<{ key: string; label: string; hint: string }> = [
  { key: 'private', label: 'Private', hint: 'only you see it; its shape counts in your ledger' },
  { key: 'unlisted', label: 'Unlisted', hint: 'anyone with the link' },
  { key: 'public', label: 'Public', hint: 'listed under your name' },
];
export const YEAR_RULE = /^(c\.\s?)?(1[0-9]{3}|20[0-9]{2})(s|\s?-\s?(1[0-9]{3}|20[0-9]{2}))?$/;

type Draft = { asset_type: string; title: string; medium: string; year: string; dimensions: string; edition: string; notes: string; visibility: string };
const empty: Draft = { asset_type: 'artwork', title: '', medium: '', year: '', dimensions: '', edition: '', notes: '', visibility: 'private' };

/** What stops the Sign before it is sent: the same rules the writer enforces, said in the holder's words. */
export function problems(d: Draft): string[] {
  const out: string[] = [];
  const title = d.title.replace(/\s+/g, ' ').trim();
  if (title.length < 1 || title.length > 200) out.push('A title of 1 to 200 characters.');
  if (d.year.trim() && !YEAR_RULE.test(d.year.trim())) out.push('A year that reads like 1965, c. 1965, 1960s or 1998-2001.');
  if (d.medium.length > 200) out.push('Medium is at most 200 characters.');
  if (d.dimensions.length > 120) out.push('Dimensions are at most 120 characters.');
  if (d.edition.length > 80) out.push('Edition is at most 80 characters.');
  if (d.notes.length > 4000) out.push('Notes are at most 4000 characters.');
  return out;
}

export default function AssetDeclarePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const confirmId = params.get('confirm');
  const confirming = !!confirmId && /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(confirmId);
  const [d, setD] = useState<Draft>(empty);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  usePageTitle(confirming ? 'Keep a work found in your photos' : 'Declare a work you hold');
  const issues = problems(d);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setD(prev => ({ ...prev, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (issues.length || sending) return;
    setSending(true); setError(null);
    const { data, error: err } = confirming
      ? await supabase.rpc('confirm_held_asset', {
        p_asset_id: confirmId, p_title: d.title, p_medium: d.medium || null, p_year: d.year || null, p_dimensions: d.dimensions || null,
        p_edition: d.edition || null, p_notes: d.notes || null, p_visibility: d.visibility,
      })
      : await supabase.rpc('declare_held_asset', {
        p_asset_type: d.asset_type, p_title: d.title, p_medium: d.medium || null, p_year: d.year || null, p_dimensions: d.dimensions || null,
        p_edition: d.edition || null, p_notes: d.notes || null, p_visibility: d.visibility,
      });
    setSending(false);
    if (err) { setError(err.message); return; }
    const id = (data as { asset_id?: string } | null)?.asset_id;
    if (id) navigate(`/assets/${id}`); else setError('The record was not returned.');
  };

  if (loading) return <main className="ad-page"><div role="status" className="ad-notice"><Text role="body">Checking who you are…</Text></div></main>;
  if (!user) return <main className="ad-page">
    <Text role="entity" as="h1">Declare a work</Text>
    <p className="ad-notice"><Text role="body">A work is declared by its holder, signed in. </Text><PrefetchLink to="/login" className="ad-link">Sign in</PrefetchLink></p>
  </main>;

  return <main className="ad-page">
    <header className="ad-head">
      <Text role="entity" as="h1">{confirming ? 'Keep a work found in your photos' : 'Declare a work you hold'}</Text>
      <Text role="body" as="p" className="ad-lede">{confirming
        ? 'The analysis found this work in your photographs. Keeping it records it as documentation of what you photographed; it does not say you made it or hold it. Give it its name and anything the photos cannot say; it stays private unless you say otherwise.'
        : 'For a work you hold that no photograph shows. In your own words; you are recorded as its holder. Whether you made it is a separate statement on its page. There is no price here: a work carries no market figure until a public sale is recorded.'}</Text>
    </header>
    <form className="ad-form" onSubmit={submit} noValidate>
      {!confirming && <label className="jb-field"><Text role="label">What is it</Text>
        <select className="jb-input k-body" value={d.asset_type} onChange={set('asset_type')}>{TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>}
      <label className="jb-field"><Text role="label">Title</Text>
        <input className="jb-input k-body" value={d.title} onChange={set('title')} maxLength={200} placeholder="Untitled is a title too" autoComplete="off" /></label>
      <label className="jb-field"><Text role="label">Medium</Text>
        <input className="jb-input k-body" value={d.medium} onChange={set('medium')} maxLength={200} placeholder="oil on canvas · archival pigment print · vinyl on billboard" autoComplete="off" /></label>
      <div className="ad-row">
        <label className="jb-field"><Text role="label">Year</Text>
          <input className="jb-input k-body" value={d.year} onChange={set('year')} inputMode="numeric" placeholder="2024 · c. 2019 · 2010s" autoComplete="off" /></label>
        <label className="jb-field"><Text role="label">Dimensions</Text>
          <input className="jb-input k-body" value={d.dimensions} onChange={set('dimensions')} maxLength={120} placeholder="48 x 60 in · 14 x 48 ft" autoComplete="off" /></label>
      </div>
      <label className="jb-field"><Text role="label">Edition</Text>
        <input className="jb-input k-body" value={d.edition} onChange={set('edition')} maxLength={80} placeholder="unique · 3/7 · AP 1/2 · edition of 100" autoComplete="off" /></label>
      <label className="jb-field"><Text role="label">Notes</Text>
        <textarea className="jb-input k-body ad-textarea" value={d.notes} onChange={set('notes')} maxLength={4000} placeholder="Where it was made, what it is of, where it has been shown." /></label>
      <fieldset className="ad-visibility">
        <legend><Text role="label">Who sees it</Text></legend>
        {VISIBILITY.map(v => <label key={v.key} className="ad-choice">
          <input type="radio" name="visibility" value={v.key} checked={d.visibility === v.key} onChange={set('visibility')} />
          <span><Text role="body">{v.label}</Text><Text role="caption">{v.hint}</Text></span>
        </label>)}
      </fieldset>
      {touched && issues.length > 0 && <ul className="ad-issues" role="alert">{issues.map(i => <li key={i}><Text role="caption">{i}</Text></li>)}</ul>}
      {error && <p className="ad-issues" role="alert"><Text role="caption">{`The record was not written: ${error}`}</Text></p>}
      <div className="ad-actions">
        <button type="submit" className="ad-sign" disabled={sending}><Text role="label">{sending ? 'Recording…' : confirming ? 'Keep as documentation' : 'Declare it'}</Text></button>
        <PrefetchLink to="/assets/mine" className="ad-link">Your records</PrefetchLink>
      </div>
      <Text role="caption" as="p" className="ad-foot">{confirming
        ? 'Keeping records your words under your account with today\'s clock; the photographs and their dates stay on the record as the documentation that found it.'
        : 'Signing records one declaration under your account with today\'s clock. The same declaration twice opens the same record.'}</Text>
    </form>
  </main>;
}
