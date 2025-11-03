import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactDOM from 'react-dom';
import { supabase } from '../lib/supabase';
import TradePanel from '../components/trading/TradePanel';
import AddOrganizationData from '../components/organization/AddOrganizationData';
import OrganizationInventory from '../components/organization/OrganizationInventory';
import OrganizationTimelineHeatmap from '../components/organization/OrganizationTimelineHeatmap';
import OrganizationLocationPicker from '../components/organization/OrganizationLocationPicker';
import LaborRateEditor from '../components/organization/LaborRateEditor';
import WorkOrderRequestForm from '../components/organization/WorkOrderRequestForm';
import DropboxImporter from '../components/dealer/DropboxImporter';
import MobileVINScanner from '../components/dealer/MobileVINScanner';
import ContractorWorkInput from '../components/contractor/ContractorWorkInput';
import OrganizationEditor from '../components/organization/OrganizationEditor';
import PendingContributionApprovals from '../components/contribution/PendingContributionApprovals';
import EnhancedDealerInventory from '../components/organization/EnhancedDealerInventory';
import BaTBulkImporter from '../components/dealer/BaTBulkImporter';
import '../design-system.css';

interface Organization {
  id: string;
  business_name: string;
  legal_name?: string;
  business_type?: string;
  description?: string;
  logo_url?: string;
  banner_url?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  latitude?: number;
  longitude?: number;
  status?: string;
  verification_level?: string;
  is_public: boolean;
  is_tradable?: boolean;
  stock_symbol?: string;
  current_value?: number;
  total_vehicles?: number;
  total_images?: number;
  total_events?: number;
  discovered_by?: string;
  uploaded_by?: string;
  labor_rate?: number;
  created_at: string;
  updated_at: string;
}

interface OrgImage {
  id: string;
  image_url: string;
  thumbnail_url?: string;
  large_url?: string;
  caption?: string;
  category?: string;
  taken_at?: string;
  uploaded_at: string;
  user_id: string;
  location_name?: string;
  latitude?: number;
  longitude?: number;
  exif_data?: any;
  is_sensitive?: boolean;
  sensitivity_type?: string;
  visibility_level?: string;
  blur_preview?: boolean;
  contains_financial_data?: boolean;
}

interface OrgVehicle {
  id: string;
  vehicle_id: string;
  relationship_type: string;
  vehicle_year?: number;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_vin?: string;
  vehicle_current_value?: number;
  vehicle_image_url?: string;
}

interface Offering {
  id: string;
  offering_type: string;
  stock_symbol: string;
  total_shares: number;
  current_share_price: number;
  opening_price?: number;
  closing_price?: number;
  status: string;
}

