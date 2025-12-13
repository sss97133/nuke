import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import '../../design-system.css';

interface Receipt {
  id: string;
  file_url: string;
  file_name: string;
  upload_date: string;
  processing_status: string;
  vendor_name: string;
  transaction_date: string;
  total_amount: number;
  tax_amount: number;
  confidence_score: number;
}

interface ReceiptItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  category: string;
  part_number?: string;
}

interface ReceiptViewerProps {
  receiptId?: string;
}

const ReceiptViewer = ({ receiptId }: ReceiptViewerProps) => {
  const { user } = useAuth();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [receiptItems, setReceiptItems] = useState<ReceiptItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (receiptId) {
      loadReceipt(receiptId);
    } else {
      loadUserReceipts();
    }
  }, [receiptId]);

  const loadUserReceipts = async () => {
    if (!user) return;

    setLoading(true);
    const { data, error } = await supabase
      .from('receipts')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('upload_date', { ascending: false });

    if (error) {
      console.error('Error loading receipts:', error);
    } else {
      setReceipts(data || []);
    }
    setLoading(false);
  };

  const loadReceipt = async (id: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('receipts')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error loading receipt:', error);
    } else {
      setSelectedReceipt(data);
      loadReceiptItems(id);
    }
    setLoading(false);
  };

  const loadReceiptItems = async (receiptId: string) => {
    const { data, error } = await supabase
      .from('receipt_items')
      .select('*')
      .eq('receipt_id', receiptId)
      .order('description');

    if (error) {
      console.error('Error loading receipt items:', error);
    } else {
      setReceiptItems(data || []);
    }
  };

  const handleReceiptSelect = (receipt: Receipt) => {
    setSelectedReceipt(receipt);
    loadReceiptItems(receipt.id);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount || 0);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'processed': return '#166534';
      case 'processing': return '#d97706';
      case 'failed': return '#dc2626';
      default: return '#6b7280';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'processed': return '✅';
      case 'processing': return 'Processing';
      case 'failed': return '❌';
      default: return 'Pending';
    }
  };

  if (loading) {
    return (
      <div style={{
        background: '#f5f5f5',
        border: '1px solid #bdbdbd',
        padding: '16px',
        margin: '16px',
        fontSize: '8pt',
        textAlign: 'center'
      }}>
        Loading receipts...
      </div>
    );
  }

  return (
    <div style={{
      background: '#f5f5f5',
      border: '1px solid #bdbdbd',
      padding: '16px',
      margin: '16px',
      fontFamily: 'Arial, sans-serif'
    }}>
      <h3 style={{ fontSize: '8pt', fontWeight: 'bold', margin: '0 0 8px 0' }}>
        🧾 Receipt Manager
      </h3>

      <div style={{ display: 'flex', gap: '16px' }}>
        {/* Receipt List */}
        <div style={{ flex: '1', minWidth: '200px' }}>
          <h4 style={{ fontSize: '8pt', fontWeight: 'bold', margin: '0 0 8px 0' }}>
            Your Receipts ({receipts.length})
          </h4>

          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            {receipts.map(receipt => (
              <div
                key={receipt.id}
                onClick={() => handleReceiptSelect(receipt)}
                style={{
                  background: selectedReceipt?.id === receipt.id ? '#e0e0e0' : 'white',
                  border: '1px solid #bdbdbd',
                  padding: '8px',
                  marginBottom: '4px',
                  cursor: 'pointer',
                  fontSize: '8pt'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 'bold' }}>
                    {receipt.vendor_name || 'Unknown Vendor'}
                  </div>
                  <div style={{ color: getStatusColor(receipt.processing_status) }}>
                    {getStatusIcon(receipt.processing_status)}
                  </div>
                </div>
                <div style={{ color: '#757575', fontSize: '7pt' }}>
                  {formatDate(receipt.transaction_date || receipt.upload_date)}
                </div>
                <div style={{ fontWeight: 'bold' }}>
                  {formatCurrency(receipt.total_amount)}
                </div>
              </div>
            ))}
          </div>

          {receipts.length === 0 && (
            <div style={{
              background: 'white',
              border: '1px solid #bdbdbd',
              padding: '16px',
              textAlign: 'center',
              fontSize: '8pt',
              color: '#757575'
            }}>
              No receipts uploaded yet
            </div>
          )}
        </div>

        {/* Receipt Details */}
        {selectedReceipt && (
          <div style={{ flex: '2' }}>
            <div style={{
              background: 'white',
              border: '1px solid #bdbdbd',
              padding: '12px',
              marginBottom: '8px'
            }}>
              <div style={{ fontSize: '8pt', fontWeight: 'bold', marginBottom: '8px' }}>
                Receipt Details
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '8pt' }}>
                <div>
                  <strong>Vendor:</strong> {selectedReceipt.vendor_name || 'N/A'}
                </div>
                <div>
                  <strong>Date:</strong> {formatDate(selectedReceipt.transaction_date || selectedReceipt.upload_date)}
                </div>
                <div>
                  <strong>Total:</strong> {formatCurrency(selectedReceipt.total_amount)}
                </div>
                <div>
                  <strong>Tax:</strong> {formatCurrency(selectedReceipt.tax_amount)}
                </div>
                <div>
                  <strong>Status:</strong>
                  <span style={{ color: getStatusColor(selectedReceipt.processing_status), marginLeft: '4px' }}>
                    {getStatusIcon(selectedReceipt.processing_status)} {selectedReceipt.processing_status}
                  </span>
                </div>
                <div>
                  <strong>Confidence:</strong> {Math.round((selectedReceipt.confidence_score || 0) * 100)}%
                </div>
              </div>

              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #e0e0e0' }}>
                <a
                  href={selectedReceipt.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: '#424242',
                    fontSize: '8pt',
                    textDecoration: 'underline'
                  }}
                >
                  📄 View Original Receipt
                </a>
              </div>
            </div>

            {/* Receipt Items */}
            <div style={{
              background: 'white',
              border: '1px solid #bdbdbd',
              padding: '12px'
            }}>
              <div style={{ fontSize: '8pt', fontWeight: 'bold', marginBottom: '8px' }}>
                Extracted Items ({receiptItems.length})
              </div>

              {receiptItems.length > 0 ? (
                <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                  {receiptItems.map(item => (
                    <div
                      key={item.id}
                      style={{
                        background: '#f8fafc',
                        border: '1px solid #e5e7eb',
                        padding: '8px',
                        marginBottom: '4px',
                        fontSize: '8pt'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ flex: '1' }}>
                          <div style={{ fontWeight: 'bold' }}>{item.description}</div>
                          {item.part_number && (
                            <div style={{ color: '#6b7280', fontSize: '7pt' }}>
                              Part #: {item.part_number}
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div>{formatCurrency(item.line_total)}</div>
                          {item.quantity > 1 && (
                            <div style={{ fontSize: '7pt', color: '#6b7280' }}>
                              {item.quantity} × {formatCurrency(item.unit_price)}
                            </div>
                          )}
                        </div>
                      </div>
                      {item.category && (
                        <div style={{
                          background: '#dbeafe',
                          color: '#1e40af',
                          padding: '2px 6px',
                          borderRadius: '0px',
                          fontSize: '7pt',
                          display: 'inline-block',
                          marginTop: '4px'
                        }}>
                          {item.category}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{
                  background: '#f8fafc',
                  padding: '16px',
                  textAlign: 'center',
                  fontSize: '8pt',
                  color: '#757575'
                }}>
                  {selectedReceipt.processing_status === 'processing'
                    ? 'Processing receipt items...'
                    : 'No items extracted from this receipt'
                  }
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReceiptViewer;