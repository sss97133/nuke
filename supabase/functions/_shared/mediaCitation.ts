/** Typed evidence links and clocks, independent of any particular extraction model.
 * A caption cue can discuss a vehicle without proving that it is visible or that its lot is active.
 */
export interface MediaCitation {
  publication_id?: string;
  auction_event_id?: string;
  start_ms: number;
  end_ms?: number;
  relation: "vehicle_visible" | "vehicle_discussed" | "lot_active" | "screen_display" | "room_visible" | "participant_action" | "crowd_audio" | "metadata";
  span_semantics: "point_sample" | "caption_cue" | "measured_presence_interval" |
    "measured_lot_interval" | "measured_utterance" | "candidate_interval";
}
export interface SourceTime {
  observed_at_basis: "event_time" | "source_capture_time" | "source_publication_time";
  event_precision: "exact" | "day" | "unknown";
  event_at?: string;
  event_date?: string;
  available_at?: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const instant = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}T/.test(s) && Number.isFinite(Date.parse(s));
const date = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export function mediaCitationColumns(media?: MediaCitation, clock?: SourceTime): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (media) {
    for (const id of [media.publication_id, media.auction_event_id]) {
      if (id && !uuid.test(id)) throw new Error("Media citation IDs must be UUIDs");
    }
    if (!Number.isSafeInteger(media.start_ms) || media.start_ms < 0) throw new Error("Invalid media start_ms");
    if (media.end_ms !== undefined && (!Number.isSafeInteger(media.end_ms) || media.end_ms < media.start_ms)) {
      throw new Error("Invalid media end_ms");
    }
    if (!["vehicle_visible", "vehicle_discussed", "lot_active", "screen_display", "room_visible", "participant_action", "crowd_audio", "metadata"].includes(media.relation)) {
      throw new Error("Invalid media relation");
    }
    if (!["point_sample", "caption_cue", "measured_presence_interval", "measured_lot_interval", "measured_utterance", "candidate_interval"].includes(media.span_semantics)) {
      throw new Error("Invalid media span semantics");
    }
    if (media.span_semantics.startsWith("measured_") && media.end_ms === undefined) throw new Error("Measured interval requires an end");
    if (media.span_semantics === "point_sample" && media.end_ms !== undefined && media.end_ms !== media.start_ms) {
      throw new Error("Point sample cannot claim an interval");
    }
    if (media.span_semantics === "caption_cue" && media.relation !== "vehicle_discussed") {
      throw new Error("Caption cues do not prove visibility or active lot intervals");
    }
    if (media.span_semantics === "measured_presence_interval" && media.relation !== "vehicle_visible") {
      throw new Error("Measured presence must be a visibility relation");
    }
    if (media.span_semantics === "measured_lot_interval" && media.relation !== "lot_active") {
      throw new Error("Measured lot interval must be an active lot relation");
    }
    Object.assign(out, { citation_publication_id: media.publication_id ?? null,
      auction_event_id: media.auction_event_id ?? null, media_start_ms: media.start_ms,
      media_end_ms: media.end_ms ?? null, media_relation: media.relation,
      media_span_semantics: media.span_semantics });
  }
  if (clock) {
    if (!["event_time", "source_capture_time", "source_publication_time"].includes(clock.observed_at_basis)) throw new Error("Invalid observed_at_basis");
    if (!["exact", "day", "unknown"].includes(clock.event_precision)) throw new Error("Invalid event precision");
    if (clock.event_precision === "exact" && !instant(clock.event_at)) throw new Error("Exact event clock requires event_at");
    if (clock.event_precision === "day" && !date(clock.event_date)) throw new Error("Day event clock requires event_date");
    if (clock.event_precision === "unknown" && clock.event_date != null) throw new Error("Unknown event clock cannot claim a date");
    if (clock.event_precision !== "exact" && clock.event_at != null) throw new Error("Non-exact event clocks cannot claim an instant");
    if (clock.event_at != null && !instant(clock.event_at)) throw new Error("Invalid event_at");
    if (clock.event_date != null && !date(clock.event_date)) throw new Error("Invalid event_date");
    if (clock.available_at != null && !instant(clock.available_at)) throw new Error("Invalid source available_at");
    Object.assign(out, { observed_at_basis: clock.observed_at_basis,
      source_event_time_precision: clock.event_precision, source_event_at: clock.event_at ?? null,
      source_event_date: clock.event_date ?? null, source_available_at: clock.available_at ?? null });
  }
  return out;
}
