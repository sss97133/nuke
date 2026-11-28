import { useState, type KeyboardEvent } from 'react';
import { PrefetchLink as Link } from '../../components/PrefetchLink';
import { bidDecimal, formatBidAmount, type BidPathEntry, type BidPathReceipt, type BidPathState } from './bidPathReader';
import type { IdentityRow } from './orderBookReader';
import { clock, count, span } from './stackFormat';
import './BidPathView.css';

type Identities=Record<string,IdentityRow>;
const time=(value:string)=>clock(Date.parse(value),true);
const rawAmount=(state:BidPathState)=>formatBidAmount(state.amount);
const W=680,H=250,P={left:84,right:20,top:20,bottom:48};
const labelLeft=(...values:string[])=>Math.max(P.left,Math.min(300,Math.max(...values.map(value=>formatBidAmount(value).length))*8+16));
function amountAxis(low:string,high:string){
  const minimum=bidDecimal(low),range=bidDecimal(high)-minimum;
  return (value:string)=>P.top+(range===0n?(H-P.top-P.bottom)/2
    :(1-Number(bidDecimal(value)-minimum)/Number(range))*(H-P.top-P.bottom));
}

function Participant({id,identities}:{id:string|null;identities:Identities}){
  return id?<Link to={`/profile/external/${id}`} className="stack-mono">{identities[id]?.handle??`${id.slice(0,8)}…`}</Link>
    :<span className="stack-basis">Unresolved bid entry</span>;
}

function SourceBid({state,label='Source bid'}:{state:BidPathState;label?:string}){
  return <a href={state.source_url} target="_blank" rel="noopener noreferrer">{label} {state.seq} ↗</a>;
}

export function BidKnowledge({receipt,pinned=false}:{receipt:BidPathReceipt;pinned?:boolean}){
  const c=receipt.coverage,f=receipt.summary;
  return <div className="bid-path__knowledge">
    <p>{receipt.knowledge_mode==='current_recorded_state'?(pinned?'Pinned current-state receipt':'Current recorded inputs'):'Recorded-input reconstruction'} ·
      {' '}posted through <time dateTime={receipt.event_cutoff}>{time(receipt.event_cutoff)}</time> ·
      {' '}recorded by us through <time dateTime={receipt.recorded_cutoff}>{time(receipt.recorded_cutoff)}</time>.</p>
    {receipt.knowledge_mode==='recorded_input_reconstruction'&&<p className="stack-note">This reconstructs current source rows against a recording cutoff. Later corrections and the currently recorded close remain hindsight; no historical forecast receipt is established.</p>}
    <p className="stack-note">Amounts are exact numeric source values. Currency {receipt.amount_context.currency_state==='recorded_claim'
      ? `is recorded as ${receipt.amount_context.currency_code}`:'is unestablished'}; recorded fee basis {receipt.amount_context.price_basis??'unknown'}.</p>
    <dl className="bid-path__summary" aria-label="Whole known-input set">
      <div><dt>Eligible bid events</dt><dd>{count(f.bid_count)}</dd></div>
      <div><dt>Validated participant keys</dt><dd>{count(f.keyed_participant_count)}</dd></div>
      <div><dt>Unresolved bid entries</dt><dd>{count(f.unresolved_bid_entries)}</dd></div>
      <div><dt>Running high / latest bid</dt><dd>{formatBidAmount(f.running_high_bid)} / {formatBidAmount(f.latest_bid)}</dd></div>
      <div><dt>Events in trailing 60 / 10 minutes</dt><dd>{count(f.bids_in_60_minutes_to_event_cutoff)} / {count(f.bids_in_10_minutes_to_event_cutoff)}</dd></div>
    </dl>
    <p className="stack-note">Trailing windows end at the posted-input cutoff above. Counts describe captured eligible inputs, not complete platform activity.</p>
    <details><summary>Bid coverage and method</summary>
      <p>{count(c.eligible_bid_states)} eligible bids from {count(c.source_bid_marked_rows)} bid-marked rows among {count(c.keyed_source_rows)} exact-lot source rows.</p>
      <p>{count(c.posted_bids_recorded_after_cutoff)} posted-window bids recorded later · {count(c.bid_marked_unknown_event_time)} unknown posted clocks · {count(c.bid_marked_unknown_recording_time)} unknown recording clocks · {count(c.bid_marked_unknown_amounts)} unknown amounts. Coverage gaps can overlap.</p>
      <p>{count(c.bids_outside_event_cutoff)} outside the posted window · {count(c.amount_without_bid_label)} amount-bearing rows without the bid label. Unkeyed source rows are not assessed; complete platform capture is unestablished.</p>
      <p>Window: {time(receipt.window_from)} to {time(receipt.event_cutoff)}. Its lower bound is recorded close minus fourteen days, not an observed opening.</p>
      <p className="stack-mono">{receipt.method_id} v{receipt.method_version} · auction {receipt.auction_event_id}<br/>Snapshot {receipt.snapshot_hash}<br/>Read {time(receipt.measured_at)}</p>
    </details>
  </div>;
}

