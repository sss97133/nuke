import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface ReceiptManagerProps {
  vehicleId: string;
  canEdit: boolean;
}

interface Receipt {
  id: string;
  vehicle_id: string;
  receipt_type: 'maintenance' | 'parts' | 'fuel' | 'insurance' | 'registration' | 'other';
  amount: number;
  currency: string;
  vendor_name: string;
  description: string;
  receipt_date: string;
  image_url?: string;
  verified: boolean;
  created_by: string;
  created_at: string;
}

export default function ReceiptManager({ vehicleId, canEdit }: ReceiptManagerProps) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [formData, setFormData] = useState({
    receipt_type: 'maintenance' as const,
    amount: '',
    vendor_name: '',
    description: '',
    receipt_date: new Date().toISOString().split('T')[0],
    image_file: null as File | null
  });

  useEffect(() => {
    loadReceipts();
  }, [vehicleId]);

  const loadReceipts = async () => {
    try {
      // Try to load from vehicle_receipts table, fall back gracefully if not exists
      const { data, error } = await supabase
        .from('vehicle_receipts')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('receipt_date', { ascending: false });

      if (!error && data) {
        setReceipts(data);
      } else {
        // Table doesn't exist, use empty array for now
        console.debug('Receipts table not available, using mock data');
        setReceipts([]);
      }
    } catch (err) {
      console.debug('Receipts feature not available');
      setReceipts([]);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFormData(prev => ({ ...prev, image_file: file }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;

    setUploading(true);
    try {
      let imageUrl = null;

      // Upload image if provided
      if (formData.image_file) {
        const fileExt = formData.image_file.name.split('.').pop();
        const fileName = `${vehicleId}/receipts/${Date.now()}.${fileExt}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('vehicle-images')
          .upload(fileName, formData.image_file);

        if (!uploadError && uploadData) {
          const { data: urlData } = supabase.storage
            .from('vehicle-images')
            .getPublicUrl(uploadData.path);
          imageUrl = urlData.publicUrl;
        }
      }

      // Save receipt record
      const receiptData = {
        vehicle_id: vehicleId,
        receipt_type: formData.receipt_type,
        amount: parseFloat(formData.amount),
        currency: 'USD',
        vendor_name: formData.vendor_name,
        description: formData.description,
        receipt_date: formData.receipt_date,
        image_url: imageUrl,
        verified: false
      };

      const { error } = await supabase
        .from('vehicle_receipts')
        .insert([receiptData]);

      if (error) {
        if (error.message.includes('relation') || error.message.includes('does not exist')) {
          // Store in timeline events as a fallback
          await supabase.from('timeline_events').insert({
            vehicle_id: vehicleId,
            event_type: 'maintenance',
            title: `Receipt: ${formData.vendor_name}`,
            description: `${formData.description}\nAmount: $${formData.amount}`,
            event_date: formData.receipt_date,
            metadata: {
              receipt_type: formData.receipt_type,
              amount: parseFloat(formData.amount),
              vendor: formData.vendor_name,
              image_url: imageUrl
            }
          });
        } else {
          throw error;
        }
      }

      // Reset form
      setFormData({
        receipt_type: 'maintenance',
        amount: '',
        vendor_name: '',
        description: '',
        receipt_date: new Date().toISOString().split('T')[0],
        image_file: null
      });
      setShowAddForm(false);
      loadReceipts();

      alert('Receipt added successfully!');
    } catch (err) {
      console.error('Error adding receipt:', err);
      alert('Failed to add receipt. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const getTotalSpending = () => {
    return receipts.reduce((sum, receipt) => sum + receipt.amount, 0);
  };

  const getSpendingByType = () => {
    const spending: Record<string, number> = {};
    receipts.forEach(receipt => {
      spending[receipt.receipt_type] = (spending[receipt.receipt_type] || 0) + receipt.amount;
    });
    return spending;
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-body text-center">Loading receipts...</div>
      </div>
    );
  }

  if (showAddForm) {
    return (
      <div className="card">
        <div className="card-header">Add Receipt</div>
        <div className="card-body">
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gap: '16px' }}>
              <div>
                <label className="text-small font-bold">Type</label>
                <select
                  value={formData.receipt_type}
                  onChange={(e) => setFormData(prev => ({ ...prev, receipt_type: e.target.value as any }))}
                  className="form-input"
                  style={{ width: '100%' }}
                >
                  <option value="maintenance">Maintenance</option>
                  <option value="parts">Parts</option>
                  <option value="fuel">Fuel</option>
                  <option value="insurance">Insurance</option>
                  <option value="registration">Registration</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="text-small font-bold">Amount ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData(prev => ({ ...prev, amount: e.target.value }))}
                  className="form-input"
                  style={{ width: '100%' }}
                  required
                />
              </div>

              <div>
                <label className="text-small font-bold">Vendor/Shop</label>
                <input
                  type="text"
                  value={formData.vendor_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, vendor_name: e.target.value }))}
                  className="form-input"
                  style={{ width: '100%' }}
                  required
                />
              </div>

              <div>
                <label className="text-small font-bold">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="form-input"
                  style={{ width: '100%', minHeight: '80px' }}
                  required
                />
              </div>

              <div>
                <label className="text-small font-bold">Date</label>
                <input
                  type="date"
                  value={formData.receipt_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, receipt_date: e.target.value }))}
                  className="form-input"
                  style={{ width: '100%' }}
                  required
                />
              </div>

              <div>
                <label className="text-small font-bold">Receipt Image (optional)</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="form-input"
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="button button-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="button button-primary"
                >
                  {uploading ? 'Adding...' : 'Add Receipt'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    );
  }

  const spendingByType = getSpendingByType();

  return (
    <div className="card">
      <div className="card-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Receipts & Expenses</span>
          {canEdit && (
            <button onClick={() => setShowAddForm(true)} className="button button-primary">
              Add Receipt
            </button>
          )}
        </div>
      </div>
      <div className="card-body">

        {/* Summary */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px' }}>
            <div className="alert alert-info" style={{ textAlign: 'center' }}>
              <div className="text-small text-muted">Total Spending</div>
              <div className="text font-bold">${getTotalSpending().toLocaleString()}</div>
            </div>
            <div className="alert alert-secondary" style={{ textAlign: 'center' }}>
              <div className="text-small text-muted">Receipt Count</div>
              <div className="text font-bold">{receipts.length}</div>
            </div>
            <div className="alert alert-success" style={{ textAlign: 'center' }}>
              <div className="text-small text-muted">Data Quality Impact</div>
              <div className="text font-bold">+{Math.min(receipts.length * 5, 25)} pts</div>
            </div>
          </div>
        </div>

        {/* Spending Breakdown */}
        {Object.keys(spendingByType).length > 0 && (
          <div style={{ marginBottom: '24px' }}>
            <h4 className="text font-bold" style={{ marginBottom: '12px' }}>Spending by Category</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {Object.entries(spendingByType).map(([type, amount]) => (
                <div key={type} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="text-small" style={{ textTransform: 'capitalize' }}>{type}</span>
                  <span className="text-small font-bold">${amount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Receipt List */}
        {receipts.length === 0 ? (
          <div className="text-center" style={{ padding: '32px 0', color: '#666' }}>
            <p>No receipts added yet.</p>
            {canEdit && (
              <p className="text-small text-muted" style={{ marginTop: '8px' }}>
                Add receipts to improve your vehicle's data quality score and prove maintenance history.
              </p>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {receipts.map((receipt) => (
              <div key={receipt.id} className="alert alert-default" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="badge badge-secondary" style={{ textTransform: 'capitalize' }}>
                      {receipt.receipt_type}
                    </span>
                    <span className="text font-bold">{receipt.vendor_name}</span>
                    <span className="text-small text-muted">${receipt.amount.toLocaleString()}</span>
                  </div>
                  <p className="text-small">{receipt.description}</p>
                  <p className="text-small text-muted">{new Date(receipt.receipt_date).toLocaleDateString()}</p>
                </div>
                {receipt.image_url && (
                  <button
                    onClick={() => window.open(receipt.image_url, '_blank')}
                    className="button button-small"
                  >
                    View Receipt
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}