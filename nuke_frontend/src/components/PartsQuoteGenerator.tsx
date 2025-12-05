import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface PartsQuoteGeneratorProps {
  vehicleId: string;
  vehicleInfo: {
    year: number;
    make: string;
    model: string;
  };
}

interface RecommendedPart {
  part_name: string;
  oem_part_number: string;
  issue: string;
  priority: 'critical' | 'high' | 'medium' | 'low' | 'cosmetic';
  confidence: number;
  catalog_matches: any[];
  estimated_cost: number;
}

export function PartsQuoteGenerator({ vehicleId, vehicleInfo }: PartsQuoteGeneratorProps) {
  const [loading, setLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<RecommendedPart[]>([]);
  const [selectedParts, setSelectedParts] = useState<Set<number>>(new Set());
  const [laborHours, setLaborHours] = useState(0);
  const [laborRate, setLaborRate] = useState(125);

  const generateQuote = async () => {
    setLoading(true);
    
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/recommend-parts-for-vehicle`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ vehicle_id: vehicleId })
        }
      );

      const data = await response.json();
      
      if (data.recommendations) {
        setRecommendations(data.recommendations);
        // Auto-select critical and high priority parts
        const autoSelect = new Set<number>();
        data.recommendations.forEach((r: RecommendedPart, i: number) => {
          if (r.priority === 'critical' || r.priority === 'high') {
            autoSelect.add(i);
          }
        });
        setSelectedParts(autoSelect);
      }
    } catch (error) {
      console.error('Error generating quote:', error);
    } finally {
      setLoading(false);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return '#dc2626';
      case 'high': return '#ea580c';
      case 'medium': return '#ca8a04';
      case 'low': return '#65a30d';
      case 'cosmetic': return '#0891b2';
      default: return '#666';
    }
  };

  const calculateTotal = () => {
    const partsTotal = Array.from(selectedParts).reduce((sum, idx) => {
      return sum + (recommendations[idx]?.estimated_cost || 0);
    }, 0);

    const laborTotal = laborHours * laborRate;
    const subtotal = partsTotal + laborTotal;
    const tax = subtotal * 0.08; // 8% tax estimate
    
    return {
      parts: partsTotal,
      labor: laborTotal,
      subtotal,
      tax,
      total: subtotal + tax
    };
  };

  const saveQuote = async () => {
    const totals = calculateTotal();
    const selectedRecommendations = Array.from(selectedParts).map(idx => recommendations[idx]);

    const { data, error } = await supabase
      .from('parts_quotes')
      .insert({
        vehicle_id: vehicleId,
        quote_name: `${vehicleInfo.year} ${vehicleInfo.make} ${vehicleInfo.model} - AI Generated`,
        identified_parts: selectedRecommendations,
        parts: selectedRecommendations.map((r, i) => ({
          part_name: r.part_name,
          part_number: r.catalog_matches[0]?.part_number,
          quantity: 1,
          unit_price: r.estimated_cost,
          supplier: 'LMC'
        })),
        parts_subtotal: totals.parts,
        labor_hours: laborHours,
        labor_rate: laborRate,
        labor_total: totals.labor,
        grand_total: totals.total,
        ai_confidence: recommendations.reduce((sum, r) => sum + r.confidence, 0) / recommendations.length,
        status: 'draft'
      })
      .select()
      .single();

    if (!error) {
      alert('Quote saved! View it in your vehicle profile.');
    }
  };

  const total = calculateTotal();

  return (
    <div style={{ padding: '16px', background: '#fff', border: '2px solid #000' }}>
      
      {/* Header */}
      <div style={{ marginBottom: '16px', borderBottom: '2px solid #000', paddingBottom: '12px' }}>
        <h2 style={{ fontSize: '12pt', fontWeight: 700, marginBottom: '4px' }}>
          AI PARTS QUOTE GENERATOR
        </h2>
        <div style={{ fontSize: '8pt', color: '#666' }}>
          {vehicleInfo.year} {vehicleInfo.make} {vehicleInfo.model}
        </div>
      </div>

      {/* Generate Button */}
      {recommendations.length === 0 && (
        <button
          onClick={generateQuote}
          disabled={loading}
          style={{
            width: '100%',
            padding: '16px',
            fontSize: '10pt',
            fontWeight: 700,
            border: '2px solid #000',
            background: loading ? '#ccc' : '#000',
            color: '#fff',
            cursor: loading ? 'wait' : 'pointer',
            marginBottom: '16px'
          }}
        >
          {loading ? '🤖 ANALYZING VEHICLE IMAGES...' : '🤖 GENERATE AI QUOTE'}
        </button>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <>
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '8px' }}>
              RECOMMENDED PARTS ({recommendations.length} found)
            </div>
            
            {recommendations.map((rec, idx) => (
              <div 
                key={idx}
                style={{
                  marginBottom: '8px',
                  padding: '12px',
                  background: selectedParts.has(idx) ? '#f0f8ff' : '#f8f8f8',
                  border: `2px solid ${selectedParts.has(idx) ? '#0066cc' : '#ddd'}`,
                  cursor: 'pointer'
                }}
                onClick={() => {
                  const newSet = new Set(selectedParts);
                  if (newSet.has(idx)) {
                    newSet.delete(idx);
                  } else {
                    newSet.add(idx);
                  }
                  setSelectedParts(newSet);
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '4px' }}>
                      <input
                        type="checkbox"
                        checked={selectedParts.has(idx)}
                        readOnly
                        style={{ marginRight: '8px' }}
                      />
                      {rec.part_name}
                    </div>
                    <div style={{ fontSize: '8pt', color: '#666', marginBottom: '4px' }}>
                      {rec.issue}
                    </div>
                    <div style={{ fontSize: '7pt' }}>
                      <span style={{ 
                        padding: '2px 6px', 
                        background: getPriorityColor(rec.priority),
                        color: '#fff',
                        borderRadius: '2px',
                        marginRight: '8px'
                      }}>
                        {rec.priority.toUpperCase()}
                      </span>
                      <span style={{ color: '#666' }}>
                        {rec.confidence}% confidence
                      </span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '12pt', fontWeight: 700 }}>
                      ${rec.estimated_cost?.toFixed(2) || 'N/A'}
                    </div>
                    {rec.catalog_matches.length > 0 && (
                      <div style={{ fontSize: '7pt', color: '#666' }}>
                        {rec.catalog_matches[0].part_number}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Labor */}
          <div style={{ marginBottom: '16px', padding: '12px', background: '#f8f8f8', border: '2px solid #000' }}>
            <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '8px' }}>
              LABOR ESTIMATE
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '8pt', display: 'block', marginBottom: '4px' }}>
                  Hours
                </label>
                <input
                  type="number"
                  value={laborHours}
                  onChange={(e) => setLaborHours(parseFloat(e.target.value) || 0)}
                  step="0.5"
                  style={{
                    width: '100%',
                    padding: '6px',
                    fontSize: '8pt',
                    border: '2px solid #000'
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '8pt', display: 'block', marginBottom: '4px' }}>
                  Rate ($/hr)
                </label>
                <input
                  type="number"
                  value={laborRate}
                  onChange={(e) => setLaborRate(parseFloat(e.target.value) || 0)}
                  style={{
                    width: '100%',
                    padding: '6px',
                    fontSize: '8pt',
                    border: '2px solid #000'
                  }}
                />
              </div>
            </div>
          </div>

          {/* Quote Summary */}
          <div style={{ padding: '12px', background: '#000', color: '#fff', border: '2px solid #000', marginBottom: '16px' }}>
            <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '8px' }}>
              QUOTE SUMMARY
            </div>
            <div style={{ fontSize: '8pt', display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span>Parts ({Array.from(selectedParts).length} items):</span>
              <span>${total.parts.toFixed(2)}</span>
            </div>
            <div style={{ fontSize: '8pt', display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span>Labor ({laborHours}hrs @ ${laborRate}/hr):</span>
              <span>${total.labor.toFixed(2)}</span>
            </div>
            <div style={{ fontSize: '8pt', display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span>Subtotal:</span>
              <span>${total.subtotal.toFixed(2)}</span>
            </div>
            <div style={{ fontSize: '8pt', display: 'flex', justifyContent: 'space-between', marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid #666' }}>
              <span>Tax (est.):</span>
              <span>${total.tax.toFixed(2)}</span>
            </div>
            <div style={{ fontSize: '14pt', fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>
              <span>TOTAL:</span>
              <span>${total.total.toFixed(2)}</span>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={saveQuote}
              style={{
                flex: 1,
                padding: '12px',
                fontSize: '8pt',
                fontWeight: 700,
                border: '2px solid #000',
                background: '#000',
                color: '#fff',
                cursor: 'pointer'
              }}
            >
              SAVE QUOTE
            </button>
            <button
              onClick={generateQuote}
              style={{
                padding: '12px 16px',
                fontSize: '8pt',
                fontWeight: 700,
                border: '2px solid #000',
                background: '#fff',
                cursor: 'pointer'
              }}
            >
              REGENERATE
            </button>
          </div>
        </>
      )}
    </div>
  );
}

