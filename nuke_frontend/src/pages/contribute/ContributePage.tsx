/**
 * /contribute/:token — a contributor with no Nuke account answers the owner's questions and sends documents from their
 * phone. Everything goes through the contributor-intake edge function, which records the device with each open,
 * answer and upload. Order: the car (proven / open), 1 documents, 2 round-one questions, 3 round two (collapsed),
 * then one line on what the link proves. Signed out by design; a signed-in owner typing here is recorded as the owner.
 */
import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Masthead, Row, Rows, Text, themeVars, vehicleTheme } from '../../kit';
import { VehicleIdentity } from '../../components/common/MakeIdentity';
import { usePageTitle } from '../../hooks/usePageTitle';
import { arr, num, obj, str, type JsonObject } from '../jobs/jobRead';
import { getSupabaseFunctionsUrl, SUPABASE_ANON_KEY, supabase } from '../../lib/supabase';
import { answersReducer, DOCUMENT_LABELS, drafts, makeClient, needsSave, statusWord, uploadsReducer, uploadWord, type IntakeClient } from './intakeState';
import { IntakeLadder, movedText, readProgress, shotChoices, type Progress } from './IntakeLadder';
import '../jobs/job-page.css';
import '../jobs/jobs.css';
import './contribute.css';

const RELATIONSHIP: Record<string, string> = { builder: 'the builder', previous_owner: 'a previous owner', shop: 'the shop', appraiser: 'the appraiser' };

type Fact = { text: string; proven: boolean };
/** Known facts arrive as [{text|label, state|status|proven}] or {proven: [...], open: [...]}. */
export function readFacts(v: unknown): Fact[] {
  const o = obj(v);
  if (o && (Array.isArray(o.proven) || Array.isArray(o.open))) {
    return [...arr(o.proven).map(x => ({ text: str(x) ?? str(obj(x)?.text) ?? '', proven: true })),
      ...arr(o.open).map(x => ({ text: str(x) ?? str(obj(x)?.text) ?? '', proven: false }))].filter(f => f.text);
  }
  return arr(v).map(x => {
    const f = obj(x);
    const text = str(x) ?? str(f?.text) ?? str(f?.label) ?? str(f?.fact) ?? '';
    const state = str(f?.state) ?? str(f?.status);
    return { text, proven: f?.proven === true || state === 'proven' || state === 'known' };
  }).filter(f => f.text);
}

type Question = { key: string; prompt: string; hint: string | null; answer: string | null; group: string | null };
export function readQuestions(v: unknown): Question[] {
  return arr(v).map(x => {
    const q = obj(x);
    const key = str(q?.key) ?? str(q?.question_key);
    const prompt = str(q?.prompt) ?? str(x);
    if (!prompt) return null;
    return { key: key ?? prompt, prompt, hint: str(q?.hint), answer: str(q?.answer) ?? str(obj(q?.answer)?.answer_text) ?? str(q?.answer_text), group: str(q?.group) };
  }).filter((q): q is Question => q !== null);
}

type Frame = { id: string; url: string; role: string; caption: string | null };
/** The car's frames as the edge function picked them through the gated read: https URLs only, never a storage path. */
export function readFrames(v: unknown): Frame[] {
  return arr(v).map(x => {
    const f = obj(x); const url = str(f?.url); const id = str(f?.image_id) ?? url;
    return url && id && /^https:\/\//.test(url) ? { id, url, role: str(f?.role) ?? 'frame', caption: str(f?.caption) } : null;
  }).filter((f): f is Frame => f !== null).slice(0, 6);
}

let defaultClient: IntakeClient | null = null;
const client = () => defaultClient ??= makeClient(getSupabaseFunctionsUrl(), SUPABASE_ANON_KEY,
  async () => { try { return (await supabase.auth.getSession()).data.session?.access_token ?? null; } catch { return null; } });

