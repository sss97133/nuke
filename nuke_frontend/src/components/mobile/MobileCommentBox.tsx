/**
 * Mobile Comment Box
 * Instagram-style comment input with thread display
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface MobileCommentBoxProps {
  vehicleId: string;
  session: any;
  targetType?: 'vehicle' | 'image' | 'event';
  targetId?: string;
}

export const MobileCommentBox: React.FC<MobileCommentBoxProps> = ({
  vehicleId,
  session,
  targetType = 'vehicle',
  targetId
}) => {
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (expanded) {
      loadComments();
    }
  }, [expanded, vehicleId, targetId]);

  const loadComments = async () => {
    let table = 'vehicle_comments';
    let filter: any = { vehicle_id: vehicleId };

    if (targetType === 'image' && targetId) {
      table = 'vehicle_image_comments';
      filter = { image_id: targetId };
    } else if (targetType === 'event' && targetId) {
      table = 'timeline_event_comments';
      filter = { event_id: targetId };
    }

    const { data } = await supabase
      .from(table)
      .select('*')
      .match(filter)
      .order('created_at', { ascending: false });

    setComments(data || []);
  };

  const handleSubmit = async () => {
    if (!newComment.trim() || !session?.user) return;

    setSubmitting(true);

    try {
      let table = 'vehicle_comments';
      let payload: any = {
        vehicle_id: vehicleId,
        user_id: session.user.id,
        comment_text: newComment.trim()
      };

      if (targetType === 'image' && targetId) {
        table = 'vehicle_image_comments';
        payload = {
          image_id: targetId,
          vehicle_id: vehicleId,
          user_id: session.user.id,
          comment_text: newComment.trim()
        };
      } else if (targetType === 'event' && targetId) {
        table = 'timeline_event_comments';
        payload = {
          event_id: targetId,
          vehicle_id: vehicleId,
          user_id: session.user.id,
          comment_text: newComment.trim()
        };
      }

      const { error } = await supabase.from(table).insert([payload]);

      if (error) throw error;

      setNewComment('');
      loadComments();
      
      // Trigger refresh
      window.dispatchEvent(new Event('comments_updated'));
    } catch (error) {
      console.error('Comment error:', error);
      alert('Failed to post comment');
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div style={styles.container}>
      {/* Comment Count Button */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={styles.countBtn}
      >
        💬 {comments.length} {comments.length === 1 ? 'Comment' : 'Comments'}
        <span style={styles.expandIcon}>{expanded ? '▼' : '▶'}</span>
      </button>

      {/* Comment Thread (Expanded) */}
      {expanded && (
        <div style={styles.thread}>
          {comments.length === 0 ? (
            <div style={styles.emptyState}>No comments yet. Be the first!</div>
          ) : (
            comments.map(comment => (
              <div key={comment.id} style={styles.comment}>
                <div style={styles.commentHeader}>
                  <span style={styles.commentAuthor}>@user</span>
                  <span style={styles.commentTime}>{formatTime(comment.created_at)}</span>
                </div>
                <div style={styles.commentText}>{comment.comment_text}</div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Input Box (Always Visible if Logged In) */}
      {session?.user && (
        <div style={styles.inputBox}>
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a comment..."
            rows={2}
            style={styles.textarea}
            onFocus={() => setExpanded(true)}
          />
          <button
            onClick={handleSubmit}
            disabled={!newComment.trim() || submitting}
            style={{
              ...styles.submitBtn,
              opacity: !newComment.trim() || submitting ? 0.5 : 1
            }}
          >
            {submitting ? '...' : '→'}
          </button>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    marginTop: '16px',
    borderTop: '2px solid #c0c0c0',
    paddingTop: '12px'
  },
  countBtn: {
    width: '100%',
    background: '#f0f0f0',
    border: '2px solid #c0c0c0',
    padding: '12px',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: 'bold',
    fontFamily: '"MS Sans Serif", sans-serif',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  expandIcon: {
    fontSize: '12px'
  },
  thread: {
    marginTop: '12px',
    maxHeight: '300px',
    overflowY: 'auto' as const,
    border: '2px inset #c0c0c0',
    borderRadius: '4px',
    background: '#ffffff'
  },
  emptyState: {
    padding: '20px',
    textAlign: 'center' as const,
    color: '#999',
    fontSize: '13px'
  },
  comment: {
    padding: '12px',
    borderBottom: '1px solid #e0e0e0'
  },
  commentHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '6px'
  },
  commentAuthor: {
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#000080'
  },
  commentTime: {
    fontSize: '11px',
    color: '#666'
  },
  commentText: {
    fontSize: '13px',
    lineHeight: '1.4',
    wordWrap: 'break-word' as const
  },
  inputBox: {
    display: 'flex',
    gap: '8px',
    marginTop: '12px',
    alignItems: 'flex-end'
  },
  textarea: {
    flex: 1,
    padding: '12px',
    border: '2px inset #c0c0c0',
    borderRadius: '4px',
    fontSize: '14px',
    fontFamily: '"MS Sans Serif", sans-serif',
    resize: 'none' as const
  },
  submitBtn: {
    width: '48px',
    height: '48px',
    background: '#000080',
    color: '#ffffff',
    border: '2px outset #ffffff',
    borderRadius: '50%',
    fontSize: '20px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  }
};

