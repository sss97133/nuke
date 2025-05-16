class ReportGenerator {
  constructor() {}
  
  generateReport(repoAnalysis, issues, fixResults) {
    const timestamp = new Date().toISOString();
    
    let report = `# Autonomous Debugging Agent Report
Generated: ${new Date().toLocaleString()}

## Summary

${this.generateSummary(issues, fixResults)}

## Issues Detected

${this.generateIssuesList(issues)}

## Fix Results

${this.generateFixResults(fixResults)}

## Repository Analysis

${this.generateRepoAnalysis(repoAnalysis)}
`;
    
    return report;
  }
  
  generateSummary(issues, fixResults) {
    const totalIssues = issues.length;
    const fixedIssues = fixResults.filter(result => result.success).length;
    const failedFixes = fixResults.filter(result => !result.success).length;
    
    const issuesByType = {};
    issues.forEach(issue => {
      issuesByType[issue.type] = (issuesByType[issue.type] || 0) + 1;
    });
    
    const issueTypes = Object.entries(issuesByType)
      .map(([type, count]) => `- ${type}: ${count}`)
      .join('\n');
    
    return `
- Total issues detected: ${totalIssues}
- Successfully fixed: ${fixedIssues}
- Fix attempts failed: ${failedFixes}

Issue types:
${issueTypes}
`;
  }
  
  generateIssuesList(issues) {
    if (issues.length === 0) {
      return 'No issues detected.';
    }
    
    return issues.map((issue, index) => {
      return `
### Issue ${index + 1}: ${issue.type}

- **Description**: ${issue.description}
- **Severity**: ${issue.severity}
- **Location**: ${issue.fileLocation || 'Unknown'}
${issue.feature ? `- **Feature**: ${issue.feature}` : ''}
${issue.ruleId ? `- **Rule**: ${issue.ruleId}` : ''}
${issue.suggestedFix ? `- **Suggested Fix**: ${issue.suggestedFix}` : ''}
`;
    }).join('\n');
  }
  
  generateFixResults(fixResults) {
    if (fixResults.length === 0) {
      return 'No fixes attempted.';
    }
    
    return fixResults.map((result, index) => {
      return `
### Fix ${index + 1}: ${result.issue.type}

- **Issue**: ${result.issue.description}
- **Status**: ${result.success ? '✅ FIXED' : '❌ FAILED'}
${result.explanation ? `- **Fix Applied**: ${result.explanation}` : ''}
${result.verification ? `- **Verification**: ${result.verification.message || result.verification.reason}` : ''}
${result.changes ? `- **Changed Files**: ${result.changes.map(c => c.filePath).join(', ')}` : ''}
`;
    }).join('\n');
  }
  
  generateRepoAnalysis(repoAnalysis) {
    return `
### Components

Total components: ${repoAnalysis.components.length}

### Features

Total features: ${repoAnalysis.features.length}

${repoAnalysis.features.map(feature => `- ${feature.name}: ${feature.description}`).join('\n')}
`;
  }
}

module.exports = { ReportGenerator };