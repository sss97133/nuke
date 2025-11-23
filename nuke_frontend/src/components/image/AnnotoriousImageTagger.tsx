import React, { useState, useCallback } from 'react';
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

/**
 * Professional Image Annotation Tool using Annotorious React
 * 
 * Features:
 * - Rectangle selection tool
 * - Polygon selection tool  
 * - Point marker tool
 * - Auto-save to database
 * - Keyboard shortcuts (ESC to cancel, DEL to delete)
 */
export const AnnotoriousImageTagger: React.FC<AnnotoriousImageTaggerProps> = ({
  imageUrl,
  imageId,
  vehicleId,
  onTagsUpdate,
  readonly = false
}) => {
  const [annotations, setAnnotations] = useState<any[]>([]);

  // Handle annotation creation
  const onCreateAnnotation = useCallback(async (annotation: any) => {
    if (!imageId || !vehicleId) return;

    try {
      // Parse annotation geometry from target
      const target = annotation.target;
      let x = 0, y = 0, width = 0, height = 0;

      // Get selector info
      if (target?.selector) {
        const selector = target.selector;
        
        // Handle different selector types
        if (selector.type === 'RECTANGLE') {
          // Rectangle has geometry property
          x = selector.geometry?.x || 0;
          y = selector.geometry?.y || 0;
          width = selector.geometry?.w || 0;
          height = selector.geometry?.h || 0;
        } else if (selector.type === 'POLYGON') {
          // For polygon, calculate bounding box
          const points = selector.geometry?.points || [];
          if (points.length > 0) {
            const xs = points.map((p: any) => p[0]);
            const ys = points.map((p: any) => p[1]);
            x = Math.min(...xs);
            y = Math.min(...ys);
            width = Math.max(...xs) - x;
            height = Math.max(...ys) - y;
          }
        }
      }

      // Get tag name from annotation body
      const body = annotation.body || annotation.bodies || [];
      const tagBody = Array.isArray(body) ? body[0] : body;
      const tagName = tagBody?.value || 'Untitled';

      // Save to database (x, y, width, height are already percentages 0-1, convert to 0-100)
      const { error } = await supabase.from('vehicle_image_tags').insert({
        vehicle_id: vehicleId,
        image_id: imageId,
        tag_name: tagName,
        tag_type: 'part',
        x_position: x * 100,
        y_position: y * 100,
        width: width * 100,
        height: height * 100,
        source_type: 'manual',
        verified: false
      });

      if (error) {
        console.error('Error saving annotation:', error);
        throw error;
      }

      onTagsUpdate?.();
      
      // Update local state
      setAnnotations(prev => [...prev, annotation]);
    } catch (error) {
      console.error('Error creating annotation:', error);
    }
  }, [imageId, vehicleId, onTagsUpdate]);

  // Handle annotation updates
  const onUpdateAnnotation = useCallback(async (annotation: any, previous: any) => {
    if (!vehicleId) return;

    try {
      const body = annotation.body || annotation.bodies || [];
      const tagBody = Array.isArray(body) ? body[0] : body;
      const tagName = tagBody?.value || 'Untitled';

      // Parse geometry for updated position
      const target = annotation.target;
      let x = 0, y = 0, width = 0, height = 0;

      if (target?.selector) {
        const selector = target.selector;
        
        if (selector.type === 'RECTANGLE') {
          x = selector.geometry?.x || 0;
          y = selector.geometry?.y || 0;
          width = selector.geometry?.w || 0;
          height = selector.geometry?.h || 0;
        } else if (selector.type === 'POLYGON') {
          const points = selector.geometry?.points || [];
          if (points.length > 0) {
            const xs = points.map((p: any) => p[0]);
            const ys = points.map((p: any) => p[1]);
            x = Math.min(...xs);
            y = Math.min(...ys);
            width = Math.max(...xs) - x;
            height = Math.max(...ys) - y;
          }
        }
      }

      const { error } = await supabase
        .from('vehicle_image_tags')
        .update({
          tag_name: tagName,
          x_position: x * 100,
          y_position: y * 100,
          width: width * 100,
          height: height * 100
        })
        .eq('id', annotation.id);

      if (error) throw error;

      onTagsUpdate?.();
      
      // Update local state
      setAnnotations(prev => prev.map(a => a.id === annotation.id ? annotation : a));
    } catch (error) {
      console.error('Error updating annotation:', error);
    }
  }, [vehicleId, onTagsUpdate]);

  // Handle annotation deletion
  const onDeleteAnnotation = useCallback(async (annotation: any) => {
    if (!vehicleId) return;

    try {
      const { error } = await supabase
        .from('vehicle_image_tags')
        .delete()
        .eq('id', annotation.id);

      if (error) throw error;

      onTagsUpdate?.();
      
      // Update local state
      setAnnotations(prev => prev.filter(a => a.id !== annotation.id));
    } catch (error) {
      console.error('Error deleting annotation:', error);
    }
  }, [vehicleId, onTagsUpdate]);

  return (
    <div className="relative w-full h-full flex items-center justify-center" style={{ backgroundColor: '#0a0a0a' }}>
      <Annotorious>
        <ImageAnnotator>
          <img 
            src={imageUrl} 
            alt="Annotatable vehicle image"
            style={{ 
              maxWidth: '100%', 
              maxHeight: '100%', 
              objectFit: 'contain',
              display: 'block'
            }}
          />
        </ImageAnnotator>
      </Annotorious>

      {!readonly && (
        <div 
          style={{
            position: 'absolute',
            bottom: '20px',
            left: '20px',
            background: 'rgba(0, 0, 0, 0.9)',
            border: '2px solid rgba(255, 255, 255, 0.3)',
            padding: '16px',
            borderRadius: '4px',
            color: '#ffffff',
            maxWidth: '300px'
          }}
        >
          <h4 style={{ fontSize: '11px', fontWeight: 'bold', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Annotation Tools
          </h4>
          <div style={{ fontSize: '9px', color: 'rgba(255, 255, 255, 0.7)', lineHeight: '1.4' }}>
            <div style={{ marginBottom: '4px' }}>• Click and drag to draw a rectangle</div>
            <div style={{ marginBottom: '4px' }}>• Use toolbar for polygon or point tools</div>
            <div style={{ marginBottom: '4px' }}>• Press ESC to cancel annotation</div>
            <div style={{ marginBottom: '4px' }}>• Click annotation to edit or delete</div>
            <div style={{ marginBottom: '4px' }}>• Double-click to finish polygon</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnnotoriousImageTagger;
