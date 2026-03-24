/**
 * Methodology Context — The Library
 *
 * Generates methodology context blocks from the methodology_references DB.
 * Any extraction worker, supervisor, or agent can call getMethodologyContext()
 * to receive a compressed briefing on quality standards, cited principles,
 * and design rationale grounded in published research.
 *
 * This is the bridge between the academic citation library and the
 * extraction pipeline. Papers don't just sit in a table — they shape
 * every system prompt.
 *
 * Usage:
 *   import { getMethodologyContext, getMethodologyForTask } from "../_shared/methodology.ts";
 *
 *   // Full context block (prepend to system prompt)
 *   const ctx = await getMethodologyContext(supabaseClient);
 *
 *   // Task-specific context (lighter, focused on one extraction type)
 *   const ctx = await getMethodologyForTask(supabaseClient, "extraction_routing");
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Types ────────────────────────────────────────────────────

interface MethodologyReference {
  id: string;
  title: string;
  authors: string[];
  key_metric: string | null;
  key_finding: string;
  relevance_pct: number;
  published_at: string;
  status: string;
}

interface MethodologyApplication {
  platform_component: string;
  design_decision: string;
  rationale: string;
  category: string;
  paper_title?: string;
  paper_metric?: string;
}

// ── Cache ────────────────────────────────────────────────────
// Context changes rarely (new papers are added days/weeks apart).
// Cache for 1 hour to avoid hitting DB on every extraction call.

let _cache: { context: string; timestamp: number } | null = null;
let _taskCache: Map<string, { context: string; timestamp: number }> = new Map();
const CACHE_TTL_MS = 3600_000; // 1 hour

// ── Core Functions ───────────────────────────────────────────

/**
 * Full methodology context block. Prepend to any system prompt
 * to give the model awareness of quality standards and design rationale.
 *
 * Returns a compressed text block (~800-1200 tokens) with:
 * - Active papers and their key findings
 * - Design principles derived from cited research
 * - Quality standards per extraction category
 */
export async function getMethodologyContext(
  supabase: SupabaseClient,
): Promise<string> {
  if (_cache && Date.now() - _cache.timestamp < CACHE_TTL_MS) {
    return _cache.context;
  }

  const [papers, applications] = await Promise.all([
    fetchActivePapers(supabase),
    fetchApplicationsByCategory(supabase),
  ]);

  const context = buildContextBlock(papers, applications);
  _cache = { context, timestamp: Date.now() };
  return context;
}

/**
 * Task-specific methodology context. Lighter than full context.
 * Only includes papers and applications relevant to a specific category.
 *
 * Categories: extraction_routing, confidence_scoring, trust_hierarchy,
 * verification_protocol, decay_model, quality_threshold,
 * provenance_tracking, human_in_loop
 */
export async function getMethodologyForTask(
  supabase: SupabaseClient,
  category: string,
): Promise<string> {
  const cached = _taskCache.get(category);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.context;
  }

  const { data: apps } = await supabase
    .from("methodology_applications")
    .select(`
      platform_component,
      design_decision,
      rationale,
      category,
      reference_id
    `)
    .eq("category", category);

  if (!apps?.length) {
    return `[No methodology citations for category: ${category}]`;
  }

  // Get the referenced papers
  const refIds = [...new Set(apps.map((a: any) => a.reference_id))];
  const { data: papers } = await supabase
    .from("methodology_active")
    .select("*")
    .in("id", refIds);

  const lines: string[] = [
    `<methodology category="${category}">`,
  ];

  for (const paper of papers || []) {
    lines.push(`  [${paper.key_metric || paper.title}] (${paper.relevance_pct}% relevant)`);
    lines.push(`  Finding: ${paper.key_finding}`);

    const paperApps = apps.filter((a: any) => a.reference_id === paper.id);
    for (const app of paperApps) {
      lines.push(`  → ${app.design_decision}`);
    }
  }

  lines.push("</methodology>");

  const context = lines.join("\n");
  _taskCache.set(category, { context, timestamp: Date.now() });
  return context;
}

