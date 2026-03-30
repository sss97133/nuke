/**
 * VehicleIntelligencePanel — surfaces comment intel, description intel, and apparition history
 * directly on the vehicle profile page. Self-guarding: returns null if no data.
 */
import React from 'react';
import { CollapsibleWidget } from '../../components/ui/CollapsibleWidget';
import { useVehicleProfile } from './VehicleProfileContext';
import type { CommentIntel, DescriptionIntel, Apparition } from './hooks/useVehicleIntel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract string from polymorphic quote/insight/concern shapes */
function extractText(item: string | { quote?: string; insight?: string; concern?: string; significance?: string }): string {
  if (typeof item === 'string') return item;
  return item.quote || item.insight || item.concern || '';
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '\u2026';
}

function formatPrice(n: number | null | undefined): string {
  if (n == null) return '\u2014';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDate(d: string | null | undefined): string {
  if (!d) return '\u2014';
  try {
    const dt = new Date(d);
    return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return d;
  }
}

// Design tokens
const LABEL: React.CSSProperties = {
  fontFamily: 'var(--vp-font-sans)',
  fontSize: '7px',
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--vp-pencil)',
};

const MONO: React.CSSProperties = {
  fontFamily: 'var(--vp-font-mono)',
  fontSize: '9px',
};

const BADGE: React.CSSProperties = {
  display: 'inline-block',
  padding: '0 4px',
  border: '2px solid var(--vp-ink)',
  fontFamily: 'var(--vp-font-mono)',
  fontSize: '8px',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  marginRight: '4px',
};

// ---------------------------------------------------------------------------
// Section: Community Intelligence
// ---------------------------------------------------------------------------

const CommunityIntelSection: React.FC<{ ci: CommentIntel }> = ({ ci }) => {
  const quotes = (ci.key_quotes || []).slice(0, 3).map(extractText).filter(Boolean);
  const insights = (ci.expert_insights || []).slice(0, 3).map(extractText).filter(Boolean);
  const concerns = (ci.community_concerns || []).slice(0, 3).map(extractText).filter(Boolean);
  const ms = ci.market_signals;

  const hasContent = quotes.length > 0 || insights.length > 0 || concerns.length > 0 || ms;
  if (!hasContent && !ci.overall_sentiment) return null;

  const sentimentColor = (() => {
    const s = (ci.overall_sentiment || '').toLowerCase();
    if (s.includes('positive') || s.includes('enthusiastic')) return 'var(--vp-brg, #004225)';
    if (s.includes('negative') || s.includes('critical')) return '#8a0020';
    return 'var(--vp-ink)';
  })();

  return (
    <CollapsibleWidget variant="profile" title="Community Intelligence" defaultCollapsed={false}
      badge={
        <span className="widget__count" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {ci.overall_sentiment && (
            <span style={{ ...BADGE, color: sentimentColor, borderColor: sentimentColor }}>
              {truncate(ci.overall_sentiment, 16)}
            </span>
          )}
          {ci.comment_count != null && (
            <span style={LABEL}>{ci.comment_count} COMMENTS</span>
          )}
        </span>
      }
    >
      <div style={{ fontFamily: 'var(--vp-font-sans)', fontSize: '9px', lineHeight: '1.5' }}>
        {/* Key Quotes */}
        {quotes.length > 0 && (
          <div style={{ marginBottom: '8px' }}>
            <div style={{ ...LABEL, marginBottom: '4px' }}>KEY QUOTES</div>
            {quotes.map((q, i) => (
              <div key={i} style={{
                borderLeft: '2px solid var(--vp-ghost, #ddd)',
                paddingLeft: '8px',
                marginBottom: '4px',
                fontStyle: 'italic',
                color: 'var(--vp-ink)',
              }}>
                {truncate(q, 120)}
              </div>
            ))}
          </div>
        )}

        {/* Expert Insights */}
        {insights.length > 0 && (
          <div style={{ marginBottom: '8px' }}>
            <div style={{ ...LABEL, marginBottom: '4px' }}>EXPERT INSIGHTS</div>
            {insights.map((ins, i) => (
              <div key={i} style={{ marginBottom: '2px' }}>
                {truncate(ins, 140)}
              </div>
            ))}
          </div>
        )}

        {/* Concerns */}
        {concerns.length > 0 && (
          <div style={{ marginBottom: '8px' }}>
            <div style={{ ...LABEL, marginBottom: '4px' }}>CONCERNS RAISED</div>
            {concerns.map((c, i) => (
              <div key={i} style={{ color: '#8a0020', marginBottom: '2px' }}>
                {truncate(c, 120)}
              </div>
            ))}
          </div>
        )}

        {/* Market Signals */}
        {ms && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {ms.demand && <span style={BADGE}>DEMAND: {ms.demand}</span>}
            {ms.rarity && <span style={BADGE}>RARITY: {ms.rarity}</span>}
            {ms.price_trend && <span style={BADGE}>TREND: {ms.price_trend}</span>}
          </div>
        )}
      </div>
    </CollapsibleWidget>
  );
};

// ---------------------------------------------------------------------------
// Section: Vehicle Intelligence (description intel)
// ---------------------------------------------------------------------------

