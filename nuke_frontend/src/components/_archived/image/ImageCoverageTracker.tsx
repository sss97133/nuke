/**
 * Image Coverage Tracker Component
 * 
 * Shows coverage analysis: "Every inch of this thing has been photographed"
 * - Essential angles checklist
 * - Coverage percentage by category
 * - Missing angles
 * - Recommendations
 */

import React, { useState, useEffect } from 'react';
import { analyzeVehicleCoverage, getCoverageSummary, type VehicleCoverageReport } from '../../services/imageCoverageTracker';
import '../../design-system.css';

interface ImageCoverageTrackerProps {
  vehicleId: string;
  onImageClick?: (imageId: string) => void;
}

const ImageCoverageTracker: React.FC<ImageCoverageTrackerProps> = ({
  vehicleId,
  onImageClick
}) => {
  const [report, setReport] = useState<VehicleCoverageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  useEffect(() => {
    loadCoverage();
  }, [vehicleId]);

  const loadCoverage = async () => {
    try {
      setLoading(true);
      const coverageReport = await analyzeVehicleCoverage(vehicleId);
      setReport(coverageReport);
    } catch (error) {
      console.error('Error loading coverage:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{
        padding: '12px',
        fontSize: '10px',
        color: 'var(--text-secondary)',
        textAlign: 'center'
      }}>
        Analyzing coverage...
      </div>
    );
  }

  if (!report) {
    return null;
  }

  const categoryColors: Record<string, string> = {
    exterior: '#3b82f6',
    interior: '#ec4899',
    engine: '#f97316',
    undercarriage: '#10b981',
    detail: '#6366f1',
    document: '#14b8a6'
  };

  return (
    <div style={{ width: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '12px',
        paddingBottom: '8px',
        borderBottom: '2px solid var(--border)'
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '10px',
          fontWeight: 600,
          color: 'var(--text)'
        }}>
          Image Coverage Analysis
        </h3>
        <div style={{
          fontSize: '9px',
          color: 'var(--text-secondary)'
        }}>
          {report.essential_coverage.covered}/{report.essential_coverage.total} essential
        </div>
      </div>

      {/* Overall Progress */}
      <div style={{
        marginBottom: '16px',
        padding: '12px',
        background: 'var(--surface)',
        border: '2px solid var(--border)',
        borderRadius: '4px'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '8px'
        }}>
          <span style={{ fontSize: '9px', fontWeight: 600, color: 'var(--text)' }}>
            Essential Coverage
          </span>
          <span style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>
            {report.essential_coverage.percentage}%
          </span>
        </div>
        <div style={{
          width: '100%',
          height: '8px',
          background: 'var(--border)',
          borderRadius: '4px',
          overflow: 'hidden'
        }}>
          <div style={{
            width: `${report.essential_coverage.percentage}%`,
            height: '100%',
            background: report.essential_coverage.percentage >= 80 ? '#10b981' :
                       report.essential_coverage.percentage >= 50 ? '#f59e0b' : '#ef4444',
            transition: 'width 0.12s ease'
          }} />
        </div>
      </div>

      {/* Category Breakdown */}
      <div style={{ marginBottom: '16px' }}>
        {Object.entries(report.category_coverage)
          .filter(([_, coverage]) => coverage.total > 0)
          .map(([category, coverage]) => {
          
          return (
            <div
              key={category}
              style={{
                marginBottom: '8px',
                padding: '8px',
                background: 'var(--surface)',
                border: '2px solid var(--border)',
                borderRadius: '4px',
                cursor: 'pointer',
                transition: 'all 0.12s ease'
              }}
              onClick={() => setExpandedCategory(expandedCategory === category ? null : category)}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = categoryColors[category] || 'var(--border-focus)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)';
              }}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: categoryColors[category] || '#6b7280'
                  }} />
                  <span style={{
                    fontSize: '9px',
                    fontWeight: 600,
                    color: 'var(--text)',
                    textTransform: 'capitalize'
                  }}>
                    {category}
                  </span>
                </div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <span style={{
                    fontSize: '8px',
                    color: 'var(--text-secondary)'
                  }}>
                    {coverage.covered}/{coverage.total}
                  </span>
                  <span style={{
                    fontSize: '8px',
                    color: 'var(--text-secondary)'
                  }}>
                    {coverage.percentage}%
                  </span>
                  <span style={{
                    fontSize: '8px',
                    color: 'var(--text-secondary)'
                  }}>
                    {expandedCategory === category ? '▼' : '▶'}
                  </span>
                </div>
              </div>

              {/* Expanded angle list */}
              {expandedCategory === category && (
                <div style={{
                  marginTop: '8px',
                  paddingTop: '8px',
                  borderTop: '1px solid var(--border)'
                }}>
                  {report.angle_statuses
                    .filter(s => {
                      // Map category names
                      const categoryMap: Record<string, string[]> = {
                        'exterior': ['exterior'],
                        'interior': ['interior'],
                        'engine': ['engine_bay'],
                        'undercarriage': ['undercarriage'],
                        'detail': ['details'],
                        'document': ['document']
                      };
                      const dbCategories = categoryMap[category] || [category];
                      return dbCategories.includes(s.category);
                    })
                    .map(status => (
                      <div
                        key={status.angle_name}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '4px 0',
                          fontSize: '8px'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{
                            color: status.has_coverage ? '#10b981' : '#ef4444',
                            fontSize: '10px'
                          }}>
                            {status.has_coverage ? '✓' : '✗'}
                          </span>
                          <span style={{
                            color: status.has_coverage ? 'var(--text)' : 'var(--text-secondary)',
                            textDecoration: status.has_coverage ? 'none' : 'line-through'
                          }}>
                            {status.angle_name}
                          </span>
                        </div>
                        {status.has_coverage && status.best_image_id && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onImageClick?.(status.best_image_id!);
                            }}
                            className="btn-utility"
                            style={{
                              padding: '2px 6px',
                              fontSize: '7px',
                              height: '18px'
                            }}
                          >
                            View
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Recommendations */}
      {report.recommendations.length > 0 && (
        <div style={{
          padding: '8px',
          background: report.missing_essential.length > 0 ? '#fef2f2' : '#f0fdf4',
          border: '2px solid',
          borderColor: report.missing_essential.length > 0 ? '#fecaca' : '#bbf7d0',
          borderRadius: '4px'
        }}>
          <div style={{
            fontSize: '9px',
            fontWeight: 600,
            color: 'var(--text)',
            marginBottom: '6px'
          }}>
            Recommendations
          </div>
          {report.recommendations.map((rec, idx) => (
            <div
              key={idx}
              style={{
                fontSize: '8px',
                color: 'var(--text-secondary)',
                marginBottom: '4px',
                paddingLeft: '12px',
                position: 'relative'
              }}
            >
              <span style={{
                position: 'absolute',
                left: '0',
                color: report.missing_essential.length > 0 ? '#ef4444' : '#10b981'
              }}>
                •
              </span>
              {rec}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ImageCoverageTracker;

