import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { QuickVehicle } from './hooks/useQuickVehicles';

interface NukeMenuProps {
  session: any;
  quickVehicles: QuickVehicle[];
  quickVehiclesLoading: boolean;
  onLoadQuickVehicles: (userId: string) => void;
}

export const NukeMenu: React.FC<NukeMenuProps> = ({
  session,
  quickVehicles,
  quickVehiclesLoading,
  onLoadQuickVehicles,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [vehiclesSubMenuOpen, setVehiclesSubMenuOpen] = useState(false);
  const [vehicleSearch, setVehicleSearch] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  const isActivePage = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-marque-menu]')) {
        setMenuOpen(false);
        setVehiclesSubMenuOpen(false);
        setVehicleSearch('');
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [menuOpen]);

  // Reset submenu when main menu closes
  useEffect(() => {
    if (!menuOpen) {
      setVehiclesSubMenuOpen(false);
      setVehicleSearch('');
    }
  }, [menuOpen]);

  const closeAll = () => {
    setMenuOpen(false);
    setVehiclesSubMenuOpen(false);
    setVehicleSearch('');
  };

  return (
    <div style={{ position: 'relative' }} data-marque-menu>
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        aria-expanded={menuOpen}
        aria-haspopup="true"
        className={`nav-link ${menuOpen ? 'active' : ''}`}
        style={{
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}
      >
        <span style={{ fontSize: '14px', lineHeight: 1 }}>≡</span>
      </button>

      {menuOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            display: 'flex',
            zIndex: 2000,
            marginTop: '2px'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Main nav panel */}
          <div
            style={{
              background: 'var(--surface)',
              border: '2px solid var(--border)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              minWidth: '160px'
            }}
          >
            {session && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setVehiclesSubMenuOpen(!vehiclesSubMenuOpen);
                  if (!vehiclesSubMenuOpen && session?.user?.id) {
                    onLoadQuickVehicles(session.user.id);
                  }
                }}
                className={`nav-link ${isActivePage('/vehicle') ? 'active' : ''}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '8px 12px',
                  border: 'none',
                  background: vehiclesSubMenuOpen ? 'var(--surface-hover)' : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  borderBottom: '1px solid var(--border)'
                }}
              >
                <span>Vehicles</span>
                <span style={{ fontSize: '9px', marginLeft: '8px' }}>{vehiclesSubMenuOpen ? '▾' : '▸'}</span>
              </button>
            )}
            <Link to="/search" className={`nav-link ${isActivePage('/search') ? 'active' : ''}`} style={{ display: 'block', padding: '8px 12px', textDecoration: 'none', borderBottom: '1px solid var(--border)' }} onClick={closeAll}>Search</Link>
            <Link to="/auctions" className={`nav-link ${isActivePage('/auctions') ? 'active' : ''}`} style={{ display: 'block', padding: '8px 12px', textDecoration: 'none', borderBottom: '1px solid var(--border)' }} onClick={closeAll}>Auctions</Link>
            <Link to="/org" className={`nav-link ${isActivePage('/org') ? 'active' : ''}`} style={{ display: 'block', padding: '8px 12px', textDecoration: 'none', borderBottom: '1px solid var(--border)' }} onClick={closeAll}>Organizations</Link>
            {session && (
              <>
                <Link to="/inbox" className={`nav-link ${isActivePage('/inbox') ? 'active' : ''}`} style={{ display: 'block', padding: '8px 12px', textDecoration: 'none', borderBottom: '1px solid var(--border)' }} onClick={closeAll}>Inbox</Link>
                <Link to="/pipeline" className={`nav-link ${isActivePage('/pipeline') ? 'active' : ''}`} style={{ display: 'block', padding: '8px 12px', textDecoration: 'none', borderBottom: '1px solid var(--border)' }} onClick={closeAll}>Acquisitions</Link>
                <Link to="/invoices" className={`nav-link ${isActivePage('/invoices') ? 'active' : ''}`} style={{ display: 'block', padding: '8px 12px', textDecoration: 'none', borderBottom: '1px solid var(--border)' }} onClick={closeAll}>Invoices</Link>
                <Link to="/restoration" className={`nav-link ${isActivePage('/restoration') ? 'active' : ''}`} style={{ display: 'block', padding: '8px 12px', textDecoration: 'none', borderBottom: '1px solid var(--border)' }} onClick={closeAll}>Restoration Intake</Link>
              </>
            )}
            <Link to="/market" className={`nav-link ${isActivePage('/market') ? 'active' : ''}`} style={{ display: 'block', padding: '8px 12px', textDecoration: 'none', borderBottom: '1px solid var(--border)' }} onClick={closeAll}>Market</Link>
            <Link to="/predictions" className={`nav-link ${isActivePage('/predictions') ? 'active' : ''}`} style={{ display: 'block', padding: '8px 12px', textDecoration: 'none', borderBottom: '1px solid var(--border)' }} onClick={closeAll}>Predictions</Link>
            <div style={{ borderTop: '2px solid var(--border)', marginTop: '2px' }} />
            <Link to="/api" className={`nav-link ${isActivePage('/api') ? 'active' : ''}`} style={{ display: 'block', padding: '8px 12px', textDecoration: 'none', borderBottom: '1px solid var(--border)' }} onClick={closeAll}>API</Link>
            <Link to="/developers" className={`nav-link ${isActivePage('/developers') ? 'active' : ''}`} style={{ display: 'block', padding: '8px 12px', textDecoration: 'none', borderBottom: '1px solid var(--border)' }} onClick={closeAll}>SDK Docs</Link>
            <a href="https://www.npmjs.com/package/@nuke1/sdk" target="_blank" rel="noopener noreferrer" className="nav-link" style={{ display: 'block', padding: '8px 12px', textDecoration: 'none', borderBottom: '1px solid var(--border)' }} onClick={closeAll}>NPM Package</a>
            <Link to="/offering" className={`nav-link ${isActivePage('/offering') ? 'active' : ''}`} style={{ display: 'block', padding: '8px 12px', textDecoration: 'none', color: 'var(--accent)' }} onClick={closeAll}>Investor Deck</Link>
          </div>

          {/* Vehicles panel - pops out to the RIGHT */}
          {vehiclesSubMenuOpen && (
            <div
              style={{
                background: 'var(--surface)',
                border: '2px solid var(--border)',
                borderLeft: 'none',
                boxShadow: '4px 4px 12px rgba(0,0,0,0.15)',
                minWidth: '220px',
                maxHeight: '350px',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
                <input
                  type="text"
                  placeholder="Search by year, make..."
                  value={vehicleSearch}
                  onChange={(e) => setVehicleSearch(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: '100%',
                    padding: '4px 8px',
                    fontSize: '12px',
                    border: '1px solid var(--border)',
                    background: 'var(--white)',
                    outline: 'none'
                  }}
                  autoFocus
                />
              </div>

              <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'thin' }}>
                {quickVehiclesLoading ? (
                  <div style={{ padding: '12px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>Loading...</div>
                ) : quickVehicles.length === 0 ? (
                  <div style={{ padding: '12px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>No vehicles yet</div>
                ) : (
                  quickVehicles
                    .filter((v) => {
                      if (!vehicleSearch.trim()) return true;
                      const s = vehicleSearch.toLowerCase();
                      return (v.title || '').toLowerCase().includes(s) ||
                        String(v.year || '').includes(s) ||
                        (v.make || '').toLowerCase().includes(s) ||
                        (v.model || '').toLowerCase().includes(s);
                    })
                    .slice(0, 10)
                    .map((v) => (
                      <button
                        key={v.id}
                        onClick={() => {
                          closeAll();
                          navigate(`/vehicle/${v.id}`, { state: { vehicleTitle: v.title } });
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          width: '100%',
                          padding: '6px 10px',
                          border: 'none',
                          borderBottom: '1px solid var(--border)',
                          background: 'transparent',
                          cursor: 'pointer',
                          textAlign: 'left',
                          fontSize: '12px'
                        }}
                        className="nav-link"
                        title={v.title}
                      >
                        <div style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '3px',
                          background: v.thumbnail ? `url(${v.thumbnail}) center/cover` : 'var(--grey-300)',
                          flexShrink: 0
                        }} />
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {v.title}
                        </span>
                      </button>
                    ))
                )}
              </div>

              <Link
                to="/vehicles"
                onClick={closeAll}
                style={{
                  display: 'block',
                  padding: '8px 12px',
                  textDecoration: 'none',
                  fontSize: '12px',
                  fontWeight: 600,
                  borderTop: '1px solid var(--border)',
                  background: 'var(--surface)'
                }}
                className="nav-link"
              >
                View All Vehicles →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
