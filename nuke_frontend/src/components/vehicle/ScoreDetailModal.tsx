/**
 * ScoreDetailModal
 *
 * Opens when user clicks any score in VehiclePerformanceCard.
 * Shows the full algorithm breakdown, source data, and "users like you" section.
 * Algorithm formula is blurred behind a paywall teaser.
 */

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface ScoreFactor {
  name: string;
  raw: number | string | null;
  normalized: number | null;
  weight: number;
  scale: string;
}

interface ScoreBonus {
  name: string;
  value: number;
  reason: string;
  present: boolean;
}

interface ScoreExplanation {
  score: number | null;
  label: string;
  description: string;
  factors: ScoreFactor[];
  bonuses: ScoreBonus[];
  formula_hint: string;
}

interface SourceComment {
  text: string;
  user: string;
  date: string;
  sentiment: string | null;
}

interface Props {
  vehicleId: string;
  scoreKey: string; // e.g. "power", "acceleration", "overall"
  onClose: () => void;
}

export default function ScoreDetailModal({ vehicleId, scoreKey, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [explanation, setExplanation] = useState<ScoreExplanation | null>(null);
  const [vehicleTitle, setVehicleTitle] = useState('');
  const [comments, setComments] = useState<SourceComment[]>([]);
  const [commentCount, setCommentCount] = useState(0);
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [showFormula, setShowFormula] = useState(false);

  useEffect(() => {
    loadExplanation();
  }, [vehicleId, scoreKey]);

  const loadExplanation = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('calculate-vehicle-scores', {
        body: { action: 'explain', vehicle_id: vehicleId },
      });

      if (!error && data) {
        setExplanation(data.breakdown?.[scoreKey] || null);
        setVehicleTitle(data.vehicle_title || '');
        setComments(data.source_data?.recent_comments || []);
        setCommentCount(data.source_data?.comment_count || 0);
        setAiAnalysis(data.source_data?.ai_analysis || null);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (loading) {
    return (
      <div style={overlayStyle} onClick={onClose}>
        <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
          <div style={{ padding: '40px', textAlign: 'center', fontSize: '9pt', color: '#666' }}>
            Analyzing score breakdown...
          </div>
        </div>
      </div>
    );
  }

  if (!explanation) {
    return (
      <div style={overlayStyle} onClick={onClose}>
        <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
          <div style={{ padding: '40px', textAlign: 'center', fontSize: '9pt', color: '#666' }}>
            Score data unavailable
          </div>
        </div>
      </div>
    );
  }

  const score = explanation.score;
  const scoreBg = score == null ? '#ccc' : score >= 80 ? '#000' : score >= 60 ? '#333' : score >= 40 ? '#666' : '#999';
  const scoreLabel = score == null ? 'N/A' : score >= 80 ? 'EXCELLENT' : score >= 60 ? 'GOOD' : score >= 40 ? 'FAIR' : 'NEEDS DATA';

  // Total weight for percentage calc
  const totalWeight = explanation.factors.reduce((sum, f) => sum + (f.normalized != null ? f.weight : 0), 0);

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '2px solid #000',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: '7pt', color: '#999', textTransform: 'uppercase', letterSpacing: '1px' }}>
              Score Breakdown
            </div>
            <div style={{ fontSize: '14pt', fontWeight: 800, marginTop: '2px' }}>
              {explanation.label}
            </div>
            {vehicleTitle && (
              <div style={{ fontSize: '8pt', color: '#666', marginTop: '2px' }}>{vehicleTitle}</div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: scoreBg,
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '20pt',
                fontWeight: 800,
                border: '2px solid #000',
              }}>
                {score ?? '--'}
              </div>
              <div style={{ fontSize: '6pt', fontWeight: 700, color: scoreBg, marginTop: '3px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {scoreLabel}
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                width: 28,
                height: 28,
                border: '1px solid #ddd',
                background: '#fff',
                cursor: 'pointer',
                fontSize: '14pt',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#999',
              }}
            >
              &times;
            </button>
          </div>
        </div>

        {/* Description */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #eee', fontSize: '8pt', color: '#555', lineHeight: '1.5' }}>
          {explanation.description}
        </div>

        {/* Scrollable content */}
        <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '0 20px 20px' }}>

          {/* Factors breakdown */}
          <div style={{ marginTop: '16px' }}>
            <div style={sectionHeaderStyle}>Input Factors</div>
            <div style={{ border: '1px solid #e5e5e5' }}>
              {/* Column headers */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 70px 70px 50px',
                padding: '6px 10px',
                background: '#f8f8f8',
                borderBottom: '1px solid #e5e5e5',
                fontSize: '6pt',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                color: '#999',
              }}>
                <span>Factor</span>
                <span style={{ textAlign: 'right' }}>Raw Value</span>
                <span style={{ textAlign: 'right' }}>Score /100</span>
                <span style={{ textAlign: 'right' }}>Weight</span>
              </div>

              {explanation.factors.map((f, i) => (
                <div
                  key={i}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 70px 70px 50px',
                    padding: '8px 10px',
                    borderBottom: i < explanation.factors.length - 1 ? '1px solid #f0f0f0' : 'none',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '8pt', fontWeight: 600 }}>{f.name}</div>
                    <div style={{ fontSize: '6pt', color: '#999', marginTop: '1px' }}>{f.scale}</div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '9pt', fontWeight: 700 }}>
                    {f.raw != null ? (typeof f.raw === 'number' ? f.raw.toLocaleString() : f.raw) : <span style={{ color: '#ccc' }}>--</span>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {f.normalized != null ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                        <div style={{
                          width: '30px',
                          height: '4px',
                          background: '#f0f0f0',
                          position: 'relative',
                        }}>
                          <div style={{
                            height: '100%',
                            width: `${f.normalized}%`,
                            background: f.normalized >= 70 ? '#000' : f.normalized >= 40 ? '#666' : '#999',
                          }} />
                        </div>
                        <span style={{ fontSize: '9pt', fontWeight: 700, minWidth: '20px' }}>{f.normalized}</span>
                      </div>
                    ) : (
                      <span style={{ fontSize: '8pt', color: '#ccc' }}>--</span>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '8pt', color: '#666' }}>
                    {totalWeight > 0 ? `${Math.round((f.weight / totalWeight) * 100)}%` : `w${f.weight}`}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bonuses / modifiers */}
          {explanation.bonuses.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <div style={sectionHeaderStyle}>Modifiers & Bonuses</div>
              <div style={{ border: '1px solid #e5e5e5' }}>
                {explanation.bonuses.map((b, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 10px',
                      borderBottom: i < explanation.bonuses.length - 1 ? '1px solid #f0f0f0' : 'none',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: b.present ? (b.value >= 0 ? '#2a9d2a' : '#cc3333') : '#ddd',
                        }} />
                        <span style={{ fontSize: '8pt', fontWeight: 600 }}>{b.name}</span>
                      </div>
                      <div style={{ fontSize: '7pt', color: '#888', marginTop: '2px', marginLeft: '14px' }}>
                        {b.reason}
                      </div>
                    </div>
                    <div style={{
                      fontSize: '9pt',
                      fontWeight: 800,
                      color: !b.present ? '#ccc' : b.value > 0 ? '#2a9d2a' : b.value < 0 ? '#cc3333' : '#666',
                      minWidth: '40px',
                      textAlign: 'right',
                    }}>
                      {!b.present ? 'N/A' : b.value > 0 ? `+${b.value}` : b.value === 0 ? '---' : b.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Algorithm (blurred paywall teaser) */}
          <div style={{ marginTop: '16px' }}>
            <div style={sectionHeaderStyle}>
              <span>Algorithm</span>
              <button
                onClick={() => setShowFormula(!showFormula)}
                style={{
                  fontSize: '6pt',
                  padding: '2px 8px',
                  border: '1px solid #ddd',
                  background: showFormula ? '#000' : '#fff',
                  color: showFormula ? '#fff' : '#666',
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  fontWeight: 700,
                }}
              >
                {showFormula ? 'Hide' : 'Reveal'}
              </button>
            </div>
            <div style={{
              padding: '12px',
              background: '#f8f8f8',
              border: '1px solid #e5e5e5',
              fontFamily: 'monospace',
              fontSize: '9pt',
              color: '#333',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{
                filter: showFormula ? 'none' : 'blur(4px)',
                userSelect: showFormula ? 'auto' : 'none',
                transition: 'filter 0.3s ease',
              }}>
                {explanation.formula_hint}
              </div>
              {!showFormula && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }} onClick={() => setShowFormula(true)}>
                  <div style={{
                    padding: '4px 12px',
                    background: '#000',
                    color: '#fff',
                    fontSize: '7pt',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                  }}>
                    Click to Reveal Formula
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Source data: Comments */}
          {comments.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <div style={sectionHeaderStyle}>
                Source Data
                <span style={{ fontWeight: 400, color: '#999', fontSize: '7pt' }}>
                  {commentCount} comment{commentCount !== 1 ? 's' : ''}
                </span>
              </div>
              <div style={{ border: '1px solid #e5e5e5' }}>
                {comments.slice(0, 5).map((c, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '8px 10px',
                      borderBottom: i < Math.min(comments.length, 5) - 1 ? '1px solid #f0f0f0' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                      <span style={{ fontSize: '7pt', fontWeight: 700 }}>{c.user || 'Anonymous'}</span>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        {c.sentiment && (
                          <span style={{
                            fontSize: '6pt',
                            padding: '1px 4px',
                            background: c.sentiment === 'positive' ? '#e8f5e9' : c.sentiment === 'negative' ? '#ffebee' : '#f5f5f5',
                            color: c.sentiment === 'positive' ? '#2e7d32' : c.sentiment === 'negative' ? '#c62828' : '#666',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                          }}>
                            {c.sentiment}
                          </span>
                        )}
                        <span style={{ fontSize: '6pt', color: '#bbb' }}>
                          {c.date ? new Date(c.date).toLocaleDateString() : ''}
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: '7pt', color: '#555', lineHeight: '1.4' }}>
                      {c.text}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Analysis */}
          {aiAnalysis && (
            <div style={{ marginTop: '16px' }}>
              <div style={sectionHeaderStyle}>AI Sentiment Analysis</div>
              <div style={{
                padding: '10px 12px',
                border: '1px solid #e5e5e5',
                background: '#fafafa',
              }}>
                <div style={{ display: 'flex', gap: '16px', marginBottom: '8px' }}>
                  <div>
                    <div style={{ fontSize: '6pt', color: '#999', textTransform: 'uppercase' }}>Sentiment</div>
                    <div style={{ fontSize: '10pt', fontWeight: 800 }}>{aiAnalysis.overall_sentiment || '--'}</div>
                  </div>
                  {aiAnalysis.sentiment_score != null && (
                    <div>
                      <div style={{ fontSize: '6pt', color: '#999', textTransform: 'uppercase' }}>Score</div>
                      <div style={{ fontSize: '10pt', fontWeight: 800 }}>{aiAnalysis.sentiment_score}/100</div>
                    </div>
                  )}
                </div>
                {aiAnalysis.key_themes && (
                  <div style={{ fontSize: '7pt', color: '#666' }}>
                    <strong>Key themes:</strong> {Array.isArray(aiAnalysis.key_themes) ? aiAnalysis.key_themes.join(', ') : aiAnalysis.key_themes}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Users Like You - placeholder */}
          <div style={{ marginTop: '16px' }}>
            <div style={sectionHeaderStyle}>
              Personalized Insights
              <span style={{
                fontSize: '6pt',
                padding: '1px 6px',
                background: '#000',
                color: '#fff',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>
                Coming Soon
              </span>
            </div>
            <div style={{
              padding: '16px',
              border: '1px solid #e5e5e5',
              background: '#fafafa',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '4px' }}>
                "Users Like You" Score Adjustments
              </div>
              <div style={{ fontSize: '7pt', color: '#888', lineHeight: '1.5', maxWidth: '300px', margin: '0 auto' }}>
                Personalized score adjustments based on your profile, preferences, and what buyers with similar tastes rated highest.
                Your demographics, driving style, and collection goals will fine-tune every score.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  zIndex: 9999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '20px',
};

const modalStyle: React.CSSProperties = {
  background: '#fff',
  border: '2px solid #000',
  width: '100%',
  maxWidth: '520px',
  maxHeight: '90vh',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
};

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: '7pt',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '1px',
  marginBottom: '6px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};
