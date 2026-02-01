import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

interface Comment {
  id: string;
  user_id: string;
  comment_text: string;
  created_at: string;
  updated_at: string;
}

interface CommentPopupProps {
  targetId: string;
  targetType: 'vehicle' | 'image' | 'event' | 'data_point';
  targetLabel: string;
  isOpen: boolean;
  onClose: () => void;
  anchorElement?: HTMLElement;
  dataPointType?: string;
  dataPointValue?: string;
}

const CommentPopup: React.FC<CommentPopupProps> = ({
  targetId,
  targetType,
  targetLabel,
  isOpen,
  onClose,
  anchorElement,
  dataPointType,
  dataPointValue
}) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      loadComments();
    }
  }, [isOpen, targetId, targetType]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  const getTableName = () => {
    switch (targetType) {
      case 'image':
        return 'vehicle_image_comments';
      case 'event':
        return 'timeline_event_comments';
      case 'vehicle':
        return 'vehicle_comments';
      case 'data_point':
        return 'data_point_comments';
      default:
        return 'vehicle_comments';
    }
  };

  const getTargetColumn = () => {
    switch (targetType) {
      case 'image':
        return 'image_id';
      case 'event':
        return 'event_id';
      case 'vehicle':
        return 'vehicle_id';
      case 'data_point':
        return 'data_point_id';
      default:
        return 'vehicle_id';
    }
  };

  const loadComments = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from(getTableName())
        .select('*')
        .eq(getTargetColumn(), targetId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        console.error('Error loading comments:', error);
      } else {
        setComments(data || []);
      }
    } catch (error) {
      console.error('Error loading comments:', error);
    } finally {
      setLoading(false);
    }
  };

  const submitComment = async () => {
    if (!newComment.trim()) return;

    setSubmitting(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;

      const commentData: any = {
        [getTargetColumn()]: targetId,
        user_id: user.user.id,
        comment_text: newComment.trim(),
        created_at: new Date().toISOString()
      };
      
      // Add data point specific fields
      if (targetType === 'data_point') {
        commentData.data_point_type = dataPointType;
        commentData.data_point_value = dataPointValue;
      }

      const { error } = await supabase
        .from(getTableName())
        .insert(commentData);

      if (error) {
        console.error('Error submitting comment:', error);
      } else {
        setNewComment('');
        loadComments();
      }
    } catch (error) {
      console.error('Error submitting comment:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const getPopupPosition = () => {
    if (!anchorElement) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };

    const rect = anchorElement.getBoundingClientRect();
    const popupWidth = 320;
    const popupHeight = 400;

    let left = rect.right + 10;
    let top = rect.top;

    // Adjust if popup would go off screen
    if (left + popupWidth > window.innerWidth) {
      left = rect.left - popupWidth - 10;
    }
    if (top + popupHeight > window.innerHeight) {
      top = window.innerHeight - popupHeight - 10;
    }
    if (top < 10) {
      top = 10;
    }

    return { left: `${left}px`, top: `${top}px` };
  };

  if (!isOpen) return null;

  return (
    <div className="comment-popup-overlay">
      <div 
        ref={popupRef}
        className="comment-popup"
        style={getPopupPosition()}
      >
        <div className="comment-popup-header">
          <h4 className="comment-popup-title">Comments: {targetLabel}</h4>
          <button onClick={onClose} className="comment-popup-close">×</button>
        </div>

        <div className="comment-popup-body">
          {loading ? (
            <div className="comment-popup-loading">
              <div className="spinner"></div>
              <p className="text-muted">Loading comments...</p>
            </div>
          ) : (
            <>
              <div className="comment-list">
                {comments.length === 0 ? (
                  <p className="text-muted text-small">No comments yet. Be the first to comment!</p>
                ) : (
                  comments.map((comment) => (
                    <div key={comment.id} className="comment-item">
                      <div className="comment-header">
                        <span className="comment-author">{comment.user_id.slice(0, 8)}...</span>
                        <span className="comment-date">{new Date(comment.created_at).toLocaleDateString()}</span>
                      </div>
                      <div className="comment-text">{comment.comment_text}</div>
                    </div>
                  ))
                )}
              </div>

              <div className="comment-form">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Add a comment..."
                  className="comment-input"
                  rows={3}
                />
                <div className="comment-form-actions">
                  <button
                    onClick={submitComment}
                    disabled={!newComment.trim() || submitting}
                    className="button button-primary"
                  >
                    {submitting ? 'Posting...' : 'Post'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CommentPopup;