function BidPathChart({receipt,selectedId,onSelect}:{receipt:BidPathReceipt;selectedId:string|null;onSelect:(id:string)=>void}){
  const [zoom,setZoom]=useState<0|10|60>(0);
  const from=zoom===0?-Infinity:Date.parse(receipt.event_cutoff)-zoom*60_000;
  const states=receipt.states.filter(s=>Date.parse(s.posted_at)>from);
  if(receipt.states.length===0)return null;
  const first=states[0],last=states.at(-1);
  const start=first?Date.parse(first.posted_at):from,end=last?Date.parse(last.posted_at):Date.parse(receipt.event_cutoff);
  const low=first?.price??'0',high=last?.price??'0',left=labelLeft(low,high);
  const x=(value:string)=>left+(end===start?(W-left-P.right)/2:(Date.parse(value)-start)/(end-start)*(W-left-P.right));
  const y=amountAxis(low,high);
  const path=states.map((s,i)=>i===0?`M ${x(s.posted_at)} ${y(s.price)}`:`H ${x(s.posted_at)} V ${y(s.price)}`).join(' ');
  const key=(event:KeyboardEvent<SVGGElement>,index:number)=>{
    if(event.key==='ArrowRight'||event.key==='ArrowLeft'){
      event.preventDefault();const next=Math.max(0,Math.min(states.length-1,index+(event.key==='ArrowRight'?1:-1)));
      onSelect(states[next].bid_comment_id);
      const marker=event.currentTarget.parentElement?.querySelectorAll<SVGGElement>('[role="button"]')[next];
      marker?.focus();marker?.scrollIntoView?.({block:'nearest',inline:'nearest'});
    }else if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelect(states[index].bid_comment_id);}
  };
  return <figure className="bid-path__figure">
    <figcaption>Captured running high bid · spacing follows posted time</figcaption>
    <div className="bid-path__controls" role="group" aria-label="Bid chart zoom">
      {([0,60,10]as const).map(value=><button type="button" className="stack-chip" key={value} aria-pressed={zoom===value} onClick={()=>setZoom(value)}>
        {value===0?'Full captured path':`Last ${value} minutes`}</button>)}
    </div>
    {states.length===0?<p role="status">No measured bid events in this chart window. The complete measured path is available in Full captured path.</p>:<>
    <p className="stack-note">{count(states.length)} of {count(receipt.summary.bid_count)} known bid events shown. Choose a point to inspect its book and source.</p>
    <div className="bid-path__chart-scroll" tabIndex={0} role="region" aria-label="Bid path chart; scroll horizontally">
      <svg className="stack-chart bid-path__chart" viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Known bid path in posted time; arrow keys select neighboring source events">
        <line x1={left} x2={W-P.right} y1={H-P.bottom} y2={H-P.bottom}/>
        <line x1={left} x2={left} y1={P.top} y2={H-P.bottom}/>
        <text x={left-8} y={y(last!.price)+4} textAnchor="end">{formatBidAmount(last!.price)}</text>
        {bidDecimal(high)!==bidDecimal(low)&&<text x={left-8} y={y(first!.price)+4} textAnchor="end">{formatBidAmount(first!.price)}</text>}
        <path d={path} fill="none" className="bid-path__line"/>
        {states.map((s,i)=><g key={s.bid_comment_id} role="button" tabIndex={0} aria-pressed={s.bid_comment_id===selectedId}
          aria-label={`Bid ${s.seq}: ${rawAmount(s)}, ${time(s.posted_at)}. Inspect book and source`}
          data-bid-comment-id={s.bid_comment_id} onClick={()=>onSelect(s.bid_comment_id)} onKeyDown={event=>key(event,i)}>
          <circle cx={x(s.posted_at)} cy={y(s.price)} r={14} className="bid-path__hit"/>
          <circle cx={x(s.posted_at)} cy={y(s.price)} r={s.bid_comment_id===selectedId?6:3} className="bid-path__point"/>
          <title>Bid {s.seq} · source amount {rawAmount(s)} · running high {formatBidAmount(s.price)} · {time(s.posted_at)}</title>
        </g>)}
        <text x={left} y={H-24}>{new Date(start).toISOString().slice(5,16).replace('T',' ')} UTC</text>
        <text x={W-P.right} y={H-6} textAnchor="end">{new Date(end).toISOString().slice(5,16).replace('T',' ')} UTC</text>
      </svg>
    </div></>}
  </figure>;
}

