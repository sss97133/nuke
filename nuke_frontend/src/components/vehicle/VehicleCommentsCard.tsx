import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface Comment {
  id: string;
  user_id: string;
  comment_text: string;
  created_at: string;
  user_name?: string;
  user_avatar?: string;
}

interface VehicleCommentsCardProps {
  vehicleId: string;
  session: any;
  collapsed?: boolean;
  maxVisible?: number;
}

export const VehicleCommentsCard: React.FC<VehicleCommentsCardProps> = ({
  vehicleId,
  session,
  collapsed = true,
  maxVisible = 2
}) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(!collapsed);
  const [newComment, setNewComment] = useState('');
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    loadComments();
    
    // Subscribe to new comments
    const channel = supabase
      .channel(`vehicle-comments-${vehicleId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'vehicle_comments',
        filter: `vehicle_id=eq.${vehicleId}`
      }, () => {
        loadComments();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [vehicleId]);

  const loadComments = async () => {
    try {
      setLoading(true);
      // Fetch comments and profiles separately to avoid PostgREST embed issues
      const { data: commentsData, error: commentsError } = await supabase
        .from('vehicle_comments')
        .select('id, user_id, comment_text, created_at')
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (commentsError) {
        console.warn('Failed to load comments:', commentsError);
        setComments([]);
        return;
      }

      if (commentsData && commentsData.length > 0) {
        // Fetch profiles separately
        const userIds = [...new Set(commentsData.map(c => c.user_id).filter(Boolean))];
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url')
          .in('id', userIds);

        const profilesMap = new Map((profilesData || []).map(p => [p.id, p]));

        const enriched = commentsData.map((c: any) => {
          const profile = profilesMap.get(c.user_id);
          return {
            id: c.id,
            user_id: c.user_id,
            comment_text: c.comment_text,
            created_at: c.created_at,
            user_name: profile?.full_name || profile?.username || 'User',
            user_avatar: profile?.avatar_url
          };
        });
        setComments(enriched);
      } else {
        setComments([]);
      }
    } catch (err) {
      console.warn('Failed to load comments:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePostComment = async () => {
    if (!session?.user?.id || !newComment.trim()) return;

    setPosting(true);
    try {
      const { error } = await supabase
        .from('vehicle_comments')
        .insert({
          vehicle_id: vehicleId,
          user_id: session.user.id,
          comment_text: newComment.trim(),
          created_at: new Date().toISOString()
        });

      if (!error) {
        setNewComment('');
        loadComments();
      }
    } catch (err) {
      console.error('Failed to post comment:', err);
    } finally {
      setPosting(false);
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return date.toLocaleDateString();
  };

  const visibleComments = expanded ? comments : comments.slice(0, maxVisible);
  const hasMore = comments.length > maxVisible;

  return (
    <div className="card">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', fontWeight: 700 }}>
          Comments ({comments.length})
        </span>
        {hasMore && !expanded && (
          <button
            className="btn-utility"
            style={{ fontSize: '8px', padding: '2px 6px' }}
            onClick={() => setExpanded(true)}
          >
            Show all
          </button>
        )}
      </div>
      <div className="card-body">
        {loading ? (
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', textAlign: 'center', padding: '12px' }}>
            Loading comments...
          </div>
        ) : comments.length === 0 ? (
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', textAlign: 'center', padding: '12px' }}>
            No comments yet. Be the first to comment!
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {visibleComments.map((comment) => (
              <div key={comment.id} style={{ paddingBottom: '12px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  {comment.user_avatar && (
                    <img
                      src={comment.user_avatar}
                      alt=""
                      style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        border: '1px solid var(--border)'
                      }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontSize: '8pt', fontWeight: 600 }}>{comment.user_name}</span>
                      <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                        {formatTimeAgo(comment.created_at)}
                      </span>
                    </div>
                    <div style={{ fontSize: '9pt', lineHeight: 1.4 }}>
                      {comment.comment_text}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add comment input */}
        {session?.user?.id && (
          <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Add a comment..."
              rows={2}
              disabled={posting}
              style={{
                width: '100%',
                fontSize: '8pt',
                padding: '6px',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                resize: 'vertical',
                fontFamily: 'inherit',
                marginBottom: '6px'
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className="button button-primary"
                style={{ fontSize: '8pt', padding: '4px 12px' }}
                onClick={handlePostComment}
                disabled={posting || !newComment.trim()}
              >
                {posting ? 'Posting...' : 'Post'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VehicleCommentsCard;

