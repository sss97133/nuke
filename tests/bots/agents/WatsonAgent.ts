/**
 * Watson Agent - Investigator
 * Deep-dives into code to find root causes and suggest fixes
 */

import { BaseAgent } from './BaseAgent';
import type { FindingWithContext, Investigation, AffectedFile, CodeSnippet } from './types';

export class WatsonAgent extends BaseAgent {
  constructor() {
    super('watson');
  }

  async execute(): Promise<void> {
    await this.loadAgent('watson');
    await this.startSession();

    console.log('🔬 Watson investigating...\n');

    // Process handoffs from Sherlock
    const messages = await this.getMessages();
    
    for (const message of messages) {
      if (message.message_type === 'handoff' && message.finding_id) {
        await this.investigate(message.finding_id, message.metadata);
      }
    }

    await this.completeSession();
  }

  /**
   * Perform deep investigation of a finding
   */
  private async investigate(findingId: string, metadata?: Record<string, unknown>): Promise<void> {
    const finding = await this.getFindingWithContext(findingId);
    if (!finding) return;

    this.log('investigate', 'success', finding.title, findingId);

    // 1. Gather evidence
    const affectedFiles = await this.identifyAffectedFiles(finding, metadata);
    const relatedCode = await this.gatherRelatedCode(finding, affectedFiles);

    // 2. Analyze root cause
    const analysis = await this.analyzeRootCause(finding, affectedFiles, relatedCode);

    // 3. Create investigation record
    const investigation: Investigation = {
      finding_id: findingId,
      agent_session_id: this.session!.id,
      root_cause_analysis: analysis.root_cause,
      affected_files: affectedFiles,
      related_code: relatedCode,
      hypothesis: analysis.hypothesis,
      confidence_score: analysis.confidence,
      suggested_fix: analysis.suggested_fix,
      fix_complexity: analysis.complexity,
      estimated_effort: analysis.effort,
      similar_findings: await this.findSimilarIssues(finding, analysis),
    };

    // Save investigation
    const { data: savedInvestigation, error } = await this.supabase
      .from('debug_investigations')
      .insert(investigation)
      .select()
      .single();

    if (error) {
      this.log('save_investigation', 'failure', error.message);
      return;
    }

    // Update finding with investigation link
    await this.updateFinding(findingId, {
      investigation_id: savedInvestigation.id,
      status: 'confirmed',
    });

    // 4. Decide next steps
    if (analysis.complexity === 'trivial' || analysis.complexity === 'simple') {
      // Hand off to Patch for fixing
      await this.sendMessage(
        'patch',
        'handoff',
        `Investigation complete. Ready for fix.\n\nRoot cause: ${analysis.root_cause}\nSuggested fix: ${analysis.suggested_fix}\nComplexity: ${analysis.complexity}`,
        findingId,
        {
          investigation_id: savedInvestigation.id,
          affected_files: affectedFiles.map(f => f.path),
          suggested_fix: analysis.suggested_fix,
        }
      );
    } else {
      // Complex issues need human review
      await this.escalateToHuman(finding, savedInvestigation, analysis);
    }

    if (this.session) {
      this.session.findings_processed++;
      this.session.actions_taken++;
    }
  }