function RevealedCurve({receipt,state}:{receipt:BidPathReceipt;state:BidPathState}){
  const book=receipt.book;if(book.length===0)return null;
  const high=book[0].maximum_revealed_bid,low=book.at(-1)!.maximum_revealed_bid,left=labelLeft(low,high);
  const x=(depth:number)=>left+depth/state.entries*(W-left-P.right);
  const y=amountAxis(low,high);
  const levels=book.filter((e,i)=>i===0||bidDecimal(e.maximum_revealed_bid)!==bidDecimal(book[i-1].maximum_revealed_bid));
  const path=levels.map((e,i)=>i===0?`M ${x(0)} ${y(e.maximum_revealed_bid)} H ${x(e.depth_at_revealed_bid)}`
    :`V ${y(e.maximum_revealed_bid)} H ${x(e.depth_at_revealed_bid)}`).join(' ');
  return <figure className="bid-path__figure"><figcaption>Revealed bid levels · selected prefix</figcaption>
    <div className="bid-path__chart-scroll" tabIndex={0} role="region" aria-label="Revealed bid curve; scroll horizontally">
      <svg className="stack-chart bid-path__chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${state.entries} entries after bid ${state.seq}; levels are numeric source amounts, willingness to pay is unmeasured`}>
        <line x1={left} x2={W-P.right} y1={H-P.bottom} y2={H-P.bottom}/><line x1={left} x2={left} y1={P.top} y2={H-P.bottom}/>
        <text x={left-8} y={y(book[0].maximum_revealed_bid)+4} textAnchor="end">{formatBidAmount(book[0].maximum_revealed_bid)}</text>
        {bidDecimal(high)!==bidDecimal(low)&&<text x={left-8} y={y(book.at(-1)!.maximum_revealed_bid)+4} textAnchor="end">{formatBidAmount(book.at(-1)!.maximum_revealed_bid)}</text>}
        <path d={path} fill="none" className="bid-path__line"/>
        <text x={left} y={H-16}>0 entries</text><text x={W-P.right} y={H-16} textAnchor="end">{count(state.entries)} entries</text>
      </svg>
    </div><p className="stack-note">Each platform identity contributes its highest eligible bid; each unresolved bid is separate. Bid levels are lower bounds, not measured reservation prices or a forecast.</p>
  </figure>;
}

