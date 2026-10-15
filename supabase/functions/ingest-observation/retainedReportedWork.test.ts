import { deriveRetainedReportedWork, descriptionReportedWorkWitnesses, retainedReportedWorkSelector, RETAINED_REPORTED_WORK_MODE as MODE } from "./retainedReportedWork.ts";
const equal=(a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`);};
const HONDA="Work in September 2026 included rebuilding the carburetor, repairing an exhaust leak, and replacing the fuel filter, fuel hoses, and exhaust gaskets.";
const TIRES="The tires, front struts, and front wheel hubs were replaced in July 2023, an inspection at that time recommended replacing the front brake pads and rotors.";
const GASKET="The transmission oil pan gasket was replaced and the fluid flushed in July 2023, an inspection at that time recommended flushing the rear differential.";
const text=(s:string)=>`This vehicle is described by its publisher in retained listing text. ${s} Physical completion has no independent corroboration.`;
const id="11111111-1111-4111-8111-111111111111", vehicleId="22222222-2222-4222-8222-222222222222";
const source={id,vehicle_id:vehicleId,source_id:id,kind:"listing",is_superseded:false,property_id:null,subject_type:"vehicle",subject_id:null,
 source_url:"https://bringatrailer.com/listing/synthetic-work/",extraction_method:"html_description_capture",confidence_score:1,
 observed_at:"2026-10-10T02:40:06.123456Z",ingested_at:"2026-10-10T02:40:08.123456Z",content_text:text(HONDA),
 structured_data:{extractor:"extract-bat-core",source_text_field:"extract-bat-core.extractDescription",description_capture:true,
 source_capture_basis:"direct_fetch",source_capture_sha256:"a".repeat(64),source_captured_at:"2026-10-10T02:40:06.123456Z",
 observation_time_basis:"source_capture",source_event_time_status:"unknown",extractor_input_truncated:false}};
const vehicle={id:vehicleId,is_public:true,deleted_at:null,listing_kind:"vehicle"};
const registry={id,slug:"bat",supported_observations:["listing","activity"]};
Deno.test("reported work retains exact claimed month and full recommendation context without promoting recommendations",()=>{
 const w=descriptionReportedWorkWitnesses(text(HONDA));
 equal(w,[{source_value:HONDA,performed_clause:HONDA,reported_date:"2026-09",reported_date_label:"September 2026",date_precision:"month"}]);
 const mixed=descriptionReportedWorkWitnesses(text(`${TIRES} ${GASKET}`));equal(mixed.length,2);
 for(const [i,q]of [TIRES,GASKET].entries()) {equal(mixed[i].source_value,q);equal(mixed[i].performed_clause,q.split(", an inspection")[0]);equal(mixed[i].reported_date,"2023-07");}
 equal(descriptionReportedWorkWitnesses(text(`${HONDA} ${HONDA}`)).length,1);
});
Deno.test("qualified, recommended, unknown-date and performer assertions are withheld rather than trimmed",()=>{
 for(const q of [
  "Work in September 2026 included not rebuilding the carburetor.",
  "Work in September 2026 included rebuilding the carburetor, pending approval.",
  "Work in September 2026 included rebuilding the carburetor, subject to approval.",
  "Work in September 2026 included rebuilding the carburetor, as a hypothetical example.",
  "Work in September 2026 included replacing the tires, except this was canceled.",
  "Service in March 2026 included replacing the tubes, tires, and more.",
  "The tires were replaced in July 2023, an inspection at that time recommended replacing the front brake pads and rotors, because the earlier report was false.",
  "Work in September 2026 was recommended and included rebuilding the carburetor.",
  "Work planned in September 2026 included rebuilding the carburetor.",
  "Work in September 2026 included rebuilding the carburetor or replacing it.",
  "Work in September 2026 included rebuilding the carburetor, but it was never done.",
  "The tires were not replaced in July 2023, an inspection at that time recommended replacing the brakes.",
  "The tires were replaced in July 2023, an inspection at that time recommended instead replacing them.",
  "An inspection in July 2023 recommended replacing the front brake pads and rotors.",
  "The tires were replaced by a mechanic in July 2023.",
  "Work in 2026 included rebuilding the carburetor.",
  "Work last month included rebuilding the carburetor.",
  "Work in September 2026 included rebuilding the carburetor?",
 ]) equal(descriptionReportedWorkWitnesses(text(q)),[]);
});
Deno.test("governing context across a newline is not discarded",()=>{
 for(const context of ["Not performed:\n", "The work was never completed.\n", "Recommended work:\n", "The following work was not performed:\n", "Only the following proposed work is described.\n", "This was recommended for the next service:\n"])
  equal(descriptionReportedWorkWitnesses(text(context+HONDA)),[]);
 equal(descriptionReportedWorkWitnesses(text("\u00a0"+HONDA)),[]);
});
Deno.test("one protected selector binds immutable source sentence identity and distinct clocks with unknown performer",async()=>{
 const before=JSON.stringify(source);const c=(await deriveRetainedReportedWork(source,vehicle,registry,0))!;
 equal(c.kind,"activity");equal(c.observed_at,source.ingested_at);equal(c.structured_data.source_captured_at,source.observed_at);
 equal(c.structured_data.performer_id,null);equal(c.structured_data.performer_status,"unknown");equal(c.structured_data.occurrence_status,"unverified");
 equal(c.structured_data.reported_date,"2026-09");equal("transaction_date" in c.structured_data,false);
 equal(c.agent_cost_cents,0);equal(c.structured_data.independent_source,false);equal(JSON.stringify(source),before);
 const shifted=(await deriveRetainedReportedWork({...source,content_text:text(`${TIRES} ${HONDA}`)},vehicle,registry,1))!;
 equal(shifted.source_identifier,c.source_identifier);equal(shifted.structured_data,c.structured_data);
 for(const extra of [{performed_clause:HONDA},{reported_date:"2026-09-01"},{performer_id:id},{occurrence_status:"confirmed"},{source_value:HONDA}])
  equal(retainedReportedWorkSelector({mode:MODE,source_observation_id:id,report_index:0,...extra}),null);
 for(const report_index of [-1,8,1.5,"0",null]) equal(retainedReportedWorkSelector({mode:MODE,source_observation_id:id,report_index}),null);
});
Deno.test("source capability, public custody, complete capture and month chronology gate derived activity",async()=>{
 const derive=(s:Record<string,any>,v=vehicle,r=registry)=>deriveRetainedReportedWork(s,v,r,0);
 for(const delta of [{is_superseded:true},{source_id:vehicleId},{kind:"work_record"},{content_text:text(HONDA.replace("September 2026","December 2026"))},
  {observed_at:"2026-10-10T02:40:06.123455Z"},{ingested_at:"2026-10-10T02:40:06.123455Z"}]) equal(await derive({...source,...delta}),null);
 for(const [key,value]of Object.entries({source_capture_sha256:"bad",source_capture_basis:"unverified",extractor_input_truncated:true,description_capture:false,source_event_time_status:"known"}))
  equal(await derive({...source,structured_data:{...source.structured_data,[key]:value}}),null);
 equal(await derive(source,{...vehicle,is_public:false}),null);equal(await derive(source,vehicle,{...registry,supported_observations:["listing"]}),null);
 equal(await deriveRetainedReportedWork(source,vehicle,registry,8),null);
});
