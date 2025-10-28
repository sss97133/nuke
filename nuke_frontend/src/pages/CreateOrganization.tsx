import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import '../design-system.css';

interface FormData {
  name: string;
  business_type: string;
  description: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  logo_url?: string;
}

export default function CreateOrganization() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const navigate = useNavigate();

  const [formData, setFormData] = useState<FormData>({
    name: '',
    business_type: 'restoration_shop',
    description: '',
    phone: '',
    email: '',
    website: '',
    address: '',
    city: '',
    state: '',
    zip: ''
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (!session) {
        navigate('/login');
      }
    });
  }, []);

  const businessTypes = [
    { value: 'restoration_shop', label: 'Restoration Shop' },
    { value: 'dealership', label: 'Dealership' },
    { value: 'garage', label: 'Auto Garage' },
    { value: 'performance_shop', label: 'Performance Shop' },
    { value: 'body_shop', label: 'Body Shop' },
    { value: 'upholstery', label: 'Upholstery Shop' },
    { value: 'detailing', label: 'Detailing Service' },
    { value: 'mobile_service', label: 'Mobile Service' },
    { value: 'parts_supplier', label: 'Parts Supplier' },
    { value: 'fabrication', label: 'Fabrication Shop' },
    { value: 'racing_team', label: 'Racing Team' },
    { value: 'other', label: 'Other' }
  ];

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session?.user) return;

    try {
      setUploadingLogo(true);

      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `business-logos/${session.user.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('vehicle_images')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('vehicle_images')
        .getPublicUrl(filePath);

      setFormData(prev => ({ ...prev, logo_url: publicUrl }));
    } catch (error: any) {
      console.error('Error uploading logo:', error);
      alert(`Error uploading logo: ${error.message}`);
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user) return;

    if (!formData.name.trim()) {
      alert('Business name is required');
      return;
    }

    setLoading(true);

    try {
      // Create business
      const { data: business, error: businessError } = await supabase
        .from('businesses')
        .insert({
          name: formData.name.trim(),
          business_type: formData.business_type,
          description: formData.description.trim() || null,
          phone: formData.phone.trim() || null,
          email: formData.email.trim() || null,
          website: formData.website.trim() || null,
          address: formData.address.trim() || null,
          city: formData.city.trim() || null,
          state: formData.state.trim() || null,
          zip: formData.zip.trim() || null,
          logo_url: formData.logo_url || null,
          owner_id: session.user.id,
          is_public: false, // Start as private until verified
          status: 'pending', // Awaiting verification
          verification_level: 'level_1' // Basic profile only
        })
        .select()
        .single();

      if (businessError) throw businessError;

      // Add user as owner in business_user_roles
      const { error: roleError } = await supabase
        .from('business_user_roles')
        .insert({
          business_id: business.id,
          user_id: session.user.id,
          role: 'owner',
          can_edit: true,
          can_invite: true,
          can_manage_finances: true
        });

      if (roleError) throw roleError;

      // Navigate to organization profile
      navigate(`/org/${business.id}`);
    } catch (error: any) {
      console.error('Error creating business:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 'var(--space-4)', background: '#f5f5f5', minHeight: '100vh' }}>
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <button
            onClick={() => navigate('/shops')}
            style={{
              background: 'var(--grey-100)',
              border: '2px outset var(--border)',
              padding: '4px 8px',
              fontSize: '9pt',
              cursor: 'pointer',
              marginBottom: 'var(--space-2)',
              fontFamily: '"MS Sans Serif", sans-serif'
            }}
          >
            ← Back to Organizations
          </button>
          <h1 style={{ fontSize: '18pt', fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>
            Create Organization
          </h1>
          <p style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
            Start with basic info · Upload docs later to unlock full features
          </p>
        </div>

        {/* Verification Levels Info */}
        <div style={{
          background: 'var(--white)',
          border: '2px solid var(--border)',
          padding: 'var(--space-3)',
          marginBottom: 'var(--space-4)'
        }}>
          <div style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: '8px' }}>
            📋 Verification Levels
          </div>
          <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            <div style={{ marginBottom: '4px' }}>
              <strong>Level 1 (Now):</strong> Create profile, upload images, document timeline
            </div>
            <div style={{ marginBottom: '4px' }}>
              <strong>Level 2 (Submit docs):</strong> List vehicles, accept work orders, sell parts
            </div>
            <div>
              <strong>Level 3 (Verified):</strong> Accept payments, issue invoices, full legal access
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{
            background: 'var(--white)',
            border: '2px solid var(--border)',
            padding: 'var(--space-4)'
          }}>
            {/* Logo Upload */}
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 'bold', marginBottom: '4px' }}>
                Logo (optional)
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {formData.logo_url ? (
                  <div style={{
                    width: '80px',
                    height: '80px',
                    border: '2px solid var(--border)',
                    backgroundImage: `url(${formData.logo_url})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center'
                  }} />
                ) : (
                  <div style={{
                    width: '80px',
                    height: '80px',
                    border: '2px solid var(--border)',
                    background: 'var(--grey-100)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '24pt'
                  }}>
                    🏢
                  </div>
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  disabled={uploadingLogo}
                  style={{ fontSize: '9pt' }}
                />
                {uploadingLogo && <span style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>Uploading...</span>}
              </div>
            </div>

            {/* Business Name */}
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 'bold', marginBottom: '4px' }}>
                Business Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="NUKE LTD"
                required
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '2px inset var(--border)',
                  fontSize: '9pt',
                  fontFamily: '"MS Sans Serif", sans-serif'
                }}
              />
            </div>

            {/* Business Type */}
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 'bold', marginBottom: '4px' }}>
                Business Type *
              </label>
              <select
                value={formData.business_type}
                onChange={(e) => setFormData(prev => ({ ...prev, business_type: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '2px inset var(--border)',
                  fontSize: '9pt',
                  fontFamily: '"MS Sans Serif", sans-serif'
                }}
              >
                {businessTypes.map(type => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Description */}
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 'bold', marginBottom: '4px' }}>
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Describe your business, services, specializations..."
                rows={4}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '2px inset var(--border)',
                  fontSize: '9pt',
                  fontFamily: '"MS Sans Serif", sans-serif',
                  resize: 'vertical'
                }}
              />
            </div>

            {/* Contact Info Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 'var(--space-3)',
              marginBottom: 'var(--space-3)'
            }}>
              <div>
                <label style={{ display: 'block', fontSize: '9pt', fontWeight: 'bold', marginBottom: '4px' }}>
                  Phone
                </label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="(555) 123-4567"
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '2px inset var(--border)',
                    fontSize: '9pt',
                    fontFamily: '"MS Sans Serif", sans-serif'
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '9pt', fontWeight: 'bold', marginBottom: '4px' }}>
                  Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="info@business.com"
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '2px inset var(--border)',
                    fontSize: '9pt',
                    fontFamily: '"MS Sans Serif", sans-serif'
                  }}
                />
              </div>
            </div>

            {/* Website */}
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 'bold', marginBottom: '4px' }}>
                Website
              </label>
              <input
                type="url"
                value={formData.website}
                onChange={(e) => setFormData(prev => ({ ...prev, website: e.target.value }))}
                placeholder="https://..."
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '2px inset var(--border)',
                  fontSize: '9pt',
                  fontFamily: '"MS Sans Serif", sans-serif'
                }}
              />
            </div>

            {/* Address */}
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 'bold', marginBottom: '4px' }}>
                Street Address
              </label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                placeholder="123 Main St"
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '2px inset var(--border)',
                  fontSize: '9pt',
                  fontFamily: '"MS Sans Serif", sans-serif'
                }}
              />
            </div>

            {/* City, State, ZIP */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1fr 1fr',
              gap: 'var(--space-2)',
              marginBottom: 'var(--space-4)'
            }}>
              <div>
                <label style={{ display: 'block', fontSize: '9pt', fontWeight: 'bold', marginBottom: '4px' }}>
                  City
                </label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value }))}
                  placeholder="Las Vegas"
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '2px inset var(--border)',
                    fontSize: '9pt',
                    fontFamily: '"MS Sans Serif", sans-serif'
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '9pt', fontWeight: 'bold', marginBottom: '4px' }}>
                  State
                </label>
                <input
                  type="text"
                  value={formData.state}
                  onChange={(e) => setFormData(prev => ({ ...prev, state: e.target.value }))}
                  placeholder="NV"
                  maxLength={2}
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '2px inset var(--border)',
                    fontSize: '9pt',
                    fontFamily: '"MS Sans Serif", sans-serif',
                    textTransform: 'uppercase'
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '9pt', fontWeight: 'bold', marginBottom: '4px' }}>
                  ZIP
                </label>
                <input
                  type="text"
                  value={formData.zip}
                  onChange={(e) => setFormData(prev => ({ ...prev, zip: e.target.value }))}
                  placeholder="89101"
                  maxLength={10}
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '2px inset var(--border)',
                    fontSize: '9pt',
                    fontFamily: '"MS Sans Serif", sans-serif'
                  }}
                />
              </div>
            </div>

            {/* Submit Buttons */}
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                type="submit"
                disabled={loading || !formData.name.trim()}
                style={{
                  background: loading ? 'var(--grey-200)' : 'var(--text)',
                  color: 'var(--white)',
                  border: '2px outset var(--border)',
                  padding: '8px 16px',
                  fontSize: '9pt',
                  fontWeight: 'bold',
                  cursor: loading ? 'wait' : 'pointer',
                  fontFamily: '"MS Sans Serif", sans-serif'
                }}
              >
                {loading ? 'Creating...' : 'Create Organization'}
              </button>
              <button
                type="button"
                onClick={() => navigate('/shops')}
                disabled={loading}
                style={{
                  background: 'var(--grey-100)',
                  border: '2px outset var(--border)',
                  padding: '8px 16px',
                  fontSize: '9pt',
                  cursor: loading ? 'wait' : 'pointer',
                  fontFamily: '"MS Sans Serif", sans-serif'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

