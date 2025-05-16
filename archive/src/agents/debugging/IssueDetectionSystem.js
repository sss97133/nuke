const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { OpenAI } = require('openai');

class IssueDetectionSystem {
  constructor(openAiApiKey, githubToken) {
    this.openai = new OpenAI({ apiKey: openAiApiKey });
    this.githubToken = githubToken;
  }
  
  async detectIssues(repoAnalysis) {
    console.log('Detecting issues in the codebase...');
    
    const issues = [];
    
    // Run several types of issue detection
    issues.push(...await this.detectCodeQualityIssues(repoAnalysis));
    issues.push(...await this.detectBrokenFeatures(repoAnalysis));
    issues.push(...await this.checkFailingTests(repoAnalysis));
    
    // Prioritize issues
    const prioritizedIssues = this.prioritizeIssues(issues);
    
    return prioritizedIssues;
  }
  
  async detectCodeQualityIssues(repoAnalysis) {
    console.log('Checking for code quality issues...');
    
    const issues = [];
    
    // Run ESLint if available
    try {
      const eslintOutput = execSync('npx eslint --format=json src').toString();
      const eslintResults = JSON.parse(eslintOutput);
      
      eslintResults.forEach(result => {
        result.messages.forEach(message => {
          issues.push({
            type: 'code-quality',
            severity: this.mapEslintSeverity(message.severity),
            description: message.message,
            fileLocation: `${result.filePath}:${message.line}:${message.column}`,
            ruleId: message.ruleId
          });
        });
      });
    } catch (error) {
      // ESLint might exit with non-zero code if issues found
      try {
        const errorOutput = error.stdout.toString();
        if (errorOutput) {
          const eslintResults = JSON.parse(errorOutput);
          
          eslintResults.forEach(result => {
            result.messages.forEach(message => {
              issues.push({
                type: 'code-quality',
                severity: this.mapEslintSeverity(message.severity),
                description: message.message,
                fileLocation: `${result.filePath}:${message.line}:${message.column}`,
                ruleId: message.ruleId
              });
            });
          });
        }
      } catch (parseError) {
        console.log('Could not parse ESLint output, using AI to detect code quality issues');
        
        // Use OpenAI to check code quality for each component
        await Promise.all(repoAnalysis.components.slice(0, 10).map(async component => {
          const qualityIssues = await this.analyzeComponentQuality(component);
          issues.push(...qualityIssues);
        }));
      }
    }
    
    return issues;
  }
  
