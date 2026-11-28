import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../../lib/supabase',()=>({supabase:mock}));
import { assertCommentSurface, commentHourRequest, commentPageRequest, commentParams, commentRequestFromParams, fetchCommentSurface, initialCommentRequest,
  type CommentSurfaceReceipt, type CommentSurfaceRequest } from './commentSurfaceReader';
import { commentFixture, LOT, VEHICLE } from './__fixtures__/commentSurface';
const request:CommentSurfaceRequest={evidence_filter:'all_discussion'};
beforeEach(()=>mock.rpc.mockReset());

describe('episode comment measurement contract',()=>{
  it('reads only the exact episode overload and accepts known partial measurements',async()=>{
    mock.rpc.mockResolvedValue({data:commentFixture(),error:null});
    expect(await fetchCommentSurface(VEHICLE,LOT,request)).toMatchObject({features:{discussion_entries:24,text_entries:22,media_only_entries:1}});
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('popup_vehicle_intel',{p_vehicle_id:VEHICLE,p_auction_event_id:LOT,p_request:request});
  });
  it('retains a source refusal and propagates a transport error without a fabricated zero',async()=>{
    mock.rpc.mockResolvedValueOnce({data:{state:'unavailable',reason:'evidence_snapshot_changed'},error:null});
    expect(await fetchCommentSurface(VEHICLE,LOT,request)).toEqual({state:'unavailable',reason:'evidence_snapshot_changed'});
    mock.rpc.mockResolvedValueOnce({data:null,error:{code:'57014'}});
    await expect(fetchCommentSurface(VEHICLE,LOT,request)).rejects.toMatchObject({code:'57014'});
  });
  it.each([
    ['different vehicle',(d:CommentSurfaceReceipt)=>{d.vehicle_id=LOT;}],
    ['different auction',(d:CommentSurfaceReceipt)=>{d.auction_event_id=VEHICLE;}],
    ['unknown method',(d:CommentSurfaceReceipt)=>{d.method_version=2 as 1;}],
    ['literacy scoring',(d:CommentSurfaceReceipt)=>{d.units.literacy='score';}],
    ['changed pattern',(d:CommentSurfaceReceipt)=>{d.pattern_profiles.questions='semantic_question_v2';}],
    ['invalid partition',(d:CommentSurfaceReceipt)=>{d.features.media_only_entries=5;}],
    ['text denominator',(d:CommentSurfaceReceipt)=>{d.features.question_mark_entries=23;}],
    ['missing coverage',(d:CommentSurfaceReceipt)=>{delete (d.coverage as Partial<typeof d.coverage>).unknown_event_time;}],
    ['invented participant coverage',(d:CommentSurfaceReceipt)=>{d.features.keyed_participant_count=2;}],
    ['wrong contributor parent',(d:CommentSurfaceReceipt)=>{d.evidence.contributors[0].vehicle_id=LOT;}],
    ['unsafe source',(d:CommentSurfaceReceipt)=>{d.evidence.contributors[0].source_url='https://example.test/';}],
    ['duplicate evidence',(d:CommentSurfaceReceipt)=>{d.evidence.contributors[1]=d.evidence.contributors[0];}],
    ['future known input',(d:CommentSurfaceReceipt)=>{d.evidence.contributors[0].db_recorded_at='2026-12-01T00:00:00Z';}],
    ['missing marker',(d:CommentSurfaceReceipt)=>{d.evidence.contributors[0].url_marker=null;}],
    ['incomplete page',(d:CommentSurfaceReceipt)=>{d.evidence.contributors.pop();}],
  ])('refuses %s',(_label,mutate)=>{
    const d=commentFixture();mutate(d);expect(()=>assertCommentSurface(d,VEHICLE,LOT,request)).toThrow('Unsupported comment');
  });
  it('keeps a same-snapshot second page with both initial clocks, including a pinned first page',()=>{
    const first=commentFixture();const next=commentPageRequest(first,20);
    expect(next).toMatchObject({offset:20,snapshot_hash:first.evidence.snapshot_hash,event_cutoff:first.event_cutoff,recorded_cutoff:first.recorded_cutoff});
    const second=commentFixture(next);expect(()=>assertCommentSurface(second,VEHICLE,LOT,next)).not.toThrow();
    expect(second.evidence.contributors).toHaveLength(4);
    expect(new Set([...first.evidence.contributors,...second.evidence.contributors].map(r=>r.comment_id)).size).toBe(24);
    expect(initialCommentRequest(next)).toEqual(request);
  });
  it('carries the actual reconstruction cutoff rather than the recorded final close',()=>{
    const r:CommentSurfaceRequest={...request,knowledge_mode:'recorded_input_reconstruction',cutoff:'2026-11-25T20:50:00Z'};
    const d=commentFixture(r);const page=commentPageRequest(d,20);
    expect(page.cutoff).toBe(r.cutoff);expect(page.event_cutoff).toBeUndefined();
    expect(()=>assertCommentSurface(d,VEHICLE,LOT,r)).not.toThrow();
    d.recorded_cutoff='2026-11-25T20:55:00Z';expect(()=>assertCommentSurface(d,VEHICLE,LOT,r)).toThrow();
  });
  it('round trips shared pinned state without changing the auction drill',()=>{
    const r=commentPageRequest(commentFixture({...request,include_trajectory:true}),20);
    const params=commentParams(new URLSearchParams(`lot=${LOT}&layer=dimension&at=bid`),r);
    expect(commentRequestFromParams(params)).toEqual(r);expect(params.get('lot')).toBe(LOT);expect(params.get('at')).toBe('bid');
    const reset=commentParams(params,initialCommentRequest(r));expect(reset.has('csHash')).toBe(false);expect(reset.has('csRecorded')).toBe(false);
  });
  it.each(['csOffset=20','csHash=invalid','csFilter=expert','csCutoff=yesterday','csCutoff=2026-11-25T20%3A50%3A00',
    'csEvent=2026-11-25T20%3A50%3A00Z','csOffset=0&csOffset=20','csCutoff=2026-11-25T20%3A50%3A00Z&csRecorded=2026-11-25T20%3A50%3A00Z'])('does not silently repair invalid shared state %s',s=>{
    expect(commentRequestFromParams(new URLSearchParams(s))).toBeNull();
  });
  it.each(['text','media_only','no_captured_content'] as const)('validates the %s evidence denominator',filter=>{
    const r={evidence_filter:filter};expect(()=>assertCommentSurface(commentFixture(r),VEHICLE,LOT,r)).not.toThrow();
  });
  it.each(['media_only','no_captured_content'] as const)('accepts a long whitespace source entry in %s without a text excerpt',filter=>{
    const r={evidence_filter:filter},d=commentFixture(r);
    d.evidence.contributors[0].excerpt_truncated=true;
    expect(()=>assertCommentSurface(d,VEHICLE,LOT,r)).not.toThrow();
  });
});

