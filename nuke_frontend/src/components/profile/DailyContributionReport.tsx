import React from 'react';
import type { DailyContributionSummary, ContributionHighlight } from '../../types/profile';

interface DailyContributionReportProps {
  summaries: DailyContributionSummary[];
  maxDays?: number;
  isOwnProfile?: boolean;
}

const FONT_BASE = '8pt';
const FONT_SMALL = '7pt';
const FONT_TINY = '6pt';

const typeLabels: Record<ContributionHighlight['type'], { label: string; accent: string }> = {
  vehicle_data: { label: 'Vehicle Work', accent: 'var(--accent)' },
  image_upload: { label: 'Media', accent: 'var(--info)' },
  timeline_event: { label: 'Timeline', accent: 'var(--accent)' },
  verification: { label: 'Verification', accent: 'var(--success)' },
  annotation: { label: 'Annotation', accent: 'var(--warning)' },
  business_event: { label: 'Business', accent: 'var(--danger)' }
};

const formatCurrency = (value: number) => {
  if (!value) return '$0';
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

const formatHours = (value: number) => {
  if (!value) return '—';
  return `${value.toFixed(1)} hrs`;
};

const formatCount = (value: number, label: string) => {
  if (!value) return '';
  return `${value} ${label}${value === 1 ? '' : 's'}`;
};

const formatDate = (isoDate: string) => {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
};

const DailyContributionReport: React.FC<DailyContributionReportProps> = ({
  summaries,
  maxDays = 21,
  isOwnProfile
}) => {
  if (!summaries || summaries.length === 0) {
    return (
      <div style={styles.emptyState}>
        <div style={styles.emptyTitle}>No contribution ledger yet</div>
        <div style={styles.emptySubtitle}>
          {isOwnProfile
            ? 'Document work, upload receipts, or log maintenance to build your daily report.'
            : 'This user has not documented vehicle activity yet.'}
        </div>
      </div>
    );
  }

  const trimmedSummaries = summaries.slice(0, maxDays);
  const periodTotals = trimmedSummaries.reduce(
    (acc, summary) => {
      acc.value += summary.total_value_usd;
      acc.hours += summary.total_hours;
      acc.images += summary.total_images;
      acc.events += summary.total_events;
      acc.verifications += summary.total_verifications;
      return acc;
    },
    { value: 0, hours: 0, images: 0, events: 0, verifications: 0 }
  );

  return (
    <div className="card" style={styles.container}>
      <div className="card-header" style={styles.header}>
        <div style={styles.headerTitle}>Daily Impact Report</div>
        <div style={styles.headerMeta}>
          <span style={styles.headerMetaItem}>{trimmedSummaries.length} days</span>
          <span style={styles.headerMetaItem}>{formatCurrency(periodTotals.value)} total value</span>
          <span style={styles.headerMetaItem}>{formatHours(periodTotals.hours)}</span>
          <span style={styles.headerMetaItem}>{formatCount(periodTotals.events, 'event')}</span>
          <span style={styles.headerMetaItem}>{formatCount(periodTotals.images, 'photo')}</span>
        </div>
      </div>

      <div className="card-body" style={styles.reportBody}>
        {trimmedSummaries.map((summary) => (
          <div key={summary.id} style={styles.dayCard}>
            <div style={styles.dayHeader}>
              <div style={styles.dayHeaderLeft}>
                <div style={styles.dayDate}>{formatDate(summary.date)}</div>
                <div style={styles.dayVehicle}>{summary.vehicle_name || 'Multiple Vehicles'}</div>
              </div>
              <div style={styles.dayHeaderMetrics}>
                <div style={styles.metricValue}>{formatCurrency(summary.total_value_usd)}</div>
                <div style={styles.metricSub}>value created</div>
              </div>
              <div style={styles.dayHeaderMetrics}>
                <div style={styles.metricValue}>{formatHours(summary.total_hours)}</div>
                <div style={styles.metricSub}>documented time</div>
              </div>
              <div style={styles.dayHeaderMetrics}>
                <div style={styles.metricValue}>{summary.total_images || '—'}</div>
                <div style={styles.metricSub}>photos</div>
              </div>
            </div>

            <div style={styles.highlightList}>
              {summary.highlights.map((highlight) => {
                const type = typeLabels[highlight.type] || typeLabels.vehicle_data;
                const metadata = (highlight.metadata || {}) as any;
                const aiInsight = metadata?.ai_insight as {
                  conditionScore?: number | null;
                  conditionLabel?: string | null;
                  confidence?: number | null;
                  keyFindings?: Array<{ title: string; detail: string; severity?: string | null }>;
                  summary?: string;
                } | undefined;
                const vehicleName = metadata?.vehicle_name || summary.vehicle_name || 'Vehicle';
                const normalizedTitle = (highlight.title || '').toLowerCase();
                const redundantPhotoTitle = normalizedTitle.includes('photo added') || normalizedTitle.includes('vehicle photo uploaded');
                const fallbackTitle = `Condition documentation – ${vehicleName}`;
                const keyFinding = aiInsight?.keyFindings?.[0];
                const aiDescription = keyFinding
                  ? `${keyFinding.title}${keyFinding.detail ? ': ' + keyFinding.detail : ''}`
                  : null;
                const fallbackDescription = !aiInsight
                  ? `${highlight.count} images documented for ${vehicleName}.`
                  : null;
                const title = aiInsight?.summary || (!highlight.title || redundantPhotoTitle ? fallbackTitle : highlight.title);
                const description = highlight.description || aiDescription || fallbackDescription;
                const conditionText = aiInsight?.conditionLabel
                  ? `${aiInsight.conditionLabel}${aiInsight.conditionScore != null ? ` (${aiInsight.conditionScore}/10)` : ''}`
                  : null;
                const confidenceText = typeof aiInsight?.confidence === 'number'
                  ? `${Math.round(aiInsight.confidence * 100)}% confidence`
                  : null;

                return (
                  <div key={highlight.id} style={styles.highlightRow}>
                    <div style={{ ...styles.highlightBadge, borderColor: type.accent, color: type.accent }}>
                      {type.label}
                    </div>
                    <div style={styles.highlightDetails}>
                      <div style={styles.highlightTitle}>{title}</div>
                      {description && (
                        <div style={styles.highlightDescription}>{description}</div>
                      )}
                      {(conditionText || confidenceText) && (
                        <div style={styles.highlightTags}>
                          {conditionText && (
                            <span style={styles.highlightTag}>{conditionText}</span>
                          )}
                          {confidenceText && (
                            <span style={styles.highlightTag}>{confidenceText}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div style={styles.highlightMetrics}>
                      <div style={styles.highlightMetricValue}>{formatCurrency(highlight.value_usd)}</div>
                      <div style={styles.highlightMetricSub}>value</div>
                    </div>
                    <div style={styles.highlightMetrics}>
                      <div style={styles.highlightMetricValue}>{formatHours(highlight.hours)}</div>
                      <div style={styles.highlightMetricSub}>time</div>
                    </div>
                    <div style={styles.highlightMetrics}>
                      <div style={styles.highlightMetricValue}>{highlight.count}</div>
                      <div style={styles.highlightMetricSub}>items</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    border: '1px solid var(--border-light)'
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: 'var(--space-3)',
    background: 'var(--grey-50)'
  },
  headerTitle: {
    fontSize: FONT_BASE,
    fontWeight: 700,
    color: 'var(--text)'
  },
  headerMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-2)',
    fontSize: FONT_SMALL,
    color: 'var(--text-secondary)'
  },
  headerMetaItem: {
    padding: '2px 6px',
    borderRadius: '4px',
    border: '1px solid var(--border-light)',
    background: 'var(--white)'
  },
  reportBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-3)',
    padding: 'var(--space-3)'
  },
  dayCard: {
    border: '1px solid var(--border-light)',
    borderRadius: '6px',
    background: 'var(--white)',
    overflow: 'hidden'
  },
  dayHeader: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 2fr) repeat(3, minmax(0, 1fr))',
    gap: 'var(--space-3)',
    padding: 'var(--space-3)',
    borderBottom: '1px solid var(--border-light)',
    alignItems: 'center',
    background: 'var(--grey-25)'
  },
  dayHeaderLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  },
  dayDate: {
    fontSize: FONT_BASE,
    fontWeight: 700,
    color: 'var(--text)'
  },
  dayVehicle: {
    fontSize: FONT_SMALL,
    color: 'var(--text-secondary)'
  },
  dayHeaderMetrics: {
    textAlign: 'right' as const
  },
  metricValue: {
    fontSize: FONT_BASE,
    fontWeight: 700,
    color: 'var(--text)'
  },
  metricSub: {
    fontSize: FONT_TINY,
    color: 'var(--text-secondary)'
  },
  highlightList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
    padding: 'var(--space-3)'
  },
  highlightRow: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 2fr) repeat(3, minmax(0, 80px))',
    gap: 'var(--space-2)',
    alignItems: 'center',
    padding: 'var(--space-2)',
    border: '1px solid var(--border-light)',
    borderRadius: '4px',
    background: 'var(--grey-10)'
  },
  highlightBadge: {
    fontSize: FONT_TINY,
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: '4px',
    border: '1px solid currentColor',
    textTransform: 'uppercase'
  },
  highlightDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  },
  highlightTitle: {
    fontSize: FONT_BASE,
    fontWeight: 600,
    color: 'var(--text)'
  },
  highlightDescription: {
    fontSize: FONT_SMALL,
    color: 'var(--text-secondary)'
  },
  highlightTags: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '4px'
  },
  highlightTag: {
    fontSize: FONT_TINY,
    padding: '2px 6px',
    borderRadius: '4px',
    background: 'var(--grey-50)',
    border: '1px solid var(--border-light)',
    color: 'var(--text-secondary)'
  },
  highlightMetrics: {
    textAlign: 'right' as const
  },
  highlightMetricValue: {
    fontSize: FONT_BASE,
    fontWeight: 600,
    color: 'var(--text)'
  },
  highlightMetricSub: {
    fontSize: FONT_TINY,
    color: 'var(--text-secondary)'
  },
  emptyState: {
    border: '1px solid var(--border-light)',
    borderRadius: '4px',
    padding: 'var(--space-4)',
    background: 'var(--grey-10)',
    textAlign: 'center' as const,
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-1)'
  },
  emptyTitle: {
    fontSize: FONT_BASE,
    fontWeight: 700,
    color: 'var(--text)'
  },
  emptySubtitle: {
    fontSize: FONT_SMALL,
    color: 'var(--text-secondary)'
  }
};

export default DailyContributionReport;

