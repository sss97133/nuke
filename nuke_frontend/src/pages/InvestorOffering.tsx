import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { supabase } from '../lib/supabase';
import '../design-system.css';

// Import markdown files as raw strings via Vite
import teaserMd from '@docs/investor/N-ZERO_TEASER.md?raw';
import businessPlanMd from '@docs/investor/N-ZERO_BUSINESS_PLAN.md?raw';
import informationMemorandumMd from '@docs/investor/N-ZERO_INFORMATION_MEMORANDUM.md?raw';
import revenueModelMd from '@docs/investor/REVENUE_MODEL.md?raw';
import dataInventoryMd from '@docs/investor/DATA_INVENTORY.md?raw';
import technicalExhibitsMd from '@docs/investor/TECHNICAL_EXHIBITS.md?raw';

type DocTab = 'teaser' | 'business_plan' | 'information_memorandum' | 'revenue_model' | 'data_inventory' | 'technical_exhibits';

interface AccessLog {
  action: string;
  document?: string;
  metadata?: Record<string, unknown>;
}

const DOCUMENTS: Record<DocTab, { title: string; subtitle: string; content: string; pages: string }> = {
  teaser: {
    title: 'Executive Summary',
    subtitle: 'Pre-NDA distribution',
    content: teaserMd,
    pages: '~5 pp',
  },
  business_plan: {
    title: 'Business Plan',
    subtitle: 'Comprehensive business plan with appendices',
    content: businessPlanMd,
    pages: '~35 pp',
  },
  information_memorandum: {
    title: 'Information Memorandum',
    subtitle: 'Professional due-diligence document',
    content: informationMemorandumMd,
    pages: '~35 pp',
  },
  technical_exhibits: {
    title: 'Technical Exhibits',
    subtitle: 'Platform architecture, API specification, and data documentation',
    content: technicalExhibitsMd,
    pages: '~35 pp',
  },
  revenue_model: {
    title: 'Revenue Model',
    subtitle: 'Detailed revenue streams and projections',
    content: revenueModelMd,
    pages: '~4 pp',
  },
  data_inventory: {
    title: 'Data Inventory',
    subtitle: 'Live system data audit with source queries',
    content: dataInventoryMd,
    pages: '~8 pp',
  },
};

// Simple hash for access code verification (not security-critical - this is a draft portal)
const ACCESS_CODE_HASH = 'nzero2026';
const PORTAL_PROFILE_KEY = 'nzero_investor_portal_profile';

