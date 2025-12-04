import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';

type ExpandedSection = 'tier1' | 'catalog' | 'vehicles' | 'auctions' | null;

export default function SystemStatus() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<any>(null);
  const [recentImages, setRecentImages] = useState<any[]>([]);
  const [recentParts, setRecentParts] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [expandedSection, setExpandedSection] = useState<ExpandedSection>(null);
  const [listData, setListData] = useState<any[]>([]);
  const [selectedImage, setSelectedImage] = useState<any>(null);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 2000); // Fast refresh
    return () => clearInterval(interval);
  }, []);

  const loadListData = async (section: ExpandedSection) => {
    if (!section) return;
    
    try {
      if (section === 'tier1') {
        const { data } = await supabase
          .from('vehicle_images')
          .select('id, image_url, ai_processing_status, ai_scan_metadata, created_at')
          .order('created_at', { ascending: false })
          .limit(100);
        setListData(data || []);
      } else if (section === 'catalog') {
        const { data } = await supabase
          .from('catalog_parts')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);
        setListData(data || []);
      } else if (section === 'vehicles') {
        const { data } = await supabase
          .from('vehicles')
          .select('id, year, make, model, status, created_at')
          .order('created_at', { ascending: false })
          .limit(100);
        setListData(data || []);
      } else if (section === 'auctions') {
        const { data } = await supabase
          .from('auction_events')
          .select('id, listing_url, outcome, high_bid, created_at')
          .order('created_at', { ascending: false })
          .limit(100);
        setListData(data || []);
      }
    } catch (error) {
      console.error('Error loading list:', error);
    }
  };

  const handlePanelClick = (section: ExpandedSection) => {
    if (expandedSection === section) {
      setExpandedSection(null);
      setListData([]);
    } else {
      setExpandedSection(section);
      loadListData(section);
    }
  };

  async function loadStats() {
    try {
      // Get image counts
      const { count: totalImages } = await supabase
        .from('vehicle_images')
        .select('*', { count: 'exact', head: true });

      const { count: analyzedImages } = await supabase
        .from('vehicle_images')
        .select('*', { count: 'exact', head: true })
        .eq('ai_processing_status', 'completed');

      const { count: pendingImages } = await supabase
        .from('vehicle_images')
        .select('*', { count: 'exact', head: true })
        .eq('ai_processing_status', 'pending');

      const { count: failedImages } = await supabase
        .from('vehicle_images')
        .select('*', { count: 'exact', head: true })
        .eq('ai_processing_status', 'failed');

      // Get catalog counts
      const { count: totalParts } = await supabase
        .from('catalog_parts')
        .select('*', { count: 'exact', head: true });

      const { count: chunksDone } = await supabase
        .from('catalog_text_chunks')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'completed');

      const { count: chunksPending } = await supabase
        .from('catalog_text_chunks')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      // Get vehicle counts
      const { count: totalVehicles } = await supabase
        .from('vehicles')
        .select('*', { count: 'exact', head: true });

      const { count: activeVehicles } = await supabase
        .from('vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');

      const { count: pendingVehicles } = await supabase
        .from('vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      // Get recent analyzed images
      const { data: recent } = await supabase
        .from('vehicle_images')
        .select('id, ai_processing_completed_at, ai_scan_metadata')
        .eq('ai_processing_status', 'completed')
        .order('ai_processing_completed_at', { ascending: false })
        .limit(10);

      // Get recent catalog parts
      const { data: recentCatalog } = await supabase
        .from('catalog_parts')
        .select('part_number, name, price_current, created_at')
        .order('created_at', { ascending: false })
        .limit(5);

      // Get auction stats
      const { count: totalAuctions } = await supabase
        .from('auction_events')
        .select('*', { count: 'exact', head: true });

      const { count: totalComments } = await supabase
        .from('auction_comments')
        .select('*', { count: 'exact', head: true });

      setStats({
        images: { 
          total: totalImages || 0, 
          analyzed: analyzedImages || 0, 
          pending: pendingImages || 0, 
          failed: failedImages || 0 
        },
        catalog: { 
          total_parts: totalParts || 0, 
          chunks_done: chunksDone || 0, 
          chunks_pending: chunksPending || 0 
        },
        vehicles: { 
          total: totalVehicles || 0, 
          active: activeVehicles || 0, 
          pending: pendingVehicles || 0 
        },
        auctions: {
          total: totalAuctions || 0,
          comments: totalComments || 0
        },
        lastUpdate: new Date().toLocaleTimeString()
      });
      
      setRecentImages(recent || []);
      setRecentParts(recentCatalog || []);
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  }

  if (!stats) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#888' }}>
        Loading system status...
      </div>
    );
  }

  const imagePercent = (stats.images.analyzed / stats.images.total * 100) || 0;

  return (
    <div style={{ padding: '16px', maxWidth: '1400px', margin: '0 auto', background: '#fff', minHeight: '100vh' }}>
      
      {/* Header */}
      <div style={{ marginBottom: '16px', borderBottom: '2px solid #000', paddingBottom: '8px' }}>
        <h1 style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          ADMIN SYSTEM STATUS
        </h1>
        <p style={{ fontSize: '8pt', color: '#666' }}>
          Updates every 2s • Last: {stats.lastUpdate}
        </p>
      </div>

      {/* Main Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '16px' }}>
        
        {/* Tier 1 Analysis */}
        <div 
          onClick={() => handlePanelClick('tier1')}
          style={{ 
            background: expandedSection === 'tier1' ? '#e0e0e0' : '#f8f8f8', 
            border: '2px solid #000', 
            padding: '12px',
            cursor: 'pointer'
          }}
        >
          <div style={{ fontSize: '8pt', fontWeight: 700, letterSpacing: '0.5px', marginBottom: '8px', textTransform: 'uppercase' }}>
            TIER 1 ANALYSIS {expandedSection === 'tier1' ? '▼' : '▶'}
          </div>
          <div style={{ fontSize: '16pt', fontWeight: 700, marginBottom: '4px', fontFamily: 'monospace' }}>
            {stats.images.analyzed.toLocaleString()}
          </div>
          <div style={{ fontSize: '8pt', color: '#666', marginBottom: '8px' }}>
            of {stats.images.total.toLocaleString()} images
          </div>
          <div style={{ height: '8px', background: '#e0e0e0', border: '1px solid #000', overflow: 'hidden', marginBottom: '8px' }}>
            <div style={{
              width: `${imagePercent}%`,
              height: '100%',
              background: '#000',
              transition: 'width 0.5s ease'
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8pt' }}>
            <span style={{ fontWeight: 700 }}>{imagePercent.toFixed(1)}%</span>
            <span style={{ color: '#666' }}>
              {stats.images.pending.toLocaleString()} pending
            </span>
          </div>
          {stats.images.failed > 0 && (
            <div style={{ marginTop: '4px', fontSize: '8pt', color: '#ef4444' }}>
              {stats.images.failed} failed
            </div>
          )}
        </div>

        {/* LMC Catalog */}
        <div 
          onClick={() => handlePanelClick('catalog')}
          style={{ 
            background: expandedSection === 'catalog' ? '#e0e0e0' : '#f8f8f8', 
            border: '2px solid #000', 
            padding: '12px',
            cursor: 'pointer'
          }}
        >
          <div style={{ fontSize: '8pt', fontWeight: 700, letterSpacing: '0.5px', marginBottom: '8px', textTransform: 'uppercase' }}>
            LMC CATALOG {expandedSection === 'catalog' ? '▼' : '▶'}
          </div>
          <div style={{ fontSize: '16pt', fontWeight: 700, marginBottom: '4px', fontFamily: 'monospace' }}>
            {stats.catalog.total_parts.toLocaleString()}
          </div>
          <div style={{ fontSize: '8pt', color: '#666', marginBottom: '8px' }}>
            parts indexed
          </div>
          <div style={{ fontSize: '8pt', marginBottom: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ color: '#666' }}>Chunks done:</span>
              <span style={{ fontWeight: 700 }}>{stats.catalog.chunks_done}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#666' }}>Chunks pending:</span>
              <span style={{ fontWeight: 700 }}>{stats.catalog.chunks_pending}</span>
            </div>
          </div>
        </div>

        {/* Vehicles */}
        <div 
          onClick={() => handlePanelClick('vehicles')}
          style={{ 
            background: expandedSection === 'vehicles' ? '#e0e0e0' : '#f8f8f8', 
            border: '2px solid #000', 
            padding: '12px',
            cursor: 'pointer'
          }}
        >
          <div style={{ fontSize: '8pt', fontWeight: 700, letterSpacing: '0.5px', marginBottom: '8px', textTransform: 'uppercase' }}>
            VEHICLES {expandedSection === 'vehicles' ? '▼' : '▶'}
          </div>
          <div style={{ fontSize: '16pt', fontWeight: 700, marginBottom: '4px', fontFamily: 'monospace' }}>
            {stats.vehicles.active.toLocaleString()}
          </div>
          <div style={{ fontSize: '8pt', color: '#666', marginBottom: '8px' }}>
            active vehicles
          </div>
          <div style={{ fontSize: '8pt' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ color: '#666' }}>Total:</span>
              <span style={{ fontWeight: 700 }}>{stats.vehicles.total.toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#666' }}>Pending:</span>
              <span style={{ fontWeight: 700 }}>{stats.vehicles.pending.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Auctions */}
        <div 
          onClick={() => handlePanelClick('auctions')}
          style={{ 
            background: expandedSection === 'auctions' ? '#e0e0e0' : '#f8f8f8', 
            border: '2px solid #000', 
            padding: '12px',
            cursor: 'pointer'
          }}
        >
          <div style={{ fontSize: '8pt', fontWeight: 700, letterSpacing: '0.5px', marginBottom: '8px', textTransform: 'uppercase' }}>
            AUCTION DATA {expandedSection === 'auctions' ? '▼' : '▶'}
          </div>
          <div style={{ fontSize: '16pt', fontWeight: 700, marginBottom: '4px', fontFamily: 'monospace' }}>
            {stats.auctions.comments.toLocaleString()}
          </div>
          <div style={{ fontSize: '8pt', color: '#666', marginBottom: '8px' }}>
            comments analyzed
          </div>
          <div style={{ fontSize: '8pt' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#666' }}>Auctions:</span>
              <span style={{ fontWeight: 700 }}>{stats.auctions.total.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded List View */}
      {expandedSection && (
        <div style={{ marginBottom: '16px', background: '#fff', border: '2px solid #000', padding: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <h3 style={{ fontSize: '8pt', fontWeight: 700, textTransform: 'uppercase' }}>
              {expandedSection === 'tier1' && 'ALL IMAGES'}
              {expandedSection === 'catalog' && 'ALL CATALOG PARTS'}
              {expandedSection === 'vehicles' && 'ALL VEHICLES'}
              {expandedSection === 'auctions' && 'ALL AUCTIONS'}
            </h3>
            <button 
              onClick={() => setExpandedSection(null)}
              style={{ fontSize: '8pt', fontWeight: 700, border: '1px solid #000', background: '#fff', padding: '4px 8px', cursor: 'pointer' }}
            >
              CLOSE
            </button>
          </div>
          <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid #ccc' }}>
            {listData.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', fontSize: '8pt', color: '#999' }}>Loading...</div>
            ) : (
              <table style={{ width: '100%', fontSize: '8pt', borderCollapse: 'collapse' }}>
                <tbody>
                  {listData.map((item, idx) => (
                    <tr 
                      key={item.id || idx} 
                      style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }}
                      onClick={() => {
                        if (expandedSection === 'tier1') setSelectedImage(item);
                        if (expandedSection === 'vehicles') navigate(`/vehicle/${item.id}`);
                        if (expandedSection === 'auctions') window.open(item.listing_url, '_blank');
                      }}
                    >
                      {expandedSection === 'tier1' && (
                        <>
                          <td style={{ padding: '6px', fontFamily: 'monospace', color: '#666' }}>{item.id.substring(0, 8)}</td>
                          <td style={{ padding: '6px' }}>{item.ai_processing_status || 'pending'}</td>
                          <td style={{ padding: '6px' }}>{item.ai_scan_metadata?.tier_1_analysis?.category || 'unknown'}</td>
                          <td style={{ padding: '6px' }}>{item.ai_scan_metadata?.tier_1_analysis?.angle || 'unknown'}</td>
                        </>
                      )}
                      {expandedSection === 'catalog' && (
                        <>
                          <td style={{ padding: '6px', fontFamily: 'monospace' }}>{item.part_number}</td>
                          <td style={{ padding: '6px' }}>{item.name || 'No name'}</td>
                          <td style={{ padding: '6px', fontSize: '7pt', color: '#666' }}>{item.category || 'Uncategorized'}</td>
                          <td style={{ padding: '6px', fontSize: '7pt', color: '#666' }}>
                            {item.year_start && item.year_end ? `${item.year_start}-${item.year_end}` : 'N/A'}
                          </td>
                          <td style={{ padding: '6px', fontWeight: 700 }}>${item.price_current?.toFixed(2) || '0.00'}</td>
                          <td style={{ padding: '6px', textAlign: 'center' }}>
                            {item.product_image_url ? '✓' : '—'}
                          </td>
                        </>
                      )}
                      {expandedSection === 'vehicles' && (
                        <>
                          <td style={{ padding: '6px' }}>{item.year} {item.make} {item.model}</td>
                          <td style={{ padding: '6px' }}>{item.status}</td>
                          <td style={{ padding: '6px', color: '#999' }}>{new Date(item.created_at).toLocaleDateString()}</td>
                        </>
                      )}
                      {expandedSection === 'auctions' && (
                        <>
                          <td style={{ padding: '6px', fontFamily: 'monospace', fontSize: '8pt' }}>{item.id.substring(0, 8)}</td>
                          <td style={{ padding: '6px' }}>{item.outcome || 'unknown'}</td>
                          <td style={{ padding: '6px' }}>${item.high_bid?.toLocaleString() || 'N/A'}</td>
                          <td style={{ padding: '6px', color: '#999' }}>{new Date(item.created_at).toLocaleDateString()}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Two Column Recent Activity */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
        
        {/* Recent Tier 1 Analysis */}
        <div style={{ background: '#f8f8f8', border: '2px solid #000', padding: '12px' }}>
          <h2 style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Recent Tier 1 Analysis
          </h2>
          <div style={{ display: 'grid', gap: '6px' }}>
            {recentImages.slice(0, 8).map((img, idx) => {
              const secondsAgo = img.ai_processing_completed_at 
                ? Math.floor((Date.now() - new Date(img.ai_processing_completed_at).getTime()) / 1000)
                : 0;
              const timeAgo = secondsAgo < 60 ? `${secondsAgo}s` : `${Math.floor(secondsAgo / 60)}m`;
              const category = img.ai_scan_metadata?.tier_1_analysis?.category || 'unknown';
              const angle = img.ai_scan_metadata?.tier_1_analysis?.angle || 'unknown';

              return (
                <div 
                  key={img.id}
                  onClick={() => setSelectedImage(img)}
                  style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    padding: '6px',
                    background: '#fff',
                    border: '1px solid #ccc',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <div style={{ 
                      fontSize: '8pt', 
                      fontFamily: 'monospace', 
                      color: '#666'
                    }}>
                      {img.id.substring(0, 8)}
                    </div>
                    <div style={{ fontSize: '8pt', fontWeight: 600 }}>
                      {category}
                    </div>
                    <div style={{ fontSize: '8pt', color: '#666' }}>
                      {angle}
                    </div>
                  </div>
                  <div style={{ fontSize: '8pt', color: '#999' }}>
                    {timeAgo}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Catalog Parts */}
        <div style={{ background: '#f8f8f8', border: '2px solid #000', padding: '12px' }}>
          <h2 style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Recent Catalog Parts
          </h2>
          <div style={{ display: 'grid', gap: '6px' }}>
            {recentParts.slice(0, 8).map((part, idx) => {
              const secondsAgo = part.created_at 
                ? Math.floor((Date.now() - new Date(part.created_at).getTime()) / 1000)
                : 0;
              const timeAgo = secondsAgo < 60 ? `${secondsAgo}s` : `${Math.floor(secondsAgo / 60)}m`;

              return (
                <div 
                  key={idx}
                  style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    padding: '6px',
                    background: '#fff',
                    border: '1px solid #ccc'
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div style={{ 
                      fontSize: '8pt', 
                      fontFamily: 'monospace', 
                      fontWeight: 600
                    }}>
                      {part.part_number}
                    </div>
                    <div style={{ fontSize: '8pt', color: '#666' }}>
                      {part.name?.substring(0, 30) || 'No name'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                    <div style={{ fontSize: '8pt', fontWeight: 700 }}>
                      ${part.price_current?.toFixed(2) || 'N/A'}
                    </div>
                    <div style={{ fontSize: '8pt', color: '#999' }}>
                      {timeAgo}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div style={{ display: 'flex', gap: '8px', borderTop: '2px solid #000', paddingTop: '12px' }}>
        <button 
          onClick={() => navigate('/')}
          style={{ 
            padding: '8px 16px', 
            background: '#000', 
            color: '#fff', 
            fontWeight: 700,
            fontSize: '8pt',
            border: '2px solid #000',
            cursor: 'pointer'
          }}
        >
          VEHICLES
        </button>
        <button 
          onClick={() => navigate('/admin/scripts')}
          style={{ 
            padding: '8px 16px', 
            background: '#fff', 
            color: '#000', 
            fontWeight: 700,
            fontSize: '8pt',
            border: '2px solid #000',
            cursor: 'pointer'
          }}
        >
          SCRIPTS
        </button>
        <button 
          onClick={() => navigate('/admin/image-processing')}
          style={{ 
            padding: '8px 16px', 
            background: '#fff', 
            color: '#000', 
            fontWeight: 700,
            fontSize: '8pt',
            border: '2px solid #000',
            cursor: 'pointer'
          }}
        >
          IMAGES
        </button>
        <button 
          onClick={() => navigate('/admin/verifications')}
          style={{ 
            padding: '8px 16px', 
            background: '#fff', 
            color: '#000', 
            fontWeight: 700,
            fontSize: '8pt',
            border: '2px solid #000',
            cursor: 'pointer'
          }}
        >
          VERIFY
        </button>
      </div>

      {/* Image Detail Modal */}
      {selectedImage && (
        <div 
          onClick={() => setSelectedImage(null)}
          style={{ 
            position: 'fixed', 
            top: 0, 
            left: 0, 
            right: 0, 
            bottom: 0, 
            background: 'rgba(0,0,0,0.8)', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            zIndex: 9999
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{ 
              background: '#fff', 
              border: '2px solid #000', 
              padding: '16px', 
              maxWidth: '800px',
              maxHeight: '90vh',
              overflow: 'auto'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
              <h3 style={{ fontSize: '8pt', fontWeight: 700 }}>IMAGE ANALYSIS</h3>
              <button 
                onClick={() => setSelectedImage(null)}
                style={{ fontSize: '8pt', border: '1px solid #000', background: '#fff', padding: '4px 8px', cursor: 'pointer' }}
              >
                CLOSE
              </button>
            </div>
            
            {selectedImage.image_url && (
              <img 
                src={selectedImage.image_url} 
                alt="Vehicle" 
                style={{ width: '100%', maxHeight: '400px', objectFit: 'contain', marginBottom: '12px', border: '1px solid #ccc' }}
              />
            )}

            <div style={{ fontSize: '8pt', marginBottom: '8px' }}>
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>ID:</div>
              <div style={{ fontFamily: 'monospace', color: '#666' }}>{selectedImage.id}</div>
            </div>

            <div style={{ fontSize: '8pt', marginBottom: '8px' }}>
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>STATUS:</div>
              <div>{selectedImage.ai_processing_status || 'pending'}</div>
            </div>

            {selectedImage.ai_scan_metadata?.tier_1_analysis && (
              <>
                <div style={{ fontSize: '8pt', marginBottom: '8px' }}>
                  <div style={{ fontWeight: 700, marginBottom: '4px' }}>CATEGORY:</div>
                  <div>{selectedImage.ai_scan_metadata.tier_1_analysis.category || 'unknown'}</div>
                </div>

                <div style={{ fontSize: '8pt', marginBottom: '8px' }}>
                  <div style={{ fontWeight: 700, marginBottom: '4px' }}>ANGLE:</div>
                  <div>{selectedImage.ai_scan_metadata.tier_1_analysis.angle || 'unknown'}</div>
                </div>

                {selectedImage.ai_scan_metadata.tier_1_analysis.components && (
                  <div style={{ fontSize: '8pt' }}>
                    <div style={{ fontWeight: 700, marginBottom: '4px' }}>COMPONENTS:</div>
                    <div>{selectedImage.ai_scan_metadata.tier_1_analysis.components.join(', ')}</div>
                  </div>
                )}
              </>
            )}

            {!selectedImage.ai_scan_metadata?.tier_1_analysis && (
              <div style={{ fontSize: '8pt', color: '#999', fontStyle: 'italic' }}>No analysis data yet</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

