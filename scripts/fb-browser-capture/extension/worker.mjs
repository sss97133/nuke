import { TARGET, SAVED_TARGET, HOST, LIMITS, initialState, restoreState, sourceTarget, sourceRefusal, enqueue, acknowledge } from './core.mjs';
const ALARM = 'nuke-marketplace-cycle';
let busy = false;
const read = async () => restoreState((await chrome.storage.local.get('collector')).collector);
let storageSerial = Promise.resolve();
function mutate(change) {
  const operation = storageSerial.then(async () => {
    const current = await read(), next = change(current);
    await chrome.storage.local.set({ collector: next });
    await chrome.action.setBadgeText({ text: next.lastError ? '!' : next.enabled ? 'ON' : 'OFF' });
    return next;
  });
  storageSerial = operation.catch(() => {}); return operation;
}
const write = state => mutate(current => {
  // Pause/resume controls cannot be overwritten by an in-flight cycle snapshot.
  if (current.controlToken !== state.controlToken) { state.enabled = current.enabled; state.controlToken = current.controlToken; }
  return state;
});
async function guard(state, target) {
  const current = await read();
  if (!current.enabled || current.controlToken !== state.controlToken || (target === 'saved' && !current.savedEnabled)) throw new Error('collector_paused');
}
async function ensureAlarm() {
  const state = await read();
  if (state.enabled && !(await chrome.alarms.get(ALARM))) await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
}
async function ownedTab(state, target) {
  const url = target === 'saved' ? SAVED_TARGET : TARGET;
  if (state.tabId !== null) {
    let tab;
    try {
      tab = await chrome.tabs.get(state.tabId);
    } catch {
      state.tabId = null; state.tabTarget = null; await write(state);
    }
    if (tab) {
      if (sourceTarget(tab.url) !== state.tabTarget) throw new Error('owned_tab_left_marketplace');
      await guard(state, target);
      if (state.tabTarget !== target) {
        const changed = await chrome.tabs.update(tab.id, { url });
        state.tabTarget = target; await write(state);
        return { tab: changed, navigated: true };
      }
      return { tab, navigated: false };
    }
  }
  // Never query/adopt existing user tabs. On browser restart create a fresh owned tab.
  await guard(state, target);
  const tab = await chrome.tabs.create({ url, active: false });
  state.tabId = tab.id; state.tabTarget = target; await write(state); return { tab, navigated: true };
}
async function waitPage(tabId, target, state) {
  for (let n = 0; n < 30; n++) {
    await guard(state, target);
    const tab = await chrome.tabs.get(tabId);
    if (sourceTarget(tab.pendingUrl ?? tab.url) !== target) throw new Error('owned_tab_left_marketplace');
    if (tab.status === 'complete') return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('source_load_timeout');
}
async function drain(state) {
  if (!state.queue.length) return;
  const item = state.queue[0]; item.attempts++; await write(state);
  try {
    const ack = await chrome.runtime.sendNativeMessage(HOST, { command: 'capture', packet: JSON.parse(item.bytes) });
    acknowledge(state, item.id, ack); await write(state);
  } catch (error) {
    const failure = new Error(String(error?.message ?? 'canonical_landing_unavailable')); failure.stage = 'landing'; throw failure;
  }

}
async function cycle() {
  if (busy) return; busy = true;
  let state;
  try {
    state = await read(); if (!state.enabled || (state.queue.length && state.landingRetryAt > Date.now())) return;
    // Drain immutable captures before any new source visit; unhealthy landing pauses source work.
    await drain(state);
    const refusal = sourceRefusal(state);
    if (refusal) { if (refusal === 'daily_source_budget') { state.lastError = refusal; await write(state); } return; }
    if (state.inFlight) state.lastError = 'prior_source_attempt_interrupted';
    const now = Date.now(), target = state.nextTarget;
    state.lastCycle = { target, startedAt: new Date(now).toISOString(), previousDue: state.nextDue, gapMs: state.nextDue ? Math.max(0, now - state.nextDue) : null, state: 'source_started' };
    state.inFlight = { startedAt: now, target }; state.visits = state.visits.filter(at => now - at < 86400000); state.visits.push(now);
    state.targetState[target] = { ...state.targetState[target], lastAttemptAt: new Date(now).toISOString() };
    state.nextDue = now + state.cadenceMinutes * 60000; await write(state);
    await guard(state, target);
    const owned = await ownedTab(state, target), tab = owned.tab;
    // A due cycle reloads the actual source, so it is a new visit rather than a re-ACK.
    await guard(state, target);
    if (!owned.navigated) {
      if (sourceTarget((await chrome.tabs.get(tab.id)).url) !== target) throw new Error('owned_tab_left_marketplace');
      await chrome.tabs.reload(tab.id);
    }
    await waitPage(tab.id, target, state);
    await new Promise(resolve => setTimeout(resolve, 2500));
    await guard(state, target);
    if (sourceTarget((await chrome.tabs.get(tab.id)).url) !== target) throw new Error('owned_tab_left_marketplace');
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: false }, files: ['dom.js','content.js'], world: 'ISOLATED' });
    const pass = results.at(-1)?.result;
    if (!pass?.packets?.length || pass.packets.length > 4) throw new Error('source_packet_budget');
    for (const packet of pass.packets) {
      if (sourceTarget(packet.capture?.target_url) !== target) throw new Error('source_scope_changed');
      enqueue(state, packet);
    }
    state.inFlight = null;
    state.nextTarget = state.savedEnabled ? (target === 'search' ? 'saved' : 'search') : 'search';
    state.targetState[target] = { ...state.targetState[target], lastCapturedAt: new Date().toISOString(), nextDue: state.nextDue + (state.savedEnabled ? state.cadenceMinutes * 60000 : 0) };
    state.targetState[state.nextTarget] = { ...state.targetState[state.nextTarget], nextDue: state.nextDue };
    for (const card of pass.packets.flatMap(packet => packet.batch)) { const prior = state.seen[card.facebook_id]; state.seen[card.facebook_id] = { first: prior?.first ?? pass.packets[0].capture.observed_at, last: pass.packets[0].capture.observed_at, visits: (prior?.visits ?? 0) + 1 }; }
    const recent = Object.entries(state.seen).sort((a,b) => b[1].last.localeCompare(a[1].last)).slice(0,500); state.seen = Object.fromEntries(recent);
    state.lastCycle = { ...state.lastCycle, state: 'queued', cycleId: pass.cycleId, captureIds: pass.packets.map(packet => packet.capture.capture_id), cards: pass.cards, complete: false, finishedAt: new Date().toISOString() }; await write(state);
    while (state.queue.length) await drain(state);
    state.lastCycle.state = 'acknowledged'; await write(state);
  } catch (error) {
    state ??= await read();
    state.lastError = String(error?.message ?? 'collector_failed').slice(0,300);
    const attempts = state.queue[0]?.attempts ?? 0;
    if (error.stage === 'landing' && state.queue.length && attempts < 3) {
      state.landingRetryAt = Date.now() + 60000 * 2 ** Math.max(0, attempts - 1);
      // Alarm retries the same immutable packet. No new source work while pending.
    } else {
      state.enabled = false;
      if (state.inFlight) { state.lastCycle = { ...state.lastCycle, state: 'interrupted_or_failed' }; state.inFlight = null; }
    }
    await write(state); if (!state.enabled) await chrome.alarms.clear(ALARM);

  } finally { busy = false; }
}
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void cycle(); });
chrome.runtime.onStartup.addListener(async () => { const state = await read(); state.tabId = null; state.tabTarget = null; if (state.inFlight) { state.inFlight = null; state.lastError = 'browser_restart_interrupted_source'; } await write(state); await ensureAlarm(); });
chrome.runtime.onInstalled.addListener(async () => { const prior = (await chrome.storage.local.get('collector')).collector; if (!prior) await write(initialState()); await ensureAlarm(); });
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Commands only from our extension UI, never a content script or webpage.
  if (!message || Object.keys(message).join(',') !== 'command' || sender.id !== chrome.runtime.id || sender.tab || !sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`)) return false;
  (async () => {
    const state = await read();
    if (message?.command === 'status') return { state, limits: LIMITS, target: TARGET, savedTarget: SAVED_TARGET, extensionId: chrome.runtime.id };
    if (busy && message?.command !== 'pause') throw new Error('cycle_in_progress');
    if (message?.command === 'pause') { const paused = await mutate(current => ({ ...current, enabled: false, controlToken: crypto.randomUUID() })); await chrome.alarms.clear(ALARM); return { state: paused }; }
    if (['enable_saved', 'disable_saved'].includes(message?.command)) {
      // Keep an alarm from starting with a stale target snapshot while configuration is being saved.
      busy = true;
      try {
        const savedEnabled = message.command === 'enable_saved';
        const configured = await mutate(current => ({ ...current, savedEnabled, nextTarget: savedEnabled ? 'saved' : 'search', targetState: {
          search: { ...current.targetState.search, nextDue: current.nextDue === null ? null : current.nextDue + (savedEnabled ? current.cadenceMinutes * 60000 : 0) },
          saved: { ...current.targetState.saved, nextDue: savedEnabled ? current.nextDue : null },
        } }));
        return { state: configured };
      } finally { busy = false; }
    }
    if (message?.command === 'start') {
      const health = await chrome.runtime.sendNativeMessage(HOST, { command: 'ping' });
      if (!health?.success) throw new Error('native_host_unavailable');
      const started = await mutate(current => ({ ...current,
        // Explicit Resume relinquishes a tab the owner has navigated elsewhere; never change their page.
        ...(['owned_tab_left_marketplace', 'source_scope_changed'].includes(current.lastError) ? { tabId: null, tabTarget: null } : {}),
        enabled: true, lastError: null, landingRetryAt: null, queue: current.queue.map(item => ({ ...item, attempts: 0 })), controlToken: crypto.randomUUID() })); await ensureAlarm(); void cycle(); return { state: started };
    }
    if (message?.command === 'run') { if (!state.enabled) throw new Error('start_required'); void cycle(); return { state }; }
    throw new Error('invalid_ui_command');
  })().then(respond, error => respond({ error: String(error.message) })); return true;
});
void ensureAlarm();
