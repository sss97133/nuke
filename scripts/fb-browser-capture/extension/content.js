(async () => {
  // Every injected transition is checked again inside this isolated script.
  const dom = globalThis.NukeMarketplaceDOM;
  const initial = (await chrome.storage.local.get('collector')).collector;
  const target = initial?.inFlight?.target, controlToken = initial?.controlToken;
  if (!['search', 'saved'].includes(target)) throw new Error('source_scope_changed');
  if (!initial?.enabled || (target === 'saved' && !initial.savedEnabled)) throw new Error('collector_paused');
  const cards = new Map(), startedAt = new Date().toISOString(), cycleId = crypto.randomUUID();
  let last, scans = 0;
  for (let step = 0; step <= 4; step++) {
    const current = (await chrome.storage.local.get('collector')).collector;
    if (!current?.enabled || current.controlToken !== controlToken || (target === 'saved' && !current.savedEnabled)) throw new Error('collector_paused');
    if (!dom.scoped(location.href, target)) throw new Error('source_scope_changed');
    last = dom.scan(200 - cards.size, new Set(cards.keys()), target); scans++;
    for (const card of last.cards) if (!cards.has(card.facebook_id) && cards.size < 200) cards.set(card.facebook_id, card);
    if (cards.size >= 200 || step === 4) break;
    const withinMain = last.main.scrollHeight > last.main.clientHeight && /auto|scroll/.test(getComputedStyle(last.main).overflowY);
    const scroller = withinMain ? last.main : window;
    scroller.scrollBy({ top: Math.max(500, innerHeight * 0.8), behavior: 'instant' });
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  if (!cards.size) throw new Error('no_rendered_listing_cards');
  const batch = [...cards.values()];
  batch.sort((a,b) => Number(b.parsed_year >= 1960 && b.parsed_year <= 1990) - Number(a.parsed_year >= 1960 && a.parsed_year <= 1990));
  const capture = { target_url: target === 'saved' ? 'https://www.facebook.com/saved/?cref=28' : 'https://www.facebook.com/marketplace/category/vehicles/?minYear=1960&maxYear=1990&sortBy=creation_time_descend', actual_url: last.actual_url,
    observed_at: last.observed_at, retrieval_surface: `chrome_mv3_rendered_${target}_cards`, actual_region: last.actual_region, access_state: 'available', complete: false,
    source_listed_at: null, source_cycle_id: cycleId, capture_started_at: startedAt, capture_finished_at: new Date().toISOString(), displayed_filters: last.displayed_filters, viewport_scans: scans, enumeration_tail: 'unknown', cycle_card_budget: 200 };
  const packets = [];
  for (let offset = 0; offset < batch.length; offset += 50) packets.push({ mode: 'browser_capture', capture: { ...capture, capture_id: crypto.randomUUID(), packet_index: packets.length }, batch: batch.slice(offset, offset + 50) });
  return { packets, cycleId, cards: batch.length, scans };
})();
