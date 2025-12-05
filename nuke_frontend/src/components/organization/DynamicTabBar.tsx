/**
 * Dynamic Tab Bar Component
 * 
 * Shows tabs based on organization intelligence
 * Respects explicit settings, uses data-driven as fallback
 */

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
  source
}) => {
  return (
    <div
      style={{
        background: 'var(--white)',
        borderBottom: '2px solid var(--border)',
        padding: '0 16px',
        display: 'flex',
        gap: '8px',
        overflowX: 'auto'
      }}
    >
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          style={{
            background: activeTab === tab.id ? 'var(--grey-200)' : 'transparent',
            border: 'none',
            borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : 'none',
            padding: '8px 12px',
            fontSize: '9pt',
            cursor: 'pointer',
            fontFamily: 'Arial, sans-serif',
            textTransform: 'capitalize',
            color: activeTab === tab.id ? 'var(--accent)' : 'var(--text)',
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          {tab.label}
          {tab.badge !== undefined && tab.badge > 0 && (
            <span
              style={{
                background: activeTab === tab.id ? 'var(--accent)' : 'var(--grey-300)',
                color: activeTab === tab.id ? 'white' : 'var(--text)',
                borderRadius: '10px',
                padding: '2px 6px',
                fontSize: '8pt',
                fontWeight: 'bold',
                minWidth: '18px',
                textAlign: 'center'
              }}
            >
              {tab.badge}
            </span>
          )}
        </button>
      ))}
      
      {/* Optional: Show source indicator (for debugging/transparency) */}
      {source && source !== 'explicit_ui_config' && process.env.NODE_ENV === 'development' && (
        <div
          style={{
            marginLeft: 'auto',
            fontSize: '7pt',
            color: 'var(--grey-500)',
            padding: '8px 0',
            fontStyle: 'italic'
          }}
        >
          {source === 'data_driven' && 'Auto-configured'}
          {source === 'explicit_business_type' && 'From business type'}
          {source === 'default' && 'Default'}
        </div>
      )}
    </div>
  );
};

