import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { supabase } from '../lib/supabase';
import '../styles/unified-design-system.css';

type DocTab = 'teaser' | 'business_plan' | 'information_memorandum' | 'revenue_model' | 'data_inventory' | 'technical_exhibits';

const markdownLoaders: Record<DocTab, () => Promise<string>> = {
  teaser: () => import('@docs/investor/NUKE_TEASER.md?raw').then(m => m.default),
  business_plan: () => import('@docs/investor/NUKE_BUSINESS_PLAN.md?raw').then(m => m.default),
  information_memorandum: () => import('@docs/investor/NUKE_INFORMATION_MEMORANDUM.md?raw').then(m => m.default),
  revenue_model: () => import('@docs/investor/REVENUE_MODEL.md?raw').then(m => m.default),
  data_inventory: () => import('@docs/investor/DATA_INVENTORY.md?raw').then(m => m.default),
  technical_exhibits: () => import('@docs/investor/TECHNICAL_EXHIBITS.md?raw').then(m => m.default),
};

interface AccessLog {
  action: string;
  document?: string;
  metadata?: Record<string, unknown>;
}

const DOCUMENTS: Record<DocTab, { title: string; subtitle: string; pages: string }> = {
  teaser: {
    title: 'Executive Summary',
    subtitle: 'Pre-NDA distribution',
    pages: '~5 pp',
  },
  business_plan: {
    title: 'Business Plan',
    subtitle: 'Comprehensive business plan with appendices',
    pages: '~35 pp',
  },
  information_memorandum: {
    title: 'Information Memorandum',
    subtitle: 'Professional due-diligence document',
    pages: '~35 pp',
  },
  technical_exhibits: {
    title: 'Technical Exhibits',
    subtitle: 'Platform architecture, API specification, and data documentation',
    pages: '~35 pp',
  },
  revenue_model: {
    title: 'Revenue Model',
    subtitle: 'Detailed revenue streams and projections',
    pages: '~4 pp',
  },
  data_inventory: {
    title: 'Data Inventory',
    subtitle: 'Live system data audit with source queries',
    pages: '~8 pp',
  },
};

// SHA-256 hashes of valid access codes (lowercase-trimmed before hashing)
const ACCESS_CODE_HASHES = new Set([
  '223e688a072af23f80f45a69e03b55c2caecece716270767179933fd345e95ac', // 0915
  'e9ab39f01d431c5250493a3dc493bba9c43f73a4461c72b5135ee09738582af7', // 1129
  '46372791018924b8cbc444334300f85a211d2f29a56f2bb4890780b5983fc201', // 1025
]);
const sha256 = async (s: string): Promise<string> => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
};
const PORTAL_PROFILE_KEY = 'nuke_investor_portal_profile';

// ── Live stats for template interpolation ────────────────────────────────────────────

interface PortalStats {
  vehicle_count: number;
  image_count: number;
  comment_count: number;
  bid_count: number;
  estimate_count: number;
  analysis_count: number;
  identity_count: number;
  org_count: number;
  user_profiles: number;
  observations_count: number;
  image_extractions: number;
  total_value: number;
  vehicles_with_price: number;
  db_size_gb: number;
  table_count: number;
  edge_function_count: number;
  data_freshness_pct: number;
  daily_rate: number;
  queue_complete: number;
  queue_pending: number;
  queue_failed: number;
  generated_at: string;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}
