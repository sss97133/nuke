export const RETAINED_PRESENTATION_VERSION = "retained_description_presentation_v1";
const bytes=(text:string)=>new TextEncoder().encode(text).length;
const QUALIFIED=/\b(?:unknown|unspecified|not|no|without|or|would|could|might|may|should|planned|proposed|intend|originally|previously|formerly|removed|spare|uninstalled|other|another)\b|["“”]/i;
// Deliberately narrow sentence forms; free-text labels remain exact source text.
const FINISH=/^(?:Finished|The (?:car|truck|vehicle|motorcycle|bike) is (?:finished|refinished)|It is (?:finished|refinished)) in ([A-Za-z][A-Za-z0-9 /()'-]{0,79}?) over ([A-Za-z][A-Za-z0-9 /()'-]{0,79}?) (leather|vinyl|cloth)(?=[ ,.;]|$)/i;
const INTERIOR=/^The (?:cabin|interior|seats) (?:is|are) (?:trimmed|upholstered|finished) in ([A-Za-z][A-Za-z0-9 /()'-]{0,79}?) (leather|vinyl|cloth)(?=[ ,.;]|$)/i;
const ROUTE=/^(?:Power is (?:sent|delivered|routed)|The \d+(?:\.\d+)?(?:-lit(?:er|re)|ci) (?:V\d{1,2}|inline[- ](?:four|six|\d)|flat[- ](?:four|six|\d)) (?:routes|sends|delivers) power) to (?:the )?/i;
const DRIVE=/^(rear or all four|rear|front) wheels?\b/i;
export function descriptionPresentationWitness(key:string,text:unknown):{source_value:string;value:string}|null {
 if(!["interior_color","exterior_color","drivetrain_layout"].includes(key)||typeof text!=="string"||bytes(text)<100||bytes(text)>32000)return null;
 let witness:{source_value:string;value:string}|null=null;
 for(const raw of text.split(/(?<=[.!?])[ \t\r\n]+|[\r\n]+/)){
  const sentence=raw.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g,"");
  const finish=sentence.match(FINISH),interior=sentence.match(INTERIOR),route=sentence.match(ROUTE);
  const drive=route?sentence.slice(route[0].length).match(DRIVE):null;
  if(key==="drivetrain_layout" && (/^Power is (?:sent|delivered|routed)\b/i.test(sentence)||route) && !drive)return null;
  const selectable=drive?.[1].toLowerCase()==="rear or all four";
  let value:string|null=key==="drivetrain_layout"?(drive?selectable?"4WD":drive[1].toLowerCase()==="rear"?"RWD":"FWD":null):
   key==="exterior_color"?(finish?finish[1]:null):(finish?finish[2]:interior?interior[1]:null);
  if(value===null)continue;
  // Rear OR all four plus an explicitly described selectable transfer case is
  // a publisher's part-time 4WD claim. All-four alone still cannot distinguish
  // AWD from 4WD. Remove only this exact route's "or" before qualification.
  const qualifiedText=key==="drivetrain_layout"&&selectable?sentence.replace(/\brear or all four wheels?\b/i,"selectable wheels"):sentence;
  if(bytes(sentence)>500||QUALIFIED.test(qualifiedText)||value!==value.trim()||/\band\b/i.test(value))return null;
  if(key==="drivetrain_layout"&&selectable&&
   (!/\b(?:dual[- ]range|two[- ]speed|2[- ]speed|part[- ]time) transfer case\b/i.test(sentence)||
    /\b(?:if|when|only|all[- ]wheel|AWD|front[- ]wheel)\b/i.test(sentence)))return null;
  if(key==="drivetrain_layout" && !selectable && (/\b(?:if|when|only|transfer case|all four|all[- ]wheel|four[- ]wheel|AWD|4WD)\b/i.test(sentence) ||
    (value==="RWD"?/\bfront\b/i:/\brear\b/i).test(sentence)))return null;
  if(witness&&witness.value!==value)return null;
  witness??={source_value:sentence,value};
 }
 return witness;
}
