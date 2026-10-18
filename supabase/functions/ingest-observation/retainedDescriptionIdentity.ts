import { descriptionYearWitness } from "./retainedDescriptionYear.ts";
import { retainedListingIdentityValue } from "./retainedListingIdentity.ts";
import { retainedDescriptionCaptureQualified } from "./retainedDescriptionPowertrain.ts";

export const DESCRIPTION_IDENTITY_VERSION = "retained_description_identity_labels_v1";
const MAKES = ["International Harvester", "Mercedes-Maybach", "Harley-Davidson", "Willys-Overland", "Austin-Healey", "Mercedes-Benz", "Aston Martin", "Mercedes-AMG", "Autobianchi", "Continental", "Lamborghini", "Rolls-Royce", "AM General", "Alfa Romeo", "John Deere", "Land Rover", "Mitsubishi", "Moto Guzzi", "Oldsmobile", "Steyr-Puch", "Studebaker", "Volkswagen", "Airstream", "Chevrolet", "Husqvarna", "Innocenti", "Winnebago", "Workhorse", "Cadillac", "Caterham", "Chrysler", "DeLorean", "DeTomaso", "Infiniti", "Kawasaki", "Maserati", "Plymouth", "Aprilia", "Bentley", "Bertone", "Bultaco", "Daimler", "Ferrari", "Hyundai", "Lincoln", "McLaren", "Mercury", "Packard", "Peugeot", "Polaris", "Pontiac", "Porsche", "Renault", "Sunbeam", "Triumph", "Victory", "Vincent", "Austin", "Bimota", "Datsun", "DeSoto", "Ducati", "Hummer", "Indian", "Jaguar", "Jensen", "Kaiser", "Lancia", "Nissan", "Saturn", "Shelby", "Subaru", "Suzuki", "Toyota", "Willys", "Yamaha", "Acura", "Ariel", "Authi", "Buick", "Dodge", "Edsel", "Honda", "Isuzu", "Lexus", "Lotus", "Mazda", "Panoz", "Qvale", "Rover", "Smart", "Vespa", "Volvo", "Audi", "Fiat", "Ford", "Jeep", "Lada", "Mini", "Puch", "Saab", "AJS", "AMC", "BMW", "GMC", "KTM", "LTI", "Ram", "SRT", "TVR", "MG"];

/** Exact publisher label tokens, not alias/taxonomy or physical identity resolution.
 * The model remainder intentionally retains trim/body words and is labeled as such. */
export function descriptionIdentityWitness(key:string, text:unknown) {
  if(!["make","model"].includes(key))return null;
  const intro=descriptionYearWitness(text);
  if(!intro)return null;
  const maker=MAKES.find(m=>intro.source_subject_label===m||intro.source_subject_label.startsWith(`${m} `));
  if(!maker)return null;
  const value=key==="make"?maker:intro.source_subject_label.slice(maker.length+1);
  if(retainedListingIdentityValue(key,value)===null)return null;
  return {...intro,value,source_make_label:maker};
}
export function retainedDescriptionIdentityWitness(source:Record<string,any>,key:string){
  return retainedDescriptionCaptureQualified(source)?descriptionIdentityWitness(key,source.content_text):null;
}
