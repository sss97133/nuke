import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { FileText, Loader2, CheckCircle, Calendar, MapPin, Wrench, AlertCircle } from 'lucide-react';
import '../../design-system.css';

interface VehicleDocumentIntelligenceProps {
  vehicleId: string;
}

interface ServiceRecord {
  id: string;
  service_date: string | null;
  shop_name: string | null;
  shop_location: string | null;
  work_performed: string | null;
  cost: number | null;
  service_type: string | null;
  parts_replaced: string[] | null;
  confidence_score: number | null;
}

interface DocumentStats {
  total_receipts: number;
  processed: number;
  pending: number;
}

const VehicleDocumentIntelligence = ({ vehicleId }: VehicleDocumentIntelligenceProps) => {
  const [serviceRecords, setServiceRecords] = useState<ServiceRecord[]>([]);
  const [documentStats, setDocumentStats] = useState<DocumentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ processed: 0, total: 0 });

  useEffect(() => {
    loadData();
  }, [vehicleId]);

  const loadData = async () => {
    try {
      setLoading(true);

      // Get service records
      const { data: records } = await supabase
        .from('service_records')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('service_date', { ascending: false });

      setServiceRecords(records || []);

      // Get document stats
      const { count: totalReceipts } = await supabase
        .from('vehicle_documents')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', vehicleId)
        .eq('document_type', 'receipt');

      const { count: processedReceipts } = await supabase
        .from('vehicle_documents')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', vehicleId)
        .eq('document_type', 'receipt')
        .not('vendor_name', 'is', null);

      setDocumentStats({
        total_receipts: totalReceipts || 0,
        processed: processedReceipts || 0,
        pending: (totalReceipts || 0) - (processedReceipts || 0)
      });
    } catch (error) {
      console.error('Error loading document data:', error);
    } finally {
      setLoading(false);
    }
  };

  const analyzeDocuments = async () => {
    setAnalyzing(true);
    setAnalysisProgress({ processed: 0, total: documentStats?.pending || 0 });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      // Process in batches of 5
      let totalProcessed = 0;
      let remaining = documentStats?.pending || 0;

      while (remaining > 0) {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-vehicle-documents`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({
              vehicle_id: vehicleId,
              batch_size: 5
            }),
          }
        );

        const result = await response.json();

        if (!response.ok || result.error) {
          console.error('Analysis error:', result.error);
          break;
        }

        totalProcessed += result.processed || 0;
        remaining = result.remaining_documents || 0;
        setAnalysisProgress({ processed: totalProcessed, total: documentStats?.pending || totalProcessed });

        // If no more documents to process, break
        if (result.processed === 0) break;
      }

      // Reload data
      await loadData();
    } catch (error) {
      console.error('Error analyzing documents:', error);
      alert('Failed to analyze documents. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Unknown date';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getServiceTypeColor = (type: string | null) => {
    switch (type) {
      case 'maintenance': return '#3b82f6';
      case 'repair': return '#f59e0b';
      case 'restoration': return '#8b5cf6';
      case 'modification': return '#10b981';
      case 'parts_purchase': return '#6b7280';
      default: return '#6b7280';
    }
  };

  if (loading) {
    return (
      <div className="card" style={{ border: '1px solid #c0c0c0', padding: '16px' }}>
        <div style={{ textAlign: 'center', color: '#666', fontSize: '10pt' }}>
          Loading document intelligence...
        </div>
      </div>
    );
  }

  // No documents at all
  if (!documentStats || documentStats.total_receipts === 0) {
    return (
      <div className="card" style={{ border: '1px solid #c0c0c0', padding: '16px' }}>
        <div style={{ textAlign: 'center', color: '#666', fontSize: '10pt' }}>
          <FileText size={20} style={{ marginBottom: '8px', opacity: 0.5 }} />
          <div>No service documents uploaded yet.</div>
          <div style={{ fontSize: '8pt', marginTop: '4px' }}>
            Upload receipts and invoices to build a maintenance history.
          </div>
        </div>
      </div>
    );
  }

  // Has pending documents to analyze
  if (documentStats.pending > 0) {
    return (
      <div
        className="card"
        onClick={!analyzing ? analyzeDocuments : undefined}
        style={{
          border: '1px solid #c0c0c0',
          padding: '16px',
          cursor: analyzing ? 'wait' : 'pointer',
          transition: 'all 0.2s ease',
          background: analyzing ? '#f9fafb' : undefined,
        }}
        onMouseEnter={(e) => !analyzing && (e.currentTarget.style.borderColor = '#8b5cf6')}
        onMouseLeave={(e) => !analyzing && (e.currentTarget.style.borderColor = '#c0c0c0')}
      >
        {analyzing ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '12px' }}>
              <Loader2 size={16} className="animate-spin" color="#8b5cf6" />
              <span style={{ fontSize: '10pt', fontWeight: 600, color: '#8b5cf6' }}>
                Analyzing Receipts...
              </span>
            </div>
            <div style={{
              height: '4px',
              background: '#e5e7eb',
              borderRadius: '2px',
              overflow: 'hidden',
              marginBottom: '8px'
            }}>
              <div style={{
                height: '100%',
                width: `${analysisProgress.total > 0 ? (analysisProgress.processed / analysisProgress.total) * 100 : 0}%`,
                background: '#8b5cf6',
                transition: 'width 0.5s ease',
                borderRadius: '2px'
              }} />
            </div>
            <div style={{ fontSize: '8pt', color: '#666' }}>
              Processed {analysisProgress.processed} of {analysisProgress.total} documents...
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
              <FileText size={16} color="#8b5cf6" />
              <span style={{ fontSize: '10pt', fontWeight: 600 }}>
                {documentStats.pending} Receipts Ready to Analyze
              </span>
            </div>
            <div style={{ fontSize: '8pt', color: '#666', marginBottom: '12px' }}>
              {documentStats.processed > 0 && `${documentStats.processed} already processed · `}
              AI will extract vendor, date, cost, and service details
            </div>
            <div style={{
              padding: '6px 12px',
              background: '#8b5cf6',
              color: 'white',
              borderRadius: '2px',
              fontSize: '8pt',
              fontWeight: 600,
              display: 'inline-block'
            }}>
              Click to Analyze All
            </div>
          </div>
        )}
      </div>
    );
  }

  // Show service records if we have them
  if (serviceRecords.length > 0) {
    const totalSpend = serviceRecords.reduce((sum, r) => sum + (r.cost || 0), 0);

    return (
      <div className="space-y-3">
        {/* Summary Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '8pt',
          color: '#666'
        }}>
          <span>
            <CheckCircle size={12} style={{ display: 'inline', marginRight: '4px', color: '#10b981' }} />
            {serviceRecords.length} service records from {documentStats.processed} documents
          </span>
          <span style={{ fontWeight: 600, color: '#374151' }}>
            Total: {formatCurrency(totalSpend)}
          </span>
        </div>

        {/* Service Records List */}
        <div className="card" style={{ border: '1px solid #c0c0c0', overflow: 'hidden' }}>
          <div style={{
            background: 'var(--bg)',
            borderBottom: '1px solid #c0c0c0',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Wrench size={14} />
            <span style={{ fontWeight: 600, fontSize: '10pt' }}>Service History</span>
          </div>

          <div style={{ maxHeight: '400px', overflow: 'auto' }}>
            {serviceRecords.slice(0, 10).map((record, i) => (
              <div
                key={record.id}
                style={{
                  padding: '10px 12px',
                  borderBottom: i < Math.min(serviceRecords.length, 10) - 1 ? '1px solid #e5e7eb' : 'none',
                  background: i % 2 === 0 ? 'white' : '#fafafa'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{
                      background: getServiceTypeColor(record.service_type),
                      color: 'white',
                      padding: '1px 6px',
                      borderRadius: '2px',
                      fontSize: '7pt',
                      fontWeight: 600,
                      textTransform: 'uppercase'
                    }}>
                      {record.service_type || 'service'}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: '9pt' }}>
                      {record.shop_name || 'Unknown Shop'}
                    </span>
                  </div>
                  {record.cost && (
                    <span style={{ fontWeight: 700, fontSize: '9pt', color: '#374151', fontFamily: 'monospace' }}>
                      {formatCurrency(record.cost)}
                    </span>
                  )}
                </div>

                <div style={{ fontSize: '8pt', color: '#666', marginBottom: '4px' }}>
                  <Calendar size={10} style={{ display: 'inline', marginRight: '4px' }} />
                  {formatDate(record.service_date)}
                  {record.shop_location && (
                    <>
                      <span style={{ margin: '0 6px' }}>·</span>
                      <MapPin size={10} style={{ display: 'inline', marginRight: '4px' }} />
                      {record.shop_location}
                    </>
                  )}
                </div>

                {record.work_performed && (
                  <div style={{ fontSize: '8pt', color: '#4b5563', lineHeight: 1.4 }}>
                    {record.work_performed.length > 150
                      ? record.work_performed.substring(0, 150) + '...'
                      : record.work_performed}
                  </div>
                )}

                {record.parts_replaced && record.parts_replaced.length > 0 && (
                  <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {record.parts_replaced.slice(0, 5).map((part, j) => (
                      <span key={j} style={{
                        background: '#f3f4f6',
                        border: '1px solid #e5e7eb',
                        padding: '1px 6px',
                        borderRadius: '2px',
                        fontSize: '7pt',
                        color: '#4b5563'
                      }}>
                        {part}
                      </span>
                    ))}
                    {record.parts_replaced.length > 5 && (
                      <span style={{ fontSize: '7pt', color: '#9ca3af' }}>
                        +{record.parts_replaced.length - 5} more
                      </span>
                    )}
                  </div>
                )}

                {record.confidence_score && record.confidence_score < 0.7 && (
                  <div style={{ marginTop: '4px', fontSize: '7pt', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <AlertCircle size={10} />
                    Low confidence extraction - verify details
                  </div>
                )}
              </div>
            ))}
          </div>

          {serviceRecords.length > 10 && (
            <div style={{
              padding: '8px 12px',
              background: '#f9fafb',
              borderTop: '1px solid #e5e7eb',
              fontSize: '8pt',
              color: '#666',
              textAlign: 'center'
            }}>
              Showing 10 of {serviceRecords.length} records
            </div>
          )}
        </div>
      </div>
    );
  }

  // All processed but no records created (edge case)
  return (
    <div className="card" style={{ border: '1px solid #c0c0c0', padding: '16px' }}>
      <div style={{ textAlign: 'center', color: '#666', fontSize: '10pt' }}>
        <CheckCircle size={20} style={{ marginBottom: '8px', color: '#10b981' }} />
        <div>All {documentStats.processed} documents processed.</div>
        <div style={{ fontSize: '8pt', marginTop: '4px' }}>
          No service records could be extracted. Documents may not be receipts.
        </div>
      </div>
    </div>
  );
};

export default VehicleDocumentIntelligence;
