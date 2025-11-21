/**
 * Mobile Comment Box
 * Instagram-style comment input with thread display
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import CursorButton from '../CursorButton';

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
      <CursorButton
        onClick={() => setExpanded(!expanded)}
        variant="secondary"
        size="sm"
        fullWidth
      >
        {comments.length} {comments.length === 1 ? 'Comment' : 'Comments'}
        <span style={styles.expandIcon}>{expanded ? '▼' : '▶'}</span>
      </CursorButton>

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
          <CursorButton
            onClick={handleSubmit}
            disabled={!newComment.trim() || submitting}
            variant="primary"
            size="sm"
          >
            {submitting ? '...' : '→'}
          </CursorButton>
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    marginTop: 'var(--space-3)',
    borderTop: '2px solid var(--border)',
    paddingTop: 'var(--space-2)'
  },
  expandIcon: {
    fontSize: '8pt',
    color: 'var(--text-secondary)',
    marginLeft: 'var(--space-2)'
  },
  thread: {
    marginTop: 'var(--space-2)',
    maxHeight: '400px',
    overflowY: 'auto' as const,
    background: 'var(--bg)'
  },
  emptyState: {
    padding: 'var(--space-4)',
    textAlign: 'center' as const,
    color: 'var(--text-secondary)',
    fontSize: '8pt'
  },
  comment: {
    padding: 'var(--space-2) 0',
    borderBottom: '2px solid var(--border)'
  },
  commentHeader: {
    display: 'flex',
    gap: 'var(--space-2)',
    marginBottom: 'var(--space-1)',
    alignItems: 'center'
  },
  commentAuthor: {
    fontSize: '8pt',
    fontWeight: 600,
    color: 'var(--text)',
    fontFamily: 'var(--font-family)'
  },
  commentTime: {
    fontSize: '8pt',
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-mono)'
  },
  commentText: {
    fontSize: '8pt',
    lineHeight: 1.4,
    wordWrap: 'break-word' as const,
    color: 'var(--text)',
    fontFamily: 'var(--font-family)'
  },
  inputBox: {
    display: 'flex',
    gap: 'var(--space-2)',
    marginTop: 'var(--space-2)',
    alignItems: 'center',
    padding: 'var(--space-2)',
    border: '2px solid var(--border)',
    borderRadius: 'var(--radius)',
    background: 'var(--surface)',
    transition: 'var(--transition)'
  },
  textarea: {
    flex: 1,
    padding: 'var(--space-2)',
    border: 'none',
    background: 'transparent',
    fontSize: '8pt',
    fontFamily: 'var(--font-family)',
    resize: 'none' as const,
    outline: 'none',
    color: 'var(--text)'
  }
};

