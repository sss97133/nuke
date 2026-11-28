import type { BidPathEntry, BidPathReceipt, BidPathRequest, BidPathState } from '../bidPathReader';
export const BID_VEHICLE='00000000-0000-4000-8000-000000000001';
export const BID_LOT='00000000-0000-4000-8000-000000000002';
export const BID_SOURCE='https://bringatrailer.com/listing/synthetic-source/';
export const BID_CLOSE='2026-11-25T21:00:00Z';
export const BID_A='00000000-0000-4000-8000-000000000003',BID_B='00000000-0000-4000-8000-000000000004';
export const bidId=(i:number)=>`00000000-0000-4000-8000-${String(100+i).padStart(12,'0')}`;
const post=['20:00','20:30','20:50','20:55','20:55'],recorded=['20:01','21:05','20:51','20:56','20:56'];
const at=(time:string)=>`2026-11-25T${time}:00Z`;

/** Hand-calculated source fixture, including a late recorded B bid and a non-increasing last bid. */
export function bidFixture(request:BidPathRequest={},revision=0):BidPathReceipt{
  const columns=[
    ['100','100',BID_A,1,1,0,null,1,1,null,null],
    ['200','200',BID_B,2,2,0,'100',1,1,'100','100'],
    ['300','300',BID_A,2,2,0,'200',1,1,'100','100'],
    ['350','350',null,3,2,1,'300',1,2,'50','50'],
    ['325','350',BID_B,3,2,1,'325',2,3,'0','25'],
  ] as const;
  let states:BidPathState[]=columns.map((c,i)=>({seq:i+1,bid_comment_id:bidId(i),native_comment_id:String(i+1),
    source_url:`${BID_SOURCE}#comment-${i+1}`,source_locator_basis:'source_and_typed_lot_relation',
    posted_at:at(post[i]),db_recorded_at:at(recorded[i]),seconds_to_close:(Date.parse(BID_CLOSE)-Date.parse(at(post[i])))/1000,
    amount:c[0],price:c[1],external_identity_id:c[2],entries:c[3],identities:c[4],unresolved_entries:c[5],
    second_best:c[6],depth_90:c[7],depth_75:c[8],price_change:c[9],top_two_gap:c[10]}));
  const entry=(identity:string|null,maximum:string,support:number[],highest:number,depth:number):BidPathEntry=>({
    entry_key:identity?`identity:${identity}`:`unresolved_bid:${bidId(support[0])}`,external_identity_id:identity,
    maximum_revealed_bid:maximum,depth_at_revealed_bid:depth,bid_count:support.length,
    first_bid_comment_id:bidId(support[0]),last_bid_comment_id:bidId(support.at(-1)!),highest_bid_comment_id:bidId(highest),
    supporting_bid_comment_ids:support.map(bidId),
  });
  let books:BidPathEntry[][]=[
    [entry(BID_A,'100',[0],0,1)],
    [entry(BID_B,'200',[1],1,1),entry(BID_A,'100',[0],0,2)],
    [entry(BID_A,'300',[0,2],2,1),entry(BID_B,'200',[1],1,2)],
    [entry(null,'350',[3],3,1),entry(BID_A,'300',[0,2],2,2),entry(BID_B,'200',[1],1,3)],
    [entry(null,'350',[3],3,1),entry(BID_B,'325',[1,4],4,2),entry(BID_A,'300',[0,2],2,3)],
  ];
  const reconstruction=request.knowledge_mode==='recorded_input_reconstruction';
  if(reconstruction){
    if(Date.parse(request.cutoff!)!==Date.parse(at('20:52')))throw new Error('Fixture supports explicit 20:52 cutoff only');
    states=[states[0],{...states[2],seq:2,entries:1,identities:1,second_best:null,top_two_gap:null,price_change:'200'}];
    books=[books[0],[entry(BID_A,'300',[0,2],2,1)]];
  }
  const selected=request.selected_bid_comment_id?states.findIndex(s=>s.bid_comment_id===request.selected_bid_comment_id):states.length-1;
  if(selected<0)throw new Error('Fixture selected bid not eligible');
  const cutoff=request.cutoff??request.recorded_cutoff??'2026-11-28T06:00:00Z';
  return {state:'partial',reason:'retained_keyed_known_inputs_only',contract_version:1,method_id:'captured_bid_path',method_version:1,
    folding_mode:'on_read_no_stored_fold_writes',auction_event_id:BID_LOT,vehicle_id:BID_VEHICLE,source_url:BID_SOURCE,
    measured_at:'2026-11-28T06:00:00Z',knowledge_mode:reconstruction?'recorded_input_reconstruction':'current_recorded_state',
    event_cutoff:request.event_cutoff??(reconstruction?cutoff:BID_CLOSE),recorded_cutoff:cutoff,
    close_at_as_currently_recorded:BID_CLOSE,window_from:'2026-11-11T21:00:00Z',window_basis:'recorded_close_minus_14_days_not_observed_opening',
    historical_forecast_receipt:false,final_sale_price_used_as_input:false,complete_external_capture:false,snapshot_hash:String(revision+1).repeat(32),
    limits:{source_rows:5000,bid_states:500,source_locator_bytes:4194304,amount_absolute:'1000000000000000000',amount_scale:6},
    units:{amounts:'exact_numeric_decimal_strings',entries:'platform_identity_or_one_unresolved_bid',
      depth_90:'entries_at_or_above_90_percent_of_running_high_bid',depth_75:'entries_at_or_above_75_percent_of_running_high_bid',
      seconds_to_close:'seconds_from_posted_time_to_currently_recorded_close',willingness_to_pay:'unmeasured_bid_is_a_lower_bound'},
    amount_context:{basis:'current_lot_fields_not_historical_qualification',currency_state:'unknown',currency_code:null,currency_source:null,
      price_basis:null,price_kind:null,price_kind_source:null,price_basis_conflict:null},
    ordering:'posted_at_then_native_comment_id_or_zero_then_comment_uuid_C',
    summary:{bid_count:states.length,keyed_participant_count:reconstruction?1:2,unresolved_bid_entries:reconstruction?0:1,
      first_bid_at:states[0].posted_at,last_bid_at:states.at(-1)!.posted_at,running_high_bid:reconstruction?'300':'350',minimum_bid:'100',
      latest_bid:reconstruction?'300':'325',trailing_window_anchor:reconstruction?cutoff:BID_CLOSE,
      bids_in_60_minutes_to_event_cutoff:reconstruction?2:4,bids_in_10_minutes_to_event_cutoff:reconstruction?1:2},
    coverage:{keyed_source_rows:5,eligible_bid_states:states.length,source_bid_marked_rows:5,amount_without_bid_label:0,
      bid_marked_unknown_amounts:0,bid_marked_unknown_event_time:0,bid_marked_unknown_recording_time:0,
      bids_outside_event_cutoff:reconstruction?2:0,posted_bids_recorded_after_cutoff:reconstruction?1:0,
      eligible_bids_without_platform_key:reconstruction?0:1,eligible_bids_with_other_platform_key:0,unkeyed_source_rows:'not_assessed'},
    states,selected_bid_comment_id:states[selected].bid_comment_id,selected_seq:selected+1,
    selected_book_basis:'posted_order_prefix_within_requested_known_inputs',book:books[selected]};
}
