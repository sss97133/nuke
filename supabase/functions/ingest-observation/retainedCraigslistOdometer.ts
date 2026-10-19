import { retainedCraigslistCaptureQualified } from "./retainedCraigslistCapture.ts";
export const CRAIGSLIST_ODOMETER_PROFILE = "craigslist_auto_miles_v1";
export function craigslistOdometerValue(raw:unknown):number|null {
 if(typeof raw!=="string"||raw.length>20||!/^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)$/.test(raw))return null;
 const n=Number(raw.replaceAll(",",""));return Number.isSafeInteger(n)&&n>=0&&n<10000000?n:null;
}
export function deriveRetainedCraigslistOdometer(p:Record<string,any>,v:Record<string,any>|null,s:Record<string,any>|null){
 const r=p?.extraction_metadata?.raw,a=r?.attributes,raw=a?.raw?.auto_miles,value=craigslistOdometerValue(raw);
 if(!retainedCraigslistCaptureQualified(p,v,s)||value===null||a.odometer_raw!==raw||a.odometer!==value||
  typeof a.odometer_broken!=="boolean"||typeof a.odometer_rolled_over!=="boolean"||
  a.odometer_broken!==Object.hasOwn(a.raw,"odometer_broken")||a.odometer_rolled_over!==Object.hasOwn(a.raw,"odometer_rolled_over"))return null;
 const mode="retained_listing_mileage_miles_v1";
 return {source_slug:"craigslist",kind:"listing",vehicle_id:p.vehicle_id,property_key:"mileage_miles",source_url:p.source_url,
  source_identifier:`${mode}:${p.id}`,observed_at:p.ingested_at,extraction_method:"retained_listing_property_projection_v1",
  raw_source_ref:`vehicle_observations:${p.id}`,content_text:"Retained Craigslist auto_miles listing label; reported count only. True mileage and reading event time remain unknown.",
  confidence_score:Math.min(.4,p.confidence_score),agent_cost_cents:0,agent_model:null,
  structured_data:{mileage_miles:value,source_profile:CRAIGSLIST_ODOMETER_PROFILE,source_native_post_id:r.post_id,
   source_value:raw,source_reading_value:value,source_reading_unit:"miles",reading_unit_basis:"platform_auto_miles_attribute",
   reported_precision_miles:1,value_is_approximate:false,reading_role:"listing_odometer_label",true_mileage_status:"unknown",
   odometer_broken:a.odometer_broken,odometer_rolled_over:a.odometer_rolled_over,
   source_observation_id:p.id,analysis_kind:"retained_listing_property_projection",projection_version:mode,
   normalization_version:"retained_odometer_miles_v1",property_key:"mileage_miles",source_field:"extraction_metadata.raw.attributes.raw.auto_miles",
   claim_role:"listing_claim",observed_at_basis:"source_testimony_recorded_at",source_recorded_at:p.ingested_at,source_observed_at:p.observed_at,
   source_extraction_method:p.extraction_method,source_confidence_score:p.confidence_score,source_event_time_status:"unknown",
   factory_configuration_status:"unknown",current_configuration_status:"unknown",independent_source:false,
   limitation:"Original platform auto_miles attribute only; flat mileage may be a physical-scalar confirmation and is not used. Broken/rolled-over disclosures survive. A seller-typed label is not a photographed display, verified accumulated mileage or a dated reading event."} as Record<string,unknown> & {source_field:string;source_observation_id:string;limitation:string}};
}
