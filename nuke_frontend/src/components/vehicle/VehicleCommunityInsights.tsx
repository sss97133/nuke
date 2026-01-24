import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { MessageCircle, TrendingUp, AlertTriangle, Star, Quote, DollarSign } from 'lucide-react';
import '../../design-system.css';

interface VehicleCommunityInsightsProps {
  vehicleId: string;
}

interface SentimentDiscovery {
  overall_sentiment: 'positive' | 'negative' | 'mixed' | 'neutral';
  sentiment_score: number;
  themes: Array<{ theme: string; frequency: number; sentiment: string }>;
  notable_quotes: string[];
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

  useEffect(() => {
    loadDiscoveries();
  }, [vehicleId]);

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
      <div className="card" style={{ border: '1px solid #c0c0c0', padding: '16px' }}>
        <div style={{ textAlign: 'center', color: '#666', fontSize: '10pt' }}>
          No community insights available yet.
          <div style={{ fontSize: '8pt', marginTop: '4px' }}>
            Insights are generated from auction comments, forum discussions, and social media.
          </div>
        </div>
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

            {/* Themes */}
            {sentimentData.themes && sentimentData.themes.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>
                  Key Themes
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {sentimentData.themes.slice(0, 6).map((theme, i) => (
                    <div key={i} style={{
                      background: '#f3f4f6',
                      border: '1px solid #e5e7eb',
                      padding: '4px 8px',
                      borderRadius: '2px',
                      fontSize: '8pt',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      <span style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: getSentimentColor(theme.sentiment)
                      }} />
                      <span>{theme.theme}</span>
                      <span style={{ color: '#9ca3af' }}>({theme.frequency})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Red Flags */}
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
                  {sentimentData.red_flags.slice(0, 3).map((flag, i) => (
                    <div key={i} style={{
                      fontSize: '8pt',
                      color: '#991b1b',
                      marginBottom: i < sentimentData.red_flags.length - 1 ? '4px' : 0
                    }}>
                      • {flag}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Highlights */}
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
                  {sentimentData.highlights.slice(0, 4).map((highlight, i) => (
                    <div key={i} style={{
                      fontSize: '8pt',
                      color: '#166534',
                      marginBottom: i < Math.min(sentimentData.highlights.length, 4) - 1 ? '4px' : 0
                    }}>
                      ✓ {highlight}
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
