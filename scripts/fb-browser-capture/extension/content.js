(async () => {
  // Every injected transition is checked again inside this isolated script.
  const dom = globalThis.NukeMarketplaceDOM;
  const cards = new Map(), startedAt = new Date().toISOString(), cycleId = crypto.randomUUID();
  let last, scans = 0;
  for (let step = 0; step <= 4; step++) {
    if (!(await chrome.storage.local.get("collector")).collector?.enabled) throw new Error("collector_paused");
    if (!dom.scoped(location.href)) throw new Error('source_scope_changed');
    last = dom.scan(200 - cards.size, new Set(cards.keys())); scans++;
    for (const card of last.cards) if (!cards.has(card.facebook_id) && cards.size < 200) cards.set(card.facebook_id, card);
    if (cards.size >= 200 || step === 4) break;
    const withinMain = last.main.scrollHeight > last.main.clientHeight && /auto|scroll/.test(getComputedStyle(last.main).overflowY);
    const scroller = withinMain ? last.main : window;
    scroller.scrollBy({ top: Math.max(500, innerHeight * 0.8), behavior: 'instant' });
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  if (!cards.size) throw new Error('no_rendered_listing_cards');
  const classify = globalThis.NukeClassify.classify, kept = [], rejected = [], tiers = {}, reasonCounts = {};
  for (const card of cards.values()) {
    const verdict = classify(card);
    if (verdict.accept) { kept.push(card); tiers[card.facebook_id] = verdict.tier; continue; }
    for (const reason of verdict.reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    rejected.push({ facebook_id: card.facebook_id, title: card.title, price: card.price ?? null, location: card.location ?? null, reasons: verdict.reasons });
  }
  const batch = kept.sort((a,b) => tiers[a.facebook_id] - tiers[b.facebook_id]);
  const screening = { rule: 'cars_trucks_1964_1991_v1', seen: cards.size, accepted: batch.length, rejected_count: rejected.length, rejected_reasons: reasonCounts, tiers };
  const capture = { target_url: 'https://www.facebook.com/marketplace/category/vehicles/?minYear=1964&maxYear=1991&sortBy=creation_time_descend&topLevelVehicleType=car_truck&exact=false', actual_url: last.actual_url,
    observed_at: last.observed_at, retrieval_surface: 'chrome_mv3_rendered_search_cards', actual_region: last.actual_region, access_state: 'available', complete: false,
    source_listed_at: null, source_cycle_id: cycleId, capture_started_at: startedAt, capture_finished_at: new Date().toISOString(), displayed_filters: last.displayed_filters, viewport_scans: scans, enumeration_tail: 'unknown', cycle_card_budget: 200, screening };
  const packets = [];
  for (let offset = 0; offset < batch.length; offset += 50) packets.push({ mode: 'browser_capture', capture: { ...capture, capture_id: crypto.randomUUID(), packet_index: packets.length, ...(packets.length === 0 ? { rejected: rejected.slice(0, 150) } : {}) }, batch: batch.slice(offset, offset + 50) });
  return { packets, cycleId, cards: batch.length, scans, screening, rejected };
})();
