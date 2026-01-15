/**
 * Patch Agent - Fixer
 * Attempts to fix simple issues automatically, creates PRs for review
 */

import { BaseAgent } from './BaseAgent';
import type { FindingWithContext, FixAttempt, FileChange } from './types';

export class PatchAgent extends BaseAgent {
  constructor() {
    super('patch', {
      autoCreatePRs: process.env.PATCH_AUTO_PR === 'true',
      requireHumanApproval: process.env.PATCH_AUTO_MERGE !== 'true',
    });
  }

  async execute(): Promise<void> {
    await this.loadAgent('patch');
    await this.startSession();

    console.log('🔧 Patch ready to fix...\n');

    // Process handoffs from Watson or Sherlock
    const messages = await this.getMessages();
    
    for (const message of messages) {
      if (message.message_type === 'handoff' && message.finding_id) {
        await this.attemptFix(message.finding_id, message.metadata);
      }
    }

    await this.completeSession();
  }

  /**
   * Attempt to fix a finding
   */
  private async attemptFix(findingId: string, metadata?: Record<string, unknown>): Promise<void> {
    const finding = await this.getFindingWithContext(findingId);
    if (!finding) return;

    this.log('fix_attempt', 'success', finding.title, findingId);

    // Get investigation details if available
    const investigationId = metadata?.investigation_id as string;
    let investigation = null;
    
    if (investigationId) {
      const { data } = await this.supabase
        .from('debug_investigations')
        .select('*')
        .eq('id', investigationId)
        .single();
      investigation = data;
    }

    // Determine fix approach
    const suggestedFix = (metadata?.suggested_fix as string) || investigation?.suggested_fix;
    const affectedFiles = (metadata?.affected_files as string[]) || 
      (investigation?.affected_files as { path: string }[] || []).map((f: { path: string }) => f.path);

    if (!suggestedFix || affectedFiles.length === 0) {
      this.log('fix_attempt', 'skipped', 'Insufficient information', findingId);
      await this.escalateToHuman(finding, 'Insufficient information to generate fix');
      return;
    }

    // Generate the fix
    const fix = await this.generateFix(finding, suggestedFix, affectedFiles);
    
    if (!fix || fix.files_changed.length === 0) {
      this.log('fix_generation', 'failure', 'Could not generate fix', findingId);
      await this.escalateToHuman(finding, 'Could not generate automated fix');
      return;
    }

    // Create fix attempt record
    const fixAttempt: FixAttempt = {
      investigation_id: investigationId,
      finding_id: findingId,
      agent_session_id: this.session!.id,
      fix_type: 'code_change',
      files_changed: fix.files_changed,
      verification_status: 'pending',
      status: 'pending',
    };

    // If auto-PR is enabled and git is available, create PR
    if (this.config.autoCreatePRs && this.config.gitEnabled) {
      const prResult = await this.createPullRequest(finding, fix);
      if (prResult) {
        fixAttempt.pr_url = prResult.url;
        fixAttempt.pr_number = prResult.number;
        fixAttempt.branch_name = prResult.branch;
        fixAttempt.status = 'applied';
      }
    }

    // Save fix attempt
    const { data: savedFix, error } = await this.supabase
      .from('debug_fix_attempts')
      .insert(fixAttempt)
      .select()
      .single();

    if (error) {
      this.log('save_fix', 'failure', error.message);
      return;
    }

    // Update finding
    await this.updateFinding(findingId, {
      fix_attempt_id: savedFix.id,
      status: fixAttempt.pr_url ? 'confirmed' : 'triaged', // Keep in triaged if no PR
    });

    // Notify admin
    await this.notifyFixReady(finding, savedFix, fix);

    if (this.session) {
      this.session.findings_processed++;
      this.session.actions_taken++;
    }
  }

