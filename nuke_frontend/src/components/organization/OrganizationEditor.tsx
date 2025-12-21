/**
 * Organization Editor Component
 * Allows editing of organization details including currency, pricing, location
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface OrganizationEditorProps {
  organizationId: string;
  onSaved: () => void;
  onClose: () => void;
}

interface OrgData {
  business_name: string;
  legal_name?: string;
  business_type?: string;
  description?: string;
  website?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  country?: string;
  currency?: string;
  labor_rate?: number;
  tax_rate?: number;
  latitude?: number;
  longitude?: number;
  // Neutral facts (human-readable)
  inventory_numbers?: string;
  market_share?: string;
  branding?: string;
  labeling?: string;
  // Valuation
  estimated_value?: number;
  last_valuation_date?: string;
}

export default function OrganizationEditor({ organizationId, onSaved, onClose }: OrganizationEditorProps) {
  const [formData, setFormData] = useState<OrgData>({
    business_name: '',
    country: 'US',
    currency: 'USD'
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadOrganization();
  }, [organizationId]);

  const loadOrganization = async () => {
    try {
      const { data, error } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', organizationId)
        .single();

      if (error) throw error;

      setFormData({
        business_name: data.business_name || '',
        legal_name: data.legal_name || '',
        business_type: data.business_type || '',
        description: data.description || '',
        website: data.website || '',
        email: data.email || '',
        phone: data.phone || '',
        address: data.address || '',
        city: data.city || '',
        state: data.state || '',
        zip_code: data.zip_code || '',
        country: data.country || 'US',
        currency: data.currency || 'USD',
        labor_rate: data.labor_rate || null,
        tax_rate: data.tax_rate || null,
        latitude: data.latitude || null,
        longitude: data.longitude || null,

        // Neutral facts
        inventory_numbers: data.inventory_numbers || '',
        market_share: data.market_share || '',
        branding: data.branding || '',
        labeling: data.labeling || '',

        // Valuation
        estimated_value: typeof data.estimated_value === 'number' ? data.estimated_value : null,
        last_valuation_date: data.last_valuation_date || ''
      });
    } catch (err: any) {
      console.error('Error loading organization:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const { error } = await supabase
        .from('businesses')
        .update({
          ...formData,
          updated_at: new Date().toISOString()
        })
        .eq('id', organizationId);

      if (error) throw error;

      alert('Organization details updated successfully!');
      onSaved();
    } catch (err: any) {
      console.error('Error saving organization:', err);
      setError(err.message);
      alert(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (field: keyof OrgData, value: string | number | null) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  if (loading) {
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999
      }}>
        <div className="card" style={{ maxWidth: '600px', width: '90%', padding: '24px' }}>
          <div>Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      overflow: 'auto',
      padding: '20px'
    }}>
      <div className="card" style={{ 
        maxWidth: '800px', 
        width: '100%', 
        maxHeight: '90vh', 
        overflow: 'auto',
        background: 'var(--white)'
      }}>
        <div className="card-header" style={{ 
          position: 'sticky', 
          top: 0, 
          background: 'var(--white)', 
          zIndex: 1,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h3 style={{ fontSize: '11pt', fontWeight: 700, margin: 0 }}>
            Edit Organization Details
          </h3>
          <button
            onClick={onClose}
            className="button button-small"
            style={{ fontSize: '8pt' }}
          >
            × Close
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="card-body" style={{ padding: '16px' }}>
            {error && (
              <div style={{
                background: 'var(--color-danger-light)',
                border: '1px solid var(--color-danger)',
                padding: '8px 12px',
                borderRadius: '2px',
                marginBottom: '16px',
                fontSize: '9pt'
              }}>
                {error}
              </div>
            )}

            {/* Basic Information */}
            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '12px', color: 'var(--text-muted)' }}>
                Basic Information
              </h4>
              
              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '9pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Business Name *
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={formData.business_name}
                  onChange={(e) => handleChange('business_name', e.target.value)}
                  required
                  style={{ fontSize: '9pt', width: '100%' }}
                />
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '9pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Legal Name
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={formData.legal_name || ''}
                  onChange={(e) => handleChange('legal_name', e.target.value)}
                  style={{ fontSize: '9pt', width: '100%' }}
                />
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '9pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Business Type
                </label>
                <select
                  className="form-input"
                  value={formData.business_type || ''}
                  onChange={(e) => handleChange('business_type', e.target.value)}
                  style={{ fontSize: '9pt', width: '100%' }}
                >
                  <option value="">Select type...</option>
                  <option value="garage">Garage</option>
                  <option value="dealership">Dealership</option>
                  <option value="restoration_shop">Restoration Shop</option>
                  <option value="performance_shop">Performance Shop</option>
                  <option value="body_shop">Body Shop</option>
                  <option value="detailing">Detailing</option>
                  <option value="mobile_service">Mobile Service</option>
                  <option value="specialty_shop">Specialty Shop</option>
                  <option value="parts_supplier">Parts Supplier</option>
                  <option value="fabrication">Fabrication</option>
                  <option value="racing_team">Racing Team</option>
                  <option value="auction_house">Auction House</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '9pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Description
                </label>
                <textarea
                  className="form-input"
                  value={formData.description || ''}
                  onChange={(e) => handleChange('description', e.target.value)}
                  rows={3}
                  style={{ fontSize: '9pt', width: '100%' }}
                />
              </div>
            </div>

            {/* Contact Information */}
            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '12px', color: 'var(--text-muted)' }}>
                Contact Information
              </h4>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '9pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Website
                </label>
                <input
                  type="url"
                  className="form-input"
                  value={formData.website || ''}
                  onChange={(e) => handleChange('website', e.target.value)}
                  placeholder="https://example.com"
                  style={{ fontSize: '9pt', width: '100%' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={{ fontSize: '9pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Email
                  </label>
                  <input
                    type="email"
                    className="form-input"
                    value={formData.email || ''}
                    onChange={(e) => handleChange('email', e.target.value)}
                    style={{ fontSize: '9pt', width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '9pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Phone
                  </label>
                  <input
                    type="tel"
                    className="form-input"
                    value={formData.phone || ''}
                    onChange={(e) => handleChange('phone', e.target.value)}
                    style={{ fontSize: '9pt', width: '100%' }}
                  />
                </div>
              </div>
            </div>

            {/* Location */}
            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '12px', color: 'var(--text-muted)' }}>
                Location
              </h4>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '9pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Address
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={formData.address || ''}
                  onChange={(e) => handleChange('address', e.target.value)}
                  style={{ fontSize: '9pt', width: '100%' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={{ fontSize: '9pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    City
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={formData.city || ''}
                    onChange={(e) => handleChange('city', e.target.value)}
                    style={{ fontSize: '9pt', width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '9pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    State
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={formData.state || ''}
                    onChange={(e) => handleChange('state', e.target.value)}
                    maxLength={2}
                    placeholder="NV"
                    style={{ fontSize: '9pt', width: '100%', textTransform: 'uppercase' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '9pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    ZIP Code
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={formData.zip_code || ''}
                    onChange={(e) => handleChange('zip_code', e.target.value)}
                    maxLength={10}
                    style={{ fontSize: '9pt', width: '100%' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '9pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Latitude
                  </label>
                  <input
                    type="number"
                    step="any"
                    className="form-input"
                    value={formData.latitude || ''}
                    onChange={(e) => handleChange('latitude', e.target.value ? parseFloat(e.target.value) : null)}
                    style={{ fontSize: '9pt', width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '9pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Longitude
                  </label>
                  <input
                    type="number"
                    step="any"
                    className="form-input"
                    value={formData.longitude || ''}
                    onChange={(e) => handleChange('longitude', e.target.value ? parseFloat(e.target.value) : null)}
                    style={{ fontSize: '9pt', width: '100%' }}
                  />
                </div>
              </div>
            </div>

            {/* Financial Settings */}
            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '12px', color: 'var(--text-muted)' }}>
                Financial Settings
              </h4>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '9pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Currency
                  </label>
                  <select
                    className="form-input"
                    value={formData.currency || 'USD'}
                    onChange={(e) => handleChange('currency', e.target.value)}
                    style={{ fontSize: '9pt', width: '100%' }}
                  >
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="GBP">GBP (£)</option>
                    <option value="CAD">CAD ($)</option>
                    <option value="AUD">AUD ($)</option>
                    <option value="JPY">JPY (¥)</option>
                    <option value="CNY">CNY (¥)</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '9pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Labor Rate (per hour)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    className="form-input"
                    value={formData.labor_rate || ''}
                    onChange={(e) => handleChange('labor_rate', e.target.value ? parseFloat(e.target.value) : null)}
                    placeholder="150.00"
                    style={{ fontSize: '9pt', width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '9pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Tax Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    className="form-input"
                    value={formData.tax_rate || ''}
                    onChange={(e) => handleChange('tax_rate', e.target.value ? parseFloat(e.target.value) : null)}
                    placeholder="8.25"
                    style={{ fontSize: '9pt', width: '100%' }}
                  />
                </div>
              </div>
            </div>

            {/* Neutral Facts (human-readable) */}
            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '12px', color: 'var(--text-muted)' }}>
                Neutral Facts
              </h4>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '9pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Inventory Numbers
                </label>
                <textarea
                  className="form-input"
                  value={formData.inventory_numbers || ''}
                  onChange={(e) => handleChange('inventory_numbers', e.target.value)}
                  rows={2}
                  placeholder='e.g., "120 vehicles listed; 18 in-house; 6 lifts"'
                  style={{ fontSize: '9pt', width: '100%' }}
                />
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '9pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Market Share
                </label>
                <textarea
                  className="form-input"
                  value={formData.market_share || ''}
                  onChange={(e) => handleChange('market_share', e.target.value)}
                  rows={2}
                  placeholder='e.g., "8% of AZ restoration shops (as-of 2025-06, source: ...)"'
                  style={{ fontSize: '9pt', width: '100%' }}
                />
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '9pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Branding
                </label>
                <textarea
                  className="form-input"
                  value={formData.branding || ''}
                  onChange={(e) => handleChange('branding', e.target.value)}
                  rows={2}
                  placeholder='e.g., "Correct name: …; Tagline: …; Primary domain: …"'
                  style={{ fontSize: '9pt', width: '100%' }}
                />
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '9pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Labeling
                </label>
                <textarea
                  className="form-input"
                  value={formData.labeling || ''}
                  onChange={(e) => handleChange('labeling', e.target.value)}
                  rows={2}
                  placeholder='e.g., "auction_house; marketplace; service-first"'
                  style={{ fontSize: '9pt', width: '100%' }}
                />
              </div>
            </div>

            {/* Valuation */}
            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '12px', color: 'var(--text-muted)' }}>
                Valuation
              </h4>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '9pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Estimated Value (USD)
                  </label>
                  <input
                    type="number"
                    step="1"
                    className="form-input"
                    value={formData.estimated_value ?? ''}
                    onChange={(e) => handleChange('estimated_value', e.target.value ? parseFloat(e.target.value) : null)}
                    placeholder="2500000"
                    style={{ fontSize: '9pt', width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '9pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Last Valuation Date
                  </label>
                  <input
                    type="date"
                    className="form-input"
                    value={formData.last_valuation_date || ''}
                    onChange={(e) => handleChange('last_valuation_date', e.target.value)}
                    style={{ fontSize: '9pt', width: '100%' }}
                  />
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{
              display: 'flex',
              gap: '8px',
              justifyContent: 'flex-end',
              paddingTop: '16px',
              borderTop: '1px solid var(--border)'
            }}>
              <button
                type="button"
                onClick={onClose}
                className="button button-secondary"
                disabled={saving}
                style={{ fontSize: '9pt' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button button-primary"
                disabled={saving}
                style={{ fontSize: '9pt' }}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

