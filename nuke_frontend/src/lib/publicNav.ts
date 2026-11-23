// Public discovery links shared by the SPA footer, About, and market/journal chrome.
// The crawler faces already point here; this list is the human-app counterpart.

export const PUBLIC_DISCOVERY_LINKS = [
  { to: '/methodology', label: 'Methodology' },
  { to: '/sources', label: 'Sources' },
  { to: '/compare', label: 'Compare' },
  { to: '/use', label: 'Use cases' },
] as const;

export type PublicDiscoveryLink = (typeof PUBLIC_DISCOVERY_LINKS)[number];
