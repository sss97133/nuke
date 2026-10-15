export const TARGET = 'https://www.facebook.com/marketplace/category/vehicles/?minYear=1960&maxYear=1990&sortBy=creation_time_descend';
export const SAVED_TARGET = 'https://www.facebook.com/saved/?cref=28';
export const HOST = 'com.nuke.marketplace_capture';
export const LIMITS = Object.freeze({ cadenceMinutes: 15, minCadenceMinutes: 5, maxCards: 50, maxCycleCards: 200, scrollSteps: 4, maxQueue: 8, maxBytes: 200000, maxPassesDay: 96 });
export function searchUrl(value) {
  return sourceTarget(value) === 'search';
}
export function sourceTarget(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || !['www.facebook.com', 'facebook.com'].includes(u.hostname) || u.username || u.password || u.port) return null;
    return u.pathname === '/marketplace/category/vehicles/' ? 'search' : u.pathname === '/saved/' ? 'saved' : null;
  } catch { return null; }
}
export function initialState() {
  return { version: 2, controlToken: null, enabled: false, savedEnabled: false, nextTarget: 'search', targetState: { search: {}, saved: {} }, tabId: null, tabTarget: null, queue: [], lastLanding: null, landingRetryAt: null, lastError: null, nextDue: null, inFlight: null, seen: {}, visits: [], lastCycle: null, cadenceMinutes: LIMITS.cadenceMinutes };
}
export function restoreState(stored) {
  const state = { ...initialState(), ...stored, version: 2 };
  state.savedEnabled = stored?.savedEnabled === true;
  state.nextTarget = state.savedEnabled && stored?.nextTarget === 'saved' ? 'saved' : 'search';
  state.targetState = { search: {}, saved: {}, ...stored?.targetState };
  if (state.tabId !== null && !state.tabTarget) state.tabTarget = 'search';
  return state;
}
export function sourceRefusal(state, now = Date.now()) {
  if (!state.enabled) return 'paused';
  if (state.queue.length) return 'landing_pending';
  if (state.inFlight && now - state.inFlight.startedAt < 120000) return 'source_attempt_in_progress';
  if (state.nextDue && now < state.nextDue) return 'not_due';
  if (state.visits.filter(at => now - at < 86400000).length >= LIMITS.maxPassesDay) return 'daily_source_budget';
  return null;
}
export function validatePacket(packet) {
  const target = sourceTarget(packet?.capture?.target_url);
  if (!packet || Object.keys(packet).sort().join(',') !== 'batch,capture,mode' || packet.mode !== 'browser_capture' || !target || sourceTarget(packet.capture?.actual_url) !== target || packet.capture.retrieval_surface !== `chrome_mv3_rendered_${target}_cards` || packet.capture.complete !== false || packet.capture.access_state !== 'available' || !packet.capture.actual_region) throw new Error('invalid_collector_scope');
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(packet.capture.capture_id ?? '') || !Number.isFinite(Date.parse(packet.capture.observed_at)) || Date.parse(packet.capture.observed_at) > Date.now() + 300000) throw new Error('invalid_capture_identity');
  if (!Array.isArray(packet.batch) || !packet.batch.length || packet.batch.length > LIMITS.maxCards || new TextEncoder().encode(JSON.stringify(packet)).length > LIMITS.maxBytes) throw new Error('capture_budget');
  const cardKeys = new Set(['facebook_id','url','title','content_text','status','agent_context','price','location','parsed_year']);
  const ids = new Set();
  for (const card of packet.batch) {
    if (Object.keys(card).some(key => !cardKeys.has(key)) || !(target === 'saved' ? card.status === 'unknown' && card.agent_context?.source_status_label === null && card.agent_context?.status_basis === 'saved_card_presence_not_availability' : ['active','sold','pending'].includes(card.status)) || (card.price !== undefined && (!Number.isSafeInteger(card.price) || card.price < 0)) || !/^\d+$/.test(card.facebook_id ?? '') || ids.has(card.facebook_id) || card.url !== `https://www.facebook.com/marketplace/item/${card.facebook_id}/` || typeof card.content_text !== 'string' || !card.content_text || card.content_text.length > 8000) throw new Error('invalid_card');
    ids.add(card.facebook_id);
  }
  return packet;
}
export function enqueue(state, packet) {
  validatePacket(packet);
  const bytes = JSON.stringify(packet);
  const existing = state.queue.find(item => item.id === packet.capture.capture_id);
  if (existing) { if (existing.bytes !== bytes) throw new Error('changed_capture_replay'); return state; }
  if (state.queue.length >= LIMITS.maxQueue) throw new Error('queue_full');
  state.queue.push({ id: packet.capture.capture_id, bytes, attempts: 0, stagedAt: Date.now() });
  return state;
}
export function acknowledge(state, id, receipt) {
  const item = state.queue.find(q => q.id === id);
  const packet = item ? JSON.parse(item.bytes) : null, n = packet?.batch.length ?? 0;
  const target = sourceTarget(packet?.capture.target_url);
  if (!item || !receipt?.success || receipt.capture_id !== id || receipt.counts?.errors !== 0 || receipt.counts?.raw_landed !== n || receipt.counts?.listings_landed !== n || receipt.counts?.sightings_landed !== n) throw new Error('canonical_ack_unavailable');
  if (target === 'saved' && (receipt.counts.private_source !== n || receipt.counts.linked_observations !== 0)) throw new Error('private_capture_ack_unavailable');
  state.queue = state.queue.filter(q => q.id !== id);
  state.lastLanding = { at: new Date().toISOString(), target, captureId: id, observedAt: receipt.observed_at, counts: receipt.counts };
  state.targetState[target] = { ...state.targetState[target], lastLanding: state.lastLanding };
  state.lastError = null; state.landingRetryAt = null;
  return state;
}
