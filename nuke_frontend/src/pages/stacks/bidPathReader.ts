import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { finiteCommentClock as finiteClock } from './commentSurfaceReader';

export interface BidPathRequest {
  knowledge_mode?: 'recorded_input_reconstruction'; cutoff?: string;
  selected_bid_comment_id?: string; snapshot_hash?: string; event_cutoff?: string; recorded_cutoff?: string;
}
export interface BidPathState {
  seq:number; bid_comment_id:string; native_comment_id:string|null; source_url:string;
  source_locator_basis:'typed_lot_relation_only'|'source_and_typed_lot_relation';
  posted_at:string; db_recorded_at:string; seconds_to_close:number;
  amount:string; price:string; external_identity_id:string|null; price_change:string|null; top_two_gap:string|null;
  entries:number; identities:number; unresolved_entries:number; second_best:string|null; depth_90:number; depth_75:number;
}
export interface BidPathEntry {
  entry_key:string; external_identity_id:string|null; maximum_revealed_bid:string; depth_at_revealed_bid:number;
  bid_count:number; first_bid_comment_id:string; last_bid_comment_id:string; highest_bid_comment_id:string;
  supporting_bid_comment_ids:string[];
}
export interface BidPathReceipt {
  state:'partial'; reason:'retained_keyed_known_inputs_only';contract_version:1;method_id:'captured_bid_path';method_version:1;
  folding_mode:'on_read_no_stored_fold_writes';auction_event_id:string;vehicle_id:string;source_url:string;
  measured_at:string;knowledge_mode:'current_recorded_state'|'recorded_input_reconstruction';
  event_cutoff:string;recorded_cutoff:string;close_at_as_currently_recorded:string;window_from:string;
  window_basis:'recorded_close_minus_14_days_not_observed_opening';historical_forecast_receipt:false;
  final_sale_price_used_as_input:false;complete_external_capture:false;snapshot_hash:string;
  limits:{source_rows:5000;bid_states:500;source_locator_bytes:4194304;amount_absolute:string;amount_scale:6};
  units:Record<string,string>;
  amount_context:{basis:'current_lot_fields_not_historical_qualification';currency_state:'unknown'|'recorded_claim';
    currency_code:string|null;currency_source:string|null;price_basis:string|null;price_kind:string|null;
    price_kind_source:string|null;price_basis_conflict:boolean|null};
  ordering:'posted_at_then_native_comment_id_or_zero_then_comment_uuid_C';
  summary:{bid_count:number;keyed_participant_count:number;unresolved_bid_entries:number;first_bid_at:string|null;
    last_bid_at:string|null;running_high_bid:string|null;minimum_bid:string|null;latest_bid:string|null;
    trailing_window_anchor:string;bids_in_60_minutes_to_event_cutoff:number;bids_in_10_minutes_to_event_cutoff:number};
  coverage:{keyed_source_rows:number;eligible_bid_states:number;source_bid_marked_rows:number;amount_without_bid_label:number;
    bid_marked_unknown_amounts:number;bid_marked_unknown_event_time:number;bid_marked_unknown_recording_time:number;
    bids_outside_event_cutoff:number;posted_bids_recorded_after_cutoff:number;eligible_bids_without_platform_key:number;
    eligible_bids_with_other_platform_key:number;unkeyed_source_rows:'not_assessed'};
  states:BidPathState[];selected_bid_comment_id:string|null;selected_seq:number|null;
  selected_book_basis:'posted_order_prefix_within_requested_known_inputs';book:BidPathEntry[];
}
export type BidPathResponse=BidPathReceipt|{state:'unavailable';reason:string};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{32}$/;
const count=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const sameTime=(a:string,b:string)=>Date.parse(a)===Date.parse(b);
const nullableText=(v:unknown)=>v===null||typeof v==='string';
const fail=():never=>{throw new Error('Unsupported bid-path receipt');};

