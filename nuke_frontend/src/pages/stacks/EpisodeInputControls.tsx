import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { clearBidSelection } from './bidPathReader';
import { commentParams, commentRequestFromParams, finiteCommentClock } from './commentSurfaceReader';
import './CommentMeasurements.css';

/** A chosen reconstruction cutoff applies to both SQL methods. Each current read keeps its own receipt clock. */
export function resetEpisodeInputs(params:URLSearchParams,cutoff?:string):URLSearchParams{
  const filter=commentRequestFromParams(params)?.evidence_filter??'all_discussion';
  return commentParams(clearBidSelection(params),{evidence_filter:filter,
    ...(cutoff?{knowledge_mode:'recorded_input_reconstruction',cutoff}:{})});
}

export default function EpisodeInputControls({vehicleId,lotId,closeAt}:{vehicleId:string;lotId:string;closeAt:string|null}){
  const [params,setParams]=useSearchParams(),client=useQueryClient();
  const cutoff=params.get('csCutoff')??'';
  const [draft,setDraft]=useState(cutoff),[error,setError]=useState(''),[refreshing,setRefreshing]=useState(false);
  const inputId=useId();
  const active=useRef(true),latest=useRef({vehicleId,lotId,search:params.toString()});
  latest.current={vehicleId,lotId,search:params.toString()};
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  useEffect(()=>{setDraft(cutoff);setError('');},[cutoff]);
  const apply=(value?:string)=>{setError('');setParams(resetEpisodeInputs(params,value));};
  const matches=(key:readonly unknown[])=>['auction-bid-path','auction-comment-surface'].includes(String(key[0]))&&key[1]===vehicleId&&key[2]===lotId;
  const refresh=async()=>{
    setRefreshing(true);setError('');
    const started=latest.current;
    try{
      // Invalidate before resetting pinned keys: otherwise a fresh cache can restore the refused first page.
      await client.invalidateQueries({predicate:q=>matches(q.queryKey),refetchType:'none'});
      if(!active.current||latest.current.vehicleId!==started.vehicleId||latest.current.lotId!==started.lotId||latest.current.search!==started.search)return;
      const next=resetEpisodeInputs(params,finiteCommentClock(cutoff)?cutoff:undefined);
      if(next.toString()===params.toString())await client.refetchQueries({predicate:q=>matches(q.queryKey),type:'active'});
      else setParams(next);
      await client.invalidateQueries({queryKey:['stack-order-book',vehicleId],refetchType:'active'});
    }catch{if(active.current)setError('The auction inputs could not be refreshed. Retry the read.');}
    finally{if(active.current)setRefreshing(false);}
  };
  const preset=(minutes:number)=>{
    if(!closeAt||!finiteCommentClock(closeAt))return;
    const value=new Date(Date.parse(closeAt)-minutes*60_000).toISOString();setDraft(value);apply(value);
  };
  return <section className="comment-measure episode-input-controls" aria-label="Input cutoff for bids and comments" aria-busy={refreshing}>
    <div className="comment-measure__controls">
      <button type="button" className="stack-chip" aria-pressed={!cutoff} onClick={()=>apply()}>Current recorded state</button>
      <button type="button" className="stack-chip" disabled={refreshing} onClick={()=>void refresh()}>Refresh auction measurements</button>
    </div>
    <details open={Boolean(cutoff)}><summary>Reconstruct an earlier cutoff for bids and comments</summary>
      {closeAt&&finiteCommentClock(closeAt)&&<div className="comment-measure__controls" role="group" aria-label="Auction reconstruction shortcuts">
        <button type="button" className="stack-chip" onClick={()=>preset(60)}>Reconstruct 1 hour before recorded close</button>
        <button type="button" className="stack-chip" onClick={()=>preset(10)}>Reconstruct 10 minutes before recorded close</button>
      </div>}
      <form className="comment-measure__cutoff" onSubmit={event=>{
        event.preventDefault();if(!finiteCommentClock(draft)){setError('Enter a timestamp including seconds and Z or a UTC offset.');return;}apply(draft);
      }}><label htmlFor={inputId}>Bid and discussion input cutoff (ISO timestamp with timezone)</label>
        <input id={inputId} value={draft} onChange={event=>setDraft(event.target.value)} autoComplete="off" spellCheck={false}
          placeholder="2026-11-25T21:00:00Z" aria-invalid={Boolean(error)} aria-describedby={error?`${inputId}-error`:undefined}/>
        <button type="submit" className="stack-chip">Reconstruct cutoff</button>
      </form>
      <p className="stack-note">Both models use the chosen cutoff. Current lot metadata and comparable-sale context remain current records. Each current measurement displays its own database read time.</p>
    </details>
    {error&&<p id={`${inputId}-error`} role="alert">{error}</p>}
  </section>;
}