  /**
   * Generate code fix using AI
   */
  private async generateFix(
    finding: FindingWithContext,
    suggestedFix: string,
    affectedFiles: string[]
  ): Promise<{ files_changed: FileChange[] } | null> {
    const files_changed: FileChange[] = [];

    // Read each affected file
    for (const filePath of affectedFiles.slice(0, 3)) {
      const content = await this.readFile(filePath);
      if (!content) continue;

      // Ask AI to generate the fix
      const systemPrompt = `You are Patch, an expert code fixer. Generate minimal, targeted code changes to fix bugs.
Rules:
1. Make the smallest possible change that fixes the issue
2. Maintain existing code style
3. Don't add unnecessary comments
4. Output ONLY the complete fixed file content, nothing else`;

      const userPrompt = `Fix this issue in the file.

## Issue
Title: ${finding.title}
Type: ${finding.finding_type}
Suggested Fix: ${suggestedFix}

## Current File: ${filePath}
\`\`\`
${content}
\`\`\`

Output the complete fixed file content. If no changes are needed to this specific file, output "NO_CHANGES_NEEDED".`;

      const response = await this.think(systemPrompt, userPrompt, 8000);

      if (response.includes('NO_CHANGES_NEEDED')) {
        continue;
      }

      // Extract code from response
      let newContent = response;
      const codeMatch = response.match(/```(?:\w+)?\n([\s\S]+?)```/);
      if (codeMatch) {
        newContent = codeMatch[1];
      }

      // Validate the fix isn't destructive
      if (newContent.length < content.length * 0.5) {
        this.log('fix_validation', 'failure', 'Fix removed too much code', filePath);
        continue;
      }

      if (newContent.trim() !== content.trim()) {
        files_changed.push({
          path: filePath,
          before: content,
          after: newContent,
          diff: this.generateSimpleDiff(content, newContent),
        });
      }
    }

    return files_changed.length > 0 ? { files_changed } : null;
  }

  /**
   * Generate a simple diff representation
   */
  private generateSimpleDiff(before: string, after: string): string {
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    const diff: string[] = [];

    const maxLines = Math.max(beforeLines.length, afterLines.length);
    
    for (let i = 0; i < maxLines; i++) {
      const bLine = beforeLines[i];
      const aLine = afterLines[i];
      
      if (bLine === aLine) continue;
      
      if (bLine !== undefined && aLine === undefined) {
        diff.push(`-${i + 1}: ${bLine}`);
      } else if (bLine === undefined && aLine !== undefined) {
        diff.push(`+${i + 1}: ${aLine}`);
      } else if (bLine !== aLine) {
        diff.push(`-${i + 1}: ${bLine}`);
        diff.push(`+${i + 1}: ${aLine}`);
      }
    }

    return diff.slice(0, 50).join('\n'); // Limit diff size
  }

  /**
   * Create a pull request with the fix
   */
  private async createPullRequest(
    finding: FindingWithContext,
    fix: { files_changed: FileChange[] }
  ): Promise<{ url: string; number: number; branch: string } | null> {
    const { execSync } = await import('child_process');
    const fs = await import('fs/promises');
    const path = await import('path');

    try {
      // Create branch name
      const branchName = `bot-fix/${finding.id.slice(0, 8)}-${Date.now()}`;
      
      // Check if we're in a git repo and on a safe branch
      const currentBranch = execSync('git branch --show-current', { 
        cwd: this.config.codebasePath,
        encoding: 'utf-8',
      }).trim();

      if (currentBranch === 'main' || currentBranch === 'master') {
        this.log('git', 'failure', 'Cannot create PR from main branch');
        return null;
      }

      // Create and checkout new branch
      execSync(`git checkout -b ${branchName}`, { cwd: this.config.codebasePath });

      // Apply changes
      for (const change of fix.files_changed) {
        const fullPath = path.join(this.config.codebasePath, change.path);
        await fs.writeFile(fullPath, change.after, 'utf-8');
        execSync(`git add "${change.path}"`, { cwd: this.config.codebasePath });
      }

      // Commit
      const commitMessage = `fix: ${finding.title}\n\nAutomated fix by Patch agent.\nFinding ID: ${finding.id}\n\n[bot-fix]`;
      execSync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, { 
        cwd: this.config.codebasePath,
      });

      // Push
      execSync(`git push -u origin ${branchName}`, { cwd: this.config.codebasePath });

      // Create PR using gh CLI
      const prTitle = `[Bot Fix] ${finding.title}`;
      const prBody = `## Automated Fix

This PR was automatically generated by the Patch agent.

### Finding
- **Title:** ${finding.title}
- **Severity:** ${finding.severity}
- **Type:** ${finding.finding_type}
- **URL:** ${finding.page_url}

### Changes
${fix.files_changed.map(f => `- \`${f.path}\``).join('\n')}

