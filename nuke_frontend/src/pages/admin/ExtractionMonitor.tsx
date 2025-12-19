/**
 * Extraction Monitor - Admin Page
 * Real-time monitoring of batch image extraction progress
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';
import { ImageHoverPreview } from '../../components/admin/ImageHoverPreview';
import { AnalysisModelPopup } from '../../components/admin/AnalysisModelPopup';

const ExtractionMonitor: React.FC = () => {
  const [stats, setStats] = useState({
    total: 0,
    extracted: 0,
    failed: 0,
    skipped: 0,
    inProgress: 0,
    models: [] as string[],
    recentFailures: [] as any[]
  });
  const [recentExtractions, setRecentExtractions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [notifications, setNotifications] = useState<Array<{
    id: string;
    type: 'error' | 'warning' | 'info';
    message: string;
    timestamp: Date;
  }>>([]);
  const [previousFailureCount, setPreviousFailureCount] = useState(0);

  const addNotification = (type: 'error' | 'warning' | 'info', message: string) => {
    const id = Math.random().toString(36).substring(7);
    setNotifications(prev => [...prev, { id, type, message, timestamp: new Date() }]);
    
    // Auto-remove after 10 seconds for errors/warnings, 5 seconds for info
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, type === 'error' || type === 'warning' ? 10000 : 5000);
  };

  useEffect(() => {
    loadStats();
    
    if (autoRefresh) {
      const interval = setInterval(loadStats, 5000); // Refresh every 5 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const loadStats = async () => {
    try {
      // OPTIMIZED: Run all queries in parallel, only fetch what we need
      const [totalResult, extractedResult, unextractedResult] = await Promise.allSettled([
        // Total count only
        supabase
          .from('vehicle_images')
          .select('id', { count: 'exact', head: true })
          .not('is_document', 'is', true)
          .not('image_url', 'is', null),
        
        // Recent extracted images only (limit to 100 for performance)
        supabase
          .from('vehicle_images')
          .select('ai_scan_metadata, id, image_url, created_at, vehicle_id')
          .not('is_document', 'is', true)
          .not('image_url', 'is', null)
          .not('ai_scan_metadata', 'is', null)
          .order('created_at', { ascending: false })
          .limit(100),
        
        // Recent unextracted images only (limit to 50)
        supabase
          .from('vehicle_images')
          .select('id, image_url, created_at, vehicle_id, ai_scan_metadata')
          .not('is_document', 'is', true)
          .not('image_url', 'is', null)
          .or('ai_scan_metadata.is.null,ai_scan_metadata.eq.{}')
          .order('created_at', { ascending: false })
          .limit(50)
      ]);

      const totalCount = totalResult.status === 'fulfilled' ? totalResult.value.count : 0;
      const extractedImages = extractedResult.status === 'fulfilled' ? (extractedResult.value.data || []) : [];
      const unextractedImages = unextractedResult.status === 'fulfilled' ? (unextractedResult.value.data || []) : [];

      // Count by model
      const modelCounts = new Map<string, number>();
      const models = new Set<string>();
      let extracted = 0;
      
      extractedImages?.forEach(img => {
        const metadata = img.ai_scan_metadata || {};
        if (metadata.extractions) {
          extracted++;
          Object.keys(metadata.extractions).forEach(model => {
            models.add(model);
            modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
          });
        } else if (metadata.appraiser) {
          // Backward compatibility - count as extracted
          extracted++;
        }
      });

      // Identify potential failures (images that should have been extracted but weren't)
      // These are images created more than 1 hour ago without extractions
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const potentialFailures = (unextractedImages || [])
        .filter(img => {
          const createdAt = new Date(img.created_at);
          const oneHourAgoDate = new Date(oneHourAgo);
          return createdAt < oneHourAgoDate; // Older than 1 hour
        })
        .slice(0, 20) // Recent 20 potential failures
        .map(img => ({
          id: img.id,
          image_url: img.image_url,
          created_at: img.created_at,
          vehicle_id: img.vehicle_id,
          reason: 'No extraction found (older than 1 hour)'
        }));

      // Get recent extractions (last 20)
      const recent = extractedImages
        ?.filter(img => {
          const meta = img.ai_scan_metadata || {};
          return meta.extractions || meta.appraiser;
        })
        .sort((a, b) => {
          const aTime = a.ai_scan_metadata?.last_extracted_at || a.created_at;
          const bTime = b.ai_scan_metadata?.last_extracted_at || b.created_at;
          return new Date(bTime).getTime() - new Date(aTime).getTime();
        })
        .slice(0, 20) || [];

      const currentFailureCount = potentialFailures.length;
      
      // Check if failure count increased (new failures detected)
      if (currentFailureCount > previousFailureCount && previousFailureCount > 0) {
        const newFailures = currentFailureCount - previousFailureCount;
        addNotification('error', `${newFailures} new extraction failure${newFailures > 1 ? 's' : ''} detected`);
      }
      
      // Check for rate limit issues (if failure rate is high)
      const total = totalCount || 0;
      const failureRate = total > 0 ? (currentFailureCount / total) * 100 : 0;
      
      // Show warning if failure rate is high and we have recent failures
      if (failureRate > 10 && currentFailureCount > 10) {
        const hasRecentFailures = potentialFailures.some(f => {
          const age = Date.now() - new Date(f.created_at).getTime();
          return age < 60 * 60 * 1000; // Within last hour
        });
        if (hasRecentFailures && !notifications.some(n => n.message.includes('rate limit'))) {
          addNotification('warning', 'High failure rate - Possible API rate limits (HTTP 429)');
        }
      }
      
      // Show success notification when extractions complete
      const prevExtracted = stats.extracted;
      if (prevExtracted > 0 && extracted > prevExtracted && extracted > 0) {
        const newExtractions = extracted - prevExtracted;
        if (newExtractions > 0 && newExtractions < 10) { // Only notify for small batches to avoid spam
          addNotification('info', `${newExtractions} image${newExtractions > 1 ? 's' : ''} extracted successfully`);
        }
      }
      
      setStats({
        total: totalCount || 0,
        extracted,
        failed: currentFailureCount,
        skipped: 0,
        inProgress: (totalCount || 0) - extracted,
        models: Array.from(models),
        recentFailures: potentialFailures
      });
      setRecentExtractions(recent);
      setPreviousFailureCount(currentFailureCount);
      setLoading(false);
    } catch (error) {
      console.error('Error loading stats:', error);
      setLoading(false);
    }
  };

  const getExtractionInfo = (image: any) => {
    const metadata = image.ai_scan_metadata || {};
    if (metadata.extractions) {
      const models = Object.keys(metadata.extractions);
      const latest = models.reduce((latest, model) => {
        const extracted = metadata.extractions[model];
        if (!latest || new Date(extracted.extracted_at) > new Date(latest.extracted_at)) {
          return extracted;
        }
        return latest;
      }, null);
      return {
        angle: latest?.angle || 'unknown',
        model: latest?.model || 'unknown',
        extractedAt: latest?.extracted_at,
        models: models
      };
    } else if (metadata.appraiser) {
      return {
        angle: metadata.appraiser.angle || 'unknown',
        model: metadata.appraiser.model || 'unknown',
        extractedAt: metadata.appraiser.analyzed_at || metadata.last_extracted_at,
        models: []
      };
    }
    return null;
  };

  const progressPercent = stats.total > 0 
    ? Math.round((stats.extracted / stats.total) * 100) 
    : 0;

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div>Loading extraction stats...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Notifications */}
      <div style={{
        position: 'fixed',
        top: '16px',
        right: '16px',
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        maxWidth: '400px'
      }}>
        {notifications.map((notification, index) => {
          const colors = {
            error: { bg: '#fee2e2', border: '#ef4444', text: '#991b1b' },
            warning: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e' },
            info: { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' }
          }[notification.type];
          
          return (
            <div
              key={notification.id}
              style={{
                background: colors.bg,
                border: `2px solid ${colors.border}`,
                borderRadius: '4px',
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '11px',
                color: colors.text,
                fontWeight: 600,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                animation: 'slideInRight 0.2s ease',
                cursor: 'pointer',
                maxWidth: '400px'
              }}
              onClick={() => setNotifications(prev => prev.filter(n => n.id !== notification.id))}
            >
              <span style={{ fontSize: '14px', fontWeight: 700 }}>
                {notification.type === 'error' ? '✕' : notification.type === 'warning' ? '⚠' : 'ℹ'}
              </span>
              <span style={{ flex: 1 }}>{notification.message}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setNotifications(prev => prev.filter(n => n.id !== notification.id));
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: colors.text,
                  cursor: 'pointer',
                  fontSize: '12px',
                  padding: '0 4px',
                  opacity: 0.7,
                  fontWeight: 700
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {/* Critical Alert Banner */}
      {stats.failed > 20 && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.15)',
          border: '2px solid #ef4444',
          padding: '16px',
          borderRadius: '4px',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <span style={{ fontSize: '20px', fontWeight: 700, color: '#ef4444' }}>⚠</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#ef4444', marginBottom: '4px' }}>
              High Failure Rate Detected
            </div>
            <div style={{ fontSize: '11px', opacity: 0.9 }}>
              {stats.failed} images failed extraction. This may indicate API rate limits (429 errors) or other issues.
              Check the failures section below for details.
            </div>
          </div>
        </div>
      )}

      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '32px',
        borderBottom: '2px solid rgba(255,255,255,0.2)',
        paddingBottom: '16px'
      }}>
        <h1 style={{ 
          fontSize: '24px', 
          fontWeight: 'bold',
          fontFamily: 'Arial, sans-serif',
          textTransform: 'uppercase',
          letterSpacing: '2px'
        }}>
          Image Extraction Monitor
        </h1>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            style={{ width: '18px', height: '18px' }}
          />
          <span style={{ fontSize: '12px', textTransform: 'uppercase' }}>Auto Refresh</span>
        </label>
      </div>

      {/* Stats Grid */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '16px',
        marginBottom: '32px'
      }}>
        <div style={{
          background: 'rgba(255,255,255,0.05)',
          border: '2px solid rgba(255,255,255,0.2)',
          padding: '20px',
          borderRadius: '4px'
        }}>
          <div style={{ fontSize: '12px', textTransform: 'uppercase', opacity: 0.7, marginBottom: '8px' }}>
            Total Images
          </div>
          <div style={{ fontSize: '32px', fontWeight: 'bold' }}>
            {stats.total.toLocaleString()}
          </div>
        </div>

        <div style={{
          background: 'rgba(34, 197, 94, 0.1)',
          border: '2px solid rgba(34, 197, 94, 0.3)',
          padding: '20px',
          borderRadius: '4px'
        }}>
          <div style={{ fontSize: '12px', textTransform: 'uppercase', opacity: 0.7, marginBottom: '8px' }}>
            Extracted
          </div>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#22c55e' }}>
            {stats.extracted.toLocaleString()}
          </div>
          <div style={{ fontSize: '12px', marginTop: '4px', opacity: 0.7 }}>
            {progressPercent}%
          </div>
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.05)',
          border: '2px solid rgba(255,255,255,0.2)',
          padding: '20px',
          borderRadius: '4px'
        }}>
          <div style={{ fontSize: '12px', textTransform: 'uppercase', opacity: 0.7, marginBottom: '8px' }}>
            In Progress
          </div>
          <div style={{ fontSize: '32px', fontWeight: 'bold' }}>
            {stats.inProgress.toLocaleString()}
          </div>
        </div>

        {stats.failed > 0 && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '2px solid rgba(239, 68, 68, 0.3)',
            padding: '20px',
            borderRadius: '4px'
          }}>
            <div style={{ fontSize: '12px', textTransform: 'uppercase', opacity: 0.7, marginBottom: '8px' }}>
              Potential Failures
            </div>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#ef4444' }}>
              {stats.failed.toLocaleString()}
            </div>
            <div style={{ fontSize: '10px', marginTop: '4px', opacity: 0.7 }}>
              No extraction found
            </div>
          </div>
        )}

        <div style={{
          background: 'rgba(255,255,255,0.05)',
          border: '2px solid rgba(255,255,255,0.2)',
          padding: '20px',
          borderRadius: '4px'
        }}>
          <div style={{ fontSize: '12px', textTransform: 'uppercase', opacity: 0.7, marginBottom: '8px' }}>
            Models Used
          </div>
          <div style={{ fontSize: '32px', fontWeight: 'bold' }}>
            {stats.models.length}
          </div>
          <div style={{ fontSize: '8pt', marginTop: '4px', color: 'var(--text-muted)' }}>
            {stats.models.length > 0 ? (
              stats.models.map((model, idx) => (
                <React.Fragment key={model}>
                  <AnalysisModelPopup modelName={model}>
                    {model}
                  </AnalysisModelPopup>
                  {idx < stats.models.length - 1 && ', '}
                </React.Fragment>
              ))
            ) : (
              'No models used yet'
            )}
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          marginBottom: '8px',
          fontSize: '12px',
          textTransform: 'uppercase'
        }}>
          <span>Progress</span>
          <span>{stats.extracted} / {stats.total} ({progressPercent}%)</span>
        </div>
        <div style={{
          width: '100%',
          height: '8px',
          background: 'rgba(255,255,255,0.1)',
          borderRadius: '4px',
          overflow: 'hidden'
        }}>
          <div style={{
            width: `${progressPercent}%`,
            height: '100%',
            background: '#22c55e',
            transition: 'width 0.3s ease'
          }} />
        </div>
      </div>

      {/* Recent Extractions */}
      <div>
        <h2 style={{ 
          fontSize: '16px', 
          fontWeight: 'bold',
          textTransform: 'uppercase',
          marginBottom: '16px',
          letterSpacing: '1px'
        }}>
          Recent Extractions
        </h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '12px'
        }}>
          {recentExtractions.map((image) => {
            const info = getExtractionInfo(image);
            if (!info) return null;
            
            return (
              <div key={image.id} style={{
                background: 'rgba(255,255,255,0.05)',
                border: '2px solid rgba(255,255,255,0.2)',
                padding: '12px',
                borderRadius: '4px',
                fontSize: '11px'
              }}>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between',
                  marginBottom: '8px'
                }}>
                  <span style={{ 
                    textTransform: 'uppercase', 
                    fontWeight: 'bold',
                    color: '#22c55e'
                  }}>
                    {info.angle}
                  </span>
                  <span style={{ opacity: 0.7 }}>
                    <AnalysisModelPopup modelName={info.model}>
                      {info.model}
                    </AnalysisModelPopup>
                  </span>
                </div>
                <div style={{ 
                  fontSize: '8pt', 
                  color: 'var(--text-muted)',
                  marginTop: '4px',
                  wordBreak: 'break-all'
                }}>
                  <ImageHoverPreview
                    imageUrl={image.image_url}
                    imageId={image.id}
                    vehicleId={image.vehicle_id}
                  >
                    {image.id.substring(0, 8)}...
                  </ImageHoverPreview>
                </div>
                {info.models.length > 1 && (
                  <div style={{ 
                    fontSize: '9px', 
                    opacity: 0.7,
                    marginTop: '4px',
                    color: '#3b82f6'
                  }}>
                    {info.models.length} models: {info.models.join(', ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Failures Section */}
      {stats.recentFailures.length > 0 && (
        <div style={{ marginTop: '32px' }}>
          <h2 style={{ 
            fontSize: '16px', 
            fontWeight: 'bold',
            textTransform: 'uppercase',
            marginBottom: '16px',
            letterSpacing: '1px',
            color: '#ef4444'
          }}>
            ⚠️ Potential Failures ({stats.recentFailures.length})
          </h2>
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '2px solid rgba(239, 68, 68, 0.3)',
            padding: '16px',
            borderRadius: '4px',
            marginBottom: '16px'
          }}>
            <div style={{ fontSize: '11px', marginBottom: '12px', opacity: 0.8 }}>
              Images older than 1 hour without extractions. These may have failed or are still pending.
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: '12px'
            }}>
              {stats.recentFailures.map((failure) => (
                <div key={failure.id} style={{
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  padding: '12px',
                  borderRadius: '4px',
                  fontSize: '11px'
                }}>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between',
                    marginBottom: '8px'
                  }}>
                    <span style={{ 
                      textTransform: 'uppercase', 
                      fontWeight: 'bold',
                      color: '#ef4444',
                      fontSize: '10px'
                    }}>
                      No Extraction
                    </span>
                    <span style={{ opacity: 0.7, fontSize: '9px' }}>
                      {new Date(failure.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div style={{ 
                    fontSize: '8pt', 
                    color: 'var(--text-muted)',
                    marginTop: '4px',
                    wordBreak: 'break-all',
                    fontFamily: 'monospace'
                  }}>
                    <ImageHoverPreview
                      imageUrl={failure.image_url}
                      imageId={failure.id}
                      vehicleId={failure.vehicle_id}
                    >
                      {failure.id.substring(0, 8)}...
                    </ImageHoverPreview>
                  </div>
                  {failure.vehicle_id && (
                    <div style={{ marginTop: '4px' }}>
                      <a 
                        href={`/vehicle/${failure.vehicle_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ 
                          fontSize: '9px', 
                          color: '#3b82f6',
                          textDecoration: 'underline'
                        }}
                      >
                        View Vehicle →
                      </a>
                    </div>
                  )}
                  <div style={{ 
                    fontSize: '9px', 
                    opacity: 0.7,
                    marginTop: '4px',
                    color: '#f59e0b'
                  }}>
                    {failure.reason}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ 
        marginTop: '32px', 
        padding: '16px',
        background: 'rgba(255,255,255,0.05)',
        border: '2px solid rgba(255,255,255,0.2)',
        borderRadius: '4px',
        fontSize: '11px',
        opacity: 0.7
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>💡 Info</div>
        <div>Extractions are indexed by model name in <code>ai_scan_metadata.extractions</code></div>
        <div style={{ marginTop: '4px' }}>
          Use <code>scripts/compare-extractions.js</code> to compare different model results
        </div>
        {stats.failed > 0 && (
          <div style={{ marginTop: '8px', padding: '8px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '4px' }}>
            <div style={{ fontWeight: 'bold', color: '#ef4444', marginBottom: '4px' }}>⚠️ Failures Detected</div>
            <div>Some images may have failed extraction. Check the failures section above for details.</div>
            <div style={{ marginTop: '4px', fontSize: '10px' }}>
              Common causes: Rate limits (429), API errors, or images still processing.
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
};

export default ExtractionMonitor;