  async analyzeComponentQuality(component) {
    const prompt = `
    Analyze this code for quality issues, potential bugs, and code smells.
    Focus on:
    1. Undefined variables or properties
    2. Potential race conditions
    3. Memory leaks
    4. Poor error handling
    5. Performance issues
    
    CODE:
    ${component.content}
    
    Output a JSON array of issues. Each issue should have fields: 
    description (what the issue is), 
    severity ('critical', 'important', or 'minor'), 
    location (line number or code section),
    suggestedFix (a brief description of how to fix it)
    `;
    
    const response = await this.openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 2000
    });
    
    try {
      const text = response.choices[0].message.content;
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const qualityIssues = JSON.parse(jsonMatch[0]);
        return qualityIssues.map(issue => ({
          type: 'code-quality',
          severity: issue.severity,
          description: issue.description,
          fileLocation: `${component.path}:${issue.location}`,
          suggestedFix: issue.suggestedFix
        }));
      }
      return [];
    } catch (error) {
      console.error('Error parsing code quality analysis:', error);
      return [];
    }
  }
  
  async detectBrokenFeatures(repoAnalysis) {
    console.log('Detecting broken features...');
    
    const issues = [];
    
    // For each feature, check if it appears to be broken
    await Promise.all(repoAnalysis.features.map(async feature => {
      // Use OpenAI to analyze if the feature looks broken based on the components
      const relevantComponents = feature.implementingComponents.map(componentName => {
        return repoAnalysis.components.find(c => c.name === componentName);
      }).filter(Boolean);
      
      if (relevantComponents.length === 0) {
        // Feature mentioned in docs but no implementing components found
        issues.push({
          type: 'broken-feature',
          severity: 'important',
          description: `Feature "${feature.name}" documented but no implementing components found`,
          feature: feature.name
        });
        return;
      }
      
      const brokenFeatureIssues = await this.analyzeFeatureFunctionality(feature, relevantComponents);
      issues.push(...brokenFeatureIssues);
    }));
    
    return issues;
  }
  
  async analyzeFeatureFunctionality(feature, components) {
    // Get component code
    const componentCode = components.map(component => 
      `--- ${component.path} ---\n${component.content.substring(0, 1000)}`
    ).join('\n\n');
    
    const prompt = `
    Analyze if this feature appears to be broken or incomplete based on the implementing components.
    
    FEATURE DESCRIPTION:
    ${feature.description}
    
    USER STEPS:
    ${feature.userSteps.join('\n')}
    
    IMPLEMENTING COMPONENTS:
    ${componentCode}
    
    Output a JSON array of issues. Each issue should have fields:
    description (what seems broken),
    severity ('critical', 'important', or 'minor'),
    fileLocation (the specific file or component with the issue),
    suggestedFix (a brief description of how to fix it)
    
    If the feature appears to be working correctly, return an empty array.
    `;
    
    const response = await this.openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 2000
    });
    
    try {
      const text = response.choices[0].message.content;
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const functionalityIssues = JSON.parse(jsonMatch[0]);
        return functionalityIssues.map(issue => ({
          type: 'broken-feature',
          severity: issue.severity,
          description: issue.description,
          fileLocation: issue.fileLocation,
          feature: feature.name,
          suggestedFix: issue.suggestedFix
        }));
      }
      return [];
    } catch (error) {
      console.error('Error parsing feature functionality analysis:', error);
      return [];
    }
  }
  
  async checkFailingTests(repoAnalysis) {
    console.log('Checking for failing tests...');
    
    const issues = [];
    
    // Run tests if package.json has a test script
    try {
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      
      if (packageJson.scripts && packageJson.scripts.test) {
        try {
          execSync('npm test -- --json --outputFile=test-results.json');
          
          if (fs.existsSync('test-results.json')) {
            const testResults = JSON.parse(fs.readFileSync('test-results.json', 'utf8'));
            
            // Extract failing tests
            if (testResults.testResults) {
              testResults.testResults.forEach(suite => {
                if (suite.status === 'failed') {
                  suite.assertionResults
                    .filter(assertion => assertion.status === 'failed')
                    .forEach(failedTest => {
                      issues.push({
                        type: 'failing-test',
                        severity: 'important',
                        description: `Test "${failedTest.title}" is failing: ${failedTest.failureMessages[0]}`,
                        fileLocation: suite.name,
                        testName: failedTest.title
                      });
                    });
                }
              });
            }
          }
        } catch (error) {
          console.log('Tests failed, analyzing output...');
          
          // Even if tests fail, we might get output
          if (fs.existsSync('test-results.json')) {
            try {
              const testResults = JSON.parse(fs.readFileSync('test-results.json', 'utf8'));
              
              // Extract failing tests
              if (testResults.testResults) {
                testResults.testResults.forEach(suite => {
                  if (suite.status === 'failed') {
                    suite.assertionResults
                      .filter(assertion => assertion.status === 'failed')
                      .forEach(failedTest => {
                        issues.push({
                          type: 'failing-test',
                          severity: 'important',
                          description: `Test "${failedTest.title}" is failing: ${failedTest.failureMessages[0]}`,
                          fileLocation: suite.name,
                          testName: failedTest.title
                        });
                      });
                  }
                });
              }
            } catch (parseError) {
              console.error('Error parsing test results:', parseError);
            }
          }
        }
      }
    } catch (error) {
      console.log('Could not run tests:', error.message);
    }
    
    return issues;
  }
  
  mapEslintSeverity(eslintSeverity) {
    // Map ESLint severity (0=off, 1=warn, 2=error) to our severity levels
    switch (eslintSeverity) {
      case 2: return 'important';
      case 1: return 'minor';
      default: return 'minor';
    }
  }
  
  prioritizeIssues(issues) {
    // Sort issues by severity
    const priorityOrder = { 'critical': 0, 'important': 1, 'minor': 2 };
    
    return issues
      .sort((a, b) => {
        // First sort by severity
        const severityDiff = priorityOrder[a.severity] - priorityOrder[b.severity];
        if (severityDiff !== 0) return severityDiff;
        
        // Then by type (broken features before code quality)
        if (a.type === 'broken-feature' && b.type !== 'broken-feature') return -1;
        if (a.type !== 'broken-feature' && b.type === 'broken-feature') return 1;
        
        return 0;
      });
  }
}

module.exports = { IssueDetectionSystem };