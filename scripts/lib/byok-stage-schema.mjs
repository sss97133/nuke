// The reviewed reader's closed output grammar, as plain JSON Schema. One copy: the Deno reviewed batch
// (scripts/daily-receipt/reviewed-image-batch.ts, which hands it to codex --output-schema) and the Node subscription
// frame reader (scripts/photo-pipeline/subscription-frame-classifier.mjs, which hands it to `claude --json-schema`) both
// import it, so the two cannot drift. The shared validator (supabase/functions/_shared/byokImageVerdict.mjs) stays
// authoritative; this only closes the shape the model may answer in.
/** The agent_tier of the subscription reader's automatic two-pass reading (platform_config image_reading_tiers, automatic.tier). */
export const AUTOMATIC_READING_TIER = 'subscription automatic';

/**
 * Every value the four cross-checked fields of a verdict may hold (scene_type, rust_severity, paint_state, completeness),
 * read from the grammar below: the only words an automatic reading's question may name. The intake guard holds the same
 * list (c_vocab in image_reading_thin_violation, migration 20261120140000); a value added to the grammar must be added there.
 */
export function crossCheckedValues() {
  const v = stageSchema('verdicts').properties.verdicts.items.properties, s = v.state_observations.properties;
  return [...new Set([...v.scene_type.enum, ...s.rust_severity.enum, ...s.paint_state.enum, ...s.completeness.enum])];
}

export function stageSchema(key) {
  const str = { type: "string" }, bool = { type: "boolean" }, probability = { type: "number", minimum: 0, maximum: 1 };
  const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
  const arr = (items) => ({ type: "array", items });
  const nullable = (type) => ({ type: [type, "null"] });
  const choice = (values) => ({ type: "string", enum: values.split("|") });
  const bbox = { type: "array", items: { type: "number", minimum: 0, maximum: 999 }, minItems: 4, maxItems: 4 };
  const verdict = obj({ image_id: str, vehicle_id: str,
    scene_type: choice("engine_bay|body_exterior|body_interior|undercarriage|receipt_document|data_plate|hand_drawn_diagram|shop_context|fabrication_in_progress|paint_booth|wheel_assembly|road_test|off_property|cross_reference|product_screenshot|spreadsheet|unknown"),
    build_phase_guess: choice("discovery|teardown|metalwork|paint_prep|paint_application|mechanical_assembly|wiring|interior|final_assembly|drivable|show_finish|unknown"),
    intent: choice("labor|inspection|parts_sourcing|communication|acquisition|documentation|unknown"), intent_confidence: probability, needs_clarification: bool,
    components_seen: arr(obj({ label: str, confidence: probability, bbox, part_number_guess: nullable("string") })),
    text_regions: arr(obj({ text: str, bbox, confidence: probability })),
    damage_localized: arr(obj({ label: str, bbox, severity: str })),
    state_observations: obj({ rust_severity: choice("none|surface|pitting|perforation|unknown"), paint_state: choice("bare_metal|primer|sealer|base|clear|aged|unknown"), completeness: choice("stripped|partial|assembled|unknown"), damage_callouts: arr(str) }),
    workshop_signals: obj({ tools_visible: arr(str), fixturing: str, weld_quality: str, lighting: str }),
    presence: obj({ person: bool, dog: bool, place_hint: nullable("string") }),
    camera_pose: obj({ method: str, framing: str, azimuth_deg: nullable("number"), elevation_deg: nullable("number"), distance_est: nullable("string"), exif_present: nullable("boolean") }),
    narrative_one_line: str, confidence: probability, context_complete: bool, open_questions: arr(str), agent_notes: str });
  return obj({ [key]: arr(key === "reviews" ? obj({ image_id: str, findings: arr(str) }) : verdict) });
}
