import React, { useState, useEffect, useCallback, memo } from 'react';
import { supabase } from '../../lib/supabase';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  FileText,
  PieChart,
  Calendar,
  Building,
  Receipt,
  AlertCircle,
  CheckCircle,
  Eye,
  Upload
} from 'lucide-react';
import VehicleErrorBoundary from '../vehicle/VehicleErrorBoundary';

interface FinancialDashboardProps {
  vehicleId: string;
  onUploadClick: () => void;
}

interface FinancialSummary {
  totalDocuments: number;
  financialDocs: number;
  totalExpenses: number;
  totalBuildCosts: number;
  avgDocumentAmount: number;
  uniqueVendors: number;
  vendorList: string[];
  aiProcessedDocs: number;
  avgAiConfidence: number;
}

interface MonthlySpending {
  month: string;
  total: number;
  documentCount: number;
  vendors: string[];
}

interface DocumentSummary {
  id: string;
  filename: string;
  documentType: string;
  vendorName: string;
  totalAmount: number;
  dateOfDocument: string;
  aiConfidence: number;
  hasFinancialData: boolean;
  processingStatus: string;
}

const VehicleFinancialDashboard: React.FC<FinancialDashboardProps> = memo(({
  vehicleId,
  onUploadClick
}) => {
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [monthlyData, setMonthlyData] = useState<MonthlySpending[]>([]);
  const [recentDocs, setRecentDocs] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    loadFinancialData();
  }, [vehicleId]);

  const loadFinancialData = async () => {
    try {
      setLoading(true);

      // Load documents directly and calculate summary
      const { data: docsData, error: docsError } = await supabase
        .from('vehicle_documents')
        .select('*')
        .eq('vehicle_id', vehicleId);

      if (docsError) {
        console.error('Error loading documents:', docsError);
        return;
      }

      // Calculate summary from documents
      const totalDocuments = docsData?.length || 0;
      const financialDocs = docsData?.filter(doc => doc.amount && doc.amount > 0).length || 0;
      const totalExpenses = docsData?.reduce((sum, doc) => sum + (parseFloat(doc.amount || 0)), 0) || 0;
      const uniqueVendors = new Set(docsData?.filter(doc => doc.vendor_name).map(doc => doc.vendor_name)).size;
      const vendorList = Array.from(new Set(docsData?.filter(doc => doc.vendor_name).map(doc => doc.vendor_name))) || [];
      const aiProcessedDocs = docsData?.filter(doc => doc.extracted_data && Object.keys(doc.extracted_data).length > 0).length || 0;

      // Load build costs from existing system
      const { data: buildData, error: buildError } = await supabase
        .from('build_line_items')
        .select('total_price')
        .in('build_id', await supabase
          .from('vehicle_builds')
          .select('id')
          .eq('vehicle_id', vehicleId)
          .then(res => res.data?.map(b => b.id) || [])
        );

      const totalBuildCosts = buildData?.reduce((sum, item) => sum + (parseFloat(item.total_price || 0)), 0) || 0;

      setSummary({
        totalDocuments,
        financialDocs,
        totalExpenses,
        totalBuildCosts,
        avgDocumentAmount: financialDocs > 0 ? totalExpenses / financialDocs : 0,
        uniqueVendors,
        vendorList,
        aiProcessedDocs,
        avgAiConfidence: aiProcessedDocs > 0 ? 0.8 : 0 // Simple placeholder
      });

      // Calculate monthly spending from documents
      const monthlySpending = docsData
        ?.filter(doc => doc.document_date && doc.amount)
        ?.reduce((acc: any, doc) => {
          const month = new Date(doc.document_date).toISOString().slice(0, 7); // YYYY-MM format
          if (!acc[month]) {
            acc[month] = { total: 0, count: 0, vendors: new Set() };
          }
          acc[month].total += parseFloat(doc.amount || 0);
          acc[month].count += 1;
          if (doc.vendor_name) {
            acc[month].vendors.add(doc.vendor_name);
          }
          return acc;
        }, {}) || {};

      setMonthlyData(Object.entries(monthlySpending).map(([month, data]: [string, any]) => ({
        month: new Date(month + '-01').toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short'
        }),
        total: data.total,
        documentCount: data.count,
        vendors: Array.from(data.vendors)
      })).sort((a, b) => a.month.localeCompare(b.month)));

      // Set recent documents (top 10 most recent)
      setRecentDocs((docsData || [])
        .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
        .slice(0, 10)
        .map(doc => ({
          id: doc.id,
          filename: doc.file_name || '',
          documentType: doc.document_type || '',
          vendorName: doc.vendor_name || '',
          totalAmount: parseFloat(doc.amount || 0),
          dateOfDocument: doc.document_date || '',
          aiConfidence: doc.extracted_data ? 0.8 : 0.0,
          hasFinancialData: !!(doc.amount && doc.amount > 0),
          processingStatus: doc.extracted_data && Object.keys(doc.extracted_data).length > 0 ? 'completed' : 'pending'
        })));

    } catch (error) {
      console.error('Error loading financial data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle style={{ width: '10px', height: '10px', color: 'green' }} />;
      case 'failed':
        return <AlertCircle style={{ width: '10px', height: '10px', color: 'red' }} />;
      default:
        return <AlertCircle style={{ width: '10px', height: '10px', color: 'orange' }} />;
    }
  };

  const getDocumentTypeIcon = (type: string) => {
    switch (type) {
      case 'receipt':
        return <Receipt style={{ width: '10px', height: '10px' }} />;
      case 'invoice':
        return <FileText style={{ width: '10px', height: '10px' }} />;
      default:
        return <FileText style={{ width: '10px', height: '10px' }} />;
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-4)', textAlign: 'center' }}>
        <div className="text">Loading financial data...</div>
      </div>
    );
  }

  return (
    <VehicleErrorBoundary
      vehicleId={vehicleId}
      componentName="Financial Dashboard"
    >
      <div className="financial-dashboard" style={{ padding: 'var(--space-4)' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 'var(--space-4)',
        borderBottom: '1px solid var(--border-light)',
        paddingBottom: 'var(--space-3)'
      }}>
        <div>
          <div className="text font-bold" style={{ fontSize: '12pt' }}>
            <DollarSign style={{ width: '14px', height: '14px', display: 'inline', marginRight: 'var(--space-1)' }} />
            Financial Overview
          </div>
          <div className="text-small" style={{ color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
            Receipts, expenses, and financial tracking
          </div>
        </div>
        <button
          onClick={onUploadClick}
          style={{
            border: '1px solid var(--upload-blue)',
            backgroundColor: 'var(--upload-blue-light)',
            padding: 'var(--space-2) var(--space-3)',
            cursor: 'pointer',
            fontSize: 'var(--font-size-small)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1)'
          }}
        >
          <Upload style={{ width: '10px', height: '10px' }} />
          Upload Documents
        </button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)'
        }}>
          <div className="summary-card" style={{
            border: '1px solid var(--border-light)',
            backgroundColor: 'var(--white)',
            padding: 'var(--space-3)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="text-small" style={{ color: 'var(--text-muted)' }}>Total Expenses</div>
                <div className="text font-bold" style={{ fontSize: '11pt', marginTop: 'var(--space-1)' }}>
                  {formatCurrency(summary.totalExpenses)}
                </div>
              </div>
              <DollarSign style={{ width: '12px', height: '12px', color: 'green' }} />
            </div>
          </div>

          <div className="summary-card" style={{
            border: '1px solid var(--border-light)',
            backgroundColor: 'var(--white)',
            padding: 'var(--space-3)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="text-small" style={{ color: 'var(--text-muted)' }}>Build Costs</div>
                <div className="text font-bold" style={{ fontSize: '11pt', marginTop: 'var(--space-1)' }}>
                  {formatCurrency(summary.totalBuildCosts)}
                </div>
              </div>
              <TrendingUp style={{ width: '12px', height: '12px', color: 'blue' }} />
            </div>
          </div>

          <div className="summary-card" style={{
            border: '1px solid var(--border-light)',
            backgroundColor: 'var(--white)',
            padding: 'var(--space-3)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="text-small" style={{ color: 'var(--text-muted)' }}>Documents</div>
                <div className="text font-bold" style={{ fontSize: '11pt', marginTop: 'var(--space-1)' }}>
                  {summary.financialDocs} of {summary.totalDocuments}
                </div>
                <div className="text-small" style={{ color: 'var(--text-muted)' }}>with financial data</div>
              </div>
              <FileText style={{ width: '12px', height: '12px', color: 'purple' }} />
            </div>
          </div>

          <div className="summary-card" style={{
            border: '1px solid var(--border-light)',
            backgroundColor: 'var(--white)',
            padding: 'var(--space-3)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="text-small" style={{ color: 'var(--text-muted)' }}>Vendors</div>
                <div className="text font-bold" style={{ fontSize: '11pt', marginTop: 'var(--space-1)' }}>
                  {summary.uniqueVendors}
                </div>
                <div className="text-small" style={{ color: 'var(--text-muted)' }}>unique suppliers</div>
              </div>
              <Building style={{ width: '12px', height: '12px', color: 'orange' }} />
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)', borderBottom: '1px solid var(--border-light)' }}>
          {['overview', 'documents', 'monthly'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                border: 'none',
                backgroundColor: 'transparent',
                padding: 'var(--space-2)',
                cursor: 'pointer',
                fontSize: 'var(--font-size-small)',
                borderBottom: activeTab === tab ? '2px solid var(--upload-blue)' : '2px solid transparent',
                textTransform: 'capitalize'
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && summary && (
        <div>
          {/* AI Processing Status */}
          <div className="ai-status" style={{
            border: '1px solid var(--border-light)',
            backgroundColor: 'var(--upload-blue-light)',
            padding: 'var(--space-3)',
            marginBottom: 'var(--space-4)'
          }}>
            <div className="text font-bold" style={{ marginBottom: 'var(--space-2)' }}>
              AI Processing Status
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <div className="text-small">Processed Documents</div>
                <div className="text">{summary.aiProcessedDocs} / {summary.totalDocuments}</div>
              </div>
              <div>
                <div className="text-small">Average Confidence</div>
                <div className="text">{(summary.avgAiConfidence * 100).toFixed(1)}%</div>
              </div>
            </div>
          </div>

          {/* Top Vendors */}
          {summary.vendorList.length > 0 && (
            <div className="vendors-section" style={{
              border: '1px solid var(--border-light)',
              backgroundColor: 'var(--white)',
              padding: 'var(--space-3)'
            }}>
              <div className="text font-bold" style={{ marginBottom: 'var(--space-2)' }}>
                Top Vendors
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                {summary.vendorList.slice(0, 8).map((vendor, index) => (
                  <div key={index} className="vendor-tag" style={{
                    backgroundColor: 'var(--grey-100)',
                    border: '1px solid var(--border-light)',
                    padding: 'var(--space-1) var(--space-2)',
                    fontSize: 'var(--font-size-small)'
                  }}>
                    <Building style={{ width: '8px', height: '8px', display: 'inline', marginRight: 'var(--space-1)' }} />
                    {vendor}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'documents' && (
        <div className="documents-section">
          <div className="text font-bold" style={{ marginBottom: 'var(--space-3)' }}>
            Recent Documents
          </div>
          {recentDocs.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: 'var(--space-6)',
              border: '2px dashed var(--border-medium)',
              backgroundColor: 'var(--grey-50)'
            }}>
              <FileText style={{ width: '24px', height: '24px', margin: '0 auto var(--space-2)', display: 'block' }} />
              <div className="text">No documents uploaded yet</div>
              <div className="text-small" style={{ color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
                Upload receipts and invoices to track expenses
              </div>
              <button
                onClick={onUploadClick}
                style={{
                  border: '1px solid var(--upload-blue)',
                  backgroundColor: 'var(--upload-blue-light)',
                  padding: 'var(--space-2) var(--space-3)',
                  cursor: 'pointer',
                  fontSize: 'var(--font-size-small)',
                  marginTop: 'var(--space-3)'
                }}
              >
                Upload Documents
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {recentDocs.map(doc => (
                <div key={doc.id} className="document-item" style={{
                  border: '1px solid var(--border-light)',
                  backgroundColor: 'var(--white)',
                  padding: 'var(--space-3)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
                        {getDocumentTypeIcon(doc.documentType)}
                        <span className="text font-bold">{doc.filename}</span>
                        {getStatusIcon(doc.processingStatus)}
                      </div>
                      <div className="text-small" style={{ color: 'var(--text-muted)' }}>
                        {doc.vendorName && `${doc.vendorName} • `}
                        {doc.dateOfDocument && new Date(doc.dateOfDocument).toLocaleDateString()}
                        {doc.processingStatus === 'completed' && doc.aiConfidence > 0 &&
                          ` • ${(doc.aiConfidence * 100).toFixed(0)}% confidence`
                        }
                      </div>
                    </div>
                    {doc.hasFinancialData && doc.totalAmount > 0 && (
                      <div className="text font-bold" style={{ color: 'green' }}>
                        {formatCurrency(doc.totalAmount)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'monthly' && (
        <div className="monthly-section">
          <div className="text font-bold" style={{ marginBottom: 'var(--space-3)' }}>
            Monthly Spending
          </div>
          {monthlyData.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
              <div className="text">No monthly data available</div>
              <div className="text-small" style={{ color: 'var(--text-muted)' }}>
                Upload documents with dates to see spending trends
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {monthlyData.map((month, index) => (
                <div key={index} className="month-item" style={{
                  border: '1px solid var(--border-light)',
                  backgroundColor: 'var(--white)',
                  padding: 'var(--space-3)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                    <div>
                      <div className="text font-bold">{month.month}</div>
                      <div className="text-small" style={{ color: 'var(--text-muted)' }}>
                        {month.documentCount} document{month.documentCount !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <div className="text font-bold" style={{ fontSize: '11pt' }}>
                      {formatCurrency(month.total)}
                    </div>
                  </div>
                  {month.vendors.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
                      {month.vendors.slice(0, 5).map((vendor, vIndex) => (
                        <span key={vIndex} className="text-small" style={{
                          backgroundColor: 'var(--grey-100)',
                          padding: '0 var(--space-1)',
                          border: '1px solid var(--border-light)'
                        }}>
                          {vendor}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      </div>
    </VehicleErrorBoundary>
  );
});

VehicleFinancialDashboard.displayName = 'VehicleFinancialDashboard';

export default VehicleFinancialDashboard;