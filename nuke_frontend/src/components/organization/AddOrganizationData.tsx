// Add Organization Data - Users contribute org info with full attribution
import React, { useState, useRef } from 'react';
import ReactDOM from 'react-dom';
import { supabase } from '../../lib/supabase';
import { extractImageMetadata, reverseGeocode } from '../../utils/imageMetadata';

interface Props {
  organizationId: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function AddOrganizationData({ organizationId, onClose, onSaved }: Props) {
  const [dataType, setDataType] = useState<'info' | 'members' | 'images' | 'contact'>('info');
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Info form state
  const [businessName, setBusinessName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [description, setDescription] = useState('');

  // Contact form state
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zipCode, setZipCode] = useState('');

  // Member form state
  const [memberUserId, setMemberUserId] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState('employee');

  const handleInfoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Authentication required');

      // Update organization
      const updates: any = {};
      if (businessName) updates.business_name = businessName;
      if (legalName) updates.legal_name = legalName;
      if (businessType) updates.business_type = businessType;
      if (description) updates.description = description;

      if (Object.keys(updates).length > 0) {
        const { error } = await supabase
          .from('businesses')
          .update(updates)
          .eq('id', organizationId);

        if (error) throw error;

        // Track contribution
        await supabase.from('organization_contributors').upsert({
          organization_id: organizationId,
          user_id: user.id,
          role: 'contributor',
          contribution_count: 1
        }, {
          onConflict: 'organization_id,user_id',
          ignoreDuplicates: false
        });

        // Create timeline event
        await supabase.from('business_timeline_events').insert({
          business_id: organizationId,
          created_by: user.id,
          event_type: 'other',
          event_category: 'other',
          title: 'Organization info updated',
          description: `Updated: ${Object.keys(updates).join(', ')}`,
          event_date: new Date().toISOString().split('T')[0],
          metadata: {
            updated_fields: Object.keys(updates),
            submitted_by: user.id
          }
        });

        onSaved();
        onClose();
      }
    } catch (error: any) {
      console.error('Error submitting info:', error);
      alert(`Failed: ${error.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Authentication required');

      const updates: any = {};
      if (phone) updates.phone = phone;
      if (email) updates.email = email;
      if (website) updates.website = website;
      if (address) updates.address = address;
      if (city) updates.city = city;
      if (state) updates.state = state;
      if (zipCode) updates.zip_code = zipCode;

      if (Object.keys(updates).length > 0) {
        const { error } = await supabase
          .from('businesses')
          .update(updates)
          .eq('id', organizationId);

        if (error) throw error;

        // Track contribution
        await supabase.from('organization_contributors').upsert({
          organization_id: organizationId,
          user_id: user.id,
          role: 'contributor',
          contribution_count: 1
        });

        onSaved();
        onClose();
      }
    } catch (error: any) {
      console.error('Error submitting contact:', error);
      alert(`Failed: ${error.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Authentication required');

      let targetUserId = memberUserId;

      // If email provided but no userId, try to find user by email
      if (!targetUserId && memberEmail) {
        const { data: existingUser } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', memberEmail)
          .maybeSingle();

        if (existingUser) {
          targetUserId = existingUser.id;
        }
      }

      if (!targetUserId) {
        alert('User not found. They must be registered on the platform.');
        setSubmitting(false);
        return;
      }

      // Add member
      const { error } = await supabase
        .from('business_user_roles')
        .insert({
          business_id: organizationId,
          user_id: targetUserId,
          role_title: memberRole,
          role_type: memberRole as any,
          start_date: new Date().toISOString().split('T')[0],
          status: 'active'
        });

      if (error) throw error;

      // Track as contribution
      await supabase.from('organization_contributors').upsert({
        organization_id: organizationId,
        user_id: user.id,
        role: 'contributor',
        contribution_count: 1
      });

      // Timeline event
      await supabase.from('business_timeline_events').insert({
        business_id: organizationId,
        created_by: user.id,
        event_type: 'employee_hired',
        event_category: 'personnel',
        title: `Member added: ${memberRole}`,
        description: `Added user to organization as ${memberRole}`,
        event_date: new Date().toISOString().split('T')[0],
        metadata: {
          added_user_id: targetUserId,
          submitted_by: user.id
        }
      });

      onSaved();
      onClose();
    } catch (error: any) {
      console.error('Error adding member:', error);
      alert(`Failed: ${error.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleImageUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFiles.length === 0) return;

    setSubmitting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Authentication required');

      const uploadedImages: string[] = [];
      let earliestDate: Date | null = null;

      // Process each image with EXIF extraction
      for (const file of selectedFiles) {
        // 1. Extract EXIF metadata
        const metadata = await extractImageMetadata(file);
        console.log('Extracted EXIF for org image:', metadata);

        // Track earliest date for timeline event
        if (metadata.dateTaken) {
          if (!earliestDate || metadata.dateTaken < earliestDate) {
            earliestDate = metadata.dateTaken;
          }
        }

        // Reverse geocode if GPS data available
        let locationName = null;
        if (metadata.location) {
          locationName = await reverseGeocode(
            metadata.location.latitude,
            metadata.location.longitude
          );
        }

        // 2. Upload to storage
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${fileExt}`;
        const storagePath = `organization-data/${organizationId}/images/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('vehicle-data')
          .upload(storagePath, file);

        if (uploadError) throw uploadError;

        const publicUrl = supabase.storage.from('vehicle-data').getPublicUrl(storagePath).data.publicUrl;

        // 3. Insert into organization_images with EXIF data
        const { error: insertError } = await supabase
          .from('organization_images')
          .insert({
            organization_id: organizationId,
            user_id: user.id,
            image_url: publicUrl,
            large_url: publicUrl, // TODO: Generate large variant
            thumbnail_url: publicUrl, // TODO: Generate thumbnail
            category: 'facility',
            taken_at: metadata.dateTaken?.toISOString() || new Date().toISOString(),
            latitude: metadata.location?.latitude,
            longitude: metadata.location?.longitude,
            location_name: locationName,
            exif_data: metadata,
            caption: file.name
          });

        if (insertError) throw insertError;
        uploadedImages.push(publicUrl);
      }

      // Track contribution
      await supabase.from('organization_contributors').upsert({
        organization_id: organizationId,
        user_id: user.id,
        role: 'photographer',
        contribution_count: uploadedImages.length
      });

      // 4. Create timeline event with EXIF date
      const eventDate = earliestDate || new Date();
      await supabase.from('business_timeline_events').insert({
        business_id: organizationId,
        created_by: user.id,
        event_type: 'photo_added',
        event_category: 'facility',
        title: `${uploadedImages.length} image${uploadedImages.length === 1 ? '' : 's'} uploaded`,
        description: `Location/facility images added to organization profile`,
        event_date: eventDate.toISOString().split('T')[0],
        image_urls: uploadedImages,
        metadata: {
          image_count: uploadedImages.length,
          submitted_by: user.id,
          exif_extracted: !!earliestDate,
          earliest_date: earliestDate?.toISOString()
        }
      });

      onSaved();
      onClose();
    } catch (error: any) {
      console.error('Error uploading images:', error);
      alert(`Failed: ${error.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return ReactDOM.createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 10003,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--white)',
          width: '100%',
          maxWidth: '600px',
          border: '2px solid var(--border)',
          borderRadius: '4px',
          boxShadow: 'var(--shadow)',
          maxHeight: '90vh',
          overflow: 'auto'
        }}
      >
        <div style={{ padding: '16px', borderBottom: '2px solid var(--border)', background: 'var(--surface)' }}>
          <h2 style={{ margin: 0, fontSize: '12pt', fontWeight: 700 }}>Contribute Organization Data</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '8pt', color: 'var(--text-muted)' }}>
            All submissions are attributed to you and tracked in the org timeline
          </p>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          {[
            { key: 'info', label: 'Basic Info' },
            { key: 'contact', label: 'Contact' },
            { key: 'members', label: 'Members' },
            { key: 'images', label: 'Images' }
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setDataType(tab.key as any)}
              className="button button-secondary"
              style={{
                flex: 1,
                fontSize: '9pt',
                borderRadius: 0,
                borderBottom: dataType === tab.key ? '2px solid var(--accent)' : 'none',
                background: dataType === tab.key ? 'var(--white)' : 'var(--surface)'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ padding: '16px' }}>
          {/* BASIC INFO TAB */}
          {dataType === 'info' && (
            <form onSubmit={handleInfoSubmit}>
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

              <div style={{ marginBottom: '16px' }}>
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

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={onClose}
                  className="button button-secondary button-small"
                  style={{ fontSize: '8pt' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !businessName}
                  className="button button-primary button-small"
                  style={{ fontSize: '8pt' }}
                >
                  {submitting ? 'Submitting...' : 'Submit Info'}
                </button>
              </div>
            </form>
          )}

          {/* CONTACT TAB */}
          {dataType === 'contact' && (
            <form onSubmit={handleContactSubmit}>
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

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '8px', marginBottom: '16px' }}>
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

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={onClose}
                  className="button button-secondary button-small"
                  style={{ fontSize: '8pt' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="button button-primary button-small"
                  style={{ fontSize: '8pt' }}
                >
                  {submitting ? 'Submitting...' : 'Submit Contact Info'}
                </button>
              </div>
            </form>
          )}

          {/* MEMBERS TAB */}
          {dataType === 'members' && (
            <form onSubmit={handleMemberSubmit}>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                  User Email *
                </label>
                <input
                  type="email"
                  value={memberEmail}
                  onChange={(e) => setMemberEmail(e.target.value)}
                  required
                  className="form-input"
                  style={{ width: '100%', fontSize: '9pt' }}
                  placeholder="user@example.com"
                />
                <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '2px' }}>
                  User must be registered on the platform
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                  Role
                </label>
                <select
                  value={memberRole}
                  onChange={(e) => setMemberRole(e.target.value)}
                  className="form-select"
                  style={{ width: '100%', fontSize: '9pt' }}
                >
                  <option value="employee">Employee</option>
                  <option value="contractor">Contractor</option>
                  <option value="manager">Manager</option>
                  <option value="owner">Owner</option>
                  <option value="consultant">Consultant</option>
                  <option value="intern">Intern</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={onClose}
                  className="button button-secondary button-small"
                  style={{ fontSize: '8pt' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="button button-primary button-small"
                  style={{ fontSize: '8pt' }}
                >
                  {submitting ? 'Adding...' : 'Add Member'}
                </button>
              </div>
            </form>
          )}

          {/* IMAGES TAB */}
          {dataType === 'images' && (
            <form onSubmit={handleImageUpload}>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                  Upload Location/Facility Images
                </label>

                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    setSelectedFiles(files);
                  }}
                  style={{ display: 'none' }}
                />

                {/* Drag-and-drop zone */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    const files = Array.from(e.dataTransfer.files);
                    if (files.length > 0 && fileInputRef.current) {
                      const dataTransfer = new DataTransfer();
                      files.forEach(file => dataTransfer.items.add(file));
                      fileInputRef.current.files = dataTransfer.files;
                      setSelectedFiles(files);
                    }
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: isDragging ? '2px dashed var(--accent)' : '2px dashed var(--border)',
                    borderRadius: '4px',
                    padding: '30px',
                    textAlign: 'center',
                    background: isDragging ? 'var(--accent-dim)' : 'var(--surface)',
                    cursor: 'pointer',
                    transition: '0.12s'
                  }}
                >
                  {selectedFiles.length > 0 ? (
                    <div>
                      <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '4px', color: 'var(--accent)' }}>
                        {selectedFiles.length} file{selectedFiles.length === 1 ? '' : 's'} selected
                      </div>
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                        {selectedFiles.map(f => f.name).join(', ')}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: '9pt', marginBottom: '4px' }}>
                        {isDragging ? 'Drop images here' : 'Drag & drop images or click to choose'}
                      </div>
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                        Select multiple images of the facility, team, equipment, or work
                      </div>
                    </div>
                  )}
                </div>
              </div>


              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={onClose}
                  className="button button-secondary button-small"
                  style={{ fontSize: '8pt' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || selectedFiles.length === 0}
                  className="button button-primary button-small"
                  style={{ fontSize: '8pt' }}
                >
                  {submitting ? 'Uploading...' : `Upload ${selectedFiles.length} Image${selectedFiles.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </form>
          )}
        </div>

        <div style={{ padding: '12px', background: 'var(--surface)', borderTop: '1px solid var(--border)', fontSize: '7pt', color: 'var(--text-muted)' }}>
          💡 Your submissions create a verified chain of data. Each contribution is linked back to you in the organization timeline.
        </div>
      </div>
    </div>,
    document.body
  );
}

