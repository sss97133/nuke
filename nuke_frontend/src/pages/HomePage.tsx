import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { usePageTitle } from '../hooks/usePageTitle';

const CursorHomepage = lazy(() => import('./CursorHomepage'));
const GarageTab = lazy(() => import('../components/garage/GarageTab'));
const UnifiedMap = lazy(() => import('../components/map/UnifiedMap'));

type TabId = 'garage' | 'feed' | 'map';

const TABS: { id: TabId; label: string }[] = [
  { id: 'feed', label: 'Feed' },
  { id: 'garage', label: 'Garage' },
  { id: 'map', label: 'Map' },
];

const LS_KEY = 'nuke_hub_tab';

function LandingHero({ onBrowse }: { onBrowse: () => void }) {
  const navigate = useNavigate();
  usePageTitle('Nuke');

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 'calc(100vh - 80px)',
      padding: '40px 24px',
      background: '#111',
      color: '#e5e7eb',
      fontFamily: 'Arial, sans-serif',
    }}>
      {/* Hero */}
      <div style={{ textAlign: 'center', maxWidth: 640, marginBottom: 48 }}>
        <h1 style={{
          fontSize: 'clamp(32px, 6vw, 56px)',
          fontWeight: 700,
          letterSpacing: '-0.03em',
          lineHeight: 1.1,
          margin: '0 0 16px',
          color: '#fff',
        }}>
          Nuke
        </h1>
        <p style={{
          fontSize: 'clamp(14px, 2.5vw, 18px)',
          lineHeight: 1.6,
          color: '#9ca3af',
          margin: '0 0 8px',
          fontWeight: 500,
        }}>
          Vehicle Provenance Engine
        </p>
        <p style={{
          fontSize: 'clamp(12px, 2vw, 15px)',
          lineHeight: 1.7,
          color: '#6b7280',
          margin: '0 0 32px',
          maxWidth: 480,
          marginLeft: 'auto',
          marginRight: 'auto',
        }}>
          The definitive digital identity for every collector vehicle.
          Market analytics, valuation estimates, and deal scoring across
          hundreds of thousands of cars.
        </p>

        {/* CTAs */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => navigate('/signup')}
            style={{
              padding: '10px 28px',
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              border: '2px solid #fff',
              background: '#fff',
              color: '#111',
              cursor: 'pointer',
            }}
          >
            Get Started
          </button>
          <button
            onClick={onBrowse}
            style={{
              padding: '10px 28px',
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              border: '2px solid #444',
              background: 'transparent',
              color: '#9ca3af',
              cursor: 'pointer',
            }}
          >
            Browse Feed
          </button>
        </div>
      </div>

      {/* Feature grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 1,
        maxWidth: 720,
        width: '100%',
        background: '#222',
        border: '1px solid #333',
      }}>
        {[
          { title: 'Vehicle Identity', desc: 'Canonical profiles built from every data source — auction results, service records, photos, VIN decodes.' },
          { title: 'Market Data', desc: 'Real-time pricing across BaT, eBay, Craigslist, Hagerty, and dozens more platforms.' },
          { title: 'Deal Scoring', desc: 'Instant valuation estimates and deal scores so you know if a listing is priced right.' },
          { title: 'API & SDK', desc: 'Programmatic access to vehicle data. Build your own tools on top of the Nuke dataset.' },
        ].map((feature) => (
          <div key={feature.title} style={{
            padding: '20px 16px',
            background: '#1a1a1a',
          }}>
            <div style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              color: '#e5e7eb',
              marginBottom: 6,
            }}>
              {feature.title}
            </div>
            <div style={{
              fontSize: 11,
              lineHeight: 1.5,
              color: '#6b7280',
            }}>
              {feature.desc}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom links */}
      <div style={{
        marginTop: 32,
        display: 'flex',
        gap: 16,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
      }}>
        <Link to="/api" style={{ color: '#6b7280', textDecoration: 'none' }}>API</Link>
        <Link to="/developers" style={{ color: '#6b7280', textDecoration: 'none' }}>SDK</Link>
        <Link to="/about" style={{ color: '#6b7280', textDecoration: 'none' }}>About</Link>
        <Link to="/search" style={{ color: '#6b7280', textDecoration: 'none' }}>Search</Link>
      </div>
    </div>
  );
}

export default function HomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [showFeed, setShowFeed] = useState(false);

  const defaultTab = useMemo(() => {
    const fromUrl = searchParams.get('tab') as TabId | null;
    if (fromUrl && TABS.some(t => t.id === fromUrl)) return fromUrl;
    const fromStorage = localStorage.getItem(LS_KEY) as TabId | null;
    if (fromStorage && TABS.some(t => t.id === fromStorage)) return fromStorage;
    return 'feed';
  }, []);

  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);

  useEffect(() => {
    if (authLoading) return;
    const fromUrl = searchParams.get('tab') as TabId | null;
    const fromStorage = localStorage.getItem(LS_KEY) as TabId | null;
    if (!fromUrl && !fromStorage) {
      setActiveTab('feed');
    }
    // If URL has ?tab=... and user is logged out, show the feed directly
    if (!user && fromUrl) {
      setShowFeed(true);
    }
  }, [authLoading, user]);

  const switchTab = (tab: TabId) => {
    setActiveTab(tab);
    localStorage.setItem(LS_KEY, tab);
    setSearchParams(tab === 'garage' && user ? {} : { tab }, { replace: true });
  };

  // Logged-out users with no explicit tab request see the landing page
  if (!authLoading && !user && !showFeed) {
    return <LandingHero onBrowse={() => setShowFeed(true)} />;
  }

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
