import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface ShareClass {
  id: string;
  share_class_name: string;
  share_class_code?: string;
  authorized_shares?: number;
  issued_shares?: number;
  outstanding_shares?: number;
  voting_rights?: string;
  votes_per_share?: number;
  dividend_rights?: string;
  liquidation_preference?: number;
  is_convertible?: boolean;
  description?: string;
}

interface RelatedPerson {
  id: string;
  person_type: string[];
  full_legal_name: string;
  title?: string;
  ownership_percentage?: number;
  share_count?: number;
  share_class?: string;
  is_current: boolean;
  start_date?: string;
  prior_experience?: string;
}

interface Offering {
  id: string;
  federal_exemption: string[];
  security_type?: string;
  total_offering_amount: number;
  amount_sold?: number;
  price_per_share?: number;
  status: string;
  offering_start_date?: string;
  offering_end_date?: string;
  total_investors?: number;
  accredited_investors?: number;
  non_accredited_investors?: number;
}

interface FinancialStatement {
  id: string;
  statement_type: string;
  period_end_date: string;
  is_audited: boolean;
  is_reviewed: boolean;
  auditor_name?: string;
  total_assets?: number;
  total_liabilities?: number;
  revenue?: number;
  net_income?: number;
}

interface Props {
  organizationId: string;
  organization: any;
  isOwner: boolean;
  canEdit: boolean;
}

