import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface ScraperStatus {
  name: string;
  functionName: string;
  description: string;
  category: 'marketplace' | 'parts' | 'queue' | 'discovery';
  status: 'idle' | 'running' | 'error' | 'unknown';
  lastRun: string | null;
  lastResult?: {
    success: boolean;
    message?: string;
    stats?: any;
    error?: string;
  };
  queueStats?: {
    pending: number;
    processing: number;
    complete: number;
    failed: number;
  };
  canTrigger: boolean;
  config?: Record<string, any>;
}

interface SystemStats {
  recentVehicles: number;
  vehiclesLastHour: number;
  totalVehicles: number;
  queueHealth: {
    import: { pending: number; failed: number };
    cl: { pending: number; failed: number };
    bat: { pending: number; failed: number };
  };
}

const SCRAPERS: ScraperStatus[] = [
  {
    name: 'KSL Listings',
    functionName: 'scrape-ksl-listings',
    description: 'Scrape truck listings from KSL Cars',
    category: 'marketplace',
    status: 'unknown',
    lastRun: null,
    canTrigger: true,
    config: { searchUrl: '', maxListings: 20 }
  },
  {
    name: 'Craigslist Squarebodies',
    functionName: 'scrape-all-craigslist-squarebodies',
    description: 'Scrape squarebody trucks from Craigslist',
    category: 'marketplace',
    status: 'unknown',
    lastRun: null,
    canTrigger: true
  },
  {
    name: 'Craigslist 2000 & Older',
    functionName: 'scrape-all-craigslist-2000-and-older',
    description: 'Scrape pre-2000 vehicles from Craigslist',
    category: 'marketplace',
    status: 'unknown',
    lastRun: null,
    canTrigger: true
  },
  {
    name: 'Discover CL Squarebodies',
    functionName: 'discover-cl-squarebodies',
    description: 'Discover new Craigslist squarebody listings',
    category: 'discovery',
    status: 'unknown',
    lastRun: null,
    canTrigger: true,
    config: { max_regions: 10, max_searches_per_region: 5 }
  },
  {
    name: 'Process CL Queue',
    functionName: 'process-cl-queue',
    description: 'Process pending Craigslist listings',
    category: 'queue',
    status: 'unknown',
    lastRun: null,
    canTrigger: true,
    config: { batch_size: 10 }
  },
  {
    name: 'BaT Extraction',
    functionName: 'comprehensive-bat-extraction',
    description: 'Extract comprehensive data from Bring a Trailer listings',
    category: 'marketplace',
    status: 'unknown',
    lastRun: null,
    canTrigger: true
  },
  {
    name: 'Process BaT Queue',
    functionName: 'process-bat-extraction-queue',
    description: 'Process pending BaT extraction queue',
    category: 'queue',
    status: 'unknown',
    lastRun: null,
    canTrigger: true
  },
  {
    name: 'Process Import Queue',
    functionName: 'process-import-queue',
    description: 'Process vehicle import queue (priority and regular)',
    category: 'queue',
    status: 'unknown',
    lastRun: null,
    canTrigger: true,
    config: { priority_only: false, batch_size: 10 }
  },
  {
    name: 'LMC Parts',
    functionName: 'scrape-lmc-parts',
    description: 'Scrape parts from LMC Truck',
    category: 'parts',
    status: 'unknown',
    lastRun: null,
    canTrigger: true
  },
  {
    name: 'Generic Vehicle Scraper',
    functionName: 'scrape-vehicle',
    description: 'Generic vehicle scraper for any URL',
    category: 'marketplace',
    status: 'unknown',
    lastRun: null,
    canTrigger: true
  },
  {
    name: 'Re-extract Pending',
    functionName: 're-extract-pending-vehicles',
    description: 'Re-extract data for pending vehicles',
    category: 'queue',
    status: 'unknown',
    lastRun: null,
    canTrigger: true
  }
];