  /**
   * Identify files that might be affected by this issue
   */
  private async identifyAffectedFiles(
    finding: FindingWithContext,
    metadata?: Record<string, unknown>
  ): Promise<AffectedFile[]> {
    const affectedFiles: AffectedFile[] = [];

    // Start with files suggested by Sherlock
    const suggestedFiles = (metadata?.analysis as { likely_files?: string[] })?.likely_files || [];
    
    // Parse URL to find relevant component
    const urlPath = finding.page_url?.replace(/https?:\/\/[^/]+/, '') || '';
    const pathParts = urlPath.split('/').filter(Boolean);

    // Search strategies
    const searchTerms: string[] = [];

    // From URL path
    if (pathParts.length > 0) {
      searchTerms.push(pathParts[pathParts.length - 1]); // Last part of path
    }

    // From console errors
    if (finding.console_logs) {
      for (const log of finding.console_logs.slice(0, 3)) {
        const logStr = typeof log === 'string' ? log : JSON.stringify(log);
        // Extract file references
        const fileMatch = logStr.match(/([A-Za-z]+\.(tsx?|jsx?))/);
        if (fileMatch) {
          searchTerms.push(fileMatch[1]);
        }
        // Extract component names
        const componentMatch = logStr.match(/at\s+([A-Z][a-zA-Z]+)/);
        if (componentMatch) {
          searchTerms.push(componentMatch[1]);
        }
      }
    }

    // From finding title/description
    const titleWords = finding.title.match(/[A-Z][a-z]+/g) || [];
    searchTerms.push(...titleWords.slice(0, 3));

    // Search for each term
    for (const term of [...new Set(searchTerms)]) {
      const files = await this.findFiles(`**/*${term}*.{ts,tsx,js,jsx}`);
      for (const file of files.slice(0, 3)) {
        if (!affectedFiles.find(f => f.path === file)) {
          affectedFiles.push({
            path: file,
            relevance: 0.5,
          });
        }
      }
    }

    // Add suggested files with high relevance
    for (const file of suggestedFiles) {
      const existing = affectedFiles.find(f => f.path === file);
      if (existing) {
        existing.relevance = 0.9;
      } else {
        affectedFiles.push({ path: file, relevance: 0.9 });
      }
    }

    // Try to find page component from URL
    if (urlPath) {
      const pageFiles = await this.findFiles(`**/pages/**/${pathParts[0] || 'index'}.tsx`);
      for (const file of pageFiles) {
        if (!affectedFiles.find(f => f.path === file)) {
          affectedFiles.push({ path: file, relevance: 0.8 });
        }
      }
    }

    // Sort by relevance and limit
    return affectedFiles
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 10);
  }

  /**
   * Gather code snippets from affected files
   */
  private async gatherRelatedCode(
    finding: FindingWithContext,
    affectedFiles: AffectedFile[]
  ): Promise<CodeSnippet[]> {
    const snippets: CodeSnippet[] = [];

    for (const file of affectedFiles.slice(0, 5)) {
      const content = await this.readFile(file.path);
      if (!content) continue;

      const lines = content.split('\n');
      
      // If we have error info, try to find relevant section
      let relevantStart = 0;
      let relevantEnd = Math.min(50, lines.length);

      // Search for keywords from the finding
      const keywords = finding.title.toLowerCase().split(/\s+/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toLowerCase();
        if (keywords.some(kw => line.includes(kw))) {
          relevantStart = Math.max(0, i - 10);
          relevantEnd = Math.min(lines.length, i + 20);
          break;
        }
      }

      snippets.push({
        file: file.path,
        content: lines.slice(relevantStart, relevantEnd).join('\n'),
        line_start: relevantStart + 1,
        line_end: relevantEnd,
        context: `Relevance: ${(file.relevance * 100).toFixed(0)}%`,
      });
    }

    return snippets;
  }

  /**
   * Analyze root cause using AI
   */
  private async analyzeRootCause(
    finding: FindingWithContext,
    affectedFiles: AffectedFile[],
    relatedCode: CodeSnippet[]
  ): Promise<{
    root_cause: string;
    hypothesis: string;
    suggested_fix: string;
    complexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'architectural';
    confidence: number;
    effort: string;
  }> {
    const systemPrompt = `You are Watson, an expert software debugger. Analyze bug reports and code to:
1. Identify the root cause
2. Form a hypothesis about what's happening
3. Suggest a specific fix
4. Estimate complexity and effort

Be precise and technical. Reference specific code when possible.`;

    const codeContext = relatedCode
      .map(s => `--- ${s.file} (lines ${s.line_start}-${s.line_end}) ---\n${s.content}`)
      .join('\n\n');

    const userPrompt = `Investigate this bug:

## Finding
Title: ${finding.title}
Type: ${finding.finding_type}
Severity: ${finding.severity}
URL: ${finding.page_url}
Description: ${finding.description || 'N/A'}

## Console Errors
${JSON.stringify(finding.console_logs?.slice(0, 5) || [], null, 2)}

## Network Errors
${JSON.stringify(finding.network_logs?.slice(0, 5) || [], null, 2)}

## Reproduction Steps
${finding.reproduction_steps?.map(s => `${s.step_number}. ${s.action}`).join('\n') || 'Not provided'}

## Likely Affected Files
${affectedFiles.map(f => `- ${f.path} (${(f.relevance * 100).toFixed(0)}% relevance)`).join('\n')}

## Code Context
${codeContext || 'No code available'}

Respond in this exact JSON format:
{
  "root_cause": "Technical explanation of what's causing the issue",
  "hypothesis": "Your theory about why this is happening",
  "suggested_fix": "Specific code changes or actions to fix this",
  "complexity": "trivial|simple|moderate|complex|architectural",
  "confidence": 0.0 to 1.0,
  "effort": "5min|30min|1h|4h|1d|1w|needs_design"
}`;

    const response = await this.think(systemPrompt, userPrompt, 2000);

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      this.log('ai_analysis', 'failure', 'Could not parse response');
    }

    return {
      root_cause: 'Unable to determine root cause automatically',
      hypothesis: 'Manual investigation required',
      suggested_fix: 'Review the affected files manually',
      complexity: 'moderate',
      confidence: 0.3,
      effort: '4h',
    };
  }

  /**
   * Find similar issues in the codebase history
   */
  private async findSimilarIssues(
    finding: FindingWithContext,
    analysis: { root_cause: string }
  ): Promise<string[]> {
    // Search for findings with similar root causes
    const { data: similar } = await this.supabase
      .from('debug_investigations')
      .select('finding_id')
      .textSearch('root_cause_analysis', analysis.root_cause.split(' ').slice(0, 5).join(' | '))
      .limit(5);

    return (similar || [])
      .map(s => s.finding_id)
      .filter(id => id !== finding.id);
  }

  /**
   * Escalate complex issues to human review
   */
  private async escalateToHuman(
    finding: FindingWithContext,
    investigation: Investigation,
    analysis: { complexity: string; effort: string; suggested_fix: string }
  ): Promise<void> {
    await this.supabase.from('admin_notifications').insert({
      notification_type: 'system_alert',
      title: `🔬 Investigation Complete: ${finding.title}`,
      message: `Watson completed investigation. Human review required.\n\nComplexity: ${analysis.complexity}\nEffort: ${analysis.effort}\n\nSuggested fix:\n${analysis.suggested_fix}`,
      priority: finding.severity === 'critical' ? 5 : finding.severity === 'high' ? 4 : 3,
      action_required: 'system_action',
      metadata: {
        finding_id: finding.id,
        investigation_id: investigation.id,
        complexity: analysis.complexity,
        agent: 'watson',
        requires_human: true,
      },
    });

    this.log('escalate', 'success', `Complex issue (${analysis.complexity}) sent to humans`, finding.id);
  }
}
