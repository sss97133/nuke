import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface VehiclePriceSectionProps {
  vehicleId: string;
  isOwner: boolean;
  onEdit?: () => void;
}

interface PriceData {
  msrp?: number | null;
  current_value?: number | null;
  purchase_price?: number | null;
  purchase_date?: string | null;
  asking_price?: number | null;
  sale_price?: number | null;
  is_for_sale?: boolean;
  currency?: string;
}

const VehiclePriceSection: React.FC<VehiclePriceSectionProps> = ({ vehicleId, isOwner, onEdit }) => {
  const [priceData, setPriceData] = useState<PriceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<PriceData>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPriceData();
  }, [vehicleId]);

  const loadPriceData = async () => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('vehicles')
        .select('msrp, current_value, purchase_price, purchase_date, asking_price, sale_price, is_for_sale')
        .eq('id', vehicleId)
        .single();

      if (error) {
        console.error('Error loading price data:', error);
        return;
      }

      setPriceData(data);
    } catch (err) {
      console.error('Error in loadPriceData:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatPrice = (price: number | null | undefined): string => {
    if (!price) return 'Not specified';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(price);
  };

  const formatDate = (dateString: string | null | undefined): string => {
    if (!dateString) return 'Not specified';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  const calculateValueChange = () => {
    if (!priceData?.purchase_price || !priceData?.current_value) return null;

    const change = priceData.current_value - priceData.purchase_price;
    const percentChange = (change / priceData.purchase_price) * 100;

    return {
      amount: change,
      percent: percentChange,
      isPositive: change >= 0
    };
  };

  const handleEdit = () => {
    setEditData({ ...priceData });
    setEditing(true);
  };

  const handleCancel = () => {
    setEditing(false);
    setEditData({});
  };

  const handleSave = async () => {
    if (!editData) return;

    try {
      setSaving(true);

      const { error } = await supabase
        .from('vehicles')
        .update({
          msrp: editData.msrp,
          current_value: editData.current_value,
          purchase_price: editData.purchase_price,
          purchase_date: editData.purchase_date,
          asking_price: editData.asking_price,
          sale_price: editData.sale_price,
          is_for_sale: editData.is_for_sale
        })
        .eq('id', vehicleId);

      if (error) {
        console.error('Error saving price data:', error);
        return;
      }

      // Best-effort: append changed fields to vehicle_price_history
      try {
        const mappings = [
          { key: 'msrp', type: 'msrp' },
          { key: 'purchase_price', type: 'purchase' },
          { key: 'current_value', type: 'current' },
          { key: 'asking_price', type: 'asking' },
          { key: 'sale_price', type: 'sale' }
        ] as const;
        const entries: any[] = [];
        mappings.forEach(({ key, type }) => {
          const before = (priceData as any)?.[key];
          const after = (editData as any)?.[key];
          if (typeof after === 'number' && after !== before) {
            entries.push({ vehicle_id: vehicleId, price_type: type, value: after, source: 'vehicle_ui' });
          }
        });
        if (entries.length > 0) {
          const { error: histErr } = await supabase.from('vehicle_price_history').insert(entries);
          if (histErr) console.debug('history insert skipped:', histErr.message);
        }
      } catch (e) {
        console.debug('history insert error:', e);
      }

      setPriceData({ ...editData });
      setEditing(false);
      setEditData({});

    } catch (err) {
      console.error('Error in handleSave:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleInputChange = (field: keyof PriceData, value: string | boolean) => {
    setEditData(prev => ({
      ...prev,
      [field]: field === 'is_for_sale' ? value : (value === '' ? null : Number(value))
    }));
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-header">Price Information</div>
        <div className="card-body">
          <div className="text-center text-muted">Loading price data...</div>
        </div>
      </div>
    );
  }

  const valueChange = calculateValueChange();

  return (
    <div className="card">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Price Information</span>
        {isOwner && (
          <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
            {editing ? (
              <>
                <button
                  className="button button-small"
                  onClick={handleCancel}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  className="button button-small button-primary"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </>
            ) : (
              <button className="button button-small button-primary" onClick={handleEdit}>
                Edit Prices
              </button>
            )}
          </div>
        )}
      </div>
      <div className="card-body">
        <div className="vehicle-details">
          
          {/* Current Market Value */}
          <div className="vehicle-detail">
            <span>Current Market Value</span>
            {editing ? (
              <input
                type="number"
                className="form-input"
                style={{ width: '120px', textAlign: 'right' }}
                value={editData.current_value || ''}
                onChange={(e) => handleInputChange('current_value', e.target.value)}
                placeholder="Market value"
              />
            ) : (
              <span className="text font-bold">
                {formatPrice(priceData?.current_value)}
              </span>
            )}
          </div>

          {/* For Sale Status */}
          {(editing || priceData?.is_for_sale) && (
            <div className="vehicle-detail">
              <span>Status</span>
              {editing ? (
                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                  <input
                    type="checkbox"
                    checked={editData.is_for_sale || false}
                    onChange={(e) => handleInputChange('is_for_sale', e.target.checked)}
                  />
                  For Sale
                </label>
              ) : (
                <span>
                  <span className="badge badge-success">FOR SALE</span>
                </span>
              )}
            </div>
          )}

          {((editing && editData.is_for_sale) || (priceData?.is_for_sale && priceData?.asking_price)) && (
            <div className="vehicle-detail">
              <span>Asking Price</span>
              {editing ? (
                <input
                  type="number"
                  className="form-input"
                  style={{ width: '120px', textAlign: 'right' }}
                  value={editData.asking_price || ''}
                  onChange={(e) => handleInputChange('asking_price', e.target.value)}
                  placeholder="Asking price"
                />
              ) : (
                <span className="text font-bold">
                  {formatPrice(priceData?.asking_price)}
                </span>
              )}
            </div>
          )}

          {/* Value Change Indicator */}
          {valueChange && (
            <div className="vehicle-detail">
              <span>Value Change</span>
              <span className="text" style={{ color: valueChange.isPositive ? '#008000' : '#800000' }}>
                {valueChange.isPositive ? '↑' : '↓'} {formatPrice(Math.abs(valueChange.amount))}
                ({valueChange.percent.toFixed(1)}%)
              </span>
            </div>
          )}

          {/* Original MSRP */}
          <div className="vehicle-detail">
            <span>Original MSRP</span>
            {editing ? (
              <input
                type="number"
                className="form-input"
                style={{ width: '120px', textAlign: 'right' }}
                value={editData.msrp || ''}
                onChange={(e) => handleInputChange('msrp', e.target.value)}
                placeholder="Original MSRP"
              />
            ) : (
              <span>{formatPrice(priceData?.msrp)}</span>
            )}
          </div>

          {/* Purchase Price */}
          <div className="vehicle-detail">
            <span>Purchase Price</span>
            {editing ? (
              <input
                type="number"
                className="form-input"
                style={{ width: '120px', textAlign: 'right' }}
                value={editData.purchase_price || ''}
                onChange={(e) => handleInputChange('purchase_price', e.target.value)}
                placeholder="Purchase price"
              />
            ) : (
              <span>{formatPrice(priceData?.purchase_price)}</span>
            )}
          </div>

          {/* Purchase Date */}
          {(editing || priceData?.purchase_date) && (
            <div className="vehicle-detail">
              <span>Purchase Date</span>
              {editing ? (
                <input
                  type="date"
                  className="form-input"
                  style={{ width: '140px' }}
                  value={editData.purchase_date || ''}
                  onChange={(e) => setEditData(prev => ({ ...prev, purchase_date: e.target.value }))}
                />
              ) : (
                <span>{formatDate(priceData?.purchase_date)}</span>
              )}
            </div>
          )}

          {/* Last Sale Price */}
          {priceData?.sale_price && (
            <div className="vehicle-detail">
              <span>Last Sale Price</span>
              <span>{formatPrice(priceData.sale_price)}</span>
            </div>
          )}

          {/* Market Analysis */}
          {priceData?.current_value && priceData?.msrp && (
            <>
              <div className="vehicle-detail">
                <span>Depreciation from MSRP</span>
                <span className="text-small">
                  {((1 - (priceData.current_value / priceData.msrp)) * 100).toFixed(1)}%
                </span>
              </div>
              
              {priceData?.purchase_price && (
                <div className="vehicle-detail">
                  <span>ROI from Purchase</span>
                  <span className="text-small" style={{ color: priceData.current_value >= priceData.purchase_price ? '#008000' : '#800000' }}>
                    {((priceData.current_value / priceData.purchase_price - 1) * 100).toFixed(1)}%
                  </span>
                </div>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  );
};

export default VehiclePriceSection;
