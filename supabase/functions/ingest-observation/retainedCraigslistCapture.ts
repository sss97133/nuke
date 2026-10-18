import { observationClockMicroseconds } from "../_shared/observationContentHash.ts";
const UUID=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const URL_PATTERN=/^https:\/\/(?:[a-z0-9-]+\.craigslist\.org\/(?:[a-z]+\/)?ct[od]\/d\/[^/?#]+\/[0-9]+\.html|www\.craigslist\.org\/view\/d\/[^/?#]+\/[A-Za-z0-9_-]+)$/;

/** Current original post envelope, independently of which retained attribute is present. */
export function retainedCraigslistCaptureQualified(p:Record<string,any>,v:Record<string,any>|null,s:Record<string,any>|null):boolean {
 const r=p?.extraction_metadata?.raw,a=r?.attributes;
 let url:URL;try{url=new URL(p?.source_url);}catch{return false;}
 const nativePost=url.pathname.match(/\/([0-9]+)\.html$/)?.[1];
 return UUID.test(p?.id??"")&&UUID.test(p?.vehicle_id??"")&&p.kind==="listing"&&p.extraction_method==="html_parse"&&p.is_superseded===false&&
  p.property_id==null&&p.subject_type==="vehicle"&&p.subject_id==null&&!!v&&v.id===p.vehicle_id&&v.is_public===true&&v.deleted_at==null&&v.listing_kind!=="non_vehicle_item"&&
  !!s&&s.id===p.source_id&&s.slug==="craigslist"&&Array.isArray(s.supported_observations)&&s.supported_observations.includes("listing")&&
  typeof p.source_url==="string"&&URL_PATTERN.test(p.source_url)&&!url.search&&!url.hash&&!url.username&&!url.password&&
  typeof r?.post_id==="string"&&/^[0-9]{1,20}$/.test(r.post_id)&&p.source_identifier===r.post_id&&(nativePost===undefined||nativePost===r.post_id)&&
  !!a?.raw&&typeof a.raw==="object"&&!Array.isArray(a.raw)&&
  observationClockMicroseconds(p.ingested_at)!==null&&(p.observed_at===null||observationClockMicroseconds(p.observed_at)!==null)&&
  Number.isFinite(p.confidence_score)&&p.confidence_score>=.4&&p.confidence_score<=1;
}
