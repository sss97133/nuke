#!/usr/bin/env node
/**
 * Vehicle Profile Data Health Report
 *
 * Reads existing audit artifacts (JSON) and produces:
 * - vehicle-profile-data-health.json
 * - VEHICLE_PROFILE_DATA_HEALTH_REPORT.md
 *
 * This script does not query the database; it summarizes what we already captured.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const INPUT_BAT_AUDIT = path.join(repoRoot, 'bat-missing-data-audit.json');
const INPUT_PROFILE_AUDIT = path.join(repoRoot, 'profile_audit_results.json');

const OUTPUT_JSON = path.join(repoRoot, 'vehicle-profile-data-health.json');
const OUTPUT_MD = path.join(repoRoot, 'VEHICLE_PROFILE_DATA_HEALTH_REPORT.md');

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function readJsonOrNull(filePath) {
  if (!fileExists(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse JSON: ${filePath} (${err?.message || String(err)})`);
  }
}

function toNumberOrNull(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function round(n, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function median(nums) {
  const values = nums.filter(n => typeof n === 'number' && Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (values.length === 0) return null;
  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[mid];
  return (values[mid - 1] + values[mid]) / 2;
}

function detectSourceType(url) {
  if (!url) return 'unknown';
  const u = String(url);
  if (u.includes('bringatrailer.com')) return 'BaT';
  if (u.includes('mecum.com')) return 'Mecum';
  if (u.includes('barrett-jackson.com')) return 'Barrett-Jackson';
  if (u.includes('carsandbids.com')) return 'Cars & Bids';
  if (u.includes('classiccars.com')) return 'ClassicCars.com';
  if (u.includes('autotrader.com')) return 'AutoTrader';
  return 'other';
}

function getDomain(url) {
  if (!url) return null;
  try {
    const hostname = new URL(url).hostname || null;
    if (!hostname) return null;
    return hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

function safePercent(numerator, denominator) {
  if (!denominator || denominator <= 0) return null;
  return (numerator / denominator) * 100;
}

function buildBatSummary(batAudit) {
  if (!batAudit) return null;

  const totalVehicles = toNumberOrNull(batAudit?.summary?.total_vehicles) ?? toNumberOrNull(batAudit?.summary?.total) ?? null;
  const vehiclesNeedingFix = toNumberOrNull(batAudit?.summary?.vehicles_needing_fix) ?? null;
  const missingFields = batAudit?.summary?.missing_fields ?? null;
  const potentialVerification = batAudit?.summary?.potential_verification ?? null;

  const vehicles = Array.isArray(batAudit?.vehicles) ? batAudit.vehicles : [];
  const missingScores = vehicles.map(v => toNumberOrNull(v?.missing_score)).filter(n => n !== null);

  const scoreDistribution = {};
  for (const score of missingScores) {
    scoreDistribution[String(score)] = (scoreDistribution[String(score)] || 0) + 1;
  }

  const maxPossibleMissingScore = 19; // from scripts/audit-bat-missing-data.js weights
  const avgMissingScore = missingScores.length ? missingScores.reduce((a, b) => a + b, 0) / missingScores.length : null;

  return {
    audit_date: batAudit?.audit_date ?? null,
    audit_version: toNumberOrNull(batAudit?.audit_version),
    generator: typeof batAudit?.generator === 'string' ? batAudit.generator : null,
    total_vehicles: totalVehicles,
    vehicles_needing_fix: vehiclesNeedingFix,
    missing_fields: missingFields,
    missing_score_stats: {
      count: missingScores.length,
      min: missingScores.length ? Math.min(...missingScores) : null,
      max: missingScores.length ? Math.max(...missingScores) : null,
      avg: avgMissingScore !== null ? round(avgMissingScore, 3) : null,
      median: median(missingScores) !== null ? round(median(missingScores), 3) : null,
      max_possible: maxPossibleMissingScore,
      distribution: scoreDistribution
    },
    potential_verification: potentialVerification
  };
}

function buildProfileAuditSummary(profileAudit) {
  if (!profileAudit) return null;

  const results = Array.isArray(profileAudit?.results) ? profileAudit.results : [];

  const byStatus = {};
  const bySourceType = {};
  const byDomain = {};

  const accuracyScores = [];
  const checkedAccuracyScores = [];

  for (const r of results) {
    const status = r?.status || 'unknown';
    byStatus[status] = (byStatus[status] || 0) + 1;

    const sourceUrl = r?.source_url || null;
    const sourceType = detectSourceType(sourceUrl);
    bySourceType[sourceType] = bySourceType[sourceType] || { total: 0, checked: 0, avg_accuracy: null, avg_accuracy_checked_only: null };
    bySourceType[sourceType].total += 1;

    const domain = getDomain(sourceUrl);
    if (domain) {
      byDomain[domain] = byDomain[domain] || { total: 0, checked: 0, fetch_failures: 0, avg_accuracy: null };
      byDomain[domain].total += 1;
    }

    const acc = toNumberOrNull(r?.accuracy_score);
    if (acc !== null) {
      accuracyScores.push(acc);
    }

    if (status === 'checked') {
      bySourceType[sourceType].checked += 1;
      if (domain) byDomain[domain].checked += 1;
      if (acc !== null) checkedAccuracyScores.push(acc);
    }

    if (status === 'source_fetch_failed') {
      if (domain) byDomain[domain].fetch_failures += 1;
    }
  }

  function attachAverages(groupObj, pickAccuracyScoresFn) {
    for (const [key, bucket] of Object.entries(groupObj)) {
      const scores = pickAccuracyScoresFn(key, bucket);
      const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
      if ('avg_accuracy' in bucket) bucket.avg_accuracy = avg !== null ? round(avg, 3) : null;
      if ('avg_accuracy_checked_only' in bucket) bucket.avg_accuracy_checked_only = avg !== null ? round(avg, 3) : null;
    }
  }

  // Average accuracy by source type (checked-only)
  attachAverages(bySourceType, (sourceType) => {
    const scores = [];
    for (const r of results) {
      if (detectSourceType(r?.source_url) !== sourceType) continue;
      if (r?.status !== 'checked') continue;
      const acc = toNumberOrNull(r?.accuracy_score);
      if (acc !== null) scores.push(acc);
    }
    return scores;
  });

  // Average accuracy by domain (checked-only)
  attachAverages(byDomain, (domain) => {
    const scores = [];
    for (const r of results) {
      if (getDomain(r?.source_url) !== domain) continue;
      if (r?.status !== 'checked') continue;
      const acc = toNumberOrNull(r?.accuracy_score);
      if (acc !== null) scores.push(acc);
    }
    return scores;
  });

  const avgAccuracy = accuracyScores.length ? accuracyScores.reduce((a, b) => a + b, 0) / accuracyScores.length : null;
  const avgAccuracyCheckedOnly = checkedAccuracyScores.length ? checkedAccuracyScores.reduce((a, b) => a + b, 0) / checkedAccuracyScores.length : null;

  return {
    timestamp: profileAudit?.timestamp ?? null,
    total_audited: toNumberOrNull(profileAudit?.total_audited) ?? results.length,
    summary: profileAudit?.summary ?? null,
    status_breakdown: byStatus,
    accuracy: {
      avg_all: avgAccuracy !== null ? round(avgAccuracy, 3) : null,
      avg_checked_only: avgAccuracyCheckedOnly !== null ? round(avgAccuracyCheckedOnly, 3) : null,
      median_all: median(accuracyScores) !== null ? round(median(accuracyScores), 3) : null,
      median_checked_only: median(checkedAccuracyScores) !== null ? round(median(checkedAccuracyScores), 3) : null
    },
    by_source_type: bySourceType,
    by_domain: byDomain
  };
}

function mergePerVehicle(batAudit, profileAudit) {
  const vehiclesById = new Map();

  // BaT missing-data audit vehicles
  if (batAudit && Array.isArray(batAudit?.vehicles)) {
    const maxPossibleMissingScore = 19;

    for (const v of batAudit.vehicles) {
      const id = v?.id;
      if (!id) continue;

      const missingScore = toNumberOrNull(v?.missing_score);
      const completenessScore =
        missingScore === null ? null : Math.max(0, Math.min(100, Math.round(100 * (1 - missingScore / maxPossibleMissingScore))));

      vehiclesById.set(id, {
        vehicle_id: id,
        identity: v?.vehicle ?? null,
        source_url: v?.url ?? null,
        source_type: detectSourceType(v?.url),
        domain: getDomain(v?.url),

        completeness: {
          bat_missing_score: missingScore,
          bat_completeness_score_0_100: completenessScore,
          issues: Array.isArray(v?.issues) ? v.issues : [],
          comment_count: toNumberOrNull(v?.comment_count),
          image_count: toNumberOrNull(v?.image_count),
          has_auction_event: typeof v?.has_auction_event === 'boolean' ? v.has_auction_event : null
        },

        potential: {
          score_0_100: toNumberOrNull(v?.potential_score),
          timeline_event_count: toNumberOrNull(v?.timeline_event_count),
          evidence_count: toNumberOrNull(v?.evidence_count)
        },

        verification: {
          score_0_100: toNumberOrNull(v?.verification_score),
          accepted_evidence_count: toNumberOrNull(v?.accepted_evidence_count),
          provenance_field_count: toNumberOrNull(v?.provenance_field_count),
          provenance_high_confidence_field_count: toNumberOrNull(v?.provenance_high_confidence_field_count)
        },

        extraction_accuracy: null
      });
    }
  }

  // Profile audit results (multi-source)
  if (profileAudit && Array.isArray(profileAudit?.results)) {
    for (const r of profileAudit.results) {
      const id = r?.vehicle_id;
      if (!id) continue;

      const existing = vehiclesById.get(id) || {
        vehicle_id: id,
        identity: r?.identity ?? null,
        source_url: r?.source_url ?? null,
        source_type: detectSourceType(r?.source_url),
        domain: getDomain(r?.source_url),
        completeness: null,
        extraction_accuracy: null
      };

      existing.identity = existing.identity || r?.identity || null;
      existing.source_url = existing.source_url || r?.source_url || null;
      existing.source_type = existing.source_type || detectSourceType(existing.source_url);
      existing.domain = existing.domain || getDomain(existing.source_url);

      existing.extraction_accuracy = {
        status: r?.status ?? null,
        accuracy_score_0_1: toNumberOrNull(r?.accuracy_score),
        error: r?.error ?? null,
        matches: r?.matches ?? null,
        discrepancies: Array.isArray(r?.discrepancies) ? r.discrepancies : null
      };

      vehiclesById.set(id, existing);
    }
  }

  const vehicles = Array.from(vehiclesById.values());

  // Rank worst offenders:
  // 1) Higher missing_score (if present)
  // 2) Lower accuracy (if present)
  // 3) Fetch failures first
  vehicles.sort((a, b) => {
    const aMissing = toNumberOrNull(a?.completeness?.bat_missing_score);
    const bMissing = toNumberOrNull(b?.completeness?.bat_missing_score);
    if (aMissing !== null && bMissing !== null && aMissing !== bMissing) return bMissing - aMissing;
    if (aMissing !== null && bMissing === null) return -1;
    if (aMissing === null && bMissing !== null) return 1;

    const aStatus = a?.extraction_accuracy?.status ?? null;
    const bStatus = b?.extraction_accuracy?.status ?? null;
    const aFail = aStatus === 'source_fetch_failed' ? 1 : 0;
    const bFail = bStatus === 'source_fetch_failed' ? 1 : 0;
    if (aFail !== bFail) return bFail - aFail;

    const aAcc = toNumberOrNull(a?.extraction_accuracy?.accuracy_score_0_1);
    const bAcc = toNumberOrNull(b?.extraction_accuracy?.accuracy_score_0_1);
    if (aAcc !== null && bAcc !== null && aAcc !== bAcc) return aAcc - bAcc;
    if (aAcc !== null && bAcc === null) return -1;
    if (aAcc === null && bAcc !== null) return 1;

    return String(a.vehicle_id).localeCompare(String(b.vehicle_id));
  });

  return vehicles;
}

function buildReportData(batAudit, profileAudit) {
  const batSummary = buildBatSummary(batAudit);
  const profileSummary = buildProfileAuditSummary(profileAudit);

  const vehicles = mergePerVehicle(batAudit, profileAudit);

  const withBat = vehicles.filter(v => v?.completeness?.bat_missing_score !== undefined && v?.completeness !== null).length;
  const withProfile = vehicles.filter(v => v?.extraction_accuracy !== null).length;
  const withBoth = vehicles.filter(v => v?.completeness !== null && v?.extraction_accuracy !== null).length;

  return {
    generated_at: new Date().toISOString(),
    inputs: {
      bat_missing_data_audit: batAudit
        ? { path: INPUT_BAT_AUDIT, audit_date: batAudit?.audit_date ?? null }
        : null,
      profile_audit_results: profileAudit
        ? { path: INPUT_PROFILE_AUDIT, timestamp: profileAudit?.timestamp ?? null }
        : null
    },
    summary: {
      vehicle_coverage: {
        unique_vehicles: vehicles.length,
        with_bat_missing_audit: withBat,
        with_profile_audit: withProfile,
        with_both: withBoth
      },
      bat_missing_data_audit: batSummary,
      profile_source_audit: profileSummary
    },
    vehicles
  };
}

function formatMarkdown(report) {
  const bat = report?.summary?.bat_missing_data_audit;
  const prof = report?.summary?.profile_source_audit;

  const lines = [];

  lines.push('## Vehicle Profile Data Health Report');
  lines.push('');
  lines.push(`Generated: ${report.generated_at}`);
  lines.push('');

  lines.push('### Inputs');
  lines.push('');
  if (report?.inputs?.bat_missing_data_audit) {
    lines.push(`- bat missing data audit: \`${path.basename(report.inputs.bat_missing_data_audit.path)}\` (audit_date: ${report.inputs.bat_missing_data_audit.audit_date || 'unknown'})`);
  } else {
    lines.push('- bat missing data audit: not found');
  }
  if (report?.inputs?.profile_audit_results) {
    lines.push(`- profile source audit: \`${path.basename(report.inputs.profile_audit_results.path)}\` (timestamp: ${report.inputs.profile_audit_results.timestamp || 'unknown'})`);
  } else {
    lines.push('- profile source audit: not found');
  }
  lines.push('');

  lines.push('### Coverage');
  lines.push('');
  const cov = report?.summary?.vehicle_coverage;
  lines.push(`- unique vehicles covered: ${cov?.unique_vehicles ?? 0}`);
  lines.push(`- vehicles with completeness (BaT missing audit): ${cov?.with_bat_missing_audit ?? 0}`);
  lines.push(`- vehicles with extraction accuracy audit: ${cov?.with_profile_audit ?? 0}`);
  lines.push(`- vehicles with both: ${cov?.with_both ?? 0}`);
  lines.push('');

  if (bat) {
    lines.push('### Completeness signals (BaT missing-data audit)');
    lines.push('');
    lines.push(`- total vehicles audited: ${bat.total_vehicles ?? 'unknown'}`);
    lines.push(`- vehicles needing fix: ${bat.vehicles_needing_fix ?? 'unknown'}`);
    if (bat.audit_version) {
      lines.push(`- audit_version: ${bat.audit_version}`);
    }

    const ms = bat?.missing_score_stats;
    if (ms) {
      lines.push(`- missing_score stats: count=${ms.count}, min=${ms.min ?? 'n/a'}, median=${ms.median ?? 'n/a'}, avg=${ms.avg ?? 'n/a'}, max=${ms.max ?? 'n/a'} (max_possible=${ms.max_possible})`);
    }
    lines.push('');

    if (bat?.missing_fields) {
      lines.push('#### Missing field counts (top 12)');
      lines.push('');
      const entries = Object.entries(bat.missing_fields);
      entries.sort((a, b) => (b[1] || 0) - (a[1] || 0));
      for (const [field, count] of entries.slice(0, 12)) {
        lines.push(`- ${field}: ${count}`);
      }
      lines.push('');
    }

    lines.push('#### Notes');
    lines.push('');
    if (bat.audit_version && bat.audit_version >= 2) {
      lines.push('- Related-table checks (comments/images/events/listings) are chunked + paginated and will fail fast on Supabase query errors (audit_version>=2).');
    } else {
      lines.push('- This audit artifact may have been generated with an older version of `scripts/audit-bat-missing-data.js` that did not enforce error checks or pagination on related-table fetches (comments/images/events/listings). If those queries failed or truncated, the audit can over-report missing related data. Treat related-table "missing" results as provisional until you re-run the audit with the hardened script.');
    }
    lines.push('');

    // Potential vs Verification axis (provenance-first)
    const pv = bat?.potential_verification;
    const pvVehicles = Array.isArray(report?.vehicles)
      ? report.vehicles
          .filter(v => typeof v?.potential?.score_0_100 === 'number' && typeof v?.verification?.score_0_100 === 'number')
      : [];
    if (pv || pvVehicles.length > 0) {
      lines.push('### Potential vs Verification (BaT cohort)');
      lines.push('');
      if (pv) {
        const p = pv?.potential_score;
        const v = pv?.verification_score;
        if (p) lines.push(`- potential score (0-100): avg=${p.avg ?? 'n/a'}, median=${p.median ?? 'n/a'}, min=${p.min ?? 'n/a'}, max=${p.max ?? 'n/a'}`);
        if (v) lines.push(`- verification score (0-100): avg=${v.avg ?? 'n/a'}, median=${v.median ?? 'n/a'}, min=${v.min ?? 'n/a'}, max=${v.max ?? 'n/a'}`);
      }

      // Quadrants (tunable thresholds)
      const POTENTIAL_HIGH = 60;
      const VERIFICATION_HIGH = 60;
      const q = { hh: 0, hl: 0, lh: 0, ll: 0 };
      for (const row of pvVehicles) {
        const ps = row?.potential?.score_0_100;
        const vs = row?.verification?.score_0_100;
        if (typeof ps !== 'number' || typeof vs !== 'number') continue;
        const pHigh = ps >= POTENTIAL_HIGH;
        const vHigh = vs >= VERIFICATION_HIGH;
        if (pHigh && vHigh) q.hh += 1;
        else if (pHigh && !vHigh) q.hl += 1;
        else if (!pHigh && vHigh) q.lh += 1;
        else q.ll += 1;
      }
      if (pvVehicles.length > 0) {
        lines.push(`- quadrant counts (thresholds: potential>=${POTENTIAL_HIGH}, verification>=${VERIFICATION_HIGH}): HH=${q.hh}, HL=${q.hl}, LH=${q.lh}, LL=${q.ll}`);
      }
      lines.push('');

      // Top lists
      const topPotential = pvVehicles.slice().sort((a, b) => (b.potential.score_0_100 ?? 0) - (a.potential.score_0_100 ?? 0)).slice(0, 10);
      const topVerification = pvVehicles.slice().sort((a, b) => (b.verification.score_0_100 ?? 0) - (a.verification.score_0_100 ?? 0)).slice(0, 10);

      lines.push('#### High Potential (top 10)');
      lines.push('');
      for (const row of topPotential) {
        const url = row?.source_url ? ` (\`${row.source_url}\`)` : '';
        lines.push(`- ${row.identity || row.vehicle_id}${url} :: potential=${row.potential.score_0_100}, verification=${row.verification.score_0_100}`);
      }
      lines.push('');

      lines.push('#### High Verification (top 10)');
      lines.push('');
      for (const row of topVerification) {
        const url = row?.source_url ? ` (\`${row.source_url}\`)` : '';
        lines.push(`- ${row.identity || row.vehicle_id}${url} :: verification=${row.verification.score_0_100}, potential=${row.potential.score_0_100}`);
      }
      lines.push('');
    }
  }

  if (prof) {
    lines.push('### Extraction verifiability (profile source audit)');
    lines.push('');
    lines.push(`- total audited: ${prof.total_audited ?? 'unknown'}`);
    lines.push(`- status breakdown: ${Object.entries(prof.status_breakdown || {}).map(([k, v]) => `${k}=${v}`).join(', ') || 'n/a'}`);
    lines.push(`- accuracy avg (all): ${prof?.accuracy?.avg_all ?? 'n/a'}`);
    lines.push(`- accuracy avg (checked only): ${prof?.accuracy?.avg_checked_only ?? 'n/a'}`);
    lines.push('');

    lines.push('#### Domain reliability (top 15 by volume)');
    lines.push('');
    const domainRows = Object.entries(prof.by_domain || {});
    domainRows.sort((a, b) => (b[1]?.total || 0) - (a[1]?.total || 0));
    const topDomains = domainRows.slice(0, 15);
    for (const [domain, stats] of topDomains) {
      const total = stats?.total ?? 0;
      const checked = stats?.checked ?? 0;
      const failures = stats?.fetch_failures ?? 0;
      const failureRate = safePercent(failures, total);
      const avgAcc = stats?.avg_accuracy ?? null;

      let tier = 'unknown';
      if (failureRate !== null && failureRate >= 50) tier = 'blocked';
      else if (typeof avgAcc === 'number' && avgAcc >= 0.6) tier = 'high';
      else if (typeof avgAcc === 'number' && avgAcc >= 0.3) tier = 'medium';
      else if (typeof avgAcc === 'number') tier = 'low';

      lines.push(`- ${domain}: total=${total}, checked=${checked}, failures=${failures} (${failureRate !== null ? round(failureRate, 1) : 'n/a'}%), avg_accuracy_checked=${avgAcc !== null ? round(avgAcc, 3) : 'n/a'}, tier=${tier}`);
    }
    lines.push('');
  }

  // Worst offenders lists
  lines.push('### Worst offenders (top 25)');
  lines.push('');
  const worst = Array.isArray(report?.vehicles) ? report.vehicles.slice(0, 25) : [];
  for (const v of worst) {
    const url = v?.source_url ? ` (\`${v.source_url}\`)` : '';
    const missing = v?.completeness?.bat_missing_score;
    const acc = v?.extraction_accuracy?.accuracy_score_0_1;
    const status = v?.extraction_accuracy?.status;
    const parts = [];
    if (missing !== null && missing !== undefined) parts.push(`missing_score=${missing}`);
    if (status) parts.push(`status=${status}`);
    if (acc !== null && acc !== undefined) parts.push(`accuracy=${round(acc, 3)}`);
    lines.push(`- ${v.identity || v.vehicle_id}${url} :: ${parts.join(', ') || 'no metrics'}`);
  }
  lines.push('');

  lines.push('### Top fix levers (highest ROI)');
  lines.push('');
  lines.push('- If your BaT audit is old: re-run `scripts/audit-bat-missing-data.js` (audit_version>=2) so related-table counts (comments/images/events/listings) are measured reliably (chunked, paginated, fails on errors).');
  lines.push('- For **Potential**: add “treasure map” leads first (images, timeline events, citations/URLs, notes). These raise the potential score without pretending the profile is verified.');
  lines.push('- For **Verification**: submit high-trust proof (auction results, titles, receipts, factory docs) so consensus can safely assign values and close gaps (instead of writing raw values).');
  lines.push('- For **platform reliability**: treat blocked/low-reliability domains as “needs ingestion strategy” (crawler/caching/API) rather than “bad data”; otherwise verifiability will stay low even if potential is high.');
  lines.push('');

  return lines.join('\n');
}

function main() {
  const batAudit = readJsonOrNull(INPUT_BAT_AUDIT);
  const profileAudit = readJsonOrNull(INPUT_PROFILE_AUDIT);

  if (!batAudit && !profileAudit) {
    console.error('No input audits found. Expected at least one of:');
    console.error(`- ${INPUT_BAT_AUDIT}`);
    console.error(`- ${INPUT_PROFILE_AUDIT}`);
    process.exit(1);
  }

  const report = buildReportData(batAudit, profileAudit);

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(report, null, 2));
  fs.writeFileSync(OUTPUT_MD, formatMarkdown(report));

  console.log(`Wrote ${path.relative(repoRoot, OUTPUT_JSON)}`);
  console.log(`Wrote ${path.relative(repoRoot, OUTPUT_MD)}`);
}

main();

