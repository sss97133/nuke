import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { PrefetchLink as Link } from '../../components/PrefetchLink';
import { commentPageRequest, commentParams, commentRequestFromParams, commentSurfaceKey, finiteCommentClock,
  initialCommentRequest, useCommentSurface, type CommentFilter, type CommentSurfaceReceipt } from './commentSurfaceReader';
import './CommentMeasurements.css';

const number = (value: number | null) => value === null ? 'unknown' : value.toLocaleString('en-US');
const utc = (value: string) => new Date(value).toISOString().replace('T',' ').replace(/\.000Z$/,' UTC');
const names: Record<CommentFilter,string> = { all_discussion:'All discussion',text:'Text-bearing',media_only:'Media only',no_captured_content:'No captured text or media' };

function MeasurementBar({ label, value, denominator, selected, onClick }: {
  label: string; value: number; denominator: number; selected?: boolean; onClick: () => void;
}) {
  const fraction = denominator > 0 ? value/denominator : null;
  return <button type="button" className="comment-measure__bar" onClick={onClick} aria-pressed={selected}
    aria-label={`${label}: ${number(value)} of ${number(denominator)}${fraction === null ? '; share unknown' : `; ${(fraction*100).toFixed(1)} percent`}. Inspect source entries`}>
    <span>{label}</span><span className="stack-mono">{number(value)} / {number(denominator)}</span>
    <span className="comment-measure__track" aria-hidden="true"><span style={{width:`${(fraction ?? 0)*100}%`}} /></span>
  </button>;
}

function MeasuredGraphs({ receipt, filter, choose }: { receipt: CommentSurfaceReceipt; filter:CommentFilter; choose:(f:CommentFilter)=>void }) {
  const f=receipt.features;
  return <div className="comment-measure__graphs">
    <figure>
      <figcaption>What was captured · {number(f.discussion_entries)} discussion entries</figcaption>
      <MeasurementBar label="Text-bearing" value={f.text_entries} denominator={f.discussion_entries} selected={filter==='text'} onClick={()=>choose('text')} />
      <MeasurementBar label="Media only" value={f.media_only_entries} denominator={f.discussion_entries} selected={filter==='media_only'} onClick={()=>choose('media_only')} />
      <MeasurementBar label="No captured text or media" value={f.no_captured_text_or_media_entries} denominator={f.discussion_entries} selected={filter==='no_captured_content'} onClick={()=>choose('no_captured_content')} />
      <p className="stack-note">These three groups partition captured discussion. Stored media references do not establish verified images.</p>
    </figure>
    <figure>
      <figcaption>Literal text patterns · denominator {number(f.text_entries)} text entries</figcaption>
      <MeasurementBar label="Contains a ?" value={f.question_mark_entries} denominator={f.text_entries} onClick={()=>choose('text')} />
      <MeasurementBar label="Contains an http(s) URL marker" value={f.url_marker_entries} denominator={f.text_entries} onClick={()=>choose('text')} />
      <MeasurementBar label="Contains a numeric automotive unit" value={f.numeric_unit_marker_entries} denominator={f.text_entries} onClick={()=>choose('text')} />
      <p className="stack-note">Patterns overlap. Inspecting a pattern opens all text entries with per-entry flags, including counterexamples. These patterns do not measure expertise or literacy.</p>
    </figure>
  </div>;
}