export default function ContributePage({ intake }: { intake?: IntakeClient }) {
  const { token = '' } = useParams<{ token: string }>();
  const api = intake ?? client();
  const [card, setCard] = useState<JsonObject | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'gone' | 'offline'>('loading');
  const [answers, dispatch] = useReducer(answersReducer, {});
  const [uploads, upload] = useReducer(uploadsReducer, []);
  const files = useRef(new Map<string, File>());
  const labels = useRef(new Map<string, string>());
  const shots = useRef(new Map<string, string>());
  const picker = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('receipt');
  const [shot, setShot] = useState('');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [moved, setMoved] = useState<string | null>(null);

  const vehicle = obj(card?.vehicle);
  const title = vehicle ? [num(vehicle.year), str(vehicle.make), str(vehicle.model)].filter(Boolean).join(' ') : 'This car';
  usePageTitle(card ? `${title} — your answers` : 'Contributor link');
  const theme = vehicleTheme(vehicle ? { make: vehicle.make, year: vehicle.year, color: vehicle.color, paint_code: obj(vehicle.body)?.paint_code } : null);

  /** A writer reply carries the ladder after that input; show it and say what moved. */
  const took = (body: unknown) => {
    const p = readProgress(obj(body)?.progress);
    if (!p) return;
    setProgress(p); setMoved(movedText(p));
  };

  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await api.open(token);
      if (r.status === 404) { setState('gone'); return; }
      if (r.status !== 200) { setState('offline'); return; }
      const c = obj(r.body) ?? {};
      setCard(c);
      setProgress(readProgress(c.progress)); setMoved(null);
      for (const q of readQuestions(c.questions)) dispatch({ type: 'load', key: q.key, savedText: q.answer, draft: drafts.read(token, q.key) });
      setState('ready');
    } catch { setState('offline'); }
  }, [api, token]);
  useEffect(() => { void load(); }, [load]);

  const save = async (key: string) => {
    const a = answers[key];
    if (!needsSave(a)) return;
    const text = a.text;
    dispatch({ type: 'save_started', key });
    const r = await api.answer(token, key, text);
    if (r.ok) { dispatch({ type: 'save_ok', key, text }); drafts.clear(token, key); took(r.body); }
    else dispatch({ type: 'save_failed', key });
  };

  const send = async (id: string) => {
    const f = files.current.get(id); if (!f) return;
    const r = await api.file(token, f, labels.current.get(id) ?? 'other', shots.current.get(id) || null);
    upload(r.ok ? { type: 'done', id, duplicate: r.duplicate } : { type: 'failed', id });
    if (r.ok) took(r.body);
  };
  const add = (list: FileList | null) => {
    for (const f of Array.from(list ?? [])) {
      const id = `${f.name}:${f.size}:${f.lastModified}:${Math.random().toString(36).slice(2, 8)}`;
      const isImage = f.type.startsWith('image/');
      let previewUrl: string | null = null;
      try { previewUrl = isImage && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : null; } catch { previewUrl = null; }
      files.current.set(id, f); labels.current.set(id, label); if (shot) shots.current.set(id, shot);
      upload({ type: 'added', upload: { id, name: f.name, label, isImage, previewUrl } });
      void send(id);
    }
    if (picker.current) picker.current.value = '';
  };

  if (state === 'loading') return <article className="jb-page ct-page" aria-busy="true"><Text role="body" as="p">Opening the record…</Text></article>;
  if (state === 'gone') return <article className="jb-page ct-page"><Masthead><Text role="entity" as="h1">This link does not open</Text></Masthead>
    <Text role="body" as="p">It may have expired or been replaced. Ask the person who sent it for a new one.</Text></article>;
  if (state === 'offline') return <article className="jb-page ct-page"><Masthead><Text role="entity" as="h1">Could not reach Nuke</Text></Masthead>
    <Text role="body" as="p">Check the connection and try again.</Text>
    <div className="jb-actions"><button type="button" className="btn-base btn-md btn-primary" onClick={() => void load()}><Text role="label">Try again</Text></button></div></article>;

  const who = obj(card?.contributor);
  const name = str(who?.display_name);
  const rel = RELATIONSHIP[str(who?.relationship) ?? ''] ?? null;
  const facts = readFacts(card?.known_facts ?? card?.facts);
  const round1 = readQuestions(card?.questions);
  const round2 = readQuestions(card?.round2 ?? card?.round_two);
  const onFile = num(card?.documents_count) ?? num(obj(card?.documents)?.count) ?? 0;
  const owner = card?.recorded_by_owner === true;
  const groups = round2.reduce<Record<string, Question[]>>((g, q) => { (g[q.group ?? ''] ??= []).push(q); return g; }, {});
  const frames = readFrames(card?.frames);
  const choices = shotChoices(progress);
  const hero = frames[0] ?? null;
  const strip = frames.slice(1, 6);
  const trim = str(obj(vehicle?.body)?.trim);

  return <article className="jb-page ct-page" aria-label="Contributor record" style={themeVars(theme)} data-theme-key={theme.key} data-motif={theme.motif}>
    <div className="ct-motif" aria-hidden="true" />
    <Masthead><div className={`job-masthead${theme.display === 'block' ? ' ct-head--block' : ''}`}>
      {name && <Text role="label">{`For ${name}${rel ? `, ${rel}` : ''}`}</Text>}
      <h1 className="k-entity">{vehicle && str(vehicle.make) && str(vehicle.model)
        ? <VehicleIdentity make={str(vehicle.make)!} model={str(vehicle.model)!} year={num(vehicle.year)} variants={trim ? [{ kind: 'trim', value: trim }] : []} />
        : title}</h1>
      {theme.paint && <Text role="caption" className="ct-head__paint"><span className="ct-head__swatch" aria-hidden="true" />{`${theme.paint.name}${theme.paint.code ? `, code ${theme.paint.code}` : ''}`}</Text>}
    </div></Masthead>

    {hero && <figure className="ct-hero">
      <img className="ct-hero__img" src={hero.url} alt={hero.caption ?? `${title}, photographed`} width={720} height={405} />
      {strip.length > 0 && <ul className="ct-strip" aria-label="Details and badges">{strip.map(f =>
        <li key={f.id}><img className="ct-strip__img" src={f.url} alt={f.caption ?? ''} width={140} height={140} loading="lazy" /></li>)}</ul>}
    </figure>}

    {progress && <IntakeLadder progress={progress} moved={moved} audience="contributor" subject={str(vehicle?.model)} />}

    <section className="ct-card" aria-label="The car">
      <Rows title="The car">
        {str(vehicle?.vin) && <Row label="VIN" role="measure">{str(vehicle?.vin)}</Row>}
        {str(vehicle?.color) && !theme.paint && <Row label="Color">{str(vehicle?.color)}</Row>}
        {str(vehicle?.body_style) && <Row label="Body">{str(vehicle?.body_style)}</Row>}
      </Rows>
      {facts.length > 0 && <ul className="ct-facts">{facts.map(f => <li key={f.text} className={f.proven ? 'ct-fact ct-fact--proven' : 'ct-fact ct-fact--open'}>
        <span className="ct-fact__mark" aria-hidden="true">{f.proven ? '✓' : '?'}</span>
        <Text role="body">{f.text}</Text><span className="ct-sr">{f.proven ? ' (proven)' : ' (still open)'}</span></li>)}</ul>}
    </section>

    <section className="ct-step" aria-labelledby="ct-s1">
      <Text role="entity" as="h2" id="ct-s1"><span className="ct-n">1</span> Send what you have</Text>
      <Text role="body" as="p">Receipts, invoices, parts paperwork, build photos, purchase papers. Phone photos are fine.</Text>
      <input ref={picker} className="ct-hidden" type="file" accept="image/*,application/pdf" multiple onChange={e => add(e.target.files)} aria-label="Choose photos or PDFs" />
      <label className="jb-field"><Text role="label">What are you sending?</Text>
        <select className="jb-input k-body" value={label} onChange={e => setLabel(e.target.value)}>
          {DOCUMENT_LABELS.map(l => <option key={l.value} value={l.value}>{l.word}</option>)}</select></label>
      <Text role="caption" as="p">{DOCUMENT_LABELS.find(l => l.value === label)?.isPrivate
        ? 'Kept private: only the owner sees it.' : 'Build photos can appear on the car\'s public page.'}</Text>
      {choices.length > 0 && <label className="jb-field"><Text role="label">Is it one of the shots the car still needs?</Text>
        <select className="jb-input k-body" value={shot} onChange={e => setShot(e.target.value)} aria-label="Which shot this is">
          <option value="">Not one of these</option>
          {choices.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>}
      <div className="jb-actions"><button type="button" className="btn-base btn-md btn-primary" onClick={() => picker.current?.click()}><Text role="label">Add photos or PDFs</Text></button></div>
      <Text role="caption" as="p">{onFile > 0 ? `${onFile} already on file. ` : ''}Up to 20 MB each (title papers 10 MB).</Text>
      {uploads.length > 0 && <ul className="ct-tiles" aria-label="What you sent">{uploads.map(u => <li key={u.id} className="ct-tile">
        {u.previewUrl ? <img className="ct-tile__img" src={u.previewUrl} alt={u.name} width={140} height={140} /> : <span className="ct-tile__img ct-tile__doc"><Text role="label">PDF</Text></span>}
        <Text role="caption">{DOCUMENT_LABELS.find(l => l.value === u.label)?.word ?? u.label}</Text>
        {u.status === 'failed'
          ? <button type="button" className="btn-base btn-xs btn-secondary" onClick={() => { upload({ type: 'retry', id: u.id }); void send(u.id); }}><Text role="caption" className="jb-warn">{uploadWord.failed}</Text></button>
          : <Text role="caption" className={u.status === 'uploading' ? '' : 'jb-done'}>{uploadWord[u.status]}</Text>}
      </li>)}</ul>}
    </section>

    {round1.length > 0 && <section className="ct-step" aria-labelledby="ct-s2">
      <Text role="entity" as="h2" id="ct-s2"><span className="ct-n">2</span> {round1.length === 1 ? 'One question' : `${round1.length} questions`}</Text>
      <Text role="body" as="p">Write as much or as little as you like. "Don't remember" is a fine answer. Each one saves when you leave the box.</Text>
      <ol className="ct-questions">{round1.map((q, i) => {
        const a = answers[q.key];
        return <li key={q.key} className="ct-q">
          <label className="jb-field" htmlFor={`ct-q-${i}`}>
            <Text role="measure">{`${i + 1}. ${q.prompt}`}</Text>
            {q.hint && <Text role="caption">{q.hint}</Text>}
          </label>
          <textarea id={`ct-q-${i}`} className="job-textarea ct-textarea k-body" value={a?.text ?? ''}
            onChange={e => { dispatch({ type: 'edit', key: q.key, text: e.target.value }); drafts.write(token, q.key, e.target.value); }}
            onBlur={() => void save(q.key)} />
          <div className="ct-save" aria-live="polite">
            {a?.status === 'failed'
              ? <button type="button" className="btn-base btn-xs btn-secondary" onClick={() => void save(q.key)}><Text role="caption" className="jb-warn">{statusWord(a)}</Text></button>
              : <Text role="caption" className={a?.status === 'saved' ? 'jb-done' : ''}>{statusWord(a)}</Text>}
          </div>
        </li>;
      })}</ol>
    </section>}

    {round2.length > 0 && <section className="ct-step" aria-labelledby="ct-s3">
      <Text role="entity" as="h2" id="ct-s3"><span className="ct-n">3</span> Later, after the paperwork</Text>
      <Text role="body" as="p">These get asked once the documents are read, so only what is still missing comes up.</Text>
      <details className="job-details ct-details"><summary><Text role="label">{`The second-round list (${round2.length})`}</Text></summary>
        {Object.entries(groups).map(([g, qs]) => <div key={g || 'all'}>{g && <Text role="label" as="h3">{g}</Text>}
          <ul className="job-list">{qs.map(q => <li key={q.key}><Text role="body">{q.prompt}</Text></li>)}</ul></div>)}
      </details>
    </section>}

    <Text role="caption" as="p" className="ct-footer">{owner
      ? 'You are signed in: what you type here is recorded as entered by you, from your device, on their behalf.'
      : 'Answers through your link, from your phone. Each answer and document is recorded with this link and the device that sent it. Nothing here needs an account.'}</Text>
  </article>;
}