/** Fixed-point comparison validates server values; no client fold or published derived statistic. */
export function bidDecimal(value:unknown):bigint {
  if(typeof value!=='string'||!/^\d+(\.\d{1,6})?$/.test(value))return fail();
  const [whole,fraction='']=value.split('.');
  const fixed=BigInt(whole)*1_000_000n+BigInt(fraction.padEnd(6,'0'));
  if(fixed>1_000_000_000_000_000_000_000_000n)return fail();
  return fixed;
}

/** Labels preserve the SQL decimal, including cents and large integer values. */
export function formatBidAmount(value:string|null):string {
  if(value===null)return 'unknown';
  bidDecimal(value);
  const [whole,fraction]=value.split('.');
  return BigInt(whole).toLocaleString('en-US')+(fraction===undefined?'':'.'+fraction);
}

const BID_PARAMS=['bpHash','bpEvent','bpRecorded'];
export function bidRequestFromParams(params:URLSearchParams):BidPathRequest|null {
  if([...BID_PARAMS,'csCutoff','at'].some(k=>params.getAll(k).length>1))return null;
  const cutoff=params.get('csCutoff'),selected=params.get('at'),hash=params.get('bpHash');
  const event=params.get('bpEvent'),recorded=params.get('bpRecorded');
  if((cutoff!==null&&!finiteClock(cutoff))||(selected!==null&&!UUID.test(selected))||(hash!==null&&!HASH.test(hash))
    ||(cutoff!==null&&(event!==null||recorded!==null))
    ||(cutoff===null&&((hash!==null)!==(event!==null&&recorded!==null)||(event===null)!==(recorded===null)
      ||(event!==null&&!finiteClock(event))||(recorded!==null&&!finiteClock(recorded)))))return null;
  return {...(cutoff?{knowledge_mode:'recorded_input_reconstruction' as const,cutoff}:{}),
    ...(selected?{selected_bid_comment_id:selected}:{}),...(hash?{snapshot_hash:hash}:{}),
    ...(event&&recorded?{event_cutoff:event,recorded_cutoff:recorded}:{})};
}

export function clearBidSelection(params:URLSearchParams):URLSearchParams {
  const next=new URLSearchParams(params);BID_PARAMS.forEach(k=>next.delete(k));next.delete('at');return next;
}

export function selectBidParams(params:URLSearchParams,receipt:BidPathReceipt,id:string):URLSearchParams {
  if(!receipt.states.some(s=>s.bid_comment_id===id))throw new Error('Bid is outside the measured inputs');
  const next=clearBidSelection(params);next.set('bpHash',receipt.snapshot_hash);
  if(id!==receipt.states.at(-1)?.bid_comment_id)next.set('at',id);
  if(receipt.knowledge_mode==='recorded_input_reconstruction')next.set('csCutoff',receipt.recorded_cutoff);
  else{next.delete('csCutoff');next.set('bpEvent',receipt.event_cutoff);next.set('bpRecorded',receipt.recorded_cutoff);}
  return next;
}

