/**
 * IssueProfile
 *
 * Profile page for a single publication issue (e.g., Issue #11).
 * Route: /publishing/:slug/issue/:issueNumber
 *
 * Widgets render only when their data exists — no empty shells.
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type {
  Publication,
  PublicationIssue,
  EditorialStory,
  AdPlacement,
  FlatplanPage,
  ProductionCredit,
} from '../../types/publishing';

// ─── Helpers ──────────────────────────────────────────────────

function formatDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ─── Component ────────────────────────────────────────────────

export default function IssueProfile() {
  const { slug, issueNumber } = useParams<{ slug: string; issueNumber: string }>();
  const navigate = useNavigate();

  const [publication, setPublication] = useState<Publication | null>(null);
  const [issue, setIssue] = useState<PublicationIssue | null>(null);
  const [stories, setStories] = useState<EditorialStory[]>([]);
  const [ads, setAds] = useState<AdPlacement[]>([]);
  const [flatplan, setFlatplan] = useState<FlatplanPage[]>([]);
  const [credits, setCredits] = useState<ProductionCredit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (slug && issueNumber) loadData();
  }, [slug, issueNumber]);

  const loadData = async () => {
    if (!slug || !issueNumber) return;
    setLoading(true);

    // Step 1: get publication by slug, falling back to publisher_slug —
    // dashboard/profile pages navigate with publisher_slug, and some series
    // (e.g. lofficiel_stbarth) have no publications row whose slug matches it.
    let { data: pub } = await supabase
      .from('publications')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();

    if (!pub) {
      const { data: bySeries } = await supabase
        .from('publications')
        .select('*')
        .eq('publisher_slug', slug)
        .order('publication_date', { ascending: true })
        .limit(1)
        .maybeSingle();
      pub = bySeries;
    }

    if (!pub) {
      setLoading(false);
      return;
    }
    setPublication(pub as Publication);

    // Step 2: get the issue
    let { data: issueData } = await supabase
      .from('publication_issues')
      .select('*')
      .eq('publication_id', pub.id)
      .eq('issue_number', issueNumber)
      .single();

    // Fallback: issues are keyed to ONE canonical publications row per
    // publisher_slug, but navigation may arrive via any sibling row's slug.
    if (!issueData && pub.publisher_slug) {
      const { data: siblings } = await supabase
        .from('publications')
        .select('id')
        .eq('publisher_slug', pub.publisher_slug);
      const siblingIds = (siblings || []).map((s: { id: string }) => s.id);
      if (siblingIds.length > 0) {
        const { data: fallbackIssue } = await supabase
          .from('publication_issues')
          .select('*')
          .in('publication_id', siblingIds)
          .eq('issue_number', issueNumber)
          .limit(1)
          .maybeSingle();
        issueData = fallbackIssue;
      }
    }

    if (!issueData) {
      setLoading(false);
      return;
    }
    setIssue(issueData as PublicationIssue);

    // Step 3: parallel fetch of related data
    const issueId = issueData.id;
    const [storyRes, adRes, flatRes, creditRes] = await Promise.all([
      supabase
        .from('editorial_stories')
        .select('*')
        .eq('issue_id', issueId)
        .order('page_start', { ascending: true }),
      supabase
        .from('ad_placements')
        .select('*')
        .eq('issue_id', issueId)
        .order('page_number', { ascending: true }),
      supabase
        .from('flatplan_pages')
        .select('*')
        .eq('issue_id', issueId)
        .order('page_number', { ascending: true }),
      supabase
        .from('nuke_production_credits')
        .select('*')
        .eq('issue_id', issueId)
        .order('person_name', { ascending: true }),
    ]);

    if (storyRes.data) setStories(storyRes.data as EditorialStory[]);
    if (adRes.data) {
      // structural front-of-book rows drained without a brand — not real ads
      setAds((adRes.data as AdPlacement[]).filter(a => a.brand_name !== '(unspecified)'));
    }
    if (flatRes.data) setFlatplan(flatRes.data as FlatplanPage[]);
    if (creditRes.data) setCredits(creditRes.data as ProductionCredit[]);

    setLoading(false);
  };

  // ── Render guards ──────────────────────────────────────────

  if (loading) {
    return (
      <div style={s.loadingWrap}>
        <span style={s.loadingText}>LOADING</span>
      </div>
    );
  }

  if (!issue) return null;

  // ── Derived data ───────────────────────────────────────────

  const brandNames = Array.from(
    new Set([
      ...ads.map(a => a.brand_name).filter(Boolean),
      ...stories.map(st => st.brand_partner).filter(Boolean) as string[],
    ])
  );

  // ── Layout ─────────────────────────────────────────────────

  return (
    <div style={s.root}>
      {/* Sub-header badges */}
      <div style={s.subHeader}>
        <span style={s.badge}>
          ISSUE{' '}
          <span style={s.badgeNum}>
            {issue.issue_number ? `#${issue.issue_number}` : '—'}
          </span>
        </span>
        {issue.page_count != null && (
          <span style={s.badge}>
            <span style={s.badgeNum}>{issue.page_count}</span> PAGES
          </span>
        )}
        {stories.length > 0 && (
          <span style={s.badge}>
            <span style={s.badgeNum}>{stories.length}</span> STORIES
          </span>
        )}
        {ads.length > 0 && (
          <span style={s.badge}>
            <span style={s.badgeNum}>{ads.length}</span> ADS
          </span>
        )}
        <span style={s.badge}>{formatDate(issue.cover_date)}</span>
      </div>

      {/* Two-column content */}
      <div style={s.grid} data-issue-grid>
        {/* LEFT COLUMN */}
        <div style={s.colLeft}>
          {/* Flatplan Widget */}
          {flatplan.length > 0 && (
            <div style={s.widget}>
              <div style={s.widgetHeader}>
                <span style={s.widgetLabel}>FLATPLAN</span>
              </div>
              <div style={s.widgetBody}>
                {flatplan.map(page => {
                  const isAd =
                    page.page_type === 'ad' || page.page_type === 'advertisement';
                  const borderColor = isAd
                    ? 'var(--chart-purple)'
                    : 'var(--chart-green)';
                  return (
                    <div
                      key={page.id}
                      style={{
                        ...s.flatplanRow,
                        borderLeft: `3px solid ${borderColor}`,
                      }}
                    >
                      <span style={s.flatplanPageNum}>{page.page_number}</span>
                      <span style={s.flatplanTypeBadge}>
                        {page.page_type.toUpperCase()}
                      </span>
                      <span style={s.flatplanName}>
                        {page.brand_name || page.story_title || '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Editorial Stories Widget */}
          {stories.length > 0 && (
            <div style={s.widget}>
              <div style={s.widgetHeader}>
                <span style={s.widgetLabel}>EDITORIAL STORIES</span>
              </div>
              <div style={s.widgetBody}>
                {stories.map(story => (
                  <div key={story.id} style={s.storyCard}>
                    <div style={s.storyTitle}>{story.title}</div>
                    <div style={s.storyMeta}>
                      {story.page_start != null && story.page_end != null && (
                        <span style={s.storyPages}>
                          pp {story.page_start}–{story.page_end}
                        </span>
                      )}
                      {story.photographer_name && (
                        <StoryKV label="PHOTO" value={story.photographer_name} />
                      )}
                      {story.stylist_name && (
                        <StoryKV label="STYLIST" value={story.stylist_name} />
                      )}
                      {story.brand_partner && (
                        <StoryKV label="BRAND" value={story.brand_partner} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ad Placements Widget */}
          {ads.length > 0 && (
            <div style={s.widget}>
              <div style={s.widgetHeader}>
                <span style={s.widgetLabel}>AD PLACEMENTS</span>
              </div>
              <div style={s.widgetBody}>
                {ads.map(ad => (
                  <div key={ad.id} style={s.adRow}>
                    <span style={s.adBrand}>{ad.brand_name}</span>
                    {ad.page_number != null && (
                      <span style={s.adPage}>p. {ad.page_number}</span>
                    )}
                    {ad.placement_type && (
                      <span style={s.adType}>
                        {ad.placement_type.toUpperCase()}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Credits Widget */}
          {credits.length > 0 && (
            <div style={s.widget}>
              <div style={s.widgetHeader}>
                <span style={s.widgetLabel}>CREDITS</span>
              </div>
              <div style={s.widgetBody}>
                {credits.map((c, i) => (
                  <div
                    key={i}
                    style={s.creditRow}
                    onClick={() => {
                      if (c.user_id) navigate(`/publishing/people/${c.user_id}`);
                    }}
                    onMouseEnter={e =>
                      (e.currentTarget.style.background = 'var(--surface)')
                    }
                    onMouseLeave={e =>
                      (e.currentTarget.style.background = 'transparent')
                    }
                  >
                    <span style={s.creditName}>{c.person_name}</span>
                    <span style={s.creditRole}>{c.role}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN */}
        <div style={s.colRight}>
          {/* Issue Info Widget */}
          <div style={s.widget}>
            <div style={s.widgetHeader}>
              <span style={s.widgetLabel}>ISSUE INFO</span>
            </div>
            <div style={s.widgetBody}>
              <KV
                label="ISSUE"
                value={issue.issue_number ? `#${issue.issue_number}` : '—'}
                mono
              />
              <KV label="COVER DATE" value={formatDate(issue.cover_date)} mono />
              {issue.page_count != null && (
                <KV label="PAGE COUNT" value={issue.page_count} mono />
              )}
              {issue.editor_in_chief && (
                <KV label="EDITOR" value={issue.editor_in_chief} />
              )}
              {issue.creative_director && (
                <KV label="CREATIVE DIRECTOR" value={issue.creative_director} />
              )}
              {issue.issue_title && <KV label="TITLE" value={issue.issue_title} />}
            </div>
          </div>

          {/* Brands Widget */}
          {brandNames.length > 0 && (
            <div style={s.widget}>
              <div style={s.widgetHeader}>
                <span style={s.widgetLabel}>BRANDS</span>
              </div>
              <div style={s.widgetBody}>
                <div style={s.brandCloud}>
                  {brandNames.map((name, i) => (
                    <span key={i} style={s.brandBadge}>
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function KV({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
}) {
  return (
    <div style={s.kvRow}>
      <span style={s.kvLabel}>{label}</span>
      <span style={mono ? s.kvValueMono : s.kvValue}>{value}</span>
    </div>
  );
}

function StoryKV({ label, value }: { label: string; value: string }) {
  return (
    <span style={s.storyKV}>
      <span style={s.storyKVLabel}>{label}</span> {value}
    </span>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const TRANSITION = '180ms cubic-bezier(0.16, 1, 0.3, 1)';

const s: Record<string, React.CSSProperties> = {
  root: {
    background: 'var(--bg)',
    minHeight: '100vh',
    fontFamily: 'Arial, sans-serif',
    color: 'var(--text)',
  },

  // Loading
  loadingWrap: {
    background: 'var(--bg)',
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: 'var(--text-secondary)',
    fontSize: '9px',
    letterSpacing: '0.2em',
    textTransform: 'uppercase' as const,
    fontFamily: 'Arial, sans-serif',
    fontWeight: 700,
  },

  // Sub-header
  subHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    padding: 'var(--space-3) var(--space-4)',
    borderBottom: '2px solid var(--border)',
    flexWrap: 'wrap' as const,
  },
  badge: {
    fontSize: '8px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    color: 'var(--text-secondary)',
    border: '1px solid var(--border)',
    padding: '2px 6px',
    fontFamily: 'Arial, sans-serif',
    borderRadius: 0,
  },
  badgeNum: {
    fontFamily: 'Courier New, monospace',
    fontSize: '9px',
    fontWeight: 700,
    color: 'var(--text)',
  },

  // Grid
  grid: {
    display: 'grid',
    gridTemplateColumns: '55% 45%',
    gap: 'var(--space-4)',
    padding: 'var(--space-4)',
  },
  colLeft: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 'var(--space-4)',
  },
  colRight: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 'var(--space-4)',
  },

  // Widget
  widget: {
    border: '2px solid var(--border)',
    borderRadius: 0,
  },
  widgetHeader: {
    padding: 'var(--space-2) var(--space-3)',
    borderBottom: '1px solid var(--border)',
  },
  widgetLabel: {
    fontSize: '8px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    color: 'var(--text-secondary)',
    fontFamily: 'Arial, sans-serif',
  },
  widgetBody: {
    padding: 'var(--space-3)',
  },

  // KV
  kvRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    padding: 'var(--space-1) 0',
  },
  kvLabel: {
    fontSize: '8px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    color: 'var(--text-secondary)',
    fontFamily: 'Arial, sans-serif',
  },
  kvValue: {
    fontSize: '12px',
    color: 'var(--text)',
    fontFamily: 'Arial, sans-serif',
  },
  kvValueMono: {
    fontSize: '9px',
    color: 'var(--text)',
    fontFamily: 'Courier New, monospace',
    fontWeight: 700,
  },

  // Flatplan
  flatplanRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    padding: 'var(--space-2) var(--space-2)',
    marginBottom: '1px',
  },
  flatplanPageNum: {
    fontFamily: 'Courier New, monospace',
    fontSize: '9px',
    fontWeight: 700,
    color: 'var(--text)',
    minWidth: '28px',
    textAlign: 'right' as const,
  },
  flatplanTypeBadge: {
    fontSize: '7px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border)',
    padding: '1px 4px',
    fontFamily: 'Arial, sans-serif',
    minWidth: '48px',
    textAlign: 'center' as const,
  },
  flatplanName: {
    fontSize: '11px',
    color: 'var(--text)',
    fontFamily: 'Arial, sans-serif',
    flex: 1,
  },

  // Editorial Stories
  storyCard: {
    padding: 'var(--space-2) 0',
    borderBottom: '1px solid var(--border)',
  },
  storyTitle: {
    fontSize: '12px',
    fontWeight: 700,
    color: 'var(--text)',
    fontFamily: 'Arial, sans-serif',
    marginBottom: 'var(--space-1)',
  },
  storyMeta: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 'var(--space-3)',
    alignItems: 'center',
  },
  storyPages: {
    fontFamily: 'Courier New, monospace',
    fontSize: '9px',
    fontWeight: 700,
    color: 'var(--text-secondary)',
  },
  storyKV: {
    fontSize: '10px',
    color: 'var(--text)',
    fontFamily: 'Arial, sans-serif',
  },
  storyKVLabel: {
    fontSize: '7px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    color: 'var(--text-secondary)',
    fontFamily: 'Arial, sans-serif',
    textTransform: 'uppercase' as const,
  },

  // Ad Placements
  adRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    padding: 'var(--space-2) 0',
    borderBottom: '1px solid var(--border)',
  },
  adBrand: {
    fontSize: '11px',
    color: 'var(--text)',
    fontFamily: 'Arial, sans-serif',
    flex: 1,
  },
  adPage: {
    fontFamily: 'Courier New, monospace',
    fontSize: '9px',
    fontWeight: 700,
    color: 'var(--text-secondary)',
  },
  adType: {
    fontSize: '7px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border)',
    padding: '1px 4px',
    fontFamily: 'Arial, sans-serif',
  },

  // Credits
  creditRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    padding: 'var(--space-2) var(--space-2)',
    cursor: 'pointer',
    transition: `background ${TRANSITION}`,
  },
  creditName: {
    fontSize: '11px',
    color: 'var(--text)',
    fontFamily: 'Arial, sans-serif',
    flex: 1,
  },
  creditRole: {
    fontSize: '8px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    color: 'var(--text-secondary)',
    fontFamily: 'Arial, sans-serif',
  },

  // Brands cloud
  brandCloud: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 'var(--space-2)',
  },
  brandBadge: {
    fontSize: '9px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: 'var(--text)',
    border: '1px solid var(--border)',
    padding: '2px 6px',
    fontFamily: 'Arial, sans-serif',
    borderRadius: 0,
  },
};

// ─── Responsive media query ──────────────────────────────────

const MOBILE_STYLE_ID = 'issue-profile-mobile';
if (typeof document !== 'undefined' && !document.getElementById(MOBILE_STYLE_ID)) {
  const tag = document.createElement('style');
  tag.id = MOBILE_STYLE_ID;
  tag.textContent = `
    @media (max-width: 768px) {
      [data-issue-grid] {
        grid-template-columns: 1fr !important;
      }
    }
  `;
  document.head.appendChild(tag);
}
