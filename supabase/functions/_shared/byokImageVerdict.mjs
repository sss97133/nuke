// Shared, dependency-free BYOK verdict contract. Used by the existing CLI and reviewed-result intake.
const SCENE_TYPES = new Set(["engine_bay","body_exterior","body_interior","undercarriage","receipt_document","data_plate","hand_drawn_diagram","shop_context","fabrication_in_progress","paint_booth","wheel_assembly","road_test","off_property","cross_reference","product_screenshot","spreadsheet","unknown"]);
const BUILD_PHASES = new Set(["discovery","teardown","metalwork","paint_prep","paint_application","mechanical_assembly","wiring","interior","final_assembly","drivable","show_finish","unknown"]);
const RUST = new Set(["none","surface","pitting","perforation","unknown"]);
const PAINT = new Set(["bare_metal","primer","sealer","base","clear","aged","unknown"]);
const COMPLETE = new Set(["stripped","partial","assembled","unknown"]);
const INTENT = new Set(["labor","inspection","parts_sourcing","communication","acquisition","documentation","unknown"]);
const INTENT_CONFIRM_THRESHOLD = 0.6; // below this, intent must be flagged for the ask-the-technician loop
const isBbox = (b) => Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === "number" && n >= 0 && n <= 999);

export function validateVerdict(v) {
  const errs = [];
  for (const f of ["image_id","vehicle_id","scene_type","build_phase_guess","components_seen","state_observations","workshop_signals","presence","camera_pose","narrative_one_line","confidence"]) {
    if (v[f] === undefined || v[f] === null) errs.push(`missing ${f}`);
  }
  if (v.scene_type && !SCENE_TYPES.has(v.scene_type)) errs.push(`scene_type not in enum: ${v.scene_type}`);
  if (v.build_phase_guess && !BUILD_PHASES.has(v.build_phase_guess)) errs.push(`build_phase_guess not in enum: ${v.build_phase_guess}`);
  // intent gate: what the photo is FOR. Only confirmed labor accrues value (the $410 fix).
  if (!v.intent || !INTENT.has(v.intent)) errs.push(`intent missing/not in enum (labor|inspection|parts_sourcing|communication|acquisition|documentation|unknown): ${v.intent}`);
  if (typeof v.intent_confidence !== "number" || v.intent_confidence < 0 || v.intent_confidence > 1) errs.push("intent_confidence must be number 0–1");
  // when intent is unsure, it MUST be flagged for the ask-the-technician loop — never silently assumed
  if ((v.intent === "unknown" || (typeof v.intent_confidence === "number" && v.intent_confidence < INTENT_CONFIRM_THRESHOLD)) && v.needs_clarification !== true)
    errs.push("low-confidence/unknown intent requires needs_clarification:true (ask the technician — don't assume)");
  if (typeof v.confidence !== "number" || v.confidence < 0 || v.confidence > 1) errs.push("confidence must be number 0–1");
  if (typeof v.narrative_one_line === "string" && v.narrative_one_line.length < 12) errs.push("narrative_one_line too short (lazy)");
  // Banned phrase — structured camera_pose only, never "3/4"
  const poseStr = JSON.stringify(v.camera_pose || "");
  if (/3\s*\/\s*4|three[- ]?quarter/i.test(poseStr)) errs.push('camera_pose contains banned "3/4"/"three-quarter" — use structured azimuth/elevation/distance');
  if (typeof v.camera_pose !== "object" || Array.isArray(v.camera_pose)) errs.push("camera_pose must be a structured object");
  // Every localized array element must carry a valid bbox (TWVP 0–999)
  for (const [arr, name] of [[v.components_seen,"components_seen"],[v.damage_localized,"damage_localized"],[v.text_regions,"text_regions"]]) {
    if (arr === undefined) continue;
    if (!Array.isArray(arr)) { errs.push(`${name} must be an array`); continue; }
    arr.forEach((it, i) => {
      if (!isBbox(it?.bbox)) errs.push(`${name}[${i}] missing/invalid bbox (need [x1,y1,x2,y2] 0–999)`);
      if (name === "components_seen" && (typeof it?.confidence !== "number" || it.confidence < 0 || it.confidence > 1)) errs.push(`components_seen[${i}] confidence must be 0–1`);
      // text_regions carry `text`; components/damage carry `label`
      const labelField = name === "text_regions" ? "text" : "label";
      if (typeof it?.[labelField] !== "string" || it[labelField].length < 1) errs.push(`${name}[${i}] missing ${labelField}`);
    });
  }
  const so = v.state_observations || {};
  if (so.rust_severity && !RUST.has(so.rust_severity)) errs.push(`rust_severity not in enum: ${so.rust_severity}`);
  if (so.paint_state && !PAINT.has(so.paint_state)) errs.push(`paint_state not in enum: ${so.paint_state}`);
  if (so.completeness && !COMPLETE.has(so.completeness)) errs.push(`completeness not in enum: ${so.completeness}`);
  if (v.presence && typeof v.presence.person !== "boolean") errs.push("presence.person must be boolean");
  return errs;
}

