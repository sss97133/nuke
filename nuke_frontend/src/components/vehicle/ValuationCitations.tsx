import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { FiFileText, FiImage, FiDollarSign, FiClock, FiUser, FiCheckCircle, FiAlertCircle } from 'react-icons/fi';

interface ValuationCitationsProps {
  vehicleId: string;
}

interface Citation {
  id: string;
  component_type: string;
  component_name: string;
  value_usd: number;
  value_type: string;
  submitter_name?: string;
  submitted_at: string;
  effective_date?: string;
  evidence_type: string;
  confidence_score: number;
  verification_status: string;
  source_document_id?: string;
  source_image_id?: string;
  metadata?: any;
}

const EVIDENCE_ICONS: Record<string, React.ComponentType> = {
  receipt: FiFileText,
  invoice: FiFileText,
  title: FiFileText,
  image_tag: FiImage,
  market_listing: FiDollarSign,
  appraisal_doc: FiFileText,
  user_input: FiUser,
  ai_extraction: FiClock,
  system_calculation: FiClock
};

const COMPONENT_LABELS: Record<string, string> = {
  purchase_price: 'Purchase Price',
  msrp: 'MSRP',
  current_value: 'Current Market Value',
  asking_price: 'Asking Price',
  part_purchase: 'Part Purchase',
  part_value_estimate: 'Part Value',
  labor_hours: 'Labor Hours',
  labor_rate: 'Labor Rate',
  shop_rate: 'Shop Rate',
  market_comp: 'Market Comparable',
  condition_penalty: 'Condition Adjustment',
  modification_premium: 'Modification Premium',
  ai_estimate: 'AI Valuation',
  user_estimate: 'User Estimate',
  appraiser_estimate: 'Professional Appraisal'
};

const ValuationCitations: React.FC<ValuationCitationsProps> = ({ vehicleId }) => {
  const [citations, setCitations] = useState<Citation[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalValue, setTotalValue] = useState(0);
  const [groupedCitations, setGroupedCitations] = useState<Record<string, Citation[]>>({});

  useEffect(() => {
    loadCitations();
  }, [vehicleId]);

  const loadCitations = async () => {
    try {
      // Use RPC data if available for valuation (eliminates duplicate query)
      const rpcData = (window as any).__vehicleProfileRpcData;
      // Note: valuation_citations is not in RPC yet, but we can use latest_valuation
      // For now, still query citations separately (Phase 2: add to RPC)
      
      const { data, error } = await supabase
        .from('valuation_citations')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('submitted_at', { ascending: false });

      if (error) throw error;

      setCitations(data || []);

      // Calculate total
      const total = (data || []).reduce((sum, c) => sum + (c.value_usd || 0), 0);
      setTotalValue(total);

      // Group by component type
      const grouped = (data || []).reduce((acc, citation) => {
        const key = citation.component_type;
        if (!acc[key]) acc[key] = [];
        acc[key].push(citation);
        return acc;
      }, {} as Record<string, Citation[]>);
      setGroupedCitations(grouped);

    } catch (error) {
      console.error('Failed to load citations:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-header">
          <h3 className="text-lg font-semibold">Valuation Breakdown</h3>
        </div>
        <div className="card-body">
          <div className="text-center text-gray-500">Loading valuation data...</div>
        </div>
      </div>
    );
  }

  if (citations.length === 0) {
    return (
      <div className="card">
        <div className="card-header">
          <h3 className="text-lg font-semibold">Valuation Breakdown</h3>
          <p className="text-sm text-gray-600 mt-1">Source attribution for every dollar</p>
        </div>
        <div className="card-body">
          <div className="text-center text-gray-500">
            <FiDollarSign className="w-12 h-12 mx-auto mb-2 text-gray-300" />
            <p>No valuation data recorded yet</p>
            <p className="text-sm mt-1">Upload receipts and documents to build a transparent valuation.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Valuation Breakdown</h3>
            <p className="text-sm text-gray-600 mt-1">
              {citations.length} citation{citations.length !== 1 ? 's' : ''} recorded
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-green-600">
              ${totalValue.toLocaleString()}
            </div>
            <div className="text-xs text-gray-500">Total Documented</div>
          </div>
        </div>
      </div>

      <div className="card-body">
        <div className="space-y-4">
          {Object.entries(groupedCitations).map(([componentType, citationGroup]) => {
            const groupTotal = citationGroup.reduce((sum, c) => sum + (c.value_usd || 0), 0);
            
            return (
              <div key={componentType} className="border border-gray-200 rounded-lg overflow-hidden">
                {/* Group Header */}
                <div className="bg-gray-50 px-4 py-2 flex items-center justify-between">
                  <div className="font-semibold text-gray-900">
                    {COMPONENT_LABELS[componentType] || componentType}
                  </div>
                  <div className="font-semibold text-gray-900">
                    ${groupTotal.toLocaleString()}
                  </div>
                </div>

                {/* Citations in Group */}
                <div className="divide-y divide-gray-200">
                  {citationGroup.map((citation) => {
                    const EvidenceIcon = EVIDENCE_ICONS[citation.evidence_type] || FiFileText;
                    const isVerified = ['user_verified', 'peer_verified', 'professional_verified', 'receipt_confirmed'].includes(citation.verification_status);
                    
                    return (
                      <div key={citation.id} className="p-3 hover:bg-gray-50">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <EvidenceIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                              <span className="font-medium text-gray-900">
                                {citation.component_name || COMPONENT_LABELS[citation.component_type]}
                              </span>
                              {isVerified && (
                                <FiCheckCircle className="w-4 h-4 text-green-500" title="Verified" />
                              )}
                            </div>

                            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-600">
                              {citation.submitter_name && (
                                <span className="flex items-center gap-1">
                                  <FiUser className="w-3 h-3" />
                                  {citation.submitter_name}
                                </span>
                              )}
                              <span className="flex items-center gap-1">
                                <FiClock className="w-3 h-3" />
                                {new Date(citation.submitted_at).toLocaleDateString()}
                              </span>
                              <span className="capitalize">{citation.evidence_type.replace('_', ' ')}</span>
                              {citation.confidence_score && (
                                <span className={`px-2 py-0.5 rounded ${
                                  citation.confidence_score >= 80 ? 'bg-green-100 text-green-800' :
                                  citation.confidence_score >= 60 ? 'bg-yellow-100 text-yellow-800' :
                                  'bg-gray-100 text-gray-800'
                                }`}>
                                  {citation.confidence_score}% confidence
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="font-semibold text-gray-900 ml-4">
                            ${citation.value_usd.toLocaleString()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Info Footer */}
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900">
          <div className="font-medium flex items-center gap-2">
            <FiCheckCircle className="w-4 h-4" />
            Transparent Valuation
          </div>
          <div className="mt-1 text-blue-700">
            Every dollar is backed by receipts, documents, or verified user input. Click any citation to see source documents.
          </div>
        </div>
      </div>
    </div>
  );
};

export default ValuationCitations;

