import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../../lib/supabase';

interface VehicleEditModalProps {
  vehicleId: string;
  onClose: () => void;
  onSaved: () => void;
}

interface VehicleData {
  [key: string]: any;
}

interface VehicleImage {
  id: string;
  image_url: string;
  is_primary?: boolean;
}

interface UserRelationship {
  id: string;
  role: string;
  is_active: boolean;
  context: string | null;
  granted_at: string | null;
}

interface OwnershipVerification {
  id: string;
  status: string;
  submitted_at: string;
}

const ROLE_OPTIONS = [
  { value: 'owner', label: 'Owner', description: 'I own this vehicle' },
  { value: 'co_owner', label: 'Co-Owner', description: 'I co-own this vehicle with others' },
  { value: 'contributor', label: 'Contributor', description: 'I contribute data but don\'t own it' },
  { value: 'viewer', label: 'Viewer', description: 'I can view but have no ownership claim' },
];

// Organized field sections with prerequisites
const FIELD_SECTIONS = [
  {
    id: 'identity',
    title: 'IDENTITY',
    subtitle: 'Core identification',
    color: '#3b82f6',
    fields: ['year', 'make', 'model', 'trim', 'series', 'generation', 'body_style', 'normalized_model', 'normalized_series'],
  },
  {
    id: 'vin',
    title: 'VIN & REGISTRATION',
    subtitle: 'Legal identification',
    color: '#8b5cf6',
    fields: ['vin', 'vin_source', 'vin_confidence', 'license_plate', 'registration_state', 'registration_expiry', 'title_status', 'title_transfer_date'],
  },
  {
    id: 'ownership',
    title: 'OWNERSHIP & ATTRIBUTION',
    subtitle: 'Check for misattribution',
    color: '#dc2626',
    fields: ['uploaded_by', 'user_id', 'owner_id', 'owner_name', 'owner_contact', 'discovered_by', 'imported_by', 'created_by_user_id', 'created_by_organization_id', 'ownership_verified', 'ownership_percentage', 'acting_on_behalf_of'],
  },
  {
    id: 'location',
    title: 'LOCATION',
    subtitle: 'Where is this vehicle?',
    color: '#059669',
    fields: ['city', 'state', 'country', 'zip_code', 'location', 'listing_location', 'bat_location', 'gps_latitude', 'gps_longitude'],
  },
  {
    id: 'engine',
    title: 'ENGINE & DRIVETRAIN',
    subtitle: 'Powertrain specifications',
    color: '#ea580c',
    fields: ['engine_size', 'engine_type', 'engine_code', 'engine_displacement', 'engine_liters', 'displacement', 'horsepower', 'torque', 'fuel_type', 'transmission', 'transmission_type', 'transmission_model', 'transmission_code', 'drivetrain'],
  },
  {
    id: 'dimensions',
    title: 'DIMENSIONS & CAPACITY',
    subtitle: 'Physical measurements',
    color: '#0891b2',
    fields: ['weight_lbs', 'length_inches', 'width_inches', 'height_inches', 'wheelbase_inches', 'doors', 'seats', 'fuel_capacity_gallons'],
  },
  {
    id: 'appearance',
    title: 'APPEARANCE',
    subtitle: 'Colors and styling',
    color: '#c026d3',
    fields: ['color', 'color_primary', 'color_secondary', 'secondary_color', 'interior_color', 'interior_color_secondary', 'interior_color_tertiary', 'paint_code', 'paint_code_secondary', 'seat_type', 'seat_material_primary', 'seat_material_secondary', 'has_molding', 'has_pinstriping', 'has_body_kit', 'has_racing_stripes'],
  },
  {
    id: 'condition',
    title: 'CONDITION & MODIFICATIONS',
    subtitle: 'Current state',
    color: '#ca8a04',
    fields: ['condition_rating', 'mileage', 'mileage_source', 'is_modified', 'modification_details', 'modifications', 'known_flaws', 'recent_service_history'],
  },
  {
    id: 'usage',
    title: 'USAGE TYPE',
    subtitle: 'How is this vehicle used?',
    color: '#64748b',
    fields: ['is_daily_driver', 'is_weekend_car', 'is_track_car', 'is_show_car', 'is_project_car', 'is_garage_kept'],
  },
  {
    id: 'value',
    title: 'VALUE & PRICING',
    subtitle: 'Financial data',
    color: '#16a34a',
    fields: ['msrp', 'purchase_price', 'purchase_date', 'purchase_location', 'current_value', 'asking_price', 'sale_price', 'sold_price', 'price', 'high_bid', 'winning_bid', 'previous_owners'],
  },
  {
    id: 'investment',
    title: 'INVESTMENT METRICS',
    subtitle: 'Quality and grade scores',
    color: '#7c3aed',
    fields: ['value_score', 'quality_grade', 'investment_grade', 'investment_confidence', 'data_quality_score', 'confidence_score', 'signal_score'],
  },
  {
    id: 'bat',
    title: 'BRING A TRAILER',
    subtitle: 'Only if listed on BaT',
    color: '#f59e0b',
    prerequisite: (v: VehicleData) => !!(v.bat_auction_url || v.discovery_url?.includes('bringatrailer')),
    fields: ['bat_auction_url', 'bat_listing_title', 'bat_lot_number', 'bat_sold_price', 'bat_sale_date', 'bat_bid_count', 'bat_bids', 'bat_comments', 'bat_views', 'bat_view_count', 'bat_watchers', 'bat_location', 'bat_seller', 'bat_buyer', 'reserve_status', 'auction_outcome'],
  },
  {
    id: 'cab',
    title: 'CARS & BIDS / DOUG',
    subtitle: 'Only if listed on C&B',
    color: '#ef4444',
    prerequisite: (v: VehicleData) => !!(v.dougs_take || v.discovery_url?.includes('carsandbids')),
    fields: ['dougs_take', 'highlights', 'equipment'],
  },
  {
    id: 'rennlist',
    title: 'RENNLIST',
    subtitle: 'Only if listed on Rennlist',
    color: '#0369a1',
    prerequisite: (v: VehicleData) => !!(v.rennlist_url),
    fields: ['rennlist_url', 'rennlist_listing_id'],
  },
  {
    id: 'listing',
    title: 'LISTING DATA',
    subtitle: 'External listing information',
    color: '#6366f1',
    fields: ['listing_url', 'listing_source', 'listing_title', 'listing_kind', 'listing_posted_at', 'listing_updated_at', 'listing_location', 'listing_location_raw', 'auction_status', 'sale_status', 'auction_end_date', 'auction_source', 'comment_count', 'bid_count', 'view_count', 'seller_name'],
  },
  {
    id: 'discovery',
    title: 'DISCOVERY & IMPORT',
    subtitle: 'How this vehicle entered the system',
    color: '#78716c',
    fields: ['discovery_source', 'discovery_url', 'source', 'import_source', 'import_method', 'platform_source', 'platform_url', 'entry_type', 'profile_origin', 'extractor_version'],
  },
  {
    id: 'efficiency',
    title: 'FUEL EFFICIENCY',
    subtitle: 'MPG ratings',
    color: '#22c55e',
    fields: ['mpg_city', 'mpg_highway', 'mpg_combined'],
  },
  {
    id: 'insurance',
    title: 'INSURANCE & REGISTRATION',
    subtitle: 'Insurance and legal',
    color: '#0d9488',
    fields: ['insurance_company', 'insurance_policy_number', 'inspection_expiry'],
  },
  {
    id: 'notes',
    title: 'NOTES & DESCRIPTIONS',
    subtitle: 'Free text fields',
    color: '#71717a',
    fields: ['notes', 'description', 'maintenance_notes', 'relationship_notes', 'trim_details', 'interior_material_details'],
  },
  {
    id: 'status',
    title: 'STATUS FLAGS',
    subtitle: 'System status',
    color: '#a3a3a3',
    fields: ['status', 'is_public', 'is_for_sale', 'is_draft', 'is_streaming', 'received_in_trade', 'verification_status', 'requires_improvement', 'completion_percentage', 'analysis_tier'],
  },
  {
    id: 'timestamps',
    title: 'TIMESTAMPS',
    subtitle: 'System dates (read-only)',
    color: '#d4d4d4',
    readonly: true,
    fields: ['created_at', 'updated_at', 'uploaded_at', 'deleted_at', 'quality_last_assessed', 'last_quality_check', 'last_signal_assessed_at', 'description_generated_at'],
  },
];

