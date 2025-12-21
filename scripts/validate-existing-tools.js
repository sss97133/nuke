#!/usr/bin/env node

/**
 * VALIDATE EXISTING TOOLS
 * 
 * Tests if current extraction tools are "up to snuff" for 33k/day scale
 * Before building autonomous agents, we need to know what actually works
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  console.log('🔧 VALIDATING EXISTING EXTRACTION TOOLS');
  console.log('======================================');
  console.log('Testing if current tools can handle 33k vehicles/day for 1M goal');
  console.log('');
  
  try {
    // Test the benchmark validator
    const response = await fetch(`${SUPABASE_URL}/functions/v1/tool-benchmark-validator`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'benchmark_all_tools'
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Benchmark failed: ${response.status} ${errorText}`);
    }
    
    const result = await response.json();
    
    console.log('📊 TOOL VALIDATION RESULTS');
    console.log('===========================');
    
    // Overall assessment
    const assessment = result.assessment;
    console.log(`✅ Working Tools: ${assessment.working_tools}/${assessment.total_tools_tested}`);
    console.log(`🎯 Scale Ready: ${assessment.scale_ready_tools}/${assessment.total_tools_tested}`);
    console.log(`📈 Average Performance: ${assessment.average_performance.toFixed(1)}/100`);
    console.log(`🚀 Pipeline Ready for 33k/day: ${assessment.pipeline_ready_for_33k ? 'YES' : 'NO'}`);
    console.log('');
    
    // Individual tool results
    console.log('🔧 INDIVIDUAL TOOL RESULTS:');
    console.log('============================');
    
    result.tool_results.forEach((tool, index) => {
      console.log(`\n${index + 1}. ${tool.tool_name.toUpperCase()}`);
      console.log(`   Status: ${tool.success ? '✅ Working' : '❌ Broken'}`);
      console.log(`   Performance: ${tool.performance_score}/100`);
      console.log(`   Throughput: ${tool.throughput} items/hour`);
      console.log(`   Success Rate: ${tool.success_rate}%`);
      console.log(`   Scale Ready: ${tool.scale_ready ? '✅ YES' : '❌ NO'}`);
      
      if (tool.issues_found && tool.issues_found.length > 0) {
        console.log(`   Issues: ${tool.issues_found.join(', ')}`);
      }
      
      if (tool.recommendations && tool.recommendations.length > 0) {
        console.log(`   Fix: ${tool.recommendations.join(', ')}`);
      }
    });
    
    // Critical issues
    if (assessment.critical_issues.length > 0) {
      console.log('\n🚨 CRITICAL ISSUES FOUND:');
      console.log('=========================');
      assessment.critical_issues.forEach((issue, index) => {
        console.log(`${index + 1}. ${issue.tool_name}: ${issue.issues_found.join(', ')}`);
      });
    }
    
    // Overall recommendations
    console.log('\n💡 RECOMMENDATIONS:');
    console.log('====================');
    assessment.recommendations.forEach((rec, index) => {
      console.log(`${index + 1}. ${rec}`);
    });
    
    // Decision matrix
    console.log('\n🎯 DECISION MATRIX:');
    console.log('===================');
    
    if (assessment.pipeline_ready_for_33k) {
      console.log('✅ PROCEED: Your existing tools can handle 33k/day');
      console.log('   → Deploy autonomous agents using existing functions');
      console.log('   → Monitor performance and optimize bottlenecks');
    } else if (assessment.scale_ready_tools >= 2) {
      console.log('⚠️ CAUTION: Some tools ready, others need fixes');
      console.log('   → Fix critical issues first');
      console.log('   → Deploy agents on working tools only');
      console.log('   → Gradually add fixed tools');
    } else {
      console.log('❌ STOP: Too many tools not ready for scale');
      console.log('   → Fix broken tools before autonomous agents');
      console.log('   → Re-run validation after fixes');
      console.log('   → Don\'t attempt 1M profiles until tools are proven');
    }
    
    console.log('\n📋 NEXT STEPS:');
    console.log('===============');
    
    if (!assessment.pipeline_ready_for_33k) {
      console.log('1. Fix the critical issues listed above');
      console.log('2. Re-run validation: node scripts/validate-existing-tools.js');
      console.log('3. Only deploy autonomous agents after tools are proven');
    } else {
      console.log('1. Deploy autonomous agents: ./scripts/setup-autonomous-agents.sh');
      console.log('2. Monitor scale performance');
      console.log('3. Optimize any remaining bottlenecks');
    }
    
  } catch (error) {
    console.error('❌ Tool validation failed:', error.message);
    
    console.log('\n🔍 MANUAL VALIDATION STEPS:');
    console.log('============================');
    console.log('1. Test scrape-multi-source manually:');
    console.log('   curl -X POST "your-url/functions/v1/scrape-multi-source" \\');
    console.log('        -d \'{"source_url": "https://carsandbids.com", "max_listings": 5}\'');
    console.log('');
    console.log('2. Check function logs:');
    console.log('   supabase functions logs scrape-multi-source');
    console.log('');
    console.log('3. Test with smaller batch:');
    console.log('   Start with 1-5 vehicles to verify basic functionality');
    
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