### Verification
- [ ] Code review completed
- [ ] Manual testing passed
- [ ] No regressions introduced

---
*This PR requires human review before merging.*`;

      const prOutput = execSync(
        `gh pr create --title "${prTitle}" --body "${prBody.replace(/"/g, '\\"')}"`,
        { cwd: this.config.codebasePath, encoding: 'utf-8' }
      );

      // Parse PR URL and number from output
      const urlMatch = prOutput.match(/https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/);
      
      // Switch back to original branch
      execSync(`git checkout ${currentBranch}`, { cwd: this.config.codebasePath });

      if (urlMatch) {
        this.log('create_pr', 'success', urlMatch[0]);
        return {
          url: urlMatch[0],
          number: parseInt(urlMatch[1]),
          branch: branchName,
        };
      }
    } catch (error) {
      this.log('create_pr', 'failure', error instanceof Error ? error.message : 'Git operation failed');
      
      // Try to recover - switch back to original branch
      try {
        execSync('git checkout -', { cwd: this.config.codebasePath });
      } catch {
        // Ignore cleanup errors
      }
    }

    return null;
  }

  /**
   * Notify admin that a fix is ready for review
   */
  private async notifyFixReady(
    finding: FindingWithContext,
    fixAttempt: FixAttempt,
    fix: { files_changed: FileChange[] }
  ): Promise<void> {
    const message = fixAttempt.pr_url
      ? `Patch created a PR for review:\n${fixAttempt.pr_url}`
      : `Patch generated a fix but could not create a PR.\n\nFiles to change:\n${fix.files_changed.map(f => `- ${f.path}`).join('\n')}\n\nReview the fix in the Debug Dashboard.`;

    await this.supabase.from('admin_notifications').insert({
      notification_type: 'system_alert',
      title: `🔧 Fix Ready: ${finding.title}`,
      message,
      priority: 3,
      action_required: 'system_action',
      metadata: {
        finding_id: finding.id,
        fix_attempt_id: fixAttempt.id,
        pr_url: fixAttempt.pr_url,
        files_changed: fix.files_changed.map(f => f.path),
        agent: 'patch',
      },
    });
  }

  /**
   * Escalate to human when automated fix isn't possible
   */
  private async escalateToHuman(finding: FindingWithContext, reason: string): Promise<void> {
    // Create fix attempt record showing escalation
    await this.supabase.from('debug_fix_attempts').insert({
      finding_id: finding.id,
      agent_session_id: this.session!.id,
      fix_type: 'escalate_human',
      files_changed: [],
      verification_status: 'skipped',
      verification_notes: reason,
      status: 'pending',
    });

    await this.supabase.from('admin_notifications').insert({
      notification_type: 'system_alert',
      title: `👤 Human Fix Required: ${finding.title}`,
      message: `Patch could not generate an automated fix.\n\nReason: ${reason}\n\nManual intervention required.`,
      priority: finding.severity === 'critical' ? 5 : 3,
      action_required: 'system_action',
      metadata: {
        finding_id: finding.id,
        reason,
        agent: 'patch',
        requires_human: true,
      },
    });

    this.log('escalate', 'success', reason, finding.id);
  }
}
