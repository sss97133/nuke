import { useState, useCallback } from 'react';

export interface EnhancedSpatialTag {
  id: string;
  x: number;
  y: number;
  text: string;
  type: 'product' | 'damage' | 'location' | 'modification' | 'brand' | 'part' | 'tool' | 'fluid';
  isEditing?: boolean;
  created_by?: string;
  created_at?: string;
  // Enhanced fields from your SpatialTag backend
  severity_level?: 'minor' | 'moderate' | 'severe' | 'critical';
  estimated_cost_cents?: number;
  service_status?: 'needed' | 'quoted' | 'approved' | 'in_progress' | 'completed' | 'failed';
  product_name?: string;
  service_name?: string;
  technician_name?: string;
  shop_name?: string;
  automated_confidence?: number;
  source_type?: 'manual' | 'ai_detected' | 'exif' | 'imported';
  needs_human_verification?: boolean;
  trust_score?: number;
  verification_status?: string;
  metadata?: any;
}

export interface AIAnalysisResult {
  success: boolean;
  tags?: EnhancedSpatialTag[];
  summary?: string;
  confidence_score?: number;
  key_findings?: string[];
  recommendations?: string[];
  error?: string;
}

export const useEnhancedTagging = (imageId?: string, vehicleId?: string) => {
  const [tags, setTags] = useState<EnhancedSpatialTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing tags from your backend
  const loadTags = useCallback(async () => {
    if (!imageId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/images/${imageId}/spatial-tags`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setTags(data.tags || []);
      } else {
        throw new Error('Failed to load tags');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [imageId]);

  // Create a new tag
  const createTag = useCallback(async (tagData: Partial<EnhancedSpatialTag>) => {
    if (!imageId) return { success: false, error: 'No image ID provided' };

    try {
      const response = await fetch('/api/spatial-tags', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          image_id: imageId,
          x_position: tagData.x,
          y_position: tagData.y,
          tag_type: tagData.type,
          text: tagData.text,
          severity_level: tagData.severity_level,
          estimated_cost_cents: tagData.estimated_cost_cents,
          source_type: 'manual'
        })
      });

      if (response.ok) {
        const newTag = await response.json();
        setTags(prev => [...prev, newTag]);
        return { success: true, tag: newTag };
      } else {
        throw new Error('Failed to create tag');
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }, [imageId]);

  // Update an existing tag
  const updateTag = useCallback(async (tagId: string, updates: Partial<EnhancedSpatialTag>) => {
    try {
      const response = await fetch(`/api/spatial-tags/${tagId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify(updates)
      });

      if (response.ok) {
        const updatedTag = await response.json();
        setTags(prev => prev.map(tag =>
          tag.id === tagId ? { ...tag, ...updatedTag } : tag
        ));
        return { success: true, tag: updatedTag };
      } else {
        throw new Error('Failed to update tag');
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }, []);

  // Delete a tag
  const deleteTag = useCallback(async (tagId: string) => {
    try {
      const response = await fetch(`/api/spatial-tags/${tagId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      if (response.ok) {
        setTags(prev => prev.filter(tag => tag.id !== tagId));
        return { success: true };
      } else {
        throw new Error('Failed to delete tag');
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }, []);

  // Run AI analysis using AWS Rekognition/Textract
  const runAIAnalysis = useCallback(async (analysisType: 'rekognition' | 'textract' = 'rekognition'): Promise<AIAnalysisResult> => {
    if (!imageId || !vehicleId) {
      return { success: false, error: 'Missing image or vehicle ID' };
    }

    setAnalyzing(true);
    setError(null);

    try {
      // Create analysis request
      const response = await fetch('/api/skynalysis/analyses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          processor_name: analysisType === 'rekognition' ? 'aws-rekognition' : 'aws-textract',
          analysis_type: analysisType === 'rekognition' ? 'object_detection' : 'document_analysis',
          images: [{ id: imageId }],
          parameters: {
            min_confidence: 0.7,
            custom_model_arn: null // You can add your custom model ARN here
          }
        })
      });

      if (response.ok) {
        const analysis = await response.json();

        // Poll for results (in production, you might use WebSockets)
        let attempts = 0;
        const maxAttempts = 30;

        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 2000));

          const statusResponse = await fetch(`/api/skynalysis/analyses/${analysis.id}`, {
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
            }
          });

          if (statusResponse.ok) {
            const statusData = await statusResponse.json();

            if (statusData.status === 'completed') {
              // Convert spatial tags from analysis to our format
              const newTags = statusData.spatial_tags?.map((tag: any) => ({
                id: tag.id || `temp-${Date.now()}-${Math.random()}`,
                x: tag.x_position,
                y: tag.y_position,
                text: tag.text,
                type: tag.tag_type,
                source_type: tag.source_type,
                automated_confidence: tag.automated_confidence,
                needs_human_verification: tag.needs_human_verification,
                trust_score: tag.trust_score,
                metadata: tag.metadata
              })) || [];

              // Add new AI-detected tags to state
              setTags(prev => [...prev, ...newTags]);

              return {
                success: true,
                tags: newTags,
                summary: statusData.analysis_summary,
                confidence_score: statusData.confidence_score,
                key_findings: statusData.key_findings,
                recommendations: statusData.recommendations
              };
            } else if (statusData.status === 'failed') {
              throw new Error(statusData.error_message || 'AI analysis failed');
            }
          }

          attempts++;
        }

        throw new Error('AI analysis timed out');
      } else {
        throw new Error('Failed to start AI analysis');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'AI analysis failed';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setAnalyzing(false);
    }
  }, [imageId, vehicleId]);

  // Verify an AI-detected tag
  const verifyTag = useCallback(async (tagId: string, verified: boolean) => {
    return updateTag(tagId, {
      verification_status: verified ? 'verified' : 'rejected',
      needs_human_verification: false
    });
  }, [updateTag]);

  return {
    tags,
    loading,
    analyzing,
    error,
    loadTags,
    createTag,
    updateTag,
    deleteTag,
    runAIAnalysis,
    verifyTag,
    setTags
  };
};