import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import LazyImage from './LazyImage';

interface ImageData {
  id: string;
  image_url: string;
  is_primary?: boolean;
  storage_path?: string;
  thumbnail_url?: string;
  medium_url?: string;
  large_url?: string;
  created_at?: string;
  taken_at?: string;
  exif_data?: any;
  user_id?: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
  variants?: {
    thumbnail?: string;
    medium?: string;
    large?: string;
    full?: string;
  };
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

interface UserProfile {
  id: string;
  email?: string;
  full_name?: string;
}

interface EnhancedImageViewerProps {
  vehicleId: string;
  onImageUpdate?: () => void;
}

const EnhancedImageViewer: React.FC<EnhancedImageViewerProps> = ({
  vehicleId,
  onImageUpdate
}) => {
  const [images, setImages] = useState<ImageData[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<ImageData | null>(null);
  const [zoomMode, setZoomMode] = useState<'fit' | 'full'>('fit');
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [imageComments, setImageComments] = useState<ImageComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [addingComment, setAddingComment] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [imageUploader, setImageUploader] = useState<UserProfile | null>(null);
  const [vehicleOwner, setVehicleOwner] = useState<string | null>(null);

  // Load images
  useEffect(() => {
    loadImages();
    loadCurrentUser();
  }, [vehicleId]);

  const loadCurrentUser = async () => {
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (authData.user) {
        setCurrentUser({
          id: authData.user.id,
          email: authData.user.email,
          full_name: authData.user.user_metadata?.full_name || authData.user.email
        });
      }
    } catch (error) {
      console.error('Error loading current user:', error);
    }
  };

  const loadImages = async () => {
    if (!vehicleId) return;

    setLoading(true);
    try {
      // Get vehicle owner
      const { data: vehicleData } = await supabase
        .from('vehicles')
        .select('uploaded_by')
        .eq('id', vehicleId)
        .single();

      setVehicleOwner(vehicleData?.uploaded_by || null);

      // Get images with user info
      const { data, error } = await supabase
        .from('vehicle_images')
        .select(`
          id, image_url, is_primary, storage_path, created_at, taken_at,
          thumbnail_url, medium_url, large_url, exif_data, user_id,
          file_name, file_size, mime_type, variants
        `)
        .eq('vehicle_id', vehicleId)
        .order('taken_at', { ascending: false });

      if (error) throw error;
      setImages(data || []);
    } catch (error) {
      console.error('Failed to load images:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadImageComments = async (imageId: string) => {
    try {
      const { data, error } = await supabase
        .from('vehicle_image_comments')
        .select(`
          id, image_id, user_id, content, created_at
        `)
        .eq('image_id', imageId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      setImageComments(data || []);
    } catch (error) {
      console.error('Error loading image comments:', error);
      setImageComments([]);
    }
  };

  const loadImageUploader = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name')
        .eq('id', userId)
        .single();

      if (error) throw error;
      setImageUploader(data);
    } catch (error) {
      console.error('Error loading image uploader:', error);
      setImageUploader({
        id: userId,
        email: 'Unknown User'
      });
    }
  };

  const addComment = async () => {
    if (!selectedImage || !currentUser || !newComment.trim()) return;

    setAddingComment(true);
    try {
      // Add comment to vehicle_image_comments table
      const { data: comment, error: commentError } = await supabase
        .from('vehicle_image_comments')
        .insert({
          image_id: selectedImage.id,
          user_id: currentUser.id,
          content: newComment.trim()
        })
        .select()
        .single();

      if (commentError) throw commentError;

      // Also add to main vehicle comments for central tracking
      const { error: vehicleCommentError } = await supabase
        .from('vehicle_comments')
        .insert({
          vehicle_id: vehicleId,
          user_id: currentUser.id,
          content: `Image comment: ${newComment.trim()}`,
          metadata: {
            type: 'image_comment',
            image_id: selectedImage.id,
            original_comment_id: comment.id
          }
        });

      if (vehicleCommentError) {
        console.warn('Failed to add comment to vehicle feed:', vehicleCommentError);
      }

      // Reload comments
      await loadImageComments(selectedImage.id);
      setNewComment('');

      // Dispatch event to update main comment board
      window.dispatchEvent(new CustomEvent('vehicle_comments_updated', {
        detail: { vehicleId }
      } as any));

    } catch (error) {
      console.error('Error adding comment:', error);
      alert('Failed to add comment. Please try again.');
    } finally {
      setAddingComment(false);
    }
  };

  const openImage = async (image: ImageData) => {
    setSelectedImage(image);
    setZoomMode('fit');
    setShowInfoPanel(false);

    // Load additional data
    if (image.user_id) {
      loadImageUploader(image.user_id);
    }
    loadImageComments(image.id);
  };

  const closeImage = () => {
    setSelectedImage(null);
    setShowInfoPanel(false);
    setZoomMode('fit');
    setImageComments([]);
    setImageUploader(null);
    setNewComment('');
  };

  const toggleZoom = () => {
    setZoomMode(prev => prev === 'fit' ? 'full' : 'fit');
  };

  const toggleInfoPanel = () => {
    setShowInfoPanel(prev => !prev);
  };

  const navigateImage = (direction: 'prev' | 'next') => {
    if (!selectedImage) return;

    const currentIndex = images.findIndex(img => img.id === selectedImage.id);
    let newIndex;

    if (direction === 'prev') {
      newIndex = currentIndex > 0 ? currentIndex - 1 : images.length - 1;
    } else {
      newIndex = currentIndex < images.length - 1 ? currentIndex + 1 : 0;
    }

    openImage(images[newIndex]);
  };

  // Keyboard shortcuts
  useEffect(() => {
    if (!selectedImage) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeImage();
      if (e.key === 'ArrowLeft') navigateImage('prev');
      if (e.key === 'ArrowRight') navigateImage('next');
      if (e.key === 'i' || e.key === 'I') toggleInfoPanel();
      if (e.key === 'z' || e.key === 'Z') toggleZoom();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedImage, images]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getFullResolutionUrl = (image: ImageData) => {
    return image.variants?.full || image.image_url;
  };

  const getFitModeUrl = (image: ImageData) => {
    return image.large_url || image.image_url;
  };

  const canDeleteImage = (image: ImageData): boolean => {
    if (!currentUser) return false;
    return image.user_id === currentUser.id || vehicleOwner === currentUser.id;
  };

  if (loading) {
    return <div className="p-4 text-gray-600">Loading images...</div>;
  }

  return (
    <div>
      {/* Grid View */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {images.map((image) => (
          <div
            key={image.id}
            className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer group ${
              image.is_primary ? 'ring-4 ring-blue-500' : 'ring-1 ring-gray-200'
            }`}
            onClick={() => openImage(image)}
          >
            <LazyImage
              src={image.image_url}
              thumbnailUrl={image.thumbnail_url}
              mediumUrl={image.medium_url}
              largeUrl={image.large_url}
              alt=""
              size="thumbnail"
              className="w-full h-full object-cover"
            />

            {/* Overlay on hover */}
            <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all duration-200 flex items-center justify-center">
              <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <div className="text-white text-sm font-medium">View</div>
              </div>
            </div>

            {image.is_primary && (
              <div className="absolute top-2 left-2 bg-blue-500 text-white text-xs px-2 py-1 rounded">
                Primary
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Enhanced Modal */}
      {selectedImage && (
        <div className="fixed inset-0 bg-black bg-opacity-95 z-50" onClick={closeImage}>
          {/* Top controls bar - Always visible */}
          <div className="absolute top-0 left-0 right-0 z-20 p-4 flex justify-between items-center bg-gradient-to-b from-black to-transparent" onClick={(e) => e.stopPropagation()}>
            <div className="flex gap-2">
              <button
                onClick={toggleInfoPanel}
                className={`px-4 py-2 rounded text-sm font-medium transition-all ${
                  showInfoPanel
                    ? 'bg-blue-600 text-white'
                    : 'bg-black bg-opacity-50 text-white hover:bg-opacity-75'
                }`}
              >
                Info & Comments
              </button>

              <button
                onClick={toggleZoom}
                className="bg-black bg-opacity-50 hover:bg-opacity-75 text-white px-4 py-2 rounded text-sm font-medium transition-all"
              >
                {zoomMode === 'fit' ? '100%' : 'Fit'}
              </button>
            </div>

            <div className="flex items-center gap-4">
              <div className="bg-black bg-opacity-50 text-white px-3 py-1 rounded text-sm">
                {images.findIndex(img => img.id === selectedImage.id) + 1} of {images.length}
              </div>

              <button
                onClick={closeImage}
                className="bg-black bg-opacity-50 hover:bg-opacity-75 text-white p-2 rounded-full transition-all"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex h-full pt-20" onClick={(e) => e.stopPropagation()}>
            {/* Main Image Area */}
            <div className="flex-1 flex items-center justify-center relative">
              <div className={zoomMode === 'fit' ? 'max-w-full max-h-full flex items-center justify-center' : 'overflow-auto max-w-full max-h-full'}>
                <img
                  src={zoomMode === 'full' ? getFullResolutionUrl(selectedImage) : getFitModeUrl(selectedImage)}
                  alt=""
                  className={zoomMode === 'fit' ? 'max-w-full max-h-[calc(100vh-10rem)] object-contain cursor-pointer' : 'cursor-move'}
                  onClick={toggleZoom}
                />
              </div>

              {/* Navigation buttons */}
              {images.length > 1 && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigateImage('prev');
                    }}
                    className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-black bg-opacity-70 hover:bg-opacity-90 text-white p-3 rounded-full transition-all z-10"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigateImage('next');
                    }}
                    className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-black bg-opacity-70 hover:bg-opacity-90 text-white p-3 rounded-full transition-all z-10"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </>
              )}
            </div>

            {/* Info Panel */}
            {showInfoPanel && (
              <div className="w-96 bg-white h-full overflow-y-auto flex flex-col">
                <div className="p-6 border-b">
                  <h3 className="text-lg font-semibold mb-4">Image Details</h3>

                  {/* Basic Info */}
                  <div className="space-y-3 text-sm">
                    <div>
                      <span className="font-medium text-gray-600">Filename:</span>
                      <div className="text-gray-900">{selectedImage.file_name || 'Unknown'}</div>
                    </div>

                    {selectedImage.file_size && (
                      <div>
                        <span className="font-medium text-gray-600">Size:</span>
                        <div className="text-gray-900">{formatFileSize(selectedImage.file_size)}</div>
                      </div>
                    )}

                    <div>
                      <span className="font-medium text-gray-600">Uploaded:</span>
                      <div className="text-gray-900">
                        {selectedImage.created_at ? formatDate(selectedImage.created_at) : 'Unknown'}
                      </div>
                    </div>

                    {selectedImage.taken_at && selectedImage.taken_at !== selectedImage.created_at && (
                      <div>
                        <span className="font-medium text-gray-600">Photo taken:</span>
                        <div className="text-gray-900">{formatDate(selectedImage.taken_at)}</div>
                      </div>
                    )}

                    {imageUploader && (
                      <div>
                        <span className="font-medium text-gray-600">Uploaded by:</span>
                        <div className="text-gray-900">{imageUploader.full_name || imageUploader.email}</div>
                      </div>
                    )}
                  </div>

                  {/* EXIF Data */}
                  {selectedImage.exif_data && (
                    <div className="mt-6">
                      <h4 className="font-medium text-gray-900 mb-3">Camera Info</h4>
                      <div className="space-y-2 text-sm">
                        {selectedImage.exif_data.camera && (
                          <div>
                            <span className="font-medium text-gray-600">Camera:</span>
                            <div className="text-gray-900">{selectedImage.exif_data.camera}</div>
                          </div>
                        )}

                        {selectedImage.exif_data.technical && (
                          <div>
                            <span className="font-medium text-gray-600">Settings:</span>
                            <div className="text-gray-900 font-mono text-xs">
                              {selectedImage.exif_data.technical}
                            </div>
                          </div>
                        )}

                        {selectedImage.exif_data.dimensions && (
                          <div>
                            <span className="font-medium text-gray-600">Dimensions:</span>
                            <div className="text-gray-900">{selectedImage.exif_data.dimensions}</div>
                          </div>
                        )}

                        {selectedImage.exif_data.location && (
                          <div>
                            <span className="font-medium text-gray-600">Location:</span>
                            <div className="text-gray-900 font-mono text-xs">
                              {selectedImage.exif_data.location}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Comments Section */}
                <div className="flex-1 p-6 flex flex-col">
                  <h4 className="font-medium text-gray-900 mb-4">
                    Comments ({imageComments.length})
                  </h4>

                  {/* Comment List */}
                  <div className="space-y-4 mb-6 flex-1 overflow-y-auto">
                    {imageComments.length === 0 ? (
                      <p className="text-gray-500 text-sm">No comments yet.</p>
                    ) : (
                      imageComments.map((comment) => (
                        <div key={comment.id} className="bg-gray-50 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-sm text-gray-900">
                              {comment.user_id ? `User: ${comment.user_id.substring(0, 8)}...` : 'Anonymous'}
                            </span>
                            <span className="text-xs text-gray-500">
                              {formatDate(comment.created_at)}
                            </span>
                          </div>
                          <p className="text-gray-700 text-sm">{comment.content}</p>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Add Comment */}
                  {currentUser && (
                    <div className="border-t pt-4">
                      <textarea
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        placeholder="Add a comment..."
                        className="w-full p-3 border rounded-lg resize-none text-sm"
                        rows={3}
                      />
                      <button
                        onClick={addComment}
                        disabled={!newComment.trim() || addingComment}
                        className="mt-2 w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white py-2 px-4 rounded-lg text-sm font-medium transition-colors"
                      >
                        {addingComment ? 'Adding...' : 'Add Comment'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default EnhancedImageViewer;