export const RETAINED_PRESENTATION_VERSION = "retained_description_presentation_v1";
const bytes=(text:string)=>new TextEncoder().encode(text).length;
const QUALIFIED=/\b(?:unknown|unspecified|not|no|without|or|would|could|might|may|should|planned|proposed|intend|originally|previously|formerly|removed|spare|uninstalled|other|another)\b|["“”]/i;
// Deliberately narrow sentence forms; free-text labels remain exact source text.
const FINISH=/^(?:Finished|The (?:car|truck|vehicle|motorcycle|bike) is (?:finished|refinished)|It is (?:finished|refinished)) in ([A-Za-z][A-Za-z0-9 /()'-]{0,79}?) over ([A-Za-z][A-Za-z0-9 /()'-]{0,79}?) (leather|vinyl|cloth)(?=[ ,.;]|$)/i;
const INTERIOR=/^The (?:cabin|interior|seats) (?:is|are) (?:trimmed|upholstered|finished) in ([A-Za-z][A-Za-z0-9 /()'-]{0,79}?) (leather|vinyl|cloth)(?=[ ,.;]|$)/i;
const DRIVE=/^Power is (?:sent|delivered|routed) to (?:the )?(rear|front) wheels\b/i;
export function descriptionPresentationWitness(key:string,text:unknown):{source_value:string;value:string}|null {
 if(!["interior_color","exterior_color","drivetrain_layout"].includes(key)||typeof text!=="string"||bytes(text)<100||bytes(text)>32000)return null;
 let witness:{source_value:string;value:string}|null=null;
 for(const raw of text.split(/(?<=[.!?])[ \t\r\n]+|[\r\n]+/)){
  const sentence=raw.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g,"");
  const finish=sentence.match(FINISH),interior=sentence.match(INTERIOR),drive=sentence.match(DRIVE);
  if(key==="drivetrain_layout" && /^Power is (?:sent|delivered|routed)\b/i.test(sentence) && !drive)return null;
  let value:string|null=key==="drivetrain_layout"?(drive?drive[1].toLowerCase()==="rear"?"RWD":"FWD":null):
   key==="exterior_color"?(finish?finish[1]:null):(finish?finish[2]:interior?interior[1]:null);
  if(value===null)continue;
  // A route to all four wheels does not distinguish AWD from4WD and is omitted.
  if(bytes(sentence)>500||QUALIFIED.test(sentence)||value!==value.trim()||/\band\b/i.test(value))return null;
  if(key==="drivetrain_layout" && (/\b(?:if|when|only|transfer case|all four|all[- ]wheel|four[- ]wheel|AWD|4WD)\b/i.test(sentence) ||
    (value==="RWD"?/\bfront\b/i:/\brear\b/i).test(sentence)))return null;
  if(witness&&witness.value!==value)return null;
  witness??={source_value:sentence,value};
 }
 return witness;
}
