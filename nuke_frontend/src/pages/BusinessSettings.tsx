/**
 * Business Settings - NUKE LTD Configuration
 *
 * Manages QuickBooks integration and company legal information.
 * This is for internal business management, not end-user facing.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Building2,
  FileText,
  Link2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Shield,
  Loader2,
} from 'lucide-react';

interface ParentCompany {
  id: string;
  legal_name: string;
  dba_name: string | null;
  entity_type: string;
  state_of_formation: string;
  formation_date: string | null;
  ein: string | null;
  state_tax_id: string | null;
  ceo_name: string | null;
  principal_address: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  quickbooks_realm_id: string | null;
  quickbooks_connected_at: string | null;
  quickbooks_token_expires_at: string | null;
}

interface QuickBooksStatus {
  connected: boolean;
  company: string | null;
  connected_at: string | null;
  token_expires: string | null;
}

interface LegalDocument {
  id: string;
  document_type: string;
  document_name: string;
  version: string;
  status: string;
  created_at: string;
}

export default function BusinessSettings() {
  const navigate = useNavigate();
  const [company, setCompany] = useState<ParentCompany | null>(null);
  const [qbStatus, setQbStatus] = useState<QuickBooksStatus | null>(null);
  const [documents, setDocuments] = useState<LegalDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      // Load company data
      const { data: companyData } = await supabase
        .from('parent_company')
        .select('*')
        .eq('legal_name', 'NUKE LTD')
        .single();

      if (companyData) {
        setCompany(companyData);

        // Load QuickBooks status
        const qbRes = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/quickbooks-connect?action=status`,
          {
            headers: {
              Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            },
          }
        );
        const qbData = await qbRes.json();
        setQbStatus(qbData);

        // Load legal documents
        const docsRes = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-legal-document?action=list_documents&parent_company_id=${companyData.id}`,
          {
            headers: {
              Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            },
          }
        );
        const docsData = await docsRes.json();
        setDocuments(docsData.documents || []);
      }
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  }

  async function connectQuickBooks() {
    setConnecting(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/quickbooks-connect?action=auth_url`,
        { headers }
      );
      const data = await res.json();

      if (data.auth_url) {
        // Store state for verification
        localStorage.setItem('qb_oauth_state', data.state);
        // Redirect to QuickBooks OAuth
        window.location.href = data.auth_url;
      }
    } catch (err) {
      console.error('Error connecting QuickBooks:', err);
    } finally {
      setConnecting(false);
    }
  }

  async function generateDocument(docType: string) {
    if (!company) return;
    setGenerating(docType);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-legal-document`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: JSON.stringify({
            action: 'generate',
            document_type: docType,
            parent_company_id: company.id,
          }),
        }
      );
      const data = await res.json();
      if (data.success) {
        // Reload documents
        loadData();
      }
    } catch (err) {
      console.error('Error generating document:', err);
    } finally {
      setGenerating(null);
    }
  }

  async function fetchFinancials() {
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/quickbooks-connect?action=financials`,
        {
          headers: {
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
        }
      );
      const data = await res.json();
      console.log('Financials:', data);
      // TODO: Display in UI
    } catch (err) {
      console.error('Error fetching financials:', err);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <div className="p-3 bg-blue-500/10 rounded-xl">
            <Building2 className="w-8 h-8 text-blue-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Business Settings</h1>
            <p className="text-zinc-400">NUKE LTD - Legal & Financial Configuration</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Company Information */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-green-500" />
              Company Information
            </h2>

            {company && (
              <div className="space-y-3">
                <div className="flex justify-between py-2 border-b border-zinc-800">
                  <span className="text-zinc-400">Legal Name</span>
                  <span className="font-medium">{company.legal_name}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-zinc-800">
                  <span className="text-zinc-400">DBA</span>
                  <span className="font-medium">{company.dba_name || '-'}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-zinc-800">
                  <span className="text-zinc-400">Entity Type</span>
                  <span className="font-medium uppercase">{company.entity_type}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-zinc-800">
                  <span className="text-zinc-400">State</span>
                  <span className="font-medium">{company.state_of_formation}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-zinc-800">
                  <span className="text-zinc-400">EIN</span>
                  <span className="font-mono">{company.ein || '-'}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-zinc-800">
                  <span className="text-zinc-400">State Tax ID</span>
                  <span className="font-mono">{company.state_tax_id || '-'}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-zinc-800">
                  <span className="text-zinc-400">Formation Date</span>
                  <span className="font-medium">
                    {company.formation_date
                      ? new Date(company.formation_date).toLocaleDateString()
                      : '-'}
                  </span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-zinc-400">Manager</span>
                  <span className="font-medium">{company.ceo_name || '-'}</span>
                </div>

                {company.principal_address?.street && (
                  <div className="pt-3 border-t border-zinc-800">
                    <span className="text-zinc-400 text-sm">Principal Address</span>
                    <p className="mt-1">
                      {company.principal_address.street}
                      <br />
                      {company.principal_address.city}, {company.principal_address.state}{' '}
                      {company.principal_address.zip}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* QuickBooks Integration */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Link2 className="w-5 h-5 text-blue-500" />
              QuickBooks Integration
            </h2>

            <div className="space-y-4">
              {/* Connection Status */}
              <div
                className={`p-4 rounded-lg ${
                  qbStatus?.connected
                    ? 'bg-green-500/10 border border-green-500/30'
                    : 'bg-yellow-500/10 border border-yellow-500/30'
                }`}
              >
                <div className="flex items-center gap-3">
                  {qbStatus?.connected ? (
                    <CheckCircle2 className="w-6 h-6 text-green-500" />
                  ) : (
                    <AlertCircle className="w-6 h-6 text-yellow-500" />
                  )}
                  <div>
                    <p className="font-medium">
                      {qbStatus?.connected ? 'Connected' : 'Not Connected'}
                    </p>
                    {qbStatus?.connected && qbStatus.connected_at && (
                      <p className="text-sm text-zinc-400">
                        Since {new Date(qbStatus.connected_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Connect/Refresh Button */}
              {!qbStatus?.connected ? (
                <button
                  onClick={connectQuickBooks}
                  disabled={connecting}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg font-medium transition-colors"
                >
                  {connecting ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <ExternalLink className="w-5 h-5" />
                  )}
                  Connect QuickBooks
                </button>
              ) : (
                <div className="space-y-3">
                  <button
                    onClick={fetchFinancials}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors"
                  >
                    <RefreshCw className="w-5 h-5" />
                    Sync Financial Reports
                  </button>

                  <button
                    onClick={connectQuickBooks}
                    disabled={connecting}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors"
                  >
                    Reconnect Account
                  </button>
                </div>
              )}

              {/* Token Status */}
              {qbStatus?.connected && qbStatus.token_expires && (
                <p className="text-xs text-zinc-500 text-center">
                  Token expires:{' '}
                  {new Date(qbStatus.token_expires).toLocaleString()}
                </p>
              )}

              {/* Security Notice */}
              <div className="p-3 bg-zinc-800/50 rounded-lg text-xs text-zinc-400">
                <p className="font-medium text-zinc-300 mb-1">Security Notice</p>
                <p>
                  OAuth tokens are encrypted and stored securely. Only the service
                  role can access financial data. Connection uses HTTPS and follows
                  Intuit's security requirements.
                </p>
              </div>
            </div>
          </div>

          {/* Legal Documents */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 lg:col-span-2">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-purple-500" />
              Legal Documents
            </h2>

            {/* Document Templates */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {[
                { type: 'operating_agreement', name: 'Operating Agreement' },
                { type: 'offering_circular', name: 'Offering Circular' },
                { type: 'subscription_agreement', name: 'Subscription Agreement' },
                { type: 'risk_disclosure', name: 'Risk Disclosure' },
              ].map((doc) => (
                <button
                  key={doc.type}
                  onClick={() => generateDocument(doc.type)}
                  disabled={generating === doc.type}
                  className="p-4 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded-lg text-left transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <FileText className="w-5 h-5 text-zinc-400" />
                    {generating === doc.type && (
                      <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                    )}
                  </div>
                  <p className="font-medium text-sm">{doc.name}</p>
                  <p className="text-xs text-zinc-500 mt-1">Generate new</p>
                </button>
              ))}
            </div>

            {/* Generated Documents */}
            {documents.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-zinc-400 mb-3">
                  Generated Documents
                </h3>
                <div className="space-y-2">
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-zinc-400" />
                        <div>
                          <p className="font-medium text-sm">{doc.document_name}</p>
                          <p className="text-xs text-zinc-500">
                            v{doc.version} - {new Date(doc.created_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-1 text-xs rounded ${
                            doc.status === 'approved'
                              ? 'bg-green-500/20 text-green-400'
                              : doc.status === 'review'
                              ? 'bg-yellow-500/20 text-yellow-400'
                              : 'bg-zinc-700 text-zinc-400'
                          }`}
                        >
                          {doc.status}
                        </span>
                        <button className="p-1 hover:bg-zinc-700 rounded">
                          <ExternalLink className="w-4 h-4 text-zinc-400" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
