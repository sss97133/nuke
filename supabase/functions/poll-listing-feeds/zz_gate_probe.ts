// Throwaway probe for the CI ratchet gate (#677): one raw external fetch that bypasses archiveFetch.
// This file must never merge; the PR exists only to show the gate fails a PR that raises the raw-fetch count.
export async function gateProbe(): Promise<number> {
  const r = await fetch("https://example.com/");
  return r.status;
}
