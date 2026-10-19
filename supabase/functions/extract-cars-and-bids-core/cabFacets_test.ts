import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { cleanCabText, extractCabFacets } from "./cabFacets.ts";

Deno.test("cleanCabText strips trailing Watch UI artifact and normalizes whitespace", () => {
  assertEquals(cleanCabText("2001 Lexus LX 470Watch"), "2001 Lexus LX 470");
  assertEquals(cleanCabText("2015 Porsche Macan SWatch"), "2015 Porsche Macan S");
  assertEquals(cleanCabText("  1998  BMW  M3  Convertible "), "1998 BMW M3 Convertible");
});

Deno.test("extractCabFacets classifies Porsche 911, Boxster, Cayman, and Cayenne series/trim/body_style", () => {
  const gt3 = extractCabFacets({
    year: 2004,
    make: "Porsche",
    model: "996 911",
    title: "2004 Porsche 911 GT3 Coupe",
    existingBodyStyle: "Coupe",
  });
  assertEquals(gt3.series, "GT3");
  assertEquals(gt3.trim, "GT3");
  assertEquals(gt3.body_style, "Coupe");

  const c4s = extractCabFacets({
    year: 2002,
    make: "Porsche",
    model: "996 911",
    title: "2002 Porsche 911 Carrera 4S Coupe 6-Speed",
    existingBodyStyle: "Coupe",
  });
  assertEquals(c4s.series, "Carrera 4S");
  assertEquals(c4s.trim, "Carrera 4S");
  assertEquals(c4s.body_style, "Coupe");

  const targa = extractCabFacets({
    year: 1997,
    make: "Porsche",
    model: "993 911",
    title: "1997 Porsche 911 Targa",
    existingBodyStyle: "Coupe",
  });
  assertEquals(targa.series, "911 Targa");
  assertEquals(targa.body_style, "Targa");

  const spyder = extractCabFacets({
    year: 2016,
    make: "Porsche",
    model: "981 Boxster",
    title: "2016 Porsche Boxster Spyder",
    existingBodyStyle: "Convertible",
  });
  assertEquals(spyder.series, "Boxster Spyder");
  assertEquals(spyder.trim, "Spyder");
  assertEquals(spyder.body_style, "Roadster");
});

Deno.test("extractCabFacets classifies BMW M3, M5, M2, and 3-Series generations and Competition/ZHP trims", () => {
  const e39m5 = extractCabFacets({
    year: 2002,
    make: "BMW",
    model: "M5",
    title: "2002 BMW M5",
    existingBodyStyle: "Sedan",
  });
  assertEquals(e39m5.series, "E39 M5");
  assertEquals(e39m5.trim, "M-Power");
  assertEquals(e39m5.body_style, "Sedan");

  const e92m3zcp = extractCabFacets({
    year: 2013,
    make: "BMW",
    model: "E9X M3",
    title: "2013 BMW M3 Coupe Competition Package",
    existingBodyStyle: "Coupe",
  });
  assertEquals(e92m3zcp.series, "E90/E92/E93 M3");
  assertEquals(e92m3zcp.trim, "Competition");
  assertEquals(e92m3zcp.body_style, "Coupe");

  const f8x = extractCabFacets({
    year: 2015,
    make: "BMW",
    model: "2 Series",
    title: "2015 BMW 228i xDrive Coupe",
    existingBodyStyle: "Coupe",
  });
  assertEquals(f8x.normalizedModel, "228i xDrive");
  assertEquals(f8x.trim, "xDrive");
});

Deno.test("extractCabFacets classifies Toyota Land Cruiser J-series without being confused by Chevrolet V8 swap in subtitle", () => {
  const fj40 = extractCabFacets({
    year: 1969,
    make: "Toyota",
    model: "Land Cruiser",
    title: "1969 Toyota Land Cruiser FJ40",
    subTitle: "350ci Chevrolet V8, Power Brakes and Steering, 4WD",
    existingBodyStyle: "SUV/Crossover",
  });
  assertEquals(fj40.series, "FJ40 / BJ40 (J40)");
  assertEquals(fj40.body_style, "SUV");

  const fj62 = extractCabFacets({
    year: 1989,
    make: "Toyota",
    model: "Land Cruiser",
    title: "1989 Toyota Land Cruiser FJ62",
    existingBodyStyle: "SUV/Crossover",
  });
  assertEquals(fj62.series, "FJ60 / FJ62 (J60 Wagon)");
  assertEquals(fj62.body_style, "SUV");

  const j80 = extractCabFacets({
    year: 1996,
    make: "Toyota",
    model: "Land Cruiser",
    title: "1996 Toyota Land Cruiser FZJ80",
    existingBodyStyle: "SUV/Crossover",
  });
  assertEquals(j80.series, "FZJ80 / FJ80 (J80)");
  assertEquals(j80.body_style, "SUV");
});

Deno.test("extractCabFacets classifies Corvette, C10/Silverado/K5 Blazer, Ford Bronco, and Mustang", () => {
  const c6z06 = extractCabFacets({
    year: 2007,
    make: "Chevrolet",
    model: "C6 Corvette",
    title: "2007 Chevrolet Corvette Z06",
    existingBodyStyle: "Coupe",
  });
  assertEquals(c6z06.series, "Z06");
  assertEquals(c6z06.trim, "Z06");
  assertEquals(c6z06.body_style, "Coupe");

  const c10 = extractCabFacets({
    year: 1985,
    make: "Chevrolet",
    model: "C/K",
    title: "1985 Chevrolet C10 Silverado Fleetside",
    existingBodyStyle: "Truck",
  });
  assertEquals(c10.series, "C10 (1/2-Ton 2WD)");
  assertEquals(c10.trim, "Silverado");
  assertEquals(c10.body_style, "Fleetside Pickup");

  const bronco = extractCabFacets({
    year: 2022,
    make: "Ford",
    model: "Bronco",
    title: "2022 Ford Bronco Wildtrak",
    existingBodyStyle: "SUV/Crossover",
  });
  assertEquals(bronco.series, "Wildtrak");
  assertEquals(bronco.trim, "Wildtrak");
  assertEquals(bronco.body_style, "SUV");

  const superDuty = extractCabFacets({
    year: 2022,
    make: "Ford",
    model: "Super Duty",
    title: "2022 Ford F-250 Super Duty Lariat 4x4",
    existingBodyStyle: "Truck",
  });
  assertEquals(superDuty.normalizedModel, "F-250 Super Duty");
  assertEquals(superDuty.series, "F-250 (3/4-Ton)");
  assertEquals(superDuty.trim, "Lariat");
  assertEquals(superDuty.body_style, "Truck");
});
