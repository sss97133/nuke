/**
 * applyBranding — mutate the document head so the INSTALLED app (home-screen
 * icon + name) and the browser chrome reflect the active brand.
 *
 * This is the make-or-break piece of the hypothesis. The static
 * /public/manifest.json always says "Nuke"; here we replace it at runtime with
 * a per-entity manifest (as a blob URL) plus the apple-touch-icon that iOS
 * actually reads at "Add to Home Screen" time.
 *
 * Everything is reversible — restoreBranding() puts the Nuke defaults back so
 * navigating off a branded view doesn't leave a stale icon.
 */

import type { BrandIdentity } from './brandIdentity';
import { LIVERY_ICON_COLORS } from './brandIdentity';
import { generateIcons } from './generateIcon';

interface AppliedState {
  prevTitle: string;
  prevManifestHref: string | null;
  blobUrl: string | null;
}

let applied: AppliedState | null = null;

function upsertLink(rel: string, attrs: Record<string, string>): HTMLLinkElement {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.rel = rel;
    document.head.appendChild(el);
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function upsertMeta(name: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.name = name;
    document.head.appendChild(el);
  }
  el.content = content;
}

export async function applyBranding(brand: BrandIdentity): Promise<void> {
  const icons = await generateIcons(brand);
  const { bg } = LIVERY_ICON_COLORS[brand.accent];

  // Preserve originals once.
  if (!applied) {
    const manifestEl = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    applied = {
      prevTitle: document.title,
      prevManifestHref: manifestEl?.getAttribute('href') ?? null,
      blobUrl: null,
    };
  }

  // --- Title + iOS web-app name ---
  document.title = brand.name;
  upsertMeta('apple-mobile-web-app-title', brand.shortName);
  upsertMeta('apple-mobile-web-app-capable', 'yes');
  upsertMeta('theme-color', bg);

  // --- Apple touch icon (what iOS uses for the home-screen icon) ---
  upsertLink('apple-touch-icon', { href: icons.appleTouch, sizes: '180x180' });

  // --- Dynamic web app manifest (Android/desktop install) ---
  const manifest = {
    name: brand.name,
    short_name: brand.shortName,
    description: brand.tagline ?? 'Built on Nuke',
    start_url: brand.startPath || '/',
    scope: '/',
    display: 'standalone',
    theme_color: bg,
    background_color: bg,
    icons: [
      { src: icons.bySize[192], sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: icons.bySize[512], sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  };
  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
  const blobUrl = URL.createObjectURL(blob);
  if (applied.blobUrl) URL.revokeObjectURL(applied.blobUrl);
  applied.blobUrl = blobUrl;
  upsertLink('manifest', { href: blobUrl });
}

export function restoreBranding(): void {
  if (!applied) return;
  document.title = applied.prevTitle;
  if (applied.prevManifestHref) {
    upsertLink('manifest', { href: applied.prevManifestHref });
  }
  if (applied.blobUrl) {
    URL.revokeObjectURL(applied.blobUrl);
  }
  // apple-touch-icon: point back at the static asset.
  upsertLink('apple-touch-icon', { href: '/apple-touch-icon.png', sizes: '180x180' });
  applied = null;
}
