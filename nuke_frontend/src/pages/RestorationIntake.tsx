/**
 * Restoration Intake - Business Dashboard
 *
 * Telegram-based photo intake for restoration shops.
 * Allows bosses to:
 * 1. Claim/create their shop
 * 2. Generate invite codes for technicians
 * 3. View incoming photo submissions
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

interface Business {
  id: string;
  business_name: string;
  business_type: string;
  city?: string;
  state?: string;
  phone?: string;
}

interface InviteCode {
  id: string;
  code: string;
  role_type: string;
  max_uses: number;
  uses_count: number;
  created_at: string;
  expires_at?: string;
  is_active: boolean;
  metadata?: Record<string, any>;
}

interface Technician {
  id: string;
  telegram_id: number;
  telegram_username?: string;
  display_name?: string;
  business_id?: string;
  invite_code_used?: string;
  onboarded_at?: string;
  last_active_at?: string;
  active_vehicle_id?: string;
  active_vin?: string;
  status: string;
}

interface WorkSubmission {
  id: string;
  telegram_technician_id: string;
  detected_vehicle_id?: string;
  photo_urls: string[];
  storage_paths?: string[];
  detected_work_type?: string;
  detected_description?: string;
  message_text?: string;
  confidence_score?: number;
  ai_interpretation?: Record<string, any>;
  received_at: string;
  processing_status: string;
  technician?: Technician;
  vehicle?: {
    id: string;
    year?: number;
    make?: string;
    model?: string;
    vin?: string;
  };
}

type TabType = 'setup' | 'invites' | 'submissions';

export default function RestorationIntake() {
  const navigate = useNavigate();
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('submissions');

  // Business state
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [business, setBusiness] = useState<Business | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [businessCity, setBusinessCity] = useState('');
  const [businessState, setBusinessState] = useState('');
  const [businessPhone, setBusinessPhone] = useState('');
  const [submittingBusiness, setSubmittingBusiness] = useState(false);

  // Invite codes state
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [technicians, setTechnicians] = useState<Technician[]>([]);

  // Submissions state
  const [submissions, setSubmissions] = useState<WorkSubmission[]>([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [selectedSubmission, setSelectedSubmission] = useState<WorkSubmission | null>(null);

  // Load initial data
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        loadBusinessData(session.user.id);
      } else {
        setLoading(false);
      }
    });
  }, []);

  const loadBusinessData = useCallback(async (userId: string) => {
    try {
      // Get all businesses user manages
      const { data: memberships } = await supabase
        .from('organization_contributors')
        .select('organization_id, role')
        .eq('user_id', userId)
        .eq('status', 'active')
        .in('role', ['owner', 'admin']);

      if (memberships && memberships.length > 0) {
        const orgIds = memberships.map(m => m.organization_id);

        // Load all business details
        const { data: bizList } = await supabase
          .from('businesses')
          .select('id, business_name, business_type, city, state, phone')
          .in('id', orgIds)
          .order('business_name');

        if (bizList && bizList.length > 0) {
          setBusinesses(bizList);
          // Auto-select first business
          setBusiness(bizList[0]);
          // Load data for first business
          await Promise.all([
            loadInviteCodes(bizList[0].id),
            loadTechnicians(bizList[0].id),
            loadSubmissions(bizList[0].id)
          ]);
        }
      }
    } catch (err) {
      console.error('Error loading business data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadInviteCodes = async (businessId: string) => {
    const { data, error } = await supabase
      .from('business_invite_codes')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setInviteCodes(data);
    }
  };

  const loadTechnicians = async (businessId: string) => {
    const { data, error } = await supabase
      .from('telegram_technicians')
      .select('*')
      .eq('business_id', businessId)
      .order('onboarded_at', { ascending: false });

    if (!error && data) {
      setTechnicians(data.map(t => ({ ...t, status: 'active' })));
    }
  };

  const loadSubmissions = async (businessId: string) => {
    setSubmissionsLoading(true);
    try {
      const { data, error } = await supabase
        .from('telegram_work_submissions')
        .select(`
          *,
          technician:telegram_technicians(id, telegram_id, telegram_username, display_name),
          vehicle:vehicles(id, year, make, model, vin)
        `)
        .eq('business_id', businessId)
        .order('received_at', { ascending: false })
        .limit(100);

      if (!error && data) {
        setSubmissions(data);
      }
    } finally {
      setSubmissionsLoading(false);
    }
  };

  const handleCreateBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user?.id || !businessName.trim()) return;

    setSubmittingBusiness(true);
    try {
      // Create business
      const { data: newBiz, error: bizError } = await supabase
        .from('businesses')
        .insert({
          business_name: businessName.trim(),
          business_type: 'restoration_shop',
          city: businessCity.trim() || null,
          state: businessState.trim() || null,
          phone: businessPhone.trim() || null,
          discovered_by: session.user.id,
          uploaded_by: session.user.id,
          is_public: true,
          status: 'active',
          verification_level: 'unverified'
        })
        .select()
        .single();

      if (bizError) throw bizError;

      // Link user as owner
      await supabase.from('organization_contributors').insert({
        organization_id: newBiz.id,
        user_id: session.user.id,
        role: 'owner',
        contribution_count: 1,
        status: 'active'
      });

      setBusiness(newBiz);
      setActiveTab('invites');
    } catch (err: any) {
      alert(`Error creating business: ${err.message}`);
    } finally {
      setSubmittingBusiness(false);
    }
  };

  const handleGenerateCode = async () => {
    if (!business?.id) return;

    setGeneratingCode(true);
    try {
      const { data, error } = await supabase.rpc('generate_invite_code', {
        p_business_id: business.id,
        p_created_by: session.user.id,
        p_role_type: 'technician',
        p_max_uses: 10,
        p_expires_days: 30
      });

      if (error) throw error;

      await loadInviteCodes(business.id);
    } catch (err: any) {
      alert(`Error generating code: ${err.message}`);
    } finally {
      setGeneratingCode(false);
    }
  };

  const handleRevokeCode = async (codeId: string) => {
    if (!confirm('Revoke this invite code? It will no longer be usable.')) return;

    try {
      await supabase
        .from('business_invite_codes')
        .update({ is_active: false })
        .eq('id', codeId);

      if (business?.id) {
        await loadInviteCodes(business.id);
      }
    } catch (err: any) {
      alert(`Error revoking code: ${err.message}`);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const handleSwitchBusiness = async (businessId: string) => {
    const selectedBiz = businesses.find(b => b.id === businessId);
    if (!selectedBiz) return;

    setBusiness(selectedBiz);
    setSubmissions([]);
    setInviteCodes([]);
    setTechnicians([]);

    await Promise.all([
      loadInviteCodes(businessId),
      loadTechnicians(businessId),
      loadSubmissions(businessId)
    ]);
  };

  // Loading state
  if (loading) {
    return (
      <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-muted)', fontSize: '8pt' }}>
        Loading...
      </div>
    );
  }

  // Not logged in
  if (!session) {
    return (
      <div style={{ padding: 'var(--space-6)', maxWidth: '480px', margin: '0 auto' }}>
        <div className="card">
          <div className="card-header">
            <h1 style={{ margin: 0, fontSize: '12pt', fontWeight: 700 }}>Restoration Intake</h1>
            <p style={{ margin: '4px 0 0', fontSize: '8pt', color: 'var(--text-muted)' }}>
              Telegram-based photo intake for restoration shops
            </p>
          </div>
          <div className="card-body" style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '8pt', marginBottom: 'var(--space-4)' }}>
              Sign in to set up your shop and start receiving work photos from your technicians.
            </p>
            <button
              onClick={() => navigate('/login')}
              className="button button-primary"
              style={{ fontSize: '8pt' }}
            >
              Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  // No business linked yet - show setup
  if (!business) {
    return (
      <div style={{ padding: 'var(--space-6)', maxWidth: '560px', margin: '0 auto' }}>
        <div className="card">
          <div className="card-header">
            <h1 style={{ margin: 0, fontSize: '12pt', fontWeight: 700 }}>Set Up Your Shop</h1>
            <p style={{ margin: '4px 0 0', fontSize: '8pt', color: 'var(--text-muted)' }}>
              Create a profile for your restoration shop to start receiving work photos
            </p>
          </div>
          <div className="card-body">
            <form onSubmit={handleCreateBusiness}>
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <label style={{ display: 'block', fontSize: '8pt', fontWeight: 700, marginBottom: 'var(--space-1)' }}>
                  Shop Name *
                </label>
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  required
                  className="form-input"
                  style={{ width: '100%', fontSize: '8pt' }}
                  placeholder="e.g., Desert Performance Restorations"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '8pt', fontWeight: 700, marginBottom: 'var(--space-1)' }}>
                    City
                  </label>
                  <input
                    type="text"
                    value={businessCity}
                    onChange={(e) => setBusinessCity(e.target.value)}
                    className="form-input"
                    style={{ width: '100%', fontSize: '8pt' }}
                    placeholder="Phoenix"
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '8pt', fontWeight: 700, marginBottom: 'var(--space-1)' }}>
                    State
                  </label>
                  <input
                    type="text"
                    value={businessState}
                    onChange={(e) => setBusinessState(e.target.value)}
                    className="form-input"
                    style={{ width: '100%', fontSize: '8pt' }}
                    placeholder="AZ"
                    maxLength={2}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 'var(--space-5)' }}>
                <label style={{ display: 'block', fontSize: '8pt', fontWeight: 700, marginBottom: 'var(--space-1)' }}>
                  Phone
                </label>
                <input
                  type="tel"
                  value={businessPhone}
                  onChange={(e) => setBusinessPhone(e.target.value)}
                  className="form-input"
                  style={{ width: '100%', fontSize: '8pt' }}
                  placeholder="(555) 123-4567"
                />
              </div>

              <div style={{ paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border)' }}>
                <button
                  type="submit"
                  disabled={submittingBusiness || !businessName.trim()}
                  className="button button-primary"
                  style={{ fontSize: '8pt', width: '100%' }}
                >
                  {submittingBusiness ? 'Creating...' : 'Create Shop'}
                </button>
              </div>
            </form>
          </div>
        </div>

        <div style={{
          marginTop: 'var(--space-4)',
          padding: 'var(--space-3)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          fontSize: '8pt',
          color: 'var(--text-muted)'
        }}>
          <strong>How it works:</strong> After setup, you'll get invite codes. Share them with your technicians.
          They send photos via Telegram, you see them here organized by vehicle.
        </div>
      </div>
    );
  }

  // Main dashboard with tabs
  return (
    <div style={{ padding: 'var(--space-5)', maxWidth: '1000px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-1)' }}>
          {businesses.length > 1 ? (
            <select
              value={business.id}
              onChange={(e) => handleSwitchBusiness(e.target.value)}
              className="form-select"
              style={{ fontSize: '12pt', fontWeight: 700, padding: 'var(--space-2) var(--space-3)' }}
            >
              {businesses.map((biz) => (
                <option key={biz.id} value={biz.id}>
                  {biz.business_name}
                </option>
              ))}
            </select>
          ) : (
            <h1 style={{ fontSize: '14pt', fontWeight: 700, margin: 0 }}>
              {business.business_name}
            </h1>
          )}
        </div>
        <p style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
          {businesses.length > 1 && (
            <span style={{ marginRight: 'var(--space-2)' }}>
              {businesses.length} businesses •
            </span>
          )}
          {business.city && business.state ? `${business.city}, ${business.state}` : 'Restoration Intake Dashboard'}
        </p>
      </div>

      {/* Tab Navigation - Windows 95 style */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--border)',
        marginBottom: 'var(--space-4)'
      }}>
        {[
          { id: 'submissions' as TabType, label: 'Submissions', count: submissions.length },
          { id: 'invites' as TabType, label: 'Invite Codes', count: inviteCodes.filter(c => c.is_active).length },
          { id: 'setup' as TabType, label: 'Technicians', count: technicians.length }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: 'var(--space-2) var(--space-4)',
              fontSize: '8pt',
              fontWeight: activeTab === tab.id ? 700 : 400,
              background: activeTab === tab.id ? 'var(--white)' : 'var(--surface)',
              border: '1px solid var(--border)',
              borderBottom: activeTab === tab.id ? '1px solid var(--white)' : '1px solid var(--border)',
              marginBottom: '-1px',
              marginRight: '-1px',
              cursor: 'pointer',
              color: 'var(--text)'
            }}
          >
            {tab.label}
            {tab.count > 0 && (
              <span style={{
                marginLeft: 'var(--space-2)',
                background: activeTab === tab.id ? 'var(--grey-300)' : 'var(--grey-400)',
                padding: '1px 5px',
                fontSize: '7pt'
              }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="card">
        {/* === SUBMISSIONS TAB === */}
        {activeTab === 'submissions' && (
          <div className="card-body">
            {submissionsLoading ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-muted)', fontSize: '8pt' }}>
                Loading submissions...
              </div>
            ) : submissions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
                <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
                  No submissions yet
                </div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
                  Photos from your technicians will appear here
                </div>
                <button
                  onClick={() => setActiveTab('invites')}
                  className="button button-secondary"
                  style={{ fontSize: '8pt' }}
                >
                  Generate Invite Code
                </button>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 'var(--space-3)', fontSize: '8pt', color: 'var(--text-muted)' }}>
                  {submissions.length} photo{submissions.length !== 1 ? 's' : ''} received
                </div>

                {/* Submissions Grid */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                  gap: 'var(--space-2)'
                }}>
                  {submissions.map((sub) => {
                    const photoUrl = sub.storage_paths?.[0] || sub.photo_urls?.[0];
                    return (
                      <div
                        key={sub.id}
                        onClick={() => setSelectedSubmission(sub)}
                        style={{
                          border: '1px solid var(--border)',
                          background: 'var(--white)',
                          cursor: 'pointer',
                          overflow: 'hidden'
                        }}
                      >
                        <div style={{
                          height: '100px',
                          background: photoUrl
                            ? `url(${photoUrl}) center/cover`
                            : 'var(--grey-200)',
                          borderBottom: '1px solid var(--border)'
                        }} />
                        <div style={{ padding: 'var(--space-2)' }}>
                          <div style={{ fontSize: '7pt', fontWeight: 700, marginBottom: '2px' }}>
                            {sub.detected_work_type?.replace(/_/g, ' ') || 'Photo'}
                          </div>
                          <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                            {sub.technician?.display_name || 'Tech'} • {new Date(sub.received_at).toLocaleDateString()}
                          </div>
                          {sub.vehicle?.vin && (
                            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                              ...{sub.vehicle.vin.slice(-6)}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* === INVITE CODES TAB === */}
        {activeTab === 'invites' && (
          <div className="card-body">
            {/* Generate New Code */}
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              padding: 'var(--space-4)',
              marginBottom: 'var(--space-4)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <div style={{ fontSize: '9pt', fontWeight: 700 }}>
                  Generate Invite Code
                </div>
                <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                  Each code allows up to 10 technicians to join (expires in 30 days)
                </div>
              </div>
              <button
                onClick={handleGenerateCode}
                disabled={generatingCode}
                className="button button-primary"
                style={{ fontSize: '8pt', whiteSpace: 'nowrap' }}
              >
                {generatingCode ? 'Generating...' : 'Generate Code'}
              </button>
            </div>

            {/* Instructions */}
            <div style={{
              background: 'var(--grey-100)',
              border: '1px solid var(--border)',
              padding: 'var(--space-3)',
              marginBottom: 'var(--space-4)',
              fontSize: '8pt'
            }}>
              <div style={{ fontWeight: 700, marginBottom: 'var(--space-2)' }}>
                How to invite a technician:
              </div>
              <ol style={{ margin: 0, paddingLeft: 'var(--space-5)', color: 'var(--text-muted)' }}>
                <li>Generate a code above</li>
                <li>Tell your tech: "Download Telegram, search @Nukeproof_bot"</li>
                <li>Have them send: <code style={{ background: 'var(--grey-200)', padding: '1px 4px' }}>/start CODE</code></li>
              </ol>
            </div>

            {/* Codes List */}
            {inviteCodes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-4)', color: 'var(--text-muted)', fontSize: '8pt' }}>
                No invite codes yet. Generate one above.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8pt' }}>
                <thead>
                  <tr style={{ background: 'var(--grey-200)', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: 'var(--space-2)', fontWeight: 700 }}>Code</th>
                    <th style={{ textAlign: 'left', padding: 'var(--space-2)', fontWeight: 700 }}>Uses</th>
                    <th style={{ textAlign: 'left', padding: 'var(--space-2)', fontWeight: 700 }}>Status</th>
                    <th style={{ textAlign: 'left', padding: 'var(--space-2)', fontWeight: 700 }}>Expires</th>
                    <th style={{ textAlign: 'right', padding: 'var(--space-2)', fontWeight: 700 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {inviteCodes.map((code) => {
                    const isExpired = code.expires_at && new Date(code.expires_at) < new Date();
                    const isMaxedOut = code.uses_count >= code.max_uses;
                    return (
                      <tr key={code.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                        <td style={{ padding: 'var(--space-2)', fontFamily: 'monospace', fontWeight: 600 }}>
                          {code.code}
                        </td>
                        <td style={{ padding: 'var(--space-2)', color: 'var(--text-muted)' }}>
                          {code.uses_count}/{code.max_uses}
                        </td>
                        <td style={{ padding: 'var(--space-2)' }}>
                          {!code.is_active ? (
                            <span style={{ color: 'var(--text-disabled)' }}>Revoked</span>
                          ) : isExpired ? (
                            <span style={{ color: 'var(--warning)' }}>Expired</span>
                          ) : isMaxedOut ? (
                            <span style={{ color: 'var(--success)' }}>Used</span>
                          ) : (
                            <span style={{ color: 'var(--text)' }}>Active</span>
                          )}
                        </td>
                        <td style={{ padding: 'var(--space-2)', color: 'var(--text-muted)' }}>
                          {code.expires_at
                            ? new Date(code.expires_at).toLocaleDateString()
                            : 'Never'}
                        </td>
                        <td style={{ padding: 'var(--space-2)', textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: 'var(--space-1)', justifyContent: 'flex-end' }}>
                            <button
                              onClick={() => copyToClipboard(code.code)}
                              className="button button-secondary"
                              style={{ fontSize: '7pt', padding: '2px 6px' }}
                            >
                              Copy
                            </button>
                            {code.is_active && !isMaxedOut && !isExpired && (
                              <button
                                onClick={() => handleRevokeCode(code.id)}
                                className="button button-secondary"
                                style={{ fontSize: '7pt', padding: '2px 6px', color: 'var(--error)' }}
                              >
                                Revoke
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* === TECHNICIANS TAB === */}
        {activeTab === 'setup' && (
          <div className="card-body">
            {technicians.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
                <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
                  No technicians yet
                </div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
                  Invite codes become technicians when used
                </div>
                <button
                  onClick={() => setActiveTab('invites')}
                  className="button button-secondary"
                  style={{ fontSize: '8pt' }}
                >
                  Generate Invite Code
                </button>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 'var(--space-3)', fontSize: '8pt', color: 'var(--text-muted)' }}>
                  {technicians.length} technician{technicians.length !== 1 ? 's' : ''} connected
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8pt' }}>
                  <thead>
                    <tr style={{ background: 'var(--grey-200)', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ textAlign: 'left', padding: 'var(--space-2)', fontWeight: 700 }}>Name</th>
                      <th style={{ textAlign: 'left', padding: 'var(--space-2)', fontWeight: 700 }}>Telegram</th>
                      <th style={{ textAlign: 'left', padding: 'var(--space-2)', fontWeight: 700 }}>Joined</th>
                      <th style={{ textAlign: 'left', padding: 'var(--space-2)', fontWeight: 700 }}>Last Active</th>
                      <th style={{ textAlign: 'left', padding: 'var(--space-2)', fontWeight: 700 }}>Current Vehicle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {technicians.map((tech) => (
                      <tr key={tech.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                        <td style={{ padding: 'var(--space-2)', fontWeight: 600 }}>
                          {tech.display_name || 'Unknown'}
                        </td>
                        <td style={{ padding: 'var(--space-2)', color: 'var(--text-muted)' }}>
                          {tech.telegram_username ? `@${tech.telegram_username}` : '-'}
                        </td>
                        <td style={{ padding: 'var(--space-2)', color: 'var(--text-muted)' }}>
                          {tech.onboarded_at
                            ? new Date(tech.onboarded_at).toLocaleDateString()
                            : '-'}
                        </td>
                        <td style={{ padding: 'var(--space-2)', color: 'var(--text-muted)' }}>
                          {tech.last_active_at
                            ? new Date(tech.last_active_at).toLocaleDateString()
                            : '-'
                          }
                        </td>
                        <td style={{ padding: 'var(--space-2)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                          {tech.active_vin
                            ? `...${tech.active_vin.slice(-6)}`
                            : '-'
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
      </div>

      {/* API Access Info */}
      <div style={{
        marginTop: 'var(--space-4)',
        padding: 'var(--space-3)',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        fontSize: '8pt'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong>API Access:</strong> Pull submissions programmatically via our API.{' '}
            <a
              href="/developers"
              style={{ color: 'var(--accent)', textDecoration: 'underline' }}
            >
              View documentation
            </a>
          </div>
          <button
            onClick={() => navigate('/settings/api-keys')}
            className="button button-secondary"
            style={{ fontSize: '7pt' }}
          >
            Manage API Keys
          </button>
        </div>
      </div>

      {/* Submission Detail Modal */}
      {selectedSubmission && (
        <div
          onClick={() => setSelectedSubmission(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--white)',
              border: '1px solid var(--border)',
              maxWidth: '600px',
              width: '90%',
              maxHeight: '90vh',
              overflow: 'auto'
            }}
          >
            {/* Modal Header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 'var(--space-3)',
              borderBottom: '1px solid var(--border)',
              background: 'var(--grey-200)'
            }}>
              <div style={{ fontSize: '9pt', fontWeight: 700 }}>
                Submission Detail
              </div>
              <button
                onClick={() => setSelectedSubmission(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '14pt',
                  cursor: 'pointer',
                  color: 'var(--text-muted)'
                }}
              >
                ×
              </button>
            </div>

            {/* Photo */}
            <div style={{ position: 'relative' }}>
              <img
                src={selectedSubmission.storage_paths?.[0] || selectedSubmission.photo_urls?.[0]}
                alt="Work submission"
                style={{ width: '100%', display: 'block' }}
              />
            </div>

            {/* Details */}
            <div style={{ padding: 'var(--space-4)' }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 'var(--space-3)',
                fontSize: '8pt'
              }}>
                <div>
                  <div style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>Work Type</div>
                  <div style={{ fontWeight: 600 }}>
                    {selectedSubmission.detected_work_type?.replace(/_/g, ' ') || 'Unclassified'}
                  </div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>Technician</div>
                  <div style={{ fontWeight: 600 }}>
                    {selectedSubmission.technician?.display_name || 'Unknown'}
                    {selectedSubmission.technician?.telegram_username && (
                      <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                        {' '}@{selectedSubmission.technician.telegram_username}
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>Received</div>
                  <div style={{ fontWeight: 600 }}>
                    {new Date(selectedSubmission.received_at).toLocaleString()}
                  </div>
                </div>
                {selectedSubmission.vehicle?.vin && (
                  <div>
                    <div style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>Vehicle</div>
                    <div style={{ fontWeight: 600 }}>
                      {selectedSubmission.vehicle.year} {selectedSubmission.vehicle.make} {selectedSubmission.vehicle.model}
                    </div>
                    <div style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                      {selectedSubmission.vehicle.vin}
                    </div>
                  </div>
                )}
                {selectedSubmission.confidence_score && (
                  <div>
                    <div style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>AI Confidence</div>
                    <div style={{ fontWeight: 600 }}>
                      {Math.round(selectedSubmission.confidence_score * 100)}%
                    </div>
                  </div>
                )}
              </div>

              {selectedSubmission.detected_description && (
                <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border-light)' }}>
                  <div style={{ color: 'var(--text-muted)', marginBottom: '2px', fontSize: '8pt' }}>AI Description</div>
                  <div style={{ fontSize: '8pt' }}>{selectedSubmission.detected_description}</div>
                </div>
              )}

              {selectedSubmission.message_text && (
                <div style={{ marginTop: 'var(--space-3)' }}>
                  <div style={{ color: 'var(--text-muted)', marginBottom: '2px', fontSize: '8pt' }}>Tech's Note</div>
                  <div style={{ fontSize: '8pt', fontStyle: 'italic' }}>"{selectedSubmission.message_text}"</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
