#!/usr/bin/env tsx
/**
 * ingest_session_logs_to_observations.ts
 *
 * DRY-RUN ONLY. Walks Skylar's Claude session JSONL transcripts and proposes
 * `vehicle_observations` rows for every USER turn (testimony) that references
 * a specific vehicle.
 *
 * Resolution rules (in order):
 *   1. Known VIN literal (regex against `vehicles.vin`)
 *   2. Vehicle UUID literal (8-4-4-4-12 hex)
 *   3. Phrase + photo-density disambiguator
 *      ("my K5"/"the build"/"my Blazer" by Skylar → vehicle_id 'e08bf694…')
 *   4. Year-make-model token → user's vehicle with that y/m/m and the most
 *      photos uploaded by user.
 *
 * Hard rules baked in:
 *   - --apply is REJECTED. Skylar reviews dry-run first.
 *   - Never reads outside ~/.claude/projects/-Users-skylar(-nuke)?/
 *   - Redacts secrets/tokens/JWTs before serialising the user turn
 *   - If we can't resolve, we DROP the row (we don't emit unresolved rows)
 *
 * Output:
 *   - Full dry-run:   scripts/ingest_session_logs_to_observations.dry_run.json
 *   - Sample (50):    scripts/ingest_session_logs_to_observations.sample_dry_run.json
 *   - STDOUT:         human-readable summary (<350 words)
 *
 * Usage:
 *   dotenvx run -- tsx scripts/ingest_session_logs_to_observations.ts
 *
 * Schema target: `public.vehicle_observations`
 *   Columns used: vehicle_id, source_id, source_url, source_identifier,
 *                 observer_id, kind, content_text, structured_data,
 *                 confidence, confidence_score, observed_at, extraction_method,
 *                 extracted_by, raw_source_ref
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

// ============================================================================
// Hard-coded substrate (verified via Supabase MCP at build time)
// ============================================================================

const SKYLAR_USER_ID = "0b9f107a-d124-49de-9ded-94698f63c1c4";
const SKYLAR_EMAIL = "shkylar@gmail.com";

// `observation_sources.slug = 'claude-extension'`, category=owner, base_trust=0.80
const CLAUDE_SESSION_SOURCE_ID = "8997571f-4da3-48f8-8d36-6ac70e3038b6";
const CLAUDE_SESSION_SOURCE_SLUG = "claude-extension";

// Skylar's K5 — the wiring-build truck
const K5_VEHICLE_ID = "e08bf694-970f-4cbe-8a74-8715158a0f2e";
const K5_PRIMARY_VIN = "CKR187F127263";
// Per task spec: this old wrong VIN still maps to the same physical truck.
// NOTE: DB substrate currently has it as a separate vehicle e04bf9c5 — flagged
// in open_questions.
const K5_LEGACY_VIN = "CCL187Z210370";

// Phrase → vehicle resolver. These are evaluated only when the session is a
// Skylar-owned session (CWD includes /Users/skylar). Photo-density rationale:
// vehicle e08bf694 has ~817-1000+ photos uploaded by Skylar; "my K5" / "the
// build" by Skylar resolves there. See
// memory/feedback_photo_density_is_ownership_signal.md.
const SKYLAR_PHRASE_TO_K5: RegExp[] = [
    /\bmy\s+k5\b/i,
    /\bthe\s+k5\b/i,
    /\bmy\s+blazer\b/i,
    /\bthe\s+blazer\b/i,
    /\bthe\s+build\b/i,
    /\bmy\s+truck\b/i, // Skylar uses this for the wiring truck; could be noisy
    /\bk5\s+wiring\b/i,
    /\bk5\s+harness\b/i,
];

// ============================================================================
// Vehicle catalog (Skylar's vehicles by photo density, populated at runtime)
// ============================================================================

interface VehicleRow {
    id: string;
    year: number | null;
    make: string | null;
    model: string | null;
    vin: string | null;
    photo_count: number;
}

// Hard-coded catalog snapshot (fetched 2026-05-17 via Supabase MCP).
// We don't fetch live to avoid network deps; this list is the resolution
// substrate and is checked into the script.
const SKYLAR_VEHICLES: VehicleRow[] = [
    { id: "a90c008a-3379-41d8-9eb2-b4eda365d74c", year: 1983, make: "GMC", model: "K2500 Sierra Classic", vin: "1GTGK24M1DJ514592", photo_count: 1688 },
    { id: "5a1deb95-4b67-4cc3-9575-23bb5b180693", year: 1983, make: "GMC", model: "K2500", vin: "1GTEK14H6DJ501481", photo_count: 874 },
    { id: "e04bf9c5-b488-433b-be9a-3d307861d90b", year: 1977, make: "Chevrolet", model: "Blazer", vin: "CCL187Z210370", photo_count: 868 },
    { id: "043c6d8b-c81e-420a-9d20-77cf3385fc2a", year: 1973, make: "Dodge", model: "Charger 360", vin: null, photo_count: 824 },
    { id: "e08bf694-970f-4cbe-8a74-8715158a0f2e", year: 1977, make: "Chevrolet", model: "Blazer", vin: "CKR187F127263", photo_count: 817 },
    { id: "83f6f033-a3c3-4cf4-a85e-a60d2c588838", year: 1966, make: "Ford", model: "Mustang", vin: "6F07C219593", photo_count: 693 },
    { id: "b1edd5c1-436c-4139-8811-e0bf006a25dc", year: 1989, make: "Chevrolet", model: "Pickup R3500 Cheyenne", vin: null, photo_count: 655 },
    { id: "f05462f9-4901-4e02-bbed-8d2670de4646", year: 1973, make: "Dodge", model: "Charger 318", vin: "WH23G3A146256", photo_count: 642 },
    { id: "d6a01df2-dc78-4fe9-9559-2c4cf6124a7a", year: 1983, make: "GMC", model: "K2500", vin: null, photo_count: 615 },
    { id: "95fbb5c3-568b-4ebd-b6dd-7f3adffd3e43", year: 1971, make: "Ford", model: "Bronco", vin: "U15GLK32565", photo_count: 496 },
    { id: "21ee373f-765e-4e24-a69d-e59e2af4f467", year: 1932, make: "Ford", model: "Hot Rod", vin: "AZ370615", photo_count: 364 },
    { id: "1db5daca-526e-42c6-99ae-7faee79b5bad", year: 1995, make: "Chevrolet", model: "Suburban 2500", vin: "1GNGK26N7SJ349264", photo_count: 361 },
    { id: "4ecc1fa5-c2c2-485b-bc57-144d6215d22a", year: 1997, make: "Lexus", model: "LX450", vin: "JT6HJ88J4V0178097", photo_count: 355 },
    { id: "c6189023-ab62-4ca8-9bb0-94511a30f037", year: 1971, make: "Ford", model: "Bronco", vin: null, photo_count: 339 },
    { id: "eea40748-cdc1-4ae9-ade1-4431d14a7726", year: 1974, make: "Ford", model: "Bronco", vin: "U15TLT18338", photo_count: 277 },
    { id: "710dc2a3-ce4c-4189-a51b-a2d2d41480d6", year: 1974, make: "Ford", model: "Bronco 351w", vin: null, photo_count: 273 },
    { id: "b5a24e45-7171-4296-b13b-032e9f959eb8", year: 1987, make: "Chevrolet", model: "V3500 Dually", vin: null, photo_count: 270 },
    { id: "a69aab8c-8a23-4835-b4a8-ce6c5f476379", year: 1985, make: "Chevrolet", model: "K20", vin: null, photo_count: 270 },
    { id: "e8a9c558-a930-4e55-9e5c-4a2711cab081", year: 1972, make: "Chevrolet", model: "K10 SWB", vin: null, photo_count: 259 },
    { id: "afcfef94-895f-436b-b66c-acb2e2f46973", year: 1979, make: "Chevrolet", model: "K10", vin: "CKL149F376441", photo_count: 252 },
    { id: "79fe1a2b-9099-45b5-92c0-54e7f896089e", year: 1974, make: "Ford", model: "Bronco", vin: "U15GLU84208", photo_count: 238 },
    { id: "fc359eb0-796f-4c51-b47d-e79c248d1175", year: 1974, make: "Chevrolet", model: "K5 Blazer", vin: null, photo_count: 211 },
    { id: "b1fd848d-c64d-4b3a-8d09-0bacfeef9561", year: 1987, make: "GMC", model: "Suburban", vin: "1GKGV26KXHF526945", photo_count: 204 },
    { id: "6442df03-9cac-43a8-b89e-e4fb4c08ee99", year: 1984, make: "Chevrolet", model: "K10 SWB", vin: "1GCEK14L9EJ147915", photo_count: 185 },
    { id: "50dd2f1a-01de-4f26-9729-c38a82b7c1bb", year: 1973, make: "GMC", model: "Jimmy", vin: "TKE182F514199", photo_count: 158 },
    { id: "80e04dd6-983e-4c78-ba15-c0599e50ecd9", year: 1977, make: "Chevrolet", model: "K10 SWB", vin: "CKL147Z186644", photo_count: 147 },
    { id: "48875fce-7b71-48f5-ac36-bcaf12f50fd0", year: 1966, make: "Chevrolet", model: "C10", vin: null, photo_count: 141 },
    { id: "d5ec0923-fc83-4ed1-b094-6cfb14713e4c", year: 1978, make: "Chevrolet", model: "K20 LWB", vin: "CCL448J172994", photo_count: 126 },
    { id: "5f6cc95c-9c1e-4a45-8371-40312c253abb", year: 1978, make: "Chevrolet", model: "K20 Scottsdale 4×4 4-Speed", vin: "CKL248Z129851", photo_count: 116 },
    { id: "1511336a-daa0-48ef-bcb3-15720474e602", year: 2005, make: "Ferrari", model: "360 Spider", vin: null, photo_count: 107 },
    { id: "07124fb6-d58e-48f5-8a1a-8b57b6d7ecb0", year: 1980, make: "Chevrolet", model: "K10", vin: "CKM34AB120952", photo_count: 106 },
    { id: "f6e64a4f-6f74-4234-8174-5a7f8dbdafab", year: 1980, make: "Chevrolet", model: "K30 Crew Cab", vin: null, photo_count: 106 },
    { id: "b5a0c58a-6915-499b-ba5d-63c42fb6a91f", year: 1985, make: "Chevrolet", model: "Suburban", vin: "1G8EK16L3FF114243", photo_count: 105 },
    { id: "06d4eb9b-74af-49a8-af7c-75aeb5abfe27", year: 1980, make: "Chevrolet", model: "C10", vin: null, photo_count: 100 },
    { id: "5b4e6bcd-7f31-410a-876a-cb2947d954f5", year: 1973, make: "GMC", model: "K5", vin: "TKY183F505217", photo_count: 90 },
    { id: "b987278a-64ab-44ae-8342-37557b79f73e", year: 1968, make: "Porsche", model: "911", vin: null, photo_count: 79 },
    { id: "ad21b496-1168-4c01-a4ba-21a723c15161", year: 1970, make: "Plymouth", model: "ROADRUNNER", vin: "RM21N0E148924", photo_count: 78 },
    { id: "defba683-ea3d-4514-bee4-373e53b9252a", year: 1967, make: "Pontiac", model: "GTO", vin: null, photo_count: 77 },
    { id: "93119305-2a50-4886-b471-50e5aa3943a0", year: 1977, make: "Chevrolet", model: "k5 blazer Cheyenne chalet", vin: null, photo_count: 75 },
    { id: "7176a5fc-24ae-4b42-9e65-0b96c4f9e50c", year: 1978, make: "GMC", model: "Pickup", vin: "TKL148F714125", photo_count: 66 },
    { id: "a84273ab-4e0d-45c4-bdaa-5c9ad023079d", year: 1985, make: "Chevrolet", model: "K10", vin: "1GCGK24MXFJ174484", photo_count: 61 },
    { id: "d7962908-9a01-4082-a85e-6bbe532550b2", year: 1972, make: "Chevrolet", model: "K10 Cheyenne Super Pickup 4×4", vin: "CKE142B143858", photo_count: 59 },
];

// Map VIN → vehicle_id, with the legacy-VIN-overlay rule
const VIN_INDEX: Map<string, string> = new Map();
for (const v of SKYLAR_VEHICLES) {
    if (v.vin) VIN_INDEX.set(v.vin.toUpperCase(), v.id);
}
// SPEC OVERRIDE: legacy VIN maps to the canonical K5 per task instructions,
// even though DB has it as a different row. We flag this disagreement at runtime.
VIN_INDEX.set(K5_LEGACY_VIN.toUpperCase(), K5_VEHICLE_ID);

const VEHICLE_BY_ID: Map<string, VehicleRow> = new Map(SKYLAR_VEHICLES.map(v => [v.id, v]));

// ============================================================================
// Path discipline — only walk Skylar-owned project transcript dirs
// ============================================================================

const HOME = os.homedir();
const ALLOWED_ROOTS = [
    path.join(HOME, ".claude/projects/-Users-skylar"),
    path.join(HOME, ".claude/projects/-Users-skylar-nuke"),
];

function isUnderAllowedRoot(p: string): boolean {
    const abs = path.resolve(p);
    return ALLOWED_ROOTS.some(root => abs === root || abs.startsWith(root + path.sep));
}

function listJsonlFiles(): string[] {
    const out: string[] = [];
    for (const root of ALLOWED_ROOTS) {
        if (!fs.existsSync(root)) continue;
        walkDir(root, out);
    }
    return out;
}

function walkDir(dir: string, acc: string[]) {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (!isUnderAllowedRoot(full)) continue;
        if (ent.isDirectory()) {
            walkDir(full, acc);
        } else if (ent.isFile() && ent.name.endsWith(".jsonl")) {
            acc.push(full);
        }
    }
}

// ============================================================================
// Resolution
// ============================================================================

const VIN_REGEX = /\b[A-HJ-NPR-Z0-9]{11,17}\b/gi; // VINs vary in length pre-1981
const UUID_REGEX = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// Year-make-model — covers "1977 Blazer", "77 K5", "the K20", "K30 crew cab", etc.
const YEAR_REGEX = /\b(19|20)\d{2}\b/g;
const YEAR_TWO_DIGIT_REGEX = /\b'?\d{2}\s+(?:k5|k10|k20|k30|c10|c20|c30|blazer|suburban|bronco|charger|mustang|jimmy|silverado|cheyenne|scottsdale)\b/gi;

const MODEL_TOKENS: { token: RegExp; makes?: string[]; modelHints: string[] }[] = [
    { token: /\bk5\b/i, makes: ["Chevrolet", "GMC"], modelHints: ["K5", "Blazer", "Jimmy"] },
    { token: /\bblazer\b/i, makes: ["Chevrolet"], modelHints: ["Blazer", "K5"] },
    { token: /\bk10\b/i, makes: ["Chevrolet", "GMC"], modelHints: ["K10"] },
    { token: /\bk15\b/i, makes: ["GMC"], modelHints: ["K15"] },
    { token: /\bk20\b/i, makes: ["Chevrolet", "GMC"], modelHints: ["K20"] },
    { token: /\bk2500\b/i, makes: ["Chevrolet", "GMC"], modelHints: ["K2500"] },
    { token: /\bk30\b/i, makes: ["Chevrolet", "GMC"], modelHints: ["K30"] },
    { token: /\bc10\b/i, makes: ["Chevrolet", "GMC"], modelHints: ["C10"] },
    { token: /\bsuburban\b/i, makes: ["Chevrolet", "GMC"], modelHints: ["Suburban"] },
    { token: /\bbronco\b/i, makes: ["Ford"], modelHints: ["Bronco"] },
    { token: /\bjimmy\b/i, makes: ["GMC", "Chevrolet"], modelHints: ["Jimmy"] },
    { token: /\bmustang\b/i, makes: ["Ford"], modelHints: ["Mustang"] },
    { token: /\bcharger\b/i, makes: ["Dodge"], modelHints: ["Charger"] },
    { token: /\bgto\b/i, makes: ["Pontiac"], modelHints: ["GTO"] },
    { token: /\broadrunner\b/i, makes: ["Plymouth"], modelHints: ["ROADRUNNER"] },
    { token: /\bferrari\b/i, makes: ["Ferrari"], modelHints: ["360"] },
    { token: /\blx450\b/i, makes: ["Lexus"], modelHints: ["LX450"] },
    { token: /\bhot\s*rod\b/i, makes: ["Ford"], modelHints: ["Hot Rod"] },
    { token: /\b911\b/i, makes: ["Porsche"], modelHints: ["911"] },
];

type ResolveResult = {
    vehicle_id: string;
    method: "vin" | "uuid" | "phrase+photo_density" | "year_make_model";
    matched_text: string;
    notes?: string;
} | null;

function resolveVehicle(text: string, sessionCwd: string): ResolveResult {
    const upper = text.toUpperCase();

    // 1. VIN literal
    const vinHits = upper.match(VIN_REGEX) ?? [];
    for (const candidate of vinHits) {
        // Skip if it's actually a UUID hex chunk (will match VIN_REGEX too)
        if (/^[0-9a-f]+$/i.test(candidate) && candidate.length <= 12) continue;
        if (VIN_INDEX.has(candidate)) {
            const vid = VIN_INDEX.get(candidate)!;
            let notes: string | undefined;
            if (candidate === K5_LEGACY_VIN.toUpperCase()) {
                notes = "spec-override: legacy K5 VIN mapped to canonical e08bf694; DB substrate currently has this VIN on a different vehicle e04bf9c5";
            }
            return { vehicle_id: vid, method: "vin", matched_text: candidate, notes };
        }
    }

    // 2. UUID literal
    const uuidHits = text.match(UUID_REGEX) ?? [];
    for (const candidate of uuidHits) {
        if (VEHICLE_BY_ID.has(candidate)) {
            return { vehicle_id: candidate, method: "uuid", matched_text: candidate };
        }
    }

    // 3. Phrase + photo-density (Skylar-owned session only)
    const isSkylarSession = sessionCwd.startsWith("/Users/skylar");
    if (isSkylarSession) {
        for (const re of SKYLAR_PHRASE_TO_K5) {
            const m = text.match(re);
            if (m) {
                return {
                    vehicle_id: K5_VEHICLE_ID,
                    method: "phrase+photo_density",
                    matched_text: m[0],
                    notes: "Skylar uploaded ~817 photos to e08bf694; phrase resolves there per photo-density rule",
                };
            }
        }
    }

    // 4. Year-make-model token — pick user's vehicle with most photos that matches
    //    Look for a 4-digit year OR "'77" / "77 K5" pattern + a model token.
    const yearHits = text.match(YEAR_REGEX) ?? [];
    const years = new Set<number>(yearHits.map(y => parseInt(y, 10)).filter(n => n >= 1930 && n <= 2030));
    // Two-digit year + model token
    const twoDigHits = text.match(YEAR_TWO_DIGIT_REGEX) ?? [];
    for (const h of twoDigHits) {
        const m = h.match(/\d{2}/);
        if (m) {
            const yy = parseInt(m[0], 10);
            // 30..99 → 19xx; 00..29 → 20xx
            years.add(yy >= 30 ? 1900 + yy : 2000 + yy);
        }
    }

    for (const tok of MODEL_TOKENS) {
        if (!tok.token.test(text)) continue;
        // Find candidates whose make/model matches and whose year is in `years`
        const candidates = SKYLAR_VEHICLES.filter(v => {
            if (tok.makes && v.make && !tok.makes.includes(v.make)) return false;
            const modelStr = (v.model ?? "").toLowerCase();
            const hintMatch = tok.modelHints.some(h => modelStr.includes(h.toLowerCase()));
            if (!hintMatch) return false;
            if (years.size === 0) return true;
            return v.year != null && years.has(v.year);
        });
        if (candidates.length === 0) continue;
        // Pick max photos
        candidates.sort((a, b) => b.photo_count - a.photo_count);
        const winner = candidates[0];
        return {
            vehicle_id: winner.id,
            method: "year_make_model",
            matched_text: tok.token.source,
            notes: `year_set=${[...years].join(",") || "none"}; ${candidates.length} candidate(s), picked highest-photo (${winner.photo_count})`,
        };
    }

    return null;
}

// ============================================================================
// Redaction — never leak secrets into observation rows
// ============================================================================

const REDACTION_PATTERNS: { name: string; re: RegExp }[] = [
    { name: "anthropic_key", re: /sk-ant-[A-Za-z0-9_\-]{20,}/g },
    { name: "openai_key", re: /sk-(?:proj-)?[A-Za-z0-9]{20,}/g },
    { name: "supabase_jwt", re: /eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g },
    { name: "supabase_sb_key", re: /sb_(?:secret|publishable)_[A-Za-z0-9_\-]{16,}/g },
    { name: "bearer_token", re: /Bearer\s+[A-Za-z0-9_\-\.]{20,}/g },
    { name: "github_pat", re: /gh[pousr]_[A-Za-z0-9]{30,}/g },
    { name: "aws_access_key", re: /AKIA[0-9A-Z]{16}/g },
    { name: "generic_secret_assign", re: /(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)\s*=\s*['"]?[A-Za-z0-9_\-+\/=.]{16,}['"]?/gi },
    { name: "supabase_envvar", re: /SUPABASE_SERVICE_ROLE_KEY\s*=\s*\S+/gi },
];

function redact(s: string): { text: string; redactions: string[] } {
    const hits: string[] = [];
    let out = s;
    for (const { name, re } of REDACTION_PATTERNS) {
        out = out.replace(re, () => {
            hits.push(name);
            return `[REDACTED:${name}]`;
        });
    }
    return { text: out, redactions: hits };
}

// ============================================================================
// JSONL parsing
// ============================================================================

interface JsonlTurn {
    type?: string;
    uuid?: string;
    parentUuid?: string | null;
    sessionId?: string;
    timestamp?: string;
    cwd?: string;
    message?: {
        role?: string;
        content?: any;
    };
}

function extractUserText(turn: JsonlTurn): string | null {
    if (turn.type !== "user") return null;
    const msg = turn.message;
    if (!msg || msg.role !== "user") return null;
    const c = msg.content;
    if (typeof c === "string") return c.trim();
    if (!Array.isArray(c)) return null;
    const textParts: string[] = [];
    for (const block of c) {
        if (block && typeof block === "object") {
            if (block.type === "text" && typeof block.text === "string") {
                textParts.push(block.text);
            }
            // tool_result, image, etc → not testimony
        }
    }
    if (textParts.length === 0) return null;
    return textParts.join("\n").trim();
}

function extractAssistantExcerpt(turn: JsonlTurn): string | null {
    if (turn.type !== "assistant") return null;
    const msg = turn.message;
    if (!msg || msg.role !== "assistant") return null;
    const c = msg.content;
    if (typeof c === "string") return c.slice(0, 200);
    if (!Array.isArray(c)) return null;
    for (const block of c) {
        if (block?.type === "text" && typeof block.text === "string") {
            return block.text.slice(0, 200);
        }
    }
    return null;
}

// ============================================================================
// Main extraction loop
// ============================================================================

interface ObservationRow {
    vehicle_id: string;
    source_id: string;
    source_url: string;
    source_identifier: string;
    observer_id: string;
    observed_at: string;
    kind: string;
    content_text: string;
    structured_data: Record<string, unknown>;
    confidence: string;
    confidence_score: number;
    extraction_method: string;
    extracted_by: string;
    raw_source_ref: string;
    extracted_at: string;
}

interface OpenQuestion {
    file: string;
    turn_uuid?: string;
    snippet: string;
    reason: string;
}

interface RunStats {
    files_scanned: number;
    files_skipped_outside_root: number;
    total_lines: number;
    user_turns_total: number;
    user_turns_with_testimony: number;
    user_turns_resolved: number;
    by_method: Record<string, number>;
    by_vehicle: Map<string, number>;
    open_questions: OpenQuestion[];
}

function processFile(filePath: string, stats: RunStats, rows: ObservationRow[]): void {
    if (!isUnderAllowedRoot(filePath)) {
        stats.files_skipped_outside_root += 1;
        return;
    }
    let content: string;
    try {
        content = fs.readFileSync(filePath, "utf-8");
    } catch {
        return;
    }
    stats.files_scanned += 1;

    const lines = content.split("\n");
    let priorAssistantExcerpt: string | null = null;
    let lastCwd = "/Users/skylar";

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        stats.total_lines += 1;
        let turn: JsonlTurn;
        try {
            turn = JSON.parse(line);
        } catch {
            continue;
        }
        if (turn.cwd) lastCwd = turn.cwd;

        const userText = extractUserText(turn);
        if (userText) {
            stats.user_turns_total += 1;
            // Procedural / fragment filters
            if (userText.length < 10) {
                priorAssistantExcerpt = null;
                continue;
            }
            // Pure-procedural detection: very short single-line commands like
            // "run X", "list Y", "ls", "ok" without any vehicle-ish content.
            const isProceduralOnly = userText.length < 40 &&
                /^(?:run|list|ls|ok|yes|no|continue|go|next|stop|help|status|build|deploy|test|check)\b/i.test(userText) &&
                !/(?:k5|blazer|truck|build|harness|wir|engine|charger|mustang|bronco|suburban|jimmy|k10|k20|k30|c10|vin|vehicle|gmc|chev|ford)/i.test(userText);
            if (isProceduralOnly) {
                priorAssistantExcerpt = null;
                continue;
            }
            stats.user_turns_with_testimony += 1;

            const resolved = resolveVehicle(userText, turn.cwd ?? lastCwd);
            if (!resolved) {
                // Optionally record as open question if it has vehicle-ish hints
                const hasVehicleHint = /(?:k5|blazer|harness|wir|charger|mustang|bronco|suburban|vin|truck|build)/i.test(userText);
                if (hasVehicleHint && stats.open_questions.length < 50) {
                    stats.open_questions.push({
                        file: filePath,
                        turn_uuid: turn.uuid,
                        snippet: userText.slice(0, 240),
                        reason: "vehicle-ish hint but no specific resolver match (ambiguous year/make/model)",
                    });
                }
                priorAssistantExcerpt = null;
                continue;
            }

            stats.user_turns_resolved += 1;
            stats.by_method[resolved.method] = (stats.by_method[resolved.method] ?? 0) + 1;
            stats.by_vehicle.set(resolved.vehicle_id, (stats.by_vehicle.get(resolved.vehicle_id) ?? 0) + 1);

            const { text: redactedUserTurn, redactions } = redact(userText);
            const { text: redactedPrior } = priorAssistantExcerpt ? redact(priorAssistantExcerpt) : { text: "" };

            const observedAt = turn.timestamp ?? new Date().toISOString();
            const turnId = turn.uuid ?? `line-${i + 1}`;
            const sourceUrl = `file://${filePath}#${turnId}`;
            const sourceIdentifier = `${turn.sessionId ?? path.basename(filePath, ".jsonl")}/${turnId}`;
            const contentHashSeed = `${sourceIdentifier}|${redactedUserTurn}`;
            const rawRef = crypto.createHash("sha256").update(contentHashSeed).digest("hex").slice(0, 16);

            rows.push({
                vehicle_id: resolved.vehicle_id,
                source_id: CLAUDE_SESSION_SOURCE_ID,
                source_url: sourceUrl,
                source_identifier: sourceIdentifier,
                observer_id: SKYLAR_USER_ID,
                observed_at: observedAt,
                kind: "social_mention", // closest fit; "expert_opinion" also reasonable for owner testimony
                content_text: redactedUserTurn.slice(0, 8000),
                structured_data: {
                    user_turn: redactedUserTurn,
                    session_id: turn.sessionId ?? null,
                    prior_assistant_turn_excerpt: redactedPrior || null,
                    resolved_via: resolved.method,
                    resolved_match: resolved.matched_text,
                    resolver_notes: resolved.notes ?? null,
                    cwd: turn.cwd ?? lastCwd,
                    parent_turn_uuid: turn.parentUuid ?? null,
                    redactions_applied: redactions,
                    observer_email: SKYLAR_EMAIL,
                    source_slug: CLAUDE_SESSION_SOURCE_SLUG,
                },
                confidence: "medium",
                confidence_score: resolved.method === "vin" ? 0.85
                    : resolved.method === "uuid" ? 0.95
                    : resolved.method === "phrase+photo_density" ? 0.6
                    : 0.55,
                extraction_method: "script:ingest_session_logs_to_observations.ts",
                extracted_by: "script:ingest_session_logs_to_observations.ts",
                raw_source_ref: rawRef,
                extracted_at: new Date().toISOString(),
            });

            priorAssistantExcerpt = null;
            continue;
        }

        const asstExcerpt = extractAssistantExcerpt(turn);
        if (asstExcerpt) priorAssistantExcerpt = asstExcerpt;
    }
}

// ============================================================================
// CLI
// ============================================================================

function main() {
    const args = process.argv.slice(2);
    if (args.includes("--apply")) {
        console.error("ERROR: --apply not implemented; Skylar reviews dry-run first.");
        process.exit(2);
    }

    const files = listJsonlFiles();
    const stats: RunStats = {
        files_scanned: 0,
        files_skipped_outside_root: 0,
        total_lines: 0,
        user_turns_total: 0,
        user_turns_with_testimony: 0,
        user_turns_resolved: 0,
        by_method: {},
        by_vehicle: new Map(),
        open_questions: [],
    };
    const rows: ObservationRow[] = [];

    for (const f of files) processFile(f, stats, rows);

    const scriptsDir = "/Users/skylar/nuke/scripts";
    const fullOutPath = path.join(scriptsDir, "ingest_session_logs_to_observations.dry_run.json");
    const sampleOutPath = path.join(scriptsDir, "ingest_session_logs_to_observations.sample_dry_run.json");

    fs.writeFileSync(fullOutPath, JSON.stringify(rows, null, 2));

    // Random sample of 50
    const sampleSize = Math.min(50, rows.length);
    const sampled: ObservationRow[] = [];
    const indices = new Set<number>();
    // Seeded shuffle
    let seed = 0x1234abcd;
    const rand = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    };
    while (sampled.length < sampleSize && indices.size < rows.length) {
        const idx = Math.floor(rand() * rows.length);
        if (indices.has(idx)) continue;
        indices.add(idx);
        sampled.push(rows[idx]);
    }
    fs.writeFileSync(sampleOutPath, JSON.stringify(sampled, null, 2));

    // Top 3 vehicles by extracted turn count
    const topVehicles = [...stats.by_vehicle.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([vid, n]) => {
            const v = VEHICLE_BY_ID.get(vid);
            const label = v ? `${v.year} ${v.make} ${v.model}` : vid;
            return { vehicle_id: vid, label, count: n };
        });

    // STDOUT summary (<350 words)
    const lines: string[] = [];
    lines.push("=== Claude Session → vehicle_observations DRY-RUN ===");
    lines.push("");
    lines.push(`JSONL files scanned:        ${stats.files_scanned}`);
    lines.push(`JSONL files skipped (path): ${stats.files_skipped_outside_root}`);
    lines.push(`Total JSONL lines parsed:   ${stats.total_lines}`);
    lines.push(`User turns total:           ${stats.user_turns_total}`);
    lines.push(`User turns with testimony:  ${stats.user_turns_with_testimony}  (excludes tool_results, images, sub-10-char fragments, pure procedural)`);
    const resolvedPct = stats.user_turns_with_testimony
        ? (100 * stats.user_turns_resolved / stats.user_turns_with_testimony).toFixed(1)
        : "0.0";
    lines.push(`Resolved to a vehicle:      ${stats.user_turns_resolved}  (${resolvedPct}% of testimony turns)`);
    lines.push("");
    lines.push("Resolution method breakdown:");
    for (const [method, n] of Object.entries(stats.by_method).sort((a, b) => b[1] - a[1])) {
        lines.push(`  ${method.padEnd(28)} ${n}`);
    }
    lines.push("");
    lines.push("Top 3 vehicles by extracted-turn count:");
    for (const v of topVehicles) {
        lines.push(`  ${v.count.toString().padStart(5)}  ${v.label}  (${v.vehicle_id})`);
    }
    lines.push("");
    lines.push(`Full dry-run written to:    ${fullOutPath}  (${rows.length} rows)`);
    lines.push(`50-row sample written to:   ${sampleOutPath}`);
    lines.push("");
    lines.push("Open questions for Skylar:");
    lines.push(`  - CCL187Z210370 (the 'old wrong K5 VIN') is mapped to canonical K5 e08bf694`);
    lines.push(`    per task spec, but DB substrate currently has it on a separate 1977`);
    lines.push(`    Blazer (e04bf9c5, 868 photos by you). Two possibilities: (a) the DB`);
    lines.push(`    needs an unmerge + alias added; (b) the spec is treating two different`);
    lines.push(`    physical trucks as one. Confirm which before any insert path is built.`);
    lines.push(`  - "my truck" / "the build" / "my Blazer" by Skylar all resolve to K5 by`);
    lines.push(`    photo-density rule. If you intend any of those to reference your`);
    lines.push(`    Mustang or Hot Rod work, the resolver will mis-route.`);
    lines.push(`  - ${stats.open_questions.length} vehicle-ish turns had no specific resolver match`);
    lines.push(`    (e.g. ambiguous 'truck' references). First 3:`);
    for (const oq of stats.open_questions.slice(0, 3)) {
        lines.push(`      • ${oq.snippet.replace(/\s+/g, " ").slice(0, 110)}…`);
    }
    lines.push("");
    lines.push("Next: review the sample JSON, then build the insert path. --apply is locked.");

    process.stdout.write(lines.join("\n") + "\n");
}

main();
