import { assertEquals } from "jsr:@std/assert@1";
import {
  applyBarrettJacksonVehicleFacets,
  extractBarrettJacksonVehicleFacets,
  parseBarrettJacksonHeadline,
} from "./vehicleFacets.ts";
import { normalizeVehicleFields } from "../_shared/normalizeVehicle.ts";

Deno.test("C10 / K10 Squarebody & Action Line headlines populate series_code, trim_package, and body_style_facet", () => {
  const k10CustomDeluxe = extractBarrettJacksonVehicleFacets({
    title: "1973 CHEVROLET K10 CUSTOM DELUXE PICKUP",
    model: "Pickup",
    style: "2 Door Pickup",
  });
  assertEquals(k10CustomDeluxe, {
    year: 1973,
    make: "Chevrolet",
    model: "K10",
    series_code: "K10",
    trim_package: "Custom Deluxe",
    body_style_facet: "Pickup",
  });

  const c10SilveradoStepside = extractBarrettJacksonVehicleFacets({
    title: "1978 CHEVROLET C10 SILVERADO STEPSIDE PICKUP",
    model: "C10 Silverado Stepside Pickup",
  });
  assertEquals(c10SilveradoStepside, {
    year: 1978,
    make: "Chevrolet",
    model: "C10",
    series_code: "C10",
    trim_package: "Silverado",
    body_style_facet: "Stepside",
  });

  const c10CheyenneSuper = extractBarrettJacksonVehicleFacets({
    title: "1974 CHEVROLET C10 CHEYENNE SUPER SHORT BED PICKUP",
    description: "Frame-off restored 1974 Chevrolet C10 Cheyenne Super 10 short box.",
  });
  assertEquals(c10CheyenneSuper, {
    year: 1974,
    make: "Chevrolet",
    model: "C10",
    series_code: "C10",
    trim_package: "Cheyenne Super",
    body_style_facet: "Short Bed",
  });

  const c10ScottsdaleFleetside = extractBarrettJacksonVehicleFacets({
    title: "1979 CHEVROLET C10 SCOTTSDALE FLEETSIDE PICKUP",
  });
  assertEquals(c10ScottsdaleFleetside, {
    year: 1979,
    make: "Chevrolet",
    model: "C10",
    series_code: "C10",
    trim_package: "Scottsdale",
    body_style_facet: "Fleetside",
  });

  const c10Cst = extractBarrettJacksonVehicleFacets({
    title: "1971 CHEVROLET C10 CST PICKUP",
    description: "Factory Custom Sport Truck package with Fleetside bed.",
  });
  assertEquals(c10Cst, {
    year: 1971,
    make: "Chevrolet",
    model: "C10",
    series_code: "C10",
    trim_package: "CST",
    body_style_facet: "Fleetside",
  });

  const gmcSierraClassic = extractBarrettJacksonVehicleFacets({
    title: "1977 GMC K15 SIERRA CLASSIC STEPSIDE PICKUP",
  });
  assertEquals(gmcSierraClassic, {
    year: 1977,
    make: "GMC",
    model: "K1500",
    series_code: "K1500",
    trim_package: "Sierra Classic",
    body_style_facet: "Stepside",
  });
});

Deno.test("Chevelle SS 396 and SS 454 (including LS6) headlines and descriptions extract canonical facets", () => {
  const ss396 = extractBarrettJacksonVehicleFacets({
    title: "1969 CHEVROLET CHEVELLE SS 396 SPORT COUPE",
    model: "Chevelle Ss 396 Sport Coupe",
  });
  assertEquals(ss396, {
    year: 1969,
    make: "Chevrolet",
    model: "Chevelle",
    series_code: "SS 396",
    trim_package: "SS 396",
    body_style_facet: "2-Door Hardtop",
  });

  const ss454Ls6 = extractBarrettJacksonVehicleFacets({
    title: "1970 CHEVROLET CHEVELLE SS 454",
    style: "Convertible",
    description: "Documented with build sheet, factory LS6 454/450hp V8 and M22 4-speed.",
  });
  assertEquals(ss454Ls6, {
    year: 1970,
    make: "Chevrolet",
    model: "Chevelle",
    series_code: "SS 454",
    trim_package: "SS 454 LS6",
    body_style_facet: "Convertible",
  });

  const ss454Standard = extractBarrettJacksonVehicleFacets({
    title: "1970 CHEVROLET CHEVELLE SS 454 COUPE",
  });
  assertEquals(ss454Standard, {
    year: 1970,
    make: "Chevrolet",
    model: "Chevelle",
    series_code: "SS 454",
    trim_package: "SS 454",
    body_style_facet: "Coupe",
  });
});

