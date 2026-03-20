import { useState, useEffect, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { supabase } from '../../lib/supabase';
import KeyFiguresWithCharts from './KeyFiguresWithCharts';
import TechStackStrip from './TechStackStrip';

type DocTab = 'teaser' | 'business_plan' | 'information_memorandum' | 'revenue_model' | 'data_inventory' | 'technical_exhibits';

const markdownLoaders: Record<DocTab, () => Promise<string>> = {
  teaser: () => import('@docs/investor/NUKE_TEASER.md?raw').then(m => m.default),
  business_plan: () => import('@docs/investor/NUKE_BUSINESS_PLAN.md?raw').then(m => m.default),
  information_memorandum: () => import('@docs/investor/NUKE_INFORMATION_MEMORANDUM.md?raw').then(m => m.default),
  revenue_model: () => import('@docs/investor/REVENUE_MODEL.md?raw').then(m => m.default),
  data_inventory: () => import('@docs/investor/DATA_INVENTORY.md?raw').then(m => m.default),
  technical_exhibits: () => import('@docs/investor/TECHNICAL_EXHIBITS.md?raw').then(m => m.default),
};

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

interface Props {
  organizationId: string;
  organizationName: string;
  isOwner: boolean;
}

export default function OrganizationOfferingTab({ organizationId, organizationName, isOwner }: Props) {
  const [activeDoc, setActiveDoc] = useState<DocTab>('teaser');
  const [activeContent, setActiveContent] = useState<string | null>(null);
  const [sessionId] = useState(() => crypto.randomUUID());

  const logAccess = useCallback(async (action: string, document?: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('system_logs').insert({
        log_type: 'investor_portal',
        message: action,
        details: {
          session_id: sessionId,
          document: document || null,
          organization_id: organizationId,
          user_id: user?.id || 'anonymous',
          source: 'org_profile',
          timestamp: new Date().toISOString(),
        },
      });
    } catch {
      // Silent fail
    }
  }, [sessionId, organizationId]);

  // Load markdown content lazily on tab switch
  useEffect(() => {
    let cancelled = false;
    setActiveContent(null);
    markdownLoaders[activeDoc]().then(content => {
      if (!cancelled) setActiveContent(content);
    });
    return () => { cancelled = true; };
  }, [activeDoc]);

  useEffect(() => {
    logAccess('document_viewed', activeDoc);
  }, [activeDoc, logAccess]);

  const handleExportPDF = async () => {
    await logAccess('pdf_export_requested', activeDoc);
    const doc = DOCUMENTS[activeDoc];
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${doc.title} - ${organizationName}</title>
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
          code { font-family: 'Courier New', monospace; font-size: 9pt; background: #f5f5f5; padding: 1px 4px; }
          pre { background: #f5f5f5; padding: 12px; font-size: 9pt; overflow-x: auto; border: 1px solid #ddd; }
          hr { border: none; border-top: 1px solid #ccc; margin: 20px 0; }
          .header-stamp {
            font-size: 8pt; color: #666; border: 1px solid #ccc;
            padding: 8px 12px; margin-bottom: 20px; background: #fafafa;
          }
          .watermark {
            position: fixed; bottom: 20px; right: 20px;
            font-size: 8pt; color: #999;
          }
          @media print { body { padding: 20px; } .no-print { display: none; } }
        </style>
      </head>
      <body>
        <div class="header-stamp">
          <strong>CONFIDENTIAL</strong> - ${organizationName}<br/>
          Document: ${doc.title}<br/>
          Generated: ${new Date().toISOString()}<br/>
        </div>
        <div id="content"></div>
        <div class="watermark">CONFIDENTIAL - ${new Date().toLocaleDateString()}</div>
      </body>
      </html>
    `);

    const contentDiv = printWindow.document.getElementById('content');
    if (contentDiv) {
      contentDiv.innerHTML = markdownToHtml(activeContent ?? '');
    }
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  };

  function markdownToHtml(md: string): string {
    const html = md
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/```[\s\S]*?```/g, (match) => {
        const code = match.slice(3, -3).replace(/^\w*\n/, '');
        return `<pre><code>${code}</code></pre>`;
      })
      .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^---$/gm, '<hr/>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/^\|(.+)\|$/gm, (match) => {
        const cells = match.split('|').filter(c => c.trim());
        if (cells.every(c => /^[\s-:]+$/.test(c))) return '';
        return '<tr>' + cells.map(c => `<td>${c.trim()}</td>`).join('') + '</tr>';
      })
      .replace(/((?:<tr>.*<\/tr>\n?)+)/g, '<table>$1</table>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br/>');
    return `<p>${html}</p>`;
  }

  const doc = DOCUMENTS[activeDoc];

  const teaserParts = useMemo(() => {
    if (activeDoc !== 'teaser' || !activeContent) return null;
    const oppStart = activeContent.indexOf('### The Opportunity');
    const keyStart = activeContent.indexOf('### Key Figures');
    if (keyStart === -1) return { intro: activeContent, middle: '', after: '', hasKeyFigures: false };
    const keyEnd = activeContent.indexOf('\n---\n', keyStart);
    const afterStart = keyEnd === -1 ? activeContent.length : keyEnd + 1;
    const intro = oppStart === -1 ? activeContent.slice(0, keyStart).trimEnd() : activeContent.slice(0, oppStart).trimEnd();
    const middle = oppStart === -1 ? '' : activeContent.slice(oppStart, keyStart).trimEnd();
    return {
      intro,
      middle,
      after: activeContent.slice(afterStart).trimStart(),
      hasKeyFigures: true,
    };
  }, [activeDoc, activeContent]);

  const markdownComponents = {
    h1: ({ children }: { children?: React.ReactNode }) => (
      <h1 style={{ fontSize: '21px', fontWeight: 'bold', borderBottom: '2px solid var(--border-medium)', paddingBottom: 'var(--space-2)', marginBottom: 'var(--space-4)', marginTop: 'var(--space-6)' }}>{children}</h1>
    ),
    h2: ({ children }: { children?: React.ReactNode }) => (
      <h2 style={{ fontSize: '17px', fontWeight: 'bold', borderBottom: '1px solid var(--border-light)', paddingBottom: 'var(--space-2)', marginBottom: 'var(--space-3)', marginTop: 'var(--space-6)' }}>{children}</h2>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
      <h3 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: 'var(--space-2)', marginTop: 'var(--space-4)' }}>{children}</h3>
    ),
    p: ({ children }: { children?: React.ReactNode }) => (
      <p style={{ fontSize: '12px', lineHeight: '1.7', marginBottom: 'var(--space-3)' }}>{children}</p>
    ),
    ul: ({ children }: { children?: React.ReactNode }) => (
      <ul style={{ fontSize: '12px', lineHeight: '1.7', marginLeft: 'var(--space-6)', marginBottom: 'var(--space-3)' }}>{children}</ul>
    ),
    ol: ({ children }: { children?: React.ReactNode }) => (
      <ol style={{ fontSize: '12px', lineHeight: '1.7', marginLeft: 'var(--space-6)', marginBottom: 'var(--space-3)' }}>{children}</ol>
    ),
    li: ({ children }: { children?: React.ReactNode }) => (
      <li style={{ marginBottom: 'var(--space-1)' }}>{children}</li>
    ),
    table: ({ children }: { children?: React.ReactNode }) => (
      <div style={{ overflowX: 'auto', marginBottom: 'var(--space-4)' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '11px' }}>{children}</table>
      </div>
    ),
    thead: ({ children }: { children?: React.ReactNode }) => (
      <thead style={{ background: 'var(--grey-100)' }}>{children}</thead>
    ),
    th: ({ children }: { children?: React.ReactNode }) => (
      <th style={{ border: '1px solid var(--border-medium)', padding: '6px 10px', textAlign: 'left', fontWeight: 'bold', fontSize: '11px' }}>{children}</th>
    ),
    td: ({ children }: { children?: React.ReactNode }) => (
      <td style={{ border: '1px solid var(--border-light)', padding: '5px 10px', fontSize: '11px' }}>{children}</td>
    ),
    code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
      if (className?.includes('language-')) {
        return (
          <pre style={{ background: 'var(--grey-100)', border: '1px solid var(--border-light)', padding: 'var(--space-4)', fontSize: '11px', fontFamily: "'Courier New', monospace", overflowX: 'auto', lineHeight: '1.5', marginBottom: 'var(--space-4)' }}>
            <code>{children}</code>
          </pre>
        );
      }
      return (
        <code style={{ background: 'var(--grey-100)', padding: '1px 4px', fontSize: '11px', fontFamily: "'Courier New', monospace", border: '1px solid var(--border-light)' }}>{children}</code>
      );
    },
    pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote style={{ borderLeft: '3px solid var(--border-medium)', paddingLeft: 'var(--space-4)', margin: 'var(--space-3) 0', color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '12px' }}>{children}</blockquote>
    ),
    hr: () => <hr style={{ border: 'none', borderTop: '1px solid var(--border-light)', margin: 'var(--space-6) 0' }} />,
    strong: ({ children }: { children?: React.ReactNode }) => <strong style={{ fontWeight: 'bold' }}>{children}</strong>,
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>{children}</a>
    ),
  };

  return (
    <div style={{ padding: 'var(--space-4)' }}>
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
              fontSize: '11px',
              fontWeight: activeDoc === key ? 'bold' : 'normal',
              cursor: 'pointer',
              fontFamily: 'var(--font-family)',
              letterSpacing: '0.5px',
            }}
          >
            {d.title}
            <span style={{ fontSize: '9px', color: 'var(--text-disabled)', marginLeft: '6px' }}>
              {d.pages}
            </span>
          </button>
        ))}

        {/* Export PDF button */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
          <button
            onClick={handleExportPDF}
            style={{
              padding: '6px 14px',
              background: '#1a1a1a',
              color: '#fff',
              border: '1px solid var(--border-medium)',
              fontSize: '9px',
              fontWeight: 'bold',
              letterSpacing: '1px',
              textTransform: 'uppercase',
              cursor: 'pointer',
              fontFamily: 'var(--font-family)',
            }}
          >
            Export PDF
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
        <div style={{
          fontSize: '9px',
          color: 'var(--text-disabled)',
          borderBottom: '1px solid var(--border-light)',
          paddingBottom: 'var(--space-2)',
          marginBottom: 'var(--space-6)',
          display: 'flex',
          justifyContent: 'space-between',
        }}>
          <span>{doc.subtitle}</span>
          <span>{organizationName} - {new Date().toLocaleDateString()}</span>
        </div>

        <div className="investor-doc-content">
          {teaserParts?.hasKeyFigures ? (
            <>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{teaserParts.intro}</ReactMarkdown>
              <TechStackStrip />
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{teaserParts.middle}</ReactMarkdown>
              <KeyFiguresWithCharts />
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{teaserParts.after}</ReactMarkdown>
            </>
          ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {activeContent ?? 'Loading…'}
          </ReactMarkdown>
          )}
        </div>

        <div style={{
          borderTop: '1px solid var(--border-light)',
          paddingTop: 'var(--space-4)',
          marginTop: 'var(--space-8)',
          fontSize: '9px',
          color: 'var(--text-disabled)',
          textAlign: 'center',
          lineHeight: '1.6',
        }}>
          CONFIDENTIAL - This document is the property of {organizationName}.<br />
          All access logged and monitored.
        </div>
      </div>
    </div>
  );
}
