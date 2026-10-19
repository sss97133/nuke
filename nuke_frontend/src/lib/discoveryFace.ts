// What a crawler or link preview reads for the open job, provider and organization pages, and the work sitemap.
// Used by nuke_frontend/middleware.ts (the same edge mechanism that writes vehicle-page tags). Built only from anon
// readers: open_requirements_read, work_order_job_path_read, work_order_resources_read, provider_profile_read,
// organization_supply_read, discovery_providers_read and the public organizations row. Never customer identity,
// payments, contact fields or private names.

export const SITE = 'https://nuke.ag';
export const DEFAULT_IMAGE = `${SITE}/og-image.png`;

/** The bare canonical URL for a path: no query string or fragment, so nothing about the sharer travels with it. */
export function canonicalUrl(path: string): string {
  const clean = path.split(/[?#]/)[0] || '/';
  return `${SITE}${clean.startsWith('/') ? clean : `/${clean}`}`;
}

type J = Record<string, unknown>;
const obj = (v: unknown): J | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as J) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const sentence = (s: string) => { const t = s.replace(/_/g, ' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : t; };
const dayOf = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export type FacePage = {
  title: string;
  description: string;
  path: string;
  image?: string | null;
  type?: 'website' | 'article' | 'profile';
  body: string;
  /** Inserted before </head>: critical CSS for the server-drawn header and the header payload the app paints from. */
  head?: string;
};

/**
 * The kit and job-page rules the server-drawn header uses, copied verbatim so the header the app draws on mount has the
 * same size and place as the one painted first (src/kit/kit.css and pages/jobs/job-page.css stay the source;
 * discovery.test.ts fails when a rule here no longer appears there).
 */
export const HEADER_CSS_RULES = [
  ".k-entity  { font: 700 20px/1.1 Arial, sans-serif; letter-spacing: -0.02em; color: var(--text); }",
  ".k-body    { font: 400 10px/1.5 Arial, sans-serif; color: var(--text); }",
  ".k-caption { font: 400 9px/1.4 'Courier New', monospace; color: var(--text-secondary); }",
  ".k-section { border-bottom: 2px solid var(--border); padding: 8px 12px; background: var(--surface); }",
  ".k-masthead { display: flex; align-items: center; gap: 12px; min-height: 36px; }",
  ".k-masthead__result { margin-left: auto; text-align: right; }",
  ".job-page { max-width: 960px; margin: 0 auto; }",
  ".job-masthead { display: grid; gap: 2px; min-width: 0; }",
  ".job-link { color: var(--text); text-decoration: underline; text-underline-offset: 2px; }",
];
const HEADER_CSS = `<style id="nuke-face-css">${HEADER_CSS_RULES.join('')}` +
  '@media (max-width: 420px){.k-masthead{flex-wrap:wrap}.k-masthead__result{margin-left:0;text-align:left}}</style>';

export const JOB_HEADER_ID = 'nuke-job-header';

/** Public header fields the job page paints before its own read returns. Never payments, people or contact fields. */
export function jobHeaderPayload(workOrderId: string, path: J): Record<string, unknown> {
  const stages = obj(path.stages);
  const states: Record<string, string> = {};
  for (const k of STAGE_ORDER) { const st = str(obj(stages?.[k])?.state); if (st) states[k] = st; }
  const v = obj(path.vehicle_label);
  return {
    work_order_id: workOrderId,
    display_title: str(path.display_title),
    vehicle_label: v ? { text: vehicleText(v) } : null,
    vehicle_id: str(path.vehicle_id),
    request_source_label: str(path.request_source_label),
    stages: states,
  };
}

/** JSON inside a script tag, with '<' escaped so no value can close the tag. */
export function jsonScript(id: string, value: unknown): string {
  return `<script type="application/json" id="${id}">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;
}

const KIND: Record<string, string> = { skill: 'Skill', inspection: 'Inspection', tool: 'Tool', equipment: 'Equipment', facility: 'Shop space', approval: 'Approval' };
const kindWord = (k: string | null) => (k ? KIND[k] ?? sentence(k) : 'Request');

function vehicleText(v: unknown): string | null {
  const o = obj(v);
  if (!o) return null;
  return str(o.text) ?? ([o.year, o.make, o.model].filter(x => x !== null && x !== undefined && x !== '').join(' ') || null);
}

// ── /jobs ──────────────────────────────────────────────────────────────────

export function jobsBoardFace(read: J | null): FacePage {
  const rows = arr(read?.rows).map(obj).filter((r): r is J => !!r);
  const total = num(obj(read?.coverage)?.total_open);
  const asOf = dayOf(str(read?.as_of));
  const description = total === null
    ? 'Open requests on Nuke for technicians, inspectors, tools and shop space. Technicians offer; the customer chooses.'
    : `${plural(total, 'open request')} on Nuke${asOf ? ` (read ${asOf})` : ''} for technicians, inspectors, tools and shop space. Technicians offer; the customer chooses.`;
  const items = rows.slice(0, 25).map(r => {
    const id = str(r.work_order_id);
    const area = obj(r.area_band);
    const where = [str(area?.city), str(area?.state)].filter(Boolean).join(', ');
    const line = [`${kindWord(str(r.requirement_kind))}: ${clip(str(r.description) ?? 'no description', 160)}`,
      str(r.display_title), vehicleText(r.vehicle_label), where || null].filter(Boolean).join(' · ');
    return id ? `<li><a href="${SITE}/jobs/${escapeHtml(id)}">${escapeHtml(line)}</a></li>` : `<li>${escapeHtml(line)}</li>`;
  });
  const body = `<main><h1>Jobs looking for someone</h1><p>${escapeHtml(description)}</p>` +
    (total === null ? '<p>The open requests could not be read at this moment, so none are listed here.</p>'
      : `<ol>${items.join('')}</ol>${total > items.length ? `<p>The first ${items.length} of ${total.toLocaleString('en-US')} are listed.</p>` : ''}`) +
    '</main>';
  return { title: 'Jobs looking for someone | Nuke', description, path: '/jobs', type: 'website', body };
}

// ── /jobs/:id ──────────────────────────────────────────────────────────────

const STAGE_ORDER = ['intake', 'inspection', 'plan', 'terms', 'execution', 'completion'] as const;
const STAGE_WORD: Record<string, string> = {
  intake: 'Request', inspection: 'Inspection', plan: 'Estimate', terms: 'Quote and acceptance', execution: 'Work', completion: 'Completion',
};
const STATE_WORD: Record<string, string> = { recorded: 'recorded', partial: 'partly recorded', status_only: 'status only', absent: 'not recorded' };

/** The furthest stage with anything on record, in plain words. Accounting is never read. */
export function stageLine(stages: unknown): string | null {
  const s = obj(stages);
  if (!s) return null;
  let furthest: string | null = null;
  for (const k of STAGE_ORDER) {
    const state = str(obj(s[k])?.state);
    if (state === 'recorded' || state === 'partial' || state === 'status_only') furthest = k;
  }
  if (!furthest) return null;
  return `${STAGE_WORD[furthest]} ${STATE_WORD[str(obj(s[furthest])?.state) ?? ''] ?? ''}`.trim();
}

export function jobFace(workOrderId: string, path: J, resources: J | null, image: string | null): FacePage {
  const title = str(path.display_title) ?? 'Work order';
  const vehicle = vehicleText(path.vehicle_label);
  const stage = stageLine(path.stages);
  const reqs = arr(resources?.requirements).map(obj).filter((r): r is J => !!r);
  const description = [vehicle, stage ? `Furthest stage on record: ${stage}` : null,
    resources ? `${plural(reqs.length, 'requirement')} listed` : null, 'Open job on Nuke; technicians offer, the customer chooses'].filter(Boolean).join(' · ');
  const stageRows = STAGE_ORDER.map(k => {
    const st = str(obj(obj(path.stages)?.[k])?.state);
    return st ? `<dt>${escapeHtml(STAGE_WORD[k])}</dt><dd>${escapeHtml(STATE_WORD[st] ?? sentence(st).toLowerCase())}</dd>` : '';
  }).join('');
  const reqItems = reqs.slice(0, 20).map(r => `<li>${escapeHtml(`${kindWord(str(r.requirement_kind))}: ${clip(str(r.description) ?? 'no description', 200)}`)}</li>`).join('');
  const vid = str(path.vehicle_id);
  const source = str(path.request_source_label);
  // The same header markup the job page's Masthead draws, so the first paint and the app's header match.
  const header = `<header class="k-section k-masthead"><div class="job-masthead"><h1 class="k-entity">${escapeHtml(title)}</h1>` +
    (vehicle ? (vid ? `<a class="job-link" href="${SITE}/vehicle/${escapeHtml(vid)}"><span class="k-body">${escapeHtml(vehicle)}</span></a>` : `<span class="k-body">${escapeHtml(vehicle)}</span>`) : '') +
    `</div>${source ? `<div class="k-masthead__result"><span class="k-caption">${escapeHtml(source)}</span></div>` : ''}</header>`;
  const body = `<article class="job-page">${header}<section class="k-section">` +
    (stageRows ? `<h2>Job path</h2><dl>${stageRows}</dl>` : '') +
    (reqs.length ? `<h2>What it needs</h2><ol>${reqItems}</ol>${reqs.length > 20 ? `<p>The first 20 of ${reqs.length} are listed.</p>` : ''}` : '') +
    `<p>Stages show what is on record, not verified. Payments are shown only to the people on the job. <a href="${SITE}/jobs">More open requests</a></p></section></article>`;
  return { title: `${title} | Nuke jobs`, description, path: `/jobs/${workOrderId}`, image, type: 'article', body,
    head: HEADER_CSS + jsonScript(JOB_HEADER_ID, jobHeaderPayload(workOrderId, path)) };
}

// ── /providers/:handle ─────────────────────────────────────────────────────

export function providerFace(handle: string, profile: J): FacePage {
  const subject = obj(profile.subject);
  const caps = arr(obj(profile.capabilities)?.items).map(obj)
    .filter((c): c is J => !!c && !!str(c.capability_type) && str(c.derivation) !== 'legacy_hand_entered');
  const skills = caps.slice(0, 6).map(c => sentence(str(c.capability_type)!).toLowerCase());
  const band = obj(profile.service_area);
  const area = str(band?.state) === 'declared' && str(band?.city)
    ? `${str(band?.city)}, ${str(band?.state_code)} within ${num(band?.radius_miles) ?? '?'} miles${band?.mobile === true ? ', travels to the vehicle' : ''}`
    : [str(subject?.city), str(subject?.state)].filter(Boolean).join(', ') || null;
  const bridge = str(obj(profile.identity_bridge)?.state);
  const link = bridge === 'evidenced' ? 'Technician link backed by work' : bridge === 'claimed' ? 'Technician link claimed, not yet backed by work' : null;
  const jobs = num(obj(obj(profile.work_record)?.jobs)?.jobs);
  const description = [skills.length ? `Skills from evidence: ${skills.join(', ')}` : 'No evidence-derived skills yet', area ? `Area: ${area}` : null,
    link, jobs ? `${plural(jobs, 'job')} on record` : null].filter(Boolean).join(' · ');
  const body = `<article><h1>@${escapeHtml(handle)}</h1><p>${escapeHtml(description)}.</p>` +
    (skills.length ? `<h2>What the record shows</h2><ul>${skills.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` : '') +
    '<p>Skills here come only from evidence of work. Self-descriptions, vouches and co-signs are shown separately on the page. Contact goes through Nuke.</p></article>';
  return { title: `@${handle} · work record | Nuke`, description, path: `/providers/${encodeURIComponent(handle)}`, type: 'profile', body };
}

// ── /org/:id ───────────────────────────────────────────────────────────────

export function organizationFace(id: string, org: J, supply: J | null): FacePage {
  const name = str(org.business_name) ?? str(org.name) ?? 'Organization';
  const where = [str(org.city), str(org.state)].filter(Boolean).join(', ');
  const type = str(org.business_type);
  const kinds = arr(obj(supply?.work_recorded_on_nuke)?.kinds).map(obj).filter((k): k is J => !!k && !!str(k.supply_kind));
  const kindWords = kinds.slice(0, 6).map(k => `${sentence(str(k.supply_kind)!).toLowerCase()} (${plural(num(k.times) ?? 0, 'purchase record')}${str(k.last_on) ? `, last ${str(k.last_on)}` : ''})`);
  const description = [type && type !== 'other' ? sentence(type) : null, where || null,
    kindWords.length ? `Supplies on record: ${kindWords.join('; ')}` : null].filter(Boolean).join(' · ') || `${name} on Nuke`;
  const body = `<article><h1>${escapeHtml(name)}</h1><p>${escapeHtml(description)}.</p>` +
    (kindWords.length ? '<p>Purchase records retained on Nuke, by kind of supply; amounts and payers are not shown.</p>' : '') + '</article>';
  return { title: `${name} | Nuke`, description, path: `/org/${id}`, type: 'website', body };
}

// ── Injection into the app shell ───────────────────────────────────────────

function setMeta(html: string, re: RegExp, tag: string): string {
  return re.test(html) ? html.replace(re, tag) : html.replace('</head>', `${tag}\n</head>`);
}

export function injectPage(html: string, page: FacePage): string {
  const t = escapeHtml(page.title);
  const d = escapeHtml(clip(page.description, 300));
  const url = `${SITE}${page.path}`;
  const image = escapeHtml(page.image || DEFAULT_IMAGE);
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`);
  html = setMeta(html, /<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${d}" />`);
  html = setMeta(html, /<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="${url}" />`);
  html = setMeta(html, /<meta property="og:title" content="[^"]*"\s*\/>/, `<meta property="og:title" content="${t}" />`);
  html = setMeta(html, /<meta property="og:description" content="[^"]*"\s*\/>/, `<meta property="og:description" content="${d}" />`);
  html = setMeta(html, /<meta property="og:type" content="[^"]*"\s*\/>/, `<meta property="og:type" content="${page.type ?? 'website'}" />`);
  html = setMeta(html, /<meta property="og:url" content="[^"]*"\s*\/>/, `<meta property="og:url" content="${url}" />`);
  html = setMeta(html, /<meta property="og:image" content="[^"]*"\s*\/>/, `<meta property="og:image" content="${image}" />`);
  html = setMeta(html, /<meta name="twitter:title" content="[^"]*"\s*\/>/, `<meta name="twitter:title" content="${t}" />`);
  html = setMeta(html, /<meta name="twitter:description" content="[^"]*"\s*\/>/, `<meta name="twitter:description" content="${d}" />`);
  html = setMeta(html, /<meta name="twitter:image" content="[^"]*"\s*\/>/, `<meta name="twitter:image" content="${image}" />`);
  if (page.head) html = html.replace('</head>', `${page.head}\n</head>`);
  // React's createRoot replaces everything inside #root on mount; readers without JavaScript keep this.
  return html.replace('<div id="root"></div>', `<div id="root">${page.body}</div>`);
}

// ── Work sitemap ───────────────────────────────────────────────────────────

export type SitemapUrl = { loc: string; lastmod?: string | null };

export function workSitemapUrls(jobIds: string[], providers: J | null, organizations: unknown[], jobsAsOf: string | null): SitemapUrl[] {
  const urls: SitemapUrl[] = [{ loc: `${SITE}/jobs`, lastmod: dayOf(jobsAsOf) }];
  for (const id of Array.from(new Set(jobIds))) urls.push({ loc: `${SITE}/jobs/${id}`, lastmod: dayOf(jobsAsOf) });
  for (const p of arr(providers?.providers).map(obj)) {
    const h = str(p?.handle);
    if (h) urls.push({ loc: `${SITE}/providers/${encodeURIComponent(h)}`, lastmod: dayOf(str(p?.updated_at)) });
  }
  for (const o of organizations.map(obj)) {
    const id = str(o?.id);
    if (id) urls.push({ loc: `${SITE}/org/${id}`, lastmod: dayOf(str(o?.updated_at)) });
  }
  return urls;
}

export function sitemapXml(urls: SitemapUrl[]): string {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u => `  <url><loc>${escapeHtml(u.loc)}</loc>${u.lastmod ? `<lastmod>${escapeHtml(u.lastmod)}</lastmod>` : ''}</url>`).join('\n') +
    '\n</urlset>\n';
}
