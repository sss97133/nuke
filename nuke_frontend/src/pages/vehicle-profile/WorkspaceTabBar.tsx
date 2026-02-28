import React from 'react';

export const WORKSPACE_TABS = [
  { id: 'evidence', label: 'Photos & History', shortLabel: 'Photos', helper: 'Timeline, gallery, intake' },
  { id: 'facts', label: 'Specs & Analysis', shortLabel: 'Specs', helper: 'AI confidence, details, research' },
  { id: 'commerce', label: 'Market & Value', shortLabel: 'Market', helper: 'Pricing, comps, auction history' },
  { id: 'financials', label: 'Documents', shortLabel: 'Docs', helper: 'Records, wiring, investment docs' }
] as const;

export type WorkspaceTabId = typeof WORKSPACE_TABS[number]['id'];

export interface WorkspaceTabBarProps {
  activeTab: WorkspaceTabId;
  onTabChange: (tab: WorkspaceTabId) => void;
  isMobile: boolean;
}

const WorkspaceTabBar: React.FC<WorkspaceTabBarProps> = ({ activeTab, onTabChange, isMobile }) => {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'stretch',
      flexWrap: 'nowrap',
      overflowX: 'auto',
      WebkitOverflowScrolling: 'touch',
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
      height: 32,
      position: 'sticky',
      top: 0,
      zIndex: 10,
      marginTop: 'var(--space-2)',
    }}>
      {WORKSPACE_TABS.map(t => {
        const active = activeTab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id as WorkspaceTabId)}
            title={t.helper}
            style={{
              padding: '0 18px',
              fontSize: '11px',
              fontFamily: 'var(--font-family)',
              fontWeight: active ? 700 : 500,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              border: 'none',
              borderBottom: active ? '2px solid var(--text)' : '2px solid transparent',
              borderRadius: active ? '4px 4px 0 0' : '0',
              background: active ? 'var(--surface-hover, rgba(128,128,128,0.12))' : 'transparent',
              color: active ? 'var(--text)' : 'var(--text-muted)',
              cursor: 'pointer',
              marginBottom: '-1px',
              transition: 'color 0.1s, background 0.1s',
            }}
            onMouseEnter={(e) => {
              if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--text)';
            }}
            onMouseLeave={(e) => {
              if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
            }}
          >
            {isMobile ? t.shortLabel : t.label}
          </button>
        );
      })}
    </div>
  );
};

export default WorkspaceTabBar;
