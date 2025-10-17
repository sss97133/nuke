// ProImageViewer - Professional image viewer with proper UI flow
// Large thumbnail grid → Full-res viewer → Back to grid with tools
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import LazyImage from './LazyImage';

// Tag types available in the system
const TAG_TYPES = [
  { value: 'product', label: 'Product', description: 'Parts, tools, or products visible in the image' },
  { value: 'damage', label: 'Damage', description: 'Visible damage or wear' },
  { value: 'location', label: 'Location', description: 'Geographic or physical location' },
  { value: 'modification', label: 'Modification', description: 'Aftermarket modifications or upgrades' },
  { value: 'brand', label: 'Brand', description: 'Brand names or logos' },
  { value: 'part', label: 'Part', description: 'Specific vehicle parts' },
  { value: 'tool', label: 'Tool', description: 'Tools used or visible' },
  { value: 'fluid', label: 'Fluid', description: 'Oils, coolants, or other fluids' }
] as const;

type TagType = typeof TAG_TYPES[number]['value'];

// Get color for tag type
const getTagColor = (tagType?: string): string => {
  switch (tagType) {
    case 'product': return 'var(--success)';
    case 'damage': return 'var(--danger)';
    case 'location': return 'var(--info)';
    case 'modification': return 'var(--warning)';
    case 'brand': return 'var(--purple, #8b5cf6)';
    case 'part': return 'var(--cyan, #06b6d4)';
    case 'tool': return 'var(--orange, #f97316)';
    case 'fluid': return 'var(--indigo, #6366f1)';
    default: return 'var(--success)';
  }
};

interface ImageData {
  id: string;
  image_url: string;
  is_primary?: boolean;
  storage_path?: string;
  thumbnail_url?: string;
  medium_url?: string;
  large_url?: string;
  created_at?: string;
  filename?: string;
  file_size?: number;
  mime_type?: string;
  exif_data?: any;
  user_id?: string;
  is_archived?: boolean;
  archived_by?: string;
  archived_at?: string;
}

interface ImageComment {
  id: string;
  image_id: string;
  user_id: string;
  content: string;
  created_at: string;
  user?: {
    email?: string;
    full_name?: string;
  };
}

interface ProImageViewerProps {
  vehicleId: string;
  onImageUpdate?: () => void;
}

