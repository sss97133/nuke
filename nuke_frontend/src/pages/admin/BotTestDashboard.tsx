/**
 * Bot Test Dashboard - Admin interface for viewing bot test results
 * Shows findings from automated testing bots
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface BotFinding {
  id: string;
  test_run_id: string;
  persona_id: string;
  finding_type: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  page_url: string;
  component: string;
  screenshot_url: string;
  console_logs: unknown[];
  network_logs: unknown[];
  reproduction_steps: { step_number: number; action: string; expected: string; actual?: string }[];
  status: 'new' | 'triaged' | 'confirmed' | 'fixed' | 'wont_fix' | 'duplicate';
  admin_notes: string;
  created_at: string;
  persona?: { name: string; slug: string };
}

interface BotTestRun {
  id: string;
  persona_id: string;
  started_at: string;
  completed_at: string;
  status: string;
  environment: string;
  pages_visited: number;
  actions_performed: number;
  bugs_found: number;
  final_summary: string;
  persona?: { name: string; slug: string };
}

interface DashboardStats {
  totalFindings: number;
  criticalCount: number;
  highCount: number;
  newCount: number;
  recentRuns: number;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ff0000',
  high: '#ff4444',
  medium: '#ff8800',
  low: '#ffaa00',
  info: '#888888',
};

const STATUS_OPTIONS = ['new', 'triaged', 'confirmed', 'fixed', 'wont_fix', 'duplicate'];

interface DebugAgent {
  id: string;
  slug: string;
  name: string;
  role: string;
  description: string;
  is_active: boolean;
}

interface AgentSession {
  id: string;
  agent_id: string;
  started_at: string;
  completed_at: string;
  status: string;
  findings_processed: number;
  actions_taken: number;
  summary: string;
  agent?: DebugAgent;
}

interface Investigation {
  id: string;
  finding_id: string;
  root_cause_analysis: string;
  hypothesis: string;
  suggested_fix: string;
  fix_complexity: string;
  confidence_score: number;
  created_at: string;
  finding?: BotFinding;
}

interface FixAttempt {
  id: string;
  finding_id: string;
  fix_type: string;
  pr_url: string;
  status: string;
  verification_status: string;
  created_at: string;
  finding?: BotFinding;
}

export default function BotTestDashboard() {
  const [findings, setFindings] = useState<BotFinding[]>([]);
  const [testRuns, setTestRuns] = useState<BotTestRun[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedFinding, setSelectedFinding] = useState<BotFinding | null>(null);
  const [filter, setFilter] = useState<{ severity?: string; status?: string; type?: string }>({});
  const [view, setView] = useState<'findings' | 'runs' | 'debug-team'>('findings');
  
  // Debug team state
  const [agents, setAgents] = useState<DebugAgent[]>([]);
  const [agentSessions, setAgentSessions] = useState<AgentSession[]>([]);
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [fixAttempts, setFixAttempts] = useState<FixAttempt[]>([]);

  useEffect(() => {
    loadData();
    
    // Subscribe to new findings
    const subscription = supabase
      .channel('bot_findings')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bot_findings' }, () => {
        loadData();
      })
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [filter]);

  const loadData = async () => {
    setLoading(true);
    
    try {
      // Load findings with filters
      let findingsQuery = supabase
        .from('bot_findings')
        .select('*, persona:bot_personas(name, slug)')
        .order('created_at', { ascending: false })
        .limit(100);

      if (filter.severity) findingsQuery = findingsQuery.eq('severity', filter.severity);
      if (filter.status) findingsQuery = findingsQuery.eq('status', filter.status);
      if (filter.type) findingsQuery = findingsQuery.eq('finding_type', filter.type);

      const { data: findingsData } = await findingsQuery;
      setFindings(findingsData || []);

      // Load recent test runs
      const { data: runsData } = await supabase
        .from('bot_test_runs')
        .select('*, persona:bot_personas(name, slug)')
        .order('started_at', { ascending: false })
        .limit(20);
      setTestRuns(runsData || []);

      // Calculate stats
      const { count: totalFindings } = await supabase
        .from('bot_findings')
        .select('*', { count: 'exact', head: true });

      const { count: criticalCount } = await supabase
        .from('bot_findings')
        .select('*', { count: 'exact', head: true })
        .eq('severity', 'critical')
        .eq('status', 'new');

      const { count: highCount } = await supabase
        .from('bot_findings')
        .select('*', { count: 'exact', head: true })
        .eq('severity', 'high')
        .eq('status', 'new');

      const { count: newCount } = await supabase
        .from('bot_findings')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'new');

      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count: recentRuns } = await supabase
        .from('bot_test_runs')
        .select('*', { count: 'exact', head: true })
        .gte('started_at', oneDayAgo);

      setStats({
        totalFindings: totalFindings || 0,
        criticalCount: criticalCount || 0,
        highCount: highCount || 0,
        newCount: newCount || 0,
        recentRuns: recentRuns || 0,
      });

      // Load debug team data
      const { data: agentsData } = await supabase
        .from('debug_agents')
        .select('*')
        .order('role');
      setAgents(agentsData || []);

      const { data: sessionsData } = await supabase
        .from('debug_agent_sessions')
        .select('*, agent:debug_agents(*)')
        .order('started_at', { ascending: false })
        .limit(20);
      setAgentSessions(sessionsData || []);

      const { data: investigationsData } = await supabase
        .from('debug_investigations')
        .select('*, finding:bot_findings(*)')
        .order('created_at', { ascending: false })
        .limit(20);
      setInvestigations(investigationsData || []);

      const { data: fixesData } = await supabase
        .from('debug_fix_attempts')
        .select('*, finding:bot_findings(*)')
        .order('created_at', { ascending: false })
        .limit(20);
      setFixAttempts(fixesData || []);
    } catch (error) {
      console.error('Error loading bot data:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateFindingStatus = async (findingId: string, newStatus: string) => {
    const { error } = await supabase
      .from('bot_findings')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', findingId);

    if (!error) {
      setFindings(prev => 
        prev.map(f => f.id === findingId ? { ...f, status: newStatus as BotFinding['status'] } : f)
      );
      if (selectedFinding?.id === findingId) {
        setSelectedFinding({ ...selectedFinding, status: newStatus as BotFinding['status'] });
      }
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading bot test results...</p>
      </div>
    );
  }

  return (
    <div className="bot-test-dashboard" style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1>Bot Test Dashboard</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className={`button ${view === 'findings' ? 'button-primary' : 'button-secondary'}`}
            onClick={() => setView('findings')}
          >
            Findings
          </button>
          <button
            className={`button ${view === 'runs' ? 'button-primary' : 'button-secondary'}`}
            onClick={() => setView('runs')}
          >
            Test Runs
          </button>
          <button
            className={`button ${view === 'debug-team' ? 'button-primary' : 'button-secondary'}`}
            onClick={() => setView('debug-team')}
          >
            Debug Team
          </button>
        </div>
      </div>

      {/* Stats Overview */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px', marginBottom: '24px' }}>
          <div className="stat-card" style={{ padding: '16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px' }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: stats.criticalCount > 0 ? '#ff0000' : 'inherit' }}>
              {stats.criticalCount}
            </div>
            <div style={{ color: 'var(--text-muted)' }}>Critical Issues</div>
          </div>
          <div className="stat-card" style={{ padding: '16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px' }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: stats.highCount > 0 ? '#ff4444' : 'inherit' }}>
              {stats.highCount}
            </div>
            <div style={{ color: 'var(--text-muted)' }}>High Priority</div>
          </div>
          <div className="stat-card" style={{ padding: '16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px' }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold' }}>{stats.newCount}</div>
            <div style={{ color: 'var(--text-muted)' }}>New Findings</div>
          </div>
          <div className="stat-card" style={{ padding: '16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px' }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold' }}>{stats.recentRuns}</div>
            <div style={{ color: 'var(--text-muted)' }}>Runs (24h)</div>
          </div>
        </div>
      )}

      {view === 'findings' ? (
        <>
          {/* Filters */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <select
              className="form-select"
              value={filter.severity || ''}
              onChange={(e) => setFilter({ ...filter, severity: e.target.value || undefined })}
              style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--border)' }}
            >
              <option value="">All Severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="info">Info</option>
            </select>

            <select
              className="form-select"
              value={filter.status || ''}
              onChange={(e) => setFilter({ ...filter, status: e.target.value || undefined })}
              style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--border)' }}
            >
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>

            <select
              className="form-select"
              value={filter.type || ''}
              onChange={(e) => setFilter({ ...filter, type: e.target.value || undefined })}
              style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--border)' }}
            >
              <option value="">All Types</option>
              <option value="bug">Bug</option>
              <option value="ux_friction">UX Friction</option>
              <option value="performance">Performance</option>
              <option value="console_error">Console Error</option>
              <option value="network_error">Network Error</option>
            </select>

            <button className="button button-secondary" onClick={() => setFilter({})}>
              Clear Filters
            </button>
          </div>

          {/* Findings List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {findings.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
                No findings match your filters
              </div>
            ) : (
              findings.map((finding) => (
                <div
                  key={finding.id}
                  style={{
                    border: '1px solid var(--border)',
                    borderLeft: `4px solid ${SEVERITY_COLORS[finding.severity]}`,
                    borderRadius: '4px',
                    padding: '16px',
                    background: 'var(--surface)',
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelectedFinding(finding)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span
                          style={{
                            backgroundColor: SEVERITY_COLORS[finding.severity],
                            color: 'white',
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            fontWeight: 'bold',
                            textTransform: 'uppercase',
                          }}
                        >
                          {finding.severity}
                        </span>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          {finding.finding_type.replace('_', ' ')}
                        </span>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          • {finding.persona?.name || 'Unknown bot'}
                        </span>
                      </div>
                      <h3 style={{ margin: '4px 0' }}>{finding.title}</h3>
                      <p style={{ margin: '4px 0', color: 'var(--text-muted)', fontSize: '14px' }}>
                        {finding.page_url}
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <select
                        value={finding.status}
                        onChange={(e) => {
                          e.stopPropagation();
                          updateFindingStatus(finding.id, e.target.value);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border)' }}
                      >
                        {STATUS_OPTIONS.map(s => (
                          <option key={s} value={s}>{s.replace('_', ' ')}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        /* Test Runs View */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {testRuns.map((run) => (
            <div
              key={run.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: '4px',
                padding: '16px',
                background: 'var(--surface)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ margin: '0 0 8px 0' }}>{run.persona?.name || 'Unknown Bot'}</h3>
                  <div style={{ display: 'flex', gap: '16px', fontSize: '14px', color: 'var(--text-muted)' }}>
                    <span>Pages: {run.pages_visited}</span>
                    <span>Actions: {run.actions_performed}</span>
                    <span style={{ color: run.bugs_found > 0 ? '#ff4444' : 'inherit' }}>
                      Bugs: {run.bugs_found}
                    </span>
                    <span>Env: {run.environment}</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span
                    style={{
                      backgroundColor: run.status === 'completed' ? '#00aa00' : run.status === 'failed' ? '#ff4444' : '#ffaa00',
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '12px',
                    }}
                  >
                    {run.status}
                  </span>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    {formatDate(run.started_at)}
                  </div>
                </div>
              </div>
              {run.final_summary && (
                <p style={{ margin: '12px 0 0 0', padding: '8px', background: 'var(--surface-hover)', borderRadius: '4px', fontSize: '14px' }}>
                  {run.final_summary}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {view === 'debug-team' && (
        /* Debug Team View */
        <div>
          {/* Agent Status Cards */}
          <h3 style={{ marginBottom: '16px' }}>AI Debug Agents</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '24px' }}>
            {agents.map((agent) => (
              <div
                key={agent.id}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '16px',
                  background: 'var(--surface)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '24px' }}>
                    {agent.role === 'monitor' ? '👁️' : agent.role === 'triage' ? '🔍' : agent.role === 'investigator' ? '🔬' : '🔧'}
                  </span>
                  <div>
                    <h4 style={{ margin: 0 }}>{agent.name}</h4>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                      {agent.role}
                    </span>
                  </div>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  {agent.description}
                </p>
              </div>
            ))}
          </div>

          {/* Recent Agent Sessions */}
          <h3 style={{ marginBottom: '16px' }}>Recent Agent Sessions</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
            {agentSessions.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No agent sessions yet. Run the debug team to see activity.
              </div>
            ) : (
              agentSessions.map((session) => (
                <div
                  key={session.id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    padding: '12px',
                    background: 'var(--surface)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <strong>{session.agent?.name || 'Unknown'}</strong>
                    <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                      {session.findings_processed} findings, {session.actions_taken} actions
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span
                      style={{
                        backgroundColor: session.status === 'completed' ? '#00aa00' : session.status === 'failed' ? '#ff4444' : '#ffaa00',
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                      }}
                    >
                      {session.status}
                    </span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {formatDate(session.started_at)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Recent Investigations */}
          <h3 style={{ marginBottom: '16px' }}>Recent Investigations</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
            {investigations.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No investigations yet.
              </div>
            ) : (
              investigations.map((inv) => (
                <div
                  key={inv.id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    padding: '12px',
                    background: 'var(--surface)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <strong>{inv.finding?.title || 'Unknown Finding'}</strong>
                    <span style={{
                      backgroundColor: inv.fix_complexity === 'trivial' ? '#00aa00' : inv.fix_complexity === 'simple' ? '#88aa00' : inv.fix_complexity === 'moderate' ? '#ffaa00' : '#ff4444',
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '11px',
                    }}>
                      {inv.fix_complexity}
                    </span>
                  </div>
                  {inv.hypothesis && (
                    <p style={{ margin: '0 0 8px 0', fontSize: '13px' }}>
                      <strong>Hypothesis:</strong> {inv.hypothesis}
                    </p>
                  )}
                  {inv.suggested_fix && (
                    <p style={{ margin: '0', fontSize: '13px', color: 'var(--text-muted)' }}>
                      <strong>Fix:</strong> {inv.suggested_fix.substring(0, 200)}...
                    </p>
                  )}
                  <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                    Confidence: {((inv.confidence_score || 0) * 100).toFixed(0)}%
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Fix Attempts */}
          <h3 style={{ marginBottom: '16px' }}>Fix Attempts</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {fixAttempts.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No fix attempts yet.
              </div>
            ) : (
              fixAttempts.map((fix) => (
                <div
                  key={fix.id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    padding: '12px',
                    background: 'var(--surface)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <strong>{fix.finding?.title || 'Unknown Finding'}</strong>
                    <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                      {fix.fix_type}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {fix.pr_url && (
                      <a href={fix.pr_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px' }}>
                        View PR
                      </a>
                    )}
                    <span
                      style={{
                        backgroundColor: fix.status === 'merged' ? '#00aa00' : fix.status === 'applied' ? '#88aa00' : fix.status === 'rejected' ? '#ff4444' : '#888888',
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                      }}
                    >
                      {fix.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Finding Detail Modal */}
      {selectedFinding && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setSelectedFinding(null)}
        >
          <div
            style={{
              backgroundColor: 'var(--surface)',
              border: '2px solid var(--border)',
              padding: '24px',
              borderRadius: '8px',
              maxWidth: '800px',
              width: '90%',
              maxHeight: '80vh',
              overflow: 'auto',
              color: 'var(--text)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <span
                  style={{
                    backgroundColor: SEVERITY_COLORS[selectedFinding.severity],
                    color: 'white',
                    padding: '4px 12px',
                    borderRadius: '12px',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
                  }}
                >
                  {selectedFinding.severity}
                </span>
              </div>
              <button className="button button-secondary" onClick={() => setSelectedFinding(null)}>
                Close
              </button>
            </div>

            <h2 style={{ marginTop: '8px' }}>{selectedFinding.title}</h2>
            
            <div style={{ marginBottom: '16px' }}>
              <strong>URL:</strong>{' '}
              <a href={selectedFinding.page_url} target="_blank" rel="noopener noreferrer">
                {selectedFinding.page_url}
              </a>
            </div>

            {selectedFinding.description && (
              <div style={{ marginBottom: '16px' }}>
                <strong>Description:</strong>
                <p>{selectedFinding.description}</p>
              </div>
            )}

            {selectedFinding.reproduction_steps && selectedFinding.reproduction_steps.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <strong>Reproduction Steps:</strong>
                <ol style={{ margin: '8px 0', paddingLeft: '20px' }}>
                  {selectedFinding.reproduction_steps.map((step, i) => (
                    <li key={i}>{step.action}</li>
                  ))}
                </ol>
              </div>
            )}

            {selectedFinding.console_logs && selectedFinding.console_logs.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <strong>Console Errors:</strong>
                <pre style={{ background: 'var(--surface-hover)', padding: '12px', borderRadius: '4px', overflow: 'auto', fontSize: '12px' }}>
                  {JSON.stringify(selectedFinding.console_logs, null, 2)}
                </pre>
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <select
                value={selectedFinding.status}
                onChange={(e) => updateFindingStatus(selectedFinding.id, e.target.value)}
                style={{ padding: '8px 16px', borderRadius: '4px', border: '1px solid var(--border)' }}
              >
                {STATUS_OPTIONS.map(s => (
                  <option key={s} value={s}>{s.replace('_', ' ')}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
