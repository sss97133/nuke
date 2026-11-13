import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Link from '../../components/PrefetchLink';
import { useAuth } from '../../hooks/useAuth';
import { usePageTitle } from '../../hooks/usePageTitle';
import { supabase } from '../../lib/supabase';
import './vehicle-evidence-detail.css';

interface Claim {
  observation_id: string;
  source_url: string;
  captured_at: string;
  label: string;
  relationship: 'source_current' | 'source_previous' | null;
  collection_label: string | null;
  collection_profile_path: string | null;
}
interface Member {
  source_url: string;
  label: string;
  image_url: string | null;
  relationship: 'source_current' | 'source_previous';
  profile_path: string;
}
interface SourceProfile {
  kind: 'source_vehicle' | 'source_collection';
  source_url: string;
  label: string;
  label_status?: string;
  image_url?: string | null;
  image_observation_id?: string | null;
  image_relationship?: string | null;
  captured_at?: string;
  history: { complete: boolean; selected_snapshot_id?: string | null };
  claims?: Claim[];
  members?: Member[];
}
const date = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const relationship = (value: string | null) => value === 'source_current' ? 'Listed under Current'
  : value === 'source_previous' ? 'Listed under Previous' : 'Vehicle detail page';

/** The existing profile's sparse source view; no canonical vehicle readers or ownership actions mount here. */
export default function VehicleSourceProfile() {
  const location = useLocation();
  const sourceUrl = new URLSearchParams(location.search).get('source_url') ?? '';
  const captureId = new URLSearchParams(location.search).get('capture_id');
  const { user, loading: authLoading } = useAuth();
  const subject = `${user?.id ?? ''}:${sourceUrl}:${captureId ?? ''}`;
  const [answer, setAnswer] = useState<{ subject: string; data: SourceProfile } | null>(null);
  const [failure, setFailure] = useState<{ subject: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const page = useRef<HTMLElement>(null), heading = useRef<HTMLElement>(null);
  const profile = answer?.subject === subject ? answer.data : null;
  const error = failure?.subject === subject ? failure.message : null;
  usePageTitle(profile?.label ?? 'Source vehicle profile');
  useLayoutEffect(() => {
    const node = heading.current, container = page.current;
    if (!node || !container) return;
    const measure = () => { const height = node.getBoundingClientRect().height; if (height > 0) container.style.setProperty('--vp-h-masthead', `${height}px`); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, [profile?.label]);
  useEffect(() => {
    if (!user || !sourceUrl) return;
    let cancelled = false;
    const controller = new AbortController();
    const deadline = window.setTimeout(() => controller.abort(), 15_000);
    setAnswer(null); setFailure(null);
    void (async () => {
      try {
        const canonical = new URL(sourceUrl).href.replace(/\/$/, '');
        const reply = await supabase.functions.invoke(`api-v1-vehicles?source_url=${encodeURIComponent(sourceUrl)}${captureId == null ? '' : `&capture_id=${encodeURIComponent(captureId)}`}`, { method: 'GET', signal: controller.signal });
        if (cancelled) return;
        if (reply.error) {
          const body = reply.error.context instanceof Response ? await reply.error.context.json().catch(() => null) : null;
          throw Error(body?.error ?? 'Source evidence could not be read. Try again.');
        }
        const data = reply.data?.data as SourceProfile | undefined;
        if (!data || data.source_url !== canonical || typeof data.label !== 'string'
          || !data.history || (captureId != null && data.history.selected_snapshot_id !== captureId.toLowerCase())
          || (data.kind !== 'source_vehicle' && data.kind !== 'source_collection')
          || (data.kind === 'source_vehicle' && !Array.isArray(data.claims))
          || (data.kind === 'source_collection' && !Array.isArray(data.members))) throw Error('Source profile response could not be verified.');
        if (!cancelled) setAnswer({ subject, data });
      } catch (cause) {
        if (!cancelled) setFailure({ subject, message: cause instanceof Error ? cause.message : 'Source evidence could not be read.' });
      } finally { window.clearTimeout(deadline); }
    })();
    return () => { cancelled = true; controller.abort(); window.clearTimeout(deadline); };
  }, [sourceUrl, captureId, user?.id, subject, attempt]);
  const returnUrl = encodeURIComponent(location.pathname + location.search);
  return <main ref={page} className="vehicle-profile-page evidence-detail source-profile">
    <nav aria-label="Source profile navigation"><Link to="/search">Vehicle search</Link></nav>
    {authLoading ? <p role="status">Checking access…</p> : !user ? <>
      <h1>Source vehicle profile</h1><p>Sign in to inspect retained source evidence.</p>
      <Link to={`/login?returnUrl=${returnUrl}`}>Sign in</Link>
    </> : !sourceUrl ? <p role="alert">Select a source vehicle or collection URL.</p>
      : error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt(v => v + 1)}>Retry</button></div>
      : !profile ? <p role="status">Reading source evidence…</p> : <>
        <header ref={heading} className="source-profile-heading"><h1>{profile.label}</h1>
          <p className="evidence-metadata">Exclusive Car Registry · Source presentation</p></header>
        <a href={profile.source_url} target="_blank" rel="noopener noreferrer">Original source page</a>
        {profile.kind === 'source_vehicle' ? <>
          <p>Physical vehicle identity and ownership are unverified by this source.</p>
          {profile.label_status === 'source_labels_differ' && <p role="status">The source labels differ. Each recorded label is shown below.</p>}
          {profile.image_url && <figure className="source-profile-image"><img key={profile.image_url} src={profile.image_url}
            width={720} height={480} alt="Image currently served by ECR from the captured page's image URL" loading="lazy"
            onError={event => { event.currentTarget.hidden = true; }} /><figcaption className="evidence-metadata">Image currently served by ECR; photo date unknown. ECR may show a sign-in notice instead of the photo.
            {profile.image_observation_id && <> <a href={`#source-capture-${profile.image_observation_id}-${profile.image_relationship ?? 'detail'}`}>Capture evidence</a></>}
          </figcaption></figure>}
          <section aria-label="Source history"><h2>Source history</h2>
            <ol className="source-profile-history">{profile.claims?.map(claim => <li id={`source-capture-${claim.observation_id}-${claim.relationship ?? 'detail'}`} key={`${claim.observation_id}:${claim.relationship}`}>
              <p>{relationship(claim.relationship)}{claim.collection_label && <> on <Link to={claim.collection_profile_path!}>{claim.collection_label}</Link></>}</p>
              {claim.label !== profile.label && <p>Recorded label: {claim.label}</p>}
              <p className="evidence-metadata">Page captured <time dateTime={claim.captured_at}>{date(claim.captured_at)}</time></p>
              <a href={claim.source_url} target="_blank" rel="noopener noreferrer">Source for this presentation</a>
            </li>)}</ol>
          </section>
        </> : <>
          {profile.captured_at && <p>Page captured <time dateTime={profile.captured_at}>{date(profile.captured_at)}</time></p>}
          <p>These are the car cards retained in this capture. The source may have additional uncaptured members. Collection presentation does not establish ownership.</p>
          {!!profile.members?.length && <ul className="source-profile-members">{profile.members.map(member => <li key={`${member.source_url}:${member.relationship}`}>
            <Link to={member.profile_path}>{member.image_url && <img src={member.image_url} width={240} height={160} alt="" loading="lazy"
              onError={event => { event.currentTarget.hidden = true; }} />}<span>{member.label}</span></Link>
            <p className="evidence-metadata">{relationship(member.relationship)}</p>
          </li>)}</ul>}
        </>}
        {!profile.history.complete && <p role="status">This view reached its evidence limit. Source history has not been fully read.</p>}
      </>}
  </main>;
}
