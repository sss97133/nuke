import React from 'react';
import type { TabConfig } from '../../services/organizationIntelligenceService';

interface DynamicTabBarProps {
  tabs: TabConfig[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  source?: 'explicit_ui_config' | 'explicit_business_type' | 'data_driven' | 'default';
}

export const DynamicTabBar: React.FC<DynamicTabBarProps> = ({
  tabs,
  activeTab,
  onTabChange,
}) => {
  return (
    <div
      style={{
        background: 'var(--white)',
        borderBottom: '1px solid var(--border)',
        padding: '0 20px',
        display: 'flex',
        gap: 0,
        overflowX: 'auto',
      }}
    >
      {tabs.map(tab => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: isActive ? '2px solid var(--text)' : '2px solid transparent',
              padding: '10px 14px',
              fontSize: '11px',
              fontWeight: isActive ? 700 : 400,
              cursor: 'pointer',
              fontFamily: 'var(--font-family, Arial, sans-serif)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              color: isActive ? 'var(--text)' : 'var(--text-muted)',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              transition: 'color 0.1s, border-color 0.1s',
            }}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span
                style={{
                  background: isActive ? 'var(--text)' : 'var(--grey-300)',
                  color: isActive ? 'var(--white)' : 'var(--text)',
                  padding: '1px 5px',
                  fontSize: '9px',
                  fontWeight: 700,
                  minWidth: '16px',
                  textAlign: 'center',
                }}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