const VehicleIntelSection: React.FC<{ di: DescriptionIntel }> = ({ di }) => {
  const flags = (di.red_flags || []).slice(0, 3);
  const mods = di.mods || [];
  const docs = di.documentation || [];

  const hasContent = di.condition_note || di.title_status || di.matching_numbers != null ||
    di.condition || di.owner_count != null || flags.length > 0 || mods.length > 0 || docs.length > 0;
  if (!hasContent) return null;

  return (
    <CollapsibleWidget variant="profile" title="Vehicle Intelligence" defaultCollapsed={false}>
      <div style={{ fontFamily: 'var(--vp-font-sans)', fontSize: '9px', lineHeight: '1.5' }}>
        {/* Condition Note */}
        {di.condition_note && (
          <div style={{ marginBottom: '8px' }}>
            {truncate(di.condition_note, 200)}
          </div>
        )}

        {/* Quick Badges */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
          {di.title_status && <span style={BADGE}>{di.title_status}</span>}
          {di.matching_numbers != null && (
            <span style={{ ...BADGE, color: di.matching_numbers ? 'var(--vp-brg, #004225)' : '#8a0020' }}>
              {di.matching_numbers ? 'MATCHING #S' : 'NON-MATCHING'}
            </span>
          )}
          {di.condition && <span style={BADGE}>{di.condition}</span>}
          {di.owner_count != null && <span style={BADGE}>{di.owner_count} OWNER{di.owner_count !== 1 ? 'S' : ''}</span>}
        </div>

        {/* Red Flags */}
        {flags.length > 0 && (
          <div style={{ marginBottom: '8px' }}>
            <div style={{ ...LABEL, marginBottom: '4px' }}>RED FLAGS</div>
            {flags.map((rf, i) => (
              <div key={i} style={{ color: '#8a0020', marginBottom: '2px', display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                <span style={{ ...BADGE, color: '#8a0020', borderColor: '#8a0020', flexShrink: 0 }}>{rf.sev}</span>
                <span>{truncate(rf.f, 100)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Modifications */}
        {mods.length > 0 && (
          <div style={{ marginBottom: '8px' }}>
            <div style={{ ...LABEL, marginBottom: '4px' }}>MODIFICATIONS ({mods.length})</div>
            <div style={MONO}>{mods.slice(0, 5).join(' / ')}</div>
          </div>
        )}

        {/* Documentation */}
        {docs.length > 0 && (
          <div>
            <div style={{ ...LABEL, marginBottom: '4px' }}>DOCUMENTATION</div>
            <div style={MONO}>{docs.slice(0, 4).join(' / ')}</div>
          </div>
        )}
      </div>
    </CollapsibleWidget>
  );
};

// ---------------------------------------------------------------------------
// Section: Apparition History
// ---------------------------------------------------------------------------

const ApparitionSection: React.FC<{ apparitions: Apparition[] }> = ({ apparitions }) => {
  if (apparitions.length <= 1) return null;
  const rows = apparitions.slice(0, 6);

  return (
    <CollapsibleWidget variant="profile" title="Apparition History" defaultCollapsed={true}
      badge={<span className="widget__count">{apparitions.length}</span>}
    >
      <div style={{ fontFamily: 'var(--vp-font-mono)', fontSize: '8px', lineHeight: '1.6' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...LABEL, textAlign: 'left', paddingBottom: '4px', width: '80px' }}>PLATFORM</th>
              <th style={{ ...LABEL, textAlign: 'left', paddingBottom: '4px', width: '50px' }}>TYPE</th>
              <th style={{ ...LABEL, textAlign: 'right', paddingBottom: '4px' }}>PRICE</th>
              <th style={{ ...LABEL, textAlign: 'right', paddingBottom: '4px' }}>DATE</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a, i) => (
              <tr key={i} style={{ borderTop: i > 0 ? '1px solid var(--vp-border, #eee)' : undefined }}>
                <td style={{ padding: '2px 0' }}>
                  {a.url ? (
                    <a href={a.url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
                      {truncate(a.platform, 14)}
                    </a>
                  ) : truncate(a.platform, 14)}
                </td>
                <td style={{ padding: '2px 0' }}>{a.event_type || '\u2014'}</td>
                <td style={{ padding: '2px 0', textAlign: 'right', color: a.price ? '#16825d' : 'inherit' }}>
                  {formatPrice(a.price)}
                </td>
                <td style={{ padding: '2px 0', textAlign: 'right' }}>{formatDate(a.event_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleWidget>
  );
};

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

const VehicleIntelligencePanel: React.FC = () => {
  const { vehicleIntel, vehicleIntelLoading } = useVehicleProfile();

  if (vehicleIntelLoading || !vehicleIntel) return null;

  const { comment_intel, description_intel, apparitions } = vehicleIntel;

  // Self-guard: return null if there's no meaningful data at all
  const hasCommentIntel = comment_intel && (
    comment_intel.overall_sentiment ||
    (comment_intel.key_quotes && comment_intel.key_quotes.length > 0) ||
    (comment_intel.expert_insights && comment_intel.expert_insights.length > 0) ||
    (comment_intel.community_concerns && comment_intel.community_concerns.length > 0) ||
    comment_intel.market_signals
  );
  const hasDescriptionIntel = description_intel && (
    description_intel.condition_note || description_intel.title_status ||
    description_intel.matching_numbers != null || description_intel.condition ||
    description_intel.owner_count != null ||
    (description_intel.red_flags && description_intel.red_flags.length > 0) ||
    (description_intel.mods && description_intel.mods.length > 0) ||
    (description_intel.documentation && description_intel.documentation.length > 0)
  );
  const hasApparitions = apparitions && apparitions.length > 1;

  if (!hasCommentIntel && !hasDescriptionIntel && !hasApparitions) return null;

  return (
    <>
      {hasCommentIntel && comment_intel && <CommunityIntelSection ci={comment_intel} />}
      {hasDescriptionIntel && description_intel && <VehicleIntelSection di={description_intel} />}
      {hasApparitions && apparitions && <ApparitionSection apparitions={apparitions} />}
    </>
  );
};

export default VehicleIntelligencePanel;