export function assertBidPath(value:unknown,vehicle:string,lot:string,request:BidPathRequest):asserts value is BidPathReceipt {
  const d=value as BidPathReceipt;
  if(!d||d.state!=='partial'||d.reason!=='retained_keyed_known_inputs_only'||d.contract_version!==1
    ||d.method_id!=='captured_bid_path'||d.method_version!==1||d.folding_mode!=='on_read_no_stored_fold_writes'
    ||d.vehicle_id!==vehicle||d.auction_event_id!==lot||d.knowledge_mode!==(request.knowledge_mode??'current_recorded_state')
    ||!/^https:\/\/bringatrailer\.com\/listing\/[a-z0-9-]+\/$/.test(d.source_url)
    ||d.window_basis!=='recorded_close_minus_14_days_not_observed_opening'||d.historical_forecast_receipt!==false
    ||d.final_sale_price_used_as_input!==false||d.complete_external_capture!==false||(d as {truncated?:unknown}).truncated===true||!HASH.test(d.snapshot_hash)
    ||(request.snapshot_hash&&request.snapshot_hash!==d.snapshot_hash)
    ||![d.measured_at,d.event_cutoff,d.recorded_cutoff,d.close_at_as_currently_recorded,d.window_from].every(finiteClock)
    ||Date.parse(d.recorded_cutoff)>Date.parse(d.measured_at)
    ||Date.parse(d.event_cutoff)>Math.min(Date.parse(d.recorded_cutoff),Date.parse(d.close_at_as_currently_recorded))
    ||Date.parse(d.event_cutoff)<Date.parse(d.window_from)
    ||Date.parse(d.window_from)!==Date.parse(d.close_at_as_currently_recorded)-14*86_400_000
    ||(request.cutoff&&!sameTime(request.cutoff,d.recorded_cutoff))
    ||(request.event_cutoff&&!sameTime(request.event_cutoff,d.event_cutoff))
    ||(request.recorded_cutoff&&!sameTime(request.recorded_cutoff,d.recorded_cutoff))
    ||d.ordering!=='posted_at_then_native_comment_id_or_zero_then_comment_uuid_C'
    ||d.selected_book_basis!=='posted_order_prefix_within_requested_known_inputs')return fail();
  const units={amounts:'exact_numeric_decimal_strings',entries:'platform_identity_or_one_unresolved_bid',
    depth_90:'entries_at_or_above_90_percent_of_running_high_bid',depth_75:'entries_at_or_above_75_percent_of_running_high_bid',
    seconds_to_close:'seconds_from_posted_time_to_currently_recorded_close',willingness_to_pay:'unmeasured_bid_is_a_lower_bound'};
  if(Object.entries(units).some(([k,v])=>d.units?.[k]!==v)||d.limits?.source_rows!==5000||d.limits.bid_states!==500
    ||d.limits.source_locator_bytes!==4194304||d.limits.amount_absolute!=='1000000000000000000'||d.limits.amount_scale!==6)return fail();
  const c=d.coverage,f=d.summary,context=d.amount_context;
  if(!c||!f||!context||!Array.isArray(d.states)||!Array.isArray(d.book)||d.states.length>500
    ||Object.entries(c).some(([k,v])=>k==='unkeyed_source_rows'?v!=='not_assessed':!count(v)||v>5000)
    ||!['keyed_source_rows','eligible_bid_states','source_bid_marked_rows','amount_without_bid_label','bid_marked_unknown_amounts',
      'bid_marked_unknown_event_time','bid_marked_unknown_recording_time','bids_outside_event_cutoff','posted_bids_recorded_after_cutoff',
      'eligible_bids_without_platform_key','eligible_bids_with_other_platform_key'].every(k=>count(c[k as keyof typeof c]))
    ||c.unkeyed_source_rows!=='not_assessed'||c.eligible_bid_states!==d.states.length||c.eligible_bid_states>c.source_bid_marked_rows||c.source_bid_marked_rows>c.keyed_source_rows
    ||c.eligible_bids_with_other_platform_key>c.eligible_bids_without_platform_key
    ||f.bid_count!==d.states.length||!count(f.keyed_participant_count)||!count(f.unresolved_bid_entries)
    ||f.unresolved_bid_entries!==c.eligible_bids_without_platform_key
    ||![f.bids_in_60_minutes_to_event_cutoff,f.bids_in_10_minutes_to_event_cutoff].every(v=>count(v)&&v<=f.bid_count)
    ||f.bids_in_10_minutes_to_event_cutoff>f.bids_in_60_minutes_to_event_cutoff
    ||!finiteClock(f.trailing_window_anchor)||!sameTime(f.trailing_window_anchor,d.event_cutoff)
    ||context.basis!=='current_lot_fields_not_historical_qualification'
    ||![context.currency_code,context.currency_source,context.price_basis,context.price_kind,context.price_kind_source].every(nullableText)
    ||!(context.price_basis_conflict===null||typeof context.price_basis_conflict==='boolean')
    ||context.currency_state!==(/^[A-Z]{3}$/.test(context.currency_code??'')&&Boolean(context.currency_source?.trim())?'recorded_claim':'unknown'))return fail();
  const byId=new Map<string,BidPathState>();
  let previous:BidPathState|undefined;
  for(const [index,s]of d.states.entries()){
    if(s.seq!==index+1||!UUID.test(s.bid_comment_id)||byId.has(s.bid_comment_id)
      ||!(s.external_identity_id===null||UUID.test(s.external_identity_id))
      ||!(s.native_comment_id===null||typeof s.native_comment_id==='string'&&/^-?\d{1,19}$/.test(s.native_comment_id))
      ||!['typed_lot_relation_only','source_and_typed_lot_relation'].includes(s.source_locator_basis)
      ||s.source_url!==d.source_url+(s.native_comment_id!==null&&BigInt(s.native_comment_id)>0n?`#comment-${s.native_comment_id}`:'')
      ||![s.posted_at,s.db_recorded_at].every(finiteClock)||Date.parse(s.posted_at)<Date.parse(d.window_from)
      ||Date.parse(s.posted_at)>Date.parse(d.event_cutoff)||Date.parse(s.db_recorded_at)>Date.parse(d.recorded_cutoff)
      ||typeof s.seconds_to_close!=='number'||!Number.isFinite(s.seconds_to_close)||s.seconds_to_close<0
      ||Math.abs(s.seconds_to_close-(Date.parse(d.close_at_as_currently_recorded)-Date.parse(s.posted_at))/1000)>0.001
      ||![s.entries,s.identities,s.unresolved_entries,s.depth_90,s.depth_75].every(count)
      ||s.entries<1||s.entries>s.seq||s.identities+s.unresolved_entries!==s.entries
      ||s.depth_90<1||s.depth_90>s.depth_75||s.depth_75>s.entries)return fail();
    const price=bidDecimal(s.price),amount=bidDecimal(s.amount);
    if(price<amount||(previous&&price<bidDecimal(previous.price))
      ||(previous?bidDecimal(s.price_change)!==price-bidDecimal(previous.price):s.price_change!==null)
      ||(s.entries<2?(s.second_best!==null||s.top_two_gap!==null):s.second_best===null
        ||bidDecimal(s.second_best)>price||bidDecimal(s.top_two_gap)!==price-bidDecimal(s.second_best)))return fail();
    if(previous){const delta=Date.parse(s.posted_at)-Date.parse(previous.posted_at);
      const nativeDelta=BigInt(s.native_comment_id??'0')-BigInt(previous.native_comment_id??'0');
      if(delta<0||delta===0&&(nativeDelta<0n||nativeDelta===0n&&s.bid_comment_id<previous.bid_comment_id))return fail();}
    byId.set(s.bid_comment_id,s);previous=s;
  }
  const last=d.states.at(-1);
  if(last){if(f.first_bid_at!==d.states[0].posted_at||f.last_bid_at!==last.posted_at
    ||bidDecimal(f.running_high_bid)!==bidDecimal(last.price)||bidDecimal(f.latest_bid)!==bidDecimal(last.amount)
    ||bidDecimal(f.minimum_bid)>bidDecimal(f.running_high_bid)||f.keyed_participant_count!==last.identities
    ||f.unresolved_bid_entries!==last.unresolved_entries)return fail();}
  else if([f.first_bid_at,f.last_bid_at,f.running_high_bid,f.minimum_bid,f.latest_bid,d.selected_bid_comment_id,d.selected_seq].some(v=>v!==null)
    ||f.keyed_participant_count!==0||f.unresolved_bid_entries!==0||d.book.length!==0)return fail();
  const selected=request.selected_bid_comment_id??last?.bid_comment_id??null;
  const selectedState=selected?byId.get(selected):undefined;
  if(d.selected_bid_comment_id!==selected||d.selected_seq!==(selectedState?.seq??null)
    ||d.book.length!==(selectedState?.entries??0))return fail();
  const entries=new Set<string>(),supported=new Set<string>();let prior:bigint|undefined;
  for(const e of d.book){
    const maximum=bidDecimal(e.maximum_revealed_bid);
    if(entries.has(e.entry_key)||!(e.external_identity_id===null||UUID.test(e.external_identity_id))
      ||!count(e.bid_count)||e.bid_count<1||!Array.isArray(e.supporting_bid_comment_ids)||e.supporting_bid_comment_ids.length!==e.bid_count
      ||!count(e.depth_at_revealed_bid)||e.depth_at_revealed_bid<1||e.depth_at_revealed_bid>d.book.length
      ||e.first_bid_comment_id!==e.supporting_bid_comment_ids[0]||e.last_bid_comment_id!==e.supporting_bid_comment_ids.at(-1)
      ||!e.supporting_bid_comment_ids.includes(e.highest_bid_comment_id)||prior!==undefined&&maximum>prior
      ||e.entry_key!==(e.external_identity_id?`identity:${e.external_identity_id}`:`unresolved_bid:${e.first_bid_comment_id}`)
      ||e.external_identity_id===null&&e.bid_count!==1)return fail();
    let previousSeq=0;
    for(const id of e.supporting_bid_comment_ids){const s=byId.get(id);
      if(!s||supported.has(id)||s.seq>selectedState!.seq||s.seq<=previousSeq||s.external_identity_id!==e.external_identity_id
        ||bidDecimal(s.amount)>maximum)return fail();previousSeq=s.seq;supported.add(id);}
    if(bidDecimal(byId.get(e.highest_bid_comment_id)!.amount)!==maximum)return fail();
    entries.add(e.entry_key);prior=maximum;
  }
  if(supported.size!==(selectedState?.seq??0))return fail();
  for(let start=0;start<d.book.length;){
    let end=start+1;
    while(end<d.book.length&&bidDecimal(d.book[end].maximum_revealed_bid)===bidDecimal(d.book[start].maximum_revealed_bid))end++;
    if(d.book.slice(start,end).some(e=>e.depth_at_revealed_bid!==end))return fail();
    start=end;
  }
}

