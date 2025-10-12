import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface TagWebData {
  label_counts: Record<string, number>;
  confidence_scores: Record<string, number[]>;
  relationships: Record<string, string[]>;
  categories: Record<string, string[]>;
  total_detections: number;
  images_analyzed: number;
}

interface TagStrength {
  count: number;
  frequency: number;
  avg_confidence: number;
  strength_score: number;
}

interface VehicleTagWebAnalysisProps {
  vehicleId: string;
}

const VehicleTagWebAnalysis: React.FC<VehicleTagWebAnalysisProps> = ({ vehicleId }) => {
  const [analysis, setAnalysis] = useState<{
    web_data: TagWebData;
    tag_strength: Record<string, TagStrength>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'tier1' | 'categories' | 'automotive'>('tier1');

  useEffect(() => {
    loadAnalysis();
  }, [vehicleId]);

  const loadAnalysis = async () => {
    try {
      setLoading(true);
      setError(null);

      // Call the analyze-vehicle-tags function for real-time tag web analysis
      const { data, error: functionError } = await supabase.functions.invoke('analyze-vehicle-tags', {
        body: { vehicle_id: vehicleId }
      });

      if (functionError) {
        throw new Error(`Analysis function error: ${functionError.message}`);
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Analysis function returned unsuccessful response');
      }

      setAnalysis({
        web_data: data.web_data,
        tag_strength: data.tag_strength
      });

    } catch (err) {
      console.error('Error loading tag web analysis:', err);
      setError(err instanceof Error ? err.message : 'Failed to load analysis');
    } finally {
      setLoading(false);
    }
  };

  const buildTagWebFromTrainingData = (trainingData: any[]): TagWebData => {
    const labelCounts: Record<string, number> = {};
    const confidenceScores: Record<string, number[]> = {};
    const relationships: Record<string, string[]> = {};
    const categories: Record<string, string[]> = {};

    trainingData.forEach(item => {
      const label = item.label;
      const confidence = item.confidence || 0;
      const category = item.category || 'Other';

      // Count occurrences
      labelCounts[label] = (labelCounts[label] || 0) + 1;

      // Track confidence scores
      if (!confidenceScores[label]) {
        confidenceScores[label] = [];
      }
      confidenceScores[label].push(confidence);

      // Group by category
      if (!categories[category]) {
        categories[category] = [];
      }
      if (!categories[category].includes(label)) {
        categories[category].push(label);
      }
    });

    return {
      label_counts: labelCounts,
      confidence_scores: confidenceScores,
      relationships,
      categories,
      total_detections: trainingData.length,
      images_analyzed: new Set(trainingData.map(item => item.image_url)).size
    };
  };

  const calculateTagStrength = (webData: TagWebData): Record<string, TagStrength> => {
    const strength: Record<string, TagStrength> = {};

    Object.entries(webData.label_counts).forEach(([label, count]) => {
      const confidences = webData.confidence_scores[label] || [];
      const avgConfidence = confidences.length > 0
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : 0;

      const frequency = count / webData.images_analyzed;
      const strengthScore = (frequency * 0.6) + (avgConfidence / 100 * 0.4);

      strength[label] = {
        count,
        frequency,
        avg_confidence: avgConfidence,
        strength_score: strengthScore
      };
    });

    return strength;
  };

  const getTier1Tags = () => {
    if (!analysis) return [];

    return Object.entries(analysis.tag_strength)
      .sort(([, a], [, b]) => b.strength_score - a.strength_score)
      .slice(0, 15)
      .map(([label, metrics]) => ({
        label,
        ...metrics
      }));
  };

  const getCategoryData = () => {
    if (!analysis) return [];

    return Object.entries(analysis.web_data.categories)
      .filter(([, labels]) => labels.length >= 3)
      .sort(([, a], [, b]) => b.length - a.length)
      .slice(0, 8)
      .map(([category, labels]) => {
        const totalDetections = labels.reduce((sum, label) =>
          sum + (analysis.web_data.label_counts[label] || 0), 0);

        const avgStrength = labels.reduce((sum, label) =>
          sum + (analysis.tag_strength[label]?.strength_score || 0), 0) / labels.length;

        return {
          category,
          labels: labels.slice(0, 8),
          totalDetections,
          avgStrength
        };
      });
  };

  const getAutomotiveData = () => {
    if (!analysis) return [];

    const automotiveTerms = ['car', 'truck', 'wheel', 'tire', 'engine', 'brake', 'axle', 'transmission', 'differential'];

    return Object.entries(analysis.tag_strength)
      .filter(([label]) =>
        automotiveTerms.some(term => label.toLowerCase().includes(term))
      )
      .sort(([, a], [, b]) => b.strength_score - a.strength_score)
      .slice(0, 15)
      .map(([label, metrics]) => ({
        label,
        ...metrics
      }));
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-header">🕸️ AI Tag Web Analysis</div>
        <div className="card-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '20px 0' }}>
            <div className="loading-spinner" style={{ width: '16px', height: '16px' }}></div>
            <span>Analyzing tag relationships...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <div className="card-header">🕸️ AI Tag Web Analysis</div>
        <div className="card-body">
          <div className="alert alert-warning">
            <strong>Analysis Unavailable:</strong> {error}
          </div>
          <button
            className="button button-secondary mt-2"
            onClick={loadAnalysis}
          >
            Retry Analysis
          </button>
        </div>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="card">
        <div className="card-header">🕸️ AI Tag Web Analysis</div>
        <div className="card-body">
          <p className="text-muted">No analysis data available</p>
        </div>
      </div>
    );
  }

  const tier1Tags = getTier1Tags();
  const categoryData = getCategoryData();
  const automotiveData = getAutomotiveData();

  return (
    <div className="card">
      <div className="card-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>🕸️ AI Tag Web Analysis</span>
          <div className="badge badge-info">
            {analysis.web_data.images_analyzed} images • {analysis.web_data.total_detections} detections
          </div>
        </div>
      </div>

      <div className="card-body">
        {/* Tab Navigation */}
        <div className="tab-navigation" style={{ marginBottom: '20px' }}>
          <button
            className={`tab-button ${activeTab === 'tier1' ? 'active' : ''}`}
            onClick={() => setActiveTab('tier1')}
          >
            🌳 Dominant Tags
          </button>
          <button
            className={`tab-button ${activeTab === 'categories' ? 'active' : ''}`}
            onClick={() => setActiveTab('categories')}
          >
            📂 Categories
          </button>
          <button
            className={`tab-button ${activeTab === 'automotive' ? 'active' : ''}`}
            onClick={() => setActiveTab('automotive')}
          >
            🚗 Automotive
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'tier1' && (
          <div>
            <h4 style={{ marginBottom: '16px' }}>Tier 1 - Strongest AI Detections</h4>
            <div className="tag-strength-grid">
              {tier1Tags.map((tag, index) => (
                <div key={tag.label} className="tag-strength-item">
                  <div className="tag-rank">#{index + 1}</div>
                  <div className="tag-info">
                    <div className="tag-label">{tag.label}</div>
                    <div className="tag-stats">
                      {tag.count}x ({(tag.frequency * 100).toFixed(1)}%) •
                      {tag.avg_confidence.toFixed(1)}% conf •
                      <strong>{(tag.strength_score * 100).toFixed(1)}% strength</strong>
                    </div>
                  </div>
                  <div className="strength-bar">
                    <div
                      className="strength-fill"
                      style={{ width: `${tag.strength_score * 100}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'categories' && (
          <div>
            <h4 style={{ marginBottom: '16px' }}>Category Clusters</h4>
            <div className="category-grid">
              {categoryData.map((cat) => (
                <div key={cat.category} className="category-cluster">
                  <div className="category-header">
                    <h5>📁 {cat.category}</h5>
                    <div className="category-meta">
                      {cat.labels.length} labels • {cat.totalDetections} detections •
                      {(cat.avgStrength * 100).toFixed(1)}% avg strength
                    </div>
                  </div>
                  <div className="category-tags">
                    {cat.labels.map((label) => {
                      const strength = analysis.tag_strength[label];
                      return (
                        <div key={label} className="category-tag">
                          <span className="tag-name">{label}</span>
                          <span className="tag-count">
                            ({strength?.count}x, {strength?.avg_confidence.toFixed(1)}%)
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'automotive' && (
          <div>
            <h4 style={{ marginBottom: '16px' }}>Automotive-Specific Tags</h4>
            <div className="automotive-grid">
              {automotiveData.map((tag, index) => (
                <div key={tag.label} className="automotive-tag-item">
                  <div className="automotive-rank">#{index + 1}</div>
                  <div className="automotive-info">
                    <div className="automotive-label">🚗 {tag.label}</div>
                    <div className="automotive-stats">
                      {tag.count} occurrences • {(tag.strength_score * 100).toFixed(1)}% strength
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Button */}
        <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--color-border)' }}>
          <button
            className="button button-secondary"
            onClick={loadAnalysis}
            style={{ marginRight: '12px' }}
          >
            🔄 Refresh Analysis
          </button>
          <span className="text-small text-muted">
            Last updated: {new Date().toLocaleTimeString()}
          </span>
        </div>
      </div>

      <style jsx>{`
        .tab-navigation {
          display: flex;
          gap: 8px;
          border-bottom: 1px solid var(--color-border);
        }

        .tab-button {
          padding: 8px 16px;
          border: none;
          background: transparent;
          border-bottom: 2px solid transparent;
          cursor: pointer;
          transition: all 0.2s;
        }

        .tab-button:hover {
          background: var(--color-background-hover);
        }

        .tab-button.active {
          border-bottom-color: var(--color-primary);
          font-weight: 500;
        }

        .tag-strength-grid {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .tag-strength-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          background: var(--color-background-subtle);
          border-radius: 6px;
        }

        .tag-rank {
          font-weight: bold;
          color: var(--color-primary);
          min-width: 32px;
        }

        .tag-info {
          flex: 1;
        }

        .tag-label {
          font-weight: 500;
          margin-bottom: 4px;
        }

        .tag-stats {
          font-size: 12px;
          color: var(--color-text-muted);
        }

        .strength-bar {
          width: 60px;
          height: 8px;
          background: var(--color-border);
          border-radius: 4px;
          overflow: hidden;
        }

        .strength-fill {
          height: 100%;
          background: linear-gradient(90deg, var(--color-success), var(--color-primary));
          transition: width 0.3s;
        }

        .category-grid {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .category-cluster {
          border: 1px solid var(--color-border);
          border-radius: 8px;
          padding: 16px;
        }

        .category-header h5 {
          margin: 0 0 4px 0;
          font-size: 16px;
        }

        .category-meta {
          font-size: 12px;
          color: var(--color-text-muted);
          margin-bottom: 12px;
        }

        .category-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .category-tag {
          background: var(--color-background-subtle);
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
        }

        .tag-name {
          font-weight: 500;
        }

        .tag-count {
          color: var(--color-text-muted);
          margin-left: 4px;
        }

        .automotive-grid {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .automotive-tag-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px 12px;
          background: var(--color-background-subtle);
          border-radius: 4px;
        }

        .automotive-rank {
          font-weight: bold;
          color: var(--color-primary);
          min-width: 32px;
        }

        .automotive-label {
          font-weight: 500;
          margin-bottom: 2px;
        }

        .automotive-stats {
          font-size: 12px;
          color: var(--color-text-muted);
        }
      `}</style>
    </div>
  );
};

export default VehicleTagWebAnalysis;