/**
 * Condensed principles block — the absolute minimum an extraction
 * worker needs to know. No paper titles, no rationale. Just the rules.
 * ~200-400 tokens.
 */
export function getCorePrinciples(): string {
  return `<extraction-principles>
QUALITY STANDARDS (cited methodology):
- Confidence MUST decrease with task complexity. Simple structured fields (VIN, year) get higher confidence than inferential fields (condition narrative, market assessment).
- Every extracted value MUST cite its source material. Field without citation = unverified claim.
- When uncertain, ABSTAIN. A missing field is better than a hallucinated one. Flag for escalation.
- Disagreement between sources is SIGNAL, not noise. Record contradicting evidence alongside supporting evidence.
- Temporal claims decay. "Rebuilt in 2019" stated in 2020 is fresher than the same claim in 2026. Record the timestamp of the claim, not just the claim.
- The schema IS the vehicle. You are not parsing text — you are materializing a digital twin. Every cell you fill is a statement about physical reality.
- Visual observations and textual claims are independent evidence streams. They should agree. When they don't, flag the discrepancy.
- Cross-source agreement without coordination = high reliability. If 4 independent sources agree on a value, that value is reliable even without ground truth verification.
</extraction-principles>`;
}

// ── Internal ─────────────────────────────────────────────────

async function fetchActivePapers(supabase: SupabaseClient): Promise<MethodologyReference[]> {
  const { data, error } = await supabase
    .from("methodology_active")
    .select("id, title, authors, key_metric, key_finding, relevance_pct, published_at, status")
    .gte("relevance_pct", 50) // Only papers above 50% relevance
    .order("relevance_pct", { ascending: false })
    .limit(20);

  if (error) {
    console.error("[methodology] Failed to fetch papers:", error.message);
    return [];
  }
  return data || [];
}

async function fetchApplicationsByCategory(
  supabase: SupabaseClient,
): Promise<Record<string, MethodologyApplication[]>> {
  const { data, error } = await supabase
    .from("methodology_applications")
    .select(`
      platform_component,
      design_decision,
      category,
      methodology_references!inner (
        title,
        key_metric
      )
    `);

  if (error) {
    console.error("[methodology] Failed to fetch applications:", error.message);
    return {};
  }

  const grouped: Record<string, MethodologyApplication[]> = {};
  for (const row of data || []) {
    const cat = row.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({
      platform_component: row.platform_component,
      design_decision: row.design_decision,
      rationale: "",
      category: cat,
      paper_title: (row as any).methodology_references?.title,
      paper_metric: (row as any).methodology_references?.key_metric,
    });
  }
  return grouped;
}

function buildContextBlock(
  papers: MethodologyReference[],
  appsByCategory: Record<string, MethodologyApplication[]>,
): string {
  const lines: string[] = [
    "<methodology-context>",
    "CITED RESEARCH FOUNDATION:",
  ];

  // Papers — compressed to key metric + finding only
  for (const p of papers.slice(0, 12)) {
    const metric = p.key_metric || "—";
    lines.push(`  [${metric}] ${p.key_finding.slice(0, 150)}`);
  }

  lines.push("");
  lines.push("DESIGN PRINCIPLES BY CATEGORY:");

  // Applications — grouped by category, compressed to decisions only
  const categoryOrder = [
    "extraction_routing", "confidence_scoring", "verification_protocol",
    "decay_model", "quality_threshold", "human_in_loop",
    "trust_hierarchy", "provenance_tracking",
  ];

  for (const cat of categoryOrder) {
    const apps = appsByCategory[cat];
    if (!apps?.length) continue;

    lines.push(`  ${cat.toUpperCase()}:`);
    // Deduplicate by component
    const seen = new Set<string>();
    for (const app of apps) {
      if (seen.has(app.platform_component)) continue;
      seen.add(app.platform_component);
      lines.push(`    - ${app.design_decision.slice(0, 120)}`);
    }
  }

  lines.push("</methodology-context>");
  return lines.join("\n");
}

// ── Convenience: Create Supabase client for edge functions ───

export function createMethodologyClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key);
}
