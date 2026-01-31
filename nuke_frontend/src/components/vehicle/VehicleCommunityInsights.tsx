import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { MessageCircle, TrendingUp, AlertTriangle, Star, Quote, DollarSign, X, Wrench, Search, ExternalLink, Sparkles, Loader2 } from 'lucide-react';
import '../../design-system.css';

// Issue detail popup for red flags and highlights
interface IssuePopupProps {
  issue: string;
  type: 'concern' | 'highlight';
  vehicleId: string;
  onClose: () => void;
}

const IssuePopup = ({ issue, type, vehicleId, onClose }: IssuePopupProps) => {
  const isConcern = type === 'concern';

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
      padding: '20px'
    }} onClick={onClose}>
      <div
        className="card"
        style={{
          maxWidth: '400px',
          width: '100%',
          maxHeight: '80vh',
          overflow: 'auto'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="card-header" style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {isConcern ? <AlertTriangle size={14} color="var(--error)" /> : <Star size={14} color="var(--success)" />}
            <span style={{ fontSize: '10pt', fontWeight: 700 }}>
              {isConcern ? 'Concern' : 'Highlight'}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              cursor: 'pointer',
              padding: '2px 6px',
              fontSize: '8pt'
            }}
          >
            ✕
          </button>
        </div>

        {/* Issue Text */}
        <div style={{
          padding: 'var(--space-3)',
          borderBottom: '1px solid var(--border)',
          background: isConcern ? 'var(--upload-red-light)' : 'var(--upload-green-light)'
        }}>
          <div style={{ fontSize: '10pt', fontWeight: 500, color: 'var(--text)' }}>{issue}</div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
            From community discussion
          </div>
        </div>

        {/* Actions for Concerns */}
        {isConcern && (
          <div style={{ padding: 'var(--space-3)' }}>
            <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '8px', color: 'var(--text)' }}>
              Solutions
            </div>

            {/* Parts Search */}
            <a
              href={`https://www.google.com/search?q=${encodeURIComponent(issue + ' parts price')}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 8px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                marginBottom: '6px',
                cursor: 'pointer',
                textDecoration: 'none',
                color: 'var(--text)'
              }}
            >
              <Search size={12} />
              <span style={{ flex: 1, fontSize: '8pt' }}>Search Parts Pricing</span>
              <ExternalLink size={10} color="var(--text-muted)" />
            </a>

            {/* Forum Search */}
            <a
              href={`https://www.google.com/search?q=${encodeURIComponent(issue + ' fix forum')}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 8px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                marginBottom: '6px',
                cursor: 'pointer',
                textDecoration: 'none',
                color: 'var(--text)'
              }}
            >
              <MessageCircle size={12} />
              <span style={{ flex: 1, fontSize: '8pt' }}>Forum Discussions</span>
              <ExternalLink size={10} color="var(--text-muted)" />
            </a>

            {/* Get Quote */}
            <button
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 8px',
                background: 'var(--primary)',
                border: '1px solid var(--primary)',
                cursor: 'pointer',
                color: 'white',
                width: '100%',
                fontSize: '8pt',
                fontWeight: 600
              }}
              onClick={() => alert('Repair network coming soon')}
            >
              <Wrench size={12} />
              <span>Get Repair Quote</span>
            </button>

            <div style={{ marginTop: '8px', fontSize: '7pt', color: 'var(--text-disabled)', textAlign: 'center' }}>
              Technician network coming soon
            </div>
          </div>
        )}

        {/* Verification for Highlights */}
        {!isConcern && (
          <div style={{ padding: 'var(--space-3)' }}>
            <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '8px', color: 'var(--text)' }}>
              Verification
            </div>
            <div style={{
              padding: '8px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              fontSize: '8pt',
              color: 'var(--text-muted)'
            }}>
              Owner verification coming soon.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface VehicleCommunityInsightsProps {
  vehicleId: string;
}