function fmtM(n: number): string {
  if (n >= 1_000_000) return (Math.round(n / 100_000) / 10).toFixed(1) + ' million';
  if (n >= 1_000) return (Math.round(n / 100) / 10).toFixed(1) + 'K';
  return String(n);
}
function fmtB(n: number): string {
  if (n >= 1_000_000_000) return '$' + (Math.round(n / 100_000_000) / 10).toFixed(1) + ' billion';
  if (n >= 1_000_000) return '$' + (Math.round(n / 100_000) / 10).toFixed(1) + 'M';
  return '$' + fmt(n);
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
function fmtDateISO(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function buildTemplateVars(s: PortalStats): Record<string, string> {
  return {
    '{{VEHICLE_COUNT}}':       fmt(s.vehicle_count),
    '{{IMAGE_COUNT_M}}':       fmtM(s.image_count),
    '{{IMAGE_COUNT_EXACT}}':   fmt(s.image_count),
    '{{COMMENT_COUNT_M}}':     fmtM(s.comment_count),
    '{{COMMENT_COUNT_EXACT}}': fmt(s.comment_count),
    '{{BID_COUNT}}':           fmt(s.bid_count),
    '{{ESTIMATE_COUNT}}':      fmt(s.estimate_count),
    '{{ANALYSIS_COUNT}}':      fmt(s.analysis_count),
    '{{IDENTITY_COUNT}}':      fmt(s.identity_count),
    '{{ORG_COUNT}}':           fmt(s.org_count),
    '{{USER_PROFILES}}':       fmt(s.user_profiles),
    '{{OBSERVATIONS_COUNT}}':  fmt(s.observations_count),
    '{{IMAGE_EXTRACTIONS}}':   fmt(s.image_extractions),
    '{{TOTAL_VALUE_B}}':       fmtB(s.total_value),
    '{{TOTAL_VALUE_EXACT}}':   '$' + fmt(s.total_value),
    '{{VEHICLES_WITH_PRICE}}': fmt(s.vehicles_with_price),
    '{{DB_SIZE_GB}}':          String(s.db_size_gb),
    '{{TABLE_COUNT}}':         fmt(s.table_count),
    '{{EDGE_FUNCTION_COUNT}}': String(s.edge_function_count),
    '{{DATA_FRESHNESS}}':      s.data_freshness_pct.toFixed(1) + '%',
    '{{DAILY_RATE}}':          fmt(s.daily_rate),
    '{{QUEUE_COMPLETE}}':      fmt(s.queue_complete),
    '{{QUEUE_PENDING}}':       fmt(s.queue_pending),
    '{{QUEUE_FAILED}}':        fmt(s.queue_failed),
    '{{GENERATED_DATE}}':      fmtDate(s.generated_at),
    '{{GENERATED_DATE_ISO}}':  fmtDateISO(s.generated_at),
  };
}

function interpolate(md: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(k, v), md);
}

// ── Popup content ───────────────────────────────────────────────────────────────────────────────

const POPUP_CONTENT: Record<string, { title: string; body: React.ReactNode }> = {
  yono: {
    title: 'YONO — Vehicle Image Intelligence',
    body: (
      <div>
        <p><strong>"You Only Nuke Once"</strong> — in-house vehicle image classification built on the EfficientNet-B0 architecture, purpose-built for collector and collector-adjacent vehicles.</p>
        <p><strong>Training structure (5 phases):</strong></p>
        <ol style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
          <li>Overall condition classification</li>
          <li>Rust and damage detection</li>
          <li>Interior assessment</li>
          <li>Engine bay analysis</li>
          <li>Spec identification from photos</li>
        </ol>
        <p><strong>Current status:</strong> Phase 5 of 5 complete. EfficientNet-B0 model trained and exported to ONNX. Production sidecar deployed (FastAPI on Modal). The full classification pipeline is operational — zone detection, hierarchical make/family classification, and condition scoring are running. Inference: ~4ms per image on dedicated hardware. The model improves continuously as labeled data accumulates from our 34M+ image database.</p>
        <p><strong>Why domain-specific matters:</strong> Generic object detection can't distinguish a patina'd original from surface rust, or a stock interior from a period-correct restore. YONO is trained specifically on vehicles — that domain specificity is what makes it useful for valuation context rather than just image sorting.</p>
      </div>
    ),
  },
  ralph: {
    title: 'Ralph Wiggum — Extraction Orchestration',
    body: (
      <div>
        <p>Ralph Wiggum is the extraction orchestration layer — the system that keeps autonomous ingestion running without human intervention. Named after the Simpsons character who cheerfully announces "I'm helping!"</p>
        <p><strong>What it actually is:</strong> A coordination shell: bash scripts and Supabase edge functions that sequence and monitor the extraction pipeline. Not a novel AI system — the value is in what it coordinates, not the orchestrator itself.</p>
        <p><strong>What it does:</strong></p>
        <ul style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
          <li>Runs extraction cycles continuously</li>
          <li>Monitors source health — identifies extractors with high failure rates</li>
          <li>Triages failures and routes to fallback methods</li>
          <li>Drives the discovery snowball: follows leads from known sources to find new ones</li>
          <li>Generates structured coordination briefs for human operators using compressed context + LLM reasoning</li>
        </ul>
        <p><strong>Honest assessment:</strong> The orchestration shell is infrastructure glue — important but not a proprietary moat. The value is the pipeline it manages: 80+ registered data sources, the extraction logic, and the observation architecture it feeds into. Those are harder to replicate than the scheduler around them.</p>
      </div>
    ),
  },
  obs: {
    title: 'Observation Architecture — How Data is Stored',
    body: (
      <div>
        <p>Every fact in the Nuke database is stored as an <strong>observation</strong> — not a field override, but an immutable event record with full provenance.</p>
        <p><strong>Each observation carries:</strong></p>
        <ul style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
          <li><strong>Source ID</strong> — which of the 80 registered sources produced it</li>
          <li><strong>Confidence score</strong> — 0.0 to 1.0, calibrated per source type (Ferrari Classiche registry: 0.98 · Instagram post: 0.40)</li>
          <li><strong>Valid time</strong> — when the fact was true in the real world</li>
          <li><strong>Transaction time</strong> — when it was ingested into the system</li>
          <li><strong>Raw payload</strong> — the original data, unmodified</li>
        </ul>
        <p><strong>Conflict resolution:</strong> When multiple sources report different values for the same field, confidence scores determine precedence. A DMV record (0.95) supersedes a forum post (0.50) — but both are retained. Nothing is deleted.</p>
        <p><strong>Why this matters:</strong> Every valuation, every claim about a vehicle's history is traceable to source with a confidence score. This auditability is what makes the data licensable to insurers and lenders who require defensible data provenance — not just "the data says X" but "source Y with 0.95 confidence says X, corroborated by source Z."</p>
        <p style={{ fontSize: '11px', color: 'var(--text-disabled)', marginTop: '12px' }}>80 registered sources · 9 categories · 1.36M+ observations stored</p>
      </div>
    ),
  },
  sdk: {
    title: 'Nuke SDK — API Client',
    body: (
      <div>
        <p>The Nuke SDK is a TypeScript client library for programmatic access to the Nuke platform. 1,309 lines. Designed for dealer management systems, auction integrations, insurance pricing models, and collector portfolio tools.</p>
        <p><strong>Coverage:</strong></p>
        <ul style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
          <li>Vehicle lookup — by VIN, make/model/year, or Nuke ID</li>
          <li>Observation ingestion — submit data points with source attribution</li>
          <li>Batch vehicle import — up to 1,000 vehicles per call</li>
          <li>Webhook registration — real-time event streams</li>
          <li>Valuation requests — structured estimate with confidence range</li>
          <li>Full-text search — across vehicles, organizations, users</li>
        </ul>
        <p><strong>Current state:</strong> The underlying API endpoints are production-ready. The SDK wraps them correctly. Developer documentation is still being written — it works but onboarding a new developer currently requires hand-holding. This is a near-term priority: documentation and a self-serve onboarding flow.</p>
      </div>
    ),
  },
  sentiment: {
    title: 'Community Sentiment — Methodology',
    body: (
      <div>
        <p>Sentiment scores are derived from natural language analysis of auction comments — primarily Bring a Trailer, where vehicles attract 50–200+ comments from knowledgeable enthusiasts before selling.</p>
        <p><strong>Pipeline:</strong></p>
        <ol style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
          <li>All auction comments ingested and stored (11.6M+ comments across 132K+ listings)</li>
          <li>Each comment batch analyzed via LLM with vehicle-specific context</li>
          <li>Outputs: sentiment score (0.0–1.0), detected themes, notable flags (matching numbers, service history gaps, rust concerns, incorrect specs, etc.)</li>
          <li>Scores aggregate across all comments for a vehicle to produce a final sentiment profile</li>
        </ol>
        <p><strong>Why auction comments?</strong> The BaT community is uniquely expert. A comment like "incorrect date-code battery, not matching numbers" from a marque specialist carries real price information — the kind of signal that doesn't appear in title history or standard vehicle data. The crowd knows things the record doesn't.</p>
        <p><strong>Average sentiment score across analyzed vehicles: 0.79</strong> (the community skews positive — enthusiasts bid on vehicles they're excited about).</p>
        <p style={{ fontSize: '11px', color: 'var(--text-disabled)', marginTop: '12px' }}>127K+ vehicles analyzed · 11.6M+ comments processed</p>
      </div>
    ),
  },
  'sentiment-proof': {
    title: 'Sentiment → Price: The Evidence',
    body: (
      <div>
        <p>Across vehicles with both community sentiment scores and confirmed auction sale prices, the correlation is consistent across the full sentiment range:</p>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '12px', fontSize: '11px' }}>
          <thead>
            <tr style={{ background: 'var(--bg)' }}>
              <th style={{ border: '1px solid var(--border)', padding: '6px 10px', textAlign: 'left' }}>Sentiment</th>
              <th style={{ border: '1px solid var(--border)', padding: '6px 10px', textAlign: 'left' }}>Score</th>
              <th style={{ border: '1px solid var(--border)', padding: '6px 10px', textAlign: 'left' }}>Median Sale Price</th>
              <th style={{ border: '1px solid var(--border)', padding: '6px 10px', textAlign: 'left' }}>vs. Very Negative</th>
            </tr>
          </thead>
          <tbody>
            {([
              ['Very Negative', '<0.2', '$13,250', 'baseline', false],
              ['Negative', '0.2–0.4', '$15,911', '+20%', true],
              ['Neutral', '0.4–0.6', '$16,500', '+25%', true],
              ['Positive', '0.6–0.8', '$20,000', '+51%', true],
              ['Very Positive', '0.8+', '$25,000', '+89%', true],
            ] as [string, string, string, string, boolean][]).map(([tier, range, price, vs, highlight]) => (
              <tr key={tier}>
                <td style={{ border: '1px solid var(--border)', padding: '5px 10px' }}>{tier}</td>
                <td style={{ border: '1px solid var(--border)', padding: '5px 10px' }}>{range}</td>
                <td style={{ border: '1px solid var(--border)', padding: '5px 10px', fontWeight: highlight ? 'bold' : 'normal' }}>{price}</td>
                <td style={{ border: '1px solid var(--border)', padding: '5px 10px', color: highlight ? 'var(--success)' : 'var(--text-disabled)', fontWeight: highlight ? 'bold' : 'normal' }}>{vs}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ marginTop: '12px' }}><strong>Sample:</strong> Vehicles with both community sentiment scores and confirmed auction sale prices.</p>
        <p><strong>Method:</strong> Each vehicle's sentiment score is the weighted average of all auction comment analyses. Vehicles are bucketed into 5 tiers. Median sale price is calculated per tier.</p>
        <p><strong>On confounders:</strong> More desirable vehicles (rarer, better condition) naturally attract both positive sentiment and higher prices. The sentiment score partially reflects underlying quality. However, controlling for make/model/year, the sentiment premium persists — community knowledge captures information that structured data does not.</p>
      </div>
    ),
  },
};

export default function InvestorOffering() {
  const [phase, setPhase] = useState<'gate' | 'acknowledge' | 'portal'>('gate');
  const [accessCode, setAccessCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [activeDoc, setActiveDoc] = useState<DocTab>('teaser');
  const [portalStats, setPortalStats] = useState<PortalStats | null>(null);
  const [popup, setPopup] = useState<{ id: string; note: string; submitted: boolean } | null>(null);
  const [sessionId] = useState(() => crypto.randomUUID());
  const [viewerName, setViewerName] = useState('');
  const [viewerEmail, setViewerEmail] = useState('');
  const [viewerOrg, setViewerOrg] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [acknowledged, setAcknowledged] = useState({
    confidential: false,
    noDistribute: false,
    noOffer: false,
    understand: false,
  });
  const [accessGrantedAt, setAccessGrantedAt] = useState<string | null>(null);
  const [docViewTimes, setDocViewTimes] = useState<Record<string, number>>({});
  const [exportRequested, setExportRequested] = useState(false);
  const [activeContent, setActiveContent] = useState<string | null>(null);

  // Load remembered profile from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PORTAL_PROFILE_KEY);
      if (raw) {
        const { name, email, org } = JSON.parse(raw);
        if (email) {
          setViewerName(name || '');
          setViewerEmail(email || '');
          setViewerOrg(org || '');
          setRememberMe(true);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // Log access event to Supabase
  const logAccess = useCallback(async (entry: AccessLog) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('system_logs').insert({
        log_type: 'investor_portal',
        message: entry.action,
        metadata: {
          session_id: sessionId,
          document: entry.document || null,
          viewer_name: viewerName || null,
          viewer_email: viewerEmail || null,
          viewer_org: viewerOrg || null,
          user_id: user?.id || 'anonymous',
          user_agent: navigator.userAgent,
          timestamp: new Date().toISOString(),
          ...entry.metadata,
        },
      });
    } catch {
      // Silent fail - don't block UX for logging
    }
  }, [sessionId, viewerName, viewerEmail, viewerOrg]);

  // Track document view time
  useEffect(() => {
    if (phase !== 'portal') return;
    const start = Date.now();
    return () => {
      const duration = Math.round((Date.now() - start) / 1000);
      setDocViewTimes(prev => ({
        ...prev,
        [activeDoc]: (prev[activeDoc] || 0) + duration,
      }));
    };
  }, [activeDoc, phase]);

  // Load markdown content for the active document lazily
  useEffect(() => {
    let cancelled = false;
    setActiveContent(null);
    markdownLoaders[activeDoc]().then(content => {
      if (!cancelled) setActiveContent(content);
    });
    return () => { cancelled = true; };
  }, [activeDoc]);

  // Log document switch
  useEffect(() => {
    if (phase === 'portal') {
      logAccess({ action: 'document_viewed', document: activeDoc });
    }
  }, [activeDoc, phase, logAccess]);

  const openPopup = (id: string) => {
    setPopup({ id, note: '', submitted: false });
    logAccess({ action: 'popup_opened', metadata: { popup_id: id } });
  };
  const closePopup = () => setPopup(null);
  const submitPopupNote = () => {
    if (!popup?.note.trim()) return;
    logAccess({ action: 'popup_note_saved', metadata: { popup_id: popup.id, note: popup.note } });
    setPopup(prev => prev ? { ...prev, submitted: true } : null);
  };

  const handleAccessCode = async () => {
    const hash = await sha256(accessCode.toLowerCase().trim());
    if (ACCESS_CODE_HASHES.has(hash)) {
      setPhase('acknowledge');
      logAccess({ action: 'access_code_accepted' });
      setCodeError('');
      // Prefetch stats while user reads NDA — ready by the time they enter the portal
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      fetch(`${supabaseUrl}/functions/v1/investor-portal-stats`)
        .then(r => r.json())
        .then((stats: PortalStats) => setPortalStats(stats))
        .catch(() => {});
    } else {
      setCodeError('Invalid access code');
      logAccess({ action: 'access_code_rejected', metadata: { attempted: accessCode.length } });
    }
  };

  const handleAcknowledge = () => {
    const allChecked = Object.values(acknowledged).every(Boolean);
    if (!allChecked) return;

    if (rememberMe) {
      try {
        localStorage.setItem(PORTAL_PROFILE_KEY, JSON.stringify({
          name: viewerName.trim(),
          email: viewerEmail.trim(),
          org: viewerOrg.trim(),
        }));
      } catch {
        // ignore
      }
    } else {
      try {
        localStorage.removeItem(PORTAL_PROFILE_KEY);
      } catch {
        // ignore
      }
    }

    setPhase('portal');
    setAccessGrantedAt(new Date().toISOString());
    logAccess({
      action: 'nda_acknowledged',
      metadata: {
        viewer_name: viewerName,
        viewer_email: viewerEmail,
        viewer_org: viewerOrg,
      },
    });
  };

  const handleExportPDF = async () => {
    setExportRequested(true);
    await logAccess({
      action: 'pdf_export_requested',
      document: activeDoc,
      metadata: {
        viewer_name: viewerName,
        viewer_email: viewerEmail,
        viewer_org: viewerOrg,
        document_view_times: docViewTimes,
        total_session_seconds: Object.values(docViewTimes).reduce((a, b) => a + b, 0),
      },
    });

    // Generate PDF via browser print
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const doc = DOCUMENTS[activeDoc];
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${doc.title} - Nuke</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            font-size: 11pt;
            line-height: 1.6;
            max-width: 800px;
            margin: 0 auto;
            padding: 40px;
            color: #1a1a1a;
          }
          h1 { font-size: 18pt; border-bottom: 2px solid #333; padding-bottom: 8px; }
          h2 { font-size: 14pt; margin-top: 24px; border-bottom: 1px solid #999; padding-bottom: 4px; }
          h3 { font-size: 12pt; margin-top: 16px; }
          table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 10pt; }
          th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
          th { background: #f0f0f0; font-weight: bold; }
          code { font-family: 'SF Mono', 'Cascadia Code', monospace; font-size: 9pt; background: #f5f5f5; padding: 1px 4px; }
          pre { background: #f5f5f5; padding: 12px; font-size: 9pt; overflow-x: auto; border: 1px solid #ddd; }
          hr { border: none; border-top: 1px solid #ccc; margin: 20px 0; }
          .watermark {
            position: fixed; bottom: 20px; right: 20px;
            font-size: 8pt; color: #999;
          }
          .header-stamp {
            font-size: 8pt; color: #666; border: 1px solid #ccc;
            padding: 8px 12px; margin-bottom: 20px; background: #fafafa;
          }
          @media print {
            body { padding: 20px; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header-stamp">
          <strong>CONFIDENTIAL</strong> - Nuke<br/>
          Document: ${doc.title}<br/>
          Accessed by: ${viewerName || 'Anonymous'} ${viewerEmail ? `(${viewerEmail})` : ''} ${viewerOrg ? `- ${viewerOrg}` : ''}<br/>
          Session: ${sessionId.substring(0, 8)}<br/>
          Generated: ${new Date().toISOString()}<br/>
          IP logged. Distribution prohibited without written consent.
        </div>
        <div id="content"></div>
        <div class="watermark">
          CONFIDENTIAL - ${sessionId.substring(0, 8)} - ${viewerName || 'Anon'} - ${new Date().toLocaleDateString()}
        </div>
      </body>
      </html>
    `);

    // Render markdown to HTML in the print window
    const contentDiv = printWindow.document.getElementById('content');
    if (contentDiv) {
      // Simple markdown to HTML (the print window doesn't have React)
      const rawContent = activeContent ?? '';
      const content = portalStats ? interpolate(rawContent, buildTemplateVars(portalStats)) : rawContent;
      const html = markdownToHtml(content);
      contentDiv.innerHTML = html;
    }

    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  };

  // Simple markdown to HTML converter for PDF export
  function markdownToHtml(md: string): string {
    const html = md
      // Escape HTML
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Code blocks
      .replace(/```[\s\S]*?```/g, (match) => {
        const code = match.slice(3, -3).replace(/^\w*\n/, '');
        return `<pre><code>${code}</code></pre>`;
      })
      // Headers
      .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Horizontal rules
      .replace(/^---$/gm, '<hr/>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      // Tables (basic)
      .replace(/^\|(.+)\|$/gm, (match) => {
        const cells = match.split('|').filter(c => c.trim());
        if (cells.every(c => /^[\s-:]+$/.test(c))) return ''; // separator row
        const tag = 'td';
        return '<tr>' + cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
      })
      // Wrap table rows
      .replace(/((?:<tr>.*<\/tr>\n?)+)/g, '<table>$1</table>')
      // Line breaks
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br/>');

    return `<p>${html}</p>`;
  }

  // === RENDER: ACCESS CODE GATE ===
  if (phase === 'gate') {
    // Key stats shown publicly before gate — visible before access code
    const gateStats = [
      { label: 'Vehicles indexed', value: '1.25M', note: 'collector & adjacent, growing daily' },
      { label: 'Vehicle images', value: '33.7M', note: 'from 15+ auction & marketplace sources' },
      { label: 'Nuke AI valuations', value: '513K', note: 'confidence-weighted, source-traced' },
      { label: 'Market segment ETFs', value: '4', note: 'fractional exposure to collector segments' },
    ];

    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: '48px 20px 40px',
      }}>
        {/* Top wordmark */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{
            fontSize: '15px',
            fontWeight: 'bold',
            letterSpacing: '4px',
            textTransform: 'uppercase',
            color: 'var(--text)',
          }}>
            NUKE
          </div>
          <div style={{
            fontSize: '12px',
            color: 'var(--text-muted)',
            marginTop: '4px',
            letterSpacing: '1px',
          }}>
            Collector Vehicle Data Platform
          </div>
        </div>

        {/* Headline */}
        <div style={{
          maxWidth: '680px',
          textAlign: 'center',
          marginBottom: '36px',
        }}>
          <h1 style={{
            fontSize: '29px',
            fontWeight: 800,
            margin: '0 0 12px 0',
            color: 'var(--text)',
            lineHeight: 1.15,
          }}>
            The data infrastructure for<br />collector vehicle investing
          </h1>
          <p style={{
            fontSize: '15px',
            color: 'var(--text-muted)',
            margin: 0,
            lineHeight: 1.6,
          }}>
            1.25M vehicles. 33.7M images. 513K AI valuations. Real transaction prices across 15+ auction platforms.
            Fractional ownership with NAV grounded in actual auction closes — not appraisals.
          </p>
        </div>

        {/* Public stats grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '1px',
          background: 'var(--border-light)',
          border: '1px solid var(--border-medium)',
          marginBottom: '36px',
          width: '100%',
          maxWidth: '560px',
        }}>
          {gateStats.map((s, i) => (
            <div key={i} style={{
              background: 'var(--white)',
              padding: '20px 24px',
            }}>
              <div style={{ fontSize: '27px', fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>
                {s.value}
              </div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', marginTop: '4px' }}>
                {s.label}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                {s.note}
              </div>
            </div>
          ))}
        </div>

        {/* Gate box */}
        <div style={{
          background: 'var(--white)',
          border: '2px solid var(--border-medium)',
          padding: '28px 32px',
          width: '100%',
          maxWidth: '400px',
        }}>
          <div style={{
            fontSize: '11px',
            fontWeight: 'bold',
            textTransform: 'uppercase',
            letterSpacing: '2px',
            color: 'var(--text-muted)',
            marginBottom: '16px',
            textAlign: 'center',
          }}>
            Investor Data Room
          </div>

          {/* Access Code Input */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <label style={{
              fontSize: '11px',
              fontWeight: 'bold',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              display: 'block',
              marginBottom: 'var(--space-2)',
            }}>
              Access Code
            </label>
            <input
              type="password"
              value={accessCode}
              onChange={e => { setAccessCode(e.target.value); setCodeError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleAccessCode()}
              placeholder="Enter your access code"
              style={{
                width: '100%',
                padding: '10px 12px',
                border: `2px solid ${codeError ? 'var(--error)' : 'var(--border-medium)'}`,
                fontFamily: 'var(--font-family)',
                fontSize: '15px',
                background: 'var(--grey-50)',
                boxSizing: 'border-box',
              }}
              autoFocus
            />
            {codeError && (
              <div style={{ fontSize: '11px', color: 'var(--error)', marginTop: 'var(--space-1)' }}>
                {codeError}
              </div>
            )}
          </div>

          <button
            onClick={handleAccessCode}
            style={{
              width: '100%',
              padding: '12px',
              background: 'var(--text)',
              color: 'var(--bg)',
              border: '2px solid var(--text)',
              fontSize: '12px',
              fontWeight: 'bold',
              letterSpacing: '1px',
              textTransform: 'uppercase',
              cursor: 'pointer',
              fontFamily: 'var(--font-family)',
            }}
          >
            Enter Data Room
          </button>

          <div style={{
            fontSize: '9px',
            color: 'var(--text-disabled)',
            textAlign: 'center',
            marginTop: '14px',
            lineHeight: '1.6',
          }}>
            Access is logged and monitored.<br />
            Contact <a href="mailto:info@nuke.ag" style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>info@nuke.ag</a> for credentials.
          </div>
        </div>

        {/* Competitor context strip */}
        <div style={{
          marginTop: '32px',
          maxWidth: '560px',
          width: '100%',
          padding: '14px 20px',
          background: 'var(--white)',
          border: '1px solid var(--border-light)',
          fontSize: '11px',
          color: 'var(--text-muted)',
          lineHeight: 1.7,
          textAlign: 'center',
        }}>
          The entire fractional vehicle market is under $100M AUM — less than 0.3% fractionalized.
          Rally raised $112M, has 9 cars, and was SEC-fined $350K in 2023.
          Nuke tracks 1.25M vehicles with real transaction prices. The gap is the opportunity.{' '}
          <a href="/market/competitors" style={{ color: 'var(--text)', textDecoration: 'underline', fontWeight: 600 }}>
            Full competitive analysis →
          </a>
        </div>
      </div>
    );
  }

  // === RENDER: NDA ACKNOWLEDGEMENT ===
  if (phase === 'acknowledge') {
    const allChecked = Object.values(acknowledged).every(Boolean);

    return (
      <div style={{
        padding: 'var(--space-6)',
        maxWidth: '600px',
        margin: '40px auto',
      }}>
        <div style={{
          background: 'var(--white)',
          border: '2px solid var(--border-medium)',
          padding: 'var(--space-8)',
        }}>
          <div style={{
            fontSize: '11px',
            letterSpacing: '3px',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 'var(--space-1)',
          }}>
            NUKE / INVESTOR PORTAL
          </div>
          <h1 style={{
            fontSize: '19px',
            fontWeight: 'bold',
            margin: '0 0 var(--space-6) 0',
            borderBottom: '2px solid var(--border-medium)',
            paddingBottom: 'var(--space-3)',
          }}>
            Confidentiality Acknowledgement
          </h1>

          {/* Viewer Info */}
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <div style={{ fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 'var(--space-3)' }}>
              Viewer Information
            </div>
            <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
              <input
                placeholder="Full Name *"
                value={viewerName}
                onChange={e => setViewerName(e.target.value)}
                style={{
                  padding: '6px 10px', border: '1px solid var(--border-medium)',
                  fontSize: '12px', fontFamily: 'var(--font-family)',
                  background: 'var(--grey-50)',
                }}
              />
              <input
                placeholder="Email Address *"
                type="email"
                value={viewerEmail}
                onChange={e => setViewerEmail(e.target.value)}
                style={{
                  padding: '6px 10px', border: '1px solid var(--border-medium)',
                  fontSize: '12px', fontFamily: 'var(--font-family)',
                  background: 'var(--grey-50)',
                }}
              />
              <input
                placeholder="Organization (optional)"
                value={viewerOrg}
                onChange={e => setViewerOrg(e.target.value)}
                style={{
                  padding: '6px 10px', border: '1px solid var(--border-medium)',
                  fontSize: '12px', fontFamily: 'var(--font-family)',
                  background: 'var(--grey-50)',
                }}
              />
            </div>
            <label style={{
              display: 'flex',
              gap: 'var(--space-2)',
              alignItems: 'center',
              marginTop: 'var(--space-3)',
              fontSize: '12px',
              cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={e => setRememberMe(e.target.checked)}
                style={{ flexShrink: 0 }}
              />
              <span>Remember my info so I don&apos;t have to enter it next time</span>
            </label>
          </div>

          {/* Acknowledgement Checkboxes */}
          <div style={{
            background: 'var(--grey-50)',
            border: '1px solid var(--border-light)',
            padding: 'var(--space-4)',
            marginBottom: 'var(--space-6)',
          }}>
            <div style={{ fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 'var(--space-3)' }}>
              Please acknowledge the following:
            </div>

            {[
              { key: 'confidential' as const, text: 'I understand that the materials contained in this portal are CONFIDENTIAL and proprietary to Nuke.' },
              { key: 'noDistribute' as const, text: 'I agree NOT to copy, distribute, forward, or share any materials from this portal without prior written consent from Nuke.' },
              { key: 'noOffer' as const, text: 'I understand that these materials do NOT constitute an offer or solicitation to sell or purchase securities. No investment decision should be based solely on these materials.' },
              { key: 'understand' as const, text: 'I acknowledge that my access to this portal is logged, including my IP address, viewing duration, and document interactions, and I consent to this monitoring.' },
            ].map(({ key, text }) => (
              <label key={key} style={{
                display: 'flex',
                gap: 'var(--space-3)',
                alignItems: 'flex-start',
                marginBottom: 'var(--space-3)',
                fontSize: '12px',
                lineHeight: '1.5',
                cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={acknowledged[key]}
                  onChange={e => setAcknowledged(prev => ({ ...prev, [key]: e.target.checked }))}
                  style={{ marginTop: '2px', flexShrink: 0 }}
                />
                <span>{text}</span>
              </label>
            ))}
          </div>

          <button
            onClick={handleAcknowledge}
            disabled={!allChecked || !viewerName || !viewerEmail}
            style={{
              width: '100%',
              padding: '10px',
              background: allChecked && viewerName && viewerEmail ? 'var(--text)' : 'var(--grey-400)',
              color: 'var(--bg)',
              border: '2px solid transparent',
              fontSize: '12px',
              fontWeight: 'bold',
              letterSpacing: '1px',
              textTransform: 'uppercase',
              cursor: allChecked && viewerName && viewerEmail ? 'pointer' : 'not-allowed',
              fontFamily: 'var(--font-family)',
            }}
          >
            I Acknowledge &amp; Enter Data Room
          </button>

          <div style={{
            fontSize: '9px',
            color: 'var(--text-disabled)',
            textAlign: 'center',
            marginTop: 'var(--space-4)',
            lineHeight: '1.5',
          }}>
            Session ID: {sessionId.substring(0, 8)}<br />
            All access is logged and monitored.
          </div>
        </div>
      </div>
    );
  }

  // === RENDER: DATA ROOM PORTAL ===
  const doc = DOCUMENTS[activeDoc];

  return (
    <div style={{ padding: 'var(--space-4)', maxWidth: '1100px', margin: '0 auto' }}>
      {/* Portal Header */}
      <div style={{
        background: 'var(--white)',
        border: '2px solid var(--border-medium)',
        padding: 'var(--space-4) var(--space-6)',
        marginBottom: 'var(--space-4)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '8px',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '13px', fontWeight: 800, letterSpacing: '2px', textTransform: 'uppercase' }}>
              NUKE
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '1px', textTransform: 'uppercase' }}>
              Investor Data Room
            </span>
          </div>
          <div style={{ fontSize: '9px', color: 'var(--text-disabled)', marginTop: '3px' }}>
            {viewerName && <span>{viewerName}{viewerOrg ? ` · ${viewerOrg}` : ''} · </span>}
            Session {sessionId.substring(0, 8)} · {accessGrantedAt ? new Date(accessGrantedAt).toLocaleTimeString() : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <a
            href="mailto:info@nuke.ag?subject=Nuke%20Investment%20Inquiry"
            style={{
              fontSize: '11px',
              fontWeight: 600,
              padding: '5px 12px',
              background: 'var(--text)',
              color: 'var(--bg)',
              textDecoration: 'none',
              letterSpacing: '0.5px',
            }}
          >
            Contact to Invest
          </a>
          <div style={{
            fontSize: '9px',
            padding: '4px 10px',
            background: 'var(--success-dim)',
            color: 'var(--success)',
            border: '1px solid var(--success-dim)',
            fontWeight: 'bold',
            letterSpacing: '0.5px',
          }}>
            CONFIDENTIAL
          </div>
        </div>
      </div>

      {/* Document Tabs */}
      <div style={{
        display: 'flex',
        gap: 0,
        marginBottom: 'var(--space-4)',
        borderBottom: '2px solid var(--border-medium)',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch' as any,
      }}>
        {(Object.entries(DOCUMENTS) as [DocTab, typeof DOCUMENTS[DocTab]][]).map(([key, d]) => (
          <button
            key={key}
            onClick={() => setActiveDoc(key)}
            style={{
              padding: '10px 16px',
              background: activeDoc === key ? 'var(--white)' : 'var(--grey-100)',
              border: activeDoc === key ? '2px solid var(--border-medium)' : '1px solid var(--border-light)',
              borderBottom: activeDoc === key ? '2px solid var(--white)' : 'none',
              marginBottom: activeDoc === key ? '-2px' : '0',
              fontSize: '12px',
              fontWeight: activeDoc === key ? 'bold' : 'normal',
              cursor: 'pointer',
              fontFamily: 'var(--font-family)',
              letterSpacing: '0.3px',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {d.title}
            <span style={{ fontSize: '9px', color: 'var(--text-disabled)', marginLeft: '6px' }}>
              {d.pages}
            </span>
          </button>
        ))}

        {/* Export PDF button */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', flexShrink: 0, paddingLeft: '8px' }}>
          <button
            onClick={handleExportPDF}
            disabled={exportRequested}
            style={{
              padding: '8px 16px',
              background: exportRequested ? 'var(--grey-200)' : 'var(--text)',
              color: exportRequested ? 'var(--text-muted)' : 'var(--bg)',
              border: '1px solid var(--border-medium)',
              fontSize: '11px',
              fontWeight: 'bold',
              letterSpacing: '1px',
              textTransform: 'uppercase',
              cursor: exportRequested ? 'default' : 'pointer',
              fontFamily: 'var(--font-family)',
              whiteSpace: 'nowrap',
            }}
          >
            {exportRequested ? 'PDF Generated' : 'Export PDF'}
          </button>
        </div>
      </div>

      {/* Document Content */}
      <div style={{
        background: 'var(--white)',
        border: '2px solid var(--border-medium)',
        padding: '32px 48px',
        minHeight: '600px',
      }}>
        {/* Document title bar */}
        <div style={{
          fontSize: '11px',
          color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border-light)',
          paddingBottom: '8px',
          marginBottom: '24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontWeight: 500 }}>{doc.subtitle}</span>
          <span style={{ color: 'var(--text-disabled)' }}>Nuke · {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        </div>

        {/* Rendered Markdown */}
        <div className="investor-doc-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => (
                <h1 style={{
                  fontSize: '21px', fontWeight: 'bold',
                  borderBottom: '2px solid var(--border-medium)',
                  paddingBottom: 'var(--space-2)', marginBottom: 'var(--space-4)',
                  marginTop: 'var(--space-6)',
                }}>
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 style={{
                  fontSize: '17px', fontWeight: 'bold',
                  borderBottom: '1px solid var(--border-light)',
                  paddingBottom: 'var(--space-2)', marginBottom: 'var(--space-3)',
                  marginTop: 'var(--space-6)',
                }}>
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 style={{
                  fontSize: '15px', fontWeight: 'bold',
                  marginBottom: 'var(--space-2)', marginTop: 'var(--space-4)',
                }}>
                  {children}
                </h3>
              ),
              h4: ({ children }) => (
                <h4 style={{
                  fontSize: '13px', fontWeight: 'bold',
                  marginBottom: 'var(--space-2)', marginTop: 'var(--space-3)',
                }}>
                  {children}
                </h4>
              ),
              p: ({ children }) => (
                <p style={{
                  fontSize: '13px', lineHeight: '1.75',
                  marginBottom: 'var(--space-3)',
                  color: 'var(--text)',
                }}>
                  {children}
                </p>
              ),
              ul: ({ children }) => (
                <ul style={{
                  fontSize: '13px', lineHeight: '1.75',
                  marginLeft: 'var(--space-6)',
                  marginBottom: 'var(--space-3)',
                }}>
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol style={{
                  fontSize: '13px', lineHeight: '1.75',
                  marginLeft: 'var(--space-6)',
                  marginBottom: 'var(--space-3)',
                }}>
                  {children}
                </ol>
              ),
              li: ({ children }) => (
                <li style={{ marginBottom: 'var(--space-1)' }}>{children}</li>
              ),
              table: ({ children }) => (
                <div style={{ overflowX: 'auto', marginBottom: 'var(--space-4)' }}>
                  <table style={{
                    borderCollapse: 'collapse',
                    width: '100%',
                    fontSize: '11px',
                  }}>
                    {children}
                  </table>
                </div>
              ),
              thead: ({ children }) => (
                <thead style={{ background: 'var(--grey-100)' }}>{children}</thead>
              ),
              th: ({ children }) => (
                <th style={{
                  border: '1px solid var(--border-medium)',
                  padding: '6px 10px',
                  textAlign: 'left',
                  fontWeight: 'bold',
                  fontSize: '11px',
                }}>
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td style={{
                  border: '1px solid var(--border-light)',
                  padding: '5px 10px',
                  fontSize: '11px',
                }}>
                  {children}
                </td>
              ),
              code: ({ children, className }) => {
                const isBlock = className?.includes('language-');
                if (isBlock) {
                  return (
                    <pre style={{
                      background: 'var(--grey-100)',
                      border: '1px solid var(--border-light)',
                      padding: 'var(--space-4)',
                      fontSize: '11px',
                      fontFamily: "'SF Mono', 'Cascadia Code', monospace",
                      overflowX: 'auto',
                      lineHeight: '1.5',
                      marginBottom: 'var(--space-4)',
                    }}>
                      <code>{children}</code>
                    </pre>
                  );
                }
                return (
                  <code style={{
                    background: 'var(--grey-100)',
                    padding: '1px 4px',
                    fontSize: '11px',
                    fontFamily: "'SF Mono', 'Cascadia Code', monospace",
                    border: '1px solid var(--border-light)',
                  }}>
                    {children}
                  </code>
                );
              },
              pre: ({ children }) => <>{children}</>,
              blockquote: ({ children }) => (
                <blockquote style={{
                  borderLeft: '3px solid var(--border-medium)',
                  paddingLeft: 'var(--space-4)',
                  margin: 'var(--space-3) 0',
                  color: 'var(--text-muted)',
                  fontStyle: 'italic',
                  fontSize: '12px',
                }}>
                  {children}
                </blockquote>
              ),
              hr: () => (
                <hr style={{
                  border: 'none',
                  borderTop: '1px solid var(--border-light)',
                  margin: 'var(--space-6) 0',
                }} />
              ),
              strong: ({ children }) => (
                <strong style={{ fontWeight: 'bold' }}>{children}</strong>
              ),
              a: ({ href, children }) => {
                if (href?.startsWith('#popup-')) {
                  const id = href.slice(7);
                  return (
                    <button
                      onClick={() => openPopup(id)}
                      style={{
                        background: 'none',
                        border: '1px solid currentColor',
                        borderRadius: '2px',
                        color: 'var(--primary)',
                        cursor: 'pointer',
                        fontSize: '9px',
                        fontFamily: 'var(--font-family)',
                        padding: '1px 5px',
                        marginLeft: '4px',
                        verticalAlign: 'middle',
                        opacity: 0.8,
                      }}
                    >
                      {children}
                    </button>
                  );
                }
                return (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--primary)', textDecoration: 'underline' }}
                  >
                    {children}
                  </a>
                );
              },
            }}
          >
            {activeContent == null
              ? 'Loading…'
              : portalStats
                ? interpolate(activeContent, buildTemplateVars(portalStats))
                : activeContent}
          </ReactMarkdown>
        </div>

        {/* Document footer */}
        <div style={{
          borderTop: '1px solid var(--border-light)',
          paddingTop: 'var(--space-4)',
          marginTop: 'var(--space-8)',
          fontSize: '9px',
          color: 'var(--text-disabled)',
          textAlign: 'center',
          lineHeight: '1.6',
        }}>
          CONFIDENTIAL - This document is the property of Nuke.<br />
          Session {sessionId.substring(0, 8)} | Viewer: {viewerName} ({viewerEmail})<br />
          All access logged and monitored. Distribution prohibited without written consent.
        </div>
      </div>

      {/* ── Popup Modal ────────────────────────────────────────────────────────────────────── */}
      {popup && (
        <div
          onClick={closePopup}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.55)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-4)',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--white)',
              border: '2px solid var(--border-medium)',
              maxWidth: '640px',
              width: '100%',
              maxHeight: '82vh',
              overflow: 'auto',
              padding: 'var(--space-8)',
              position: 'relative',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: 'var(--space-4)',
              borderBottom: '2px solid var(--border-medium)',
              paddingBottom: 'var(--space-3)',
            }}>
              <div style={{ fontSize: '15px', fontWeight: 'bold' }}>
                {POPUP_CONTENT[popup.id]?.title ?? popup.id}
              </div>
              <button
                onClick={closePopup}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '21px', color: 'var(--text-muted)',
                  lineHeight: 1, padding: '0 4px', marginLeft: 'var(--space-4)',
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            </div>

            {/* Content */}
            <div style={{ fontSize: '12px', lineHeight: '1.7' }}>
              {POPUP_CONTENT[popup.id]?.body ?? <p>Content coming soon.</p>}
            </div>

            {/* Reader Notes */}
            <div style={{
              marginTop: 'var(--space-6)',
              borderTop: '1px solid var(--border-light)',
              paddingTop: 'var(--space-4)',
            }}>
              <div style={{
                fontSize: '9px',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                color: 'var(--text-muted)',
                marginBottom: 'var(--space-2)',
              }}>
                Reader Notes
              </div>
              {popup.submitted ? (
                <div style={{ fontSize: '11px', color: 'var(--success)' }}>Note saved.</div>
              ) : (
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <textarea
                      value={popup.note}
                      onChange={e => setPopup(prev => prev ? { ...prev, note: e.target.value.slice(0, 150) } : null)}
                      placeholder="Your thoughts on this section..."
                      rows={2}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        border: '1px solid var(--border-medium)',
                        fontSize: '11px',
                        fontFamily: 'var(--font-family)',
                        resize: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                    <div style={{ fontSize: '9px', color: 'var(--text-disabled)', textAlign: 'right' }}>
                      {popup.note.length}/150
                    </div>
                  </div>
                  <button
                    onClick={submitPopupNote}
                    disabled={!popup.note.trim()}
                    style={{
                      padding: '6px 14px',
                      background: popup.note.trim() ? 'var(--text)' : 'var(--grey-300)',
                      color: 'var(--bg)',
                      border: 'none',
                      fontSize: '9px',
                      fontWeight: 'bold',
                      letterSpacing: '1px',
                      textTransform: 'uppercase',
                      cursor: popup.note.trim() ? 'pointer' : 'not-allowed',
                      fontFamily: 'var(--font-family)',
                      flexShrink: 0,
                      marginTop: '1px',
                    }}
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}