function ContributionTable({ receipt, evidenceRef }: { receipt:CommentSurfaceReceipt; evidenceRef:React.RefObject<HTMLDivElement|null> }) {
  return <div ref={evidenceRef} className="stack-scroll" tabIndex={0} role="region" aria-label="Comment source records; scroll horizontally">
    <table className="stack-table comment-measure__evidence">
      <caption>Source records · {names[receipt.evidence.filter]} · {receipt.evidence.matching_entries === 0 ? '0 entries'
        : `${receipt.evidence.offset+1}–${receipt.evidence.offset+receipt.evidence.contributors.length} of ${number(receipt.evidence.matching_entries)}`}</caption>
      <thead><tr><th scope="col">Posted / recorded by us</th><th scope="col">Source entry</th><th scope="col">Measured from full text</th><th scope="col">Source / participant key</th></tr></thead>
      <tbody>{receipt.evidence.contributors.map(row=><tr key={row.comment_id} data-comment-id={row.comment_id}>
        <td className="stack-mono"><time dateTime={row.posted_at}>{utc(row.posted_at)}</time><br/><time dateTime={row.db_recorded_at}>{utc(row.db_recorded_at)}</time></td>
        <td><div className="stack-label">{row.source_comment_type.replace(/_/g,' ')} · seller flag {row.is_seller===null?'unknown':row.is_seller?'yes':'no'}</div>
          <p className="comment-measure__excerpt">{row.excerpt ?? (row.media_reference_count>0?'Media-only source entry':'No captured text or media')}{row.excerpt!==null&&row.excerpt_truncated?'… (excerpt shortened)':''}</p>
          <div className="stack-basis">{number(row.media_reference_count)} nonblank stored media references</div></td>
        <td>{row.excerpt === null ? 'Text measurements do not apply' : <>
          <span className="stack-mono">{number(row.whitespace_tokens)} token runs · {number(row.characters)} characters · {number(row.question_marks)} question marks</span><br/>
          URL marker {row.url_marker?'yes':'no'} · unit marker {row.numeric_unit_marker?'yes':'no'}</>}</td>
        <td><a href={row.source_url} target="_blank" rel="noopener noreferrer">{row.native_comment_id?'BaT comment ↗':'BaT listing ↗'}</a>
          <div className="stack-basis">{row.source_locator_basis==='typed_lot_relation_only'?'Typed lot relationship; comment URL absent':'Source URL and typed lot relationship'}</div>
          {row.external_identity_id ? <Link to={`/profile/external/${row.external_identity_id}`} className="stack-mono">Participant {row.external_identity_id.slice(0,8)}… →</Link> : <span className="stack-basis">Participant key unknown</span>}
          <details><summary>Record keys</summary><div className="stack-mono">Comment {row.comment_id}<br/>Auction {row.auction_event_id}<br/>Vehicle {row.vehicle_id}</div></details></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

/** Mounted only in the existing Dimension layer. All measured features and evidence come from the episode RPC. */
export default function CommentMeasurements({ vehicleId, lotId, closeAt }: { vehicleId:string; lotId:string; closeAt:string|null }) {
  const [params,setParams]=useSearchParams();
  const client=useQueryClient();
  const request=commentRequestFromParams(params);
  const query=useCommentSurface(vehicleId,lotId,request);
  const receipt=!query.isError && !query.isFetching && query.data?.state==='partial'?query.data:null;
  const [draft,setDraft]=useState(params.get('csCutoff')??'');
  const [formError,setFormError]=useState('');
  const [refreshing,setRefreshing]=useState(false);
  const evidenceRef=useRef<HTMLDivElement>(null);
  const focusEvidence=useRef(false);
  const inputId=useId();
  const activeCutoff=params.get('csCutoff')??'';
  useEffect(()=>{
    // The unsubmitted draft can differ, but browser history restores the applied clock.
    setDraft(activeCutoff);
    setFormError('');
  },[activeCutoff]);
  useEffect(()=>{
    if (receipt&&focusEvidence.current) {
      evidenceRef.current?.focus({preventScroll:true});
      focusEvidence.current=false;
    }
  },[receipt]);
  const apply=(filter:CommentFilter,cutoff?:string,inspect=false)=>{
    setFormError('');
    focusEvidence.current=inspect;
    setParams(commentParams(params,{evidence_filter:filter,...(cutoff?{knowledge_mode:'recorded_input_reconstruction',cutoff}:{})}));
  };
  const filter=request?.evidence_filter??'all_discussion';
  const refresh=async()=>{
    const reset=request?initialCommentRequest(request):{evidence_filter:'all_discussion' as const};
    setRefreshing(true);
    focusEvidence.current=true;
    try {
      // A previously cached first page must not replace a refused continuation with stale evidence.
      await client.invalidateQueries({queryKey:commentSurfaceKey(vehicleId,lotId,reset),exact:true,refetchType:'none'});
      const next=commentParams(params,reset);
      if (next.toString()===params.toString()) await query.refetch();
      else setParams(next);
    } finally { setRefreshing(false); }
  };
  const preset=(minutes:number)=>{
    if (!closeAt || !finiteCommentClock(closeAt)) return;
    const cutoff=new Date(Date.parse(closeAt)-minutes*60_000).toISOString();
    setDraft(cutoff);apply(filter,cutoff);
  };
  return <section className="comment-measure" aria-label="Comment measurements" aria-busy={query.isFetching||refreshing}>
    <h3>Comment measurements</h3>
    <p className="stack-note">Retained discussion on this exact auction. Bids are separate. No literacy, expertise, buyer-intent or profit score is established.</p>
    <div className="comment-measure__controls" role="group" aria-label="Comment measurement time">
      <button type="button" className="stack-chip" aria-pressed={Boolean(request&&!request.cutoff)} onClick={()=>apply(filter)}>Current recorded state</button>
      <button type="button" className="stack-chip" disabled={query.isFetching||refreshing} onClick={()=>void refresh()}>Refresh comment measurements</button>
    </div>
    <details className="comment-measure__time-controls" open={Boolean(request?.cutoff)}>
    <summary>Reconstruct an earlier cutoff</summary>
    {closeAt && finiteCommentClock(closeAt) && <div className="comment-measure__controls" role="group" aria-label="Reconstruction shortcuts">
      <button type="button" className="stack-chip" onClick={()=>preset(60)}>Reconstruct 1 hour before recorded close</button>
      <button type="button" className="stack-chip" onClick={()=>preset(10)}>Reconstruct 10 minutes before recorded close</button>
    </div>}
    <form className="comment-measure__cutoff" onSubmit={event=>{
      event.preventDefault();
      if (!finiteCommentClock(draft)) {setFormError('Enter a finite timestamp including seconds and Z or a UTC offset.');return;}
      apply(filter,draft);
    }}>
      <label htmlFor={inputId}>Recorded-input cutoff (ISO timestamp with timezone)</label>
      <input id={inputId} value={draft} onChange={event=>setDraft(event.target.value)} placeholder="2026-11-25T21:00:00Z" autoComplete="off" spellCheck={false} aria-invalid={Boolean(formError)} aria-describedby={formError?`${inputId}-error`:undefined} />
      <button type="submit" className="stack-chip">Reconstruct cutoff</button>
    </form>
    {formError&&<p id={`${inputId}-error`} role="alert">{formError}</p>}
    </details>
    {!request&&<p role="status">The shared comment controls are incomplete or invalid. Refresh to reset them; no measurement was read.</p>}
    {request&&query.isFetching&&<p role="status">Reading comment measurements and source records…</p>}
    {query.isError&&<p role="status">Comment measurements could not be read completely. Refresh to retry. No previous measurement is displayed.</p>}
    {!query.isFetching&&query.data?.state==='unavailable'&&<p role="status">{query.data.reason==='evidence_snapshot_changed'
      ? 'The source records changed. Previous evidence is withheld; refresh to read a new first page.'
      : `Measurement unavailable: ${query.data.reason.replace(/_/g,' ')}. Missing coverage is not zero activity.`}</p>}
    {receipt&&<>
      <p className="comment-measure__mode">{receipt.knowledge_mode==='recorded_input_reconstruction'?'Retrospective recorded-input reconstruction':'Current recorded state'} · posted through <time dateTime={receipt.event_cutoff}>{utc(receipt.event_cutoff)}</time> · recorded by us through <time dateTime={receipt.recorded_cutoff}>{utc(receipt.recorded_cutoff)}</time>.</p>
      {receipt.knowledge_mode==='recorded_input_reconstruction'&&<p className="stack-note">Current source rows and the currently recorded close anchor this reconstruction. It is not evidence that a forecast or feature was served at that time.</p>}
      <MeasuredGraphs receipt={receipt} filter={filter} choose={chosen=>apply(chosen,request?.cutoff,true)} />
      <dl className="comment-measure__facts">
        <dt>Whitespace-separated token runs</dt><dd>{number(receipt.features.whitespace_tokens)} total · {number(receipt.features.median_whitespace_tokens)} median per text entry</dd>
        <dt>Participants</dt><dd>{number(receipt.features.keyed_participant_count)} distinct BaT identity keys · {number(receipt.features.unkeyed_participant_entries)} discussion entries with unknown participant key</dd>
        <dt>Seller flags</dt><dd>{number(receipt.features.seller_flagged_entries)} / {number(receipt.features.discussion_entries)} discussion entries · {number(receipt.features.unknown_seller_flag_entries)} flags unknown</dd>
      </dl>
      <details className="comment-measure__basis"><summary>Coverage, method and clock basis</summary>
        <p>Posted between {utc(receipt.window_from)} and {utc(receipt.event_cutoff)}, with recording time at or before the cutoff. The lower bound is recorded close minus fourteen days, not an observed opening.</p>
        <p>{number(receipt.coverage.keyed_source_rows)} exact-lot source rows checked. {number(receipt.coverage.discussion_posted_by_cutoff)} discussion entries posted by cutoff; {number(receipt.coverage.discussion_recorded_by_cutoff)} also recorded by us by cutoff.</p>
        <p>{number(receipt.coverage.unknown_event_time)} unknown posted clocks · {number(receipt.coverage.unknown_recording_time)} unknown recording clocks · {number(receipt.coverage.outside_event_window)} outside the posted window · {number(receipt.coverage.recorded_after_cutoff)} posted-window source rows recorded later. These coverage counts may overlap.</p>
        <p>{number(receipt.coverage.source_bid_marked_rows)} source bid-marked rows · {number(receipt.coverage.other_source_labels)} other source labels. Unkeyed source rows are not assessed; complete BaT capture is not established.</p>
        <p className="stack-mono">{receipt.method_id} v{receipt.method_version} · {Object.values(receipt.pattern_profiles).join(' · ')}</p>
        <p className="stack-mono">Auction {receipt.auction_event_id} · snapshot {receipt.evidence.snapshot_hash} · measured {utc(receipt.measured_at)}</p>
      </details>
      <div className="comment-measure__controls" role="group" aria-label="Filter comment source records">
        {(Object.keys(names) as CommentFilter[]).map(key=><button key={key} type="button" className="stack-chip" aria-pressed={filter===key} onClick={()=>apply(key,request?.cutoff,true)}>{names[key]}</button>)}
      </div>
      <ContributionTable receipt={receipt} evidenceRef={evidenceRef}/>
      <div className="comment-measure__controls" role="group" aria-label="Comment source pages">
        <button type="button" className="stack-chip" disabled={receipt.evidence.offset===0} onClick={()=>{focusEvidence.current=true;setParams(commentParams(params,commentPageRequest(receipt,Math.max(0,receipt.evidence.offset-20))));}}>Previous comment entries</button>
        <button type="button" className="stack-chip" disabled={!receipt.evidence.has_more} onClick={()=>{focusEvidence.current=true;setParams(commentParams(params,commentPageRequest(receipt,receipt.evidence.next_offset!)));}}>Next comment entries</button>
      </div>
    </>}
  </section>;
}
