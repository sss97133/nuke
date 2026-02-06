/**
 * WorkSessionEventCard - Rich display for work session timeline events
 *
 * Shows the full provenance breakdown: tools used, costs, labor time
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface WorkSessionMetadata {
  work_session_id: string;
  work_type?: string;
  tool_count?: number;
  tools_used?: string;
  parts_cost?: number;
  tool_depreciation?: number;
  labor_cost?: number;
  total_cost?: number;
  duration_minutes?: number;
}

interface ToolUsage {
  name: string;
  category: string;
  use_count: number;
  depreciation_amount: number;
}

interface Props {
  event: {
    id: string;
    title: string;
    description?: string;
    event_date: string;
    cost_amount?: number;
    duration_hours?: number;
    metadata?: WorkSessionMetadata;
  };
  expanded?: boolean;
}

const categoryColors: Record<string, string> = {
  infrastructure: '#3b82f6',
  storage: '#8b5cf6',
  diagnostic: '#f59e0b',
  hand_tool: '#10b981',
  specialty: '#ec4899',
  consumable: '#ef4444',
};

const formatCurrency = (amount: number) =>
  `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
};

export default function WorkSessionEventCard({ event, expanded: initialExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [tools, setTools] = useState<ToolUsage[]>([]);
  const [loading, setLoading] = useState(false);

  const meta = event.metadata || {} as WorkSessionMetadata;
  const workSessionId = meta.work_session_id;

  // Load detailed tool usage when expanded
  useEffect(() => {
    if (expanded && workSessionId && tools.length === 0) {
      loadToolUsage();
    }
  }, [expanded, workSessionId]);

  const loadToolUsage = async () => {
    if (!workSessionId) return;
    setLoading(true);

    const { data } = await supabase
      .from('tool_usage')
      .select(`
        use_count,
        depreciation_amount,
        tool_inventory (
          name,
          category
        )
      `)
      .eq('work_session_id', workSessionId)
      .order('depreciation_amount', { ascending: false });

    if (data) {
      setTools(data.map((t: any) => ({
        name: t.tool_inventory?.name || 'Unknown',
        category: t.tool_inventory?.category || 'other',
        use_count: t.use_count,
        depreciation_amount: t.depreciation_amount || 0
      })));
    }
    setLoading(false);
  };

  return (
    <div
      className="card"
      style={{
        border: '1px solid var(--success)',
        background: 'var(--surface)'
      }}
    >
      {/* Header - always visible */}
      <div
        className="card-body"
        style={{
          cursor: 'pointer',
          padding: 'var(--space-3)'
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
              <span style={{ fontSize: '16px' }}>🔧</span>
              <span className="font-bold">{event.title || 'Work Session'}</span>
              {meta.work_type && (
                <span
                  className="badge"
                  style={{
                    background: 'var(--primary-bg)',
                    color: 'var(--primary)',
                    fontSize: '9px'
                  }}
                >
                  {meta.work_type.replace('_', ' ')}
                </span>
              )}
            </div>

            {event.description && (
              <p className="text-small text-muted" style={{ margin: 0 }}>
                {event.description}
              </p>
            )}
          </div>

          <div style={{ textAlign: 'right' }}>
            <div className="font-bold" style={{ color: 'var(--success)' }}>
              {formatCurrency(event.cost_amount || meta.total_cost || 0)}
            </div>
            <div className="text-small text-muted">
              {meta.duration_minutes ? formatDuration(meta.duration_minutes) :
               event.duration_hours ? `${event.duration_hours}h` : ''}
            </div>
          </div>
        </div>

        {/* Cost summary bar */}
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-3)',
            marginTop: 'var(--space-2)',
            flexWrap: 'wrap'
          }}
        >
          {meta.labor_cost !== undefined && meta.labor_cost > 0 && (
            <div className="text-small">
              <span className="text-muted">Labor:</span>{' '}
              <span className="font-bold">{formatCurrency(meta.labor_cost)}</span>
            </div>
          )}
          {meta.tool_depreciation !== undefined && meta.tool_depreciation > 0 && (
            <div className="text-small">
              <span className="text-muted">Tools:</span>{' '}
              <span className="font-bold">{formatCurrency(meta.tool_depreciation)}</span>
              {meta.tool_count && (
                <span className="text-muted"> ({meta.tool_count} items)</span>
              )}
            </div>
          )}
          {meta.parts_cost !== undefined && meta.parts_cost > 0 && (
            <div className="text-small">
              <span className="text-muted">Parts:</span>{' '}
              <span className="font-bold">{formatCurrency(meta.parts_cost)}</span>
            </div>
          )}
        </div>

        {/* Expand indicator */}
        <div
          className="text-small text-muted"
          style={{
            marginTop: 'var(--space-2)',
            textAlign: 'center'
          }}
        >
          {expanded ? '▲ Hide details' : '▼ Show full breakdown'}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div
          style={{
            borderTop: '1px solid var(--border)',
            padding: 'var(--space-3)',
            background: 'var(--surface-hover)'
          }}
        >
          {loading ? (
            <div className="text-center text-muted">Loading tools...</div>
          ) : tools.length > 0 ? (
            <div>
              <div className="font-bold text-small" style={{ marginBottom: 'var(--space-2)' }}>
                Tools & Equipment Used
              </div>

              {/* Group by category */}
              {Object.entries(
                tools.reduce((acc, tool) => {
                  const cat = tool.category || 'other';
                  if (!acc[cat]) acc[cat] = [];
                  acc[cat].push(tool);
                  return acc;
                }, {} as Record<string, ToolUsage[]>)
              ).map(([category, categoryTools]) => (
                <div key={category} style={{ marginBottom: 'var(--space-2)' }}>
                  <div
                    className="text-small font-bold"
                    style={{
                      color: categoryColors[category] || 'var(--text-muted)',
                      marginBottom: '4px',
                      textTransform: 'capitalize'
                    }}
                  >
                    {category.replace('_', ' ')}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {categoryTools.map((tool, idx) => (
                      <span
                        key={idx}
                        className="text-small"
                        style={{
                          background: 'var(--surface)',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          border: '1px solid var(--border)'
                        }}
                      >
                        {tool.name}
                        {tool.use_count > 1 && ` ×${tool.use_count}`}
                        {tool.depreciation_amount > 0.01 && (
                          <span className="text-muted"> ${tool.depreciation_amount.toFixed(2)}</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              ))}

              {/* Provenance footer */}
              <div
                className="text-small text-muted"
                style={{
                  marginTop: 'var(--space-3)',
                  paddingTop: 'var(--space-2)',
                  borderTop: '1px solid var(--border)'
                }}
              >
                This work session is part of the vehicle's provenance record.
                All costs and tool usage are tracked for resale documentation.
              </div>
            </div>
          ) : (
            <div className="text-muted text-small">
              {meta.tools_used || 'No detailed tool breakdown available.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
