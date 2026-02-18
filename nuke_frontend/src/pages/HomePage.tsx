import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const CursorHomepage = lazy(() => import('./CursorHomepage'));
const GarageTab = lazy(() => import('../components/garage/GarageTab'));
const UnifiedMap = lazy(() => import('../components/map/UnifiedMap'));

type TabId = 'garage' | 'feed' | 'map';

const TABS: { id: TabId; label: string }[] = [
  { id: 'garage', label: 'Garage' },
  { id: 'feed', label: 'Feed' },
  { id: 'map', label: 'Map' },
];

const LS_KEY = 'nuke_hub_tab';

export default function HomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  const defaultTab = useMemo(() => {
    const fromUrl = searchParams.get('tab') as TabId | null;
    if (fromUrl && TABS.some(t => t.id === fromUrl)) return fromUrl;
    const fromStorage = localStorage.getItem(LS_KEY) as TabId | null;
    if (fromStorage && TABS.some(t => t.id === fromStorage)) return fromStorage;
    return user ? 'garage' : 'feed';
  }, []);

  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);

  useEffect(() => {
    if (authLoading) return;
    const fromUrl = searchParams.get('tab') as TabId | null;
    const fromStorage = localStorage.getItem(LS_KEY) as TabId | null;
    if (!fromUrl && !fromStorage) {
      setActiveTab(user ? 'garage' : 'feed');
    }
  }, [authLoading, user]);

  const switchTab = (tab: TabId) => {
    setActiveTab(tab);
    localStorage.setItem(LS_KEY, tab);
    setSearchParams(tab === 'garage' && user ? {} : { tab }, { replace: true });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 40px)' }}>
      {/* Tab bar — flush full-width strip */}
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        background: '#1a1a1a',
        flexShrink: 0,
        borderTop: '1px solid #333',
        borderBottom: '2px solid #000',
        height: 30,
      }}>
        {TABS.map(tab => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              style={{
                padding: '0 20px',
                fontSize: '11px',
                fontFamily: 'Arial, sans-serif',
                fontWeight: 600,
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
                border: 'none',
                borderBottom: active ? '2px solid #fff' : '2px solid transparent',
                background: active ? '#2a2a2a' : 'transparent',
                color: active ? '#fff' : '#999',
                cursor: 'pointer',
                transition: 'color 0.1s, background 0.1s',
                marginBottom: '-2px',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.color = '#bbb'; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.color = '#999'; }}
            >
              {tab.label}
            </button>
          );
        })}
        {/* Right-aligned external links */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '2px', paddingRight: '8px' }}>
          <Link to="/api" style={{
            padding: '0 12px', fontSize: '10px', fontFamily: 'Arial, sans-serif', fontWeight: 600,
            letterSpacing: '0.5px', textTransform: 'uppercase', textDecoration: 'none',
            color: '#7eb8da', cursor: 'pointer', display: 'flex', alignItems: 'center', height: '100%',
          }}>API</Link>
          <Link to="/developers" style={{
            padding: '0 12px', fontSize: '10px', fontFamily: 'Arial, sans-serif', fontWeight: 600,
            letterSpacing: '0.5px', textTransform: 'uppercase', textDecoration: 'none',
            color: '#7eb8da', cursor: 'pointer', display: 'flex', alignItems: 'center', height: '100%',
          }}>SDK</Link>
          <a href="https://www.npmjs.com/package/@nuke1/sdk" target="_blank" rel="noopener noreferrer" style={{
            padding: '0 12px', fontSize: '10px', fontFamily: 'Arial, sans-serif', fontWeight: 600,
            letterSpacing: '0.5px', textTransform: 'uppercase', textDecoration: 'none',
            color: '#7eb8da', cursor: 'pointer', display: 'flex', alignItems: 'center', height: '100%',
          }}>NPM</a>
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto', background: 'var(--white)' }}>
        <Suspense fallback={<div style={{ padding: 16, color: '#999', fontSize: '11px', fontFamily: 'Arial, sans-serif' }}>Loading...</div>}>
          {activeTab === 'garage' && <GarageTab />}
          {activeTab === 'feed' && <CursorHomepage />}
          {activeTab === 'map' && <UnifiedMap />}
        </Suspense>
      </div>
    </div>
  );
}
