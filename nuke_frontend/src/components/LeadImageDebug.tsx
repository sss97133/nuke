import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface LeadImageDebugProps {
  vehicleId: string;
}

interface ImageDebugInfo {
  id: string;
  image_url: string;
  is_primary: boolean;
  filename?: string;
  created_at: string;
  storage_path?: string;
}

const LeadImageDebug: React.FC<LeadImageDebugProps> = ({ vehicleId }) => {
  const [images, setImages] = useState<ImageDebugInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const loadImageDebugInfo = async () => {
    if (!vehicleId) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('vehicle_images')
        .select('id, image_url, is_primary, filename, created_at, storage_path')
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setImages(data || []);
    } catch (error) {
      console.error('Failed to load image debug info:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadImageDebugInfo();
  }, [vehicleId]);

  const fixLeadImage = async (imageId: string) => {
    try {
      // Clear all primary flags
      await supabase
        .from('vehicle_images')
        .update({ is_primary: false })
        .eq('vehicle_id', vehicleId);

      // Set this one as primary
      await supabase
        .from('vehicle_images')
        .update({ is_primary: true })
        .eq('id', imageId);

      // Refresh data
      await loadImageDebugInfo();
      
      // Emit events to refresh other components
      window.dispatchEvent(new CustomEvent('lead_image_updated', { 
        detail: { vehicleId } 
      } as any));
      window.dispatchEvent(new CustomEvent('vehicle_images_updated', { 
        detail: { vehicleId } 
      } as any));

      alert('Lead image updated successfully!');
    } catch (error) {
      console.error('Failed to fix lead image:', error);
      alert('Failed to update lead image');
    }
  };

  const primaryImages = images.filter(img => img.is_primary);
  const nonPrimaryImages = images.filter(img => !img.is_primary);

  if (!isExpanded) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4">
        <div className="flex items-center justify-between">
          <div className="text-sm">
            <span className="font-medium">Lead Image Status:</span>
            {loading ? (
              <span className="text-gray-500 ml-2">Loading...</span>
            ) : (
              <>
                <span className={`ml-2 ${primaryImages.length === 1 ? 'text-green-600' : 'text-red-600'}`}>
                  {primaryImages.length === 1 ? '✅ OK' : `❌ ${primaryImages.length} primary images`}
                </span>
                <span className="text-gray-500 ml-2">({images.length} total images)</span>
              </>
            )}
          </div>
          <button
            onClick={() => setIsExpanded(true)}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Debug
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-medium">Lead Image Debug</h4>
        <div className="flex gap-2">
          <button
            onClick={loadImageDebugInfo}
            disabled={loading}
            className="text-sm px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button
            onClick={() => setIsExpanded(false)}
            className="text-sm text-gray-600 hover:text-gray-800"
          >
            Hide
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {/* Summary */}
        <div className="text-sm">
          <div className={`font-medium ${primaryImages.length === 1 ? 'text-green-600' : 'text-red-600'}`}>
            Status: {primaryImages.length === 1 ? 'OK - One primary image' : `ERROR - ${primaryImages.length} primary images`}
          </div>
          <div className="text-gray-600">
            Total images: {images.length} | Primary: {primaryImages.length} | Non-primary: {nonPrimaryImages.length}
          </div>
        </div>

        {/* Primary Images */}
        {primaryImages.length > 0 && (
          <div>
            <div className="font-medium text-sm mb-2">Primary Images ({primaryImages.length}):</div>
            <div className="space-y-2">
              {primaryImages.map(image => (
                <div key={image.id} className="bg-green-50 border border-green-200 rounded p-2">
                  <div className="flex items-center gap-3">
                    <img 
                      src={image.image_url} 
                      alt="" 
                      className="w-12 h-12 object-cover rounded"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                    <div className="flex-1 text-xs">
                      <div className="font-medium">ID: {image.id.slice(0, 8)}...</div>
                      <div className="text-gray-600">File: {image.filename || 'Unknown'}</div>
                      <div className="text-gray-600">Created: {new Date(image.created_at).toLocaleDateString()}</div>
                      <div className="text-green-600 font-medium">✅ PRIMARY</div>
                    </div>
                    <div className="text-xs">
                      <a 
                        href={image.image_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        View
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Non-Primary Images */}
        {nonPrimaryImages.length > 0 && (
          <div>
            <div className="font-medium text-sm mb-2">Non-Primary Images ({nonPrimaryImages.length}):</div>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {nonPrimaryImages.slice(0, 5).map(image => (
                <div key={image.id} className="bg-gray-50 border border-gray-200 rounded p-2">
                  <div className="flex items-center gap-3">
                    <img 
                      src={image.image_url} 
                      alt="" 
                      className="w-10 h-10 object-cover rounded"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                    <div className="flex-1 text-xs">
                      <div className="font-medium">ID: {image.id.slice(0, 8)}...</div>
                      <div className="text-gray-600">File: {image.filename || 'Unknown'}</div>
                    </div>
                    <button
                      onClick={() => fixLeadImage(image.id)}
                      className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      Make Lead
                    </button>
                  </div>
                </div>
              ))}
              {nonPrimaryImages.length > 5 && (
                <div className="text-xs text-gray-500 text-center">
                  ... and {nonPrimaryImages.length - 5} more images
                </div>
              )}
            </div>
          </div>
        )}

        {/* No Images */}
        {images.length === 0 && (
          <div className="text-sm text-gray-500 text-center py-4">
            No images found for this vehicle
          </div>
        )}

        {/* Quick Fixes */}
        {primaryImages.length !== 1 && images.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded p-3">
            <div className="font-medium text-sm text-red-800 mb-2">Quick Fixes:</div>
            <div className="space-y-2">
              {primaryImages.length === 0 && (
                <button
                  onClick={() => fixLeadImage(images[0].id)}
                  className="text-sm px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                >
                  Set First Image as Lead
                </button>
              )}
              {primaryImages.length > 1 && (
                <button
                  onClick={() => fixLeadImage(primaryImages[0].id)}
                  className="text-sm px-3 py-1 bg-yellow-600 text-white rounded hover:bg-yellow-700"
                >
                  Keep Only First Primary
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LeadImageDebug;
