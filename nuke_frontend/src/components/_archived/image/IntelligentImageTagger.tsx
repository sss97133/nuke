import React, { useState, useEffect, Component, ErrorInfo } from 'react';
import ReactImageAnnotate from '@visionware/react-image-annotate';
import { supabase } from '../../lib/supabase';

// Error Boundary for catching annotation library errors
class AnnotationErrorBoundary extends Component<
  { children: React.ReactNode; onError?: () => void },
  { hasError: boolean; error?: Error }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Annotation library error:', error, errorInfo);
    this.props.onError?.();
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: '#0a0a0a',
          color: '#ffffff',
          flexDirection: 'column',
          gap: '16px',
          padding: '24px'
        }}>
          <div style={{ fontSize: '18px', fontWeight: 'bold' }}>
            Annotation Tool Error
          </div>
          <div style={{ fontSize: '14px', color: '#888', textAlign: 'center', maxWidth: '500px' }}>
            The image annotation library encountered an error. This feature is temporarily unavailable.
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '12px 24px',
              background: '#2196f3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

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
        .eq('image_id', imageId);

      if (error) throw error;

      if (data) {
        // Convert database tags to react-image-annotate format
        const convertedRegions = data.map((tag) => ({
          id: tag.id,
          cls: tag.tag_type || 'part',
          comment: tag.tag_text || tag.tag_name || 'Untitled',
          tags: [tag.tag_text || tag.tag_name || 'Untitled'],
          type: 'box',
          x: tag.x_position ? tag.x_position / 100 : 0, // Convert from integer (0-10000) to decimal
          y: tag.y_position ? tag.y_position / 100 : 0,
          w: 0.02, // Default small width (not stored in schema)
          h: 0.02  // Default small height (not stored in schema)
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
          image_id: imageId,
          tag_text: newRegion.comment || newRegion.tags?.[0] || 'Untitled',
          tag_type: newRegion.cls || 'part',
          x_position: Math.round((newRegion.x || 0) * 100), // Convert to integer (0-10000)
          y_position: Math.round((newRegion.y || 0) * 100)
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
            tag_text: updatedRegion.comment || updatedRegion.tags?.[0] || 'Untitled',
            tag_type: updatedRegion.cls || 'part',
            x_position: Math.round((updatedRegion.x || 0) * 100),
            y_position: Math.round((updatedRegion.y || 0) * 100)
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
    <AnnotationErrorBoundary onError={onClose}>
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
        />
      </div>
    </AnnotationErrorBoundary>
  );
};

export default IntelligentImageTagger;