const OrganizationLegalTab: React.FC<Props> = ({ organizationId, organization, isOwner, canEdit }) => {
  const [shareClasses, setShareClasses] = useState<ShareClass[]>([]);
  const [relatedPersons, setRelatedPersons] = useState<RelatedPerson[]>([]);
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [financials, setFinancials] = useState<FinancialStatement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [organizationId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [shareRes, personRes, offeringRes, financialRes] = await Promise.all([
        supabase.from('business_share_classes').select('*').eq('business_id', organizationId),
        supabase.from('business_related_persons').select('*').eq('business_id', organizationId).eq('is_current', true),
        supabase.from('business_offerings').select('*').eq('business_id', organizationId).order('created_at', { ascending: false }),
        supabase.from('business_financial_statements').select('*').eq('business_id', organizationId).order('period_end_date', { ascending: false }).limit(4),
      ]);

      if (shareRes.data) setShareClasses(shareRes.data);
      if (personRes.data) setRelatedPersons(personRes.data);
      if (offeringRes.data) setOfferings(offeringRes.data);
      if (financialRes.data) setFinancials(financialRes.data);
    } catch (err) {
      console.error('Error loading legal data:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (n: number | null | undefined): string => {
    if (typeof n !== 'number') return '-';
    return n.toLocaleString();
  };

  const formatCurrency = (n: number | null | undefined): string => {
    if (typeof n !== 'number') return '-';
    return `$${n.toLocaleString()}`;
  };

  const formatPercent = (n: number | null | undefined): string => {
    if (typeof n !== 'number') return '-';
    return `${n.toFixed(1)}%`;
  };

  const formatDate = (d: string | null | undefined): string => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString();
  };

  const personTypeLabels: Record<string, string> = {
    executive_officer: 'Executive',
    director: 'Director',
    beneficial_owner: 'Owner',
    promoter: 'Promoter',
  };

  if (loading) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading legal information...
      </div>
    );
  }

  const hasNoData = shareClasses.length === 0 && relatedPersons.length === 0 && offerings.length === 0;

  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Incorporation Details */}
      <div className="card">
        <div className="card-header" style={{ fontSize: '11pt', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '14pt' }}>🏛️</span>
          Corporate Structure
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>Legal Name</div>
              <div style={{ fontSize: '10pt', fontWeight: 600 }}>{organization.legal_name || organization.business_name}</div>
            </div>
            <div>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>Jurisdiction</div>
              <div style={{ fontSize: '10pt', fontWeight: 600 }}>{organization.incorporation_jurisdiction || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>Year Incorporated</div>
              <div style={{ fontSize: '10pt', fontWeight: 600 }}>{organization.year_incorporated || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>NAICS Code</div>
              <div style={{ fontSize: '10pt', fontWeight: 600 }}>{organization.naics_code || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>Revenue Range</div>
              <div style={{ fontSize: '10pt', fontWeight: 600 }}>
                {organization.revenue_range?.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) || '-'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>SEC Filer</div>
              <div style={{ fontSize: '10pt', fontWeight: 600 }}>
                {organization.is_sec_filer ? (
                  <span style={{ color: 'var(--success)' }}>Yes {organization.cik_number && `(CIK: ${organization.cik_number})`}</span>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>No</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Cap Table / Share Classes */}
      <div className="card">
        <div className="card-header" style={{ fontSize: '11pt', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '14pt' }}>📊</span>
          Capitalization Table
          {shareClasses.length > 0 && (
            <span style={{ marginLeft: 'auto', fontSize: '9pt', color: 'var(--text-muted)', fontWeight: 400 }}>
              {shareClasses.reduce((sum, sc) => sum + (sc.outstanding_shares || 0), 0).toLocaleString()} total shares outstanding
            </span>
          )}
        </div>
        <div className="card-body">
          {shareClasses.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '9pt', textAlign: 'center', padding: '20px' }}>
              No share classes defined
              {canEdit && (
                <div style={{ marginTop: '8px' }}>
                  <button className="button button-secondary" style={{ fontSize: '9pt' }}>
                    + Add Share Class
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: '9pt', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>Class</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>Authorized</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>Outstanding</th>
                    <th style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>Voting</th>
                    <th style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>Liq. Pref</th>
                  </tr>
                </thead>
                <tbody>
                  {shareClasses.map((sc) => (
                    <tr key={sc.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 600 }}>{sc.share_class_name}</div>
                        {sc.share_class_code && (
                          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>{sc.share_class_code}</div>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace' }}>
                        {formatNumber(sc.authorized_shares)}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace' }}>
                        {formatNumber(sc.outstanding_shares)}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        {sc.voting_rights === 'full' && <span title="Full voting rights">✓</span>}
                        {sc.voting_rights === 'none' && <span style={{ color: 'var(--text-muted)' }}>-</span>}
                        {sc.voting_rights === 'limited' && <span title="Limited voting">◐</span>}
                        {sc.voting_rights === 'super' && <span title="Super voting">✓✓</span>}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontFamily: 'monospace' }}>
                        {sc.liquidation_preference ? `${sc.liquidation_preference}x` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Officers, Directors & Beneficial Owners */}
      <div className="card">
        <div className="card-header" style={{ fontSize: '11pt', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '14pt' }}>👥</span>
          Officers, Directors & Beneficial Owners
        </div>
        <div className="card-body">
          {relatedPersons.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '9pt', textAlign: 'center', padding: '20px' }}>
              No related persons disclosed
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {relatedPersons.map((person) => (
                <div
                  key={person.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px',
                    background: 'var(--surface-elevated)',
                    borderRadius: '8px',
                  }}
                >
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '14pt',
                  }}>
                    {person.full_legal_name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '10pt' }}>{person.full_legal_name}</div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                      {person.title || person.person_type?.map(t => personTypeLabels[t] || t).join(', ')}
                    </div>
                  </div>
                  {person.ownership_percentage && (
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '12pt', fontWeight: 700, color: 'var(--accent)' }}>
                        {formatPercent(person.ownership_percentage)}
                      </div>
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                        {formatNumber(person.share_count)} shares
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Active Offerings */}
      {offerings.length > 0 && (
        <div className="card">
          <div className="card-header" style={{ fontSize: '11pt', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14pt' }}>💰</span>
            Securities Offerings
          </div>
          <div className="card-body">
            {offerings.map((offering) => (
              <div
                key={offering.id}
                style={{
                  padding: '16px',
                  background: offering.status === 'active' ? 'var(--success-bg)' : 'var(--surface-elevated)',
                  borderRadius: '8px',
                  marginBottom: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '11pt' }}>
                      {offering.federal_exemption?.join(', ').toUpperCase() || 'Private Offering'}
                    </div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                      {offering.security_type?.replace(/_/g, ' ')}
                      {offering.price_per_share && ` @ ${formatCurrency(offering.price_per_share)}/share`}
                    </div>
                  </div>
                  <div style={{
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '8pt',
                    fontWeight: 600,
                    background: offering.status === 'active' ? 'var(--success)' : 'var(--text-muted)',
                    color: 'white',
                  }}>
                    {offering.status?.toUpperCase()}
                  </div>
                </div>

                {/* Progress bar */}
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8pt', marginBottom: '4px' }}>
                    <span>{formatCurrency(offering.amount_sold)} raised</span>
                    <span>{formatCurrency(offering.total_offering_amount)} goal</span>
                  </div>
                  <div style={{
                    height: '8px',
                    background: 'var(--border)',
                    borderRadius: '4px',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.min(100, ((offering.amount_sold || 0) / offering.total_offering_amount) * 100)}%`,
                      background: 'var(--accent)',
                      borderRadius: '4px',
                    }} />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '16px', fontSize: '9pt' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Investors: </span>
                    <span style={{ fontWeight: 600 }}>{offering.total_investors || 0}</span>
                  </div>
                  {offering.accredited_investors !== undefined && (
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Accredited: </span>
                      <span style={{ fontWeight: 600 }}>{offering.accredited_investors}</span>
                    </div>
                  )}
                  {offering.offering_end_date && (
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Ends: </span>
                      <span style={{ fontWeight: 600 }}>{formatDate(offering.offering_end_date)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Financial Statements */}
      {financials.length > 0 && (
        <div className="card">
          <div className="card-header" style={{ fontSize: '11pt', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14pt' }}>📈</span>
            Financial Statements
          </div>
          <div className="card-body">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: '9pt', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>Period</th>
                    <th style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>Type</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>Revenue</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>Net Income</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>Assets</th>
                    <th style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>Audit</th>
                  </tr>
                </thead>
                <tbody>
                  {financials.map((fs) => (
                    <tr key={fs.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td style={{ padding: '10px 12px' }}>{formatDate(fs.period_end_date)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        {fs.statement_type?.replace(/_/g, ' ')}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace' }}>
                        {formatCurrency(fs.revenue)}
                      </td>
                      <td style={{
                        padding: '10px 12px',
                        textAlign: 'right',
                        fontFamily: 'monospace',
                        color: (fs.net_income || 0) >= 0 ? 'var(--success)' : 'var(--error)',
                      }}>
                        {formatCurrency(fs.net_income)}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace' }}>
                        {formatCurrency(fs.total_assets)}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        {fs.is_audited ? (
                          <span style={{ color: 'var(--success)' }} title={`Audited by ${fs.auditor_name || 'CPA'}`}>✓ Audited</span>
                        ) : fs.is_reviewed ? (
                          <span style={{ color: 'var(--warning)' }}>Reviewed</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>Unaudited</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Risk Factors */}
      {organization.risk_factors && (
        <div className="card">
          <div className="card-header" style={{ fontSize: '11pt', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14pt' }}>⚠️</span>
            Risk Factors
          </div>
          <div className="card-body">
            <div style={{ fontSize: '9pt', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {organization.risk_factors}
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {hasNoData && !organization.incorporation_jurisdiction && (
        <div style={{
          textAlign: 'center',
          padding: '40px 20px',
          color: 'var(--text-muted)',
          background: 'var(--surface-elevated)',
          borderRadius: '8px',
        }}>
          <div style={{ fontSize: '32pt', marginBottom: '12px' }}>📋</div>
          <div style={{ fontSize: '11pt', fontWeight: 600, marginBottom: '8px' }}>
            No Legal Information Available
          </div>
          <div style={{ fontSize: '9pt', maxWidth: '400px', margin: '0 auto' }}>
            This organization hasn't disclosed corporate structure, ownership, or financial information yet.
          </div>
          {canEdit && (
            <button
              className="button button-primary"
              style={{ marginTop: '16px', fontSize: '9pt' }}
            >
              Add Legal Information
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default OrganizationLegalTab;
