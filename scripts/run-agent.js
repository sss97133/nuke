const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Import our debugging agent components
const { RepoUnderstandingAgent } = require('../src/agents/debugging/RepoUnderstandingAgent');
const { IssueDetectionSystem } = require('../src/agents/debugging/IssueDetectionSystem');
const { AutonomousDebugAgent } = require('../src/agents/debugging/AutonomousDebugAgent');
const { ReportGenerator } = require('../src/agents/debugging/ReportGenerator');

// Get command line arguments
const command = process.argv[2];

// Get environment variables
const openAiApiKey = process.env.OPENAI_API_KEY;
const githubToken = process.env.GITHUB_TOKEN;
const focusArea = process.env.FOCUS_AREA || '';
const issueLimit = parseInt(process.env.ISSUE_LIMIT || '3', 10);

// Create agent instances
const repoAnalyzer = new RepoUnderstandingAgent(openAiApiKey, githubToken);
const issueDetector = new IssueDetectionSystem(openAiApiKey, githubToken);
const debugAgent = new AutonomousDebugAgent(openAiApiKey, githubToken);
const reportGenerator = new ReportGenerator();

// Store state between steps
const statePath = path.join(__dirname, '../.debug-agent-state.json');

// Main function
async function main() {
  try {
    switch (command) {
      case 'analyze':
        await runAnalysis();
        break;
      case 'detect-issues':
        await detectIssues();
        break;
      case 'fix-issues':
        await fixIssues();
        break;
      case 'generate-report':
        await generateReport();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (error) {
    console.error('Error executing command:', error);
    process.exit(1);
  }
}

// Repository analysis
async function runAnalysis() {
  console.log('Analyzing repository structure and features...');
  
  const repoPath = process.cwd();
  const repoAnalysis = await repoAnalyzer.analyzeRepository(repoPath, { focusArea });
  
  console.log(`Analysis complete. Identified ${repoAnalysis.components.length} components and ${repoAnalysis.features.length} features.`);
  
  // Save state for next steps
  saveState({ repoAnalysis });
  
  // Set output for GitHub Actions
  setOutput('component_count', repoAnalysis.components.length);
  setOutput('feature_count', repoAnalysis.features.length);
}

// Issue detection
async function detectIssues() {
  console.log('Detecting issues in codebase...');
  
  const state = loadState();
  if (!state.repoAnalysis) {
    throw new Error('Repository analysis not found. Run analysis first.');
  }
  
  const issues = await issueDetector.detectIssues(state.repoAnalysis);
  
  // Limit the number of issues to fix
  const prioritizedIssues = issues.slice(0, issueLimit);
  
  console.log(`Detected ${issues.length} issues. Will fix up to ${prioritizedIssues.length} issues.`);
  
  // Update state
  saveState({ ...state, issues: prioritizedIssues });
  
  // Set output for GitHub Actions
  setOutput('issue_count', issues.length);
  setOutput('prioritized_issue_count', prioritizedIssues.length);
}

// Fix issues
async function fixIssues() {
  console.log('Fixing issues...');
  
  const state = loadState();
  if (!state.issues || state.issues.length === 0) {
    console.log('No issues to fix.');
    setOutput('fixed_issues', 0);
    return;
  }
  
  const fixResults = await debugAgent.fixIssues(state.issues, state.repoAnalysis);
  
  const successfulFixes = fixResults.filter(result => result.success);
  console.log(`Successfully fixed ${successfulFixes.length} out of ${fixResults.length} issues.`);
  
  // Generate a summary for PR description
  const fixSummary = fixResults.map((result, index) => {
    const status = result.success ? '✅ Fixed' : '❌ Attempted fix failed';
    return `${status}: ${result.issue.description} (${result.issue.fileLocation || 'unknown location'})`;
  }).join('\n');
  
  // Update state
  saveState({ ...state, fixResults });
  
  // Set output for GitHub Actions
  setOutput('fixed_issues', successfulFixes.length);
  setOutput('fix_summary', fixSummary);
}

// Generate report
async function generateReport() {
  console.log('Generating debug report...');
  
  const state = loadState();
  if (!state.repoAnalysis || !state.issues) {
    throw new Error('Missing required state. Run previous steps first.');
  }
  
  const report = reportGenerator.generateReport(state.repoAnalysis, state.issues, state.fixResults || []);
  
  fs.writeFileSync('debug-report.md', report);
  console.log('Debug report generated.');
}

// Helper functions
function saveState(state) {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function loadState() {
  if (!fs.existsSync(statePath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function setOutput(name, value) {
  // For GitHub Actions
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
  // For local development
  console.log(`Setting output ${name}=${value}`);
}

// Run the main function
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});