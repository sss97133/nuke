import { retainedCraigslistCaptureQualified } from "./retainedCraigslistCapture.ts";
export function craigslistYearValue(raw:unknown):number|null {
 if(typeof raw!=="string"||! /^[0-9]{4}$/.test(raw))return null;
 const n=Number(raw);return n>=1800&&n<=2100?n:null;
}
export function deriveRetainedCraigslistYear(p:Record<string,any>,v:Record<string,any>|null,s:Record<string,any>|null) {
 const r=p?.extraction_metadata?.raw,raw=r?.attributes?.raw?.year,value=craigslistYearValue(raw);
 if(!retainedCraigslistCaptureQualified(p,v,s)||value===null)return null;
 const mode="retained_listing_year_v1";
 return {source_slug:"craigslist",kind:"listing",vehicle_id:p.vehicle_id,property_key:"year",source_url:p.source_url,
  source_identifier:`${mode}:${p.id}`,observed_at:p.ingested_at,extraction_method:"retained_listing_property_projection_v1",
  raw_source_ref:`vehicle_observations:${p.id}`,content_text:"Retained Craigslist year label; identity and model year are unverified. Source event time remains unknown.",
  confidence_score:Math.min(.4,p.confidence_score),agent_cost_cents:0,agent_model:null,
  structured_data:{year:value,source_value:raw,source_profile:"craigslist_year_attribute_v1",source_native_post_id:r.post_id,
   year_label_basis:"platform_year_attribute_or_title_row",normalization_version:"retained_listing_year_attribute_v1",
   source_field:"extraction_metadata.raw.attributes.raw.year",source_observation_id:p.id,property_key:"year",
   analysis_kind:"retained_listing_property_projection",projection_version:mode,claim_role:"listing_claim",
   identity_role:"extractor_vehicle_label",identity_resolution_status:"unverified",
   source_recorded_at:p.ingested_at,source_observed_at:p.observed_at,observed_at_basis:"source_testimony_recorded_at",
   source_extraction_method:p.extraction_method,source_confidence_score:p.confidence_score,
   source_event_time_status:"unknown",factory_configuration_status:"unknown",current_configuration_status:"unknown",independent_source:false,
   limitation:"Exact four-digit retained year row, converted losslessly to an integer. No physical vehicle year, VIN decoder, generation or combined make/model inference is used; original row and post identifier survive. A listing label does not resolve identity or establish an event date."} as Record<string,unknown>&{source_field:string;source_observation_id:string;limitation:string}};
}