export function BidEntryTable({receipt,identities,keysOnly=false}:{receipt:BidPathReceipt;identities:Identities;keysOnly?:boolean}){
  const sources=new Map(receipt.states.map(s=>[s.bid_comment_id,s]));
  const source=(id:string,label:string)=>{const s=sources.get(id)!;return <SourceBid state={s} label={label}/>;};
  return <div className="stack-scroll bid-path__table-scroll" tabIndex={0} role="region" aria-label="Measured book entries; scroll horizontally">
    <table className="stack-table"><caption>Book after bid {receipt.selected_seq} · {count(receipt.book.length)} entries</caption>
      <thead><tr>{!keysOnly&&<th scope="col" className="num">Depth</th>}<th scope="col">Participant</th><th scope="col" className="num">Highest revealed</th>
        <th scope="col" className="num">Bids</th><th scope="col">First / last source</th><th scope="col">Evidence</th></tr></thead>
      <tbody>{receipt.book.map((entry:BidPathEntry)=><tr key={entry.entry_key} data-entry-key={entry.entry_key}>
        {!keysOnly&&<td className="num">{count(entry.depth_at_revealed_bid)}</td>}
        <td><Participant id={entry.external_identity_id} identities={identities}/></td>
        <td className="num">{formatBidAmount(entry.maximum_revealed_bid)}<br/>{source(entry.highest_bid_comment_id,'Highest at')}</td>
        <td className="num">{count(entry.bid_count)}</td><td>{source(entry.first_bid_comment_id,'First at')}<br/>{source(entry.last_bid_comment_id,'Last at')}</td>
        <td><details><summary>{entry.bid_count} supporting source {entry.bid_count===1?'record':'records'}</summary>
          {entry.supporting_bid_comment_ids.map(id=><div key={id}>{source(id,'Bid')} · <span className="stack-mono">{id}</span></div>)}</details></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function BidPathLog({receipt,identities,onSelect}:{receipt:BidPathReceipt;identities:Identities;onSelect:(id:string)=>void}){
  return <div className="stack-scroll bid-path__table-scroll" tabIndex={0} role="region" aria-label="Measured bid source records; scroll horizontally">
    <table className="stack-table"><caption>{count(receipt.summary.bid_count)} bids in the requested known-input set</caption>
      <thead><tr><th scope="col">Bid</th><th scope="col">Posted / recorded by us</th><th scope="col" className="num">Amount</th>
        <th scope="col">Participant</th><th scope="col">Source</th></tr></thead>
      <tbody>{receipt.states.map(s=><tr key={s.bid_comment_id} data-bid-comment-id={s.bid_comment_id}>
        <td><button type="button" className="stack-link" onClick={()=>onSelect(s.bid_comment_id)} aria-label={`Open the book at bid ${s.seq}`}>{s.seq}</button></td>
        <td><time dateTime={s.posted_at}>{time(s.posted_at)}</time><br/><time dateTime={s.db_recorded_at}>{time(s.db_recorded_at)}</time></td>
        <td className="num">{rawAmount(s)}</td><td><Participant id={s.external_identity_id} identities={identities}/></td>
        <td><SourceBid state={s}/><details><summary>Record keys</summary><span className="stack-mono">{s.bid_comment_id}<br/>Auction {receipt.auction_event_id}</span></details></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function BidPathFold({receipt,identities,selectedId,bookReady,onSelect}:{receipt:BidPathReceipt;identities:Identities;
  selectedId:string|null;bookReady:boolean;onSelect:(id:string)=>void}){
  const selected=selectedId?receipt.states.find(s=>s.bid_comment_id===selectedId):receipt.states.at(-1);
  if(selectedId&&!selected)return <p role="status">The requested source bid is outside the measured inputs. No other bid is selected.</p>;
  if(!selected)return <p className="stack-note">Zero eligible bids in the retained known inputs. Source and clock coverage remain visible above; this does not establish zero auction activity.</p>;
  const index=selected.seq-1;
  const selectedBookReady=bookReady&&receipt.selected_bid_comment_id===selected.bid_comment_id;
  return <div className="bid-path">
    <div className="stack-asof"><span>Bid {selected.seq} of {count(receipt.summary.bid_count)} · {time(selected.posted_at)}</span>
      <span className="stack-mono">Running high {formatBidAmount(selected.price)}</span>
      <span>{selected.identities} keyed identities + {selected.unresolved_entries} unresolved bid entries</span></div>
    <label className="stack-scrubber"><span className="stack-label">Replay known bid inputs</span>
      <input type="range" min={0} max={receipt.states.length-1} value={index} disabled={receipt.states.length===1}
        aria-label="Replay known bid inputs" aria-valuetext={`Bid ${selected.seq} of ${receipt.states.length}: ${formatBidAmount(selected.price)}`}
        onChange={event=>onSelect(receipt.states[Number(event.target.value)].bid_comment_id)}/><span>{selected.seq} / {receipt.states.length}</span></label>
    <div className="stack-event-flow" aria-label="Selected SQL bid and its effect on the book">
      <div><span className="stack-label">Source bid</span><strong className="stack-event-value">{rawAmount(selected)}</strong><SourceBid state={selected}/></div>
      <div><span className="stack-label">Participant</span><Participant id={selected.external_identity_id} identities={identities}/>
        <span className="stack-basis">Recorded by us {time(selected.db_recorded_at)}</span></div>
      <div><span className="stack-label">Book after this bid</span><strong className="stack-event-value">{formatBidAmount(selected.price)}</strong>
        <span className="stack-basis">{selected.price_change===null?'First eligible bid; no prior high in these inputs':`High-bid change ${formatBidAmount(selected.price_change)}`} · {span(selected.seconds_to_close*1000)} before recorded close</span></div>
    </div>
    <div className="stack-fold-grid"><BidPathChart receipt={receipt} selectedId={selected.bid_comment_id} onSelect={onSelect}/>
      {selectedBookReady?<RevealedCurve receipt={receipt} state={selected}/>:<p role="status">Reading this bid’s book and supporting source records…</p>}</div>
    {selectedBookReady&&<><dl className="bid-path__facts"><dt>Depth at 90% / 75% of running high</dt><dd>{selected.depth_90} / {selected.depth_75} entries</dd>
      <dt>Second-best revealed bid / top-two gap</dt><dd>{selected.entries<2?'Not defined with fewer than two entries':`${formatBidAmount(selected.second_best)} / ${formatBidAmount(selected.top_two_gap)}`}</dd></dl>
      <BidEntryTable receipt={receipt} identities={identities}/></>}
  </div>;
}
