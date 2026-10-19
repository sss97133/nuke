// Targeting gate for rendered cards: cars and trucks, model years 1964-1991. Pure function of the card's own
// displayed text; every rejection carries its reasons so nothing is dropped silently.
(() => {
  const YEAR_MIN = 1964, YEAR_MAX = 1991, TIER1_MAX = 1973, PLACEHOLDER_PRICE = 200;
  const NOT_CAR_OR_TRUCK = [
    ['boat', /\b(boat|yacht|pontoon|jet ?ski|sea ?doo|skiff|outboard|kayak|canoe|dinghy|sailboat|runabout|cabin cruiser|dolphin|mastercraft|bayliner|sea ray|boston whaler)\b/i],
    ['motorcycle', /\b(motorcycle|harley|davidson|yamaha|suzuki|kawasaki|ducati|vespa|scooter|moped|dirt ?bike|honda (cb|cl|xl|xr|cr|gl|cx)\d*|chopper|sportster|trike|triumph (bonneville|tiger|trident))\b/i],
    ['rv_camper_trailer', /\b(trailer|camper(?! (special|shell))|motorhome|motor home|rv|travel trailer|fifth wheel|5th wheel|toy hauler|airstream|a-?liner|teardrop)\b/i],
    ['offroad_utility', /\b(atv|utv|side by side|snowmobile|golf cart|go ?kart|tractor|bobcat|skid steer|forklift|john deere|kubota|backhoe|excavator|lawn ?mower)\b/i],
    ['parts', /\b(parts only|for parts|parts car|part out|engine only|motor only|transmission only)\b/i],
  ];
  function classify(card) {
    const reasons = [], title = card.title ?? '';
    const haystack = title;
    const year = card.parsed_year ?? null;
    if (year === null) reasons.push('year_unknown');
    else if (year < YEAR_MIN) reasons.push('year_before_1964');
    else if (year > YEAR_MAX) reasons.push('year_after_1991');
    for (const [reason, pattern] of NOT_CAR_OR_TRUCK) if (pattern.test(haystack)) reasons.push(reason);
    if (typeof card.price === 'number' && card.price < PLACEHOLDER_PRICE) reasons.push('price_placeholder');
    const tier = year === null ? null : year <= TIER1_MAX && year >= YEAR_MIN ? 1 : year <= YEAR_MAX && year > TIER1_MAX ? 2 : null;
    return { accept: reasons.length === 0, tier, reasons };
  }
  globalThis.NukeClassify = { classify, YEAR_MIN, YEAR_MAX, TIER1_MAX };
})();