Deno.test("Ford Bronco Ranger, Sport, U13 Roadster, and U14 Half-Cab extract canonical facets", () => {
  const broncoRanger = extractBarrettJacksonVehicleFacets({
    title: "1976 FORD BRONCO RANGER",
    model: "Bronco Ranger",
    style: "SUV",
  });
  assertEquals(broncoRanger, {
    year: 1976,
    make: "Ford",
    model: "Bronco",
    series_code: "U15 Wagon",
    trim_package: "Ranger",
    body_style_facet: "Wagon",
  });

  const broncoSportHalfCab = extractBarrettJacksonVehicleFacets({
    title: "1971 FORD BRONCO SPORT U14 HALF-CAB",
  });
  assertEquals(broncoSportHalfCab, {
    year: 1971,
    make: "Ford",
    model: "Bronco",
    series_code: "U14 Half-Cab",
    trim_package: "Sport",
    body_style_facet: "Half-Cab",
  });

  const broncoRoadster = extractBarrettJacksonVehicleFacets({
    title: "1966 FORD BRONCO U13 ROADSTER",
  });
  assertEquals(broncoRoadster, {
    year: 1966,
    make: "Ford",
    model: "Bronco",
    series_code: "U13 Roadster",
    trim_package: null,
    body_style_facet: "Roadster",
  });
});

Deno.test("Corvette Split-Window, C2 Sting Ray 427, C3 Stingray L88, and Fuel Injected extract canonical facets", () => {
  const splitWindow = extractBarrettJacksonVehicleFacets({
    title: "1963 CHEVROLET CORVETTE SPLIT-WINDOW COUPE",
    model: "Corvette Split-Window Coupe",
  });
  assertEquals(splitWindow, {
    year: 1963,
    make: "Chevrolet",
    model: "Corvette",
    series_code: "Sting Ray",
    trim_package: "Split-Window",
    body_style_facet: "Split-Window Coupe",
  });

  const stingRay427 = extractBarrettJacksonVehicleFacets({
    title: "1967 CHEVROLET CORVETTE STING RAY 427/435 CONVERTIBLE",
  });
  assertEquals(stingRay427, {
    year: 1967,
    make: "Chevrolet",
    model: "Corvette",
    series_code: "427",
    trim_package: "427/435",
    body_style_facet: "Convertible",
  });

  const stingrayL88 = extractBarrettJacksonVehicleFacets({
    title: "1969 CHEVROLET CORVETTE STINGRAY L88 T-TOP COUPE",
  });
  assertEquals(stingrayL88, {
    year: 1969,
    make: "Chevrolet",
    model: "Corvette",
    series_code: "L88",
    trim_package: "L88",
    body_style_facet: "T-Top",
  });

  const fuelie57 = extractBarrettJacksonVehicleFacets({
    title: "1957 CHEVROLET CORVETTE FUEL INJECTED ROADSTER",
  });
  assertEquals(fuelie57, {
    year: 1957,
    make: "Chevrolet",
    model: "Corvette",
    series_code: "Fuel Injected",
    trim_package: "Fuel Injected",
    body_style_facet: "Roadster",
  });
});

Deno.test("Mopar Road Runner, Superbird, GTX, and 'Cuda / Barracuda headlines extract canonical facets", () => {
  const roadRunner = extractBarrettJacksonVehicleFacets({
    title: "1969 PLYMOUTH ROAD RUNNER 440 SIX BARREL COUPE",
  });
  assertEquals(roadRunner, {
    year: 1969,
    make: "Plymouth",
    model: "Road Runner",
    series_code: "Road Runner",
    trim_package: "440 Six Barrel",
    body_style_facet: "Coupe",
  });

  const gtxHemi = extractBarrettJacksonVehicleFacets({
    title: "1968 PLYMOUTH GTX 426 HEMI CONVERTIBLE",
  });
  assertEquals(gtxHemi, {
    year: 1968,
    make: "Plymouth",
    model: "GTX",
    series_code: "GTX",
    trim_package: "426 Hemi",
    body_style_facet: "Convertible",
  });

  const hemiCuda = extractBarrettJacksonVehicleFacets({
    title: "1970 PLYMOUTH HEMI 'CUDA HARDTOP",
  });
  assertEquals(hemiCuda, {
    year: 1970,
    make: "Plymouth",
    model: "Barracuda",
    series_code: "Hemi 'Cuda",
    trim_package: "426 Hemi",
    body_style_facet: "Hardtop",
  });

  const aarCuda = extractBarrettJacksonVehicleFacets({
    title: "1970 PLYMOUTH AAR 'CUDA HARDTOP",
  });
  assertEquals(aarCuda, {
    year: 1970,
    make: "Plymouth",
    model: "Barracuda",
    series_code: "AAR 'Cuda",
    trim_package: "AAR",
    body_style_facet: "Hardtop",
  });

  const superbird = extractBarrettJacksonVehicleFacets({
    title: "1970 PLYMOUTH ROAD RUNNER SUPERBIRD 440 SIX BARREL HARDTOP",
  });
  assertEquals(superbird, {
    year: 1970,
    make: "Plymouth",
    model: "Superbird",
    series_code: "Superbird",
    trim_package: "440 Six Barrel",
    body_style_facet: "Hardtop",
  });
});

