import React, { ReactNode } from 'react';
import '../styles/zone-layout.css';

export interface ZoneProps {
  children: ReactNode;
  title?: string;
  className?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  hideHeader?: boolean;
}

/**
 * Base layout component for all zones
 * Implements iOS 18/desktop app aesthetic with consistent spacing,
 * shadows, and animation effects
 */
export const ZoneLayout: React.FC<ZoneProps> = ({
  children,
  title,
  className = '',
  collapsible = false,
  defaultCollapsed = false,
  hideHeader = false,
}) => {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  
  return (
    <section className={`zone-container ${className} ${collapsed ? 'zone-collapsed' : ''}`}>
      {!hideHeader && (
        <header className="zone-header">
          {title && <h2 className="zone-title">{title}</h2>}
          {collapsible && (
            <button 
              className="zone-collapse-btn"
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? 'Expand' : 'Collapse'}
            >
              <span className="zone-collapse-icon">{collapsed ? '+' : '−'}</span>
            </button>
          )}
        </header>
      )}
      <div className="zone-content">
        {children}
      </div>
    </section>
  );
};

export default ZoneLayout;