// Document types that can be "on hand"
const DOCUMENT_TYPES = [
  { key: 'title', label: 'Title' },
  { key: 'registration', label: 'Registration' },
  { key: 'bill_of_sale', label: 'Bill of Sale' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'smog_cert', label: 'Smog Certificate' },
  { key: 'inspection', label: 'Inspection Report' },
  { key: 'warranty', label: 'Warranty Docs' },
  { key: 'service_records', label: 'Service Records' },
  { key: 'owners_manual', label: "Owner's Manual" },
  { key: 'window_sticker', label: 'Window Sticker' },
  { key: 'build_sheet', label: 'Build Sheet' },
  { key: 'appraisal', label: 'Appraisal' },
  { key: 'carfax', label: 'Carfax/AutoCheck' },
  { key: 'import_docs', label: 'Import Documents' },
  { key: 'epa_release', label: 'EPA Release' },
  { key: 'dmv_printout', label: 'DMV Printout' },
];

// Fields to always hide
const HIDDEN_FIELDS = ['id', 'primary_image_url', 'documents_on_hand', 'search_vector', 'import_metadata', 'value_breakdown', 'provenance_metadata', 'origin_metadata', 'quality_issues', 'signal_reasons'];

// Fields that are read-only
const READONLY_FIELDS = ['id', 'created_at', 'updated_at', 'uploaded_at', 'user_id'];

