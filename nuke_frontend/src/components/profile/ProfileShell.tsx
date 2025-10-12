import React from 'react';
import '../../design-system.css';

export interface ProfileTabDef {
  key: string;
  label: string;
  badge?: number | string;
}

interface ProfileShellProps {
  tabs: ProfileTabDef[];
  activeKey: string;
  onChange: (key: string) => void;
  header?: React.ReactNode;
  children: React.ReactNode; // main content
  sidecar?: React.ReactNode; // right column widgets
}

const ProfileShell: React.FC<ProfileShellProps> = ({ tabs, activeKey, onChange, header, children, sidecar }) => {
  return (
    <div className="profile-shell" style={{ display: 'grid', gridTemplateColumns: '220px 1fr 320px', gap: 12 }}>
      {/* Left Nav */}
      <aside className="card" style={{ height: 'fit-content', position: 'sticky', top: 64 }}>
        <div className="card-body" style={{ padding: 8 }}>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {tabs.map(t => (
              <button
                key={t.key}
                className={`button ${activeKey === t.key ? 'button-primary' : 'button-secondary'}`}
                onClick={() => onChange(t.key)}
                style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}
              >
                <span>{t.label}</span>
                {t.badge !== undefined && (
                  <span className="badge" style={{ marginLeft: 8 }}>{t.badge}</span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </aside>

      {/* Main */}
      <section>
        {header && (
          <div className="card" style={{ marginBottom: 8 }}>
            <div className="card-body">
              {header}
            </div>
          </div>
        )}
        <div>
          {children}
        </div>
      </section>

      {/* Sidecar */}
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sidecar}
      </aside>
    </div>
  );
};

export default ProfileShell;
