// Prerendered /use, /use/dealers, /use/shops, and /use/auction-houses pages.
// Every route named here exists in DomainRoutes or middleware; no inventory
// counts or prices are stated on these pages.

import { SITE, escapeHtml, type FacePage } from './discoveryFace';

function ldScript(value: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;
}

function faqPage(url: string, name: string, description: string, faqs: { q: string; a: string }[]): unknown {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        name,
        url,
        description,
        isPartOf: { '@type': 'WebSite', name: 'Nuke', url: SITE },
      },
      {
        '@type': 'FAQPage',
        url,
        mainEntity: faqs.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
    ],
  };
}

export type UseCaseKind = 'index' | 'dealers' | 'shops' | 'auction-houses';

export const USE_CASE_PATHS: Record<UseCaseKind, string> = {
  index: '/use',
  dealers: '/use/dealers',
  shops: '/use/shops',
  'auction-houses': '/use/auction-houses',
};

/** Routes these pages may name; tests require each to appear in DomainRoutes or middleware. */
export const USE_CASE_ROUTE_CLAIMS = [
  '/dealer/:orgId/bulk-editor',
  '/dealer/:orgId/dropbox-import',
  '/org/:id',
  '/vehicle/',
  '/valuation',
  '/jobs',
  '/providers/',
  '/work',
  '/work/setup',
  '/journal',
  '/market',
  '/auctions',
  '/auction/',
  '/auctions/create',
  '/sources',
  '/mcp-advisor',
  '/cohort',
] as const;

export function parseUseCasePath(pathname: string): UseCaseKind | null {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  if (path === '/use') return 'index';
  if (path === '/use/dealers') return 'dealers';
  if (path === '/use/shops') return 'shops';
  if (path === '/use/auction-houses') return 'auction-houses';
  return null;
}

function crumbs(extra: { label: string; href: string }[] = []): string {
  const parts = [{ label: 'Nuke', href: `${SITE}/` }, { label: 'Use cases', href: `${SITE}/use` }, ...extra];
  return `<nav>${parts.map((p) => `<a href="${escapeHtml(p.href)}">${escapeHtml(p.label)}</a>`).join(' · ')}</nav>`;
}

function page(kind: UseCaseKind, title: string, heading: string, description: string, bodyInner: string, faqs: { q: string; a: string }[]): FacePage {
  const path = USE_CASE_PATHS[kind];
  const url = `${SITE}${path}`;
  const faqHtml = faqs.map((f) => `<section><h2>${escapeHtml(f.q)}</h2><p>${escapeHtml(f.a)}</p></section>`).join('');
  const body = `<main><article>${crumbs(kind === 'index' ? [] : [{ label: heading, href: url }])}<h1>${escapeHtml(heading)}</h1>${bodyInner}${faqHtml}</article></main>`;
  return { title, description, path, type: 'website', body, head: ldScript(faqPage(url, heading, description, faqs)) };
}

export function buildUseIndexFace(): FacePage {
  return page(
    'index',
    'Use cases | Nuke',
    'Use cases',
    'How dealers, shops, and auction houses use public Nuke records and the signed-in tools that already exist in the product.',
    `<p>These pages describe only routes and tools that already exist in the Nuke app. They do not invent coverage counts or prices.</p>
    <ul>
      <li><a href="${SITE}/use/dealers">Dealers</a> — public organization and vehicle pages, plus signed-in inventory import and bulk editing.</li>
      <li><a href="${SITE}/use/shops">Shops</a> — the public jobs board and provider pages, and the signed-in work queue.</li>
      <li><a href="${SITE}/use/auction-houses">Auction houses</a> — the market board, auction listings, and recorded sale evidence.</li>
    </ul>`,
    [{
      q: 'What do these pages cover?',
      a: 'Public records already on Nuke and signed-in tools whose routes are in the app: dealer bulk editing and Dropbox import, the jobs board and work queue, and the market and auctions pages. They are not a promise of features that are not in the repository.',
    }],
  );
}

