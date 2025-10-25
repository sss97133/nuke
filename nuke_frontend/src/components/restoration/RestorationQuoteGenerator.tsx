/**
 * Instant Restoration Quote Generator
 * 
 * Analyzes all vehicle images in parallel, identifies parts, assesses condition,
 * calculates repair vs replace costs, and generates comprehensive restoration quote.
 * 
 * Integrates with market/funding system to offer instant investment opportunities.
 */

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface PartAssessment {
  id: string;
  part_name: string;
  category: string;
  oem_part_number: string;
  
  // Condition
  current_condition_grade: number;  // 1-10
  issues: string[];  // ["rust", "dent", "uv_fading"]
  current_value_cents: number;
  
  // Options
  repair_option: {
    cost_cents: number;
    time_minutes: number;
    materials: string[];
    result_grade: number;
    description: string;
  } | null;
  
  replace_option: {
    cost_cents: number;
    time_minutes: number;
    supplier: string;
    result_grade: number;
    part_url: string;
  };
  
  // Recommendation
  recommendation: 'keep' | 'repair' | 'replace';
  roi_percentage: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

interface RestorationQuote {
  vehicle_id: string;
  images_analyzed: number;
  parts_identified: number;
  overall_condition_grade: number;
  
  // Breakdown by category
  body_work: PartAssessment[];
  paint_work: PartAssessment[];
  mechanical: PartAssessment[];
  interior: PartAssessment[];
  electrical: PartAssessment[];
  
  // Totals
  totals: {
    diy_parts_cents: number;
    diy_materials_cents: number;
    diy_time_hours: number;
    diy_total_cents: number;
    
    shop_parts_cents: number;
    shop_labor_cents: number;
    shop_total_cents: number;
    
    dealer_parts_cents: number;
    dealer_labor_cents: number;
    dealer_total_cents: number;
  };
  
  // Funding
  recommended_funding_cents: number;
  funding_options: {
    type: 'shares' | 'bonds' | 'partnership';
    amount_cents: number;
    terms: string;
    returns_estimate: string;
  }[];
  
  // Timeline
  timeline_estimate: {
    phase: string;
    duration_weeks: number;
    cost_cents: number;
    parts: string[];
  }[];
  
  generated_at: string;
}

interface RestorationQuoteGeneratorProps {
  vehicleId: string;
  onQuoteGenerated?: (quote: RestorationQuote) => void;
  autoGenerate?: boolean;  // Generate on mount (for add-vehicle flow)
}

export const RestorationQuoteGenerator: React.FC<RestorationQuoteGeneratorProps> = ({
  vehicleId,
  onQuoteGenerated,
  autoGenerate = false
}) => {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [quote, setQuote] = useState<RestorationQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const generateQuote = async () => {
    setLoading(true);
    setProgress(0);
    setError(null);
    setStatus('Loading vehicle images...');

    try {
      // Step 1: Get all images
      setProgress(10);
      const { data: images } = await supabase
        .from('vehicle_images')
        .select('id, image_url, area')
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: true });

      if (!images || images.length === 0) {
        throw new Error('No images found for this vehicle');
      }

      setStatus(`Analyzing ${images.length} images...`);
      setProgress(20);

      // Step 2: Call Edge Function to generate quote
      const { data: quoteData, error: quoteError } = await supabase.functions.invoke(
        'generate-restoration-quote',
        {
          body: {
            vehicle_id: vehicleId,
            image_ids: images.map(img => img.id)
          }
        }
      );

      if (quoteError) throw quoteError;

      setProgress(100);
      setStatus('Quote generated!');
      setQuote(quoteData);
      
      if (onQuoteGenerated) {
        onQuoteGenerated(quoteData);
      }

    } catch (err: any) {
      setError(err.message || 'Failed to generate quote');
      console.error('Quote generation error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (autoGenerate) {
      generateQuote();
    }
  }, [autoGenerate]);

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(cents / 100);
  };

  const getConditionColor = (grade: number) => {
    if (grade >= 9) return '#008000';  // Green (excellent)
    if (grade >= 7) return '#808000';  // Olive (good)
    if (grade >= 5) return '#ff8c00';  // Orange (fair)
    if (grade >= 3) return '#ff0000';  // Red (poor)
    return '#800000';  // Maroon (critical)
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return '#ff0000';
      case 'high': return '#ff8c00';
      case 'medium': return '#808000';
      case 'low': return '#008000';
      default: return '#808080';
    }
  };

  if (loading) {
    return (
      <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
        <div className="text" style={{ fontSize: '11pt', marginBottom: '16px' }}>
          {status}
        </div>
        <div style={{
          width: '100%',
          height: '20px',
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          position: 'relative'
        }}>
          <div style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${progress}%`,
            background: 'var(--text)',
            transition: 'width 0.3s'
          }} />
        </div>
        <div className="text text-small text-muted" style={{ marginTop: '8px' }}>
          {progress}% complete
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ padding: '20px', border: '2px solid #ff0000' }}>
        <div className="text" style={{ color: '#ff0000', marginBottom: '12px' }}>
          Error generating quote: {error}
        </div>
        <button className="button button-primary" onClick={generateQuote}>
          Retry
        </button>
      </div>
    );
  }

  if (!quote && !autoGenerate) {
    return (
      <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
        <div className="text" style={{ fontSize: '14pt', marginBottom: '12px', fontWeight: 'bold' }}>
          Get Instant Restoration Quote
        </div>
        <div className="text text-muted" style={{ marginBottom: '20px' }}>
          AI will analyze all vehicle images and provide detailed cost breakdown
        </div>
        <button 
          className="button button-primary"
          onClick={generateQuote}
          style={{ padding: '12px 24px', fontSize: '11pt' }}
        >
          Generate Quote →
        </button>
      </div>
    );
  }

  if (!quote) return null;

  const allParts = [
    ...quote.body_work,
    ...quote.paint_work,
    ...quote.mechanical,
    ...quote.interior,
    ...quote.electrical
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      
      {/* Header - Quick Summary */}
      <div className="card" style={{ 
        padding: '20px',
        background: 'linear-gradient(135deg, var(--surface) 0%, var(--bg) 100%)',
        border: '2px solid var(--border)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="text" style={{ fontSize: '16pt', fontWeight: 'bold', marginBottom: '8px' }}>
              Restoration Analysis Complete
            </div>
            <div className="text text-small text-muted">
              {quote.images_analyzed} images analyzed • {quote.parts_identified} parts identified
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="text text-small text-muted">Overall Condition</div>
            <div className="text" style={{ 
              fontSize: '24pt', 
              fontWeight: 'bold',
              color: getConditionColor(quote.overall_condition_grade)
            }}>
              {quote.overall_condition_grade.toFixed(1)}/10
            </div>
          </div>
        </div>
      </div>

      {/* Cost Breakdown - 3 Scenarios */}
      <div className="card" style={{ padding: '20px' }}>
        <div className="text" style={{ fontSize: '12pt', fontWeight: 'bold', marginBottom: '16px' }}>
          Restoration Cost Estimates
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
          {/* DIY */}
          <div style={{ 
            padding: '16px', 
            background: 'var(--surface)', 
            border: '2px solid #008000'
          }}>
            <div className="text text-small text-muted">DIY (You Do It)</div>
            <div className="text" style={{ fontSize: '20pt', fontWeight: 'bold', color: '#008000' }}>
              {formatCurrency(quote.totals.diy_total_cents)}
            </div>
            <div className="text text-small" style={{ marginTop: '8px' }}>
              Parts: {formatCurrency(quote.totals.diy_parts_cents)}<br/>
              Materials: {formatCurrency(quote.totals.diy_materials_cents)}<br/>
              Time: {quote.totals.diy_time_hours.toFixed(1)} hours
            </div>
          </div>

          {/* Independent Shop */}
          <div style={{ 
            padding: '16px', 
            background: 'var(--surface)', 
            border: '2px solid #ff8c00'
          }}>
            <div className="text text-small text-muted">Independent Shop</div>
            <div className="text" style={{ fontSize: '20pt', fontWeight: 'bold', color: '#ff8c00' }}>
              {formatCurrency(quote.totals.shop_total_cents)}
            </div>
            <div className="text text-small" style={{ marginTop: '8px' }}>
              Parts: {formatCurrency(quote.totals.shop_parts_cents)}<br/>
              Labor: {formatCurrency(quote.totals.shop_labor_cents)}<br/>
              @ $75/hr
            </div>
          </div>

          {/* Dealership */}
          <div style={{ 
            padding: '16px', 
            background: 'var(--surface)', 
            border: '2px solid #ff0000'
          }}>
            <div className="text text-small text-muted">Dealership</div>
            <div className="text" style={{ fontSize: '20pt', fontWeight: 'bold', color: '#ff0000' }}>
              {formatCurrency(quote.totals.dealer_total_cents)}
            </div>
            <div className="text text-small" style={{ marginTop: '8px' }}>
              Parts: {formatCurrency(quote.totals.dealer_parts_cents)}<br/>
              Labor: {formatCurrency(quote.totals.dealer_labor_cents)}<br/>
              @ $150/hr
            </div>
          </div>
        </div>

        {/* Recommended Path */}
        <div style={{ 
          marginTop: '16px', 
          padding: '12px', 
          background: 'rgba(0, 128, 0, 0.1)',
          border: '1px solid #008000'
        }}>
          <div className="text" style={{ fontWeight: 'bold' }}>
            💡 Recommended: DIY with selective shop help saves {formatCurrency(quote.totals.shop_total_cents - quote.totals.diy_total_cents)}
          </div>
        </div>
      </div>

      {/* Parts Breakdown by Category */}
      <div className="card" style={{ padding: '20px' }}>
        <div className="text" style={{ fontSize: '12pt', fontWeight: 'bold', marginBottom: '16px' }}>
          Parts Assessment ({allParts.length} items)
        </div>

        {/* Category Tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', borderBottom: '2px solid var(--border)' }}>
          {[
            { key: 'body_work', label: 'Body', count: quote.body_work.length },
            { key: 'paint_work', label: 'Paint', count: quote.paint_work.length },
            { key: 'mechanical', label: 'Mechanical', count: quote.mechanical.length },
            { key: 'interior', label: 'Interior', count: quote.interior.length },
            { key: 'electrical', label: 'Electrical', count: quote.electrical.length }
          ].map(cat => (
            <button
              key={cat.key}
              onClick={() => setExpandedCategory(cat.key)}
              className="button button-small"
              style={{
                background: expandedCategory === cat.key ? 'var(--text)' : 'var(--surface)',
                color: expandedCategory === cat.key ? 'var(--surface)' : 'var(--text)',
                border: expandedCategory === cat.key ? '2px solid var(--text)' : '1px solid var(--border)'
              }}
            >
              {cat.label} ({cat.count})
            </button>
          ))}
        </div>

        {/* Parts List */}
        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
          {expandedCategory && (quote as any)[expandedCategory]?.map((part: PartAssessment) => (
            <div 
              key={part.id}
              style={{ 
                padding: '12px',
                marginBottom: '8px',
                background: 'var(--surface)',
                border: `2px solid ${getPriorityColor(part.priority)}`
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div className="text" style={{ fontWeight: 'bold' }}>
                    {part.part_name}
                  </div>
                  <div className="text text-small text-muted">
                    Part #{part.oem_part_number} • Category: {part.category}
                  </div>
                  <div className="text text-small" style={{ marginTop: '4px' }}>
                    Issues: {part.issues.join(', ') || 'None detected'}
                  </div>
                </div>
                
                <div style={{ textAlign: 'right', minWidth: '120px' }}>
                  <div className="text text-small text-muted">Condition</div>
                  <div className="text" style={{ 
                    fontSize: '16pt',
                    fontWeight: 'bold',
                    color: getConditionColor(part.current_condition_grade)
                  }}>
                    {part.current_condition_grade}/10
                  </div>
                  <div className="text text-small text-muted">
                    Worth: {formatCurrency(part.current_value_cents)}
                  </div>
                </div>
              </div>

              {/* Repair vs Replace Options */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: part.repair_option ? '1fr 1fr' : '1fr', 
                gap: '8px', 
                marginTop: '12px' 
              }}>
                {part.repair_option && (
                  <div style={{ 
                    padding: '8px', 
                    background: part.recommendation === 'repair' ? 'rgba(0, 128, 0, 0.1)' : 'transparent',
                    border: part.recommendation === 'repair' ? '1px solid #008000' : '1px solid var(--border)'
                  }}>
                    <div className="text text-small" style={{ fontWeight: 'bold' }}>
                      {part.recommendation === 'repair' && '✅ '} REPAIR
                    </div>
                    <div className="text text-small">
                      Cost: {formatCurrency(part.repair_option.cost_cents)}<br/>
                      Time: {part.repair_option.time_minutes} min<br/>
                      Result: {part.repair_option.result_grade}/10
                    </div>
                    <div className="text text-small text-muted" style={{ marginTop: '4px' }}>
                      {part.repair_option.description}
                    </div>
                  </div>
                )}

                <div style={{ 
                  padding: '8px', 
                  background: part.recommendation === 'replace' ? 'rgba(0, 128, 0, 0.1)' : 'transparent',
                  border: part.recommendation === 'replace' ? '1px solid #008000' : '1px solid var(--border)'
                }}>
                  <div className="text text-small" style={{ fontWeight: 'bold' }}>
                    {part.recommendation === 'replace' && '✅ '} REPLACE
                  </div>
                  <div className="text text-small">
                    Cost: {formatCurrency(part.replace_option.cost_cents)}<br/>
                    Time: {part.replace_option.time_minutes} min<br/>
                    Result: {part.replace_option.result_grade}/10
                  </div>
                  <div className="text text-small text-muted" style={{ marginTop: '4px' }}>
                    {part.replace_option.supplier}
                  </div>
                </div>
              </div>

              {/* ROI */}
              {part.roi_percentage > 0 && (
                <div className="text text-small" style={{ 
                  marginTop: '8px', 
                  padding: '4px 8px',
                  background: 'rgba(0, 128, 0, 0.1)',
                  color: '#008000'
                }}>
                  ROI: {part.roi_percentage.toFixed(0)}% return on investment
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Timeline Estimate */}
      {quote.timeline_estimate && quote.timeline_estimate.length > 0 && (
        <div className="card" style={{ padding: '20px' }}>
          <div className="text" style={{ fontSize: '12pt', fontWeight: 'bold', marginBottom: '16px' }}>
            Phased Restoration Plan
          </div>
          
          {quote.timeline_estimate.map((phase, idx) => (
            <div 
              key={idx}
              style={{ 
                display: 'flex',
                padding: '12px',
                marginBottom: '8px',
                background: 'var(--surface)',
                border: '1px solid var(--border)'
              }}
            >
              <div style={{ 
                width: '40px', 
                height: '40px', 
                borderRadius: '50%',
                background: 'var(--text)',
                color: 'var(--surface)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 'bold',
                marginRight: '12px',
                flexShrink: 0
              }}>
                {idx + 1}
              </div>
              
              <div style={{ flex: 1 }}>
                <div className="text" style={{ fontWeight: 'bold' }}>
                  {phase.phase}
                </div>
                <div className="text text-small text-muted">
                  Duration: {phase.duration_weeks} weeks • Cost: {formatCurrency(phase.cost_cents)}
                </div>
                <div className="text text-small" style={{ marginTop: '4px' }}>
                  Parts: {phase.parts.join(', ')}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Funding Options */}
      {quote.funding_options && quote.funding_options.length > 0 && (
        <div className="card" style={{ 
          padding: '20px',
          background: 'linear-gradient(135deg, rgba(0, 128, 0, 0.05) 0%, var(--surface) 100%)',
          border: '2px solid #008000'
        }}>
          <div className="text" style={{ fontSize: '12pt', fontWeight: 'bold', marginBottom: '12px' }}>
            💰 Funding Available
          </div>
          
          <div className="text" style={{ fontSize: '18pt', fontWeight: 'bold', marginBottom: '16px' }}>
            {formatCurrency(quote.recommended_funding_cents)} Ready to Deploy
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {quote.funding_options.map((option, idx) => (
              <div 
                key={idx}
                style={{ 
                  padding: '12px',
                  background: 'var(--bg)',
                  border: '1px solid var(--border)'
                }}
              >
                <div className="text" style={{ fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>
                  {option.type}
                </div>
                <div className="text" style={{ fontSize: '14pt', marginBottom: '8px' }}>
                  {formatCurrency(option.amount_cents)}
                </div>
                <div className="text text-small text-muted">
                  {option.terms}
                </div>
                <div className="text text-small" style={{ marginTop: '8px', color: '#008000' }}>
                  Est. Returns: {option.returns_estimate}
                </div>
              </div>
            ))}
          </div>

          <button 
            className="button button-primary"
            style={{ 
              width: '100%', 
              marginTop: '16px',
              padding: '12px',
              fontSize: '11pt',
              fontWeight: 'bold'
            }}
            onClick={() => {
              // Open to market with this quote
              window.location.href = `/market/create-offering?vehicle=${vehicleId}&quote=${quote.generated_at}`;
            }}
          >
            Open to Market Partnership →
          </button>
        </div>
      )}

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: '12px' }}>
        <button className="button button-secondary" onClick={generateQuote}>
          ↻ Regenerate Quote
        </button>
        <button 
          className="button button-secondary"
          onClick={() => {
            // Download as PDF
            console.log('Export to PDF:', quote);
          }}
        >
          Export PDF
        </button>
        <button 
          className="button button-secondary"
          onClick={() => {
            // Share with owner
            console.log('Share with owner:', quote);
          }}
        >
          Share with Owner
        </button>
      </div>
    </div>
  );
};

export default RestorationQuoteGenerator;

