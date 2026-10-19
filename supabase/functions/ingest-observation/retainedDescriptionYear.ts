import { retainedDescriptionCaptureQualified } from "./retainedDescriptionPowertrain.ts";

export const DESCRIPTION_YEAR_VERSION="retained_description_year_label_v1";
const bytes=(text:string)=>new TextEncoder().encode(text).length;
const INTRO=/^This ([0-9]{4}) ([A-Za-z][A-Za-z0-9 ./'’′+-]{0,119}?) (?:is|was|has|had|remained|features)\b/;
const COMPONENT=/\b(?:engine|motor|transmission|transaxle|gearbox|chassis|frame|body|panel|parts|replica|scale|memorabilia|artwork|collection)\b/i;

/** Only the publisher's opening subject label. Later chassis, service and
 * acquisition years do not become the listing's model-year label. */
export function descriptionYearWitness(text:unknown):{value:number;source_value:string;source_year_token:string;source_subject_label:string}|null {
  if(typeof text!=="string"||bytes(text)<100||bytes(text)>32000)return null;
  const sentence=text.split(/(?<=[.!?])[ \t\r\n]+|[\r\n]+/)[0].replace(/^[ \t\r\n]+|[ \t\r\n]+$/g,"");
  const match=sentence.match(INTRO);
  if(!match||bytes(sentence)>500||COMPONENT.test(match[2])||/^model\b/i.test(match[2]))return null;
  const value=Number(match[1]);
  if(value<1800||value>2100)return null;
  return {value,source_value:sentence,source_year_token:match[1],source_subject_label:match[2]};
}
export function retainedDescriptionYearWitness(source:Record<string,any>){
  return retainedDescriptionCaptureQualified(source)?descriptionYearWitness(source.content_text):null;
}
