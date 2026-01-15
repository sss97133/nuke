/**
 * Sentinel Agent - Monitor
 * Watches for new findings and triggers the debug pipeline
 */

import { BaseAgent } from './BaseAgent';
import type { FindingWithContext } from './types';

export class SentinelAgent extends BaseAgent {
  constructor() {
    super('sentinel');
  }

  async execute(): Promise<void> {
    await this.loadAgent('sentinel');
    await this.startSession();

    console.log('👁️  Sentinel watching for findings...\n');

    // Get unprocessed findings
    const findings = await this.getUnprocessedFindings();
    
    if (findings.length === 0) {
      this.log('scan', 'success', 'No new findings to process');
      await this.completeSession('No new findings');
      return;
    }

    console.log(`   Found ${findings.length} unprocessed finding(s)\n`);

    for (const finding of findings) {
      await this.processFinding(finding);
      if (this.session) this.session.findings_processed++;
    }

    // Check SLA compliance
    await this.checkSLACompliance();

    await this.completeSession();
  }

  /**
   * Get findings that haven't been assigned to an agent yet
   */
  private async getUnprocessedFindings(): Promise<FindingWithContext[]> {
    const { data, error } = await this.supabase
      .from('bot_findings')
      .select(`
        *,
        persona:bot_personas(name, slug)
      `)
      .eq('status', 'new')
      .is('assigned_agent_id', null)
      .order('created_at', { ascending: true })
      .limit(20);
    
    if (error) {
      this.log('fetch_findings', 'failure', error.message);
      return [];
    }
    
    return (data || []) as FindingWithContext[];
  }

  /**
   * Process a single finding
   */
  private async processFinding(finding: FindingWithContext): Promise<void> {
    this.log('process', 'success', finding.title, finding.id);

    // Determine urgency
    const urgency = this.assessUrgency(finding);
    
    // For critical findings, send immediate alert
    if (urgency === 'immediate') {
      await this.sendImmediateAlert(finding);
    }

    // Hand off to Sherlock for triage
    await this.sendMessage(
      'sherlock',
      'handoff',
      `New finding requires triage: ${finding.title}\nSeverity: ${finding.severity}\nType: ${finding.finding_type}\nURL: ${finding.page_url}`,
      finding.id,
      { urgency, source_persona: finding.persona?.slug }
    );

    // Mark as being processed
    await this.updateFinding(finding.id, {
      status: 'triaged',
      assigned_agent_id: this.agent.id,
    });

    if (this.session) this.session.actions_taken++;
  }

  /**
   * Assess the urgency of a finding
   */
  private assessUrgency(finding: FindingWithContext): 'immediate' | 'high' | 'normal' | 'low' {
    // Critical severity = immediate
    if (finding.severity === 'critical') return 'immediate';
    
    // High severity with certain types = immediate
    if (finding.severity === 'high' && 
        ['bug', 'network_error', 'console_error'].includes(finding.finding_type)) {
      return 'immediate';
    }
    
    // High severity = high
    if (finding.severity === 'high') return 'high';
    
    // Medium severity = normal
    if (finding.severity === 'medium') return 'normal';
    
    // Low/info = low
    return 'low';
  }

  /**
   * Send immediate alert for critical findings
   */
  private async sendImmediateAlert(finding: FindingWithContext): Promise<void> {
    // Create admin notification
    const { error } = await this.supabase.from('admin_notifications').insert({
      notification_type: 'system_alert',
      title: `🚨 CRITICAL: ${finding.title}`,
      message: `Sentinel detected a critical issue that requires immediate attention.\n\nURL: ${finding.page_url}\nType: ${finding.finding_type}\nDetected by: ${finding.persona?.name || 'Bot'}`,
      priority: 5,
      action_required: 'system_action',
      metadata: {
        finding_id: finding.id,
        severity: finding.severity,
        automated_alert: true,
        agent: 'sentinel',
      },
    });

    if (error) {
      this.log('alert', 'failure', error.message);
    } else {
      this.log('alert', 'success', 'Critical alert sent to admins');
    }
  }

  /**
   * Check for findings that are taking too long to resolve
   */
  private async checkSLACompliance(): Promise<void> {
    // SLA thresholds (in hours)
    const slaThresholds = {
      critical: 1,
      high: 4,
      medium: 24,
      low: 72,
    };

    // Find findings that are past their SLA
    for (const [severity, hours] of Object.entries(slaThresholds)) {
      const threshold = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      
      const { data: overdue } = await this.supabase
        .from('bot_findings')
        .select('id, title, created_at')
        .eq('severity', severity)
        .in('status', ['new', 'triaged'])
        .lt('created_at', threshold)
        .limit(5);
      
      if (overdue && overdue.length > 0) {
        this.log('sla_check', 'failure', `${overdue.length} ${severity} findings past SLA`);
        
        // Escalate
        for (const finding of overdue) {
          await this.sendMessage(
            'sherlock',
            'escalation',
            `SLA breach: ${severity} finding "${finding.title}" created ${finding.created_at} is past ${hours}h SLA`,
            finding.id,
            { sla_hours: hours, severity }
          );
        }
      }
    }
  }
}