interface SentimentDiscovery {
  overall_sentiment: 'positive' | 'negative' | 'mixed' | 'neutral';
  sentiment_score: number;
  // Supports both simple strings (from Ollama batch) and rich objects (from Claude)
  themes: Array<string | { theme: string; frequency: number; sentiment: string }>;
  notable_quotes?: string[];
  red_flags: string[];
  highlights: string[];
  confidence: number;
}

interface MarketSignalsDiscovery {
  price_mentions: Array<{ amount: number; context: string; source_type: string }>;
  comparisons: Array<{ vehicle: string; relationship: string; price_diff: string }>;
  market_trend: 'rising' | 'stable' | 'falling' | 'unclear';
  demand_indicators: string[];
  value_factors: Array<{ factor: string; impact: 'positive' | 'negative' | 'neutral'; weight: number }>;
  confidence: number;
}

interface DiscoveryRecord {
  id: string;
  discovery_type: string;
  observation_count: number;
  source_categories: string[];
  confidence_score: number;
  discovered_at: string;
  raw_extraction: SentimentDiscovery | MarketSignalsDiscovery;
}

const VehicleCommunityInsights = ({ vehicleId }: VehicleCommunityInsightsProps) => {
  const [sentimentData, setSentimentData] = useState<SentimentDiscovery | null>(null);
  const [marketData, setMarketData] = useState<MarketSignalsDiscovery | null>(null);
  const [observationCount, setObservationCount] = useState(0);
  const [sourceCategories, setSourceCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [discoveredAt, setDiscoveredAt] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<{ issue: string; type: 'concern' | 'highlight' } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatingProgress, setGeneratingProgress] = useState(0);

  useEffect(() => {
    loadDiscoveries();
  }, [vehicleId]);

  const generateInsights = async () => {
    setGenerating(true);
    setGeneratingProgress(0);

    // Simulate progress for UX (actual process takes 30-60s)
    const progressInterval = setInterval(() => {
      setGeneratingProgress(prev => {
        if (prev >= 90) return prev;
        return prev + Math.random() * 15;
      });
    }, 3000);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/discover-from-observations`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            vehicle_id: vehicleId,
            discovery_types: ['sentiment', 'market_signals'],
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate insights');
      }

      setGeneratingProgress(100);

      // Reload the discoveries
      await loadDiscoveries();
    } catch (error) {
      console.error('Error generating insights:', error);
      alert('Failed to generate insights. Make sure there are observations for this vehicle.');
    } finally {
      clearInterval(progressInterval);
      setGenerating(false);
      setGeneratingProgress(0);
    }
  };

  const loadDiscoveries = async () => {
    try {
      setLoading(true);

      // Get latest discoveries for this vehicle
      const { data: discoveries, error } = await supabase
        .from('observation_discoveries')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('discovered_at', { ascending: false })
        .limit(10);

      if (error) throw error;

      if (discoveries && discoveries.length > 0) {
        // Find sentiment and market signal discoveries
        const sentiment = discoveries.find((d: DiscoveryRecord) => d.discovery_type === 'sentiment');
        const market = discoveries.find((d: DiscoveryRecord) => d.discovery_type === 'market_signals');

        if (sentiment) {
          setSentimentData(sentiment.raw_extraction as SentimentDiscovery);
          setObservationCount(sentiment.observation_count);
          setSourceCategories(sentiment.source_categories || []);
          setDiscoveredAt(sentiment.discovered_at);
        }

        if (market) {
          setMarketData(market.raw_extraction as MarketSignalsDiscovery);
        }
      }
    } catch (error) {
      console.error('Error loading community insights:', error);
    } finally {
      setLoading(false);
    }
  };

  const getSentimentColor = (sentiment: string): string => {
    switch (sentiment) {
      case 'positive':
      case 'very positive':
        return '#16a34a';
      case 'negative':
      case 'very negative':
        return '#dc2626';
      case 'mixed':
        return '#ca8a04';
      default:
        return '#6b7280';
    }
  };

  const getTrendLabel = (trend: string) => {
    switch (trend) {
      case 'rising': return 'Rising';
      case 'falling': return 'Falling';
      case 'stable': return 'Stable';
      default: return 'Unclear';
    }
  };

  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  if (loading) {
    return (
      <div className="card" style={{ border: '1px solid #c0c0c0', padding: '16px' }}>
        <div style={{ textAlign: 'center', color: '#666', fontSize: '10pt' }}>
          Loading community insights...
        </div>
      </div>
    );
  }

  if (!sentimentData && !marketData) {
    return (
      <div
        className="card"
        onClick={!generating ? generateInsights : undefined}
        style={{
          border: '1px solid #c0c0c0',
          padding: '16px',
          cursor: generating ? 'wait' : 'pointer',
          transition: 'all 0.2s ease',
          background: generating ? '#f9fafb' : undefined,
        }}
        onMouseEnter={(e) => !generating && (e.currentTarget.style.borderColor = '#3b82f6')}
        onMouseLeave={(e) => !generating && (e.currentTarget.style.borderColor = '#c0c0c0')}
      >
        {generating ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '12px' }}>
              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} color="#3b82f6" />
              <span style={{ fontSize: '10pt', fontWeight: 600, color: '#3b82f6' }}>
                Generating Insights...
              </span>
            </div>
            <div style={{
              height: '4px',
              background: '#e5e7eb',
              borderRadius: '2px',
              overflow: 'hidden',
              marginBottom: '8px'
            }}>
              <div style={{
                height: '100%',
                width: `${generatingProgress}%`,
                background: '#3b82f6',
                transition: 'width 0.5s ease',
                borderRadius: '2px'
              }} />
            </div>
            <div style={{ fontSize: '8pt', color: '#666' }}>
              Analyzing auction comments, forum discussions, and social media...
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: '#666', fontSize: '10pt' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '4px' }}>
              <Sparkles size={14} color="#3b82f6" />
              <span>No community insights available yet.</span>
            </div>
            <div style={{ fontSize: '8pt', marginTop: '4px' }}>
              Insights are generated from auction comments, forum discussions, and social media.
            </div>
            <div style={{
              marginTop: '12px',
              padding: '6px 12px',
              background: '#3b82f6',
              color: 'white',
              borderRadius: '2px',
              fontSize: '8pt',
              fontWeight: 600,
              display: 'inline-block'
            }}>
              Click to Generate
            </div>
          </div>
        )}
        <style>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header with source info */}
      <div style={{ fontSize: '8pt', color: '#666', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>
          Based on {observationCount} observations from {sourceCategories.join(', ')}
        </span>
        {discoveredAt && (
          <span>
            Analyzed {new Date(discoveredAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Sentiment Analysis Card */}
      {sentimentData && (
        <div className="card" style={{ border: '1px solid #c0c0c0', overflow: 'hidden' }}>
          <div style={{
            background: 'var(--bg)',
            borderBottom: '1px solid #c0c0c0',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MessageCircle size={14} />
              <span style={{ fontWeight: 600, fontSize: '10pt' }}>Community Sentiment</span>
            </div>
            <div style={{
              background: getSentimentColor(sentimentData.overall_sentiment),
              color: 'white',
              padding: '2px 8px',
              borderRadius: '2px',
              fontSize: '9pt',
              fontWeight: 600
            }}>
              {sentimentData.overall_sentiment.toUpperCase()}
            </div>
          </div>

          <div style={{ padding: '12px' }}>
            {/* Sentiment Score Bar */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8pt', color: '#666', marginBottom: '4px' }}>
                <span>Negative</span>
                <span>Score: {(sentimentData.sentiment_score * 100).toFixed(0)}%</span>
                <span>Positive</span>
              </div>
              <div style={{
                height: '8px',
                background: '#e5e7eb',
                borderRadius: '4px',
                overflow: 'hidden',
                position: 'relative'
              }}>
                <div style={{
                  position: 'absolute',
                  left: '50%',
                  width: '2px',
                  height: '100%',
                  background: '#9ca3af'
                }} />
                <div style={{
                  position: 'absolute',
                  left: `${50 + (sentimentData.sentiment_score * 50)}%`,
                  transform: 'translateX(-50%)',
                  width: '12px',
                  height: '12px',
                  background: getSentimentColor(sentimentData.overall_sentiment),
                  borderRadius: '50%',
                  top: '-2px',
                  border: '2px solid white',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                }} />
              </div>
            </div>

            {/* Themes - handles both string[] and {theme,frequency,sentiment}[] formats */}
            {sentimentData.themes && sentimentData.themes.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>
                  Key Themes
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {sentimentData.themes.slice(0, 6).map((theme, i) => {
                    // Handle both string and object formats
                    const themeText = typeof theme === 'string' ? theme : theme.theme;
                    const themeSentiment = typeof theme === 'string' ? 'neutral' : theme.sentiment;
                    const themeFreq = typeof theme === 'string' ? null : theme.frequency;

                    return (
                      <div key={i} style={{
                        background: '#f3f4f6',
                        border: '1px solid #e5e7eb',
                        padding: '4px 8px',
                        borderRadius: '2px',
                        fontSize: '8pt',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        cursor: 'pointer'
                      }}
                      onClick={() => console.log('Theme clicked:', themeText)}
                      >
                        <span style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          background: getSentimentColor(themeSentiment)
                        }} />
                        <span>{themeText}</span>
                        {themeFreq && <span style={{ color: '#9ca3af' }}>({themeFreq})</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Red Flags - clickable for repair/quote flow */}
            {sentimentData.red_flags && sentimentData.red_flags.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{
                  fontSize: '9pt',
                  fontWeight: 600,
                  marginBottom: '8px',
                  color: '#dc2626',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  <AlertTriangle size={12} />
                  Concerns Raised
                </div>
                <div style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '2px',
                  padding: '8px'
                }}>
                  {sentimentData.red_flags.slice(0, 5).map((flag, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: '8pt',
                        color: '#991b1b',
                        marginBottom: i < Math.min(sentimentData.red_flags.length, 5) - 1 ? '4px' : 0,
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '2px 4px',
                        borderRadius: '2px',
                        transition: 'background 0.1s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#fee2e2'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      onClick={() => setSelectedIssue({ issue: flag, type: 'concern' })}
                    >
                      <span>• {flag}</span>
                      <span style={{ fontSize: '7pt', color: '#b91c1c', opacity: 0.7 }}>Get Quote →</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Highlights - clickable to verify/add proof */}
            {sentimentData.highlights && sentimentData.highlights.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{
                  fontSize: '9pt',
                  fontWeight: 600,
                  marginBottom: '8px',
                  color: '#16a34a',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  <Star size={12} />
                  Highlights
                </div>
                <div style={{
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: '2px',
                  padding: '8px'
                }}>
                  {sentimentData.highlights.slice(0, 5).map((highlight, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: '8pt',
                        color: '#166534',
                        marginBottom: i < Math.min(sentimentData.highlights.length, 5) - 1 ? '4px' : 0,
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '2px 4px',
                        borderRadius: '2px',
                        transition: 'background 0.1s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#dcfce7'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      onClick={() => setSelectedIssue({ issue: highlight, type: 'highlight' })}
                    >
                      <span>✓ {highlight}</span>
                      <span style={{ fontSize: '7pt', color: '#15803d', opacity: 0.7 }}>Verify →</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Notable Quotes */}
            {sentimentData.notable_quotes && sentimentData.notable_quotes.length > 0 && (
              <div>
                <div style={{
                  fontSize: '9pt',
                  fontWeight: 600,
                  marginBottom: '8px',
                  color: '#374151',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  <Quote size={12} />
                  Notable Quotes
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {sentimentData.notable_quotes.slice(0, 3).map((quote, i) => (
                    <div key={i} style={{
                      background: '#f9fafb',
                      borderLeft: '3px solid #3b82f6',
                      padding: '8px 12px',
                      fontSize: '8pt',
                      color: '#4b5563',
                      fontStyle: 'italic'
                    }}>
                      "{quote}"
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Confidence */}
            <div style={{
              marginTop: '12px',
              paddingTop: '12px',
              borderTop: '1px solid #e5e7eb',
              fontSize: '8pt',
              color: '#9ca3af',
              textAlign: 'right'
            }}>
              Analysis confidence: {(sentimentData.confidence * 100).toFixed(0)}%
            </div>
          </div>
        </div>
      )}

      {/* Issue Detail Popup */}
      {selectedIssue && (
        <IssuePopup
          issue={selectedIssue.issue}
          type={selectedIssue.type}
          vehicleId={vehicleId}
          onClose={() => setSelectedIssue(null)}
        />
      )}

      {/* Market Signals Card */}
      {marketData && (
        <div className="card" style={{ border: '1px solid #c0c0c0', overflow: 'hidden' }}>
          <div style={{
            background: 'var(--bg)',
            borderBottom: '1px solid #c0c0c0',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TrendingUp size={14} />
              <span style={{ fontWeight: 600, fontSize: '10pt' }}>Market Signals</span>
            </div>
            <div style={{
              background: marketData.market_trend === 'rising' ? '#16a34a' :
                         marketData.market_trend === 'falling' ? '#dc2626' : '#6b7280',
              color: 'white',
              padding: '2px 8px',
              borderRadius: '2px',
              fontSize: '9pt',
              fontWeight: 600
            }}>
              {getTrendLabel(marketData.market_trend)}
            </div>
          </div>

          <div style={{ padding: '12px' }}>
            {/* Price Mentions */}
            {marketData.price_mentions && marketData.price_mentions.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{
                  fontSize: '9pt',
                  fontWeight: 600,
                  marginBottom: '8px',
                  color: '#374151',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  <DollarSign size={12} />
                  Price Discussions
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {marketData.price_mentions.slice(0, 4).map((mention, i) => (
                    <div key={i} style={{
                      background: '#f0f9ff',
                      border: '1px solid #bae6fd',
                      borderRadius: '2px',
                      padding: '6px 10px',
                      fontSize: '8pt'
                    }}>
                      <div style={{ fontWeight: 'bold', fontFamily: 'monospace', color: '#0369a1' }}>
                        {formatCurrency(mention.amount)}
                      </div>
                      <div style={{ color: '#64748b', fontSize: '7pt' }}>
                        {mention.source_type}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Value Factors */}
            {marketData.value_factors && marketData.value_factors.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>
                  Value Factors
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {marketData.value_factors.slice(0, 5).map((factor, i) => (
                    <div key={i} style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '4px 8px',
                      background: factor.impact === 'positive' ? '#f0fdf4' :
                                 factor.impact === 'negative' ? '#fef2f2' : '#f9fafb',
                      border: `1px solid ${factor.impact === 'positive' ? '#bbf7d0' :
                              factor.impact === 'negative' ? '#fecaca' : '#e5e7eb'}`,
                      borderRadius: '2px',
                      fontSize: '8pt'
                    }}>
                      <span style={{
                        color: factor.impact === 'positive' ? '#166534' :
                               factor.impact === 'negative' ? '#991b1b' : '#4b5563'
                      }}>
                        {factor.impact === 'positive' ? '↑' : factor.impact === 'negative' ? '↓' : '→'} {factor.factor}
                      </span>
                      <span style={{
                        fontWeight: 600,
                        color: '#9ca3af'
                      }}>
                        {(factor.weight * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Demand Indicators */}
            {marketData.demand_indicators && marketData.demand_indicators.length > 0 && (
              <div>
                <div style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>
                  Demand Indicators
                </div>
                <div style={{
                  background: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: '2px',
                  padding: '8px'
                }}>
                  {marketData.demand_indicators.slice(0, 4).map((indicator, i) => (
                    <div key={i} style={{
                      fontSize: '8pt',
                      color: '#4b5563',
                      marginBottom: i < Math.min(marketData.demand_indicators.length, 4) - 1 ? '4px' : 0
                    }}>
                      • {indicator}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Confidence */}
            <div style={{
              marginTop: '12px',
              paddingTop: '12px',
              borderTop: '1px solid #e5e7eb',
              fontSize: '8pt',
              color: '#9ca3af',
              textAlign: 'right'
            }}>
              Analysis confidence: {(marketData.confidence * 100).toFixed(0)}%
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VehicleCommunityInsights;
