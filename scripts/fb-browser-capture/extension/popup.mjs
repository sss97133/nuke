async function refresh(command = 'status') {
  const result = await chrome.runtime.sendMessage({ command });
  if (result?.error) { document.getElementById('status').textContent = result.error; return; }
  const state = result.state;
  document.getElementById('status').textContent = state.enabled ? 'Collection enabled' : 'Paused';
  const rows = { 'Last canonical landing': state.lastLanding?.at ?? 'none', 'Capture': state.lastLanding?.captureId ?? 'none', 'Last source cycle': state.lastCycle?.startedAt ?? 'none', 'Next source due': state.nextDue ? new Date(state.nextDue).toISOString() : 'on Start', 'Pending immutable captures': state.queue.length, 'Landing retry due': state.landingRetryAt ? new Date(state.landingRetryAt).toISOString() : 'none', 'Last failure': state.lastError ?? 'none' };
  const details = document.getElementById('details'); details.replaceChildren();
  for (const [label,value] of Object.entries(rows)) { const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);details.append(dt,dd); }
}
for (const command of ['start','pause','run']) document.getElementById(command).addEventListener('click', () => refresh(command).catch(error => { document.getElementById('status').textContent = error.message; }));
refresh().catch(error => { document.getElementById('status').textContent = error.message; });
setInterval(() => refresh().catch(() => {}), 3000);
