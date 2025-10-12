import React from 'react';
import type { ImageData } from './useImageViewerState';

interface ImageGridProps {
  images: ImageData[];
  editMode: boolean;
  selectedImages: Set<string>;
  workingIds: Record<string, boolean>;
  draggedIndex: number | null;
  onImageClick: (image: ImageData, index: number) => void;
  onImageSelect: (imageId: string, selected: boolean) => void;
  onSetAsLead: (image: ImageData) => Promise<void>;
  onEditTags: (image: ImageData) => void;
  onMarkSensitive: (image: ImageData) => Promise<void>;
  onMarkNotSensitive: (image: ImageData) => Promise<void>;
  onDragStart: (index: number) => void;
  onDragEnd: () => void;
}

// Helper function to check if string is UUID format
const isUuid = (str: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};

export const ImageGrid: React.FC<ImageGridProps> = ({
  images,
  editMode,
  selectedImages,
  workingIds,
  draggedIndex,
  onImageClick,
  onImageSelect,
  onSetAsLead,
  onEditTags,
  onMarkSensitive,
  onMarkNotSensitive,
  onDragStart,
  onDragEnd
}) => {
  if (images.length === 0) {
    return (
      <div className="text-center text-gray-500 py-12">
        <div className="text-lg mb-2">No images found</div>
        <div className="text-sm">Upload some images to get started</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {images.map((image, index) => (
        <div
          key={image.id}
          className={`relative group cursor-pointer transition-all duration-200 ${
            draggedIndex === index ? 'opacity-50 scale-95' : ''
          }`}
          style={{ aspectRatio: '4/3', borderRadius: 'var(--radius)', overflow: 'hidden' }}
          draggable
          onDragStart={() => onDragStart(index)}
          onDragEnd={onDragEnd}
          onClick={() => !editMode && onImageClick(image, index)}
        >
          {/* Selection checkbox for edit mode */}
          {editMode && isUuid(image.id) && (
            <div className="absolute top-2 left-2 z-20">
              <input
                type="checkbox"
                checked={selectedImages.has(image.id)}
                onChange={(e) => {
                  e.stopPropagation();
                  onImageSelect(image.id, e.target.checked);
                }}
                className="w-5 h-5 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
              />
            </div>
          )}

          {/* Primary badge */}
          {image.is_primary && (
            <div className="absolute top-2 right-2 bg-green-500 text-white text-xs px-2 py-1 rounded z-10">
              Primary
            </div>
          )}

          {/* Sensitive content badge */}
          {image.is_sensitive && (
            <div className="absolute top-2 left-2 bg-red-500 text-white text-xs px-2 py-1 rounded z-10 flex items-center gap-1">
              <span>🔒</span>
              <span>Sensitive</span>
            </div>
          )}

          {/* Working state overlay */}
          {workingIds[image.id] && (
            <div className="absolute inset-0 bg-black bg-opacity-40 flex items-center justify-center z-15">
              <div className="bg-white rounded px-3 py-1.5 text-sm font-medium">
                Working...
              </div>
            </div>
          )}

          {/* Image */}
          <img
            src={image.image_url}
            alt=""
            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
            loading="lazy"
          />

          {/* Hover controls (only show when not in edit mode) */}
          {isUuid(image.id) && !editMode && (
            <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100" style={{ zIndex: 15 }}>
              <div className="flex gap-2">
                <button
                  className="bg-white text-black px-3 py-1.5 rounded text-sm font-medium hover:bg-gray-100 transition-colors shadow-sm"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!image.is_primary && !workingIds[image.id]) {
                      await onSetAsLead(image);
                    }
                  }}
                  disabled={!!workingIds[image.id] || image.is_primary}
                  title={image.is_primary ? "Already lead image" : "Set as lead image"}
                >
                  {workingIds[image.id] ? "..." : image.is_primary ? "Lead" : "Make Lead"}
                </button>
                <button
                  className="bg-white text-black px-3 py-1.5 rounded text-sm font-medium hover:bg-gray-100 transition-colors shadow-sm"
                  onClick={(e) => { e.stopPropagation(); onEditTags(image); }}
                  title="Edit Tags"
                >
                  Edit Tags
                </button>
              </div>
            </div>
          )}

          {/* Secondary actions menu (bottom-right) */}
          {isUuid(image.id) && !editMode && (
            <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity" style={{ zIndex: 16 }}>
              <div className="bg-white rounded shadow-lg border p-1 flex gap-1">
                {!image.is_sensitive ? (
                  <button
                    className="text-xs px-2 py-1 hover:bg-gray-100 rounded"
                    disabled={!!workingIds[image.id]}
                    onClick={(e) => { e.stopPropagation(); onMarkSensitive(image); }}
                    title="Mark as Sensitive"
                  >
                    🔒
                  </button>
                ) : (
                  <button
                    className="text-xs px-2 py-1 hover:bg-gray-100 rounded"
                    disabled={!!workingIds[image.id]}
                    onClick={(e) => { e.stopPropagation(); onMarkNotSensitive(image); }}
                    title="Make Public"
                  >
                    🔓
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};