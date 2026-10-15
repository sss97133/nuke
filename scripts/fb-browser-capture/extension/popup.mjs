async function refresh(command = 'status') {
  const result = await chrome.runtime.sendMessage({ command });
  if (result?.error) { document.getElementById('status').textContent = result.error; return; }
  const state = result.state;
  document.getElementById('saved').checked = state.savedEnabled;
  document.getElementById('status').textContent = state.enabled ? 'Collection enabled' : 'Paused';
  const rows = { 'Last canonical landing': state.lastLanding?.at ?? 'none', 'Capture': state.lastLanding?.captureId ?? 'none', 'Last source cycle': state.lastCycle ? `${state.lastCycle.target ?? 'search'} · ${state.lastCycle.startedAt}` : 'none', 'Next target': state.nextTarget, 'Next source due': state.nextDue ? new Date(state.nextDue).toISOString() : 'on Start', 'Search last landing': state.targetState.search.lastLanding?.at ?? 'none', 'Saved last landing': state.targetState.saved.lastLanding?.at ?? 'none', 'Saved next due': state.savedEnabled ? (state.targetState.saved.nextDue ? new Date(state.targetState.saved.nextDue).toISOString() : 'next eligible pass') : 'disabled', 'Pending immutable captures': state.queue.length, 'Landing retry due': state.landingRetryAt ? new Date(state.landingRetryAt).toISOString() : 'none', 'Last failure': state.lastError ?? 'none' };
  const details = document.getElementById('details'); details.replaceChildren();
  for (const [label,value] of Object.entries(rows)) { const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);details.append(dt,dd); }
}
for (const command of ['start','pause','run']) document.getElementById(command).addEventListener('click', () => refresh(command).catch(error => { document.getElementById('status').textContent = error.message; }));
document.getElementById('saved').addEventListener('change', event => refresh(event.target.checked ? 'enable_saved' : 'disable_saved').catch(error => { document.getElementById('status').textContent = error.message; }));
refresh().catch(error => { document.getElementById('status').textContent = error.message; });
setInterval(() => refresh().catch(() => {}), 3000);
