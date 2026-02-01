import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { DollarSign, Wrench, Package, Clock, AlertTriangle, CheckCircle, TrendingUp } from 'lucide-react';

interface AIWorkOrderInvoiceProps {
  imageIds: string[];
  organizationId: string;
  organizationName: string;
  laborRate: number;
  eventDate: string;
  vehicleName?: string;
  onClose: () => void;
}

const AIWorkOrderInvoice: React.FC<AIWorkOrderInvoiceProps> = ({
  imageIds,
  organizationId,
  organizationName,
  laborRate,
  eventDate,
  vehicleName,
  onClose
}) => {
  const [analyzing, setAnalyzing] = useState(true);
  const [analysis, setAnalysis] = useState<any>(null);
  const [images, setImages] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'parts' | 'labor' | 'photos'>('overview');

  useEffect(() => {
    analyzeWorkOrder();
  }, []);

  const analyzeWorkOrder = async () => {
    try {
      // Get images
      const { data: imgs } = await supabase
        .from('organization_images')
        .select('*')
        .in('id', imageIds);
      
      setImages(imgs || []);

      // Call AI analyzer
      const response = await fetch(`${supabase.supabaseUrl}/functions/v1/analyze-work-order-bundle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabase.supabaseKey}`
        },
        body: JSON.stringify({
          image_bundle_ids: imageIds,
          organization_id: organizationId
        })
      });

      const result = await response.json();
      setAnalysis(result.analysis);
    } catch (error) {
      console.error('AI analysis failed:', error);
    } finally {
      setAnalyzing(false);
    }
  };

  const renderInvoiceHeader = () => (
    <div style={{
      background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)',
      color: '#fff',
      padding: '24px',
      borderRadius: '8px 8px 0 0'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '18pt', fontWeight: 700, marginBottom: '4px' }}>
            WORK ORDER INVOICE
          </div>
          <div style={{ fontSize: '9pt', opacity: 0.9 }}>
            {organizationName}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '8pt', opacity: 0.8, marginBottom: '2px' }}>Date</div>
          <div style={{ fontSize: '11pt', fontWeight: 700 }}>
            {new Date(eventDate).toLocaleDateString()}
          </div>
        </div>
      </div>
      
      {vehicleName && (
        <div style={{
          marginTop: '16px',
          padding: '12px',
          background: 'rgba(255,255,255,0.1)',
          borderRadius: '4px',
          fontSize: '10pt'
        }}>
          <strong>Vehicle:</strong> {vehicleName}
        </div>
      )}
    </div>
  );

  const renderOverview = () => {
    if (!analysis) return null;

    const parts = analysis.total_value_estimate?.parts_cost || 0;
    const labor = analysis.total_value_estimate?.labor_cost || 0;
    const total = analysis.total_value_estimate?.total || 0;
    const confidence = analysis.ai_confidence_score || 0;

    return (
      <div style={{ padding: '24px' }}>
        {/* AI Confidence Warning */}
        {confidence < 70 && (
          <div style={{
            background: '#FFF3CD',
            border: '2px solid #FFE69C',
            padding: '16px',
            borderRadius: '6px',
            marginBottom: '24px',
            display: 'flex',
            gap: '12px',
            alignItems: 'flex-start'
          }}>
            <AlertTriangle size={20} style={{ color: '#856404', flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 700, marginBottom: '4px', color: '#856404' }}>
                AI Confidence: {confidence}% - Requires Human Review
              </div>
              <div style={{ fontSize: '8pt', color: '#856404' }}>
                {analysis.ai_notes || 'This estimate has uncertainty and should be reviewed by a technician.'}
              </div>
              {analysis.review_reasons && analysis.review_reasons.length > 0 && (
                <ul style={{ margin: '8px 0 0 16px', fontSize: '8pt' }}>
                  {analysis.review_reasons.map((reason: string, i: number) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Total Value - BIG */}
        <div style={{
          background: '#F0FDF4',
          border: '2px solid #86EFAC',
          borderRadius: '8px',
          padding: '24px',
          textAlign: 'center',
          marginBottom: '24px'
        }}>
          <div style={{ fontSize: '8pt', color: '#15803D', marginBottom: '8px', fontWeight: 600 }}>
            ESTIMATED TOTAL VALUE
          </div>
          <div style={{ fontSize: '32pt', fontWeight: 700, color: '#15803D', marginBottom: '4px' }}>
            ${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '8pt', color: '#15803D' }}>
            Confidence: {confidence}%
          </div>
        </div>

        {/* Breakdown */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '16px',
          marginBottom: '24px'
        }}>
          <div style={{
            background: '#FEF3C7',
            border: '1px solid #FDE047',
            borderRadius: '6px',
            padding: '16px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <Package size={16} style={{ color: '#CA8A04' }} />
              <div style={{ fontSize: '8pt', fontWeight: 700, color: '#CA8A04' }}>PARTS & MATERIALS</div>
            </div>
            <div style={{ fontSize: '20pt', fontWeight: 700, color: '#CA8A04' }}>
              ${parts.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
          </div>

          <div style={{
            background: '#DBEAFE',
            border: '1px solid #93C5FD',
            borderRadius: '6px',
            padding: '16px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <Wrench size={16} style={{ color: '#1E40AF' }} />
              <div style={{ fontSize: '8pt', fontWeight: 700, color: '#1E40AF' }}>LABOR @ ${laborRate}/hr</div>
            </div>
            <div style={{ fontSize: '20pt', fontWeight: 700, color: '#1E40AF' }}>
              ${labor.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
            {analysis.estimated_labor_hours && (
              <div style={{ fontSize: '7pt', color: '#1E40AF', marginTop: '4px' }}>
                {analysis.estimated_labor_hours.expected} hrs ({analysis.estimated_labor_hours.minimum}-{analysis.estimated_labor_hours.maximum} range)
              </div>
            )}
          </div>
        </div>

        {/* Industry Standards Cross-Check */}
        {analysis.industry_standards_check && (
          <div style={{
            background: 'var(--bg)',
            border: '1px solid #D1D5DB',
            borderRadius: '6px',
            padding: '16px',
            marginBottom: '16px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <TrendingUp size={16} />
              <div style={{ fontSize: '9pt', fontWeight: 700 }}>Industry Standards Check</div>
            </div>
            
            {analysis.industry_standards_check.mitchell_estimate && (
              <div style={{ fontSize: '8pt', marginBottom: '6px' }}>
                <strong>Mitchell Estimate:</strong> ${analysis.industry_standards_check.mitchell_estimate.toLocaleString()}
              </div>
            )}
            
            {analysis.industry_standards_check.variance_explanation && (
              <div style={{ fontSize: '8pt', fontStyle: 'italic', color: '#6B7280' }}>
                {analysis.industry_standards_check.variance_explanation}
              </div>
            )}
          </div>
        )}

        {/* Work Details */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          padding: '16px'
        }}>
          <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '12px' }}>WORK PERFORMED</div>
          
          <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', fontSize: '8pt' }}>
            <div>
              <span style={{ color: '#6B7280' }}>Category:</span>
              <span style={{
                marginLeft: '8px',
                background: '#E5E7EB',
                padding: '2px 8px',
                borderRadius: '4px',
                fontWeight: 600,
                textTransform: 'uppercase'
              }}>
                {analysis.work_category}
              </span>
            </div>
            
            <div>
              <span style={{ color: '#6B7280' }}>Complexity:</span>
              <span style={{
                marginLeft: '8px',
                background: analysis.complexity_level === 'expert' ? '#FEE2E2' :
                           analysis.complexity_level === 'complex' ? '#FED7AA' :
                           analysis.complexity_level === 'moderate' ? '#FEF3C7' : '#DCFCE7',
                color: analysis.complexity_level === 'expert' ? '#991B1B' :
                       analysis.complexity_level === 'complex' ? '#9A3412' :
                       analysis.complexity_level === 'moderate' ? '#854D0E' : '#166534',
                padding: '2px 8px',
                borderRadius: '4px',
                fontWeight: 600,
                textTransform: 'uppercase'
              }}>
                {analysis.complexity_level}
              </span>
            </div>
          </div>

          {analysis.estimated_labor_hours?.reasoning && (
            <div style={{ 
              fontSize: '8pt',
              color: '#4B5563',
              lineHeight: '1.5',
              fontStyle: 'italic',
              padding: '12px',
              background: 'var(--bg)',
              borderRadius: '4px'
            }}>
              {analysis.estimated_labor_hours.reasoning}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderParts = () => {
    if (!analysis?.products_identified || analysis.products_identified.length === 0) {
      return (
        <div style={{ padding: '40px', textAlign: 'center', color: '#6B7280' }}>
          No parts identified in images
        </div>
      );
    }

    return (
      <div style={{ padding: '20px' }}>
        <table style={{ width: '100%', fontSize: '8pt', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
              <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 700 }}>PART/PRODUCT</th>
              <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 700 }}>CATEGORY</th>
              <th style={{ textAlign: 'center', padding: '12px 8px', fontWeight: 700 }}>CONFIDENCE</th>
              <th style={{ textAlign: 'right', padding: '12px 8px', fontWeight: 700 }}>EST. COST</th>
            </tr>
          </thead>
          <tbody>
            {analysis.products_identified.map((product: any, idx: number) => (
              <tr key={idx} style={{ borderBottom: '1px solid #F3F4F6' }}>
                <td style={{ padding: '12px 8px' }}>{product.name}</td>
                <td style={{ padding: '12px 8px' }}>
                  <span style={{
                    background: '#E5E7EB',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '7pt',
                    textTransform: 'uppercase',
                    fontWeight: 600
                  }}>
                    {product.category}
                  </span>
                </td>
                <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                  <div style={{
                    display: 'inline-block',
                    background: product.confidence >= 80 ? '#DCFCE7' :
                               product.confidence >= 60 ? '#FEF3C7' : '#FEE2E2',
                    color: product.confidence >= 80 ? '#166534' :
                           product.confidence >= 60 ? '#854D0E' : '#991B1B',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontWeight: 700
                  }}>
                    {product.confidence}%
                  </div>
                </td>
                <td style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 600 }}>
                  {product.estimated_cost ? `$${product.estimated_cost.toFixed(2)}` : 'Unknown'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid #E5E7EB' }}>
              <td colSpan={3} style={{ padding: '12px 8px', fontWeight: 700 }}>TOTAL PARTS</td>
              <td style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 700, fontSize: '10pt' }}>
                ${analysis.total_value_estimate.parts_cost.toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  };

  const renderLabor = () => {
    if (!analysis?.estimated_labor_hours) return null;

    const labor = analysis.estimated_labor_hours;
    const cost = analysis.total_value_estimate.labor_cost;

    return (
      <div style={{ padding: '24px' }}>
        <div style={{
          background: '#DBEAFE',
          border: '2px solid #3B82F6',
          borderRadius: '8px',
          padding: '24px',
          marginBottom: '24px'
        }}>
          <div style={{ fontSize: '10pt', fontWeight: 700, color: '#1E40AF', marginBottom: '16px' }}>
            LABOR ANALYSIS
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <div style={{ fontSize: '7pt', color: '#1E40AF', marginBottom: '4px' }}>Minimum</div>
              <div style={{ fontSize: '14pt', fontWeight: 700, color: '#1E40AF' }}>
                {labor.minimum} hrs
              </div>
            </div>
            <div>
              <div style={{ fontSize: '7pt', color: '#1E40AF', marginBottom: '4px' }}>Expected</div>
              <div style={{ fontSize: '18pt', fontWeight: 700, color: '#1E40AF' }}>
                {labor.expected} hrs
              </div>
            </div>
            <div>
              <div style={{ fontSize: '7pt', color: '#1E40AF', marginBottom: '4px' }}>Maximum</div>
              <div style={{ fontSize: '14pt', fontWeight: 700, color: '#1E40AF' }}>
                {labor.maximum} hrs
              </div>
            </div>
          </div>

          <div style={{
            padding: '16px',
            background: 'var(--surface-glass)',
            borderRadius: '6px',
            marginBottom: '16px'
          }}>
            <div style={{ fontSize: '8pt', color: '#1E40AF', marginBottom: '8px', fontWeight: 600 }}>
              AI REASONING:
            </div>
            <div style={{ fontSize: '8pt', color: '#1E40AF', lineHeight: '1.6', fontStyle: 'italic' }}>
              {labor.reasoning}
            </div>
          </div>

          <div style={{ textAlign: 'center', borderTop: '2px solid #3B82F6', paddingTop: '16px' }}>
            <div style={{ fontSize: '8pt', color: '#1E40AF', marginBottom: '4px' }}>
              LABOR COST @ ${laborRate}/hr
            </div>
            <div style={{ fontSize: '24pt', fontWeight: 700, color: '#1E40AF' }}>
              ${cost.toFixed(2)}
            </div>
            <div style={{ fontSize: '7pt', color: '#1E40AF', marginTop: '4px' }}>
              Based on {labor.expected} hours
            </div>
          </div>
        </div>

        {/* Confidence Meter */}
        <div style={{
          background: 'var(--bg)',
          border: '1px solid #E5E7EB',
          borderRadius: '6px',
          padding: '16px'
        }}>
          <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '8px' }}>
            ESTIMATE CONFIDENCE: {labor.confidence}%
          </div>
          <div style={{
            height: '8px',
            background: '#E5E7EB',
            borderRadius: '4px',
            overflow: 'hidden'
          }}>
            <div style={{
              height: '100%',
              width: `${labor.confidence}%`,
              background: labor.confidence >= 80 ? '#10B981' :
                         labor.confidence >= 60 ? '#F59E0B' : '#EF4444',
              transition: 'width 0.3s'
            }} />
          </div>
        </div>
      </div>
    );
  };

  const renderPhotos = () => (
    <div style={{ padding: '20px' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: '12px'
      }}>
        {images.map((img) => (
          <div
            key={img.id}
            style={{
              aspectRatio: '4/3',
              backgroundImage: `url(${img.image_url})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              borderRadius: '6px',
              border: '2px solid var(--border)',
              cursor: 'pointer',
              position: 'relative'
            }}
            onClick={() => window.open(img.image_url, '_blank')}
          >
            {/* Product badge if AI identified something */}
            {analysis?.products_identified?.some((p: any) => p.source_image_id === img.id) && (
              <div style={{
                position: 'absolute',
                top: '4px',
                right: '4px',
                background: '#10B981',
                color: '#fff',
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '6pt',
                fontWeight: 700
              }}>
                PARTS ID'D
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
      padding: '20px'
    }}
    onClick={onClose}
    >
      <div
        style={{
          background: 'var(--surface)',
          width: '100%',
          maxWidth: '900px',
          maxHeight: '90vh',
          borderRadius: '8px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={e => e.stopPropagation()}
      >
        {renderInvoiceHeader()}

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '2px solid #E5E7EB', background: 'var(--bg)' }}>
          {['overview', 'parts', 'labor', 'photos'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              style={{
                flex: 1,
                padding: '12px',
                border: 'none',
                borderBottom: activeTab === tab ? '3px solid #3B82F6' : 'none',
                background: activeTab === tab ? '#fff' : 'transparent',
                fontSize: '9pt',
                fontWeight: activeTab === tab ? 700 : 400,
                cursor: 'pointer',
                textTransform: 'uppercase',
                color: activeTab === tab ? '#3B82F6' : '#6B7280'
              }}
            >
              {tab}
              {tab === 'photos' && ` (${images.length})`}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {analyzing ? (
            <div style={{ padding: '60px', textAlign: 'center' }}>
              <div style={{ fontSize: '11pt', color: '#6B7280', marginBottom: '12px' }}>
                Analyzing images with AI...
              </div>
              <div style={{ fontSize: '8pt', color: '#9CA3AF' }}>
                Identifying products, estimating labor, calculating value
              </div>
            </div>
          ) : (
            <>
              {activeTab === 'overview' && renderOverview()}
              {activeTab === 'parts' && renderParts()}
              {activeTab === 'labor' && renderLabor()}
              {activeTab === 'photos' && renderPhotos()}
            </>
          )}
        </div>

        {/* Footer Actions */}
        {!analyzing && analysis && (
          <div style={{
            padding: '16px',
            borderTop: '2px solid #E5E7EB',
            background: 'var(--bg)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div style={{ fontSize: '7pt', color: '#6B7280' }}>
              Analyzed {images.length} images with AI • Confidence: {analysis.ai_confidence_score}%
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={onClose}
                style={{
                  padding: '8px 16px',
                  border: '1px solid #D1D5DB',
                  background: 'var(--surface)',
                  borderRadius: '4px',
                  fontSize: '9pt',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
              <button
                style={{
                  padding: '8px 16px',
                  border: 'none',
                  background: '#3B82F6',
                  color: '#fff',
                  borderRadius: '4px',
                  fontSize: '9pt',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Approve Estimate
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AIWorkOrderInvoice;

