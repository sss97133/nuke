import React, { useEffect, useRef, useState } from 'react';
import { Annotorious, ImageAnnotator } from '@annotorious/react';
import '@annotorious/react/annotorious-react.css';
import { supabase } from '../../lib/supabase';

interface AnnotoriousImageTaggerProps {
  imageUrl: string;
  imageId?: string;
  vehicleId?: string;
  onTagsUpdate?: () => void;
  readonly?: boolean;
}

interface Annotation {
  id: string;
  target: {
    selector: {
      type: string;
      value?: string;
      x?: number;
      y?: number;
      w?: number;
      h?: number;
    };
  };
  body: Array<{
    type: string;
    value: string;
    purpose: string;
  }>;
}

/**
 * Professional Image Annotation Tool using Annotorious
 * 
 * Features:
 * - Rectangle selection tool
 * - Polygon selection tool  
 * - Point marker tool
 * - Freehand drawing tool
 * - Keyboard shortcuts
 * - Auto-save to database
 */
export const AnnotoriousImageTagger: React.FC<AnnotoriousImageTaggerProps> = ({
  imageUrl,
  imageId,
  vehicleId,
  onTagsUpdate,
  readonly = false
}) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const annoRef = useRef<ImageAnnotator | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  // Initialize Annotorious
  useEffect(() => {
    if (imgRef.current && !annoRef.current) {
      import('@annotorious/annotorious').then((Annotorious) => {
        const anno = new Annotorious.default(imgRef.current!, {
          readOnly: readonly,
          drawOnSingleClick: true,
          allowEmpty: false,
          widgets: [
            {
              widget: 'COMMENT',
              force: true
            },
            'TAG'
          ]
        });

        annoRef.current = anno as any;

        // Load existing annotations
        loadAnnotations();

        // Listen for new annotations
        anno.on('createAnnotation', handleCreateAnnotation);
        anno.on('updateAnnotation', handleUpdateAnnotation);
        anno.on('deleteAnnotation', handleDeleteAnnotation);

        setIsLoading(false);
      });
    }

    return () => {
      if (annoRef.current) {
        annoRef.current.destroy();
        annoRef.current = null;
      }
    };
  }, [imageUrl, readonly]);

  const loadAnnotations = async () => {
    if (!imageId || !vehicleId) return;

    try {
      const { data, error } = await supabase
        .from('vehicle_image_tags')
        .select('*')
        .eq('image_id', imageId)
        .eq('vehicle_id', vehicleId);

      if (error) throw error;

      if (data && annoRef.current) {
        // Convert database tags to Annotorious format
        const annos = data.map((tag) => ({
          '@context': 'http://www.w3.org/ns/anno.jsonld',
          id: tag.id,
          type: 'Annotation',
          body: [
            {
              type: 'TextualBody',
              value: tag.tag_name,
              purpose: 'tagging'
            }
          ],
          target: {
            selector: {
              type: 'FragmentSelector',
              conformsTo: 'http://www.w3.org/TR/media-frags/',
              value: `xywh=pixel:${tag.x_position},${tag.y_position},${tag.width},${tag.height}`
            }
          }
        }));

        annoRef.current.setAnnotations(annos);
        setAnnotations(annos);
      }
    } catch (error) {
      console.error('Error loading annotations:', error);
    }
  };

  const handleCreateAnnotation = async (annotation: Annotation) => {
    if (!imageId || !vehicleId) return;

    try {
      // Parse annotation geometry
      const selector = annotation.target.selector;
      let x = 0, y = 0, width = 0, height = 0;

      if (selector.type === 'FragmentSelector' && selector.value) {
        // Parse xywh=pixel:x,y,w,h
        const match = selector.value.match(/xywh=pixel:(\d+),(\d+),(\d+),(\d+)/);
        if (match) {
          x = parseFloat(match[1]);
          y = parseFloat(match[2]);
          width = parseFloat(match[3]);
          height = parseFloat(match[4]);
        }
      }

      // Get tag name from annotation body
      const tagName = annotation.body?.find((b) => b.purpose === 'tagging' || b.purpose === 'commenting')?.value || 'Untitled';

      // Convert pixel coordinates to percentages
      const img = imgRef.current;
      if (img) {
        x = (x / img.naturalWidth) * 100;
        y = (y / img.naturalHeight) * 100;
        width = (width / img.naturalWidth) * 100;
        height = (height / img.naturalHeight) * 100;
      }

      // Save to database
      const { error } = await supabase.from('vehicle_image_tags').insert({
        vehicle_id: vehicleId,
        image_id: imageId,
        tag_name: tagName,
        tag_type: 'part',
        x_position: x,
        y_position: y,
        width: width,
        height: height,
        source_type: 'manual',
        verified: false
      });

      if (error) throw error;

      onTagsUpdate?.();
    } catch (error) {
      console.error('Error saving annotation:', error);
    }
  };

  const handleUpdateAnnotation = async (annotation: Annotation) => {
    if (!imageId || !vehicleId) return;

    try {
      const selector = annotation.target.selector;
      let x = 0, y = 0, width = 0, height = 0;

      if (selector.type === 'FragmentSelector' && selector.value) {
        const match = selector.value.match(/xywh=pixel:(\d+),(\d+),(\d+),(\d+)/);
        if (match) {
          x = parseFloat(match[1]);
          y = parseFloat(match[2]);
          width = parseFloat(match[3]);
          height = parseFloat(match[4]);
        }
      }

      const tagName = annotation.body?.find((b) => b.purpose === 'tagging' || b.purpose === 'commenting')?.value || 'Untitled';

      const img = imgRef.current;
      if (img) {
        x = (x / img.naturalWidth) * 100;
        y = (y / img.naturalHeight) * 100;
        width = (width / img.naturalWidth) * 100;
        height = (height / img.naturalHeight) * 100;
      }

      const { error } = await supabase
        .from('vehicle_image_tags')
        .update({
          tag_name: tagName,
          x_position: x,
          y_position: y,
          width: width,
          height: height
        })
        .eq('id', annotation.id);

      if (error) throw error;

      onTagsUpdate?.();
    } catch (error) {
      console.error('Error updating annotation:', error);
    }
  };

  const handleDeleteAnnotation = async (annotation: Annotation) => {
    if (!vehicleId) return;

    try {
      const { error } = await supabase
        .from('vehicle_image_tags')
        .delete()
        .eq('id', annotation.id);

      if (error) throw error;

      onTagsUpdate?.();
    } catch (error) {
      console.error('Error deleting annotation:', error);
    }
  };

  return (
    <div className="relative w-full h-full">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
          <div className="text-white">Loading annotation tools...</div>
        </div>
      )}
      
      <img
        ref={imgRef}
        src={imageUrl}
        alt="Annotatable content"
        className="w-full h-auto"
        style={{ maxWidth: '100%', height: 'auto' }}
      />

      {!readonly && (
        <div className="mt-4 p-3 bg-gray-100 rounded border border-gray-300">
          <h4 className="text-sm font-bold text-gray-800 mb-2">Annotation Tools</h4>
          <div className="text-xs text-gray-600 space-y-1">
            <div>• Click and drag to draw a rectangle</div>
            <div>• Click multiple points to create a polygon (double-click to finish)</div>
            <div>• Single click to place a point marker</div>
            <div>• Press ESC to cancel current annotation</div>
            <div>• Click on any annotation to edit or delete</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnnotoriousImageTagger;

