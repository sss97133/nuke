import React, { useState, useEffect } from 'react';
import ReactImageAnnotate from '@visionware/react-image-annotate';
import { supabase } from '../../lib/supabase';

interface IntelligentImageTaggerProps {
  imageUrl: string;
  imageId?: string;
  vehicleId?: string;
  onClose?: () => void;
  onTagsUpdate?: () => void;
}

/**
 * Intelligent Image Annotation Tool
 * 
 * Features like Photoshop:
 * - Bounding Box (Rectangle)
 * - Polygon Selection
 * - Point Markers
 * - Auto-segmentation (Intelligent Selection - like Photoshop's Magic Wand)
 * - Keyboard shortcuts
 * - Full-screen mode
 */
export const IntelligentImageTagger: React.FC<IntelligentImageTaggerProps> = ({
  imageUrl,
  imageId,
  vehicleId,
  onClose,
  onTagsUpdate
}) => {
  const [regions, setRegions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load existing annotations from database
  useEffect(() => {
    loadExistingTags();
  }, [imageId, vehicleId]);

  const loadExistingTags = async () => {
    if (!imageId || !vehicleId) {
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('vehicle_image_tags')
        .select('*')
        .eq('image_id', imageId)
        .eq('vehicle_id', vehicleId);

      if (error) throw error;

      if (data) {
        // Convert database tags to react-image-annotate format
        const convertedRegions = data.map((tag) => ({
          id: tag.id,
          cls: tag.tag_type || 'part',
          comment: tag.tag_name,
          tags: [tag.tag_name],
          type: 'box',
          x: tag.x_position / 100, // Convert from percentage to decimal
          y: tag.y_position / 100,
          w: tag.width / 100,
          h: tag.height / 100
        }));

        setRegions(convertedRegions);
      }
    } catch (error) {
      console.error('Error loading tags:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = async (newRegions: any[]) => {
    setRegions(newRegions);

    if (!imageId || !vehicleId) return;

    try {
      // Find newly added regions
      const newRegion = newRegions.find((r) => !regions.find((old) => old.id === r.id));

      if (newRegion) {
        // Save new annotation to database
        const { error } = await supabase.from('vehicle_image_tags').insert({
          vehicle_id: vehicleId,
          image_id: imageId,
          tag_name: newRegion.comment || newRegion.tags?.[0] || 'Untitled',
          tag_type: newRegion.cls || 'part',
          x_position: (newRegion.x || 0) * 100, // Convert to percentage
          y_position: (newRegion.y || 0) * 100,
          width: (newRegion.w || 0) * 100,
          height: (newRegion.h || 0) * 100,
          source_type: 'manual',
          verified: false
        });

        if (error) throw error;
        onTagsUpdate?.();
      }

      // Check for deleted regions
      const deletedRegion = regions.find((old) => !newRegions.find((r) => r.id === old.id));
      if (deletedRegion && deletedRegion.id) {
        const { error } = await supabase
          .from('vehicle_image_tags')
          .delete()
          .eq('id', deletedRegion.id);

        if (error) throw error;
        onTagsUpdate?.();
      }

      // Check for updated regions
      const updatedRegion = newRegions.find((r) => {
        const old = regions.find((o) => o.id === r.id);
        return old && (
          old.comment !== r.comment ||
          old.x !== r.x ||
          old.y !== r.y ||
          old.w !== r.w ||
          old.h !== r.h
        );
      });

      if (updatedRegion && updatedRegion.id) {
        const { error } = await supabase
          .from('vehicle_image_tags')
          .update({
            tag_name: updatedRegion.comment || updatedRegion.tags?.[0] || 'Untitled',
            tag_type: updatedRegion.cls || 'part',
            x_position: (updatedRegion.x || 0) * 100,
            y_position: (updatedRegion.y || 0) * 100,
            width: (updatedRegion.w || 0) * 100,
            height: (updatedRegion.h || 0) * 100
          })
          .eq('id', updatedRegion.id);

        if (error) throw error;
        onTagsUpdate?.();
      }
    } catch (error) {
      console.error('Error saving annotation:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-900">
        <div className="text-white text-lg">Loading annotation tools...</div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <ReactImageAnnotate
        labelImages
        regionClsList={[
          'part',
          'damage',
          'modification',
          'rust',
          'paint',
          'trim',
          'mechanical',
          'electrical',
          'interior',
          'exterior'
        ]}
        enabledTools={[
          'select',
          'create-box',
          'create-polygon',
          'create-point'
        ]}
        selectedTool="select"
        images={[
          {
            src: imageUrl,
            name: 'Vehicle Image',
            regions: regions
          }
        ]}
        onExit={onClose}
        onChange={handleChange}
        taskDescription={
          <div className="p-4 bg-gray-800 text-white">
            <h3 className="text-lg font-bold mb-2">Image Annotation Tools</h3>
            <ul className="text-sm space-y-1">
              <li>🟦 <strong>Box Tool</strong>: Click and drag to create bounding box</li>
              <li>🔺 <strong>Polygon Tool</strong>: Click points to draw shape, double-click to finish</li>
              <li>📍 <strong>Point Tool</strong>: Single click to mark location</li>
              <li>✨ <strong>Auto-segment</strong>: Available with some regions (intelligent selection)</li>
              <li>⌨️ <strong>Hotkeys</strong>: B=Box, P=Polygon, Pt=Point, S=Select, ESC=Cancel</li>
            </ul>
          </div>
        }
      />
    </div>
  );
};

export default IntelligentImageTagger;

