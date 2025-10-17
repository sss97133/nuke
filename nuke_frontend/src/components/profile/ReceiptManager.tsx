import React, { useState, useEffect } from 'react';
import { ProfessionalToolsService } from '../../services/professionalToolsService';

interface Receipt {
  id: string;
  original_filename: string;
  supplier_name?: string;
  receipt_date?: string;
  total_amount?: number;
  is_active: boolean;
  tools_extracted?: number;
  tools_saved?: number;
  created_at: string;
  items?: { count: number }[];
}

interface ReceiptManagerProps {
  userId: string;
  onReceiptsChanged: () => void;
}

const ReceiptManager: React.FC<ReceiptManagerProps> = ({ userId, onReceiptsChanged }) => {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  const loadReceipts = async () => {
    setLoading(true);
    try {
      const data = await ProfessionalToolsService.getUserReceipts(userId);
      setReceipts(data);
    } catch (error) {
      console.error('Error loading receipts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = async () => {
    setRebuilding(true);
    try {
      const inserted = await ProfessionalToolsService.regenerateInventoryFromActiveReceipts(userId);
      await onReceiptsChanged();
      alert(`Inventory rebuilt from active receipts. Tools: ${inserted}`);
    } catch (e) {
      console.error('Error regenerating inventory:', e);
      alert('Failed to regenerate inventory');
    } finally {
      setRebuilding(false);
    }
  };

  useEffect(() => {
    loadReceipts();
  }, [userId]);

  const handleToggle = async (receiptId: string, currentState: boolean) => {
    setToggling(receiptId);
    try {
      await ProfessionalToolsService.toggleReceiptVisibility(receiptId, !currentState);
      await loadReceipts();
      onReceiptsChanged();
    } catch (error) {
      console.error('Error toggling receipt:', error);
      alert('Failed to toggle receipt visibility');
    } finally {
      setToggling(null);
    }
  };

  const handleDelete = async (receiptId: string, filename: string) => {
    if (!confirm(`Permanently delete "${filename}" and all its tools?`)) {
      return;
    }
    
    try {
      await ProfessionalToolsService.deleteReceipt(receiptId);
      await loadReceipts();
      onReceiptsChanged();
    } catch (error) {
      console.error('Error deleting receipt:', error);
      alert('Failed to delete receipt');
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-3)', textAlign: 'center' }}>
        <p className="text-small text-muted">Loading receipts...</p>
      </div>
    );
  }

  if (receipts.length === 0) {
    return (
      <div style={{ padding: 'var(--space-3)', textAlign: 'center' }}>
        <p className="text-small text-muted">No receipts uploaded yet</p>
      </div>
    );
  }

  return (
    <div style={{ 
      border: '1px inset var(--border-medium)',
      background: 'var(--white)',
      maxHeight: '400px',
      overflowY: 'auto'
    }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '6px', gap: '8px', background: 'var(--grey-100)', borderBottom: '1px solid var(--border-light)' }}>
        <button
          onClick={handleRegenerate}
          disabled={rebuilding}
          style={{ padding: '4px 10px', fontSize: '11px', cursor: 'pointer' }}
          title="Rebuild toolbox from active receipts"
        >
          {rebuilding ? 'Rebuilding…' : 'Regenerate Inventory'}
        </button>
      </div>
      <table style={{ 
        width: '100%', 
        borderCollapse: 'collapse',
        fontSize: '11px',
        fontFamily: 'var(--font-mono)'
      }}>
        <thead style={{ 
          background: 'var(--grey-300)',
          borderBottom: '2px solid var(--border-dark)',
          position: 'sticky',
          top: 0,
          zIndex: 1
        }}>
          <tr>
            <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 'bold', borderRight: '1px solid var(--border-medium)' }}>
              VISIBLE
            </th>
            <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 'bold', borderRight: '1px solid var(--border-medium)' }}>
              FILE
            </th>
            <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 'bold', borderRight: '1px solid var(--border-medium)' }}>
              SUPPLIER
            </th>
            <th style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 'bold', borderRight: '1px solid var(--border-medium)' }}>
              TOOLS
            </th>
            <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 'bold', borderRight: '1px solid var(--border-medium)' }}>
              AMOUNT
            </th>
            <th style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 'bold' }}>
              ACTIONS
            </th>
          </tr>
        </thead>
        <tbody>
          {receipts.map(receipt => {
            const toolCount = receipt.items?.[0]?.count || receipt.tools_saved || 0;
            
            return (
              <tr 
                key={receipt.id}
                style={{ 
                  borderBottom: '1px solid var(--border-light)',
                  background: receipt.is_active ? 'var(--white)' : 'var(--grey-100)',
                  opacity: receipt.is_active ? 1 : 0.5
                }}
              >
                <td style={{ padding: '4px 8px', borderRight: '1px solid var(--border-light)', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={receipt.is_active}
                    onChange={() => handleToggle(receipt.id, receipt.is_active)}
                    disabled={toggling === receipt.id}
                    style={{ cursor: 'pointer' }}
                    title={receipt.is_active ? 'Hide tools from this receipt' : 'Show tools from this receipt'}
                  />
                </td>
                <td style={{ 
                  padding: '4px 8px', 
                  borderRight: '1px solid var(--border-light)',
                  maxWidth: '200px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {receipt.original_filename}
                </td>
                <td style={{ padding: '4px 8px', borderRight: '1px solid var(--border-light)' }}>
                  {receipt.supplier_name || '-'}
                </td>
                <td style={{ padding: '4px 8px', borderRight: '1px solid var(--border-light)', textAlign: 'center', fontWeight: 'bold' }}>
                  {toolCount}
                </td>
                <td style={{ padding: '4px 8px', borderRight: '1px solid var(--border-light)', textAlign: 'right' }}>
                  {receipt.total_amount ? `$${receipt.total_amount.toFixed(2)}` : '-'}
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                  <button
                    onClick={() => handleDelete(receipt.id, receipt.original_filename)}
                    style={{
                      padding: '2px 6px',
                      fontSize: '10px',
                      background: 'var(--danger)',
                      color: 'var(--white)',
                      border: '1px outset var(--border-medium)',
                      cursor: 'pointer'
                    }}
                    title="Permanently delete this receipt"
                  >
                    DELETE
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      
      <div style={{ 
        padding: '8px',
        background: 'var(--grey-200)',
        borderTop: '1px solid var(--border-dark)',
        fontSize: '11px',
        color: 'var(--text-muted)'
      }}>
        Tip: Toggle receipts on/off to show/hide their tools. Original files are preserved.
      </div>
    </div>
  );
};

export default ReceiptManager;