export default function InvestorOffering() {
  const [phase, setPhase] = useState<'gate' | 'acknowledge' | 'portal'>('gate');
  const [accessCode, setAccessCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [activeDoc, setActiveDoc] = useState<DocTab>('teaser');
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
        details: {
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

  // Log document switch
  useEffect(() => {
    if (phase === 'portal') {
      logAccess({ action: 'document_viewed', document: activeDoc });
    }
  }, [activeDoc, phase, logAccess]);

  const handleAccessCode = () => {
    if (accessCode.toLowerCase().trim() === ACCESS_CODE_HASH) {
      setPhase('acknowledge');
      logAccess({ action: 'access_code_accepted' });
      setCodeError('');
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
        <title>${doc.title} - N-Zero / Nuke Ltd</title>
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
          <strong>CONFIDENTIAL</strong> - N-Zero / Nuke Ltd<br/>
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
      const html = markdownToHtml(doc.content);
      contentDiv.innerHTML = html;
    }

    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  };

  // Simple markdown to HTML converter for PDF export
  function markdownToHtml(md: string): string {
    let html = md
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
    return (
      <div style={{
        padding: 'var(--space-6)',
        maxWidth: '500px',
        margin: '80px auto',
      }}>
        <div style={{
          background: 'var(--white)',
          border: '2px solid var(--border-medium)',
          padding: 'var(--space-8)',
        }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
            <div style={{
              fontSize: '8pt',
              letterSpacing: '3px',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginBottom: 'var(--space-2)',
            }}>
              NUKE LTD
            </div>
            <h1 style={{
              fontSize: '16pt',
              fontWeight: 'bold',
              margin: 0,
              letterSpacing: '1px',
            }}>
              N-ZERO
            </h1>
            <div style={{
              fontSize: '9pt',
              color: 'var(--text-muted)',
              marginTop: 'var(--space-2)',
            }}>
              Investment Offering Portal
            </div>
          </div>

          {/* Access Code Input */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <label style={{
              fontSize: '8pt',
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
                padding: '8px 12px',
                border: `2px solid ${codeError ? 'var(--error)' : 'var(--border-medium)'}`,
                fontFamily: 'var(--font-family)',
                fontSize: '10pt',
                background: 'var(--grey-50)',
                boxSizing: 'border-box',
              }}
              autoFocus
            />
            {codeError && (
              <div style={{ fontSize: '8pt', color: 'var(--error)', marginTop: 'var(--space-1)' }}>
                {codeError}
              </div>
            )}
          </div>

          <button
            onClick={handleAccessCode}
            style={{
              width: '100%',
              padding: '10px',
              background: '#1a1a1a',
              color: '#fff',
              border: '2px solid #1a1a1a',
              fontSize: '9pt',
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
            fontSize: '7pt',
            color: 'var(--text-disabled)',
            textAlign: 'center',
            marginTop: 'var(--space-4)',
            lineHeight: '1.5',
          }}>
            This portal contains confidential information.<br />
            Access is logged and monitored. Unauthorized access is prohibited.<br />
            Contact info@nukeltd.com for access credentials.
          </div>
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
            fontSize: '8pt',
            letterSpacing: '3px',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 'var(--space-1)',
          }}>
            N-ZERO / NUKE LTD
          </div>
          <h1 style={{
            fontSize: '14pt',
            fontWeight: 'bold',
            margin: '0 0 var(--space-6) 0',
            borderBottom: '2px solid var(--border-medium)',
            paddingBottom: 'var(--space-3)',
          }}>
            Confidentiality Acknowledgement
          </h1>

          {/* Viewer Info */}
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <div style={{ fontSize: '8pt', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 'var(--space-3)' }}>
              Viewer Information
            </div>
            <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
              <input
                placeholder="Full Name *"
                value={viewerName}
                onChange={e => setViewerName(e.target.value)}
                style={{
                  padding: '6px 10px', border: '1px solid var(--border-medium)',
                  fontSize: '9pt', fontFamily: 'var(--font-family)',
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
                  fontSize: '9pt', fontFamily: 'var(--font-family)',
                  background: 'var(--grey-50)',
                }}
              />
              <input
                placeholder="Organization (optional)"
                value={viewerOrg}
                onChange={e => setViewerOrg(e.target.value)}
                style={{
                  padding: '6px 10px', border: '1px solid var(--border-medium)',
                  fontSize: '9pt', fontFamily: 'var(--font-family)',
                  background: 'var(--grey-50)',
                }}
              />
            </div>
            <label style={{
              display: 'flex',
              gap: 'var(--space-2)',
              alignItems: 'center',
              marginTop: 'var(--space-3)',
              fontSize: '9pt',
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
            <div style={{ fontSize: '8pt', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 'var(--space-3)' }}>
              Please acknowledge the following:
            </div>

            {[
              { key: 'confidential' as const, text: 'I understand that the materials contained in this portal are CONFIDENTIAL and proprietary to Nuke Ltd.' },
              { key: 'noDistribute' as const, text: 'I agree NOT to copy, distribute, forward, or share any materials from this portal without prior written consent from Nuke Ltd.' },
              { key: 'noOffer' as const, text: 'I understand that these materials do NOT constitute an offer or solicitation to sell or purchase securities. No investment decision should be based solely on these materials.' },
              { key: 'understand' as const, text: 'I acknowledge that my access to this portal is logged, including my IP address, viewing duration, and document interactions, and I consent to this monitoring.' },
            ].map(({ key, text }) => (
              <label key={key} style={{
                display: 'flex',
                gap: 'var(--space-3)',
                alignItems: 'flex-start',
                marginBottom: 'var(--space-3)',
                fontSize: '9pt',
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
              background: allChecked && viewerName && viewerEmail ? '#1a1a1a' : 'var(--grey-400)',
              color: '#fff',
              border: '2px solid transparent',
              fontSize: '9pt',
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
            fontSize: '7pt',
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
      }}>
        <div>
          <div style={{ fontSize: '8pt', letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            N-ZERO INVESTOR DATA ROOM
          </div>
          <div style={{ fontSize: '7pt', color: 'var(--text-disabled)', marginTop: '2px' }}>
            Session: {sessionId.substring(0, 8)} | Viewer: {viewerName} | Since: {accessGrantedAt ? new Date(accessGrantedAt).toLocaleTimeString() : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          <div style={{
            fontSize: '7pt',
            padding: '3px 8px',
            background: '#e8f5e9',
            color: '#2e7d32',
            border: '1px solid #c8e6c9',
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
      }}>
        {(Object.entries(DOCUMENTS) as [DocTab, typeof DOCUMENTS[DocTab]][]).map(([key, d]) => (
          <button
            key={key}
            onClick={() => setActiveDoc(key)}
            style={{
              padding: '8px 16px',
              background: activeDoc === key ? 'var(--white)' : 'var(--grey-100)',
              border: activeDoc === key ? '2px solid var(--border-medium)' : '1px solid var(--border-light)',
              borderBottom: activeDoc === key ? '2px solid var(--white)' : 'none',
              marginBottom: activeDoc === key ? '-2px' : '0',
              fontSize: '8pt',
              fontWeight: activeDoc === key ? 'bold' : 'normal',
              cursor: 'pointer',
              fontFamily: 'var(--font-family)',
              letterSpacing: '0.5px',
            }}
          >
            {d.title}
            <span style={{ fontSize: '7pt', color: 'var(--text-disabled)', marginLeft: '6px' }}>
              {d.pages}
            </span>
          </button>
        ))}

        {/* Export PDF button */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
          <button
            onClick={handleExportPDF}
            disabled={exportRequested}
            style={{
              padding: '6px 14px',
              background: exportRequested ? 'var(--grey-200)' : '#1a1a1a',
              color: exportRequested ? 'var(--text-muted)' : '#fff',
              border: '1px solid var(--border-medium)',
              fontSize: '7pt',
              fontWeight: 'bold',
              letterSpacing: '1px',
              textTransform: 'uppercase',
              cursor: exportRequested ? 'default' : 'pointer',
              fontFamily: 'var(--font-family)',
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
        padding: 'var(--space-8) var(--space-10)',
        minHeight: '600px',
      }}>
        {/* Document title bar */}
        <div style={{
          fontSize: '7pt',
          color: 'var(--text-disabled)',
          borderBottom: '1px solid var(--border-light)',
          paddingBottom: 'var(--space-2)',
          marginBottom: 'var(--space-6)',
          display: 'flex',
          justifyContent: 'space-between',
        }}>
          <span>{doc.subtitle}</span>
          <span>Nuke Ltd - {new Date().toLocaleDateString()}</span>
        </div>

        {/* Rendered Markdown */}
        <div className="investor-doc-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => (
                <h1 style={{
                  fontSize: '16pt', fontWeight: 'bold',
                  borderBottom: '2px solid var(--border-medium)',
                  paddingBottom: 'var(--space-2)', marginBottom: 'var(--space-4)',
                  marginTop: 'var(--space-6)',
                }}>
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 style={{
                  fontSize: '13pt', fontWeight: 'bold',
                  borderBottom: '1px solid var(--border-light)',
                  paddingBottom: 'var(--space-2)', marginBottom: 'var(--space-3)',
                  marginTop: 'var(--space-6)',
                }}>
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 style={{
                  fontSize: '11pt', fontWeight: 'bold',
                  marginBottom: 'var(--space-2)', marginTop: 'var(--space-4)',
                }}>
                  {children}
                </h3>
              ),
              h4: ({ children }) => (
                <h4 style={{
                  fontSize: '10pt', fontWeight: 'bold',
                  marginBottom: 'var(--space-2)', marginTop: 'var(--space-3)',
                }}>
                  {children}
                </h4>
              ),
              p: ({ children }) => (
                <p style={{
                  fontSize: '9pt', lineHeight: '1.7',
                  marginBottom: 'var(--space-3)',
                }}>
                  {children}
                </p>
              ),
              ul: ({ children }) => (
                <ul style={{
                  fontSize: '9pt', lineHeight: '1.7',
                  marginLeft: 'var(--space-6)',
                  marginBottom: 'var(--space-3)',
                }}>
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol style={{
                  fontSize: '9pt', lineHeight: '1.7',
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
                    fontSize: '8pt',
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
                  fontSize: '8pt',
                }}>
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td style={{
                  border: '1px solid var(--border-light)',
                  padding: '5px 10px',
                  fontSize: '8pt',
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
                      fontSize: '8pt',
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
                    fontSize: '8pt',
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
                  fontSize: '9pt',
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
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--primary)', textDecoration: 'underline' }}
                >
                  {children}
                </a>
              ),
            }}
          >
            {doc.content}
          </ReactMarkdown>
        </div>

        {/* Document footer */}
        <div style={{
          borderTop: '1px solid var(--border-light)',
          paddingTop: 'var(--space-4)',
          marginTop: 'var(--space-8)',
          fontSize: '7pt',
          color: 'var(--text-disabled)',
          textAlign: 'center',
          lineHeight: '1.6',
        }}>
          CONFIDENTIAL - This document is the property of Nuke Ltd.<br />
          Session {sessionId.substring(0, 8)} | Viewer: {viewerName} ({viewerEmail})<br />
          All access logged and monitored. Distribution prohibited without written consent.
        </div>
      </div>
    </div>
  );
}
