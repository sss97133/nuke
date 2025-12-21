/**
 * Organization Service Mapper
 * Tool to map and extract services from organization websites
 */

import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface Service {
  service_name: string;
  service_category: string;
  description?: string;
  pricing_model?: string;
  base_price?: number;
  hourly_rate?: number;
  percentage_rate?: number;
  source_url?: string;
}

export const OrganizationServiceMapper: React.FC<{ organizationId: string }> = ({ organizationId }) => {
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [mapping, setMapping] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const extractServices = async () => {
    if (!websiteUrl) {
      setError('Please enter a website URL');
      return;
    }

    setMapping(true);
    setError(null);

    try {
      // Call Edge Function to extract services from website
      const { data, error: extractError } = await supabase.functions.invoke('extract-org-services', {
        body: { website_url: websiteUrl, organization_id: organizationId },
      });

      if (extractError) throw extractError;
      if (data?.error) throw new Error(data.error);

      setServices(data.services || []);
    } catch (err: any) {
      setError(err.message || 'Failed to extract services');
    } finally {
      setMapping(false);
    }
  };

  const saveServices = async () => {
    if (services.length === 0) return;

    setSaving(true);
    setError(null);

    try {
      // Create website mapping
      await supabase
        .from('organization_website_mappings')
        .upsert({
          organization_id: organizationId,
          website_url: websiteUrl,
          base_domain: new URL(websiteUrl).hostname,
          crawl_status: 'completed',
          last_crawled_at: new Date().toISOString(),
        }, {
          onConflict: 'organization_id,base_domain',
        });

      // Save services
      const servicesToInsert = services.map(service => ({
        organization_id: organizationId,
        service_name: service.service_name,
        service_category: service.service_category,
        description: service.description,
        pricing_model: service.pricing_model || 'unknown',
        base_price: service.base_price,
        hourly_rate: service.hourly_rate,
        percentage_rate: service.percentage_rate,
        source_url: service.source_url || websiteUrl,
        discovered_from: 'website',
        is_active: true,
        confidence_score: 75,
      }));

      const { error: servicesError } = await supabase
        .from('organization_services')
        .insert(servicesToInsert);

      if (servicesError) throw servicesError;

      setError(null);
      alert(`Successfully saved ${services.length} services!`);
      setServices([]);
    } catch (err: any) {
      setError(err.message || 'Failed to save services');
    } finally {
      setSaving(false);
    }
  };

  const addManualService = () => {
    setServices([...services, {
      service_name: '',
      service_category: 'other',
    }]);
  };

  const updateService = (index: number, field: keyof Service, value: any) => {
    const updated = [...services];
    updated[index] = { ...updated[index], [field]: value };
    setServices(updated);
  };

  const removeService = (index: number) => {
    setServices(services.filter((_, i) => i !== index));
  };

  return (
    <div style={{
      padding: 'var(--space-4)',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '4px',
    }}>
      <h3 style={{ fontSize: '10pt', fontWeight: 'bold', margin: 0, marginBottom: 'var(--space-3)' }}>
        Organization Service Mapper
      </h3>
      <p style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
        Extract services from organization websites or add them manually for market data analysis.
      </p>

      <div style={{ marginBottom: 'var(--space-3)' }}>
        <label style={{ display: 'block', fontSize: '8pt', fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>
          Website URL
        </label>
        <input
          type="text"
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
          placeholder="https://example.com"
          style={{
            width: '100%',
            padding: 'var(--space-2)',
            fontSize: '8pt',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            background: 'var(--surface-hover)',
          }}
        />
      </div>

      <button
        onClick={extractServices}
        disabled={mapping || !websiteUrl}
        style={{
          padding: 'var(--space-2) var(--space-4)',
          fontSize: '8pt',
          fontWeight: 'bold',
          background: mapping ? 'var(--text-muted)' : 'var(--accent)',
          color: 'var(--white)',
          border: 'none',
          borderRadius: '4px',
          cursor: mapping ? 'not-allowed' : 'pointer',
          marginBottom: 'var(--space-3)',
          marginRight: 'var(--space-2)',
        }}
      >
        {mapping ? 'Extracting...' : 'Extract Services from Website'}
      </button>

      <button
        onClick={addManualService}
        style={{
          padding: 'var(--space-2) var(--space-4)',
          fontSize: '8pt',
          fontWeight: 'bold',
          background: 'var(--surface-hover)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: '4px',
          cursor: 'pointer',
          marginBottom: 'var(--space-3)',
        }}
      >
        Add Service Manually
      </button>

      {error && (
        <div style={{
          padding: 'var(--space-2)',
          background: 'var(--danger-light)',
          border: '1px solid var(--danger)',
          borderRadius: '4px',
          fontSize: '8pt',
          color: 'var(--danger)',
          marginBottom: 'var(--space-3)',
        }}>
          {error}
        </div>
      )}

      {services.length > 0 && (
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <h4 style={{ fontSize: '9pt', fontWeight: 'bold', margin: 0, marginBottom: 'var(--space-2)' }}>
            Services ({services.length})
          </h4>
          {services.map((service, index) => (
            <div
              key={index}
              style={{
                padding: 'var(--space-3)',
                background: 'var(--surface-hover)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                marginBottom: 'var(--space-2)',
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                <input
                  type="text"
                  value={service.service_name}
                  onChange={(e) => updateService(index, 'service_name', e.target.value)}
                  placeholder="Service Name"
                  style={{
                    padding: 'var(--space-1)',
                    fontSize: '8pt',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    background: 'var(--surface)',
                  }}
                />
                <button
                  onClick={() => removeService(index)}
                  style={{
                    padding: 'var(--space-1) var(--space-2)',
                    fontSize: '7pt',
                    background: 'var(--danger)',
                    color: 'var(--white)',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Remove
                </button>
              </div>
              <select
                value={service.service_category}
                onChange={(e) => updateService(index, 'service_category', e.target.value)}
                style={{
                  width: '100%',
                  padding: 'var(--space-1)',
                  fontSize: '8pt',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  background: 'var(--surface)',
                  marginBottom: 'var(--space-2)',
                }}
              >
                <option value="consignment_management">Consignment Management</option>
                <option value="professional_detailing">Professional Detailing</option>
                <option value="paint_correction">Paint Correction</option>
                <option value="ceramic_coating">Ceramic Coating</option>
                <option value="light_restoration">Light Restoration</option>
                <option value="mechanical_repair">Mechanical Repair</option>
                <option value="bodywork">Bodywork</option>
                <option value="fabrication">Fabrication</option>
                <option value="indoor_storage">Indoor Storage</option>
                <option value="outdoor_storage">Outdoor Storage</option>
                <option value="transport_coordination">Transport Coordination</option>
                <option value="photography">Photography</option>
                <option value="listing_management">Listing Management</option>
                <option value="inspection_services">Inspection Services</option>
                <option value="auction_services">Auction Services</option>
                <option value="other">Other</option>
              </select>
              <textarea
                value={service.description || ''}
                onChange={(e) => updateService(index, 'description', e.target.value)}
                placeholder="Description (optional)"
                rows={2}
                style={{
                  width: '100%',
                  padding: 'var(--space-1)',
                  fontSize: '8pt',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  background: 'var(--surface)',
                  marginBottom: 'var(--space-2)',
                  resize: 'vertical',
                }}
              />
            </div>
          ))}

          <button
            onClick={saveServices}
            disabled={saving || services.some(s => !s.service_name)}
            style={{
              padding: 'var(--space-2) var(--space-4)',
              fontSize: '8pt',
              fontWeight: 'bold',
              background: saving ? 'var(--text-muted)' : 'var(--success)',
              color: 'var(--white)',
              border: 'none',
              borderRadius: '4px',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving...' : `Save ${services.length} Service${services.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  );
};

