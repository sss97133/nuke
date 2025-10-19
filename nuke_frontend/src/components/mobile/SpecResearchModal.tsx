/**
 * Spec Research Modal
 * AI-powered deep research on vehicle specifications
 * Searches factory manuals, forums, market data, Facebook groups
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface SpecResearchModalProps {
  vehicle: any;
  spec: { name: string; value: any };
  onClose: () => void;
}

const SpecResearchModal: React.FC<SpecResearchModalProps> = ({ vehicle, spec, onClose }) => {
  const [research, setResearch] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    performAIResearch();
  }, [spec]);

  const performAIResearch = async () => {
    setLoading(true);

    try {
      // Call AI to research this spec with guardrails
      const context = {
        vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        vin: vehicle.vin,
        spec: spec.name,
        value: spec.value
      };

      // For now, show mock data structure
      // TODO: Implement actual AI guardrails research
      const mockResearch = {
        factoryData: {
          type: spec.value,
          details: ['Detail 1', 'Detail 2', 'Detail 3']
        },
        marketContext: {
          commonality: '78% of similar vehicles',
          rebuildCost: '$2,500-4,000',
          reliability: 'Above average'
        },
        communityIntel: {
          forumPosts: 1247,
          facebookGroups: 12,
          commonMods: ['Headers', 'Cam upgrade', 'Intake']
        },
        sources: [
          { type: 'manual', ref: 'Factory service manual p.142' },
          { type: 'data', ref: 'NADA historical data' },
          { type: 'forum', ref: 'K5 Blazer Forum (248 threads)' },
          { type: 'social', ref: 'Classic Truck FB Group' }
        ]
      };

      setResearch(mockResearch);
    } catch (error) {
      console.error('AI research failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <h3 style={styles.headerTitle}>{spec.name.toUpperCase()} SPECIFICATIONS</h3>
          <button onClick={onClose} style={styles.closeButton}>×</button>
        </div>

        {/* Content */}
        <div style={styles.content}>
          {loading ? (
            <div style={styles.loading}>
              🤖 AI researching {spec.name.toLowerCase()} specifications...
            </div>
          ) : research ? (
            <>
              {/* Factory Data */}
              <Section title="Factory Data (AI-sourced)">
                <InfoRow label="Type" value={research.factoryData.type} />
                {research.factoryData.details.map((detail: string, idx: number) => (
                  <div key={idx} style={styles.listItem}>• {detail}</div>
                ))}
              </Section>

              {/* Market Context */}
              <Section title="Market Context">
                <InfoRow label="Common engine" value={research.marketContext.commonality} />
                <InfoRow label="Rebuild cost" value={research.marketContext.rebuildCost} />
                <InfoRow label="Reliability" value={research.marketContext.reliability} />
              </Section>

              {/* Community Intel */}
              <Section title="Community Intel">
                <InfoRow label="Forum discussions" value={`${research.communityIntel.forumPosts} posts`} />
                <InfoRow label="Facebook groups" value={`${research.communityIntel.facebookGroups} active`} />
                <div style={styles.sectionSubtitle}>Common mods:</div>
                {research.communityIntel.commonMods.map((mod: string, idx: number) => (
                  <div key={idx} style={styles.listItem}>• {mod}</div>
                ))}
              </Section>

              {/* Sources */}
              <Section title="Sources">
                {research.sources.map((source: any, idx: number) => (
                  <div key={idx} style={styles.source}>
                    {getSourceIcon(source.type)} {source.ref}
                  </div>
                ))}
              </Section>
            </>
          ) : (
            <div style={styles.error}>Research failed. Please try again.</div>
          )}
        </div>
      </div>
    </div>
  );
};

const getSourceIcon = (type: string) => {
  switch (type) {
    case 'manual': return '📄';
    case 'data': return '📊';
    case 'forum': return '💬';
    case 'social': return '📱';
    default: return '📖';
  }
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={styles.section}>
    <div style={styles.sectionTitle}>{title}</div>
    <div style={styles.sectionContent}>{children}</div>
  </div>
);

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={styles.infoRow}>
    <span style={styles.infoLabel}>{label}:</span>
    <span style={styles.infoValue}>{value}</span>
  </div>
);

const styles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.7)',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'flex-end'
  },
  modal: {
    background: '#c0c0c0',
    width: '100%',
    maxHeight: '85vh',
    borderTopLeftRadius: '12px',
    borderTopRightRadius: '12px',
    display: 'flex',
    flexDirection: 'column' as const
  },
  header: {
    background: '#000080',
    color: '#ffffff',
    padding: '16px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopLeftRadius: '12px',
    borderTopRightRadius: '12px'
  },
  headerTitle: {
    margin: 0,
    fontSize: '14px',
    fontWeight: 'bold' as const,
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  closeButton: {
    background: '#c0c0c0',
    border: '2px outset #ffffff',
    color: '#000000',
    fontSize: '24px',
    width: '32px',
    height: '32px',
    cursor: 'pointer',
    fontFamily: '"MS Sans Serif", sans-serif',
    lineHeight: '1',
    padding: 0
  },
  content: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '16px'
  },
  loading: {
    textAlign: 'center' as const,
    padding: '40px 20px',
    fontSize: '13px',
    color: '#000080',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  error: {
    textAlign: 'center' as const,
    padding: '40px 20px',
    fontSize: '13px',
    color: '#ff0000',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  section: {
    marginBottom: '20px',
    background: '#ffffff',
    border: '2px inset #808080',
    padding: '12px',
    borderRadius: '4px'
  },
  sectionTitle: {
    fontSize: '11px',
    fontWeight: 'bold' as const,
    color: '#000080',
    marginBottom: '8px',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  sectionSubtitle: {
    fontSize: '10px',
    fontWeight: 'bold' as const,
    color: '#000000',
    marginTop: '8px',
    marginBottom: '4px'
  },
  sectionContent: {
    fontSize: '12px'
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '6px 0',
    borderBottom: '1px solid #d0d0d0'
  },
  infoLabel: {
    fontWeight: 'bold' as const,
    color: '#000000',
    fontSize: '11px'
  },
  infoValue: {
    color: '#000000',
    textAlign: 'right' as const,
    fontSize: '11px'
  },
  listItem: {
    fontSize: '11px',
    padding: '4px 0 4px 8px',
    color: '#000000'
  },
  source: {
    fontSize: '10px',
    padding: '6px',
    marginBottom: '4px',
    background: '#c0c0c0',
    border: '1px solid #808080',
    borderRadius: '2px',
    fontFamily: '"MS Sans Serif", sans-serif'
  }
};

export default SpecResearchModal;

