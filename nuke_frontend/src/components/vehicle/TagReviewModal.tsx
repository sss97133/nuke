import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface TagReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  vehicleId: string;
}

interface AITag {
  id: string;
  tag_name: string;
  confidence: number;
  verified: boolean;
  source_type: string;
  image_id?: string;
  inserted_at?: string;
}

const TagReviewModal: React.FC<TagReviewModalProps> = ({ isOpen, onClose, vehicleId }) => {
  const [aiTags, setAITags] = useState<AITag[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && vehicleId) {
      fetchAITags();
    }
  }, [isOpen, vehicleId]);

  const fetchAITags = async () => {
    setLoading(true);
    try {
      // Fetch AI-detected tags that need review (unverified AI tags)
      const { data, error } = await supabase
        .from('image_tags')
        .select('id, tag_name, confidence, verified, source_type, image_id, inserted_at')
        .eq('vehicle_id', vehicleId)
        .eq('source_type', 'ai')
        .eq('verified', false)
        .order('confidence', { ascending: false })
        .limit(20);

      if (error) {
        console.debug('Error fetching AI tags:', error);
        // Try to show any AI tags even if verified
        const { data: fallbackData } = await supabase
          .from('image_tags')
          .select('id, tag_name, confidence, verified, source_type, image_id, inserted_at')
          .eq('vehicle_id', vehicleId)
          .eq('source_type', 'ai')
          .order('confidence', { ascending: false })
          .limit(10);
        setAITags(fallbackData || []);
      } else {
        setAITags(data || []);
      }
    } catch (error) {
      console.debug('Error fetching AI tags:', error);
      setAITags([]);
    } finally {
      setLoading(false);
    }
  };

  const handleTagAction = async (tagId: string, action: 'approve' | 'reject') => {
    try {
      if (action === 'approve') {
        // Mark as verified
        const { error } = await supabase
          .from('image_tags')
          .update({ verified: true })
          .eq('id', tagId);
        if (error) throw error;
      } else {
        // Delete rejected tags
        const { error } = await supabase
          .from('image_tags')
          .delete()
          .eq('id', tagId);
        if (error) throw error;
      }

      // Update local state
      setAITags(prev => prev.filter(tag => tag.id !== tagId));
    } catch (error) {
      console.error(`Error ${action}ing tag:`, error);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Review AI-Detected Tags</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div className="text-center">
              <p>Loading AI tags...</p>
            </div>
          ) : aiTags.length === 0 ? (
            <div className="text-center">
              <p className="text-muted">No AI tags pending review</p>
              <p className="text-small">All AI-detected tags have been reviewed or no tags were detected.</p>
            </div>
          ) : (
            <div>
              <p className="text-small text-muted mb-4">
                Review AI-detected tags below. Approve accurate tags or reject incorrect ones.
              </p>

              <div className="tag-review-list">
                {aiTags.map(tag => (
                  <div key={tag.id} className="tag-review-item">
                    <div className="tag-info">
                      <div className="tag-details">
                        <span className="tag-name">🤖 {tag.tag_name}</span>
                        <span className="confidence-score">
                          {Math.round(tag.confidence >= 1 ? tag.confidence : tag.confidence * 100)}% confidence
                        </span>
                      </div>
                      {tag.image_id && (
                        <div className="tag-image-info">
                          <span className="text-small text-muted">Image: {tag.image_id.slice(-8)}</span>
                        </div>
                      )}
                    </div>

                    <div className="tag-actions">
                      <button
                        className="button button-small button-success"
                        onClick={() => handleTagAction(tag.id, 'approve')}
                      >
                        ✓ Approve
                      </button>
                      <button
                        className="button button-small button-secondary"
                        onClick={() => handleTagAction(tag.id, 'reject')}
                      >
                        ✗ Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="button button-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <style jsx>{`
        .tag-review-list {
          max-height: 400px;
          overflow-y: auto;
        }

        .tag-review-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: var(--space-3);
          border: 1px solid var(--border-light);
          border-radius: 4px;
          margin-bottom: var(--space-2);
          background: var(--white);
        }

        .tag-info {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          flex: 1;
        }

        .tag-details {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }

        .tag-name {
          font-weight: 600;
          color: var(--text);
        }

        .confidence-score {
          font-size: var(--font-size-small);
          color: var(--text-muted);
        }

        .tag-image-info {
          font-size: var(--font-size-small);
          color: var(--text-muted);
        }

        .tag-actions {
          display: flex;
          gap: var(--space-2);
        }

        .modal-content {
          max-width: 600px;
          max-height: 80vh;
          overflow-y: auto;
        }
      `}</style>
    </div>
  );
};

export default TagReviewModal;