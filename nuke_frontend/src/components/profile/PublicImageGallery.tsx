import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface PublicImageGalleryProps {
  userId: string;
  isOwnProfile: boolean;
}

const PublicImageGallery: React.FC<PublicImageGalleryProps> = ({ userId, isOwnProfile }) => {
  const [images, setImages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadImages();
  }, [userId]);

  const loadImages = async () => {
    try {
      setLoading(true);
      
      // Get external identities for this user to find BaT images
      const { data: externalIdentities } = await supabase
        .from('external_identities')
        .select('id, platform, handle')
        .eq('claimed_by_user_id', userId);
      
      const identityIds = externalIdentities?.map(ei => ei.id) || [];
      
      // Load images actually taken/photographed by this user
      // Filter by attribution fields (schema has evolved; many legacy/imported rows won't have user_id set)
      let query = supabase
        .from('vehicle_images')
        .select(`
          *,
          vehicle:vehicles!vehicle_images_vehicle_id_fkey(id, is_public, user_id, year, make, model)
        `)
        .or(`user_id.eq.${userId},documented_by_user_id.eq.${userId},submitted_by.eq.${userId}`) // Photographer/author attribution

      // If viewing someone else's profile, only show images from public vehicles
      if (!isOwnProfile) {
        query = query.eq('vehicle.is_public', true);
      }

      const { data: userImages, error: userImagesError } = await query
        .order('created_at', { ascending: false })
        .limit(100);

      if (userImagesError) throw userImagesError;

      // Also load BaT images linked via external identities
      let batImages: any[] = [];
      if (identityIds.length > 0) {
        // Find vehicles where user is seller/buyer via external identities
        const { data: sellerListings } = await supabase
          .from('bat_listings')
          .select('vehicle_id')
          .in('seller_external_identity_id', identityIds);
        
        const { data: buyerListings } = await supabase
          .from('bat_listings')
          .select('vehicle_id')
          .in('buyer_external_identity_id', identityIds);
        
        const allVehicleIds = [...new Set([
          ...(sellerListings || []).map((l: any) => l.vehicle_id),
          ...(buyerListings || []).map((l: any) => l.vehicle_id)
        ].filter(Boolean))];
        
        if (allVehicleIds.length > 0) {
          const { data: batImagesData, error: batImagesError } = await supabase
            .from('vehicle_images')
            .select(`
              *,
              vehicle:vehicles!vehicle_images_vehicle_id_fkey(id, is_public, user_id, year, make, model)
            `)
            .in('vehicle_id', allVehicleIds)
            .or('source.eq.bat_import,source.eq.bat_listing')
            .order('created_at', { ascending: false })
            .limit(100);
          
          if (!batImagesError && batImagesData) {
            batImages = batImagesData;
          }
        }
      }

      // IMPORTANT:
      // The importer sets vehicle_images.user_id to a "runner" user for RLS/ownership in some flows.
      // Those are NOT actually authored/taken by that user and should not appear in a user's gallery.
      // Filter out imported/scraped images by source and/or presence of a source URL in exif_data.
      // BUT: Include BaT images if they're linked via external identities
      const cleaned = [...(userImages || []), ...batImages].filter((img: any, index: number, self: any[]) => {
        // Remove duplicates
        if (self.findIndex((i: any) => i.id === img.id) !== index) return false;
        
        const src = String(img?.source || '').toLowerCase();
        // Include BaT images if they're from vehicles linked via external identities
        if (src === 'bat_import' || src === 'bat_listing') {
          return batImages.some((bi: any) => bi.id === img.id);
        }
        // Do not attribute other imported/scraped images to the importing runner user.
        // These will later be attributed via external identities (e.g. BaT usernames) or claimed by humans.
        if (src === 'organization_import' || src === 'external_import' || src === 'scraper') return false;
        const exifSourceUrl = String(img?.exif_data?.source_url || '').trim();
        if (exifSourceUrl.startsWith('http')) return false;
        return true;
      });

      setImages(cleaned);
    } catch (error) {
      console.error('Error loading image gallery:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-body text-center" style={{ padding: 'var(--space-6)' }}>
          <div className="text text-muted">Loading gallery...</div>
        </div>
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="card">
        <div className="card-body text-center" style={{ padding: 'var(--space-6)' }}>
          <div className="text text-muted">
            {isOwnProfile ? 'No images in your gallery yet.' : 'No public images to display.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h3 className="heading-3">Image Gallery ({images.length})</h3>
        </div>
        <div className="card-body">
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 'var(--space-2)'
          }}>
            {images.map(image => (
              <div
                key={image.id}
                style={{
                  aspectRatio: '1 / 1',
                  backgroundImage: `url(${image.image_url})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  borderRadius: '4px',
                  border: '1px solid var(--border)',
                  cursor: 'pointer'
                }}
                onClick={() => {
                  // Navigate to vehicle if available
                  if (image.vehicle?.id) {
                    window.location.href = `/vehicle/${image.vehicle.id}`;
                  }
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PublicImageGallery;

