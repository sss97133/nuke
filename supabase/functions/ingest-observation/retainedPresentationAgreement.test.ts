import { descriptionPresentationWitness } from "./retainedDescriptionPresentation.ts";
// PostgreSQL and JavaScript must stop at the same first upholstery material.
const cases: [string,string,string|null][] = [
 ["interior_color","It is finished in Pure White over black leather with gray cloth inserts, and now shows 147k kilometers (~91k miles).","black"],
 ["exterior_color","It is finished in Pure White over black leather with gray cloth inserts, and now shows 147k kilometers (~91k miles).","Pure White"],
 ["interior_color","The cabin is upholstered in Navy Blue vinyl with gray cloth inserts.","Navy Blue"],
 ["interior_color","The seats are trimmed in black cloth with tan leather bolsters.","black"],
 ["interior_color","Finished in red over tan vinyl with black leather inserts.","tan"],
 ["interior_color","Finished in red over black leather. The seats are trimmed in tan cloth.",null],
 ["interior_color","The cabin is upholstered in black leather or gray cloth.",null],
 ["interior_color","The cabin is formerly upholstered in black leather with gray cloth inserts.",null],
];
for(const [key,text,expected]of cases)Deno.test(`presentation agreement ${key} ${text}`,()=>{
 const w=descriptionPresentationWitness(key,"This vehicle is offered with service records, factory literature, and a clean title. "+text);
 if((w?.value??null)!==expected)throw Error("material boundary disagreement");
});
