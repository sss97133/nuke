/**
 * Image Tag Placer
 * Click anywhere on image to place a pin/tag with x,y coordinates
 * Opens keyboard to write comment, can trigger AI responses
 */

import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface ImageTag {
  id: string;
  image_id: string;
  x_position: number;
  y_position: number;
  text: string;
  tag_type: string;
  created_by: string;
  inserted_at: string;
  metadata?: any;
}

interface ImageTagPlacerProps {
  imageId: string;
  imageUrl: string;
  isActive: boolean;
  onTagPlaced?: () => void;
}

export default function ImageTagPlacer({ imageId, imageUrl, isActive, onTagPlaced }: ImageTagPlacerProps) {
  const [tags, setTags] = useState<ImageTag[]>([]);
  const [placing, setPlacing] = useState(false);
  const [newTagPosition, setNewTagPosition] = useState<{ x: number; y: number } | null>(null);
  const [tagText, setTagText] = useState('');
  const [saving, setSaving] = useState(false);
  const imageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadTags();
  }, [imageId]);

  const loadTags = async () => {
    try {
      const { data, error} = await supabase
        .from('image_tags')
        .select('*')
        .eq('image_id', imageId)
        .order('inserted_at', { ascending: false });

      if (error) throw error;
      setTags(data || []);
    } catch (error: any) {
      console.error('Error loading tags:', error);
    }
  };

  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isActive) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    // Clamp to 0-1 range
    const xNormalized = Math.max(0, Math.min(1, x));
    const yNormalized = Math.max(0, Math.min(1, y));

    setNewTagPosition({ x: xNormalized, y: yNormalized });
    setTagText('');
    setPlacing(true);
  };

  const handleSaveTag = async () => {
    if (!newTagPosition || !tagText.trim()) return;

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Create tag
      const { data: tag, error } = await supabase
        .from('image_tags')
        .insert({
          image_id: imageId,
          created_by: user.id,
          x_position: newTagPosition.x,
          y_position: newTagPosition.y,
          text: tagText.trim(),
          tag_type: tagText.toLowerCase().includes('?') ? 'question' : 'comment',
          metadata: { is_public: true }
        })
        .select()
        .single();

      if (error) throw error;

      // Check if this is a question that needs AI response
      const isQuestion = tagText.toLowerCase().includes('?');
      if (isQuestion) {
        await generateAIResponse(tag.id, tagText);
      }

      setTags([tag, ...tags]);
      setNewTagPosition(null);
      setTagText('');
      setPlacing(false);
      onTagPlaced?.();
    } catch (error: any) {
      console.error('Error saving tag:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const generateAIResponse = async (tagId: string, question: string) => {
    try {
      const response = await fetch(`${supabase.supabaseUrl}/functions/v1/respond-to-image-tag`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        },
        body: JSON.stringify({
          tagId,
          question,
          imageId
        })
      });

      const result = await response.json();
      
      if (result.success) {
        // Reload tags to show AI response
        loadTags();
      }
    } catch (error) {
      console.error('Error generating AI response:', error);
    }
  };

  const handleCancel = () => {
    setNewTagPosition(null);
    setTagText('');
    setPlacing(false);
  };

  return (
    <div
      ref={imageRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        cursor: isActive ? 'crosshair' : 'default'
      }}
      onClick={handleImageClick}
    >
      {/* Image */}
      <img
        src={imageUrl}
        alt="Taggable image"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          pointerEvents: 'none'
        }}
      />

      {/* Existing tags */}
      {tags.map(tag => (
        <div
          key={tag.id}
          style={{
            position: 'absolute',
            left: `${tag.x_position * 100}%`,
            top: `${tag.y_position * 100}%`,
            transform: 'translate(-50%, -50%)',
            background: 'rgba(255, 0, 0, 0.8)',
            color: '#fff',
            borderRadius: '50%',
            width: '24px',
            height: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '10pt',
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            zIndex: 10
          }}
          onClick={(e) => {
            e.stopPropagation();
            alert(`${tag.text}${tag.metadata?.ai_response ? '\n\nAI: ' + tag.metadata.ai_response : ''}`);
          }}
          title={tag.text}
        >
          {tag.tag_type === 'question' ? '?' : '•'}
        </div>
      ))}

      {/* New tag being placed */}
      {newTagPosition && (
        <div
          style={{
            position: 'absolute',
            left: `${newTagPosition.x * 100}%`,
            top: `${newTagPosition.y * 100}%`,
            transform: 'translate(-50%, -50%)',
            background: 'rgba(255, 165, 0, 0.9)',
            color: '#fff',
            borderRadius: '50%',
            width: '24px',
            height: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '14pt',
            fontWeight: 700,
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            animation: 'pulse 1s infinite',
            zIndex: 11
          }}
        >
          +
        </div>
      )}

      {/* Tag input modal */}
      {placing && newTagPosition && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            background: 'rgba(0,0,0,0.95)',
            padding: '16px',
            zIndex: 9999,
            borderTopLeftRadius: '12px',
            borderTopRightRadius: '12px'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ marginBottom: '12px', color: '#fff', fontSize: '9pt', textAlign: 'center' }}>
            Write your comment or question
          </div>
          
          <textarea
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            placeholder="Ask a question or leave a comment..."
            autoFocus
            rows={3}
            style={{
              width: '100%',
              padding: '12px',
              fontSize: '10pt',
              borderRadius: '8px',
              border: 'none',
              background: '#fff',
              resize: 'none',
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }}
          />

          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button
              onClick={handleCancel}
              style={{
                flex: 1,
                padding: '12px',
                background: 'rgba(255,255,255,0.2)',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '10pt',
                fontWeight: 600
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSaveTag}
              disabled={!tagText.trim() || saving}
              style={{
                flex: 1,
                padding: '12px',
                background: tagText.trim() ? '#007AFF' : 'rgba(255,255,255,0.2)',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '10pt',
                fontWeight: 600,
                opacity: saving ? 0.5 : 1
              }}
            >
              {saving ? 'Saving...' : 'Place Tag'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

