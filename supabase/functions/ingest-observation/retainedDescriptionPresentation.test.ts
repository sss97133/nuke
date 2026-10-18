import { descriptionPresentationWitness } from "./retainedDescriptionPresentation.ts";
const assert=(ok:unknown)=>{if(!ok)throw Error("assertion failed");};
const intro="This vehicle is offered with service records, factory literature, and a clean title. ";
// SQL reads this exact shared corpus.
const cases: [string,string,string|null][] = [
 ["exterior_color","Finished in Guards Red over black leather, the car has alloy wheels.","Guards Red"],
 ["interior_color","Finished in Guards Red over black leather, the car has alloy wheels.","black"],
 ["exterior_color","The car is finished in Arctic Silver Metallic (L92U) over gray leather.","Arctic Silver Metallic (L92U)"],
 ["interior_color","The cabin is upholstered in Navy Blue vinyl.","Navy Blue"],
 ["interior_color","The seats are trimmed in black cloth.","black"],
 ["exterior_color","The car is refinished in blue over tan vinyl.","blue"],
 ["exterior_color","The car is originally finished in red over black leather.",null],
 ["exterior_color","The car is finished in red or blue over black leather.",null],
 ["exterior_color","The car is finished in red and black over black leather.",null],
 ["interior_color","The cabin is upholstered in unknown leather.",null],
 ["interior_color","The cabin would be upholstered in black leather.",null],
 ["exterior_color","The car is finished in red over black leather. The car is finished in blue over black leather.",null],
 ["interior_color","The cabin is upholstered in black leather. The seats are trimmed in tan leather.",null],
 ["drivetrain_layout","Power is sent to the rear wheels through a five-speed manual gearbox.","RWD"],
 ["drivetrain_layout","Power is delivered to front wheels via an automatic transmission.","FWD"],
 ["drivetrain_layout","Power is sent to all four wheels through a transfer case.",null],
 ["drivetrain_layout","Power is sent to all four wheels. Power is sent to the rear wheels.",null],
 ["drivetrain_layout","Power is sent to the rear wheels through a dual-range transfer case.",null],
 ["drivetrain_layout","Power is sent to the rear wheels and the front wheels.",null],
 ["drivetrain_layout","Power is sent to the rear wheels only when the front axle is disengaged.",null],
 ["drivetrain_layout","Power would be sent to the rear wheels.",null],
 ["drivetrain_layout","Power is sent to the rear wheels. Power is delivered to front wheels.",null],
 ["drivetrain_layout","The spare drivetrain sends power to the rear wheels.",null],
];
for(const [key,text,expected]of cases)Deno.test(`retained presentation ${key} ${text}`,()=>{
 const w=descriptionPresentationWitness(key,intro+text);assert((w?.value??null)===expected);
 if(w)assert(text.includes(w.source_value));
});
Deno.test("presentation text remains bounded and unknown properties are omitted",()=>{
 assert(!descriptionPresentationWitness("exterior_color","Finished in red over black leather."));
 assert(!descriptionPresentationWitness("exterior_color",intro+"Finished in red over black leather. "+"x".repeat(32000)));
 assert(!descriptionPresentationWitness("exterior_color",intro+"Finished in red over black leather, "+"x".repeat(500)));
 assert(!descriptionPresentationWitness("trim",intro+"Finished in red over black leather."));
});
