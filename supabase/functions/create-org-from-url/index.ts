import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateOrgFromUrlRequest {
  url: string;
  queue_synopsis?: boolean; // default true
  queue_site_mapping?: boolean; // default false
  force_new?: boolean; // default false
}

interface ExtractedOrg {
  business_name?: string;
  website?: string;
  description?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  logo_url?: string;
}

function normalizeInputUrl(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://${trimmed}`;
}

function canonicalizeWebsite(url: string): string {
  const u = new URL(url);
  return u.origin; // canonical: origin only (no path, no trailing slash)
}

function inferNameFromDomain(domain: string): string {
  const host = domain.replace(/^www\./, "");
  const base = host.split(".")[0] || host;
  const cleaned = base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return host;
  // Title-case simple words
  return cleaned
    .split(" ")
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

function pickFirst<T>(items: T[]): T | null {
  return items.length > 0 ? items[0] : null;
}

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function extractEmails(text: string): string[] {
  const matches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  return uniq(matches.map((m) => m.trim())).slice(0, 5);
}

function digitsCount(s: string): number {
  return (s.match(/\d/g) || []).length;
}

function normalizePhoneCandidate(raw: string): string {
  // Keep + and digits, preserve leading +
  const trimmed = raw.trim();
  const hasPlus = trimmed.includes("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return "";
  return hasPlus ? `+${digits}` : digits;
}

function extractPhones(text: string): string[] {
  const candidates: string[] = [];

  // Prefer tel: links
  const telMatches = text.match(/tel:\s*([+\d][\d\s().-]{6,})/gi) || [];
  for (const m of telMatches) {
    const val = m.replace(/^tel:\s*/i, "");
    candidates.push(val);
  }

  // International-ish patterns (+48 535 797 772, 0048 535 797 772, etc.)
  const intl = text.match(/(?:\+\d{1,3}|00\d{1,3})[\s().-]*\d{2,4}[\s().-]*\d{2,4}[\s().-]*\d{2,4}(?:[\s().-]*\d{1,4})?/g) || [];
  candidates.push(...intl);

  // US-style pattern
  const us = text.match(/(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g) || [];
  candidates.push(...us);

  const normalized = uniq(
    candidates
      .map(normalizePhoneCandidate)
      .filter((p) => p && digitsCount(p) >= 8) // avoid zips / short numbers
  );

  return normalized.slice(0, 5);
}

async function fetchHtml(url: string): Promise<string> {
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY") ?? "";

  if (firecrawlKey) {
    try {
      const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${firecrawlKey}`,
        },
        body: JSON.stringify({
          url,
          formats: ["html"],
          onlyMainContent: false,
          waitFor: 2000,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const data = await res.json();
        const html = data?.data?.html;
        if (typeof html === "string" && html.length > 0) return html;
      }
    } catch {
      // fall back to direct fetch
    }
  }

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; NukeBot/1.0)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Failed to fetch URL: HTTP ${res.status}`);
  return await res.text();
}

function textFromDoc(doc: any): string {
  try {
    return String(doc?.body?.textContent || "").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

function extractOrgFromHtml(html: string, website: string): ExtractedOrg {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const text = textFromDoc(doc);

  const title =
    doc?.querySelector("meta[property='og:site_name']")?.getAttribute("content") ||
    doc?.querySelector("meta[property='og:title']")?.getAttribute("content") ||
    doc?.querySelector("title")?.textContent ||
    "";

  const h1 = doc?.querySelector("h1")?.textContent || "";

  const metaDesc =
    doc?.querySelector("meta[name='description']")?.getAttribute("content") ||
    doc?.querySelector("meta[property='og:description']")?.getAttribute("content") ||
    "";

  // Best-effort logo
  const logoMeta = doc?.querySelector("meta[property='og:image']")?.getAttribute("content") || "";
  const logoImg =
    doc?.querySelector("img[alt*='logo' i]")?.getAttribute("src") ||
    doc?.querySelector("img[class*='logo' i]")?.getAttribute("src") ||
    "";
  const rawLogo = logoMeta || logoImg || "";
  const logoUrl = rawLogo
    ? rawLogo.startsWith("http")
      ? rawLogo
      : new URL(rawLogo, website).href
    : undefined;

  const emails = extractEmails(html);
  const phones = extractPhones(html);

  // Address extraction: try <address> first
  const addressEl = doc?.querySelector("address");
  const addressText = addressEl?.textContent?.replace(/\s+/g, " ").trim() || "";

  // Basic postal-code heuristics (US ZIP or PL 00-000)
  const zipUS = text.match(/\b\d{5}(?:-\d{4})?\b/)?.[0] || null;
  const zipPL = text.match(/\b\d{2}-\d{3}\b/)?.[0] || null;

  // Very light parsing: if we have an <address>, keep it as address; otherwise keep null
  const address = addressText && addressText.length >= 6 ? addressText : undefined;

  let business_name =
    String(title || "").split("|")[0]?.split("-")[0]?.trim() ||
    String(h1 || "").trim() ||
    "";

  if (!business_name) {
    business_name = inferNameFromDomain(new URL(website).hostname);
  }

  const description = metaDesc ? metaDesc.trim().slice(0, 500) : undefined;

  // Minimal city/state guess: if address contains comma-separated segments, use the last segment as city/state-ish.
  let city: string | undefined;
  let state: string | undefined;
  let zip_code: string | undefined;

  if (zipPL) zip_code = zipPL;
  if (!zip_code && zipUS) zip_code = zipUS;

  if (address) {
    const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
    // For "Street, City" style addresses, use second segment as city.
    if (parts.length >= 2 && !city) {
      city = parts[parts.length - 1];
    }
  }

  // Do not guess state for non-US
  if (zipUS && city && !state) {
    const m = city.match(/\b([A-Z]{2})\b/);
    if (m?.[1]) state = m[1];
  }

  return {
    business_name,
    website,
    description,
    email: pickFirst(emails) || undefined,
    phone: pickFirst(phones) || undefined,
    address,
    city,
    state,
    zip_code,
    logo_url: logoUrl,
  };
}

async function safeInvokeInternal(
  functionName: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: any; errorText?: string }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const internalJwt = Deno.env.get("INTERNAL_INVOKE_JWT") ?? "";

  const url = `${supabaseUrl}/functions/v1/${functionName}`;

  const attempt = async (bearer: string) => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${bearer}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { res, text, parsed };
  };

  // First try service key (works when verify_jwt=false on internal function)
  if (serviceKey) {
    const r1 = await attempt(serviceKey);
    if (r1.res.ok) return { ok: true, status: r1.res.status, data: r1.parsed };
    // Retry with INTERNAL_INVOKE_JWT if present (works when verify_jwt=true on internal function)
    if (internalJwt && internalJwt !== serviceKey) {
      const r2 = await attempt(internalJwt);
      if (r2.res.ok) return { ok: true, status: r2.res.status, data: r2.parsed };
      return { ok: false, status: r2.res.status, data: r2.parsed, errorText: r2.text };
    }
    return { ok: false, status: r1.res.status, data: r1.parsed, errorText: r1.text };
  }

  if (internalJwt) {
    const r = await attempt(internalJwt);
    if (r.res.ok) return { ok: true, status: r.res.status, data: r.parsed };
    return { ok: false, status: r.res.status, data: r.parsed, errorText: r.text };
  }

  return { ok: false, status: 500, data: null, errorText: "Missing SUPABASE_SERVICE_ROLE_KEY/INTERNAL_INVOKE_JWT" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body: CreateOrgFromUrlRequest = await req.json().catch(() => ({} as any));
    const rawUrl = normalizeInputUrl(body.url);
    const queueSynopsis = body.queue_synopsis !== false; // default true
    const queueSiteMapping = body.queue_site_mapping === true; // default false
    const forceNew = body.force_new === true;

    if (!rawUrl) {
      return new Response(JSON.stringify({ error: "url is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    const userId = userData?.user?.id || null;
    if (userError || !userId) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const website = canonicalizeWebsite(rawUrl);

    // Look for an existing org by website (exact origin, with or without trailing slash)
    let existing: any = null;
    if (!forceNew) {
      const { data } = await supabase
        .from("businesses")
        .select("id, business_name, website, description, email, phone, address, city, state, zip_code, logo_url, metadata")
        .or(`website.eq.${website},website.eq.${website}/`)
        .limit(1)
        .maybeSingle();
      existing = data || null;
    }

    let extracted: ExtractedOrg | null = null;
    let extractedFields: string[] = [];

    if (!existing) {
      const html = await fetchHtml(website);
      extracted = extractOrgFromHtml(html, website);
      extractedFields = Object.entries(extracted)
        .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
        .map(([k]) => k);
    }

    const nowIso = new Date().toISOString();

    let organizationId: string;
    let created = false;
    let updatedFields: string[] = [];

    if (existing) {
      organizationId = existing.id;

      // Best-effort: enrich missing fields on the existing org (non-destructive)
      if (extracted) {
        const updates: any = {};

        if (!existing.business_name && extracted.business_name) updates.business_name = extracted.business_name;
        if (!existing.website && extracted.website) updates.website = extracted.website;
        if (!existing.description && extracted.description) updates.description = extracted.description;
        if (!existing.email && extracted.email) updates.email = extracted.email;
        if (!existing.phone && extracted.phone) updates.phone = extracted.phone;
        if (!existing.address && extracted.address) updates.address = extracted.address;
        if (!existing.city && extracted.city) updates.city = extracted.city;
        if (!existing.state && extracted.state) updates.state = extracted.state;
        if (!existing.zip_code && extracted.zip_code) updates.zip_code = extracted.zip_code;
        if (!existing.logo_url && extracted.logo_url) updates.logo_url = extracted.logo_url;

        if (Object.keys(updates).length > 0) {
          updates.updated_at = nowIso;
          updates.metadata = {
            ...(existing.metadata || {}),
            org_intake: {
              ...(existing.metadata?.org_intake || {}),
              last_intake_at: nowIso,
              last_intake_url: rawUrl,
              last_intake_website: website,
              last_intake_method: "create-org-from-url",
            },
          };

          const { error: updErr } = await supabase
            .from("businesses")
            .update(updates)
            .eq("id", organizationId);
          if (!updErr) {
            updatedFields = Object.keys(updates).filter((k) => !["updated_at", "metadata"].includes(k));
          }
        }
      }
    } else {
      const businessName = extracted?.business_name || inferNameFromDomain(new URL(website).hostname);

      const insertRow: any = {
        business_name: businessName,
        website: website,
        description: extracted?.description || null,
        email: extracted?.email || null,
        phone: extracted?.phone || null,
        address: extracted?.address || null,
        city: extracted?.city || null,
        state: extracted?.state || null,
        zip_code: extracted?.zip_code || null,
        logo_url: extracted?.logo_url || null,
        discovered_by: userId,
        uploaded_by: userId,
        is_public: true,
        status: "active",
        verification_level: "unverified",
        metadata: {
          org_intake: {
            created_at: nowIso,
            created_by: userId,
            source_url: rawUrl,
            canonical_website: website,
            method: "create-org-from-url",
            extracted_fields: extractedFields,
          },
        },
      };

      const { data: org, error: orgErr } = await supabase
        .from("businesses")
        .insert(insertRow)
        .select("id")
        .single();

      if (orgErr || !org?.id) throw orgErr || new Error("Failed to create organization");

      organizationId = org.id;
      created = true;

      // Best-effort: create contributor record (so the creator has an org link)
      try {
        await supabase
          .from("organization_contributors")
          .upsert(
            {
              organization_id: organizationId,
              user_id: userId,
              role: "owner",
              contribution_count: 1,
              status: "active",
            },
            { onConflict: "organization_id,user_id" }
          );
      } catch {
        // ignore
      }

      // Best-effort: timeline event
      try {
        await supabase.from("business_timeline_events").insert({
          business_id: organizationId,
          created_by: userId,
          event_type: "founded",
          event_category: "legal",
          title: "Organization created",
          description: `${businessName} added from website`,
          event_date: new Date().toISOString().split("T")[0],
          metadata: {
            source_url: rawUrl,
            canonical_website: website,
            created_via: "create-org-from-url",
          },
        });
      } catch {
        // ignore
      }
    }

    // Queue follow-up jobs (synopsis / mapping)
    const queuedTasks: string[] = [];
    const queueErrors: string[] = [];

    if (queueSynopsis || queueSiteMapping) {
      const tasks: string[] = [];
      if (queueSynopsis) tasks.push("org_due_diligence");
      if (queueSiteMapping) tasks.push("site_mapping");

      if (tasks.length > 0) {
        try {
          const { error: jobErr } = await supabase.from("ingestion_jobs").insert({
            organization_id: organizationId,
            site_url: website,
            job_type: "mapper",
            status: "queued",
            priority: 5,
            payload: {
              requested_by_user_id: userId,
              requested_at: nowIso,
              source_url: rawUrl,
              website_url: website,
              tasks,
            },
          });
          if (jobErr) throw jobErr;
          queuedTasks.push(...tasks);
        } catch (e: any) {
          queueErrors.push(e?.message || "Failed to enqueue ingestion job");

          // Fallback: trigger immediate due diligence async (non-blocking) if we cannot write ingestion_jobs.
          if (queueSynopsis) {
            safeInvokeInternal("generate-org-due-diligence", {
              organizationId: organizationId,
              websiteUrl: website,
              forceRegenerate: false,
            }).catch(() => {
              // ignore
            });
          }
        }
      }
    }

    return new Response(
      JSON.stringify(
        {
          success: true,
          organization_id: organizationId,
          website,
          created,
          extracted_fields: extractedFields,
          updated_fields: updatedFields,
          queued_tasks: queuedTasks,
          queue_errors: queueErrors,
        },
        null,
        2
      ),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("create-org-from-url error:", error);
    return new Response(JSON.stringify({ success: false, error: error?.message || String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