export const bidPathKey=(vehicle:string,lot:string,request:BidPathRequest|null)=>['auction-bid-path',vehicle,lot,request] as const;
export async function fetchBidPath(vehicle:string,lot:string,request:BidPathRequest,signal?:AbortSignal):Promise<BidPathResponse>{
  let call=supabase.rpc('lot_order_book_read',{p_auction_event_id:lot,p_request:request});
  if(signal)call=call.abortSignal(signal);
  const {data,error}=await call;if(error)throw error;
  if(data?.state==='unavailable'&&typeof data.reason==='string')return {state:'unavailable',reason:data.reason};
  assertBidPath(data,vehicle,lot,request);return data;
}
export function useBidPath(vehicle:string,lot:string,request:BidPathRequest|null){
  return useQuery({queryKey:bidPathKey(vehicle,lot,request),queryFn:({signal})=>fetchBidPath(vehicle,lot,request!,signal),
    enabled:UUID.test(vehicle)&&UUID.test(lot)&&request!==null,staleTime:60_000,retry:false,refetchOnWindowFocus:false,
    placeholderData:previous=>previous?.state==='partial'&&previous.vehicle_id===vehicle&&previous.auction_event_id===lot
      &&request?.snapshot_hash===previous.snapshot_hash&&previous.knowledge_mode===(request.knowledge_mode??'current_recorded_state')
      &&(!request.cutoff||sameTime(request.cutoff,previous.recorded_cutoff))
      &&(!request.event_cutoff||sameTime(request.event_cutoff,previous.event_cutoff))
      &&(!request.recorded_cutoff||sameTime(request.recorded_cutoff,previous.recorded_cutoff))?previous:undefined,
    refetchInterval:query=>{
      if(!request||request.cutoff||request.snapshot_hash||query.state.data?.state!=='partial')return false;
      const remaining=Date.parse(query.state.data.close_at_as_currently_recorded)-Date.now();
      return remaining>0?(remaining<=15*60_000?5000:60_000):false;
    }});
}