export function dealersFace(): FacePage {
  return page(
    'dealers',
    'Nuke for dealers | Nuke',
    'Dealers',
    'Public organization and vehicle pages on Nuke, plus signed-in dealer inventory tools: a bulk editor and Dropbox import under /dealer/:orgId.',
    `<p>A dealer organization can have a public page at <a href="${SITE}/org"><code>/org/:id</code></a>. Public vehicles are at <code>/vehicle/:id</code>. Recorded Bring a Trailer sale evidence is on <a href="${SITE}/valuation">/valuation</a>, and year-make-model terminals are under <a href="${SITE}/cohort">/cohort</a>.</p>
    <section><h2>Signed-in inventory tools</h2>
    <p>These routes are behind a sign-in wall in <code>nuke_frontend/src/routes/modules/dealer/routes.tsx</code>:</p>
    <ul>
      <li><code>/dealer/:orgId/bulk-editor</code> — an inventory table whose rows can include VIN, year, make, model, trim, mileage, color, asking price, purchase price, cost basis, notes, and a status of draft, in stock, sold, or pending.</li>
      <li><code>/dealer/:orgId/dropbox-import</code> — import vehicle folders from a connected Dropbox account into vehicle profiles and dealer inventory.</li>
    </ul>
    <p>Create or open an organization from <code>/org/create</code> and <code>/org</code> after you sign in.</p></section>`,
    [{
      q: 'What can a dealer show the public without signing in?',
      a: 'Public organization pages at /org/:id and public vehicle pages at /vehicle/:id. Recorded sale evidence is at /valuation. The bulk editor and Dropbox import stay behind sign-in.',
    }],
  );
}

export function shopsFace(): FacePage {
  return page(
    'shops',
    'Nuke for shops | Nuke',
    'Shops',
    'The public jobs board and provider pages on Nuke, plus the signed-in work queue where a shop signs quotes, completions, and related agreements.',
    `<p>Open work requests are listed on the public <a href="${SITE}/jobs">jobs board</a>. A provider can have a public page at <code>/providers/:handle</code>. <a href="${SITE}/journal">Journal</a> draws a shop work-log from the record (photos, receipts, and work on vehicles in a build).</p>
    <section><h2>Signed-in work</h2>
    <ul>
      <li><a href="${SITE}/work/setup">/work/setup</a> — set up a provider page: records that may be yours, your trade, where and when you work, your tools, and what clients will see.</li>
      <li><a href="${SITE}/work">/work</a> — what is waiting for your signature and the jobs you are on: quotes and offers to accept, completions and payments to confirm, and contact requests.</li>
    </ul>
    <p>The crawler face for a job already states that payments are shown only to the people on the job. Contact details are not shown to other people on the sign-in page copy.</p></section>`,
    [{
      q: 'How does a shop get work on Nuke?',
      a: 'Open requests are on the public /jobs board. A provider page lives at /providers/:handle. /work/setup starts a provider page, and /work lists what is waiting for a signature. Payments stay visible only to the people on the job.',
    }],
  );
}

export function auctionHousesFace(): FacePage {
  return page(
    'auction-houses',
    'Nuke for auction houses | Nuke',
    'Auction houses',
    'The Nuke market board ranks sources by lots held, with a date on each count. /auctions lists marketplace auctions; recorded Bring a Trailer sale evidence is on /valuation.',
    `<p><a href="${SITE}/market">/market</a> ranks each source by the lots Nuke holds for it. Every count on that board carries the day it was measured and, where known, the size of the source it is measured against, with the method and confidence of that size.</p>
    <section><h2>Listings and recorded sales</h2>
    <ul>
      <li><a href="${SITE}/auctions">/auctions</a> — the auction marketplace page.</li>
      <li><code>/auction/:listingId</code> — one listing.</li>
      <li><code>/auctions/create</code> — create a listing (signed-in route in DomainRoutes).</li>
      <li><a href="${SITE}/sources">/sources</a> — the sources board.</li>
      <li><a href="${SITE}/valuation">/valuation</a> — recorded Bring a Trailer sold-result evidence for a year, make, and model, via <code>valuation_by_ymm</code>.</li>
      <li><a href="${SITE}/mcp-advisor">Asset Advisor</a> — the <code>evaluate_listing</code> tool currently accepts Bring a Trailer listing URLs only.</li>
    </ul>
    <p>A house that has a public organization record is also reachable at <code>/org/:id</code>. This page does not claim that every auction house is fully covered, or that listing evaluation works beyond Bring a Trailer.</p></section>`,
    [{
      q: 'Does Nuke evaluate listings from every auction house?',
      a: 'No. The public evaluate_listing tool on the Asset Advisor currently accepts Bring a Trailer listing URLs only. The /valuation page is recorded Bring a Trailer sale evidence. /market and /auctions show the sources and listings Nuke already holds, each with a date when a count is shown.',
    }],
  );
}

export function buildUseCaseFace(pathname: string): FacePage | null {
  const kind = parseUseCasePath(pathname);
  if (kind === 'index') return buildUseIndexFace();
  if (kind === 'dealers') return dealersFace();
  if (kind === 'shops') return shopsFace();
  if (kind === 'auction-houses') return auctionHousesFace();
  return null;
}