export const VehicleEditModal: React.FC<VehicleEditModalProps> = ({
  vehicleId,
  onClose,
  onSaved
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<VehicleData | null>(null);
  const [editedFields, setEditedFields] = useState<VehicleData>({});
  const [images, setImages] = useState<VehicleImage[]>([]);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [documentsOnHand, setDocumentsOnHand] = useState<Record<string, boolean>>({});
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [myRelationship, setMyRelationship] = useState<UserRelationship | null>(null);
  const [ownershipVerification, setOwnershipVerification] = useState<OwnershipVerification | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [updatingRole, setUpdatingRole] = useState(false);
  const carouselRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadVehicle();
  }, [vehicleId]);

  const toggleDocument = (docKey: string) => {
    const newDocs = { ...documentsOnHand, [docKey]: !documentsOnHand[docKey] };
    setDocumentsOnHand(newDocs);
    setEditedFields(prev => ({ ...prev, documents_on_hand: newDocs }));
  };

  const toggleSection = (sectionId: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  const loadVehicle = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUserId(user?.id || null);

      const [vehicleResult, imagesResult, relationshipResult, verificationResult] = await Promise.all([
        supabase
          .from('vehicles')
          .select('*')
          .eq('id', vehicleId)
          .single(),
        supabase
          .from('vehicle_images')
          .select('id, image_url, is_primary')
          .eq('vehicle_id', vehicleId)
          .order('is_primary', { ascending: false })
          .order('created_at', { ascending: true })
          .limit(50),
        // Get user's relationship to this vehicle
        user?.id ? supabase
          .from('vehicle_user_permissions')
          .select('id, role, is_active, context, granted_at')
          .eq('vehicle_id', vehicleId)
          .eq('user_id', user.id)
          .maybeSingle() : Promise.resolve({ data: null, error: null }),
        // Get any ownership verification
        user?.id ? supabase
          .from('ownership_verifications')
          .select('id, status, submitted_at')
          .eq('vehicle_id', vehicleId)
          .eq('user_id', user.id)
          .maybeSingle() : Promise.resolve({ data: null, error: null })
      ]);

      if (vehicleResult.error) throw vehicleResult.error;
      setVehicle(vehicleResult.data);
      setImages(imagesResult.data || []);
      setMyRelationship(relationshipResult.data);
      setOwnershipVerification(verificationResult.data);
      setEditedFields({});
      setDocumentsOnHand(vehicleResult.data?.documents_on_hand || {});
    } catch (err) {
      console.error('Error loading vehicle:', err);
      setError(err instanceof Error ? err.message : 'Failed to load vehicle');
    } finally {
      setLoading(false);
    }
  };

  const updateMyRole = async (newRole: string) => {
    if (!currentUserId || !newRole) return;

    try {
      setUpdatingRole(true);

      if (newRole === 'remove') {
        // Remove relationship entirely
        if (myRelationship) {
          await supabase
            .from('vehicle_user_permissions')
            .update({ is_active: false, revoked_at: new Date().toISOString() })
            .eq('id', myRelationship.id);
        }
        setMyRelationship(null);
      } else if (myRelationship) {
        // Update existing relationship
        await supabase
          .from('vehicle_user_permissions')
          .update({ role: newRole })
          .eq('id', myRelationship.id);
        setMyRelationship({ ...myRelationship, role: newRole });
      } else {
        // Create new relationship
        const { data } = await supabase
          .from('vehicle_user_permissions')
          .insert({
            vehicle_id: vehicleId,
            user_id: currentUserId,
            role: newRole,
            is_active: true,
            context: 'manual_assignment'
          })
          .select()
          .single();
        if (data) setMyRelationship(data);
      }
    } catch (err) {
      console.error('Error updating role:', err);
      setError('Failed to update your relationship');
    } finally {
      setUpdatingRole(false);
    }
  };

  const openLightbox = (url: string, index: number) => {
    setLightboxImage(url);
    setLightboxIndex(index);
  };

  const closeLightbox = () => {
    setLightboxImage(null);
  };

  const navigateLightbox = (direction: 'prev' | 'next') => {
    const newIndex = direction === 'next'
      ? (lightboxIndex + 1) % images.length
      : (lightboxIndex - 1 + images.length) % images.length;
    setLightboxIndex(newIndex);
    setLightboxImage(images[newIndex].image_url);
  };

  const handleFieldChange = (field: string, value: any) => {
    setEditedFields(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSave = async () => {
    if (Object.keys(editedFields).length === 0) {
      onClose();
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const { error: updateError } = await supabase
        .from('vehicles')
        .update(editedFields)
        .eq('id', vehicleId);

      if (updateError) throw updateError;

      onSaved();
      onClose();
    } catch (err) {
      console.error('Error saving vehicle:', err);
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const getCurrentValue = (field: string) => {
    if (field in editedFields) return editedFields[field];
    return vehicle?.[field] ?? '';
  };

  const renderField = (field: string, sectionReadonly?: boolean) => {
    if (!vehicle || !(field in vehicle)) return null;

    const value = getCurrentValue(field);
    const isModified = field in editedFields;
    const isReadOnly = sectionReadonly || READONLY_FIELDS.includes(field);

    // Determine input type
    let inputType = 'text';
    if (field.includes('price') || field.includes('value') || field.includes('msrp') || field.includes('bid') || field === 'price') {
      inputType = 'number';
    } else if (field.includes('_at') || field.includes('date') || field.includes('expiry')) {
      inputType = 'datetime-local';
    } else if (['year', 'mileage', 'horsepower', 'torque', 'doors', 'seats', 'weight_lbs', 'length_inches', 'width_inches', 'height_inches', 'wheelbase_inches', 'mpg_city', 'mpg_highway', 'mpg_combined', 'bid_count', 'view_count', 'comment_count', 'previous_owners', 'condition_rating', 'completion_percentage', 'analysis_tier'].includes(field)) {
      inputType = 'number';
    } else if (field.startsWith('is_') || field.startsWith('has_') || field === 'ownership_verified' || field === 'requires_improvement' || field === 'received_in_trade') {
      inputType = 'checkbox';
    } else if (['notes', 'description', 'modification_details', 'modifications', 'known_flaws', 'recent_service_history', 'maintenance_notes', 'relationship_notes', 'trim_details', 'interior_material_details', 'dougs_take', 'highlights', 'equipment'].includes(field)) {
      inputType = 'textarea';
    }

    const label = field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    // Format datetime values
    let displayValue = value || '';
    if (inputType === 'datetime-local' && displayValue && typeof displayValue === 'string') {
      try {
        const date = new Date(displayValue);
        if (!isNaN(date.getTime())) {
          displayValue = date.toISOString().slice(0, 16);
        }
      } catch { /* keep original */ }
    }

    // Check if value is empty/null
    const isEmpty = value === null || value === undefined || value === '';

    return (
      <div key={field} style={{ marginBottom: '6px' }}>
        <label style={{
          display: 'block',
          fontSize: '7pt',
          color: isEmpty ? '#9ca3af' : 'var(--text-muted)',
          marginBottom: '2px',
          textTransform: 'uppercase'
        }}>
          {label}
          {isModified && <span style={{ color: '#f59e0b', marginLeft: '4px' }}>*</span>}
          {isReadOnly && <span style={{ color: '#6b7280', marginLeft: '4px', fontSize: '6pt' }}>(read-only)</span>}
        </label>
        {inputType === 'textarea' ? (
          <textarea
            value={displayValue}
            onChange={(e) => handleFieldChange(field, e.target.value || null)}
            disabled={isReadOnly}
            placeholder={isEmpty ? '(empty)' : undefined}
            style={{
              width: '100%',
              padding: '4px 6px',
              fontSize: '8pt',
              border: `1px solid ${isModified ? '#f59e0b' : isEmpty ? '#e5e7eb' : 'var(--border)'}`,
              background: isReadOnly ? 'var(--grey-100)' : isEmpty ? '#fafafa' : 'var(--surface)',
              borderRadius: '2px',
              minHeight: '50px',
              resize: 'vertical',
              opacity: isReadOnly ? 0.7 : 1
            }}
          />
        ) : inputType === 'checkbox' ? (
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => handleFieldChange(field, e.target.checked)}
            disabled={isReadOnly}
            style={{ marginTop: '2px' }}
          />
        ) : (
          <input
            type={inputType}
            value={displayValue}
            onChange={(e) => {
              let newValue: any = e.target.value;
              if (inputType === 'number' && newValue) {
                newValue = parseFloat(newValue);
                if (isNaN(newValue)) newValue = null;
              }
              if (newValue === '') newValue = null;
              handleFieldChange(field, newValue);
            }}
            disabled={isReadOnly}
            placeholder={isEmpty ? '(empty)' : undefined}
            style={{
              width: '100%',
              padding: '3px 6px',
              fontSize: '8pt',
              border: `1px solid ${isModified ? '#f59e0b' : isEmpty ? '#e5e7eb' : 'var(--border)'}`,
              background: isReadOnly ? 'var(--grey-100)' : isEmpty ? '#fafafa' : 'var(--surface)',
              borderRadius: '2px',
              opacity: isReadOnly ? 0.7 : 1,
              fontFamily: (field.includes('_id') || field === 'vin' || field.includes('_url')) ? 'monospace' : 'inherit',
              fontSize: field.includes('_url') ? '7pt' : '8pt'
            }}
          />
        )}
      </div>
    );
  };

  // Get sections that should be visible
  const getVisibleSections = () => {
    if (!vehicle) return [];

    return FIELD_SECTIONS.filter(section => {
      // Check prerequisite
      if (section.prerequisite && !section.prerequisite(vehicle)) {
        return false;
      }
      // Check if any fields exist in vehicle
      const hasFields = section.fields.some(f => f in vehicle && !HIDDEN_FIELDS.includes(f));
      return hasFields;
    });
  };

  // Get fields not in any section (for "Other" section)
  const getOtherFields = () => {
    if (!vehicle) return [];
    const allSectionFields = new Set(FIELD_SECTIONS.flatMap(s => s.fields));
    return Object.keys(vehicle)
      .filter(f => !allSectionFields.has(f) && !HIDDEN_FIELDS.includes(f))
      .sort();
  };

  return (
    <div
      style={{
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
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          width: '95%',
          maxWidth: '900px',
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--grey-100)'
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '11pt', fontWeight: 700 }}>
              Edit Vehicle
            </h2>
            {vehicle && (
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '2px' }}>
                {[vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ')}
                {vehicle.vin && <span style={{ marginLeft: '8px', fontFamily: 'monospace', color: '#6b7280' }}>VIN: {vehicle.vin}</span>}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '16pt',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: '0 8px'
            }}
          >
            ×
          </button>
        </div>

        {/* Image Carousel */}
        {images.length > 0 && !loading && (
          <div style={{
            borderBottom: '1px solid var(--border)',
            background: 'var(--grey-100)'
          }}>
            <div
              ref={carouselRef}
              style={{
                display: 'flex',
                gap: '6px',
                padding: '10px 12px',
                overflowX: 'auto',
                WebkitOverflowScrolling: 'touch',
                scrollbarWidth: 'thin'
              }}
            >
              {images.map((img, idx) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => openLightbox(img.image_url, idx)}
                  style={{
                    flexShrink: 0,
                    width: '70px',
                    height: '52px',
                    padding: 0,
                    border: img.is_primary ? '2px solid var(--primary)' : '1px solid var(--border)',
                    borderRadius: '3px',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    background: 'var(--surface)'
                  }}
                >
                  <img
                    src={img.image_url}
                    alt={`Vehicle ${idx + 1}`}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover'
                    }}
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
            <div style={{
              padding: '0 12px 6px',
              fontSize: '7pt',
              color: 'var(--text-muted)'
            }}>
              {images.length} image{images.length !== 1 ? 's' : ''} • Click to enlarge
            </div>
          </div>
        )}

        {/* Content */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: '12px'
        }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
              Loading...
            </div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: '24px', color: '#dc2626' }}>
              {error}
            </div>
          ) : vehicle ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* My Relationship / Ownership - Critical for misattribution */}
              <div style={{
                background: '#fef2f2',
                border: '1px solid #fca5a5',
                borderRadius: '4px',
                padding: '10px'
              }}>
                <div style={{
                  fontSize: '8pt',
                  fontWeight: 700,
                  color: '#991b1b',
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <span style={{ fontSize: '12px' }}>👤</span>
                  MY RELATIONSHIP TO THIS VEHICLE
                  <span style={{ fontWeight: 400, fontSize: '7pt', color: '#f87171' }}>Check for misattribution</span>
                </div>

                {/* Show current status */}
                <div style={{ marginBottom: '10px', fontSize: '8pt' }}>
                  {ownershipVerification ? (
                    <div style={{
                      padding: '6px 8px',
                      background: ownershipVerification.status === 'approved' ? '#dcfce7' : '#fef3c7',
                      border: `1px solid ${ownershipVerification.status === 'approved' ? '#86efac' : '#fcd34d'}`,
                      borderRadius: '3px',
                      marginBottom: '6px'
                    }}>
                      <strong>Ownership Verification:</strong> {ownershipVerification.status}
                      <div style={{ fontSize: '7pt', color: '#6b7280', marginTop: '2px' }}>
                        Submitted: {new Date(ownershipVerification.submitted_at).toLocaleDateString()}
                      </div>
                    </div>
                  ) : null}

                  {myRelationship ? (
                    <div style={{
                      padding: '6px 8px',
                      background: '#e0e7ff',
                      border: '1px solid #a5b4fc',
                      borderRadius: '3px'
                    }}>
                      <strong>Current Role:</strong>{' '}
                      <span style={{ textTransform: 'capitalize' }}>
                        {myRelationship.role.replace('_', ' ')}
                      </span>
                      {myRelationship.context && (
                        <span style={{ color: '#6b7280', marginLeft: '6px' }}>
                          ({myRelationship.context})
                        </span>
                      )}
                      {myRelationship.granted_at && (
                        <div style={{ fontSize: '7pt', color: '#6b7280', marginTop: '2px' }}>
                          Since: {new Date(myRelationship.granted_at).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{
                      padding: '6px 8px',
                      background: '#f3f4f6',
                      border: '1px solid #d1d5db',
                      borderRadius: '3px',
                      color: '#6b7280'
                    }}>
                      No explicit relationship set. May appear in your list due to import attribution.
                    </div>
                  )}
                </div>

                {/* Change relationship */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <label style={{ fontSize: '7pt', color: '#6b7280', fontWeight: 600 }}>
                    CHANGE TO:
                  </label>
                  <select
                    value={myRelationship?.role || ''}
                    onChange={(e) => updateMyRole(e.target.value)}
                    disabled={updatingRole}
                    style={{
                      padding: '4px 8px',
                      fontSize: '8pt',
                      border: '1px solid #d1d5db',
                      borderRadius: '3px',
                      background: 'white',
                      cursor: updatingRole ? 'wait' : 'pointer',
                      opacity: updatingRole ? 0.6 : 1
                    }}
                  >
                    <option value="">-- Select Role --</option>
                    {ROLE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label} - {opt.description}
                      </option>
                    ))}
                  </select>

                  {myRelationship && (
                    <button
                      type="button"
                      onClick={() => updateMyRole('remove')}
                      disabled={updatingRole}
                      style={{
                        padding: '4px 10px',
                        fontSize: '7pt',
                        fontWeight: 600,
                        background: '#fee2e2',
                        color: '#991b1b',
                        border: '1px solid #fca5a5',
                        borderRadius: '3px',
                        cursor: updatingRole ? 'wait' : 'pointer',
                        opacity: updatingRole ? 0.6 : 1
                      }}
                    >
                      {updatingRole ? 'UPDATING...' : 'REMOVE FROM MY VEHICLES'}
                    </button>
                  )}
                </div>

                <div style={{
                  marginTop: '8px',
                  fontSize: '7pt',
                  color: '#9ca3af',
                  lineHeight: 1.4
                }}>
                  <strong>Why is this here?</strong> Vehicles appear in your list based on: ownership verifications,
                  permissions (owner/co-owner roles), or system attribution (uploaded_by, discovered_by fields).
                  Use the dropdown to clarify or remove your relationship.
                </div>
              </div>

              {/* Documents On Hand */}
              <div style={{
                background: '#f0fdf4',
                border: '1px solid #86efac',
                borderRadius: '4px',
                padding: '10px'
              }}>
                <div style={{
                  fontSize: '8pt',
                  fontWeight: 700,
                  color: '#166534',
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <span style={{ fontSize: '12px' }}>📋</span>
                  DOCUMENTS ON HAND
                  <span style={{ fontWeight: 400, fontSize: '7pt', color: '#4ade80' }}>Check what you physically have</span>
                </div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                  gap: '4px'
                }}>
                  {DOCUMENT_TYPES.map(doc => (
                    <label
                      key={doc.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '4px 6px',
                        background: documentsOnHand[doc.key] ? '#dcfce7' : 'white',
                        border: `1px solid ${documentsOnHand[doc.key] ? '#86efac' : '#e5e7eb'}`,
                        borderRadius: '2px',
                        cursor: 'pointer',
                        fontSize: '7pt'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={!!documentsOnHand[doc.key]}
                        onChange={() => toggleDocument(doc.key)}
                        style={{ margin: 0, width: '12px', height: '12px' }}
                      />
                      <span style={{
                        color: documentsOnHand[doc.key] ? '#166534' : '#6b7280',
                        fontWeight: documentsOnHand[doc.key] ? 600 : 400
                      }}>
                        {doc.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Field Sections */}
              {getVisibleSections().map(section => {
                const isCollapsed = collapsedSections.has(section.id);
                const fieldsInSection = section.fields.filter(f => f in vehicle && !HIDDEN_FIELDS.includes(f));
                const filledCount = fieldsInSection.filter(f => vehicle[f] !== null && vehicle[f] !== undefined && vehicle[f] !== '').length;

                return (
                  <div
                    key={section.id}
                    style={{
                      border: `1px solid ${section.color}30`,
                      borderRadius: '4px',
                      overflow: 'hidden'
                    }}
                  >
                    {/* Section Header */}
                    <button
                      type="button"
                      onClick={() => toggleSection(section.id)}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        background: `${section.color}10`,
                        borderBottom: isCollapsed ? 'none' : `1px solid ${section.color}30`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        border: 'none',
                        textAlign: 'left'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                          width: '4px',
                          height: '16px',
                          background: section.color,
                          borderRadius: '2px'
                        }} />
                        <div>
                          <span style={{
                            fontSize: '8pt',
                            fontWeight: 700,
                            color: section.color
                          }}>
                            {section.title}
                          </span>
                          <span style={{
                            fontSize: '7pt',
                            color: '#9ca3af',
                            marginLeft: '8px'
                          }}>
                            {section.subtitle}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                          fontSize: '7pt',
                          color: filledCount === fieldsInSection.length ? '#16a34a' : '#9ca3af',
                          background: filledCount === fieldsInSection.length ? '#dcfce7' : '#f3f4f6',
                          padding: '2px 6px',
                          borderRadius: '10px'
                        }}>
                          {filledCount}/{fieldsInSection.length}
                        </span>
                        <span style={{ fontSize: '8pt', color: '#9ca3af' }}>
                          {isCollapsed ? '▶' : '▼'}
                        </span>
                      </div>
                    </button>

                    {/* Section Content */}
                    {!isCollapsed && (
                      <div style={{
                        padding: '10px',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                        gap: '8px',
                        background: 'var(--surface)'
                      }}>
                        {fieldsInSection.map(field => renderField(field, section.readonly))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Other Fields */}
              {getOtherFields().length > 0 && (
                <div style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: '4px',
                  overflow: 'hidden'
                }}>
                  <button
                    type="button"
                    onClick={() => toggleSection('other')}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      background: '#f9fafb',
                      borderBottom: collapsedSections.has('other') ? 'none' : '1px solid #e5e7eb',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      border: 'none',
                      textAlign: 'left'
                    }}
                  >
                    <span style={{ fontSize: '8pt', fontWeight: 700, color: '#6b7280' }}>
                      OTHER FIELDS
                      <span style={{ fontWeight: 400, marginLeft: '8px', color: '#9ca3af' }}>
                        {getOtherFields().length} additional fields
                      </span>
                    </span>
                    <span style={{ fontSize: '8pt', color: '#9ca3af' }}>
                      {collapsedSections.has('other') ? '▶' : '▼'}
                    </span>
                  </button>
                  {!collapsedSections.has('other') && (
                    <div style={{
                      padding: '10px',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                      gap: '8px'
                    }}>
                      {getOtherFields().map(field => renderField(field))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 16px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--grey-100)'
        }}>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
            {Object.keys(editedFields).length > 0 && (
              <span style={{ color: '#f59e0b', fontWeight: 600 }}>
                {Object.keys(editedFields).length} field(s) modified
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={onClose}
              style={{
                padding: '6px 16px',
                fontSize: '9pt',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '2px',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || Object.keys(editedFields).length === 0}
              style={{
                padding: '6px 16px',
                fontSize: '9pt',
                fontWeight: 600,
                background: Object.keys(editedFields).length > 0 ? 'var(--primary)' : 'var(--grey-300)',
                color: Object.keys(editedFields).length > 0 ? 'white' : 'var(--text-muted)',
                border: 'none',
                borderRadius: '2px',
                cursor: Object.keys(editedFields).length > 0 ? 'pointer' : 'default'
              }}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>

      {/* Lightbox Popup */}
      {lightboxImage && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}
          onClick={closeLightbox}
        >
          <button
            onClick={closeLightbox}
            style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              color: 'white',
              fontSize: '24px',
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ×
          </button>

          {images.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigateLightbox('prev');
              }}
              style={{
                position: 'absolute',
                left: '16px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                color: 'white',
                fontSize: '24px',
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              ‹
            </button>
          )}

          <img
            src={lightboxImage}
            alt="Vehicle"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '90vw',
              maxHeight: '85vh',
              objectFit: 'contain',
              borderRadius: '4px'
            }}
          />

          {images.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigateLightbox('next');
              }}
              style={{
                position: 'absolute',
                right: '16px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                color: 'white',
                fontSize: '24px',
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              ›
            </button>
          )}

          <div
            style={{
              position: 'absolute',
              bottom: '16px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.6)',
              color: 'white',
              padding: '6px 12px',
              borderRadius: '4px',
              fontSize: '9pt'
            }}
          >
            {lightboxIndex + 1} / {images.length}
          </div>
        </div>
      )}
    </div>
  );
};

export default VehicleEditModal;
