#!/usr/bin/env node

/**
 * Monitor Extraction Quality Trends
 * Tracks quality over time to detect when source sites change structure
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('❌ Missing Supabase configuration');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

const TRENDS_FILE = '/Users/skylar/nuke/quality_trends.json';

async function recordQualitySnapshot() {
  console.log('📊 Recording quality snapshot...');

  try {
    // Get current quality metrics
    const { data: inspection, error } = await supabase.functions.invoke('inspect-extraction-quality', {
      body: {
        inspection_type: 'data_quality_audit',
        source_filter: 'bat',
        limit: 50
      }
    });

    if (error || !inspection?.success) {
      console.error('❌ Failed to get quality metrics:', error);
      return null;
    }

    const snapshot = {
      timestamp: new Date().toISOString(),
      metrics: inspection.quality_metrics,
      sample_info: inspection.sample_info,
      source: 'bat'
    };

    // Load existing trends
    let trends = [];
    if (fs.existsSync(TRENDS_FILE)) {
      const existing = fs.readFileSync(TRENDS_FILE, 'utf8');
      trends = JSON.parse(existing);
    }

    // Add new snapshot
    trends.push(snapshot);

    // Keep only last 50 snapshots
    if (trends.length > 50) {
      trends = trends.slice(-50);
    }

    // Save trends
    fs.writeFileSync(TRENDS_FILE, JSON.stringify(trends, null, 2));

    return snapshot;

  } catch (err) {
    console.error('❌ Error recording snapshot:', err.message);
    return null;
  }
}

async function analyzeTrends() {
  if (!fs.existsSync(TRENDS_FILE)) {
    console.log('📊 No trend data available yet. Run this script a few times to build history.');
    return;
  }

  const trends = JSON.parse(fs.readFileSync(TRENDS_FILE, 'utf8'));

  if (trends.length < 2) {
    console.log('📊 Need at least 2 snapshots to analyze trends.');
    return;
  }

  const latest = trends[trends.length - 1];
  const previous = trends[trends.length - 2];

  console.log('\n📈 QUALITY TREND ANALYSIS');
  console.log('='.repeat(50));
  console.log(`Latest: ${new Date(latest.timestamp).toLocaleString()}`);
  console.log(`Previous: ${new Date(previous.timestamp).toLocaleString()}`);

  const changes = {
    vin_coverage: latest.metrics.vin_coverage - previous.metrics.vin_coverage,
    engine_coverage: latest.metrics.engine_coverage - previous.metrics.engine_coverage,
    transmission_coverage: latest.metrics.transmission_coverage - previous.metrics.transmission_coverage,
    mileage_coverage: latest.metrics.mileage_coverage - previous.metrics.mileage_coverage,
    description_coverage: latest.metrics.description_coverage - previous.metrics.description_coverage,
    data_completeness: latest.metrics.data_completeness_score - previous.metrics.data_completeness_score
  };

  console.log('\n📊 CHANGES SINCE LAST CHECK');
  console.log('-'.repeat(40));

  Object.entries(changes).forEach(([metric, change]) => {
    const direction = change > 0 ? '📈' : change < 0 ? '📉' : '➡️';
    const percentage = (change * 100).toFixed(1);
    const sign = change > 0 ? '+' : '';
    console.log(`${direction} ${metric.replace('_', ' ')}: ${sign}${percentage}%`);
  });

  // Detect concerning trends
  const concerns = [];
  if (changes.data_completeness < -0.1) {
    concerns.push('🚨 CRITICAL: Data completeness dropped by >10%');
  }
  if (changes.vin_coverage < -0.15) {
    concerns.push('⚠️ VIN coverage dropped significantly');
  }
  if (changes.engine_coverage < -0.1) {
    concerns.push('⚠️ Engine extraction quality declined');
  }

  if (concerns.length > 0) {
    console.log('\n🚨 QUALITY ALERTS');
    console.log('-'.repeat(30));
    concerns.forEach(concern => console.log(concern));
    console.log('\n💡 This may indicate the source site changed its structure.');
  } else if (Object.values(changes).every(c => c >= 0)) {
    console.log('\n✅ All metrics stable or improving!');
  }

  // Show longer-term trend if we have enough data
  if (trends.length >= 5) {
    const weekAgo = trends[Math.max(0, trends.length - 7)];
    const longTermChange = latest.metrics.data_completeness_score - weekAgo.metrics.data_completeness_score;

    console.log('\n📅 WEEKLY TREND');
    console.log('-'.repeat(20));
    const weeklyDirection = longTermChange > 0 ? '📈' : longTermChange < 0 ? '📉' : '➡️';
    console.log(`${weeklyDirection} Overall Quality: ${(longTermChange * 100).toFixed(1)}% over ${trends.length} snapshots`);
  }
}

async function predictQualityIssues() {
  if (!fs.existsSync(TRENDS_FILE)) return;

  const trends = JSON.parse(fs.readFileSync(TRENDS_FILE, 'utf8'));

  if (trends.length < 5) return;

  // Look for quality degradation patterns
  const recent = trends.slice(-5);
  const avgQuality = recent.reduce((sum, t) => sum + t.metrics.data_completeness_score, 0) / recent.length;

  console.log('\n🔮 PREDICTIVE ANALYSIS');
  console.log('-'.repeat(30));
  console.log(`Recent Average Quality: ${(avgQuality * 100).toFixed(1)}%`);

  // Check for declining trend
  let decliningCount = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].metrics.data_completeness_score < recent[i-1].metrics.data_completeness_score) {
      decliningCount++;
    }
  }

  if (decliningCount >= 3) {
    console.log('⚠️ Quality declining trend detected');
    console.log('💡 Consider running accuracy audit or checking for site changes');
  } else {
    console.log('✅ Quality trend is stable');
  }
}

async function suggestNextActions(snapshot) {
  const metrics = snapshot.metrics;
  const suggestions = [];

  if (metrics.vin_coverage < 0.8) {
    suggestions.push('Continue backfill script - VIN coverage still improving');
  }

  if (metrics.engine_coverage < 0.5) {
    suggestions.push('Monitor engine extraction - may need router updates');
  }

  if (metrics.data_completeness_score > 0.85) {
    suggestions.push('Quality is excellent - consider reducing monitoring frequency');
  } else if (metrics.data_completeness_score < 0.6) {
    suggestions.push('Quality needs attention - run side-by-side audit');
  }

  console.log('\n💡 SUGGESTED ACTIONS');
  console.log('-'.repeat(30));
  suggestions.forEach(suggestion => console.log(`• ${suggestion}`));
}

async function main() {
  console.log('📊 EXTRACTION QUALITY MONITORING');
  console.log('='.repeat(60));

  // Record current snapshot
  const snapshot = await recordQualitySnapshot();

  if (snapshot) {
    console.log(`✅ Quality snapshot recorded at ${new Date(snapshot.timestamp).toLocaleString()}`);

    console.log('\n📊 CURRENT QUALITY STATUS');
    console.log('-'.repeat(40));
    const m = snapshot.metrics;
    console.log(`🔢 VIN Coverage: ${(m.vin_coverage * 100).toFixed(1)}%`);
    console.log(`⚙️ Engine Coverage: ${(m.engine_coverage * 100).toFixed(1)}%`);
    console.log(`🔧 Transmission Coverage: ${(m.transmission_coverage * 100).toFixed(1)}%`);
    console.log(`📏 Mileage Coverage: ${(m.mileage_coverage * 100).toFixed(1)}%`);
    console.log(`✅ Overall Completeness: ${(m.data_completeness_score * 100).toFixed(1)}%`);

    await suggestNextActions(snapshot);
  }

  // Analyze trends
  await analyzeTrends();

  // Predictive analysis
  await predictQualityIssues();

  console.log('\n📋 MONITORING SETUP');
  console.log('-'.repeat(30));
  console.log('• Run this script periodically to track quality trends');
  console.log('• Quality data is saved to quality_trends.json');
  console.log('• Set up a cron job to automate monitoring');
  console.log('• When quality drops, run side-by-side accuracy audit');

  console.log('\n🔄 AUTOMATION SUGGESTION');
  console.log('```bash');
  console.log('# Add to crontab for daily monitoring');
  console.log('0 9 * * * cd /Users/skylar/nuke && node scripts/monitor-extraction-trends.js');
  console.log('```');
}

main().catch(console.error);