export default function ScraperDashboard() {
  const navigate = useNavigate();
  const [scrapers, setScrapers] = useState<ScraperStatus[]>(SCRAPERS);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [recentVehicles, setRecentVehicles] = useState<any[]>([]);

  useEffect(() => {
    loadStatus();
    
    if (autoRefresh) {
      const interval = setInterval(loadStatus, 10000); // Refresh every 10 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  async function loadStatus() {
    try {
      // Load system stats
      await loadSystemStats();
      
      // Load queue stats for queue processors
      const queueScrapers = scrapers.filter(s => s.category === 'queue');
      
      // Get CL queue stats
      const { data: clQueue } = await supabase
        .from('craigslist_listing_queue')
        .select('status');
      
      // Get import queue stats
      const { data: importQueue } = await supabase
        .from('import_queue')
        .select('status, priority');
      
      // Get BaT queue stats
      const { data: batQueue } = await supabase
        .from('bat_extraction_queue')
        .select('status')
        .limit(1000);

      setScrapers(prev => prev.map(scraper => {
        let queueStats;
        
        if (scraper.functionName === 'process-cl-queue' && clQueue) {
          queueStats = {
            pending: clQueue.filter((q: any) => q.status === 'pending').length,
            processing: clQueue.filter((q: any) => q.status === 'processing').length,
            complete: clQueue.filter((q: any) => q.status === 'complete').length,
            failed: clQueue.filter((q: any) => q.status === 'failed').length
          };
        } else if (scraper.functionName === 'process-import-queue' && importQueue) {
          queueStats = {
            pending: importQueue.filter((q: any) => q.status === 'pending').length,
            processing: importQueue.filter((q: any) => q.status === 'processing').length,
            complete: importQueue.filter((q: any) => q.status === 'complete').length,
            failed: importQueue.filter((q: any) => q.status === 'failed').length
          };
        } else if (scraper.functionName === 'process-bat-extraction-queue' && batQueue) {
          queueStats = {
            pending: batQueue.filter((q: any) => q.status === 'pending').length,
            processing: batQueue.filter((q: any) => q.status === 'processing').length,
            complete: batQueue.filter((q: any) => q.status === 'complete').length,
            failed: batQueue.filter((q: any) => q.status === 'failed').length
          };
        }

        return { ...scraper, queueStats };
      }));

      setLoading(false);
    } catch (error) {
      console.error('Error loading scraper status:', error);
      setLoading(false);
    }
  }

  async function loadSystemStats() {
    try {
      // Get recent vehicles (last 10)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      const { data: recent } = await supabase
        .from('vehicles')
        .select('id, created_at, origin_metadata, make, model, year')
        .order('created_at', { ascending: false })
        .limit(10);
      
      const { data: lastHour } = await supabase
        .from('vehicles')
        .select('id')
        .gte('created_at', oneHourAgo);
      
      const { data: lastDay } = await supabase
        .from('vehicles')
        .select('id')
        .gte('created_at', oneDayAgo);
      
      const { count: totalCount } = await supabase
        .from('vehicles')
        .select('*', { count: 'exact', head: true });
      
      // Get queue health
      const { data: importQueue } = await supabase
        .from('import_queue')
        .select('status');
      
      const { data: clQueue } = await supabase
        .from('craigslist_listing_queue')
        .select('status');
      
      const { data: batQueue } = await supabase
        .from('bat_extraction_queue')
        .select('status')
        .limit(1000);
      
      setSystemStats({
        recentVehicles: lastDay?.length || 0,
        vehiclesLastHour: lastHour?.length || 0,
        totalVehicles: totalCount || 0,
        queueHealth: {
          import: {
            pending: importQueue?.filter((q: any) => q.status === 'pending').length || 0,
            failed: importQueue?.filter((q: any) => q.status === 'failed').length || 0
          },
          cl: {
            pending: clQueue?.filter((q: any) => q.status === 'pending').length || 0,
            failed: clQueue?.filter((q: any) => q.status === 'failed').length || 0
          },
          bat: {
            pending: batQueue?.filter((q: any) => q.status === 'pending').length || 0,
            failed: batQueue?.filter((q: any) => q.status === 'failed').length || 0
          }
        }
      });
      
      setRecentVehicles(recent || []);
    } catch (error) {
      console.error('Error loading system stats:', error);
    }
  }

  async function triggerScraper(scraper: ScraperStatus) {
    if (!scraper.canTrigger || triggering) return;

    setTriggering(scraper.functionName);
    
    // Update status to running
    setScrapers(prev => prev.map(s => 
      s.functionName === scraper.functionName 
        ? { ...s, status: 'running', lastRun: new Date().toISOString() }
        : s
    ));
    
    try {
      const body = scraper.config || {};
      
      const { data, error } = await supabase.functions.invoke(scraper.functionName, {
        body
      });

      if (error) {
        throw error;
      }

      // Update with result
      setScrapers(prev => prev.map(s => 
        s.functionName === scraper.functionName 
          ? { 
              ...s, 
              status: data?.success === false ? 'error' : 'idle',
              lastRun: new Date().toISOString(),
              lastResult: {
                success: data?.success !== false,
                message: data?.message || data?.stats?.message,
                stats: data?.stats || data,
                error: data?.error || (data?.success === false ? 'Function returned error' : undefined)
              }
            }
          : s
      ));
      
      // Reload stats
      await loadSystemStats();
      await loadStatus();
      
    } catch (error: any) {
      console.error(`Error triggering ${scraper.name}:`, error);
      
      setScrapers(prev => prev.map(s => 
        s.functionName === scraper.functionName 
          ? { 
              ...s, 
              status: 'error',
              lastRun: new Date().toISOString(),
              lastResult: {
                success: false,
                error: error?.message || 'Failed to trigger scraper'
              }
            }
          : s
      ));
    } finally {
      setTriggering(null);
    }
  }

  const categories = {
    marketplace: 'MARKETPLACE SCRAPERS',
    parts: 'PARTS SCRAPERS',
    queue: 'QUEUE PROCESSORS',
    discovery: 'DISCOVERY SCRAPERS'
  };

  const groupedScrapers = scrapers.reduce((acc, scraper) => {
    if (!acc[scraper.category]) {
      acc[scraper.category] = [];
    }
    acc[scraper.category].push(scraper);
    return acc;
  }, {} as Record<string, ScraperStatus[]>);

  if (loading && scrapers[0].status === 'unknown') {
    return (
      <div style={{ padding: '48px', textAlign: 'center' }}>
        <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Loading scraper status...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1600px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <button
            onClick={() => navigate('/admin/mission-control')}
            style={{
              fontSize: '8pt',
              padding: '4px 8px',
              marginBottom: '8px',
              background: 'transparent',
              border: '1px solid #ccc',
              cursor: 'pointer'
            }}
          >
            ← Back to Mission Control
          </button>
          <h1 style={{ fontSize: '12pt', fontWeight: 700, marginBottom: '4px' }}>
            SCRAPER DASHBOARD
          </h1>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
            Monitor and trigger all scrapers • Real-time diagnostics
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <label style={{ fontSize: '8pt', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            Auto-refresh
          </label>
          <button
            onClick={loadStatus}
            className="button button-secondary cursor-button"
            style={{ fontSize: '8pt', padding: '8px 16px' }}
          >
            REFRESH NOW
          </button>
        </div>
      </div>

      {/* System Stats */}
      {systemStats && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '12px',
          marginBottom: '24px'
        }}>
          <div style={{
            border: '2px solid #e5e5e5',
            padding: '16px',
            background: 'var(--surface)'
          }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>VEHICLES (24H)</div>
            <div style={{ fontSize: '16pt', fontWeight: 700 }}>{systemStats.recentVehicles}</div>
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '4px' }}>
              {systemStats.vehiclesLastHour} in last hour
            </div>
          </div>
          
          <div style={{
            border: '2px solid #e5e5e5',
            padding: '16px',
            background: 'var(--surface)'
          }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>TOTAL VEHICLES</div>
            <div style={{ fontSize: '16pt', fontWeight: 700 }}>{systemStats.totalVehicles.toLocaleString()}</div>
          </div>
          
          <div style={{
            border: '2px solid #e5e5e5',
            padding: '16px',
            background: 'var(--surface)'
          }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>IMPORT QUEUE</div>
            <div style={{ fontSize: '16pt', fontWeight: 700, color: systemStats.queueHealth.import.pending > 0 ? '#f59e0b' : '#10b981' }}>
              {systemStats.queueHealth.import.pending}
            </div>
            {systemStats.queueHealth.import.failed > 0 && (
              <div style={{ fontSize: '7pt', color: '#ef4444', marginTop: '4px' }}>
                {systemStats.queueHealth.import.failed} failed
              </div>
            )}
          </div>
          
          <div style={{
            border: '2px solid #e5e5e5',
            padding: '16px',
            background: 'var(--surface)'
          }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>CL QUEUE</div>
            <div style={{ fontSize: '16pt', fontWeight: 700, color: systemStats.queueHealth.cl.pending > 0 ? '#f59e0b' : '#10b981' }}>
              {systemStats.queueHealth.cl.pending}
            </div>
            {systemStats.queueHealth.cl.failed > 0 && (
              <div style={{ fontSize: '7pt', color: '#ef4444', marginTop: '4px' }}>
                {systemStats.queueHealth.cl.failed} failed
              </div>
            )}
          </div>
          
          <div style={{
            border: '2px solid #e5e5e5',
            padding: '16px',
            background: 'var(--surface)'
          }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>BAT QUEUE</div>
            <div style={{ fontSize: '16pt', fontWeight: 700, color: systemStats.queueHealth.bat.pending > 0 ? '#f59e0b' : '#10b981' }}>
              {systemStats.queueHealth.bat.pending}
            </div>
            {systemStats.queueHealth.bat.failed > 0 && (
              <div style={{ fontSize: '7pt', color: '#ef4444', marginTop: '4px' }}>
                {systemStats.queueHealth.bat.failed} failed
              </div>
            )}
          </div>
        </div>
      )}

      {/* Recent Vehicles */}
      {recentVehicles.length > 0 && (
        <div style={{
          border: '2px solid #e5e5e5',
          padding: '16px',
          marginBottom: '24px',
          background: 'var(--surface)'
        }}>
          <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '12px' }}>RECENT VEHICLES</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
            {recentVehicles.slice(0, 6).map((v: any) => (
              <div key={v.id} style={{ fontSize: '7pt', padding: '8px', background: '#f5f5f5' }}>
                <div style={{ fontWeight: 600 }}>
                  {v.year} {v.make} {v.model}
                </div>
                <div style={{ color: 'var(--text-muted)', marginTop: '4px' }}>
                  {new Date(v.created_at).toLocaleString()}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '6pt', marginTop: '2px' }}>
                  {v.origin_metadata?.source || 'unknown'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scrapers by Category */}
      {Object.entries(categories).map(([category, title]) => {
        const categoryScrapers = groupedScrapers[category] || [];
        if (categoryScrapers.length === 0) return null;

        return (
          <div key={category} style={{ marginBottom: '32px' }}>
            <h2 style={{
              fontSize: '8pt',
              fontWeight: 700,
              marginBottom: '12px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              color: 'var(--text-muted)'
            }}>
              {title}
            </h2>
            
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))',
              gap: '12px'
            }}>
              {categoryScrapers.map((scraper) => (
                <div
                  key={scraper.functionName}
                  style={{
                    border: '2px solid #e5e5e5',
                    background: 'var(--surface)',
                    padding: '16px',
                    transition: 'all 0.12s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = '#000';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#e5e5e5';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  {/* Header */}
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{
                      fontSize: '10pt',
                      fontWeight: 700,
                      marginBottom: '4px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <span>{scraper.name}</span>
                      {scraper.status === 'running' && (
                        <span style={{ fontSize: '7pt', color: '#3b82f6' }}>RUNNING...</span>
                      )}
                      {scraper.status === 'error' && (
                        <span style={{ fontSize: '7pt', color: '#ef4444' }}>ERROR</span>
                      )}
                    </div>
                    <div style={{
                      fontSize: '8pt',
                      color: 'var(--text-muted)',
                      lineHeight: '1.4'
                    }}>
                      {scraper.description}
                    </div>
                  </div>

                  {/* Last Result */}
                  {scraper.lastResult && (
                    <div style={{
                      marginBottom: '12px',
                      padding: '8px',
                      background: scraper.lastResult.success ? '#f0fdf4' : '#fef2f2',
                      border: `1px solid ${scraper.lastResult.success ? '#10b981' : '#ef4444'}`,
                      fontSize: '7pt',
                      lineHeight: '1.4'
                    }}>
                      {scraper.lastResult.success ? (
                        <div>
                          <div style={{ fontWeight: 600, color: '#10b981', marginBottom: '4px' }}>SUCCESS</div>
                          {scraper.lastResult.message && (
                            <div style={{ color: '#065f46' }}>{scraper.lastResult.message}</div>
                          )}
                          {scraper.lastResult.stats && (
                            <div style={{ color: '#065f46', marginTop: '4px' }}>
                              {JSON.stringify(scraper.lastResult.stats, null, 2).slice(0, 200)}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontWeight: 600, color: '#ef4444', marginBottom: '4px' }}>ERROR</div>
                          <div style={{ color: '#991b1b' }}>{scraper.lastResult.error || 'Unknown error'}</div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Queue Stats */}
                  {scraper.queueStats && (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, 1fr)',
                      gap: '8px',
                      marginBottom: '12px',
                      padding: '8px',
                      background: '#f5f5f5',
                      fontSize: '8pt'
                    }}>
                      <div>
                        <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>PENDING</div>
                        <div style={{ fontWeight: 700, color: '#f59e0b' }}>
                          {scraper.queueStats.pending}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>PROCESSING</div>
                        <div style={{ fontWeight: 700, color: '#3b82f6' }}>
                          {scraper.queueStats.processing}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>COMPLETE</div>
                        <div style={{ fontWeight: 700, color: '#10b981' }}>
                          {scraper.queueStats.complete}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>FAILED</div>
                        <div style={{ fontWeight: 700, color: '#ef4444' }}>
                          {scraper.queueStats.failed}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => triggerScraper(scraper)}
                      disabled={!scraper.canTrigger || triggering === scraper.functionName}
                      className="button button-primary cursor-button"
                      style={{
                        flex: 1,
                        fontSize: '8pt',
                        padding: '8px',
                        opacity: (!scraper.canTrigger || triggering === scraper.functionName) ? 0.5 : 1,
                        cursor: (!scraper.canTrigger || triggering === scraper.functionName) ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {triggering === scraper.functionName ? 'TRIGGERING...' : 'TRIGGER NOW'}
                    </button>
                  </div>

                  {/* Function Name & Last Run */}
                  <div style={{
                    marginTop: '8px',
                    fontSize: '7pt',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    justifyContent: 'space-between'
                  }}>
                    <span style={{ fontFamily: 'monospace' }}>{scraper.functionName}</span>
                    {scraper.lastRun && (
                      <span>{new Date(scraper.lastRun).toLocaleTimeString()}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Info Box */}
      <div style={{
        marginTop: '32px',
        padding: '16px',
        border: '2px solid #e5e5e5',
        background: '#f9f9f9',
        fontSize: '8pt',
        lineHeight: '1.6'
      }}>
        <div style={{ fontWeight: 700, marginBottom: '8px' }}>DIAGNOSTICS</div>
        <div>
          • <strong>Why aren't vehicles being created?</strong> Check last result for each scraper - common reasons: duplicates (already exist), validation errors, or missing required fields<br/>
          • <strong>Queue processors</strong> show real-time stats - high "failed" counts indicate issues<br/>
          • <strong>Recent vehicles</strong> shows if the system is actively creating profiles<br/>
          • <strong>System stats</strong> show overall health - 0 vehicles in 24h means scrapers aren't working<br/>
          • Check Supabase Edge Function logs for detailed execution status and errors
        </div>
      </div>
    </div>
  );
}
