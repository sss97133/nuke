// Create Organization - Start a new collaborative org profile
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function CreateOrganization() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  const [businessName, setBusinessName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zipCode, setZipCode] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Authentication required');

      // Create organization
      const { data: org, error: orgError } = await supabase
        .from('businesses')
        .insert({
          business_name: businessName,
          legal_name: legalName || null,
          business_type: businessType || null,
          description: description || null,
          phone: phone || null,
          email: email || null,
          website: website || null,
          address: address || null,
          city: city || null,
          state: state || null,
          zip_code: zipCode || null,
          discovered_by: user.id,
          uploaded_by: user.id,
          is_public: true,
          status: 'active',
          verification_level: 'unverified'
        })
        .select()
        .single();

      if (orgError) throw orgError;

      // Auto-create contributor record
      await supabase.from('organization_contributors').insert({
        organization_id: org.id,
        user_id: user.id,
        role: 'owner',
        contribution_count: 1,
        status: 'active'
      });

      // Create timeline event
      await supabase.from('business_timeline_events').insert({
        business_id: org.id,
        created_by: user.id,
        event_type: 'founded',
        event_category: 'legal',
        title: 'Organization created',
        description: `${businessName} added to the platform`,
        event_date: new Date().toISOString().split('T')[0],
        metadata: {
          initial_creator: user.id
        }
      });

      // Navigate to new org profile
      navigate(`/org/${org.id}`);

    } catch (error: any) {
      console.error('Error creating organization:', error);
      alert(`Failed: ${error.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ background: '#f5f5f5', minHeight: '100vh', padding: '20px' }}>
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        <div className="card">
          <div className="card-header">
            <h1 style={{ margin: 0, fontSize: '14pt', fontWeight: 700 }}>Create Organization Profile</h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '8pt', color: 'var(--text-muted)' }}>
              Start a collaborative profile for a shop, business, or team
            </p>
          </div>
          <div className="card-body">
            <form onSubmit={handleSubmit}>
              {/* Basic Info */}
              <div style={{ marginBottom: '16px' }}>
                <h3 style={{ fontSize: '11pt', fontWeight: 700, marginBottom: '12px', borderBottom: '1px solid var(--border-light)', paddingBottom: '4px' }}>
                  Basic Information
                </h3>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                    Business Name *
                  </label>
                  <input
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    required
                    className="form-input"
                    style={{ width: '100%', fontSize: '9pt' }}
                    placeholder="e.g., Desert Performance"
                  />
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                    Legal Name
                  </label>
                  <input
                    type="text"
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    className="form-input"
                    style={{ width: '100%', fontSize: '9pt' }}
                    placeholder="e.g., Desert Performance LLC"
                  />
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                    Business Type
                  </label>
                  <select
                    value={businessType}
                    onChange={(e) => setBusinessType(e.target.value)}
                    className="form-select"
                    style={{ width: '100%', fontSize: '9pt' }}
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
                    <option value="other">Other</option>
                  </select>
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="form-input"
                    style={{ width: '100%', fontSize: '9pt', minHeight: '80px' }}
                    placeholder="Brief description of the business..."
                  />
                </div>
              </div>

              {/* Contact Info */}
              <div style={{ marginBottom: '16px' }}>
                <h3 style={{ fontSize: '11pt', fontWeight: 700, marginBottom: '12px', borderBottom: '1px solid var(--border-light)', paddingBottom: '4px' }}>
                  Contact Information
                </h3>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="form-input"
                    style={{ width: '100%', fontSize: '9pt' }}
                    placeholder="(555) 123-4567"
                  />
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="form-input"
                    style={{ width: '100%', fontSize: '9pt' }}
                    placeholder="contact@business.com"
                  />
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                    Website
                  </label>
                  <input
                    type="url"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    className="form-input"
                    style={{ width: '100%', fontSize: '9pt' }}
                    placeholder="https://business.com"
                  />
                </div>
              </div>

              {/* Location */}
              <div style={{ marginBottom: '16px' }}>
                <h3 style={{ fontSize: '11pt', fontWeight: 700, marginBottom: '12px', borderBottom: '1px solid var(--border-light)', paddingBottom: '4px' }}>
                  Location (Optional)
                </h3>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                    Address
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="form-input"
                    style={{ width: '100%', fontSize: '9pt' }}
                    placeholder="123 Main St"
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                      City
                    </label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="form-input"
                      style={{ width: '100%', fontSize: '9pt' }}
                      placeholder="Phoenix"
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                      State
                    </label>
                    <input
                      type="text"
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                      className="form-input"
                      style={{ width: '100%', fontSize: '9pt' }}
                      placeholder="AZ"
                      maxLength={2}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                      ZIP
                    </label>
                    <input
                      type="text"
                      value={zipCode}
                      onChange={(e) => setZipCode(e.target.value)}
                      className="form-input"
                      style={{ width: '100%', fontSize: '9pt' }}
                      placeholder="85001"
                    />
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
                <button
                  type="button"
                  onClick={() => navigate('/vehicles')}
                  className="button button-secondary"
                  style={{ fontSize: '9pt' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !businessName}
                  className="button button-primary"
                  style={{ fontSize: '9pt' }}
                >
                  {submitting ? 'Creating...' : 'Create Organization'}
                </button>
              </div>
            </form>
          </div>
        </div>

        <div style={{ marginTop: '16px', padding: '12px', background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: '4px', fontSize: '8pt', color: 'var(--text-muted)' }}>
          💡 <strong>Collaborative profiles</strong>: Like vehicles, any user can contribute to this organization profile. You'll be credited as the creator. To claim ownership, you'll need to submit business documents for verification.
        </div>
      </div>
    </div>
  );
}
