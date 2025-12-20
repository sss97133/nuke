import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface Comment {
  id: string;
  user_id?: string | null;
  comment_text: string;
  created_at: string;
  posted_at?: string;
  user_name?: string;
  user_avatar?: string;
  author_username?: string; // For BaT comments
  comment_type?: string; // 'bid', 'question', 'observation', etc.
  bid_amount?: number;
  is_seller?: boolean;
  source?: 'nzero' | 'bat'; // Distinguish N-Zero comments from BaT comments
  external_identity_id?: string; // For linking to profiles
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
  const navigate = useNavigate();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(!collapsed);
  const [newComment, setNewComment] = useState('');
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    loadComments();
    
    // Subscribe to new comments (both N-Zero and BaT auction comments)
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
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'auction_comments',
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
      
      // Load both N-Zero comments AND BaT auction comments
      const [nzeroCommentsResult, batCommentsResult] = await Promise.all([
        // N-Zero vehicle comments
        supabase
          .from('vehicle_comments')
          .select('id, user_id, comment_text, created_at')
          .eq('vehicle_id', vehicleId)
          .order('created_at', { ascending: false })
          .limit(100),
        
        // BaT auction comments (from auction_comments table)
        supabase
          .from('auction_comments')
          .select(`
            id,
            author_username,
            comment_text,
            posted_at,
            comment_type,
            bid_amount,
            is_seller,
            auction_event_id,
            auction_events!inner(vehicle_id)
          `)
          .eq('vehicle_id', vehicleId)
          .order('posted_at', { ascending: false })
          .limit(200)
      ]);

      const allComments: Comment[] = [];

      // Process N-Zero comments
      if (nzeroCommentsResult.data && nzeroCommentsResult.data.length > 0) {
        const userIds = [...new Set(nzeroCommentsResult.data.map(c => c.user_id).filter(Boolean))];
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url')
          .in('id', userIds);

        const profilesMap = new Map((profilesData || []).map(p => [p.id, p]));

        for (const c of nzeroCommentsResult.data) {
          const profile = profilesMap.get(c.user_id);
          allComments.push({
            id: c.id,
            user_id: c.user_id,
            comment_text: c.comment_text,
            created_at: c.created_at,
            user_name: profile?.full_name || profile?.username || 'User',
            user_avatar: profile?.avatar_url,
            source: 'nzero'
          });
        }
      }

      // Process BaT auction comments
      if (batCommentsResult.data && batCommentsResult.data.length > 0) {
        // Get external_identity_id for BaT usernames to link to profiles
        const batUsernames = [...new Set(batCommentsResult.data.map(c => c.author_username).filter(Boolean))];
        const { data: externalIds } = await supabase
          .from('external_identities')
          .select('id, handle, n_zero_user_id, profile_url')
          .eq('platform', 'bat')
          .in('handle', batUsernames);

        const identityMap = new Map((externalIds || []).map(e => [e.handle, e]));

        for (const c of batCommentsResult.data) {
          const identity = identityMap.get(c.author_username);
          allComments.push({
            id: `bat-${c.id}`,
            user_id: identity?.n_zero_user_id || null,
            author_username: c.author_username,
            comment_text: c.comment_text,
            created_at: c.posted_at,
            posted_at: c.posted_at,
            user_name: c.author_username,
            comment_type: c.comment_type,
            bid_amount: c.bid_amount ? Number(c.bid_amount) : undefined,
            is_seller: c.is_seller,
            source: 'bat',
            external_identity_id: identity?.id,
            user_avatar: identity?.profile_url || undefined
          });
        }
      }

      // Sort all comments by date (most recent first)
      allComments.sort((a, b) => {
        const dateA = new Date(a.posted_at || a.created_at).getTime();
        const dateB = new Date(b.posted_at || b.created_at).getTime();
        return dateB - dateA;
      });

      setComments(allComments);
    } catch (err) {
      console.warn('Failed to load comments:', err);
      setComments([]);
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

  const handleUsernameClick = async (comment: Comment) => {
    // If it's a BaT user, check if they have a linked N-Zero profile
    if (comment.source === 'bat' && comment.author_username) {
      // First check if they have an external_identity linked to an n_zero_user_id
      const { data: identity } = await supabase
        .from('external_identities')
        .select('n_zero_user_id, profile_url')
        .eq('platform', 'bat')
        .eq('handle', comment.author_username)
        .maybeSingle();
      
      if (identity?.n_zero_user_id) {
        // They have a linked N-Zero profile, navigate there
        navigate(`/profile/${identity.n_zero_user_id}`);
      } else {
        // No linked profile yet - open BaT profile in new tab, or show claim identity page
        if (identity?.profile_url) {
          window.open(identity.profile_url, '_blank');
        } else {
          // Open claim identity page so they can link their BaT account
          navigate(`/claim-identity?platform=bat&handle=${encodeURIComponent(comment.author_username)}`);
        }
      }
    } else if (comment.user_id) {
      navigate(`/profile/${comment.user_id}`);
    }
  };

  const visibleComments = expanded ? comments : comments.slice(0, maxVisible);
  const hasMore = comments.length > maxVisible;

  return (
    <div className="card">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', fontWeight: 700 }}>
          Comments & Bids ({comments.length})
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
            {visibleComments.map((comment) => {
              const displayDate = comment.posted_at || comment.created_at;
              const isBid = comment.comment_type === 'bid' || comment.bid_amount !== undefined;
              const isBaT = comment.source === 'bat';
              
              return (
                <div key={comment.id} style={{ 
                  paddingBottom: '12px', 
                  borderBottom: '1px solid var(--border)',
                  paddingLeft: isBaT ? '8px' : '0',
                  borderLeft: isBaT ? '3px solid #2563eb' : 'none'
                }}>
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
                    {!comment.user_avatar && isBaT && (
                      <div style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        backgroundColor: '#2563eb',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '8pt',
                        fontWeight: 700
                      }}>
                        BaT
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => handleUsernameClick(comment)}
                          style={{
                            fontSize: '8pt',
                            fontWeight: 600,
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            color: 'var(--text)',
                            textDecoration: 'underline'
                          }}
                        >
                          {comment.user_name || comment.author_username}
                        </button>
                        {isBaT && (
                          <span style={{ fontSize: '7pt', color: '#2563eb', fontWeight: 600 }}>
                            BaT
                          </span>
                        )}
                        {isBid && comment.bid_amount && (
                          <span style={{ 
                            fontSize: '8pt', 
                            fontWeight: 700, 
                            color: '#059669',
                            backgroundColor: '#d1fae5',
                            padding: '2px 6px',
                            borderRadius: '4px'
                          }}>
                            ${comment.bid_amount.toLocaleString()} BID
                          </span>
                        )}
                        {comment.is_seller && (
                          <span style={{ 
                            fontSize: '7pt', 
                            fontWeight: 600, 
                            color: '#dc2626',
                            backgroundColor: '#fee2e2',
                            padding: '2px 6px',
                            borderRadius: '4px'
                          }}>
                            SELLER
                          </span>
                        )}
                        <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                          {formatTimeAgo(displayDate)}
                        </span>
                      </div>
                      <div style={{ fontSize: '9pt', lineHeight: 1.4 }}>
                        {comment.comment_text}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
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