export default function OrganizationProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [images, setImages] = useState<OrgImage[]>([]);
  const [vehicles, setVehicles] = useState<OrgVehicle[]>([]);
  const [offering, setOffering] = useState<Offering | null>(null);
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'vehicles' | 'images' | 'inventory' | 'contributors'>('overview');
  const [showTrade, setShowTrade] = useState(false);
  const [showOwnershipModal, setShowOwnershipModal] = useState(false);
  const [showContributeModal, setShowContributeModal] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [contributors, setContributors] = useState<any[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<OrgImage | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number>(0);
  const [imageTags, setImageTags] = useState<Record<string, Array<{tag: string, confidence: number}>>>({});
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showLaborRateEditor, setShowLaborRateEditor] = useState(false);
  const [showWorkOrderForm, setShowWorkOrderForm] = useState(false);
  const [showContractorWorkInput, setShowContractorWorkInput] = useState(false);
  const [selectedWorkOrderImage, setSelectedWorkOrderImage] = useState<OrgImage | null>(null);
  const [showOrganizationEditor, setShowOrganizationEditor] = useState(false);
  const [showBaTImporter, setShowBaTImporter] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const ownershipUploadId = `org-ownership-${id}`;

  useEffect(() => {
    loadOrganization();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
  }, [id]);

  const loadImageTags = async (imageIds: string[]) => {
    try {
      const { data: tags } = await supabase
        .from('organization_image_tags')
        .select('image_id, tag, confidence')
        .in('image_id', imageIds)
        .order('confidence', { ascending: false });

      if (tags) {
        const tagsByImage: Record<string, Array<{tag: string, confidence: number}>> = {};
        tags.forEach(t => {
          if (!tagsByImage[t.image_id]) {
            tagsByImage[t.image_id] = [];
          }
          tagsByImage[t.image_id].push({ tag: t.tag, confidence: t.confidence || 0 });
        });
        setImageTags(tagsByImage);
      }
    } catch (error) {
      console.error('Error loading image tags:', error);
    }
  };

  const loadOrganization = async () => {
    if (!id) return;

    try {
      setLoading(true);

      // Load organization
      const { data: org, error: orgError } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', id)
        .single();

      if (orgError) throw orgError;
      setOrganization(org);

      // Load images
      const { data: orgImages } = await supabase
        .from('organization_images')
        .select('*')
        .eq('organization_id', id)
        .order('uploaded_at', { ascending: false });

      setImages(orgImages || []);

      // Load AI tags for all images
      if (orgImages && orgImages.length > 0) {
        await loadImageTags(orgImages.map(img => img.id));
      }

      // Load associated vehicles with enriched data
      const { data: orgVehicles } = await supabase
        .from('organization_vehicles')
        .select(`
          id,
          vehicle_id,
          relationship_type,
          vehicles:vehicle_id (
            year,
            make,
            model,
            vin,
            current_value,
            vehicle_images:vehicle_images(image_url)
          )
        `)
        .eq('organization_id', id)
        .eq('status', 'active');

      const enrichedVehicles = (orgVehicles || []).map((ov: any) => ({
        id: ov.id,
        vehicle_id: ov.vehicle_id,
        relationship_type: ov.relationship_type,
        vehicle_year: ov.vehicles?.year,
        vehicle_make: ov.vehicles?.make,
        vehicle_model: ov.vehicles?.model,
        vehicle_vin: ov.vehicles?.vin,
        vehicle_current_value: ov.vehicles?.current_value,
        vehicle_image_url: ov.vehicles?.vehicle_images?.[0]?.image_url
      }));
      setVehicles(enrichedVehicles);

      // Load tradable offering if exists
      if (org.is_tradable && org.stock_symbol) {
        const { data: offeringData } = await supabase
          .from('organization_offerings')
          .select('*')
          .eq('organization_id', id)
          .eq('status', 'active')
          .maybeSingle();

        setOffering(offeringData);
      }

      // Load contributors with attribution
      const { data: contributorsData, error: contributorsError } = await supabase
        .from('organization_contributors')
        .select('id, user_id, role, contribution_count, created_at')
        .eq('organization_id', id)
        .order('contribution_count', { ascending: false })
        .limit(20);

      if (contributorsError) {
        console.error('Error loading contributors:', contributorsError);
      }

      // Enrich with profile data
      const enrichedContributors = await Promise.all(
        (contributorsData || []).map(async (c: any) => {
            const { data: profile } = await supabase
              .from('profiles')
            .select('id, full_name, username, avatar_url')
            .eq('id', c.user_id)
              .single();

            return {
            ...c,
            profiles: profile
            };
          })
        );

      setContributors(enrichedContributors);

      // Check if current user is owner OR first contributor (if no owner exists)
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user && org) {
        // Get current user's role in the organization
        const currentUserContributor = enrichedContributors.find(c => c.user_id === user.id);
        const userRole = currentUserContributor?.role || null;
        setCurrentUserRole(userRole);
        
        // Set canEdit based on role
        const editRoles = ['owner', 'co_founder', 'board_member', 'manager', 'employee', 'technician', 'moderator', 'contractor', 'contributor'];
        setCanEdit(userRole !== null && editRoles.includes(userRole));

        // First check if there's any verified owner
        const { data: anyOwner } = await supabase
          .from('business_ownership')
          .select('id')
          .eq('business_id', org.id)
          .eq('status', 'active')
          .maybeSingle();

        if (anyOwner) {
          // If there's an owner, check if it's the current user
          const { data: ownership } = await supabase
            .from('business_ownership')
            .select('id, owner_id, status')
            .eq('business_id', org.id)
            .eq('owner_id', user.id)
            .eq('status', 'active')
            .maybeSingle();

          setIsOwner(!!ownership);
        } else {
          // No owner exists - check if current user is the first contributor AND has owner role
          const { data: firstContributor } = await supabase
            .from('organization_contributors')
            .select('user_id, role')
            .eq('organization_id', org.id)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();

          // User has control if they're the first contributor AND have owner/manager role
          const isFirstOwner = firstContributor?.user_id === user.id &&
            firstContributor?.role &&
            ['owner', 'co_founder', 'board_member', 'manager'].includes(firstContributor.role);
          setIsOwner(isFirstOwner);
          
          // If first contributor, grant edit access
          if (firstContributor?.user_id === user.id) {
            setCanEdit(true);
          }
        }
      } else {
        // Not logged in - no edit access
        setCanEdit(false);
      }

      // Load timeline for attribution tracking
      const { data: eventsData, error: eventsError } = await supabase
        .from('business_timeline_events')
        .select('id, event_type, title, description, event_date, created_by, metadata')
        .eq('business_id', id)
        .order('event_date', { ascending: false })
        .limit(50);

      if (eventsError) {
        console.error('Error loading timeline:', eventsError);
      }

      // Enrich with profile data
      const enrichedEvents = await Promise.all(
        (eventsData || []).map(async (e: any) => {
            const { data: profile } = await supabase
              .from('profiles')
            .select('full_name, username, avatar_url')
            .eq('id', e.created_by)
              .single();

            return {
            ...e,
            profiles: profile
            };
          })
        );

      setTimelineEvents(enrichedEvents);

    } catch (error: any) {
      console.error('Error loading organization:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteImage = async (imageId: string) => {
    if (!confirm('Delete this image? This cannot be undone.')) return;

    try {
      const { error } = await supabase
        .from('organization_images')
        .delete()
        .eq('id', imageId);

      if (error) throw error;

      // Remove from local state
      setImages(images.filter(img => img.id !== imageId));
      alert('Image deleted successfully');
    } catch (error: any) {
      console.error('Error deleting image:', error);
      alert(`Failed to delete: ${error.message}`);
    }
  };

  const handleSetPrimary = async (imageId: string) => {
    try {
      const selectedImage = images.find(img => img.id === imageId);
      if (!selectedImage) return;

      // First, remove 'logo' from all images
      await supabase
        .from('organization_images')
        .update({ category: 'facility' })
        .eq('organization_id', id)
        .eq('category', 'logo');

      // Then set the selected image as 'logo' (primary)
      const { error: imageError } = await supabase
        .from('organization_images')
        .update({ category: 'logo' })
        .eq('id', imageId);

      if (imageError) throw imageError;

      // Also update the organization's logo_url
      const { error: orgError } = await supabase
        .from('businesses')
        .update({ logo_url: selectedImage.large_url || selectedImage.image_url })
        .eq('id', id);

      if (orgError) throw orgError;

      // Reload images
      loadOrganization();
      alert('Primary image updated');
    } catch (error: any) {
      console.error('Error setting primary:', error);
      alert(`Failed: ${error.message}`);
    }
  };

  const handleScanImage = async (imageId: string) => {
    try {
      const image = images.find(img => img.id === imageId);
      if (!image) return;

      // Call AI scanning edge function
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/scan-organization-image`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`
          },
          body: JSON.stringify({
            imageId: image.id,
            imageUrl: image.image_url,
            organizationId: id
          })
        }
      );

      if (!response.ok) throw new Error('Scan failed');

      const result = await response.json();
      alert(`Scan complete! Found: ${result.tags?.length || 0} tags, ${result.inventory?.length || 0} inventory items`);
      
      // Reload to show tags
      loadOrganization();
    } catch (error: any) {
      console.error('Error scanning image:', error);
      alert(`Scan failed: ${error.message}`);
    }
  };

  const handleOwnershipSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user?.id || !organization?.id) return;

    const formData = new FormData(e.target as HTMLFormElement);
    const verificationType = formData.get('verificationType') as string;
    const documentFile = fileInputRef.current?.files?.[0];

    if (!documentFile) {
      alert('Please select a document file');
      return;
    }

    try {
      // Upload to storage
      const fileExt = documentFile.name.split('.').pop();
      const fileName = `${Date.now()}_${verificationType}.${fileExt}`;
      const storagePath = `organization-data/${organization.id}/ownership/${fileName}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('vehicle-data')
        .upload(storagePath, documentFile);

      if (uploadError) throw uploadError;

      const publicUrl = supabase.storage.from('vehicle-data').getPublicUrl(storagePath).data.publicUrl;

      // Check for existing verification
      const { data: existing } = await supabase
        .from('organization_ownership_verifications')
        .select('id')
        .eq('user_id', session.user.id)
        .eq('organization_id', organization.id)
        .in('status', ['pending', 'approved'])
        .maybeSingle();

      if (existing) {
        // Update existing
        await supabase
          .from('organization_ownership_verifications')
          .update({
            verification_type: verificationType,
            document_url: publicUrl,
            status: 'pending',
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
      } else {
        // Create new
        await supabase
          .from('organization_ownership_verifications')
          .insert({
            organization_id: organization.id,
            user_id: session.user.id,
            verification_type: verificationType,
            document_url: publicUrl,
            status: 'pending'
          });
      }

      alert('Ownership claim submitted. Awaiting review.');
      setShowOwnershipModal(false);
      setSelectedFileName('');
      loadOrganization();

    } catch (error: any) {
      console.error('Ownership submission error:', error);
      alert(`Failed: ${error.message}`);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
        <div className="text">Loading organization...</div>
      </div>
    );
  }

  if (!organization) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
        <div className="text">Organization not found</div>
        <button
          onClick={() => navigate('/organizations')}
          className="button button-secondary"
          style={{ marginTop: 'var(--space-3)', fontSize: '9pt' }}
        >
          Back to Organizations
        </button>
      </div>
    );
  }

  const primaryImage = images.find(i => i.category === 'logo') || images[0];
  const displayName = organization.business_name || organization.legal_name || 'Unnamed Organization';

  return (
    <div style={{ background: '#f5f5f5', minHeight: '100vh' }}>
      {/* HEADER: Price, Stock Symbol, Trade Button, Owner Badge */}
      <div style={{
        background: 'var(--white)',
        borderBottom: '1px solid #e5e5e5',
        padding: '12px 16px',
        position: 'sticky',
        top: 48,
        zIndex: 10,
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>

          {/* Stock price (if tradable) */}
          {organization.is_tradable && offering && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--color-text)' }}>
                  ${offering.current_share_price.toFixed(2)}
                </div>
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>per share</span>
              </div>
              <span style={{
                background: '#f3f4f6',
                border: '1px solid #c0c0c0',
                padding: '1px 4px',
                borderRadius: '2px',
                fontSize: '8pt',
                color: '#006400',
                fontWeight: 600
              }}>
                {organization.stock_symbol || 'ORG'}
              </span>
          <button
                onClick={() => setShowTrade(true)}
                className="button button-primary button-small"
                style={{ fontSize: '8pt', fontFamily: '"MS Sans Serif", sans-serif', borderRadius: 0 }}
          >
                Trade Shares
          </button>
            </div>
          )}

          {/* Organization name */}
          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text)' }}>
            {displayName}
              </div>

          {/* Creator badge with actual username - hide if creator is current user and only a contractor */}
          {organization.discovered_by && (() => {
            // Find the creator in contributors list
            const creator = contributors.find(c => c.user_id === organization.discovered_by);
            const creatorName = creator?.profiles?.full_name || creator?.profiles?.username || 'Unknown';
            const creatorRole = creator?.role;
            
            // Check if creator is the current user
            const isCurrentUser = session?.user?.id === organization.discovered_by;
            
            // Hide badge if current user is creator AND they're only a contractor/moderator (not owner/manager)
            if (isCurrentUser) {
              const isCreatorOwner = creatorRole && ['owner', 'co_founder', 'board_member', 'manager'].includes(creatorRole);
              if (!isCreatorOwner) {
                // Current user created it but is only contractor/moderator - hide badge
                return null;
              }
            }
            
            return (
              <a
                href={`/profile/${organization.discovered_by}`}
                className="badge badge-secondary"
                title="View profile"
                style={{ textDecoration: 'none', fontSize: '8pt', cursor: 'pointer' }}
              >
                Created by {creatorName}
              </a>
            );
          })()}

          {/* Action buttons */}
          {session && (
            <>
              <button
                onClick={() => setShowWorkOrderForm(true)}
                className="button button-primary button-small"
                style={{ fontSize: '8pt', fontFamily: '"MS Sans Serif", sans-serif', borderRadius: 0 }}
              >
                Request Work
              </button>
              <button
                onClick={() => setShowContributeModal(true)}
                className="button button-secondary button-small"
                style={{ fontSize: '8pt', fontFamily: '"MS Sans Serif", sans-serif', borderRadius: 0 }}
              >
                Contribute Data
              </button>
              {!isOwner && (
                <button
                  onClick={() => setShowOwnershipModal(true)}
                  className="button button-secondary button-small"
                  style={{ fontSize: '8pt', fontFamily: '"MS Sans Serif", sans-serif', borderRadius: 0 }}
                >
                  Claim Ownership
                </button>
              )}
            </>
                )}
        </div>
              </div>

      {/* Primary Image */}
      {primaryImage && (
        <section style={{ margin: '16px' }}>
          <div
            style={{
              backgroundImage: `url(${primaryImage.image_url})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              height: '300px',
              border: '1px solid var(--border)',
              position: 'relative'
            }}
          />
        </section>
      )}

      {/* Tabs */}
              <div style={{
        background: 'var(--white)',
        borderBottom: '2px solid var(--border)',
        padding: '0 16px'
      }}>
        {(['overview', 'vehicles', 'images', 'inventory', 'contributors'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: activeTab === tab ? 'var(--grey-200)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid var(--accent)' : 'none',
              padding: '8px 12px',
              fontSize: '9pt',
              cursor: 'pointer',
              fontFamily: 'Arial, sans-serif',
              textTransform: 'capitalize',
              color: activeTab === tab ? 'var(--accent)' : 'var(--text)'
            }}
          >
            {tab}
          </button>
        ))}
              </div>

      {/* Content */}
      <div style={{ padding: '16px' }}>
        {activeTab === 'overview' && (
          <>
            {/* Pending Contribution Approvals (for owners/managers) */}
            {(isOwner || currentUserRole === 'manager') && (
              <div style={{ marginBottom: '16px' }}>
                <PendingContributionApprovals />
              </div>
            )}

            {/* GitHub-Style Activity Heatmap */}
            <div style={{ marginBottom: '16px' }}>
              <OrganizationTimelineHeatmap organizationId={id!} />
            </div>

            {/* Detailed Event Cards */}
            <div className="card" style={{ marginBottom: '16px' }}>
              <div className="card-header" style={{ fontSize: '11pt', fontWeight: 700 }}>
                Recent Work Orders & Events
              </div>
              <div className="card-body">
                {timelineEvents.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '9pt' }}>
                    No work orders or events yet. Upload images or add inventory to create timeline entries.
                  </div>
                ) : (
                  <div>
                    {(() => {
                      // Group events by date + title + vehicle to remove duplicates
                      const grouped = new Map();
                      
                      for (const event of timelineEvents) {
                        const key = `${event.event_date}_${event.title}_${event.metadata?.vehicle_id || 'no-vehicle'}`;
                        
                        if (!grouped.has(key)) {
                          grouped.set(key, { ...event, count: 1, image_count: event.image_urls?.length || 0 });
                        } else {
                          const existing = grouped.get(key);
                          existing.count++;
                          existing.image_count += (event.image_urls?.length || 0);
                        }
                      }
                      
                      return Array.from(grouped.values())
                        .sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime())
                        .slice(0, 10)
                        .map((event: any) => (
                          <div
                            key={event.id}
                            style={{
                              padding: '12px',
                              marginBottom: '8px',
                              border: '1px solid var(--border-light)',
                              borderRadius: '4px',
                              background: 'var(--white)'
                            }}
                          >
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <div style={{ flex: 1 }}>
                            {/* Show vehicle name prominently if this is vehicle work */}
                            {event.metadata?.vehicle_name && event.metadata?.vehicle_id && (
                              <a 
                                href={`/vehicle/${event.metadata.vehicle_id}`}
                                style={{ 
                                  fontSize: '9pt', 
                                  fontWeight: 600, 
                                  color: 'var(--accent)', 
                                  marginBottom: '2px',
                                  display: 'block',
                                  textDecoration: 'none'
                                }}
                                className="hover:underline"
                              >
                                {event.metadata.vehicle_name}
                              </a>
                            )}
                            <div style={{ fontSize: '10pt', fontWeight: event.metadata?.vehicle_name ? 400 : 700, marginBottom: '2px' }}>
                              {/* Strip redundant vehicle name from title if it starts with it */}
                              {(() => {
                                let title = event.title;
                                if (event.metadata?.vehicle_name && title.startsWith(event.metadata.vehicle_name)) {
                                  title = title.substring(event.metadata.vehicle_name.length).trim();
                                }
                                return title;
                              })()}
                            </div>
                            {event.description && (
                              <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                {event.description}
                              </div>
                            )}
                          </div>
                          <div style={{ fontSize: '7pt', color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: '12px' }}>
                            {new Date(event.event_date).toLocaleDateString()}
                          </div>
                        </div>

                        {/* Event metadata */}
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                          {event.count > 1 && (
                            <div style={{
                              fontSize: '7pt',
                              padding: '2px 6px',
                              borderRadius: '2px',
                              background: '#e3f2fd',
                              color: '#1976d2',
                              fontWeight: 600
                            }}>
                              {event.count}× events
                            </div>
                          )}
                          
                          {event.image_count > 0 && (
                            <div style={{
                              fontSize: '7pt',
                              padding: '2px 6px',
                              borderRadius: '2px',
                              background: '#fff3cd',
                              color: '#856404'
                            }}>
                              {event.image_count} {event.image_count === 1 ? 'photo' : 'photos'}
                            </div>
                          )}
                          
                          <div style={{
                            fontSize: '7pt',
                            padding: '2px 6px',
                            borderRadius: '2px',
                            background: 'var(--accent-dim)',
                            color: 'var(--accent)'
                          }}>
                            {event.event_category?.replace(/_/g, ' ')}
                          </div>

                          {event.cost_amount && (
                            <div style={{
                              fontSize: '7pt',
                              padding: '2px 6px',
                              borderRadius: '2px',
                              background: 'var(--success-dim)',
                              color: 'var(--success)',
                              fontWeight: 600
                            }}>
                              ${event.cost_amount.toLocaleString()}
                            </div>
                          )}

                          {event.labor_hours && (
                            <div style={{
                              fontSize: '7pt',
                              padding: '2px 6px',
                              borderRadius: '2px',
                              background: 'var(--info-dim)',
                              color: 'var(--info)'
                            }}>
                              {event.labor_hours}h
                            </div>
                          )}
                        </div>
                      </div>
                        ));
                    })()}
                  </div>
                )}
              </div>
            </div>

            {/* Basic Info */}
            <div className="card" style={{ marginBottom: '16px' }}>
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Organization Details</span>
                {isOwner && (
                  <button
                    className="button button-small button-secondary"
                    onClick={() => setShowLocationPicker(true)}
                    style={{ fontSize: '8pt' }}
                  >
                    {organization.latitude && organization.longitude ? 'Update Location' : 'Set GPS Location'}
                  </button>
                )}
              </div>
              <div className="card-body" style={{ fontSize: '9pt' }}>
                {organization.business_type && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Type:</strong> {organization.business_type}
                  </div>
                )}
              {organization.description && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Description:</strong> {organization.description}
                  </div>
              )}
                {organization.address && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Address:</strong> {organization.address}, {organization.city}, {organization.state} {organization.zip_code}
                  </div>
                )}
                {organization.latitude && organization.longitude && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>GPS:</strong> {organization.latitude.toFixed(6)}, {organization.longitude.toFixed(6)}
                    {' '}
                    <a 
                      href={`https://www.google.com/maps?q=${organization.latitude},${organization.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: '8pt', color: 'var(--accent)' }}
                    >
                      (view on map)
                    </a>
                  </div>
                )}
                {organization.phone && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Phone:</strong>{' '}
                    <a href={`tel:${organization.phone}`} style={{ color: 'var(--accent)', textDecoration: 'none' }} className="hover:underline">
                      {organization.phone}
                    </a>
                  </div>
                )}
                {organization.email && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Email:</strong>{' '}
                    <a href={`mailto:${organization.email}`} style={{ color: 'var(--accent)', textDecoration: 'none' }} className="hover:underline">
                      {organization.email}
                    </a>
                  </div>
                )}
                {organization.website && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Website:</strong>{' '}
                    <a href={organization.website} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }} className="hover:underline">
                      {organization.website}
                    </a>
                  </div>
                )}
                {organization.labor_rate && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Labor Rate:</strong> ${organization.labor_rate}/hr
                    {isOwner && (
                      <button
                        onClick={() => setShowLaborRateEditor(true)}
                        style={{
                          marginLeft: '8px',
                          fontSize: '8pt',
                          padding: '2px 6px',
                          background: 'transparent',
                          border: '1px solid var(--border)',
                          borderRadius: '3px',
                          cursor: 'pointer'
                        }}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                )}
                {!organization.labor_rate && isOwner && (
                  <div style={{ marginBottom: '6px' }}>
                    <button
                      onClick={() => setShowLaborRateEditor(true)}
                      className="button button-small button-secondary"
                      style={{ fontSize: '8pt' }}
                    >
                      Set Labor Rate
                    </button>
                  </div>
                )}
                
                {/* Edit Organization Details Button */}
                {(isOwner || currentUserRole === 'moderator' || currentUserRole === 'contractor') && (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
                    <button
                      onClick={() => setShowOrganizationEditor(true)}
                      className="button button-small"
                      style={{ fontSize: '8pt' }}
                    >
                      ✏️ Edit Organization Details
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Stock Info (if tradable) */}
            {organization.is_tradable && offering && (
              <div className="card" style={{ marginBottom: '16px' }}>
                <div className="card-header">Stock Information</div>
                <div className="card-body" style={{ fontSize: '9pt' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>Symbol</div>
                      <div style={{ fontWeight: 600 }}>{offering.stock_symbol}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>Current Price</div>
                      <div style={{ fontWeight: 600 }}>${offering.current_share_price.toFixed(2)}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>Total Shares</div>
                      <div style={{ fontWeight: 600 }}>{offering.total_shares.toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>Market Cap</div>
                      <div style={{ fontWeight: 600 }}>
                        ${(offering.current_share_price * offering.total_shares).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Stats */}
            <div className="card" style={{ marginBottom: '16px' }}>
              <div className="card-header">Statistics</div>
              <div className="card-body" style={{ fontSize: '9pt' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', textAlign: 'center' }}>
                  <div>
                    <div style={{ fontSize: '14pt', fontWeight: 'bold' }}>{vehicles.length}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>Vehicles</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '14pt', fontWeight: 'bold' }}>{images.length}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>Images</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '14pt', fontWeight: 'bold' }}>{timelineEvents.length}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>Events</div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === 'vehicles' && (
          <EnhancedDealerInventory
            organizationId={id}
            userId={session?.user?.id || null}
            canEdit={canEdit}
            isOwner={isOwner}
          />
        )}

        {activeTab === 'images' && (
          <div className="card">
            <div className="card-header">Images ({images.length})</div>
            <div className="card-body">
              {images.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-muted)', fontSize: '9pt' }}>
                  No images yet
                </div>
              ) : (
            <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: '16px'
                }}>
                  {images.map(img => (
                    <div
                      key={img.id}
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        overflow: 'hidden',
              background: 'var(--white)',
                        cursor: 'pointer'
                      }}
                      className="hover-lift"
                      onClick={() => {
                        setLightboxImage(img);
                        setLightboxIndex(images.indexOf(img));
                      }}
                    >
                      {/* Full-res image (with blur for sensitive) */}
                      <div
                        style={{
                          aspectRatio: '4/3',
                          backgroundImage: `url(${img.large_url || img.image_url})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                          position: 'relative',
                          filter: img.blur_preview && img.is_sensitive ? 'blur(20px)' : 'none',
                          transition: 'filter 0.2s ease'
                        }}
                      >
                          {/* Category badge */}
                        {img.category && (
                          <div style={{
                            position: 'absolute',
                            top: '8px',
                            left: '8px',
                            background: 'rgba(0,0,0,0.7)',
                            color: '#fff',
                            padding: '4px 8px',
                            borderRadius: '2px',
                            fontSize: '7pt',
                            fontWeight: 700,
                            textTransform: 'capitalize'
                          }}>
                            {img.category.replace(/_/g, ' ')}
                          </div>
                        )}

                        {/* Primary badge */}
                        {img.category === 'logo' && (
                          <div style={{
                            position: 'absolute',
                            top: '8px',
                            right: '8px',
                            background: 'var(--accent)',
                            color: '#fff',
                            padding: '4px 8px',
                            borderRadius: '2px',
                            fontSize: '7pt',
                            fontWeight: 700
                          }}>
                            PRIMARY
                          </div>
                        )}
                        
                        {/* Sensitive/Private badge */}
                        {img.is_sensitive && (
                          <div style={{
                            position: 'absolute',
                            top: img.category === 'logo' ? '40px' : '8px',
                            right: '8px',
                            background: 'rgba(220, 38, 38, 0.9)',
                            color: '#fff',
                            padding: '4px 8px',
                            borderRadius: '2px',
                            fontSize: '7pt',
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}>
                            PRIVATE
                            {img.blur_preview && ' (BLURRED)'}
                          </div>
                        )}

                        {/* Management buttons */}
                        {(isOwner || img.user_id === session?.user?.id) && (
                          <div style={{
                            position: 'absolute',
                            bottom: '8px',
                            right: '8px',
                            display: 'flex',
                            gap: '4px'
                          }}
                          onClick={(e) => e.stopPropagation()}
                          >
                            {/* Log Work button for work order images */}
                            {img.contains_financial_data && img.user_id === session?.user?.id && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedWorkOrderImage(img);
                                  setShowContractorWorkInput(true);
                                }}
                                style={{
                                  background: 'rgba(16, 185, 129, 0.95)',
                                  border: '1px solid #10b981',
                                  borderRadius: '2px',
                                  padding: '4px 8px',
                                  fontSize: '7pt',
                                  cursor: 'pointer',
                                  fontWeight: 600,
                                  color: 'white'
                                }}
                                title="Log work from this receipt"
                              >
                                LOG WORK
                              </button>
                            )}
                            
                            {isOwner && (
                              <>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSetPrimary(img.id);
                                  }}
                                  style={{
                                    background: 'rgba(255,255,255,0.9)',
                                    border: '1px solid var(--border)',
                                    borderRadius: '2px',
                                    padding: '4px 8px',
                                    fontSize: '7pt',
                                    cursor: 'pointer',
                                    fontWeight: 600
                                  }}
                                  title="Set as primary"
                                >
                                  PRIMARY
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleScanImage(img.id);
                                  }}
                                  style={{
                                    background: 'rgba(255,255,255,0.9)',
                                    border: '1px solid var(--border)',
                                    borderRadius: '2px',
                                    padding: '4px 8px',
                                    fontSize: '7pt',
                                    cursor: 'pointer',
                                    fontWeight: 600
                                  }}
                                  title="Scan with AI"
                                >
                                  SCAN
                                </button>
                              </>
                            )}
                            
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteImage(img.id);
                              }}
                              style={{
                                background: 'rgba(255,255,255,0.9)',
                                border: '1px solid var(--border)',
                                borderRadius: '2px',
                                padding: '4px 8px',
                                fontSize: '7pt',
                                cursor: 'pointer',
                                fontWeight: 600,
                                color: 'var(--error)'
                              }}
                              title="Delete image"
                            >
                              DELETE
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Image metadata */}
                      <div style={{ padding: '10px' }}>
                        {img.caption && (
                          <div style={{ fontSize: '8pt', marginBottom: '6px', fontWeight: 600 }}>
                            {img.caption}
              </div>
                        )}

                        {/* Date and location */}
                        <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '6px' }}>
                          {img.taken_at ? new Date(img.taken_at).toLocaleDateString() : new Date(img.uploaded_at).toLocaleDateString()}
                          {img.location_name && ` · ${img.location_name}`}
            </div>

                        {/* EXIF data */}
                        {img.exif_data && Object.keys(img.exif_data).length > 0 && (
                          <div style={{
                            fontSize: '7pt',
                            color: 'var(--text-secondary)',
                            background: 'var(--surface)',
                            padding: '6px',
                            borderRadius: '2px',
                            marginTop: '6px'
                          }}>
                            {img.exif_data.Make && <div>Camera: {img.exif_data.Make} {img.exif_data.Model}</div>}
                            {img.exif_data.FocalLength && <div>Focal: {img.exif_data.FocalLength}</div>}
                            {img.exif_data.ISO && <div>ISO: {img.exif_data.ISO}</div>}
          </div>
        )}

                        {/* GPS coordinates */}
                        {(img.latitude || img.longitude) && (
          <div style={{
                            fontSize: '7pt',
                            color: 'var(--accent)',
                            marginTop: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}>
                            <span>Location</span>
                            <span>{img.latitude?.toFixed(4)}, {img.longitude?.toFixed(4)}</span>
                          </div>
                        )}

                        {/* AI Tags */}
                        {imageTags[img.id] && imageTags[img.id].length > 0 && (
                          <div style={{ marginTop: '8px' }}>
                            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>
                              AI Tags
                            </div>
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                              {imageTags[img.id].map((t, idx) => (
                                <span
                                  key={idx}
                                  style={{
                                    fontSize: '7pt',
                                    padding: '2px 6px',
                                    background: 'var(--accent-dim)',
                                    color: 'var(--accent)',
                                    borderRadius: '2px',
                                    border: '1px solid var(--border)'
                                  }}
                                  title={`Confidence: ${(t.confidence * 100).toFixed(0)}%`}
                                >
                                  {t.tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* CONTRIBUTORS TAB - Attribution Chain */}
        {activeTab === 'contributors' && (
          <div className="card">
            <div className="card-header">Contributors ({contributors.length})</div>
            <div className="card-body">
              {contributors.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-muted)', fontSize: '9pt' }}>
                  No contributors yet
                </div>
              ) : (
                <>
                  {contributors.map((contributor: any) => (
              <div
                      key={contributor.id}
                style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px',
                  borderBottom: '1px solid var(--border-light)',
                        cursor: 'pointer'
                }}
                      onClick={() => window.location.href = `/profile/${contributor.profiles?.id}`}
              >
                      <img
                        src={contributor.profiles?.avatar_url || '/default-avatar.png'}
                        alt={contributor.profiles?.full_name}
                        style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '10pt', fontWeight: 700 }}>
                          {contributor.profiles?.full_name || contributor.profiles?.username}
                </div>
                        <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                          @{contributor.profiles?.username} · {contributor.role}
                  </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '11pt', fontWeight: 700, color: 'var(--accent)' }}>
                          {contributor.contribution_count}
                        </div>
                        <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                          contributions
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* Attribution Timeline */}
              <div style={{ marginTop: '24px', borderTop: '2px solid var(--border)', paddingTop: '16px' }}>
                <h4 style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '12px' }}>
                  Contribution Timeline
                </h4>
                {timelineEvents.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '9pt' }}>
                    No timeline events yet
                </div>
                ) : (
                  <>
                    {timelineEvents.map((event: any) => (
                      <div
                        key={event.id}
                        style={{
                          padding: '10px',
                          marginBottom: '8px',
                          border: '1px solid var(--border-light)',
                          borderRadius: '4px',
                          background: 'var(--surface)'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <img
                            src={event.profiles?.avatar_url || '/default-avatar.png'}
                            alt={event.profiles?.full_name}
                            style={{ width: '24px', height: '24px', borderRadius: '50%' }}
                          />
                          <div style={{ fontSize: '8pt', fontWeight: 700 }}>
                            {event.profiles?.full_name || event.profiles?.username}
                          </div>
                          <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                            {new Date(event.event_date).toLocaleDateString()}
                          </div>
                        </div>
                        <div style={{ fontSize: '9pt', marginBottom: '2px' }}>
                          {event.title}
                        </div>
                        {event.description && (
                          <div style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
                            {event.description}
                  </div>
                )}
              </div>
            ))}
                  </>
                )}
              </div>
            </div>
              </div>
            )}

        {/* Inventory Tab */}
        {activeTab === 'inventory' && organization && (
          <div style={{ padding: '16px' }}>
            {/* Data Source Connection (dealers/owners only) */}
            {isOwner && (
              <div className="card" style={{ marginBottom: '16px' }}>
                <div className="card-header" style={{ fontSize: '11pt', fontWeight: 700 }}>
                  Connect Data Sources
                </div>
                <div className="card-body">
                  <div style={{ fontSize: '9pt', marginBottom: '12px', color: 'var(--text-secondary)' }}>
                    Import inventory, vehicles, and documents from external sources
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <a
                      href={`/dealer/${id}/ai-assistant`}
                      className="button button-primary"
                      style={{ fontSize: '9pt', textDecoration: 'none', display: 'inline-block' }}
                    >
                      AI Assistant
                    </a>
                    <a
                      href={`/dealer/${id}/bulk-editor`}
                      className="button button-secondary"
                      style={{ fontSize: '9pt', textDecoration: 'none', display: 'inline-block' }}
                    >
                      Bulk Editor
                    </a>
                    <button
                      onClick={() => setShowBaTImporter(true)}
                      className="button button-secondary"
                      style={{ fontSize: '9pt' }}
                    >
                      Import BaT Sales
                    </button>
                    <a
                      href={`/dealer/${id}/dropbox-import`}
                      className="button button-secondary"
                      style={{ fontSize: '9pt', textDecoration: 'none', display: 'inline-block' }}
                    >
                      Dropbox Import
                    </a>
                    <button
                      className="button button-secondary"
                      style={{ fontSize: '9pt' }}
                      disabled
                      title="Coming soon"
                    >
                      Google Drive
                    </button>
                    <button
                      className="button button-secondary"
                      style={{ fontSize: '9pt' }}
                      disabled
                      title="Coming soon"
                    >
                      CSV Upload
                    </button>
                    <button
                      className="button button-secondary"
                      style={{ fontSize: '9pt' }}
                      disabled
                      title="Coming soon"
                    >
                      API Integration
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* VIN Scanner (dealers/owners only - mobile optimized) */}
            {isOwner && (
              <div style={{ marginBottom: '16px' }}>
                <MobileVINScanner
                  organizationId={organization.id}
                  onVehicleUpdated={(vehicleId, vin) => {
                    console.log(`Updated vehicle ${vehicleId} with VIN ${vin}`);
                    // Refresh the page to show updated data
                    window.location.reload();
                  }}
                />
              </div>
            )}

            <OrganizationInventory
              organizationId={organization.id}
              isOwner={isOwner}
            />
          </div>
        )}
      </div>

      {/* Trade Shares Modal */}
      {showTrade && offering && organization && (
        <TradePanel
          assetType="organization"
          assetId={organization.id}
          assetName={organization.business_name}
          offeringId={offering.id}
          currentPrice={offering.current_share_price}
          availableShares={offering.total_shares}
          onClose={() => setShowTrade(false)}
        />
      )}

      {/* Contribute Data Modal */}
      {showContributeModal && <AddOrganizationData
        organizationId={id!}
        onClose={() => setShowContributeModal(false)}
        onSaved={() => {
          setShowContributeModal(false);
          loadOrganization();
        }}
      />}

      {/* Claim Ownership Modal */}
      {showOwnershipModal && session && ReactDOM.createPortal(
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 10001,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }} onClick={() => setShowOwnershipModal(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: 'white',
            width: '540px',
            maxWidth: '95vw',
            border: '1px solid var(--border)',
            borderRadius: '4px'
          }}>
            <div className="modal-header">
              <h3 style={{ margin: 0, fontSize: '10pt' }}>Claim Organization Ownership</h3>
            </div>
            <div className="modal-body">
              <form onSubmit={handleOwnershipSubmit}>
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ marginBottom: '4px', fontSize: '9pt' }}>Document Type:</div>
                  <label style={{ display: 'block', marginBottom: '2px', fontSize: '9pt' }}>
                    <input type="radio" value="business_license" defaultChecked name="verificationType" />
                    {' '}Business License
                  </label>
                  <label style={{ display: 'block', marginBottom: '2px', fontSize: '9pt' }}>
                    <input type="radio" value="tax_id" name="verificationType" />
                    {' '}Tax ID / EIN
                  </label>
                  <label style={{ display: 'block', marginBottom: '2px', fontSize: '9pt' }}>
                    <input type="radio" value="articles_incorporation" name="verificationType" />
                    {' '}Articles of Incorporation
                  </label>
                  <label style={{ display: 'block', marginBottom: '2px', fontSize: '9pt' }}>
                    <input type="radio" value="dba_certificate" name="verificationType" />
                    {' '}DBA Certificate
                  </label>
                  <label style={{ display: 'block', marginBottom: '2px', fontSize: '9pt' }}>
                    <input type="radio" value="lease_agreement" name="verificationType" />
                    {' '}Lease/Property Agreement
                  </label>
                  <label style={{ display: 'block', marginBottom: '2px', fontSize: '9pt' }}>
                    <input type="radio" value="utility_bill" name="verificationType" />
                    {' '}Utility Bill (business address)
                  </label>
                </div>

                <div style={{ marginBottom: '8px' }}>
                  <div style={{ marginBottom: '4px', fontSize: '9pt' }}>Upload Document:</div>
                  
                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf"
                    required
                    capture="environment"
                    onChange={(e) => {
                      const file = e.currentTarget.files?.[0];
                      if (file) setSelectedFileName(file.name);
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
                      const file = e.dataTransfer.files?.[0];
                      if (file && fileInputRef.current) {
                        const dataTransfer = new DataTransfer();
                        dataTransfer.items.add(file);
                        fileInputRef.current.files = dataTransfer.files;
                        setSelectedFileName(file.name);
                      }
                    }}
                style={{
                      border: isDragging ? '2px dashed var(--accent)' : '2px dashed var(--border)',
                      borderRadius: '4px',
                      padding: '20px',
                      textAlign: 'center',
                      background: isDragging ? 'var(--accent-dim)' : 'var(--surface)',
                      cursor: 'pointer',
                      transition: '0.12s'
                    }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {selectedFileName ? (
                <div>
                        <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '4px', color: 'var(--accent)' }}>
                          File selected
                  </div>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                          {selectedFileName}
                  </div>
                </div>
                    ) : (
                      <div>
                        <div style={{ fontSize: '9pt', marginBottom: '4px' }}>
                          {isDragging ? 'Drop file here' : 'Drag & drop or click to choose'}
                </div>
                        <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                          PDF or Image (JPG, PNG)
              </div>
          </div>
        )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button
                    type="button"
                    onClick={() => setShowOwnershipModal(false)}
                    className="button button-secondary button-small"
                    style={{ fontSize: '8pt' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="button button-primary"
                    style={{ fontSize: '9pt' }}
                  >
                    Submit
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Lightbox */}
      {lightboxImage && ReactDOM.createPortal(
                <div
                  style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.95)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={() => setLightboxImage(null)}
        >
          {/* Navigation arrows */}
          {lightboxIndex > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const newIndex = lightboxIndex - 1;
                setLightboxIndex(newIndex);
                setLightboxImage(images[newIndex]);
              }}
              style={{
                position: 'absolute',
                left: '20px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                color: '#fff',
                fontSize: '24pt',
                width: '50px',
                height: '50px',
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

          {/* Image container */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center'
            }}
          >
            <img
              src={lightboxImage.large_url || lightboxImage.image_url}
              alt={lightboxImage.caption || ''}
              style={{
                maxWidth: '100%',
                maxHeight: '80vh',
                objectFit: 'contain',
                borderRadius: '4px'
              }}
                />

            {/* Metadata below image */}
            <div style={{
              background: 'rgba(255,255,255,0.1)',
              padding: '12px 16px',
              borderRadius: '4px',
              marginTop: '12px',
              color: '#fff',
              fontSize: '9pt',
              maxWidth: '600px'
            }}>
              {lightboxImage.caption && (
                <div style={{ fontWeight: 600, marginBottom: '6px' }}>
                  {lightboxImage.caption}
              </div>
            )}
              <div style={{ fontSize: '8pt', opacity: 0.8 }}>
                {lightboxImage.taken_at ? new Date(lightboxImage.taken_at).toLocaleDateString() : new Date(lightboxImage.uploaded_at).toLocaleDateString()}
                {lightboxImage.category && ` · ${lightboxImage.category.replace(/_/g, ' ')}`}
                {lightboxImage.location_name && ` · ${lightboxImage.location_name}`}
          </div>
      </div>
          </div>

          {/* Next arrow */}
          {lightboxIndex < images.length - 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const newIndex = lightboxIndex + 1;
                setLightboxIndex(newIndex);
                setLightboxImage(images[newIndex]);
              }}
              style={{
                position: 'absolute',
                right: '20px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                color: '#fff',
                fontSize: '24pt',
                width: '50px',
                height: '50px',
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

          {/* Close button */}
          <button
            onClick={() => setLightboxImage(null)}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              color: '#fff',
              fontSize: '20pt',
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ×
          </button>
        </div>,
        document.body
      )}

      {/* Location Picker Modal */}
      {showLocationPicker && organization && (
        <OrganizationLocationPicker
          organizationId={organization.id}
          organizationName={organization.business_name}
          currentLat={organization.latitude}
          currentLng={organization.longitude}
          currentAddress={organization.address}
          onSaved={() => {
            loadOrganization();
          }}
          onClose={() => setShowLocationPicker(false)}
        />
      )}

      {/* Labor Rate Editor Modal */}
      {showLaborRateEditor && organization && (
        <LaborRateEditor
          organizationId={organization.id}
          organizationName={organization.business_name}
          currentRate={organization.labor_rate}
          onSaved={() => {
            loadOrganization();
          }}
          onClose={() => setShowLaborRateEditor(false)}
        />
      )}

      {/* Work Order Request Form */}
      {showWorkOrderForm && organization && (
        <WorkOrderRequestForm
          organizationId={organization.id}
          organizationName={organization.business_name}
          laborRate={organization.labor_rate}
          onSubmitted={() => {
            loadOrganization();
          }}
          onClose={() => setShowWorkOrderForm(false)}
        />
      )}
      
      {/* Contractor Work Input Modal */}
      {showContractorWorkInput && organization && (
        <ContractorWorkInput
          organizationId={organization.id}
          organizationName={organization.business_name}
          imageId={selectedWorkOrderImage?.id}
          imageUrl={selectedWorkOrderImage?.large_url || selectedWorkOrderImage?.image_url}
          onSaved={() => {
            loadOrganization();
            setShowContractorWorkInput(false);
            setSelectedWorkOrderImage(null);
          }}
          onClose={() => {
            setShowContractorWorkInput(false);
            setSelectedWorkOrderImage(null);
          }}
        />
      )}

      {/* Organization Editor Modal */}
      {showOrganizationEditor && organization && (
        <OrganizationEditor
          organizationId={organization.id}
          onSaved={() => {
            loadOrganization();
            setShowOrganizationEditor(false);
          }}
          onClose={() => setShowOrganizationEditor(false)}
        />
      )}

      {/* BaT Bulk Importer Modal */}
      {showBaTImporter && organization && (
        <BaTBulkImporter
          organizationId={organization.id}
          organizationName={organization.business_name}
          onComplete={() => {
            loadOrganization();
            setShowBaTImporter(false);
          }}
          onClose={() => setShowBaTImporter(false)}
        />
      )}
    </div>
  );
}
