import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import './MergeProposalsDashboard.css';

interface MergeProposal {
  id: string;
  match_type: string;
  confidence_score: number;
  status: string;
  ai_summary?: string;
  created_at: string;
  match_reasoning?: any;
  
  primary_vehicle: {
    id: string;
    year: number;
    make: string;
    model: string;
    vin?: string;
    image_count: number;
    event_count: number;
    [key: string]: any;
  };
  
  duplicate_vehicle: {
    id: string;
    year: number;
    make: string;
    model: string;
    vin?: string;
    image_count: number;
    event_count: number;
    [key: string]: any;
  };
}

interface FieldMerge {
  field: string;
  primaryValue: any;
  duplicateValue: any;
  winningValue: any;
  confidence: number;
  source: 'primary' | 'duplicate' | 'both' | 'null';
  oldValue?: any;
}

export default function MergeProposalsDashboard() {
  const navigate = useNavigate();
  const [proposals, setProposals] = useState<MergeProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedProposals, setExpandedProposals] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState({
    total: 0,
    needs_review: 0,
    high_confidence: 0,
    merged: 0
  });

  useEffect(() => {
    loadProposals();
  }, []);

  const loadProposals = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .rpc('get_merge_proposals_with_details');

      if (error) {
        console.error('Failed to load proposals:', error);
        
        const { data: proposalsData } = await supabase
          .from('vehicle_merge_proposals')
          .select('*')
          .order('confidence_score', { ascending: false });

        if (proposalsData) {
          const enriched = await Promise.all(
            proposalsData.map(async (p) => {
              const [primary, duplicate] = await Promise.all([
                supabase.from('vehicles').select('*').eq('id', p.primary_vehicle_id).single(),
                supabase.from('vehicles').select('*').eq('id', p.duplicate_vehicle_id).single()
              ]);

              const [primaryImages, primaryEvents, dupImages, dupEvents] = await Promise.all([
                supabase.from('vehicle_images').select('id', { count: 'exact', head: true }).eq('vehicle_id', p.primary_vehicle_id),
                supabase.from('timeline_events').select('id', { count: 'exact', head: true }).eq('vehicle_id', p.primary_vehicle_id),
                supabase.from('vehicle_images').select('id', { count: 'exact', head: true }).eq('vehicle_id', p.duplicate_vehicle_id),
                supabase.from('timeline_events').select('id', { count: 'exact', head: true }).eq('vehicle_id', p.duplicate_vehicle_id)
              ]);

              return {
                ...p,
                primary_vehicle: {
                  ...primary.data,
                  image_count: primaryImages.count || 0,
                  event_count: primaryEvents.count || 0
                },
                duplicate_vehicle: {
                  ...duplicate.data,
                  image_count: dupImages.count || 0,
                  event_count: dupEvents.count || 0
                }
              };
            })
          );

          setProposals(enriched as MergeProposal[]);
        }
      } else {
        const transformed = (data || []).map((item: any) => ({
          ...item,
          primary_vehicle: typeof item.primary_vehicle === 'object' ? item.primary_vehicle : JSON.parse(item.primary_vehicle || '{}'),
          duplicate_vehicle: typeof item.duplicate_vehicle === 'object' ? item.duplicate_vehicle : JSON.parse(item.duplicate_vehicle || '{}')
        }));
        setProposals(transformed);
      }

      const { data: statsData } = await supabase
        .from('vehicle_merge_proposals')
        .select('status, confidence_score');

      if (statsData) {
        setStats({
          total: statsData.length,
          needs_review: statsData.filter(p => ['detected', 'proposed'].includes(p.status)).length,
          high_confidence: statsData.filter(p => p.confidence_score >= 90).length,
          merged: statsData.filter(p => p.status === 'merged').length
        });
      }

    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const computeFieldMerges = (proposal: MergeProposal): FieldMerge[] => {
    const fields = [
      'year', 'make', 'model', 'trim', 'vin', 'color', 'mileage',
      'transmission', 'drivetrain', 'engine_size', 'body_style',
      'current_value', 'sale_price', 'purchase_price', 'description'
    ];

    const primary = proposal.primary_vehicle;
    const duplicate = proposal.duplicate_vehicle;
    const overallConfidence = proposal.confidence_score;

    return fields.map(field => {
      const primaryVal = primary[field];
      const duplicateVal = duplicate[field];
      
      const effectiveConfidence = overallConfidence < 20 ? 0 : overallConfidence;
      
      let winningValue: any = null;
      let source: 'primary' | 'duplicate' | 'both' | 'null' = 'null';
      let confidence = 0;
      let oldValue: any = null;

      if ((!primaryVal || primaryVal === '') && (!duplicateVal || duplicateVal === '')) {
        source = 'null';
        confidence = 0;
      }
      else if (primaryVal && primaryVal !== '' && (!duplicateVal || duplicateVal === '')) {
        winningValue = primaryVal;
        source = 'primary';
        confidence = effectiveConfidence >= 50 ? effectiveConfidence : Math.max(effectiveConfidence, 50);
        oldValue = primaryVal;
      }
      else if ((!primaryVal || primaryVal === '') && duplicateVal && duplicateVal !== '') {
        winningValue = duplicateVal;
        source = 'duplicate';
        confidence = effectiveConfidence >= 50 ? effectiveConfidence : Math.max(effectiveConfidence, 50);
        oldValue = primaryVal;
      }
      else {
        if (field === 'vin') {
          const primaryIsReal = primaryVal && !primaryVal.startsWith('VIVA-');
          const duplicateIsReal = duplicateVal && !duplicateVal.startsWith('VIVA-');
          
          if (primaryIsReal && !duplicateIsReal) {
            winningValue = primaryVal;
            source = 'primary';
            confidence = 90;
            oldValue = duplicateVal;
          } else if (!primaryIsReal && duplicateIsReal) {
            winningValue = duplicateVal;
            source = 'duplicate';
            confidence = 90;
            oldValue = primaryVal;
          } else if (primaryIsReal && duplicateIsReal && primaryVal === duplicateVal) {
            winningValue = primaryVal;
            source = 'both';
            confidence = 95;
            oldValue = primaryVal;
          } else {
            winningValue = primaryVal;
            source = 'primary';
            confidence = effectiveConfidence;
            oldValue = duplicateVal;
          }
        }
        else if (field === 'mileage' || field === 'current_value' || field === 'sale_price' || field === 'purchase_price') {
          const numPrimary = Number(primaryVal) || 0;
          const numDuplicate = Number(duplicateVal) || 0;
          
          if (numPrimary === numDuplicate) {
            winningValue = primaryVal;
            source = 'both';
            confidence = Math.min(effectiveConfidence + 10, 95);
            oldValue = primaryVal;
          } else if (effectiveConfidence >= 80) {
            winningValue = numPrimary >= numDuplicate ? primaryVal : duplicateVal;
            source = numPrimary >= numDuplicate ? 'primary' : 'duplicate';
            confidence = effectiveConfidence;
            oldValue = numPrimary >= numDuplicate ? duplicateVal : primaryVal;
          } else {
            winningValue = primaryVal;
            source = 'primary';
            confidence = Math.max(effectiveConfidence - 10, 20);
            oldValue = duplicateVal;
          }
        }
        else {
          if (primaryVal === duplicateVal) {
            winningValue = primaryVal;
            source = 'both';
            confidence = Math.min(effectiveConfidence + 10, 95);
            oldValue = primaryVal;
          } else {
            winningValue = primaryVal;
            source = 'primary';
            confidence = Math.max(effectiveConfidence - 15, 30);
            oldValue = duplicateVal;
          }
        }
      }

      if (confidence < 20) {
        winningValue = null;
        source = 'null';
      }

      return {
        field,
        primaryValue: primaryVal || null,
        duplicateValue: duplicateVal || null,
        winningValue,
        confidence,
        source,
        oldValue: source === 'primary' ? duplicateVal : source === 'duplicate' ? primaryVal : null
      };
    }).filter(fm => fm.primaryValue !== null || fm.duplicateValue !== null || fm.winningValue !== null);
  };

  const formatFieldValue = (value: any): string => {
    if (value === null || value === undefined || value === '') return 'null';
    if (typeof value === 'number') return value.toLocaleString();
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
  };

  const formatFieldName = (field: string): string => {
    return field.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  const getConfidenceColor = (confidence: number): string => {
    if (confidence < 20) return 'var(--text-disabled)';
    if (confidence < 50) return 'var(--error)';
    if (confidence < 80) return 'var(--warning)';
    return 'var(--success)';
  };

  const getMatchTypeBadge = (matchType: string) => {
    const colors: Record<string, string> = {
      'vin_exact': 'var(--success)',
      'year_make_model_exact': 'var(--accent)',
      'year_make_model_fuzzy': 'var(--warning)',
      'dropbox_duplicate': 'var(--error)'
    };

    return (
      <span className="merge-badge" style={{ background: colors[matchType] || 'var(--text-disabled)' }}>
        {matchType.replace(/_/g, ' ').toUpperCase()}
      </span>
    );
  };

  const toggleExpanded = (proposalId: string) => {
    setExpandedProposals(prev => {
      const next = new Set(prev);
      if (next.has(proposalId)) {
        next.delete(proposalId);
      } else {
        next.add(proposalId);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="merge-dashboard">
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Loading merge proposals...</p>
        </div>
      </div>
    );
  }

  const pendingProposals = proposals.filter(p => ['detected', 'proposed'].includes(p.status));

  return (
    <div className="merge-dashboard">
      <div className="merge-header">
        <h1 className="merge-title">Vehicle Merge Proposals</h1>
        <p className="merge-subtitle">AI-detected duplicate vehicle profiles requiring owner review</p>
      </div>

      <div className="merge-stats">
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--accent)' }}>{stats.total}</div>
          <div className="stat-label">Total Proposals</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--warning)' }}>{stats.needs_review}</div>
          <div className="stat-label">Needs Review</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--success)' }}>{stats.high_confidence}</div>
          <div className="stat-label">High Confidence</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--text-disabled)' }}>{stats.merged}</div>
          <div className="stat-label">Already Merged</div>
        </div>
      </div>

      <div className="merge-proposals-list">
        {pendingProposals.map(proposal => {
          const primary = proposal.primary_vehicle;
          const duplicate = proposal.duplicate_vehicle;
          const fieldMerges = computeFieldMerges(proposal);
          const isExpanded = expandedProposals.has(proposal.id);

          return (
            <div key={proposal.id} className="merge-proposal-card">
              <div className="proposal-header">
                <div className="proposal-badges">
                  {getMatchTypeBadge(proposal.match_type)}
                  <span 
                    className="confidence-badge"
                    style={{
                      background: proposal.confidence_score >= 90 ? 'var(--success)' : 'var(--warning)'
                    }}
                  >
                    {proposal.confidence_score}% MATCH
                  </span>
                </div>
                <div className="proposal-meta">
                  Detected {new Date(proposal.created_at).toLocaleDateString()}
                </div>
              </div>

              <div className="vehicle-comparison">
                <div className="vehicle-card vehicle-primary">
                  <div className="vehicle-label">PRIMARY (KEEP)</div>
                  <div className="vehicle-title">
                    {primary.year} {primary.make} {primary.model}
                  </div>
                  <div className="vehicle-detail">
                    VIN: {primary.vin || 'None'}
                    {primary.vin?.startsWith('VIVA-') && <span className="vin-auto"> (auto)</span>}
                  </div>
                  <div className="vehicle-stats">
                    {primary.image_count} photos • {primary.event_count} events
                  </div>
                  <button
                    onClick={() => navigate(`/vehicle/${primary.id}`)}
                    className="button button-small button-secondary"
                  >
                    View Profile
                  </button>
                </div>

                <div className="merge-arrow">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2">
                    <line x1="5" y1="12" x2="19" y2="12"/>
                    <polyline points="12 5 19 12 12 19"/>
                  </svg>
                </div>

                <div className="vehicle-card vehicle-duplicate">
                  <div className="vehicle-label vehicle-label-duplicate">DUPLICATE (MERGE)</div>
                  <div className="vehicle-title">
                    {duplicate.year} {duplicate.make} {duplicate.model}
                  </div>
                  <div className="vehicle-detail">
                    VIN: {duplicate.vin || 'None'}
                    {duplicate.vin?.startsWith('VIVA-') && <span className="vin-auto"> (auto)</span>}
                  </div>
                  <div className="vehicle-stats vehicle-stats-duplicate">
                    {duplicate.image_count} photos • {duplicate.event_count} events
                  </div>
                  <button
                    onClick={() => navigate(`/vehicle/${duplicate.id}`)}
                    className="button button-small button-secondary"
                  >
                    View Profile
                  </button>
                </div>
              </div>

              {proposal.ai_summary && (
                <div className="ai-summary">
                  {proposal.ai_summary}
                </div>
              )}

              <button
                onClick={() => toggleExpanded(proposal.id)}
                className="expand-details-button"
              >
                {isExpanded ? 'Hide' : 'Show'} Field-by-Field Merge Details
              </button>

              {isExpanded && (
                <div className="field-merge-details">
                  <div className="field-merge-header">
                    <h3>Field Merge Analysis</h3>
                    <p className="field-merge-note">
                      Shows what data (x) will become (y) with confidence scores. 
                      Low confidence (&lt;20) is treated as null.
                    </p>
                  </div>
                  <div className="field-merge-table">
                    <div className="field-merge-row field-merge-header-row">
                      <div className="field-col">Field</div>
                      <div className="value-col">Primary Value</div>
                      <div className="value-col">Duplicate Value</div>
                      <div className="merge-col">Will Become</div>
                      <div className="confidence-col">Confidence</div>
                      <div className="source-col">Source</div>
                    </div>
                    {fieldMerges.map((fm, idx) => (
                      <div key={idx} className="field-merge-row">
                        <div className="field-col field-name">{formatFieldName(fm.field)}</div>
                        <div className="value-col">
                          <span className={fm.primaryValue === null ? 'value-null' : ''}>
                            {formatFieldValue(fm.primaryValue)}
                          </span>
                        </div>
                        <div className="value-col">
                          <span className={fm.duplicateValue === null ? 'value-null' : ''}>
                            {formatFieldValue(fm.duplicateValue)}
                          </span>
                        </div>
                        <div className="merge-col">
                          <span className={fm.winningValue === null ? 'value-null' : 'value-winning'}>
                            {formatFieldValue(fm.winningValue)}
                          </span>
                          {fm.oldValue !== null && fm.oldValue !== fm.winningValue && (
                            <div className="old-value-note">
                              (was: {formatFieldValue(fm.oldValue)})
                            </div>
                          )}
                        </div>
                        <div className="confidence-col">
                          <span 
                            className="confidence-indicator"
                            style={{ color: getConfidenceColor(fm.confidence) }}
                          >
                            {fm.confidence}%
                          </span>
                        </div>
                        <div className="source-col">
                          <span className={`source-badge source-${fm.source}`}>
                            {fm.source === 'both' ? 'Both Match' : 
                             fm.source === 'primary' ? 'Primary' :
                             fm.source === 'duplicate' ? 'Duplicate' : 'Null'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="action-hint">
                <strong>Owner Action Required:</strong> The verified owner must review this proposal on their vehicle profile page.
              </div>
            </div>
          );
        })}

        {pendingProposals.length === 0 && (
          <div className="card empty-state">
            <div className="empty-title">No Pending Merge Proposals</div>
            <div className="empty-message">
              All detected duplicates have been reviewed or merged.
            </div>
          </div>
        )}
      </div>

      {stats.merged > 0 && (
        <div className="merge-history">
          <h2 className="history-title">Merge History ({stats.merged} completed)</h2>
          <div className="history-note">
            Historical merge data will appear here
          </div>
        </div>
      )}
    </div>
  );
}