const ProImageViewer: React.FC<ProImageViewerProps> = ({
  vehicleId,
  onImageUpdate
}) => {
  // Core state
  const [allImages, setAllImages] = useState<ImageData[]>([]);
  const [displayedImages, setDisplayedImages] = useState<ImageData[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [galleryMode, setGalleryMode] = useState(false);
  const [selectedImage, setSelectedImage] = useState<ImageData | null>(null);
  const [fullResLoaded, setFullResLoaded] = useState(false);
  const [showFullRes, setShowFullRes] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  // Image tagging state
  const [imageTags, setImageTags] = useState<Array<{
    id: string;
    x: number;
    y: number;
    text: string;
    type?: string;
    isEditing: boolean;
    trust_score?: number;
    verification_status?: string;
    created_by?: string;
    created_at?: string;
    metadata?: any;
  }>>([]);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [tagText, setTagText] = useState('');
  const [selectedTagType, setSelectedTagType] = useState<TagType>('product');
  const [tagSaving, setTagSaving] = useState(false);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [draggingTagId, setDraggingTagId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Infinite scroll state
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const IMAGES_PER_PAGE = 24;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Sorting state
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'size_desc' | 'size_asc' | 'name_asc' | 'name_desc'>('date_desc');
  const [sortedImages, setSortedImages] = useState<ImageData[]>([]);
  
  // Panel state
  const [showComments, setShowComments] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  // Touch gesture state
  const lastTouchRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const swipeRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);
  const pinchRef = useRef<{ startDistance: number; startZoom: number } | null>(null);
  const lastTapTimeRef = useRef<number>(0);
  
  // Comments state
  const [comments, setComments] = useState<ImageComment[]>([]);
  const [newComment, setNewComment] = useState('');
  
  // User and permissions
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [vehicleOwner, setVehicleOwner] = useState<string | null>(null);
  const [isOwnerOrModerator, setIsOwnerOrModerator] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    console.log('ProImageViewer: Component mounted/updated with vehicleId:', vehicleId);
    loadImages();
    loadCurrentUser();
  }, [vehicleId]);

  // Track viewport for mobile-specific layout tweaks
  useEffect(() => {
    const resize = () => setIsMobileViewport(window.innerWidth < 768);
    resize();
    window.addEventListener('resize', resize, { passive: true });
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Debug: Log when images state changes
  useEffect(() => {
    console.log('ProImageViewer: Displayed images updated:', displayedImages.length, 'of', allImages.length, 'total');
  }, [displayedImages, allImages]);

  // Infinite scroll effect
  useEffect(() => {
    if (galleryMode || !hasMore || loadingMore) return;

    const handleScroll = () => {
      const scrollPosition = window.scrollY + window.innerHeight;
      const threshold = document.documentElement.scrollHeight - 400; // Load more when 400px from bottom

      if (scrollPosition >= threshold) {
        loadMoreImages();
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [hasMore, loadingMore, galleryMode, allImages.length, displayedImages.length]);

  const loadCurrentUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    setCurrentUser(user);
    
    // Load vehicle owner and check permissions
    if (user && vehicleId) {
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('uploaded_by')
        .eq('id', vehicleId)
        .single();

      setVehicleOwner(vehicle?.uploaded_by || null);
      setIsOwnerOrModerator(vehicle?.uploaded_by === user.id);
    }
  };

  const loadImages = async () => {
    if (!vehicleId) {
      console.log('ProImageViewer: No vehicleId provided');
      return;
    }
    
    console.log('ProImageViewer: Loading images for vehicleId:', vehicleId);
    setLoading(true);
    
    try {
      let query = supabase
        .from('vehicle_images')
        .select('*')
        .eq('vehicle_id', vehicleId);
      
      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) {
        console.error('ProImageViewer: Database error:', error);
        throw error;
      }
      
      console.log('ProImageViewer: Loaded images:', data?.length || 0);
      setAllImages(data || []);
      
      // Apply initial sorting
      const sorted = sortImages(data || [], sortBy);
      setSortedImages(sorted);
      
      // Initialize with first page of sorted images
      const firstPage = sorted.slice(0, IMAGES_PER_PAGE);
      setDisplayedImages(firstPage);
      setPage(0);
      setHasMore(sorted.length > IMAGES_PER_PAGE);
      
    } catch (error) {
      console.error('ProImageViewer: Failed to load images:', error);
      setAllImages([]);
      setDisplayedImages([]);
    } finally {
      setLoading(false);
    }
  };

  const sortImages = (images: ImageData[], sortType: typeof sortBy): ImageData[] => {
    const sorted = [...images];
    
    switch (sortType) {
      case 'date_desc':
        return sorted.sort((a, b) => {
          const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
          const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
          return dateB - dateA;
        });
      case 'date_asc':
        return sorted.sort((a, b) => {
          const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
          const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
          return dateA - dateB;
        });
      case 'size_desc':
        return sorted.sort((a, b) => (b.file_size || 0) - (a.file_size || 0));
      case 'size_asc':
        return sorted.sort((a, b) => (a.file_size || 0) - (b.file_size || 0));
      case 'name_asc':
        return sorted.sort((a, b) => (a.filename || '').localeCompare(b.filename || ''));
      case 'name_desc':
        return sorted.sort((a, b) => (b.filename || '').localeCompare(a.filename || ''));
      default:
        return sorted;
    }
  };

  const applySorting = (newSortBy?: typeof sortBy) => {
    const sortType = newSortBy || sortBy;
    const sorted = sortImages(allImages, sortType);
    setSortedImages(sorted);
    
    // Reset pagination with sorted images
    const firstPage = sorted.slice(0, IMAGES_PER_PAGE);
    setDisplayedImages(firstPage);
    setPage(0);
    setHasMore(sorted.length > IMAGES_PER_PAGE);
  };

  const loadMoreImages = () => {
    if (loadingMore || !hasMore) return;
    
    setLoadingMore(true);
    const nextPage = page + 1;
    const startIndex = nextPage * IMAGES_PER_PAGE;
    const endIndex = startIndex + IMAGES_PER_PAGE;
    const newImages = sortedImages.slice(startIndex, endIndex);
    
    // Smooth loading without artificial delay
    requestAnimationFrame(() => {
      setDisplayedImages(prev => [...prev, ...newImages]);
      setPage(nextPage);
      setHasMore(endIndex < sortedImages.length);
      setLoadingMore(false);
    });
  };

  const loadComments = async (imageId: string) => {
    try {
      const { data, error } = await supabase
        .from('image_comments')
        .select(`
          *,
          user:profiles(email, full_name)
        `)
        .eq('image_id', imageId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setComments(data || []);
    } catch (error) {
      console.error('Failed to load comments:', error);
      setComments([]);
    }
  };

  const addComment = async () => {
    if (!currentUser || !selectedImage || !newComment.trim()) return;

    try {
      // Process comment for tags and URLs
      let processedContent = newComment.trim();
      
      // Extract URLs and convert to clickable links
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      const urls = processedContent.match(urlRegex) || [];
      
      // Extract @mentions
      const mentionRegex = /@(\w+)/g;
      const mentions = processedContent.match(mentionRegex) || [];
      
      const { error } = await supabase
        .from('image_comments')
        .insert({
          image_id: selectedImage.id,
          user_id: currentUser.id,
          content: processedContent,
          metadata: {
            urls: urls,
            mentions: mentions.map(m => m.substring(1)), // Remove @ symbol
            has_links: urls.length > 0,
            has_mentions: mentions.length > 0
          }
        });

      if (error) throw error;

      setNewComment('');
      loadComments(selectedImage.id);
      
      // TODO: Send notifications to mentioned users
      // TODO: Create timeline events for linked products/profiles
      
    } catch (error) {
      console.error('Failed to add comment:', error);
    }
  };

  const enterGalleryMode = async (image?: ImageData) => {
    setGalleryMode(true);
    if (image) {
      await openImage(image);
    } else if (allImages.length > 0) {
      await openImage(allImages[0]);
    }
  };

  const exitGalleryMode = () => {
    setGalleryMode(false);
    setSelectedImage(null);
    setFullResLoaded(false);
    setShowComments(false);
    setShowInfo(false);
    setShowTags(false);
    setComments([]);
    setNewComment('');
    // Clear all tagging state
    setImageTags([]);
    setActiveTagId(null);
    setSelectedTagId(null);
    setTagText('');
  };

  const openImage = async (image: ImageData) => {
    setSelectedImage(image);
    setFullResLoaded(false);
    setShowFullRes(false);
    setZoomLevel(1);
    setPanPosition({ x: 0, y: 0 });
    setIsDragging(false);
    setShowComments(false);
    setShowInfo(false);
    setShowTags(false);
    // Reset tagging state
    setImageTags([]);
    setActiveTagId(null);
    setSelectedTagId(null);
    setTagText('');
    loadComments(image.id);

    // Load existing tags for this image
    await loadSpatialTags(image.id);
  };

  const loadSpatialTags = async (imageId: string) => {
    setTagsLoading(true);
    console.log('Loading tags for image:', imageId);

    try {
      // Load tags from unified image_tags table
      const { data: tags, error } = await supabase
        .from('image_tags')
        .select('*')
        .eq('image_id', imageId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Failed to load image tags from Supabase:', error);
        setImageTags([]);
      } else if (tags && tags.length > 0) {
        console.log(`Found ${tags.length} tags for image:`, tags);
        
        // Convert clean database tags to local format
        const localTags = tags.map((tag: any) => ({
          id: tag.id,
          x: tag.x_position || 50, // Default to center if no position
          y: tag.y_position || 50,
          text: tag.tag_text || '',
          type: tag.tag_type || 'general',
          isEditing: false,
          created_by: tag.created_by || 'user',
          created_at: tag.created_at
        }));

        setImageTags(localTags);
      } else {
        console.log('No tags found for image:', imageId);
        setImageTags([]);
      }
    } catch (error) {
      console.error('Error loading spatial tags:', error);
      setImageTags([]);
    } finally {
      setTagsLoading(false);
    }
  };

  const navigateImage = async (direction: 'prev' | 'next') => {
    if (!selectedImage) return;

    const currentIndex = allImages.findIndex((img: ImageData) => img.id === selectedImage.id);
    let newIndex;

    if (direction === 'prev') {
      newIndex = currentIndex > 0 ? currentIndex - 1 : allImages.length - 1;
    } else {
      newIndex = currentIndex < allImages.length - 1 ? currentIndex + 1 : 0;
    }

    // Clear tags before switching images
    setImageTags([]);
    setActiveTagId(null);
    setSelectedTagId(null);
    setTagText('');

    await openImage(allImages[newIndex]);
  };

  const setAsLead = async (imageId: string) => {
    if (!isOwnerOrModerator) return;
    
    try {
      // Remove primary from all images
      await supabase
        .from('vehicle_images')
        .update({ is_primary: false })
        .eq('vehicle_id', vehicleId);

      // Set new primary
      await supabase
        .from('vehicle_images')
        .update({ is_primary: true })
        .eq('id', imageId);

      loadImages();
      if (onImageUpdate) onImageUpdate();
    } catch (error) {
      console.error('Failed to set lead image:', error);
    }
  };

  const archiveImage = async (imageId: string) => {
    if (!currentUser) return;
    
    const image = allImages.find((img: ImageData) => img.id === imageId);
    if (!image) return;
    
    // Users can archive their own images, owners can archive any
    const canArchive = image.user_id === currentUser.id || isOwnerOrModerator;
    if (!canArchive) return;
    
    try {
      await supabase
        .from('vehicle_images')
        .update({ 
          is_archived: true,
          archived_by: currentUser.id,
          archived_at: new Date().toISOString()
        })
        .eq('id', imageId);

      loadImages();
      if (selectedImage?.id === imageId) {
        exitGalleryMode();
      }
      if (onImageUpdate) onImageUpdate();
    } catch (error) {
      console.error('Failed to archive image:', error);
    }
  };

  // Handle tag dragging
  useEffect(() => {
    if (!draggingTagId) return;

    const handleMouseMove = (e: MouseEvent) => {
      const imageContainer = document.querySelector('.tag-container');
      if (!imageContainer) return;
      
      const rect = imageContainer.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      
      // Update tag position
      setImageTags(prev => prev.map(tag => 
        tag.id === draggingTagId 
          ? { ...tag, x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) }
          : tag
      ));
    };

    const handleMouseUp = async () => {
      // Save updated position to database if not a temporary tag
      const tag = imageTags.find(t => t.id === draggingTagId);
      if (tag && !draggingTagId.startsWith('tag-') && selectedImage) {
        // Update position in database
        await fetch(`/api/images/${selectedImage.id}/db-tags/${draggingTagId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          },
          body: JSON.stringify({
            tag: {
              x_position: tag.x,
              y_position: tag.y
            }
          })
        });
      }
      setDraggingTagId(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingTagId, imageTags, selectedImage]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!galleryMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle keyboard shortcuts when tag input is active
      if (activeTagId) return;
      
      // Don't handle if user is typing in any input field
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      
      // Handle tag deletion
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedTagId) {
        e.preventDefault();
        deleteTag(selectedTagId);
        return;
      }
      
      if (e.key === 'Escape') {
        if (selectedTagId) {
          setSelectedTagId(null);
        } else {
          exitGalleryMode();
        }
      }
      if (e.key === 'ArrowLeft') navigateImage('prev');
      if (e.key === 'ArrowRight') navigateImage('next');
      if (e.key === 'i' || e.key === 'I') setShowInfo(prev => !prev);
      if (e.key === 'c' || e.key === 'C') setShowComments(prev => !prev);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [galleryMode, selectedImage, allImages, activeTagId, selectedTagId]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const canDeleteImage = (image: ImageData): boolean => {
    if (!currentUser) return false;
    return image.user_id === currentUser.id || isOwnerOrModerator;
  };

  const handleImageClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!showFullRes) {
      setShowFullRes(true);
      return;
    }
    
    // If already in full res, handle zoom
    const rect = e.currentTarget.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    
    if (zoomLevel === 1) {
      // Zoom in to 2x at click point
      setZoomLevel(2);
      setPanPosition({
        x: (centerX - clickX) * 1,
        y: (centerY - clickY) * 1
      });
    } else if (zoomLevel === 2) {
      // Zoom in to 4x at click point
      setZoomLevel(4);
      setPanPosition({
        x: (centerX - clickX) * 3,
        y: (centerY - clickY) * 3
      });
    } else {
      // Reset zoom
      setZoomLevel(1);
      setPanPosition({ x: 0, y: 0 });
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoomLevel > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - panPosition.x, y: e.clientY - panPosition.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && zoomLevel > 1) {
      setPanPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Helpers for touch gestures
  const distanceBetweenTouches = (e: React.TouchEvent): number => {
    const [t1, t2] = [e.touches[0], e.touches[1]];
    const dx = t2.clientX - t1.clientX;
    const dy = t2.clientY - t1.clientY;
    return Math.hypot(dx, dy);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLImageElement>) => {
    if (!showFullRes) return; // Only enable gestures when full-res is active
    if (e.touches.length === 2) {
      // Pinch start
      const dist = distanceBetweenTouches(e as unknown as React.TouchEvent);
      pinchRef.current = { startDistance: dist, startZoom: zoomLevel };
      lastTouchRef.current = null;
      swipeRef.current = null;
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      lastTouchRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
      swipeRef.current = { startX: t.clientX, startY: t.clientY, moved: false };
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLImageElement>) => {
    if (!showFullRes) return;
    if (e.touches.length === 2 && pinchRef.current) {
      // Pinch to zoom
      e.preventDefault();
      const newDist = distanceBetweenTouches(e);
      const scale = newDist / Math.max(1, pinchRef.current.startDistance);
      const newZoom = Math.max(1, Math.min(4, pinchRef.current.startZoom * scale));
      setZoomLevel(newZoom);
    } else if (e.touches.length === 1 && lastTouchRef.current) {
      const t = e.touches[0];
      const dx = t.clientX - lastTouchRef.current.x;
      const dy = t.clientY - lastTouchRef.current.y;
      if (zoomLevel > 1) {
        // Pan when zoomed
        e.preventDefault();
        setPanPosition(prev => ({ x: prev.x + dx, y: prev.y + dy }));
        lastTouchRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
        if (swipeRef.current) swipeRef.current.moved = true;
      } else {
        // Track potential swipe for navigation when not zoomed
        if (swipeRef.current) {
          const deltaX = t.clientX - swipeRef.current.startX;
          const deltaY = t.clientY - swipeRef.current.startY;
          if (Math.hypot(deltaX, deltaY) > 10) swipeRef.current.moved = true;
        }
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLImageElement>) => {
    if (!showFullRes) return;
    // End pinch
    if (e.touches.length < 2) {
      pinchRef.current = null;
    }

    // Single-finger gestures
    const lt = lastTouchRef.current;
    const swipe = swipeRef.current;
    if (lt && (!e.touches || e.touches.length === 0)) {
      const dt = Date.now() - lt.time;
      const changed = (e.changedTouches && e.changedTouches[0]) || null;
      const endX = changed ? changed.clientX : lt.x;
      const endY = changed ? changed.clientY : lt.y;
      const dx = endX - (swipe?.startX ?? lt.x);
      const dy = endY - (swipe?.startY ?? lt.y);

      // Swipe nav when not zoomed
      if (zoomLevel === 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) navigateImage('next');
        else navigateImage('prev');
        lastTouchRef.current = null;
        swipeRef.current = null;
        return;
      }

      // Double tap to toggle zoom
      if (dt < 250 && Math.abs(dx) < 6 && Math.abs(dy) < 6) {
        const now = Date.now();
        if (now - lastTapTimeRef.current < 300) {
          // Double tap detected
          if (zoomLevel === 1) {
            setZoomLevel(2);
          } else if (zoomLevel === 2) {
            setZoomLevel(4);
          } else {
            setZoomLevel(1);
            setPanPosition({ x: 0, y: 0 });
          }
          lastTapTimeRef.current = 0;
        } else {
          lastTapTimeRef.current = now;
        }
      }
    }

    lastTouchRef.current = null;
    swipeRef.current = null;
  };

  const handleImageClickForTagging = (e: React.MouseEvent) => {
    e.stopPropagation();
    
    // Only handle tagging when in Tags mode
    if (!showTags || !showFullRes) {
      handleImageClick(e); // Use normal zoom behavior
      return;
    }
    
    // Calculate relative position on the image
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100; // Percentage
    const y = ((e.clientY - rect.top) / rect.height) * 100; // Percentage
    
    // Create new tag
    const newTagId = `tag-${Date.now()}`;
    const newTag = {
      id: newTagId,
      x: x,
      y: y,
      text: '',
      isEditing: true
    };
    
    setImageTags(prev => [...prev, newTag]);
    setActiveTagId(newTagId);
    setTagText('');
    setSelectedTagType('product'); // Reset to default type
  };

  const saveTag = async (tagId: string) => {
    if (!tagText.trim()) {
      // Remove empty tag
      await deleteTag(tagId);
      return;
    }

    if (!selectedImage) return;

    const tag = imageTags.find(t => t.id === tagId);
    if (!tag) return;

    setTagSaving(true);

    try {
      // Check if this is a new tag (temporary ID) or existing tag
      const isNewTag = tagId.startsWith('tag-');

      if (isNewTag) {
        // Create new tag in database
        const response = await fetch(`/api/images/${selectedImage.id}/db-tags`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          },
          body: JSON.stringify({
            tag: {
              x_position: tag.x,
              y_position: tag.y,
              tag_type: selectedTagType,
              text: tagText.trim()
            }
          })
        });

        if (response.ok) {
          const { data: newTag } = await response.json();
          // Update local state with server response
          setImageTags(prev => prev.map(t =>
            t.id === tagId
              ? {
                id: newTag.id,
                x: newTag.x_position,
                y: newTag.y_position,
                text: newTag.text,
                type: newTag.tag_type,
                isEditing: false,
                trust_score: newTag.trust_score,
                verification_status: newTag.verification_status,
                created_by: newTag.created_by,
                created_at: newTag.inserted_at
              }
              : t
          ));
        } else {
          console.error('Failed to save tag to database');
          // Still update local state for offline functionality
          setImageTags(prev => prev.map(t =>
            t.id === tagId
              ? { ...t, text: tagText.trim(), isEditing: false }
              : t
          ));
        }
      } else {
        // Update existing tag in database
        const response = await fetch(`/api/images/${selectedImage.id}/db-tags/${tagId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          },
          body: JSON.stringify({
            tag: {
              text: tagText.trim(),
              tag_type: selectedTagType
            }
          })
        });

        if (response.ok) {
          const { data: updatedTag } = await response.json();
          setImageTags(prev => prev.map(t =>
            t.id === tagId
              ? {
                id: updatedTag.id,
                x: updatedTag.x_position,
                y: updatedTag.y_position,
                text: updatedTag.text,
                type: updatedTag.tag_type,
                isEditing: false,
                trust_score: updatedTag.trust_score,
                verification_status: updatedTag.verification_status,
                created_by: updatedTag.created_by,
                created_at: updatedTag.inserted_at
              }
              : t
          ));
        } else {
          console.error('Failed to update tag in database');
          // Still update local state
          setImageTags(prev => prev.map(t =>
            t.id === tagId
              ? { ...t, text: tagText.trim(), isEditing: false }
              : t
          ));
        }
      }
    } catch (error) {
      console.error('Error saving tag:', error);
      // Fallback to local-only update
      setImageTags(prev => prev.map(t =>
        t.id === tagId
          ? { ...t, text: tagText.trim(), isEditing: false }
          : t
      ));
    } finally {
      setTagSaving(false);
    }

    setActiveTagId(null);
    setTagText('');
  };

  const editTag = (tagId: string) => {
    const tag = imageTags.find(t => t.id === tagId);
    if (tag) {
      setActiveTagId(tagId);
      setTagText(tag.text);
      setImageTags(prev => prev.map(t => 
        t.id === tagId ? { ...t, isEditing: true } : t
      ));
    }
  };

  const deleteTag = async (tagId: string) => {
    if (!selectedImage) return;

    try {
      // Only try to delete from database if it's not a temporary tag
      if (!tagId.startsWith('tag-')) {
        const response = await fetch(`/api/images/${selectedImage.id}/db-tags/${tagId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          }
        });

        if (!response.ok) {
          console.error('Failed to delete tag from database');
          // Continue with local deletion for better UX
        }
      }

      // Remove from local state
      setImageTags(prev => prev.filter(tag => tag.id !== tagId));

      if (activeTagId === tagId) {
        setActiveTagId(null);
        setTagText('');
      }
      if (selectedTagId === tagId) {
        setSelectedTagId('');
      }
    } catch (error) {
      console.error('Error deleting tag:', error);
      // Still remove locally
      setImageTags(prev => prev.filter(tag => tag.id !== tagId));
      if (activeTagId === tagId) {
        setActiveTagId(null);
        setTagText('');
      }
      if (selectedTagId === tagId) {
        setSelectedTagId('');
      }
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <div className="text text-muted">Loading images...</div>
      </div>
    );
  }

  return (
    <div ref={scrollContainerRef}>
      {/* Upload Button and Sorting Controls */}
      <div className="flex items-center justify-between m-4">
        <div className="flex items-center gap-2">
          {currentUser && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="button button-primary"
            >
              Upload Images
            </button>
          )}
        </div>
        
        {/* Sorting Controls */}
        {allImages.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-small text-muted">Sort by:</span>
            <select
              value={sortBy}
              onChange={(e) => {
                const newSort = e.target.value as typeof sortBy;
                setSortBy(newSort);
                applySorting(newSort);
              }}
              className="form-select form-input"
              style={{ width: 'auto', minWidth: '120px' }}
            >
              <option value="date_desc">Newest First</option>
              <option value="date_asc">Oldest First</option>
              <option value="size_desc">Largest First</option>
              <option value="size_asc">Smallest First</option>
              <option value="name_asc">Name A-Z</option>
              <option value="name_desc">Name Z-A</option>
            </select>
          </div>
        )}
      </div>
      
      {/* TODO: Add archived toggle when is_archived column exists */}

      {/* Grid View: 3 per row with small thumbnails */}
      {!galleryMode && (
        <>
          {displayedImages.length === 0 ? (
            <div className="upload-zone">
              <div className="upload-zone-content">
                <div className="text font-bold">No images yet</div>
                <div className="text-small text-muted">
                  {currentUser ? 'Upload some images to get started!' : 'Sign in to upload images'}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid m-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '12px' }}>
              {displayedImages.map((image: ImageData) => (
                <div 
                  key={image.id} 
                  className="vehicle-card relative"
                  style={{ 
                    aspectRatio: '4/3',
                    border: image.is_primary ? '2px outset var(--primary)' : '1px solid var(--border-light)',
                    cursor: 'pointer'
                  }}
                  onClick={() => enterGalleryMode(image)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.05)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                >
                  {/* Use thumbnail_url for small thumbnails - preserve orientation */}
                  <LazyImage
                    src={image.thumbnail_url || image.image_url}
                    alt=""
                    size="thumbnail"
                    style={{ 
                      width: '100%', 
                      height: '100%', 
                      objectFit: 'cover',
                      imageOrientation: 'from-image' // Respect EXIF orientation
                    }}
                  />
                  
                  {/* Primary badge */}
                  {image.is_primary && (
                    <div className="badge badge-primary absolute" style={{ top: 'var(--space-1)', left: 'var(--space-1)' }}>
                      PRIMARY
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          
          {/* Loading More Indicator */}
          {loadingMore && (
            <div className="loading-container">
              <div className="loading-spinner"></div>
              <div className="text-small text-muted">Loading more images...</div>
            </div>
          )}
          
          {/* End of Images Indicator */}
          {!hasMore && displayedImages.length > 0 && (
            <div className="text-center m-4">
              <div className="text-small text-muted">
                All {allImages.length} images loaded
              </div>
            </div>
          )}
          
          {/* View Gallery Button */}
          {displayedImages.length > 0 && (
            <div className="text-center m-4">
              <button
                onClick={() => enterGalleryMode()}
                className="button button-primary"
              >
                View Gallery ({allImages.length} images)
              </button>
            </div>
          )}
        </>
      )}

      {/* Gallery Mode: Full Screen Image Viewer */}
      {galleryMode && selectedImage && (
        <div 
          style={{ 
            position: 'fixed', 
            inset: 0, 
            backgroundColor: 'rgba(0, 0, 0, 0.95)', 
            zIndex: 1000,
            display: 'flex'
          }}
          onClick={(e) => {
            // Only exit if clicking the background itself, not any child elements
            if (e.target === e.currentTarget) {
              exitGalleryMode();
            }
          }}
        >
          {/* Close Button */}
          <button
            onClick={exitGalleryMode}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              background: 'rgba(0, 0, 0, 0.7)',
              border: '2px solid var(--border-light)',
              color: 'white',
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              cursor: 'pointer',
              fontSize: '20px',
              zIndex: 1003,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 0, 0, 0.5)';
              e.currentTarget.style.transform = 'scale(1.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(0, 0, 0, 0.7)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
            title="Close (Esc)"
          >
            ✕
          </button>

          {/* Main Image Area */}
          <div 
            style={{ 
              flex: 1, 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              position: 'relative' 
            }}
            onClick={(e) => e.stopPropagation()}>
            <div className="tag-container" style={{ position: 'relative', display: 'inline-block' }}>
              <img 
                src={showFullRes ? selectedImage.image_url : (selectedImage.large_url || selectedImage.image_url)}
                alt="" 
                style={{ 
                  maxWidth: showInfo || showComments ? '70vw' : '90vw', 
                  maxHeight: '90vh', 
                  objectFit: 'contain',
                  transition: showFullRes ? 'none' : 'max-width 0.3s ease',
                  cursor: !showFullRes ? 'zoom-in' : (showTags ? 'crosshair' : (zoomLevel > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in')),
                  transform: showFullRes ? `scale(${zoomLevel}) translate(${panPosition.x / zoomLevel}px, ${panPosition.y / zoomLevel}px)` : 'none',
                  transformOrigin: 'center center',
                  touchAction: showFullRes ? 'none' : 'manipulation',
                  userSelect: 'none'
                }}
                onClick={handleImageClickForTagging}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onLoad={() => {
                  if (!fullResLoaded) {
                    setFullResLoaded(true);
                  }
                }}
              />
              
              {/* Image Tags */}
              {showFullRes && showTags && tagsLoading && (
                <div
                  style={{
                    position: 'absolute',
                    top: 20,
                    right: 20,
                    background: 'rgba(0, 0, 0, 0.8)',
                    color: 'white',
                    padding: '8px 12px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    zIndex: 1002
                  }}
                >
                  Loading tags...
                </div>
              )}
              {showFullRes && showTags && !tagsLoading && imageTags.map(tag => (
                <div
                  key={tag.id}
                  className="image-tag"
                  style={{
                    position: 'absolute',
                    left: `${tag.x}%`,
                    top: `${tag.y}%`,
                    transform: 'translate(-50%, -50%)',
                    zIndex: 10
                  }}
                >
                  {/* Tag Marker */}
                  <div
                    className="tag-marker"
                    style={{
                      width: '12px',
                      height: '12px',
                      background: tag.isEditing ? 'var(--primary)' : getTagColor(tag.type),
                      border: selectedTagId === tag.id ? '3px solid var(--primary)' : '2px solid var(--white)',
                      borderRadius: '50%',
                      cursor: draggingTagId === tag.id ? 'grabbing' : (selectedTagId === tag.id ? 'move' : 'pointer'),
                      boxShadow: tag.isEditing ? '0 0 8px var(--primary)' : (selectedTagId === tag.id ? '0 0 8px var(--warning)' : 'none'),
                      transition: draggingTagId === tag.id ? 'none' : 'all 0.2s ease'
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (tag.isEditing || draggingTagId) return;
                      
                      if (selectedTagId === tag.id) {
                        // If already selected, start editing
                        editTag(tag.id);
                      } else {
                        // Select the tag
                        setSelectedTagId(tag.id);
                      }
                    }}
                    onMouseDown={(e) => {
                      if (selectedTagId === tag.id && !tag.isEditing) {
                        e.preventDefault();
                        e.stopPropagation();
                        setDraggingTagId(tag.id);
                        const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                        setDragOffset({
                          x: e.clientX - rect.left,
                          y: e.clientY - rect.top
                        });
                      }
                    }}
                    onMouseEnter={(e) => {
                      if (!tag.isEditing && selectedTagId !== tag.id && !draggingTagId) {
                        e.currentTarget.style.transform = 'scale(1.2)';
                        e.currentTarget.style.boxShadow = '0 0 6px var(--success)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!tag.isEditing && selectedTagId !== tag.id && !draggingTagId) {
                        e.currentTarget.style.transform = 'scale(1)';
                        e.currentTarget.style.boxShadow = 'none';
                      }
                    }}
                    title={selectedTagId === tag.id ? "Drag to move, Click to edit" : "Click to select"}
                  />
                  
                  {/* Tag Text/Input */}
                  {tag.text && !tag.isEditing && (
                    <div
                      className="tag-info"
                      style={{
                        position: 'absolute',
                        top: '20px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        background: 'var(--grey-100)',
                        color: 'var(--text)',
                        padding: '6px 10px',
                        border: '2px outset var(--border-medium)',
                        whiteSpace: 'nowrap',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        maxWidth: '300px',
                        zIndex: 11,
                        pointerEvents: 'none',
                        boxShadow: '1px 1px 0 rgba(0, 0, 0, 0.25)',
                        cursor: 'pointer'
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        editTag(tag.id);
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(0, 0, 0, 0.95)';
                        e.currentTarget.style.transform = 'translateX(-50%) scale(1.05)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(0, 0, 0, 0.9)';
                        e.currentTarget.style.transform = 'translateX(-50%) scale(1)';
                      }}
                    >
                      {/* Tag Header */}
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
                        <div
                          style={{
                            width: '8px',
                            height: '8px',
                            backgroundColor: getTagColor(tag.type),
                            borderRadius: '50%',
                            marginRight: '6px'
                          }}
                        />
                        <span style={{
                          fontSize: '9px',
                          textTransform: 'uppercase',
                          fontWeight: 'bold',
                          color: getTagColor(tag.type)
                        }}>
                          {tag.type || 'product'}
                        </span>
                        {tag.trust_score && (
                          <span style={{
                            marginLeft: 'auto',
                            fontSize: '9px',
                            backgroundColor: tag.trust_score >= 75 ? 'var(--success)' :
                                           tag.trust_score >= 50 ? 'var(--warning)' : 'var(--danger)',
                            padding: '2px 4px',
                            borderRadius: '2px',
                            fontWeight: 'bold'
                          }}>
                            {tag.trust_score}%
                          </span>
                        )}
                      </div>

                      {/* Tag Text */}
                      <div style={{
                        fontWeight: 'normal',
                        lineHeight: '1.3',
                        wordBreak: 'break-word'
                      }}>
                        {tag.text}
                      </div>

                      {/* Tag Meta */}
                      {/* Additional metadata */}
                      {tag.type && (
                        <div style={{
                          marginTop: '6px',
                          paddingTop: '6px',
                          borderTop: '1px solid var(--border-light)',
                          fontSize: '9px',
                          color: 'var(--text-muted)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}>
                          {tag.verification_status && (
                            <span style={{
                              color: tag.verification_status === 'verified' ? 'var(--success)' :
                                     tag.verification_status === 'pending' ? 'var(--warning)' : 'var(--danger)'
                            }}>
                              {tag.verification_status}
                            </span>
                          )}
                          {tag.created_by && (
                            <span>by {tag.created_by.substring(0, 8)}...</span>
                          )}
                        </div>
                      )}

                      {/* Edit icon */}
                      <span style={{
                        position: 'absolute',
                        top: '4px',
                        right: '6px',
                        opacity: 0.5,
                        fontSize: '10px'
                      }}>
                        ✎
                      </span>
                    </div>
                  )}
                  
                  {/* Floating Tag Input - Windows 95 Style */}
                  {tag.isEditing && activeTagId === tag.id && (
                    <div
                      className="tag-input-popup"
                      style={{
                        position: 'absolute',
                        top: '20px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        background: 'var(--grey-200)',
                        border: '2px outset var(--border-medium)',
                        padding: 'var(--space-2)',
                        minWidth: '250px',
                        maxWidth: '350px',
                        zIndex: 1000,
                        boxShadow: '2px 2px 0 rgba(0, 0, 0, 0.25)'
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Quick Type Selector */}
                      <div style={{ display: 'flex', gap: '4px', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
                        {TAG_TYPES.slice(0, 4).map(type => (
                          <button
                            key={type.value}
                            onClick={() => setSelectedTagType(type.value)}
                            className={`button button-tiny`}
                            style={{
                              padding: '2px 6px',
                              fontSize: '9px',
                              background: selectedTagType === type.value ? getTagColor(type.value) : 'var(--grey-300)',
                              border: selectedTagType === type.value ? '2px inset var(--border-medium)' : '2px outset var(--border-light)',
                              color: selectedTagType === type.value ? 'white' : 'var(--text)'
                            }}
                          >
                            {type.label}
                          </button>
                        ))}
                        <select
                          value={selectedTagType}
                          onChange={(e) => setSelectedTagType(e.target.value as TagType)}
                          style={{
                            fontSize: '9px',
                            padding: '2px',
                            marginLeft: 'auto'
                          }}
                        >
                          {TAG_TYPES.map(type => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Text Input */}
                      <input
                        type="text"
                        value={tagText}
                        onChange={(e) => setTagText(e.target.value)}
                        placeholder="Describe what you see..."
                        className="form-input"
                        style={{ 
                          width: '100%', 
                          marginBottom: 'var(--space-1)',
                          fontSize: '14px',
                          padding: '6px'
                        }}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (tagText.trim()) {
                              saveTag(tag.id);
                            }
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            deleteTag(tag.id);
                          } else if ((e.key === 'Delete' || e.key === 'Backspace') && !tagText.trim()) {
                            e.preventDefault();
                            deleteTag(tag.id);
                          }
                        }}
                      />

                      {/* Quick Actions */}
                      <div style={{ display: 'flex', gap: 'var(--space-1)', fontSize: '9px', color: 'var(--text-muted)' }}>
                        <span>Enter: Save</span>
                        <span>•</span>
                        <span>Esc: Cancel</span>
                        <span>•</span>
                        <span>Delete (empty): Remove</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            
            {/* Zoom Indicator */}
            {showFullRes && zoomLevel > 1 && (
              <div 
                className="badge badge-primary absolute"
                style={{ 
                  top: 'var(--space-4)', 
                  right: 'var(--space-4)',
                  background: 'var(--grey-800)',
                  color: 'var(--white)',
                  border: '1px solid var(--border-light)'
                }}
              >
                {zoomLevel}x zoom
              </div>
            )}
            
            {/* Navigation Buttons */}
            {allImages.length > 1 && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); navigateImage('prev'); }}
                  style={{
                    position: 'absolute',
                    left: '20px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'rgba(0, 0, 0, 0.7)',
                    border: 'none',
                    color: 'white',
                    padding: '16px 20px',
                    borderRadius: '50%',
                    cursor: 'pointer',
                    fontSize: '24px',
                    transition: 'background 0.2s'
                  }}
                >
                  ‹
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); navigateImage('next'); }}
                  style={{
                    position: 'absolute',
                    right: (showInfo || showComments || showTags) ? (isMobileViewport ? '20px' : '420px') : '20px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'rgba(0, 0, 0, 0.7)',
                    border: 'none',
                    color: 'white',
                    padding: '16px 20px',
                    borderRadius: '50%',
                    cursor: 'pointer',
                    fontSize: '24px',
                    transition: 'all 0.3s'
                  }}
                >
                  ›
                </button>
              </>
            )}

            {/* Bottom Control Bar */}
            <div 
              className="fixed flex items-center gap-4 p-3"
              style={{
                bottom: 'var(--space-5)',
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'var(--grey-800)',
                border: '2px outset var(--border-medium)',
                borderRadius: 'var(--radius)'
              }}
            >
              {/* Back to Grid */}
              <button
                onClick={(e) => { e.stopPropagation(); exitGalleryMode(); }}
                className="button button-small"
                style={{
                  background: 'var(--grey-200)',
                  color: 'var(--text)',
                  border: '1px outset var(--border-light)'
                }}
              >
                ← Back to Grid
              </button>
              
              {/* All Users: Comments and Info */}
              <button
                onClick={(e) => { e.stopPropagation(); setShowComments(prev => !prev); }}
                className={`button button-small ${showComments ? 'button-primary' : ''}`}
                style={{
                  background: showComments ? 'var(--grey-300)' : 'var(--grey-200)',
                  color: 'var(--text)',
                  border: showComments ? '1px inset var(--border-medium)' : '1px outset var(--border-light)'
                }}
              >
                Comments {comments.length > 0 && `(${comments.length})`}
              </button>

              <button
                onClick={(e) => { e.stopPropagation(); setShowTags(prev => !prev); }}
                className={`button button-small ${showTags ? 'button-primary' : ''}`}
                style={{
                  background: showTags ? 'var(--grey-300)' : 'var(--grey-200)',
                  color: 'var(--text)',
                  border: showTags ? '1px inset var(--border-medium)' : '1px outset var(--border-light)'
                }}
              >
                Tags {imageTags.length > 0 && `(${imageTags.length})`}
              </button>

              {/* Owner/Moderator: Lead Image */}
              {isOwnerOrModerator && (
                <button
                  onClick={(e) => { e.stopPropagation(); setAsLead(selectedImage.id); }}
                  disabled={selectedImage.is_primary}
                  className={`button button-small ${selectedImage.is_primary ? 'button-primary' : ''}`}
                  style={{
                    background: selectedImage.is_primary ? 'var(--success)' : 'var(--grey-200)',
                    color: 'var(--text)',
                    border: selectedImage.is_primary ? '1px inset var(--border-medium)' : '1px outset var(--border-light)',
                    opacity: selectedImage.is_primary ? 0.8 : 1
                  }}
                >
                  {selectedImage.is_primary ? 'Lead Image' : 'Set as Lead'}
                </button>
              )}

              {/* TODO: Add archive functionality when is_archived column exists */}
              {/* {canDeleteImage(selectedImage) && (
                <button
                  onClick={(e) => { e.stopPropagation(); archiveImage(selectedImage.id); }}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(220, 53, 69, 0.5)',
                    color: '#dc3545',
                    padding: '8px 16px',
                    borderRadius: '16px',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  🗑️ Archive
                </button>
              )} */}
            </div>
          </div>

          {/* Side Panel */}
          {(showInfo || showComments || showTags) && (
            <div 
              className="card"
              style={{ 
                width: isMobileViewport ? '100vw' : '400px', 
                height: '100vh', 
                borderLeft: '2px inset var(--border-medium)',
                borderRadius: 0,
                display: 'flex',
                flexDirection: 'column',
                position: isMobileViewport ? 'absolute' : 'relative',
                right: isMobileViewport ? 0 : undefined,
                top: isMobileViewport ? 0 : undefined,
                zIndex: 1002,
                background: 'var(--grey-100)'
              }}
            >
              {/* Panel Header */}
              <div className="card-header flex justify-between items-center">
                <h3 className="text font-bold" style={{ margin: 0 }}>
                  {showInfo ? 'Image Details' : 'Comments'}
                </h3>
                <button
                  onClick={() => {
                    setShowInfo(false);
                    setShowComments(false);
                    setShowTags(false);
                  }}
                  className="button button-small"
                >
                  X
                </button>
              </div>

              {/* Comments Panel */}
              {showComments && (
                <div className="card-body flex flex-col" style={{ flex: 1, minHeight: 0 }}>
                  {/* Comments List */}
                  <div className="comments-list" style={{ flex: 1, overflowY: 'auto' }}>
                    {comments.length === 0 ? (
                      <div className="text-center text-muted p-4">
                        No comments yet. Be the first to comment!
                      </div>
                    ) : (
                      comments.map(comment => (
                        <div key={comment.id} className="comment-item" style={{
                          padding: 'var(--space-3)',
                          borderBottom: '1px solid var(--border-light)'
                        }}>
                          <div className="comment-header" style={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            marginBottom: 'var(--space-2)' 
                          }}>
                            <span className="text-small font-bold">
                              {comment.user?.full_name || comment.user?.email || 'Anonymous'}
                            </span>
                            <span className="text-small text-muted">
                              {new Date(comment.created_at).toLocaleString()}
                            </span>
                          </div>
                          <div className="comment-content">
                            {comment.content}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Comment Input */}
                  {currentUser && (
                    <div className="comment-form" style={{
                      padding: 'var(--space-3)',
                      borderTop: '1px solid var(--border-light)'
                    }}>
                      <textarea
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        placeholder="Add a comment..."
                        className="comment-input"
                        style={{
                          width: '100%',
                          minHeight: '60px',
                          marginBottom: 'var(--space-2)'
                        }}
                      />
                      <button
                        onClick={() => addComment()}
                        disabled={!newComment.trim()}
                        className={`button button-small ${newComment.trim() ? 'button-primary' : ''}`}
                      >
                        Post Comment
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Comments Panel */}
              {showComments && (
                <div className="card-body flex flex-col" style={{ flex: 1, minHeight: 0 }}>
                  {/* Comments List */}
                  <div className="comments-list" style={{ flex: 1, overflowY: 'auto' }}>
                    {comments.length === 0 ? (
                      <div className="text-center text-muted p-4">
                        <div className="text">No comments yet</div>
                        <div className="text-small">Be the first to comment!</div>
                      </div>
                    ) : (
                      comments.map((comment: any) => (
                        <div key={comment.id} className="comment-item">
                          <div className="comment-header">
                            <span className="text-small font-bold">
                              {comment.user?.full_name || comment.user?.email || 'Anonymous'}
                            </span>
                            <span className="text-small text-muted">
                              {formatDate(comment.created_at)}
                            </span>
                          </div>
                          <div className="comment-text text-small">{comment.content}</div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Add Comment Form */}
                  {currentUser && (
                    <div className="comment-form">
                      <textarea
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        placeholder="Add a comment... Use @username to tag users or paste URLs to link products"
                        className="comment-input"
                      />
                      <div className="comment-form-actions">
                        <button
                          onClick={() => {
                            if (newComment.trim()) {
                              addComment();
                            }
                          }}
                          disabled={!newComment.trim()}
                          className={`button button-small ${newComment.trim() ? 'button-primary' : ''}`}
                        >
                          Post Comment
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tags Panel (includes Info) */}
              {showTags && (
                <div className="card-body flex flex-col" style={{ flex: 1, minHeight: 0 }}>
                  {/* Image Info Section */}
                  <div style={{ marginBottom: 'var(--space-3)', paddingBottom: 'var(--space-3)', borderBottom: '1px solid var(--border-light)' }}>
                    <h3 style={{ fontSize: '11pt', fontWeight: 'bold', margin: 0, marginBottom: 'var(--space-2)' }}>
                      Image Info
                    </h3>
                    <div className="detail-section">
                      <div className="detail-item">
                        <span className="detail-label">Filename:</span>
                        <span className="detail-value">{selectedImage.filename || 'Unknown'}</span>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">Size:</span>
                        <span className="detail-value">{formatFileSize(selectedImage.file_size || 0)}</span>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">Uploaded:</span>
                        <span className="detail-value">{formatDate(selectedImage.created_at || '')}</span>
                      </div>
                    </div>
                  </div>

                  {/* Tags Section */}
                  <div className="tags-header" style={{ marginBottom: 'var(--space-3)', paddingBottom: 'var(--space-2)', borderBottom: '1px solid var(--border-light)' }}>
                    <h3 style={{ fontSize: '11pt', fontWeight: 'bold', margin: 0 }}>
                      Image Tags ({imageTags.length})
                    </h3>
                    {tagsLoading && (
                      <div className="text-small text-muted" style={{ marginTop: 'var(--space-1)' }}>
                        Loading tags...
                      </div>
                    )}
                  </div>

                  {/* Tags List */}
                  <div className="tags-list" style={{ flex: 1, overflowY: 'auto' }}>
                    {imageTags.length === 0 && !tagsLoading ? (
                        <div className="text-small text-muted">Loading AI-generated tags...</div>
                    ) : imageTags.length > 0 ? (
                      <div className="space-y-2 p-2">
                        {imageTags.filter(tag => !tag.isEditing).map(tag => (
                          <div
                            key={tag.id}
                            className="tag-item"
                            style={{
                              padding: 'var(--space-2)',
                              border: '1px solid var(--border-light)',
                              borderRadius: 'var(--radius)',
                              backgroundColor: selectedTagId === tag.id ? 'var(--bg-hover)' : 'transparent',
                              cursor: 'pointer'
                            }}
                            onClick={() => setSelectedTagId(tag.id)}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <div
                                  style={{
                                    width: '12px',
                                    height: '12px',
                                    borderRadius: '50%',
                                    backgroundColor: getTagColor(tag.type),
                                    flexShrink: 0
                                  }}
                                />
                                <div style={{ flex: 1 }}>
                                  <div className="text-small font-medium">{tag.text}</div>
                                  <div className="text-xs text-muted">
                                    {tag.type} • {tag.created_by}
                                    {tag.trust_score && ` • ${Math.round(tag.trust_score * 100)}% confidence`}
                                  </div>
                                  {tag.metadata?.price && (
                                    <div className="text-xs text-success">
                                      Estimated value: ${tag.metadata.price}
                                    </div>
                                  )}
                                </div>
                              </div>
                              {canDeleteImage(selectedImage) && (
                                <button
                                  className="button button-small button-ghost"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteTag(tag.id);
                                  }}
                                  style={{ padding: '2px 4px' }}
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center text-muted" style={{ padding: 'var(--space-4)' }}>
                        No AI-generated tags found yet.<br />
                        <span className="text-small">
                          Tags will appear here after OpenAI analyzes the image.
                          <br/>You can also click on the image to manually add tags.
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Instructions - moved to top for better visibility */}
                  {showTags && (
                    <div style={{
                      marginBottom: 'var(--space-3)',
                      padding: 'var(--space-2)',
                      backgroundColor: 'var(--grey-50)',
                      borderRadius: 'var(--radius)',
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      lineHeight: '1.6'
                    }}>
                      <strong>How to add tags:</strong><br />
                      1. Click image to zoom {showFullRes && '✅'}<br />
                      2. Click anywhere to place tag<br />
                      3. Type description and save<br />
                    <br />
                    <strong>Status:</strong> {
                      showTags && showFullRes ? <span style={{ color: 'var(--success)' }}>🟢 Tagging Active - Click to add tags!</span> :
                      showTags && !showFullRes ? <span style={{ color: 'var(--warning)' }}>🟡 Click image to load full resolution</span> :
                      <span style={{ color: 'var(--success)' }}>✅ Tag panel open - Ready to tag</span>
                    }
                  </div>
                )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Hidden file input for uploads */}
      <input 
        ref={fileInputRef} 
        type="file" 
        multiple 
        accept="image/*" 
        style={{ display: 'none' }}
        onChange={(e) => {
          // TODO: Implement file upload logic
          console.log('Files selected:', e.target.files);
        }}
      />
    </div>
  );
};

export default ProImageViewer;
export { ProImageViewer };
