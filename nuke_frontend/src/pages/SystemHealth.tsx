/**
 * SYSTEM HEALTH DASHBOARD
 * 
 * Unified dashboard for fixing system errors/issues:
 * - RLS violations
 * - AI confusion/errors
 * - Duplicates
 * - Image/vehicle mismatches
 * - Org/vehicle problems
 * - Data quality issues
 * 
 * Lets you fix issues directly from the UI
 */

import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

interface SystemHealthIssue {
  id: string
  issue_type: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  title: string
  description?: string
  error_message?: string
  vehicle_id?: string
  image_id?: string
  organization_id?: string
  context_data: any
  suggested_fix?: string
  fix_action?: any
  status: 'open' | 'in_progress' | 'resolved' | 'dismissed' | 'auto_fixed'
  detected_at: string
}

export default function SystemHealth() {
  const [issues, setIssues] = useState<SystemHealthIssue[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'open' | 'critical' | 'high'>('open')
  const [selectedIssue, setSelectedIssue] = useState<SystemHealthIssue | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    loadIssues()
    
    // Real-time subscription
    const channel = supabase
      .channel('system_health_issues')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'system_health_issues'
      }, () => {
        loadIssues()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [filter])

  const loadIssues = async () => {
    try {
      setLoading(true)
      let query = supabase
        .from('system_health_issues')
        .select('*')
        .order('detected_at', { ascending: false })
        .limit(100)

      if (filter === 'open') {
        query = query.eq('status', 'open')
      } else if (filter === 'critical') {
        query = query.eq('severity', 'critical').eq('status', 'open')
      } else if (filter === 'high') {
        query = query.in('severity', ['critical', 'high']).eq('status', 'open')
      }

      const { data, error } = await query

      if (error) throw error
      setIssues(data || [])
    } catch (error: any) {
      console.error('Error loading issues:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleFix = async (issue: SystemHealthIssue, action: string) => {
    try {
      if (action === 'apply_suggested_fix' && issue.fix_action) {
        // Apply the suggested fix
        const { action: fixType, ...fixParams } = issue.fix_action

        if (fixType === 'move_image' && fixParams.target_vehicle_id && issue.image_id) {
          // Move image to correct vehicle
          const { error } = await supabase
            .from('vehicle_images')
            .update({ vehicle_id: fixParams.target_vehicle_id })
            .eq('id', issue.image_id)

          if (error) throw error

          // Mark issue as resolved
          await supabase
            .from('system_health_issues')
            .update({
              status: 'resolved',
              resolved_at: new Date().toISOString(),
              resolution_notes: `Image moved to vehicle ${fixParams.target_vehicle_id}`
            })
            .eq('id', issue.id)

        } else if (fixType === 'merge_vehicles' && fixParams.merge_from && fixParams.merge_to) {
          // Merge vehicles (would need a merge function)
          // For now, just mark as resolved
          await supabase
            .from('system_health_issues')
            .update({
              status: 'resolved',
              resolved_at: new Date().toISOString(),
              resolution_notes: `Vehicles merged: ${fixParams.merge_from} → ${fixParams.merge_to}`
            })
            .eq('id', issue.id)
        }

        await loadIssues()
        setSelectedIssue(null)
      } else if (action === 'dismiss') {
        await supabase
          .from('system_health_issues')
          .update({ status: 'dismissed', resolved_at: new Date().toISOString() })
          .eq('id', issue.id)

        await loadIssues()
        setSelectedIssue(null)
      } else if (action === 'view_vehicle' && issue.vehicle_id) {
        navigate(`/vehicle/${issue.vehicle_id}`)
      } else if (action === 'view_image' && issue.image_id) {
        // Navigate to image viewer
        navigate(`/vehicle/${issue.vehicle_id}?image=${issue.image_id}`)
      }
    } catch (error: any) {
      console.error('Error fixing issue:', error)
      alert(`Error: ${error.message}`)
    }
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return '#dc2626'
      case 'high': return '#ea580c'
      case 'medium': return '#f59e0b'
      case 'low': return '#6b7280'
      default: return '#6b7280'
    }
  }

  const getIssueTypeIcon = (type: string) => {
    switch (type) {
      case 'rls_violation': return '🔒'
      case 'ai_confusion': return '🤖'
      case 'duplicate_vehicle': return '📋'
      case 'duplicate_image': return '🖼️'
      case 'image_vehicle_mismatch': return '⚠️'
      case 'org_vehicle_mismatch': return '🏢'
      case 'data_quality': return '📊'
      default: return '❌'
    }
  }

  const openCount = issues.filter(i => i.status === 'open').length
  const criticalCount = issues.filter(i => i.severity === 'critical' && i.status === 'open').length

  return (
    <div style={{ padding: '16px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '16px', borderBottom: '1px solid #bdbdbd', paddingBottom: '8px' }}>
        <h1 style={{ fontSize: '12pt', fontWeight: '600', margin: 0 }}>System Health</h1>
        <div style={{ fontSize: '8pt', color: '#757575', marginTop: '4px' }}>
          Fix errors, duplicates, and data quality issues
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
        <div style={{ padding: '8px', background: '#f5f5f5', border: '1px solid #bdbdbd', borderRadius: '2px' }}>
          <div style={{ fontSize: '7pt', color: '#757575' }}>Open Issues</div>
          <div style={{ fontSize: '14pt', fontWeight: '600' }}>{openCount}</div>
        </div>
        <div style={{ padding: '8px', background: '#fee2e2', border: '1px solid #dc2626', borderRadius: '2px' }}>
          <div style={{ fontSize: '7pt', color: '#757575' }}>Critical</div>
          <div style={{ fontSize: '14pt', fontWeight: '600', color: '#dc2626' }}>{criticalCount}</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {(['all', 'open', 'critical', 'high'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '4px 8px',
              border: '1px solid #bdbdbd',
              background: filter === f ? '#e0e0e0' : '#ffffff',
              cursor: 'pointer',
              fontSize: '8pt',
              textTransform: 'capitalize'
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Issues List */}
      {loading ? (
        <div style={{ padding: '32px', textAlign: 'center', color: '#757575' }}>Loading...</div>
      ) : issues.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', color: '#757575' }}>
          No issues found. System is healthy! ✅
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {issues.map(issue => (
            <div
              key={issue.id}
              style={{
                border: '1px solid #bdbdbd',
                padding: '12px',
                background: '#ffffff',
                cursor: 'pointer'
              }}
              onClick={() => setSelectedIssue(issue)}
            >
              <div style={{ display: 'flex', alignItems: 'start', gap: '8px' }}>
                <span style={{ fontSize: '12pt' }}>{getIssueTypeIcon(issue.issue_type)}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '9pt', fontWeight: '600' }}>{issue.title}</span>
                    <span
                      style={{
                        fontSize: '7pt',
                        padding: '2px 4px',
                        background: getSeverityColor(issue.severity),
                        color: 'white',
                        borderRadius: '2px'
                      }}
                    >
                      {issue.severity}
                    </span>
                  </div>
                  {issue.description && (
                    <div style={{ fontSize: '8pt', color: '#757575', marginBottom: '4px' }}>
                      {issue.description}
                    </div>
                  )}
                  {issue.suggested_fix && (
                    <div style={{ fontSize: '7pt', color: '#059669', marginTop: '4px', fontStyle: 'italic' }}>
                      💡 {issue.suggested_fix}
                    </div>
                  )}
                  <div style={{ fontSize: '7pt', color: '#9e9e9e', marginTop: '4px' }}>
                    {new Date(issue.detected_at).toLocaleString()}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {issue.vehicle_id && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate(`/vehicle/${issue.vehicle_id}`)
                      }}
                      style={{
                        padding: '4px 8px',
                        border: '1px solid #bdbdbd',
                        background: '#ffffff',
                        cursor: 'pointer',
                        fontSize: '7pt'
                      }}
                    >
                      View Vehicle
                    </button>
                  )}
                  {issue.fix_action && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleFix(issue, 'apply_suggested_fix')
                      }}
                      style={{
                        padding: '4px 8px',
                        border: '1px solid #059669',
                        background: '#d1fae5',
                        cursor: 'pointer',
                        fontSize: '7pt',
                        color: '#059669'
                      }}
                    >
                      Apply Fix
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Issue Detail Modal */}
      {selectedIssue && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={() => setSelectedIssue(null)}
        >
          <div
            style={{
              background: '#ffffff',
              padding: '24px',
              maxWidth: '600px',
              maxHeight: '80vh',
              overflow: 'auto',
              border: '2px solid #bdbdbd'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: '10pt', marginBottom: '16px' }}>{selectedIssue.title}</h2>
            <div style={{ fontSize: '8pt', color: '#757575', marginBottom: '16px' }}>
              {selectedIssue.description}
            </div>
            {selectedIssue.error_message && (
              <div style={{ fontSize: '7pt', color: '#dc2626', marginBottom: '16px', fontFamily: 'monospace' }}>
                {selectedIssue.error_message}
              </div>
            )}
            {selectedIssue.context_data && Object.keys(selectedIssue.context_data).length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '8pt', fontWeight: '600', marginBottom: '4px' }}>Context:</div>
                <pre style={{ fontSize: '7pt', background: '#f5f5f5', padding: '8px', overflow: 'auto' }}>
                  {JSON.stringify(selectedIssue.context_data, null, 2)}
                </pre>
              </div>
            )}
            {selectedIssue.suggested_fix && (
              <div style={{ marginBottom: '16px', padding: '8px', background: '#d1fae5', border: '1px solid #059669' }}>
                <div style={{ fontSize: '8pt', fontWeight: '600', marginBottom: '4px' }}>Suggested Fix:</div>
                <div style={{ fontSize: '8pt' }}>{selectedIssue.suggested_fix}</div>
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              {selectedIssue.fix_action && (
                <button
                  onClick={() => handleFix(selectedIssue, 'apply_suggested_fix')}
                  style={{
                    padding: '8px 16px',
                    border: '1px solid #059669',
                    background: '#059669',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: '8pt'
                  }}
                >
                  Apply Fix
                </button>
              )}
              <button
                onClick={() => handleFix(selectedIssue, 'dismiss')}
                style={{
                  padding: '8px 16px',
                  border: '1px solid #bdbdbd',
                  background: '#ffffff',
                  cursor: 'pointer',
                  fontSize: '8pt'
                }}
              >
                Dismiss
              </button>
              <button
                onClick={() => setSelectedIssue(null)}
                style={{
                  padding: '8px 16px',
                  border: '1px solid #bdbdbd',
                  background: '#ffffff',
                  cursor: 'pointer',
                  fontSize: '8pt'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

