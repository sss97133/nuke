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
          <div style={{ padding: '40px', textAlign: 'center', fontSize: '12px', color: 'var(--text-secondary)' }}>
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
          <div style={{ padding: '40px', textAlign: 'center', fontSize: '12px', color: 'var(--text-secondary)' }}>
            Score data unavailable
          </div>
        </div>
      </div>
    );
  }

  const score = explanation.score;
  const scoreBg = score == null ? 'var(--text-disabled)' : score >= 80 ? 'var(--text)' : score >= 60 ? 'var(--text)' : score >= 40 ? 'var(--text-secondary)' : 'var(--text-disabled)';
  const scoreLabel = score == null ? 'N/A' : score >= 80 ? 'EXCELLENT' : score >= 60 ? 'GOOD' : score >= 40 ? 'FAIR' : 'NEEDS DATA';

  // Total weight for percentage calc
  const totalWeight = explanation.factors.reduce((sum, f) => sum + (f.normalized != null ? f.weight : 0), 0);

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '2px solid var(--text)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: '9px', color: 'var(--text-disabled)', textTransform: 'uppercase', letterSpacing: '1px' }}>
              Score Breakdown
            </div>
            <div style={{ fontSize: '19px', fontWeight: 800, marginTop: '2px' }}>
              {explanation.label}
            </div>
            {vehicleTitle && (
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>{vehicleTitle}</div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: 56,
                height: 56, background: scoreBg,
                color: 'var(--bg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '27px',
                fontWeight: 800,
                border: '2px solid var(--text)',
              }}>
                {score ?? '--'}
              </div>
              <div style={{ fontSize: '8px', fontWeight: 700, color: scoreBg, marginTop: '3px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {scoreLabel}
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                width: 28,
                height: 28,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                cursor: 'pointer',
                fontSize: '19px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-disabled)',
              }}
            >
              &times;
            </button>
          </div>
        </div>

        {/* Description */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
          {explanation.description}
        </div>

        {/* Scrollable content */}
        <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '0 20px 20px' }}>

          {/* Factors breakdown */}
          <div style={{ marginTop: '16px' }}>
            <div style={sectionHeaderStyle}>Input Factors</div>
            <div style={{ border: '1px solid var(--border)' }}>
              {/* Column headers */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 70px 70px 50px',
                padding: '6px 10px',
                background: 'var(--bg)',
                borderBottom: '1px solid var(--border)',
                fontSize: '8px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                color: 'var(--text-disabled)',
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
                    borderBottom: i < explanation.factors.length - 1 ? '1px solid var(--border)' : 'none',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 600 }}>{f.name}</div>
                    <div style={{ fontSize: '8px', color: 'var(--text-disabled)', marginTop: '1px' }}>{f.scale}</div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '12px', fontWeight: 700 }}>
                    {f.raw != null ? (typeof f.raw === 'number' ? f.raw.toLocaleString() : f.raw) : <span style={{ color: 'var(--text-disabled)' }}>--</span>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {f.normalized != null ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                        <div style={{
                          width: '30px',
                          height: '4px',
                          background: 'var(--bg)',
                          position: 'relative',
                        }}>
                          <div style={{
                            height: '100%',
                            width: `${f.normalized}%`,
                            background: f.normalized >= 70 ? 'var(--text)' : f.normalized >= 40 ? 'var(--text-secondary)' : 'var(--text-disabled)',
                          }} />
                        </div>
                        <span style={{ fontSize: '12px', fontWeight: 700, minWidth: '20px' }}>{f.normalized}</span>
                      </div>
                    ) : (
                      <span style={{ fontSize: '11px', color: 'var(--text-disabled)' }}>--</span>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '11px', color: 'var(--text-secondary)' }}>
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
              <div style={{ border: '1px solid var(--border)' }}>
                {explanation.bonuses.map((b, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 10px',
                      borderBottom: i < explanation.bonuses.length - 1 ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{
                          width: 8,
                          height: 8, background: b.present ? (b.value >= 0 ? 'var(--success)' : 'var(--error)') : 'var(--border)',
                        }} />
                        <span style={{ fontSize: '11px', fontWeight: 600 }}>{b.name}</span>
                      </div>
                      <div style={{ fontSize: '9px', color: 'var(--text-disabled)', marginTop: '2px', marginLeft: '14px' }}>
                        {b.reason}
                      </div>
                    </div>
                    <div style={{
                      fontSize: '12px',
                      fontWeight: 800,
                      color: !b.present ? 'var(--text-disabled)' : b.value > 0 ? 'var(--success)' : b.value < 0 ? 'var(--error)' : 'var(--text-secondary)',
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
                  fontSize: '8px',
                  padding: '2px 8px',
                  border: '1px solid var(--border)',
                  background: showFormula ? 'var(--text)' : 'var(--surface)',
                  color: showFormula ? 'var(--bg)' : 'var(--text-secondary)',
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
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              fontFamily: "'Courier New', monospace",
              fontSize: '12px',
              color: 'var(--text)',
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
                    background: 'var(--text)',
                    color: 'var(--bg)',
                    fontSize: '9px',
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
                <span style={{ fontWeight: 400, color: 'var(--text-disabled)', fontSize: '9px' }}>
                  {commentCount} comment{commentCount !== 1 ? 's' : ''}
                </span>
              </div>
              <div style={{ border: '1px solid var(--border)' }}>
                {comments.slice(0, 5).map((c, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '8px 10px',
                      borderBottom: i < Math.min(comments.length, 5) - 1 ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                      <span style={{ fontSize: '9px', fontWeight: 700 }}>{c.user || 'Anonymous'}</span>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        {c.sentiment && (
                          <span style={{
                            fontSize: '8px',
                            padding: '1px 4px',
                            background: c.sentiment === 'positive' ? 'var(--success-dim)' : c.sentiment === 'negative' ? 'var(--error-dim)' : 'var(--bg)',
                            color: c.sentiment === 'positive' ? 'var(--success)' : c.sentiment === 'negative' ? 'var(--error)' : 'var(--text-secondary)',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                          }}>
                            {c.sentiment}
                          </span>
                        )}
                        <span style={{ fontSize: '8px', color: 'var(--text-disabled)' }}>
                          {c.date ? new Date(c.date).toLocaleDateString() : ''}
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: '9px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
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
                border: '1px solid var(--border)',
                background: 'var(--bg)',
              }}>
                <div style={{ display: 'flex', gap: '16px', marginBottom: '8px' }}>
                  <div>
                    <div style={{ fontSize: '8px', color: 'var(--text-disabled)', textTransform: 'uppercase' }}>Sentiment</div>
                    <div style={{ fontSize: '13px', fontWeight: 800 }}>{aiAnalysis.overall_sentiment || '--'}</div>
                  </div>
                  {aiAnalysis.sentiment_score != null && (
                    <div>
                      <div style={{ fontSize: '8px', color: 'var(--text-disabled)', textTransform: 'uppercase' }}>Score</div>
                      <div style={{ fontSize: '13px', fontWeight: 800 }}>{aiAnalysis.sentiment_score}/100</div>
                    </div>
                  )}
                </div>
                {aiAnalysis.key_themes && (
                  <div style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>
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
                fontSize: '8px',
                padding: '1px 6px',
                background: 'var(--text)',
                color: 'var(--bg)',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>
                Coming Soon
              </span>
            </div>
            <div style={{
              padding: '16px',
              border: '1px solid var(--border)',
              background: 'var(--bg)',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>
                "Users Like You" Score Adjustments
              </div>
              <div style={{ fontSize: '9px', color: 'var(--text-disabled)', lineHeight: '1.5', maxWidth: '300px', margin: '0 auto' }}>
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
  background: 'var(--overlay)',
  zIndex: 9999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '20px',
};

const modalStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '2px solid var(--text)',
  width: '100%',
  maxWidth: '520px',
  maxHeight: '90vh',
  display: 'flex',
  flexDirection: 'column', };

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: '9px',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '1px',
  marginBottom: '6px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};
