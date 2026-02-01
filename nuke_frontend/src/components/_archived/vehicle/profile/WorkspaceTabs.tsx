import React, { useState, useEffect } from 'react';

interface WorkspaceTabsProps {
  activeTab: 'evidence' | 'facts' | 'commerce' | 'financials';
  onTabChange: (tab: 'evidence' | 'facts' | 'commerce' | 'financials') => void;
}

export const WorkspaceTabs: React.FC<WorkspaceTabsProps> = ({ activeTab, onTabChange }) => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const tabs = [
    { id: 'evidence', label: 'Evidence', helper: 'Timeline, gallery, intake' },
    { id: 'facts', label: 'Facts', helper: 'AI confidence & valuations' },
    { id: 'commerce', label: 'Commerce', helper: 'Listings, supporters, offers' },
    { id: 'financials', label: 'Financials', helper: 'Pricing, history & docs' }
  ] as const;

  return (
    <div style={{ 
      borderBottom: '2px solid var(--border-light)', 
      marginBottom: '24px',
      position: 'relative',
      zIndex: 1
    }}>
      <div style={{ 
        display: 'flex', 
        gap: '32px',
        position: 'relative'
      }}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
          <button
            key={tab.id}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onTabChange(tab.id);
              }}
              style={{
                paddingBottom: '16px',
                paddingLeft: '4px',
                paddingRight: '4px',
                paddingTop: '0',
                position: 'relative',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                transition: 'color 0.12s ease',
                color: isActive ? 'var(--text)' : 'var(--text-muted)',
                fontFamily: 'Arial, sans-serif',
                zIndex: 2,
                outline: 'none'
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = 'var(--text)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = 'var(--text-muted)';
                }
              }}
          >
              <div style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'flex-start' 
              }}>
                <span style={{ 
                  fontWeight: 600,
                  fontSize: '10px',
                  lineHeight: '1.2'
                }}>
                  {tab.label}
                </span>
                {!isMobile && (
                  <span style={{ 
                    fontSize: '8px',
                    color: 'var(--text-muted)',
                    marginTop: '4px',
                    fontWeight: 400
                  }}>
                {tab.helper}
              </span>
                )}
            </div>
              {isActive && (
                <div style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  width: '100%',
                  height: '2px',
                  background: 'var(--text)',
                  zIndex: 3
                }} />
            )}
          </button>
          );
        })}
      </div>
    </div>
  );
};

