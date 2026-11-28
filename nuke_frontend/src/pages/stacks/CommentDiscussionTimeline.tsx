import { useEffect, useId, useRef, useState } from 'react';
import type { CommentSurfaceReceipt } from './commentSurfaceReader';

const utc=(clock:string)=>new Date(clock).toISOString().replace('T',' ').replace(/\.000Z$/,' UTC');

/** SQL supplies each count and hour. The browser selects and draws those points. */
export default function CommentDiscussionTimeline({receipt,choose}:{receipt:CommentSurfaceReceipt;choose:(hour:string|null)=>void}){
  const id=useId(),trajectory=receipt.trajectory,figure=useRef<HTMLElement>(null);
  const [width,setWidth]=useState(680);
  const available=trajectory!==undefined;
  useEffect(()=>{
    const element=figure.current;if(!available||!element)return;
    const measure=()=>{const next=element.getBoundingClientRect().width;if(next>0)setWidth(Math.max(260,next));};
    measure();if(typeof ResizeObserver==='undefined')return;
    const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();
  },[available]);
  if(!trajectory)return null;
  const buckets=trajectory.buckets,selected=receipt.evidence.bucket_start??null;
  const height=240,left=40,right=16,top=16,bottom=36;
  const maximum=Math.max(1,...buckets.map(b=>b.discussion_entries)),plotWidth=width-left-right,plotHeight=height-top-bottom;
  const barWidth=plotWidth/buckets.length;
  const first=buckets[0],last=buckets.at(-1)!;
  return <figure ref={figure} className="comment-timeline" aria-label="Captured discussion timeline">
    <figcaption>Discussion through this auction</figcaption>
    <p className="stack-note">All captured discussion entries per UTC hour. Select an hour to inspect its source records.</p>
    <div className="comment-timeline__controls">
      <label htmlFor={id}>Inspect a UTC hour</label>
      <select id={id} value={selected??''} onChange={event=>choose(event.target.value||null)}>
        <option value="">All hours · {receipt.features.discussion_entries.toLocaleString('en-US')} entries</option>
        {buckets.map(b=><option key={b.bucket_start} value={b.bucket_start}>{utc(b.bucket_start)} · {b.discussion_entries.toLocaleString('en-US')} retained</option>)}
      </select>
    </div>
    <svg className="comment-timeline__plot" viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label="Retained discussion entries per UTC hour; the hour selector provides all plotted values and opens their source records">
      <line className="comment-timeline__axis" x1={left} x2={width-right} y1={height-bottom} y2={height-bottom}/>
      <text x={left-8} y={top+8} textAnchor="end">{maximum.toLocaleString('en-US')}</text>
      <text x={left-8} y={height-bottom+4} textAnchor="end">0</text>
      {buckets.map((b,i)=>{
        const h=b.discussion_entries/maximum*plotHeight;
        return <g key={b.bucket_start} data-discussion-hour={b.bucket_start} data-entry-count={b.discussion_entries}
          className={selected===b.bucket_start?'comment-timeline__hour is-selected':'comment-timeline__hour'} onClick={()=>choose(b.bucket_start)}>
          <title>{utc(b.bucket_start)}: {b.discussion_entries.toLocaleString('en-US')} retained entries. Inspect with the hour selector or select this column.</title>
          <rect className="comment-timeline__hit" x={left+i*barWidth} y={top} width={barWidth} height={plotHeight}/>
          {selected===b.bucket_start&&<line className="comment-timeline__selected-hour" x1={left+(i+0.5)*barWidth} x2={left+(i+0.5)*barWidth} y1={top} y2={height-bottom}/>}
          <rect x={left+i*barWidth} y={height-bottom-h} width={Math.max(0.25,barWidth*0.8)} height={h}/>
        </g>;
      })}
      <text x={left} y={height-8}>{utc(first.bucket_start).slice(5,16)}</text>
      <text x={width-right} y={height-8} textAnchor="end">{utc(last.bucket_start).slice(5,16)}</text>
    </svg>
    <p className="stack-note">Zero means no retained eligible entries in that hour. External capture coverage is unknown.</p>
  </figure>;
}
