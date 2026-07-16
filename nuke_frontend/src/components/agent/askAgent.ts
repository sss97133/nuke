// The one-line bridge between a ledger row and the agent panel. Its own module so
// BuildLedger can dispatch without importing AgentChat into its lazy chunk.

export const ASK_AGENT_EVENT = 'nuke:ask-agent';

/** Seed the agent panel's input with `text` and focus it. Never sends. */
export function askAgent(text: string) {
  window.dispatchEvent(new CustomEvent(ASK_AGENT_EVENT, { detail: { text } }));
}