Deno.test("description enriches missing facets while ignoring restomod donor powertrain/suspension mentions", () => {
  const restomodC10 = {
    url: "https://www.barrett-jackson.com/scottsdale-2024/docket/vehicle/1972-chevrolet-c10-custom-pickup-274511",
    title: "1972 CHEVROLET C10 CUSTOM PICKUP",
    year: 1972,
    make: "Chevrolet",
    model: "Custom",
    style: "Pickup",
    description:
      "This custom 1972 Chevrolet C10 Cheyenne Stepside pickup is powered by a Corvette LS3 engine with a Mustang II front suspension and Ford 9-inch rear end.",
    series_code: null as string | null,
    trim_package: null as string | null,
    body_style_facet: null as string | null,
  };

  applyBarrettJacksonVehicleFacets(restomodC10);

  assertEquals(restomodC10.make, "Chevrolet");
  assertEquals(restomodC10.model, "C10");
  assertEquals(restomodC10.series_code, "C10");
  assertEquals(restomodC10.trim_package, "Cheyenne");
  assertEquals(restomodC10.body_style_facet, "Stepside");
});

Deno.test("multi-word makes in Barrett-Jackson headlines parse without splitting on the first word", () => {
  assertEquals(parseBarrettJacksonHeadline("1965 ASTON MARTIN DB5 COUPE"), {
    year: 1965,
    make: "Aston Martin",
    modelRest: "DB5 COUPE",
  });
  assertEquals(parseBarrettJacksonHeadline("1956 MERCEDES-BENZ 300SL GULLWING COUPE"), {
    year: 1956,
    make: "Mercedes-Benz",
    modelRest: "300SL GULLWING COUPE",
  });
  assertEquals(parseBarrettJacksonHeadline("1967 AUSTIN-HEALEY 3000 MK III BJ8 ROADSTER"), {
    year: 1967,
    make: "Austin-Healey",
    modelRest: "3000 MK III BJ8 ROADSTER",
  });
});

Deno.test("normalizeVehicleFields preserves collector body_style_facet, series_code, and trim_package", () => {
  const facets = extractBarrettJacksonVehicleFacets({
    title: "1963 CHEVROLET CORVETTE SPLIT-WINDOW COUPE",
  });
  const normalizedSplitWindow = normalizeVehicleFields({
    year: facets.year,
    make: facets.make,
    model: facets.model,
    series: facets.series_code,
    trim: facets.trim_package,
    body_style: facets.body_style_facet,
  });
  assertEquals(normalizedSplitWindow.model, "Corvette");
  assertEquals(normalizedSplitWindow.series, "Sting Ray");
  assertEquals(normalizedSplitWindow.trim, "Split-Window");
  assertEquals(normalizedSplitWindow.body_style, "Split-Window Coupe");

  const c10Facets = extractBarrettJacksonVehicleFacets({
    title: "1978 CHEVROLET C10 SILVERADO STEPSIDE PICKUP",
  });
  const normalizedC10 = normalizeVehicleFields({
    year: c10Facets.year,
    make: c10Facets.make,
    model: c10Facets.model,
    series: c10Facets.series_code,
    trim: c10Facets.trim_package,
    body_style: c10Facets.body_style_facet,
  });
  assertEquals(normalizedC10.model, "C10");
  assertEquals(normalizedC10.series, "C10");
  assertEquals(normalizedC10.trim, "Silverado");
  assertEquals(normalizedC10.body_style, "Stepside");
});