describe('hourly discussion projection',()=>{
  const projection:CommentSurfaceRequest={evidence_filter:'all_discussion',include_trajectory:true};
  it('accepts the complete projected population and same-snapshot exact-hour pages',()=>{
    const d=commentFixture(projection),hour='2026-11-25T19:00:00.000Z';
    expect(()=>assertCommentSurface(d,VEHICLE,LOT,projection)).not.toThrow();
    const selected=commentHourRequest(d,hour),page=commentFixture(selected);
    expect(()=>assertCommentSurface(page,VEHICLE,LOT,selected)).not.toThrow();
    expect(commentPageRequest(page,20)).toMatchObject({include_trajectory:true,evidence_bucket:hour,offset:20,snapshot_hash:d.evidence.snapshot_hash});
    const params=commentParams(new URLSearchParams(`lot=${LOT}&layer=dimension`),selected);
    expect(commentRequestFromParams(params)).toEqual(selected);
    expect(initialCommentRequest(selected)).toEqual(projection);
    expect(commentHourRequest(page,null).evidence_bucket).toBeUndefined();
  });
  it('accepts an empty retained hour without changing full-window totals',()=>{
    const request=commentHourRequest(commentFixture(projection),'2026-11-25T18:00:00.000Z'),d=commentFixture(request);
    expect(()=>assertCommentSurface(d,VEHICLE,LOT,request)).not.toThrow();
    expect(d.evidence.matching_entries).toBe(0);expect(d.features.discussion_entries).toBe(24);
  });
  it('accepts a zero-duration final instant with a count and a null rate',()=>{
    const request={...projection,knowledge_mode:'recorded_input_reconstruction' as const,cutoff:'2026-11-25T19:00:00Z'};
    const d=commentFixture(request);d.recorded_cutoff='2026-11-25T19:30:00Z';request.cutoff=d.recorded_cutoff;
    // Keep this case a current pinned receipt: source arrivals can precede the read while event time is pinned to the boundary.
    d.knowledge_mode='current_recorded_state';
    const pinned:CommentSurfaceRequest={...projection,event_cutoff:d.event_cutoff,recorded_cutoff:d.recorded_cutoff,snapshot_hash:d.evidence.snapshot_hash};
    expect(d.trajectory?.buckets.at(-1)).toMatchObject({window_seconds:0,discussion_entries:24,entries_per_window_hour:null});
    expect(()=>assertCommentSurface(d,VEHICLE,LOT,pinned)).not.toThrow();
  });
  it.each([
    ['missing projection',(d:CommentSurfaceReceipt)=>{delete d.trajectory;}],
    ['wrong method',(d:CommentSurfaceReceipt)=>{d.trajectory!.method_id='other' as never;}],
    ['missing hour',(d:CommentSurfaceReceipt)=>{d.trajectory!.buckets.pop();}],
    ['duplicate hour',(d:CommentSurfaceReceipt)=>{d.trajectory!.buckets[1]=d.trajectory!.buckets[0];}],
    ['changed hourly total',(d:CommentSurfaceReceipt)=>{d.trajectory!.buckets[334].discussion_entries++;}],
    ['invalid window denominator',(d:CommentSurfaceReceipt)=>{d.trajectory!.buckets[1].window_seconds=42;}],
    ['wrong rate',(d:CommentSurfaceReceipt)=>{d.trajectory!.buckets[334].entries_per_window_hour=9000;}],
    ['false cumulative count',(d:CommentSurfaceReceipt)=>{d.trajectory!.buckets[1].cumulative_discussion_entries=1;}],
    ['unsupported capture claim',(d:CommentSurfaceReceipt)=>{d.trajectory!.rate_basis='observed_capture' as never;}],
  ])('rejects %s before drawing a curve',(_name,change)=>{
    const d=commentFixture(projection);change(d);expect(()=>assertCommentSurface(d,VEHICLE,LOT,projection)).toThrow('Unsupported comment measurement receipt');
  });
  it('rejects source records outside the selected hour even when their count matches',()=>{
    const request=commentHourRequest(commentFixture(projection),'2026-11-25T19:00:00.000Z'),d=commentFixture(request);
    d.evidence.contributors[0].posted_at='2026-11-25T18:59:59Z';
    expect(()=>assertCommentSurface(d,VEHICLE,LOT,request)).toThrow();
  });
  it.each(['csHour=2026-11-25T19%3A00%3A00Z','csHour=bad','csHour=2026-11-25T19%3A01%3A00Z',
    'csHour=2026-11-25T19%3A00%3A00Z&csHour=2026-11-25T20%3A00%3A00Z'])('refuses incomplete or invalid hour pins %s',search=>{
    expect(commentRequestFromParams(new URLSearchParams(search))).toBeNull();
  });
});
