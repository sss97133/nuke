import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { imageOptimizationService } from '../../services/imageOptimizationService';
import ImageLightbox from '../image/ImageLightbox';

interface ImageGalleryProps {
  vehicleId: string;
  onImagesUpdated?: () => void;
  showUpload?: boolean;
}

interface ImageTag {
  id: string;
  x: number;
  y: number;
  text: string;
  type: string;
  isEditing?: boolean;
}

const TAG_TYPES = [
  { value: 'part', label: 'Part' },
  { value: 'damage', label: 'Damage' },
  { value: 'modification', label: 'Modification' },
  { value: 'tool', label: 'Tool' }
];

const ImageGallery = ({ vehicleId, onImagesUpdated, showUpload = true }: ImageGalleryProps) => {
  const [allImages, setAllImages] = useState<any[]>([]);
  const [displayedImages, setDisplayedImages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'grid' | 'masonry' | 'list'>('grid');
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'primary' | 'likes' | 'views' | 'interactions'>('primary');
  const [showFilters, setShowFilters] = useState(false);
  const [showImages, setShowImages] = useState(false);
  const [imagesPerPage] = useState(25);
  const [autoLoad, setAutoLoad] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{total: number, completed: number, uploading: boolean}>({total: 0, completed: 0, uploading: false});
  const [imageCommentCounts, setImageCommentCounts] = useState<Record<string, number>>({});
  const [imageUploaderNames, setImageUploaderNames] = useState<Record<string, string>>({});
  const [imageTagTextsById, setImageTagTextsById] = useState<Record<string, string[]>>({});
  const [imageViewCounts, setImageViewCounts] = useState<Record<string, number>>({});
  const [uploaderOrgNames, setUploaderOrgNames] = useState<Record<string, string>>({});

  // Tagging state
  const [imageTags, setImageTags] = useState<ImageTag[]>([]);
  const [showTags, setShowTags] = useState(false);
  const [selectedTagType, setSelectedTagType] = useState('part');
  const [tagText, setTagText] = useState('');
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const [session, setSession] = useState<any>(null);
  const [canCreateTags, setCanCreateTags] = useState(false);
  const [imageTagCounts, setImageTagCounts] = useState<Record<string, number>>({});
  
  // Tool inventory state
  const [userTools, setUserTools] = useState<any[]>([]);
  const [filteredTools, setFilteredTools] = useState<any[]>([]);
  const [showToolSearch, setShowToolSearch] = useState(false);
  const [toolSearchTerm, setToolSearchTerm] = useState('');

  // Check authentication and permissions
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);

      if (session?.user?.id) {
        // Any logged in user can create tags - you can adjust this logic as needed
        setCanCreateTags(true);
        // Load user's tool inventory
        loadUserTools(session.user.id);
      }
    };

    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setCanCreateTags(!!session?.user?.id);
      if (session?.user?.id) {
        loadUserTools(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, []);
  
  // Load user's tool inventory
  const loadUserTools = async (userId: string) => {
    try {
      // Simpler query without joins since tool_catalog FK doesn't exist
      const { data, error } = await supabase
        .from('user_tools')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Error loading tools:', error);
        return;
      }
      
      console.log(`Loaded ${data?.length || 0} tools for user ${userId}`);
      setUserTools(data || []);
    } catch (err) {
      console.error('Failed to load tools:', err);
    }
  };
  
  // Filter tools based on search
  useEffect(() => {
    if (toolSearchTerm.trim() === '') {
      setFilteredTools(userTools.slice(0, 10)); // Show first 10 when no search
    } else {
      const searchLower = toolSearchTerm.toLowerCase();
      const filtered = userTools.filter(tool => {
        // Use direct fields from user_tools table
        const partNumber = tool.part_number?.toLowerCase() || '';
        const description = tool.description?.toLowerCase() || '';
        const brand = tool.brand?.toLowerCase() || '';
        const notes = tool.notes?.toLowerCase() || '';
        
        return partNumber.includes(searchLower) ||
               description.includes(searchLower) ||
               brand.includes(searchLower) ||
               notes.includes(searchLower);
      }).slice(0, 10); // Limit to 10 results
      
      setFilteredTools(filtered);
    }
  }, [toolSearchTerm, userTools]);
  
  // Show tool search when tag type is tool
  useEffect(() => {
    setShowToolSearch(selectedTagType === 'tool' && activeTagId !== null);
    if (selectedTagType === 'tool') {
      setToolSearchTerm(tagText);
    }
  }, [selectedTagType, activeTagId, tagText]);

  useEffect(() => {
    const fetchImages = async () => {
      try {
        setLoading(true);
        const { data: rawImages, error } = await supabase
          .from('vehicle_images')
          .select('id, image_url, thumbnail_url, medium_url, large_url, is_primary, caption, created_at, taken_at, exif_data, user_id')
          .eq('vehicle_id', vehicleId)
          .order('is_primary', { ascending: false });

        if (error) throw error;
        const images = rawImages || [];
        setAllImages(images);
        // Load an initial batch (50 or fewer) immediately
        const sorted = [...images].sort((a: any, b: any) => {
          if (sortBy === 'primary') {
            if (a.is_primary && !b.is_primary) return -1;
            if (!a.is_primary && b.is_primary) return 1;
            return 0;
          }
          const da = new Date(a.taken_at || a.created_at).getTime();
          const db = new Date(b.taken_at || b.created_at).getTime();
          return sortBy === 'date_desc' ? db - da : da - db;
        });
        const initialBatch = Math.min(50, sorted.length);
        setDisplayedImages(sorted.slice(0, initialBatch));
        setShowImages(true);
      } catch (err) {
        console.error('Error fetching vehicle images:', err);
        setError('Failed to load vehicle images. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchImages();
  }, [vehicleId]);

  // Re-sort displayed images when sort option changes
  useEffect(() => {
    if (showImages && displayedImages.length > 0) {
      const sortedImages = getSortedImages();
      setDisplayedImages(sortedImages.slice(0, displayedImages.length));
    }
  }, [sortBy]);

  // Load tag counts when displayed images change
  useEffect(() => {
    if (displayedImages.length > 0) {
      loadImageTagCounts();
    }
  }, [displayedImages]);

  const handleFileUpload = async (files: FileList) => {
    if (!files.length) return;

    // Validate user is logged in
    if (!session?.user?.id) {
      setError('You must be logged in to upload images');
      return;
    }

    const fileArray = Array.from(files);
    setUploadProgress({total: fileArray.length, completed: 0, uploading: true});

    try {
      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        const fileName = `${Date.now()}_${i}_${file.name}`;

        // Generate orientation-corrected variants using the optimization service
        const optimizationResult = await imageOptimizationService.generateVariantBlobs(file);

        if (optimizationResult.success && optimizationResult.variantBlobs) {
          const urls: any = {};
          const paths: any = {};

          // Upload each variant (thumbnail, medium, large)
          for (const [variantName, blob] of Object.entries(optimizationResult.variantBlobs)) {
            const variantPath = `vehicles/${vehicleId}/images/${variantName}/${fileName}`;

            const { error: uploadError } = await supabase.storage
              .from('vehicle-data')
              .upload(variantPath, blob, { upsert: true });

            if (!uploadError) {
              const { data: urlData } = supabase.storage
                .from('vehicle-data')
                .getPublicUrl(variantPath);

              urls[`${variantName}_url`] = urlData.publicUrl;
              paths[variantName] = variantPath;
            }
          }

          // Also upload original file
          const originalPath = `vehicles/${vehicleId}/images/${fileName}`;
          const { error: originalError } = await supabase.storage
            .from('vehicle-data')
            .upload(originalPath, file);

          if (!originalError) {
            const { data: originalUrl } = supabase.storage
              .from('vehicle-data')
              .getPublicUrl(originalPath);

            // Save to database with all variant URLs
            const { error: insertError } = await supabase
              .from('vehicle_images')
              .insert({
                vehicle_id: vehicleId,
                user_id: session.user.id,
                image_url: originalUrl.publicUrl,
                thumbnail_url: urls.thumbnail_url,
                medium_url: urls.medium_url,
                large_url: urls.large_url,
                storage_path: originalPath,
                filename: file.name,
                mime_type: file.type,
                file_size: file.size,
                category: 'general',
                is_primary: i === 0 && allImages.length === 0
              });
            
            if (insertError) {
              console.error('Failed to save image to database:', insertError);
              setError(`Upload failed: ${insertError.message}. Please check permissions.`);
              throw insertError;
            }
          }
        }

        setUploadProgress(prev => ({...prev, completed: i + 1}));
      }

      // Refresh images and notify parent
      const { data: refreshedImages } = await supabase
        .from('vehicle_images')
        .select('id, image_url, thumbnail_url, medium_url, large_url, is_primary, caption, created_at, taken_at')
        .eq('vehicle_id', vehicleId)
        .order('is_primary', { ascending: false });

      setAllImages(refreshedImages || []);
      
      // Always show images after upload and refresh the display
      setShowImages(true);
      
      // Refresh displayed images with the new uploads
      const sortedImages = (refreshedImages || []).sort((a: any, b: any) => {
        if (sortBy === 'primary') {
          if (a.is_primary && !b.is_primary) return -1;
          if (!a.is_primary && b.is_primary) return 1;
          return 0;
        }
        const da = new Date(a.taken_at || a.created_at).getTime();
        const db = new Date(b.taken_at || b.created_at).getTime();
        return sortBy === 'date_desc' ? db - da : da - db;
      });
      
      setDisplayedImages(sortedImages.slice(0, Math.max(displayedImages.length, imagesPerPage)));
      
      onImagesUpdated?.();

    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploadProgress({total: 0, completed: 0, uploading: false});
    }
  };

  const openLightbox = (index: number) => {
    setCurrentImageIndex(index);
    setLightboxOpen(true);

    // Load tags for the current image
    const image = displayedImages[index];
    if (image?.id) {
      loadImageTags(image.id);
    }
  };

  const nextImage = () => {
    const newIndex = (currentImageIndex + 1) % displayedImages.length;
    setCurrentImageIndex(newIndex);

    // Load tags for the new image
    const image = displayedImages[newIndex];
    if (image?.id) {
      loadImageTags(image.id);
    }
  };

  const previousImage = () => {
    const newIndex = (currentImageIndex - 1 + displayedImages.length) % displayedImages.length;
    setCurrentImageIndex(newIndex);

    // Load tags for the new image
    const image = displayedImages[newIndex];
    if (image?.id) {
      loadImageTags(image.id);
    }
  };

  const getDisplayDate = (image: any) => {
    // Use taken_at (when photo was taken) if available, otherwise fall back to created_at (when uploaded)
    const displayDate = image.taken_at || image.created_at;
    return new Date(displayDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const handleShowImages = () => {
    setShowImages(true);
    loadMoreImages();
  };

  const loadMoreImages = () => {
    setLoadingMore(true);
    const currentCount = displayedImages.length;
    const sortedImages = getSortedImages();
    const nextBatch = sortedImages.slice(currentCount, currentCount + imagesPerPage);

    setTimeout(() => {
      setDisplayedImages(prev => {
        const newImages = [...prev, ...nextBatch];
        // Load tag counts after state updates
        setTimeout(() => loadImageTagCounts(), 100);
        // Also load comment counts, uploader names, and tag texts for new batch
        setTimeout(() => {
          loadImageCommentCounts(newImages.map(img => img.id));
          loadUploaderNames(newImages.map(img => img.user_id).filter(Boolean));
          loadImageTagTexts(newImages.map(img => img.id));
          loadImageViewCounts(newImages.map(img => img.id));
          loadUploaderOrgNames(newImages.map(img => img.user_id).filter(Boolean));
        }, 120);
        return newImages;
      });
      setLoadingMore(false);
    }, 300); // Small delay for smooth UX
  };

  const getSortedImages = () => {
    return allImages.sort((a, b) => {
      switch (sortBy) {
        case 'primary':
          if (a.is_primary && !b.is_primary) return -1;
          if (!a.is_primary && b.is_primary) return 1;
          return 0;

        case 'date_desc':
          const dateDescA = new Date(a.taken_at || a.created_at);
          const dateDescB = new Date(b.taken_at || b.created_at);
          return dateDescB.getTime() - dateDescA.getTime();

        case 'date_asc':
          const dateAscA = new Date(a.taken_at || a.created_at);
          const dateAscB = new Date(b.taken_at || b.created_at);
          return dateAscA.getTime() - dateAscB.getTime();

        case 'likes':
          // Placeholder: sort by creation date until likes_count column exists
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();

        case 'views':
          // Placeholder: sort by creation date until views_count column exists
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();

        case 'interactions':
          // Placeholder: sort by creation date until interactions_count column exists
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();

        default:
          return 0;
      }
    });
  };

  const handleUnloadImages = () => {
    setShowImages(false);
    setDisplayedImages([]);
  };

  // Auto-load images progressively until all displayed
  useEffect(() => {
    if (!autoLoad || !showImages) return;
    if (loadingMore) return;
    if (displayedImages.length >= allImages.length) {
      setAutoLoad(false);
      return;
    }
    const t = setTimeout(() => loadMoreImages(), 120);
    return () => clearTimeout(t);
  }, [autoLoad, showImages, loadingMore, displayedImages.length, allImages.length]);

  // Load tag counts for all images (disabled - using new tagging system)
  const loadImageTagCounts = async () => {
    console.debug('Tag counts disabled in ImageGallery - use SimplePhotoTagger instead');
    setImageTagCounts({});
    return;
  };

  // Load a few tag texts per image for display (disabled - using new tagging system)
  const loadImageTagTexts = async (imageIds: string[]) => {
    console.debug('Tag texts disabled in ImageGallery - use SimplePhotoTagger instead');
    return;
  };

  // Load image comment counts in batch
  const loadImageCommentCounts = async (imageIds: string[]) => {
    const ids = Array.from(new Set(imageIds.filter(Boolean)));
    if (ids.length === 0) return;
    try {
      const { data, error } = await supabase
        .from('vehicle_image_comments')
        .select('image_id')
        .in('image_id', ids);
      if (error) return;
      const counts: Record<string, number> = {};
      (data || []).forEach((row: any) => {
        counts[row.image_id] = (counts[row.image_id] || 0) + 1;
      });
      setImageCommentCounts(prev => ({ ...prev, ...counts }));
    } catch (e) {
      // ignore
    }
  };

  // Load uploader names for a set of user IDs
  const loadUploaderNames = async (userIds: string[]) => {
    const ids = Array.from(new Set((userIds as string[]).filter(Boolean)));
    if (ids.length === 0) return;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, email')
        .in('id', ids);
      if (error) return;
      const byId: Record<string, string> = {};
      (data || []).forEach((p: any) => {
        byId[p.id] = p.username || (p.email ? p.email.split('@')[0] : 'user');
      });
      setImageUploaderNames(prev => ({ ...prev, ...byId }));
    } catch (e) {
      // ignore
    }
  };

  // Load view counts from user_activity (event_type='view', entity_type='image')
  const loadImageViewCounts = async (imageIds: string[]) => {
    const ids = Array.from(new Set(imageIds.filter(Boolean)));
    if (ids.length === 0) return;
    try {
      const { data, error } = await supabase
        .from('user_activity')
        .select('entity_id')
        .eq('event_type', 'view')
        .eq('entity_type', 'image')
        .in('entity_id', ids);
      if (error) return;
      const counts: Record<string, number> = {};
      (data || []).forEach((row: any) => {
        counts[row.entity_id] = (counts[row.entity_id] || 0) + 1;
      });
      setImageViewCounts(prev => ({ ...prev, ...counts }));
    } catch (e) {
      // ignore
    }
  };

  // Load uploader organization names (shop display_name) by owner_user_id
  const loadUploaderOrgNames = async (userIds: string[]) => {
    const ids = Array.from(new Set((userIds as string[]).filter(Boolean)));
    if (ids.length === 0) return;
    try {
      const { data, error } = await supabase
        .from('shops')
        .select('owner_user_id, display_name')
        .in('owner_user_id', ids);
      if (error) return;
      const byId: Record<string, string> = {};
      (data || []).forEach((s: any) => {
        if (!byId[s.owner_user_id]) byId[s.owner_user_id] = s.display_name;
      });
      setUploaderOrgNames(prev => ({ ...prev, ...byId }));
    } catch (e) {
      // ignore
    }
  };

  // Helper: determine time-of-day label from timestamp
  const getTimeOfDayLabel = (dt?: string) => {
    if (!dt) return '';
    const d = new Date(dt);
    const h = d.getHours();
    if (h < 5) return 'night';
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    if (h < 20) return 'evening';
    return 'night';
  };

  // Helper: format camera text from EXIF which may be a string or an object { make, model }
  const getCameraText = (exif: any): string => {
    if (!exif || !exif.camera) return '';
    const cam = exif.camera;
    if (typeof cam === 'string') return cam;
    if (cam && (cam.make || cam.model)) {
      return [cam.make, cam.model].filter(Boolean).join(' ').trim();
    }
    return '';
  };

  // Helper: format location text from EXIF which may be a string or an object
  const getLocationText = (exif: any): string => {
    if (!exif || !exif.location) return '';
    const loc = exif.location;
    if (typeof loc === 'string') return loc;
    const parts = [
      loc.city || loc.nearest_city || '',
      loc.state || loc.region || '',
      loc.country || ''
    ].filter(Boolean);
    const joined = parts.join(', ');
    return (joined || loc.zip || '').toString();
  };

  // Load tags for the current image (disabled - using new tagging system)
  const loadImageTags = async (imageId: string) => {
    console.debug('Image tags disabled in ImageGallery - use SimplePhotoTagger instead');
    setImageTags([]);
    return;
  };

  // Handle clicking on image to create tags
  const handleImageClick = (e: React.MouseEvent) => {
    if (!showTags || !canCreateTags) return;

    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    const newTagId = `tag-${Date.now()}`;
    const newTag: ImageTag = {
      id: newTagId,
      x: x,
      y: y,
      text: '',
      type: selectedTagType,
      isEditing: true
    };

    setImageTags(prev => [...prev, newTag]);
    setActiveTagId(newTagId);
    setTagText('');
  };

  // Save a new tag to the database (disabled - using new tagging system)
  const saveTag = async (tagId: string) => {

    // Remove the temporary tag from UI
    setImageTags(prev => prev.filter(t => t.id !== tagId));
    setTagText('');
    setActiveTagId(null);
  };

  if (loading) {
    return <div className="text-center p-8">Loading vehicle images...</div>;
  }

  if (error) {
    return <div className="text-center p-8 text-red-500">{error}</div>;
  }

  if (allImages.length === 0) {
    return (
      <div className="text-center p-8">
        <p className="text text-muted">No images found for this vehicle.</p>
      </div>
    );
  }

  const currentImage = displayedImages[currentImageIndex];

  return (
    <div>
      {/* Upload Progress Bar */}
      {uploadProgress.uploading && (
        <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="card-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <span className="text">Uploading images...</span>
              <span className="text-muted">{uploadProgress.completed} of {uploadProgress.total}</span>
            </div>
            <div style={{
              width: '100%',
              height: '8px',
              backgroundColor: 'var(--grey-200)',
              border: '1px inset var(--border-medium)'
            }}>
              <div style={{
                width: `${(uploadProgress.completed / uploadProgress.total) * 100}%`,
                height: '100%',
                backgroundColor: 'var(--grey-600)'
              }}></div>
            </div>
          </div>
        </div>
      )}

      {/* Gallery Controls */}
      <div className="card-header">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            {/* View Mode Toggle */}
            <div style={{ display: 'flex', border: '1px solid var(--border-medium)', backgroundColor: 'var(--white)' }}>
              <button
                onClick={() => setViewMode('grid')}
                className={viewMode === 'grid' ? 'button button-primary' : 'button'}
                style={{ padding: 'var(--space-1) var(--space-3)', fontSize: '8pt', margin: 0, border: 'none', borderRadius: 0 }}
              >
                Grid
              </button>
              <button
                onClick={() => setViewMode('masonry')}
                className={viewMode === 'masonry' ? 'button button-primary' : 'button'}
                style={{ padding: 'var(--space-1) var(--space-3)', fontSize: '8pt', margin: 0, border: 'none', borderRadius: 0 }}
              >
                Masonry
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={viewMode === 'list' ? 'button button-primary' : 'button'}
                style={{ padding: 'var(--space-1) var(--space-3)', fontSize: '8pt', margin: 0, border: 'none', borderRadius: 0 }}
              >
                List
              </button>
            </div>

            {/* Sort Options */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'date_desc' | 'date_asc' | 'primary' | 'likes' | 'views' | 'interactions')}
              className="form-select"
              style={{ fontSize: '8pt', padding: 'var(--space-1) var(--space-2)' }}
            >
              <option value="primary">Primary First</option>
              <option value="date_desc">Date (Newest)</option>
              <option value="date_asc">Date (Oldest)</option>
              <option value="likes">Most Liked</option>
              <option value="views">Most Viewed</option>
              <option value="interactions">Most Interactions</option>
            </select>
          </div>

          {/* Upload Button & Image Count */}
          <div className="flex items-center gap-4">
            {showUpload && (
              <div className="relative">
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={(e) => {
                    if (e.target.files) {
                      handleFileUpload(e.target.files);
                      e.target.value = '';
                    }
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <button className="button button-primary" style={{ fontSize: '8pt', padding: 'var(--space-1) var(--space-3)' }}>
                  Upload Images
                </button>
              </div>
            )}
            <div className="text text-muted">
              {showImages ? `${displayedImages.length} of ${allImages.length}` : `${allImages.length} images available`}
            </div>
          </div>
        </div>
      </div>

      {/* Show/Hide Images Controls */}
      {!showImages && allImages.length > 0 && (
        <div className="card-body" style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
          <button
            className="button button-primary"
            onClick={handleShowImages}
            style={{ marginBottom: 'var(--space-2)' }}
          >
            Show Images ({allImages.length})
          </button>
          <p className="text text-muted" style={{ fontSize: '7pt' }}>
            Images load progressively for better performance
          </p>
        </div>
      )}

      {/* Image Grid */}
      {viewMode === 'grid' && showImages && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)', padding: 'var(--space-4)' }}>
          {displayedImages.map((image, index) => (
            <div
              key={image.id}
              className="card"
              style={{ cursor: 'pointer', position: 'relative', overflow: 'hidden', backgroundColor: 'var(--white)' }}
              onClick={() => openLightbox(index)}
            >
              {/* Image Container */}
              <div style={{ width: '100%', height: '150px', overflow: 'hidden', backgroundColor: 'var(--grey-100)' }}>
                <img
                  src={image.thumbnail_url || image.image_url}
                  alt={image.caption || 'Vehicle image'}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    imageOrientation: 'from-image' // Preserve EXIF orientation
                  }}
                  loading="lazy"
                />
              </div>

              {/* Tag Count Badge */}
              {imageTagCounts[image.id] && (
                <div style={{
                  position: 'absolute',
                  top: 'var(--space-1)',
                  right: 'var(--space-1)',
                  backgroundColor: '#007bff',
                  color: 'white',
                  borderRadius: '50%',
                  width: '20px',
                  height: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '6pt',
                  fontWeight: 'bold',
                  zIndex: 10
                }}>
                  {imageTagCounts[image.id]}
                </div>
              )}

              {/* Image Info Overlay */}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)', padding: 'var(--space-2)' }}>
                {image.is_primary && (
                  <div className="button button-small" style={{ fontSize: '6pt', padding: '2px 6px', marginBottom: 'var(--space-1)', backgroundColor: 'var(--grey-600)', color: 'var(--white)' }}>
                    PRIMARY
                  </div>
                )}
                {image.caption && (
                  <p className="text" style={{ color: 'var(--white)', fontSize: '7pt', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{image.caption}</p>
                )}
                <p className="text" style={{ color: 'rgba(255,255,255,0.7)', fontSize: '6pt', marginTop: '2px' }}>
                  {getDisplayDate(image)}
                  {imageTagCounts[image.id] && ` • ${imageTagCounts[image.id]} tags`}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Load More Button */}
      {showImages && displayedImages.length < allImages.length && (
        <div className="card-body" style={{ textAlign: 'center', padding: 'var(--space-2)' }}>
          <button
            className="button button-small"
            onClick={loadMoreImages}
            disabled={loadingMore}
            style={{ marginRight: 'var(--space-2)' }}
          >
            {loadingMore ? 'Loading...' :
              (allImages.length - displayedImages.length <= imagesPerPage
                ? 'Load Remaining Images'
                : `Load ${Math.min(imagesPerPage, allImages.length - displayedImages.length)} More`
              )
            }
          </button>
          <button
            className="button button-small"
            onClick={handleUnloadImages}
          >
            Hide All Images
          </button>
        </div>
      )}

      {/* Hide Images Button */}
      {showImages && displayedImages.length >= allImages.length && (
        <div className="card-body" style={{ textAlign: 'center', padding: 'var(--space-2)' }}>
          <button
            className="button button-small"
            onClick={handleUnloadImages}
          >
            Hide All Images
          </button>
        </div>
      )}

      {/* Masonry View */}
      {viewMode === 'masonry' && showImages && (
        <div style={{ columnCount: 3, columnGap: 'var(--space-4)', padding: 'var(--space-4)' }}>
          {displayedImages.map((image, index) => (
            <div
              key={image.id}
              className="card"
              style={{ cursor: 'pointer', position: 'relative', overflow: 'hidden', backgroundColor: 'var(--white)', marginBottom: 'var(--space-4)', breakInside: 'avoid', display: 'inline-block', width: '100%' }}
              onClick={() => openLightbox(index)}
            >
              <img
                src={image.medium_url || image.image_url}
                alt={image.caption || 'Vehicle image'}
                style={{ width: '100%', height: 'auto' }}
                loading="lazy"
              />

              {/* Image Info Overlay */}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)', padding: 'var(--space-2)' }}>
                {image.is_primary && (
                  <div className="button button-small" style={{ fontSize: '6pt', padding: '2px 6px', marginBottom: 'var(--space-1)', backgroundColor: 'var(--grey-600)', color: 'var(--white)' }}>
                    PRIMARY
                  </div>
                )}
                {image.caption && (
                  <p className="text" style={{ color: 'var(--white)', fontSize: '7pt', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{image.caption}</p>
                )}
                <p className="text" style={{ color: 'rgba(255,255,255,0.7)', fontSize: '6pt', marginTop: '2px' }}>
                  {getDisplayDate(image)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && showImages && (
        <div style={{ padding: 'var(--space-4)' }}>
          {displayedImages.map((image, index) => (
            <div
              key={image.id}
              className="card"
              style={{ display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-3)', marginBottom: 'var(--space-3)', cursor: 'pointer' }}
              onClick={() => openLightbox(index)}
            >
              {/* Thumbnail */}
              <div style={{ flexShrink: 0, width: '96px', height: '96px', overflow: 'hidden', backgroundColor: 'var(--grey-100)' }}>
                <img
                  src={image.thumbnail_url || image.image_url}
                  alt={image.caption || 'Vehicle image'}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    imageOrientation: 'from-image' // Preserve EXIF orientation
                  }}
                  loading="lazy"
                />
              </div>

              {/* Info */}
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between' }}>
                  <div>
                    {image.is_primary && (
                      <div className="button button-small" style={{ fontSize: '6pt', padding: '2px 6px', marginBottom: 'var(--space-1)', backgroundColor: 'var(--grey-600)', color: 'var(--white)' }}>
                        PRIMARY
                      </div>
                    )}
                    {image.caption && (
                      <h4 className="text" style={{ fontWeight: 'bold', marginBottom: '2px' }}>{image.caption}</h4>
                    )}
                    <p className="text text-muted" style={{ fontSize: '7pt' }}>
                      {getDisplayDate(image)} • {getTimeOfDayLabel(image.taken_at || image.created_at)}
                    </p>
                    {/* Camera / Location / Tags */}
                    <div className="text" style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                      {getCameraText(image.exif_data) && (<span>Camera: {getCameraText(image.exif_data)}</span>)}
                      {getCameraText(image.exif_data) && (getLocationText(image.exif_data) || image.exif_data?.gps) && (<span> • </span>)}
                      {getLocationText(image.exif_data) && (<span>Location: {getLocationText(image.exif_data)}</span>)}
                      {!image.exif_data?.location && image.exif_data?.gps && image.exif_data.gps.latitude && image.exif_data.gps.longitude && (
                        <span>Location: {image.exif_data.gps.latitude.toFixed?.(3) || image.exif_data.gps.latitude}, {image.exif_data.gps.longitude.toFixed?.(3) || image.exif_data.gps.longitude}</span>
                      )}
                      {(imageTagTextsById[image.id]?.length || imageTagCounts[image.id]) && (
                        <>
                          {(getCameraText(image.exif_data) || getLocationText(image.exif_data) || image.exif_data?.gps) && <span> • </span>}
                          <span>Tags: {imageTagTextsById[image.id]?.join(', ') || `${imageTagCounts[image.id]} tags`}</span>
                        </>
                      )}
                    </div>
                    {/* Attribution and counts */}
                    <div className="text" style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {image.user_id && (
                        <span>By {uploaderOrgNames[image.user_id] || imageUploaderNames[image.user_id] || 'user'}</span>
                      )}
                      {typeof imageViewCounts[image.id] === 'number' && (
                        <span> • {imageViewCounts[image.id]} views</span>
                      )}
                      {typeof imageCommentCounts[image.id] === 'number' && (
                        <span> • {imageCommentCounts[image.id]} comments</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openLightbox(index);
                    }}
                    className="button button-small"
                    style={{ fontSize: '7pt' }}
                  >
                    View →
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Image Lightbox - Using proper ImageLightbox component with tags */}
      {lightboxOpen && currentImage && (
        <ImageLightbox
          imageUrl={currentImage.large_url || currentImage.medium_url || currentImage.image_url}
          imageId={currentImage.id}
          vehicleId={vehicleId}
          isOpen={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          onNext={displayedImages.length > 1 ? nextImage : undefined}
          onPrev={displayedImages.length > 1 ? previousImage : undefined}
          canEdit={canCreateTags}
          title={currentImage.caption}
          description={`${getDisplayDate(currentImage)} • ${currentImageIndex + 1} of ${displayedImages.length}`}
        />
      )}
    </div>
  );
};

export default ImageGallery;
