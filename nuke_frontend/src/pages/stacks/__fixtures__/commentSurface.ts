import type { CommentContribution, CommentSurfaceReceipt, CommentSurfaceRequest } from '../commentSurfaceReader';

export const VEHICLE='00000000-0000-4000-8000-000000000001';
export const LOT='00000000-0000-4000-8000-000000000002';
export const CLOSE='2026-11-25T21:00:00Z';
export const SOURCE='https://bringatrailer.com/listing/synthetic-source/';
export function commentFixture(request:CommentSurfaceRequest={evidence_filter:'all_discussion'},revision=0):CommentSurfaceReceipt {
  const text=(i:number)=>i===0?'300hp? https://example.test/evidence':i===1?'300hp? source':i<6?'Synthetic question?':'Captured discussion';
  const all:CommentContribution[]=Array.from({length:24},(_,i)=>({
    comment_id:`00000000-0000-4000-8000-${String(i+100+revision*1000).padStart(12,'0')}`,
    vehicle_id:VEHICLE,auction_event_id:LOT,native_comment_id:i+1,source_url:`${SOURCE}#comment-${i+1}`,
    source_locator_basis:'source_and_typed_lot_relation',source_comment_type:'observation',is_seller:false,
    external_identity_id:i===0?'00000000-0000-4000-8000-000000000003':null,
    posted_at:'2026-11-25T19:00:00Z',db_recorded_at:'2026-11-25T19:30:00Z',
    characters:i<22?text(i).length:null,whitespace_tokens:i<22?2:null,question_marks:i<22?(i<6?1:0):null,
    url_marker:i<22?i===0:null,numeric_unit_marker:i<22?i<2:null,media_reference_count:i===22?1:0,
    excerpt:i<22?text(i):null,excerpt_truncated:false,
  }));
  const filtered=all.filter(r=>request.evidence_filter==='all_discussion'||(request.evidence_filter==='text'&&r.excerpt!==null)
    ||(request.evidence_filter==='media_only'&&r.excerpt===null&&r.media_reference_count>0)
    ||(request.evidence_filter==='no_captured_content'&&r.excerpt===null&&r.media_reference_count===0))
    .filter(r=>!request.evidence_bucket||Math.floor(Date.parse(r.posted_at)/3_600_000)===Math.floor(Date.parse(request.evidence_bucket)/3_600_000));
  const offset=request.offset??0,more=filtered.length>offset+20;
  const receipt:CommentSurfaceReceipt={state:'partial',contract_version:1,method_id:'auction_comment_surface',method_version:1,reason:'retained_keyed_inputs_only',
    vehicle_id:VEHICLE,auction_event_id:LOT,source_url:SOURCE,knowledge_mode:request.knowledge_mode??'current_recorded_state',
    measured_at:'2026-11-28T06:00:00Z',event_cutoff:request.event_cutoff??(request.cutoff&&Date.parse(request.cutoff)<Date.parse(CLOSE)?request.cutoff:CLOSE),
    recorded_cutoff:request.cutoff??request.recorded_cutoff??'2026-11-28T06:00:00Z',
    close_at_as_currently_recorded:CLOSE,window_from:'2026-11-11T21:00:00Z',
    window_basis:'recorded_close_minus_14_days_not_observed_opening',historical_forecast_receipt:false,complete_external_capture:false,truncated:false,
    units:{volume:'retained_source_entries',tokens:'whitespace_separated_runs',characters:'postgres_character_count',
      markers:'literal_pattern_presence',media:'nonblank_stored_media_references_not_verified_assets',expertise:'unmeasured',literacy:'unmeasured'},
    pattern_profiles:{tokens:'posix_nonspace_runs_v1',questions:'literal_ascii_question_mark_v1',urls:'http_or_https_marker_v1',numeric_units:'english_automotive_unit_marker_v1'},
    coverage:{keyed_source_rows:30,unknown_event_time:1,unknown_recording_time:1,outside_event_window:0,recorded_after_cutoff:0,
      source_bid_marked_rows:4,other_source_labels:0,discussion_posted_by_cutoff:24,discussion_recorded_by_cutoff:24,
      unkeyed_source_rows:'not_assessed',semantic_classification:'not_assessed'},
    features:{discussion_entries:24,text_entries:22,media_only_entries:1,no_captured_text_or_media_entries:1,
      whitespace_tokens:44,median_whitespace_tokens:2,question_mark_entries:6,question_mark_count:6,url_marker_entries:1,numeric_unit_marker_entries:2,
      seller_flagged_entries:0,unknown_seller_flag_entries:0,keyed_participant_count:1,unkeyed_participant_entries:23},
    evidence:{snapshot_hash:String(revision+1).repeat(32),offset,limit:20,filter:request.evidence_filter,matching_entries:filtered.length,
      has_more:more,next_offset:more?offset+20:null,contributors:filtered.slice(offset,offset+20)},
  };
  if(request.include_trajectory){
    const start=Date.parse(receipt.window_from),end=Date.parse(receipt.event_cutoff),first=Math.floor(start/3_600_000)*3_600_000;
    const occupied=Date.parse(all[0].posted_at),f=receipt.features;
    receipt.trajectory={contract_version:1,method_id:'auction_comment_hourly_v1',bucket_unit:'UTC_hour',nominal_bucket_seconds:3600,
      event_time_basis:'posted_at',count_unit:'retained_eligible_discussion_entries',rate_basis:'eligible_window_seconds_not_observed_capture_uptime',
      zero_basis:'zero_retained_eligible_entries_not_zero_external_activity',participant_basis:'distinct_keyed_platform_identities_per_bucket_not_additive_people',
      buckets:Array.from({length:Math.floor((end-first)/3_600_000)+1},(_,i)=>{
        const at=first+i*3_600_000,from=Math.max(at,start),to=Math.min(at+3_600_000,end),seconds=(to-from)/1000;
        const here=occupied>=at&&occupied<at+3_600_000;
        return {bucket_start:new Date(at).toISOString(),window_start:new Date(from).toISOString(),window_end:new Date(to).toISOString(),window_seconds:seconds,
          discussion_entries:here?f.discussion_entries:0,text_entries:here?f.text_entries:0,media_only_entries:here?f.media_only_entries:0,
          no_captured_content_entries:here?f.no_captured_text_or_media_entries:0,whitespace_tokens:here?f.whitespace_tokens:0,
          question_mark_entries:here?f.question_mark_entries:0,url_marker_entries:here?f.url_marker_entries:0,numeric_unit_marker_entries:here?f.numeric_unit_marker_entries:0,
          seller_flagged_entries:here?f.seller_flagged_entries:0,unknown_seller_flag_entries:here?f.unknown_seller_flag_entries:0,
          keyed_participant_count:here?f.keyed_participant_count:0,unkeyed_participant_entries:here?f.unkeyed_participant_entries:0,
          entries_per_window_hour:seconds===0?null:Math.round((here?f.discussion_entries:0)*3600/seconds*1e6)/1e6,
          cumulative_discussion_entries:at+3_600_000>occupied?f.discussion_entries:0};
      })};
    receipt.evidence.bucket_start=request.evidence_bucket??null;
  }
  return receipt;
}
