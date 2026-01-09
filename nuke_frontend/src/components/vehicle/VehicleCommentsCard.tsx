import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import VehicleMemePanel from './VehicleMemePanel';
import { FallbackAvatar } from '../common/AsciiAvatar';

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
  source?: 'nzero' | 'auction' | 'bat'; // Distinguish N-Zero comments from auction_comments and BaT
  auction_platform?: string | null;
  external_identity_id?: string; // For linking to profiles
}

interface VehicleCommentsCardProps {
  vehicleId: string;
  session: any;
  collapsed?: boolean;
  maxVisible?: number;
  disabled?: boolean;
}

export const VehicleCommentsCard: React.FC<VehicleCommentsCardProps> = ({
  vehicleId,
  session,
  collapsed = true,
  maxVisible = 2,
  disabled = false
}) => {
  const navigate = useNavigate();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(!collapsed);
  const [newComment, setNewComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [memePickerOpen, setMemePickerOpen] = useState(false);

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
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bat_comments',
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
      
      // Load ALL comment sources: N-Zero, auction_comments, AND bat_comments
      const [nzeroCommentsResult, auctionCommentsResult, batCommentsResult] = await Promise.all([
        // N-Zero vehicle comments
        supabase
          .from('vehicle_comments')
          .select('id, user_id, comment_text, created_at')
          .eq('vehicle_id', vehicleId)
          .order('created_at', { ascending: false })
          .limit(100),
        
        // Auction comments (from auction_comments table)
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
            platform,
            source_url,
            auction_event_id,
            external_identity_id,
            vehicle_id
          `)
          .eq('vehicle_id', vehicleId)
          .order('posted_at', { ascending: false })
          .limit(200),
        
        // BaT comments (from bat_comments table) - THIS WAS MISSING!
        supabase
          .from('bat_comments')
          .select(`
            id,
            bat_username,
            comment_text,
            comment_timestamp,
            bat_listing_id,
            vehicle_id,
            external_identity_id,
            contains_bid,
            is_seller_comment,
            likes_count
          `)
          .eq('vehicle_id', vehicleId)
          .order('comment_timestamp', { ascending: false })
          .limit(200)
      ]);

      const allComments: Comment[] = [];

      // Resolve auction platform per auction_event_id (auction_comments is multi-platform)
      const auctionEventIds = [...new Set((auctionCommentsResult.data || []).map((c: any) => c.auction_event_id).filter(Boolean))];
      const auctionEventPlatformMap = new Map<string, string>();
      if (auctionEventIds.length > 0) {
        try {
          const { data: evRows } = await supabase
            .from('auction_events')
            .select('id, source')
            .in('id', auctionEventIds);
          (evRows || []).forEach((r: any) => {
            const src = r?.source ? String(r.source) : null;
            const mapped = src === 'carsandbids' ? 'cars_and_bids' : src;
            if (r?.id && mapped) auctionEventPlatformMap.set(String(r.id), mapped);
          });
        } catch {
          // ignore
        }
      }

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

      // Process auction comments (from auction_comments table)
      if (auctionCommentsResult.data && auctionCommentsResult.data.length > 0) {
        const isGarbageCarsAndBidsComment = (text: string): boolean => {
          const t = String(text || '').trim();
          if (!t) return true;
          const lower = t.toLowerCase();
          if (lower.includes('comments & bids')) return true;
          if (lower.includes('most upvoted')) return true;
          if (lower.includes('newest')) return true;
          if (lower.includes('add a comment')) return true;
          if (lower.includes('bid history')) return true;
          if (lower.includes('you just commented')) return true;
          if (lower.startsWith('comments ')) return true;
          return false;
        };

        // Get external identities for usernames by platform (bat, cars_and_bids, etc.)
        const platformHandles = new Map<string, Set<string>>();
        for (const c of auctionCommentsResult.data as any[]) {
          const handle = c.author_username;
          if (!handle) continue;
          const eventPlatform = (c.platform ? String(c.platform) : null) || auctionEventPlatformMap.get(String(c.auction_event_id)) || null;
          const p = (eventPlatform || 'bat').toString();
          const set = platformHandles.get(p) || new Set<string>();
          set.add(handle);
          platformHandles.set(p, set);
        }

        const externalIdentityByPlatformHandle = new Map<string, any>();
        for (const [platform, handlesSet] of platformHandles.entries()) {
          const handles = Array.from(handlesSet);
          if (handles.length === 0) continue;
          const { data: externalIds } = await supabase
            .from('external_identities')
            .select('id, handle, claimed_by_user_id, profile_url')
            .eq('platform', platform)
            .in('handle', handles);
          (externalIds || []).forEach((e: any) => {
            if (e?.handle) externalIdentityByPlatformHandle.set(`${platform}:${e.handle}`, e);
          });
        }

        for (const c of auctionCommentsResult.data) {
          const auctionPlatform = ((c as any).platform ? String((c as any).platform) : null) || auctionEventPlatformMap.get(String((c as any).auction_event_id)) || null;

          if (auctionPlatform === 'cars_and_bids' && isGarbageCarsAndBidsComment(String(c.comment_text || ''))) {
            continue;
          }

          const identity =
            (auctionPlatform && c.author_username ? externalIdentityByPlatformHandle.get(`${auctionPlatform}:${c.author_username}`) : null) ||
            (!auctionPlatform && c.author_username ? externalIdentityByPlatformHandle.get(`bat:${c.author_username}`) : null) ||
            null;

          // Convert bid_amount properly - handle both numeric and string types
          let bidAmount: number | undefined = undefined;
          if (c.bid_amount != null) {
            const num = typeof c.bid_amount === 'number' ? c.bid_amount : Number(c.bid_amount);
            if (!isNaN(num) && num > 0) {
              bidAmount = num;
            }
          }
          
          allComments.push({
            id: `auction-${c.id}`,
            user_id: identity?.claimed_by_user_id || null,
            author_username: c.author_username,
            comment_text: c.comment_text,
            created_at: c.posted_at,
            posted_at: c.posted_at,
            user_name: c.author_username,
            comment_type: c.comment_type || (bidAmount ? 'bid' : undefined),
            bid_amount: bidAmount,
            is_seller: c.is_seller,
            source: 'auction',
            auction_platform: auctionPlatform,
            external_identity_id: identity?.id || c.external_identity_id,
            user_avatar: identity?.profile_url || undefined
          });
        }
      }

      // Process BaT comments (from bat_comments table) - THIS WAS MISSING!
      if (batCommentsResult.data && batCommentsResult.data.length > 0) {
        // Get external_identity_id for BaT usernames to link to profiles
        const batUsernames = [...new Set(batCommentsResult.data.map(c => c.bat_username).filter(Boolean))];
        const { data: externalIds } = await supabase
          .from('external_identities')
          .select('id, handle, claimed_by_user_id, profile_url')
          .eq('platform', 'bat')
          .in('handle', batUsernames);

        const identityMap = new Map((externalIds || []).map(e => [e.handle, e]));

        for (const c of batCommentsResult.data) {
          const identity = identityMap.get(c.bat_username) || (c.external_identity_id ? externalIds?.find(e => e.id === c.external_identity_id) : null);
          
          // Extract bid amount from comment text if contains_bid is true
          let bidAmount: number | undefined = undefined;
          if (c.contains_bid) {
            const bidMatch = c.comment_text.match(/\$?([\d,]+)/);
            if (bidMatch) {
              bidAmount = Number(bidMatch[1].replace(/,/g, ''));
            }
          }
          
          allComments.push({
            id: `bat-comment-${c.id}`,
            user_id: identity?.claimed_by_user_id || null,
            author_username: c.bat_username,
            comment_text: c.comment_text,
            created_at: c.comment_timestamp,
            posted_at: c.comment_timestamp,
            user_name: c.bat_username,
            comment_type: c.contains_bid ? 'bid' : 'comment',
            bid_amount: bidAmount,
            is_seller: c.is_seller_comment,
            source: 'bat',
            external_identity_id: identity?.id || c.external_identity_id,
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
        setMemePickerOpen(false);
        loadComments();
      }
    } catch (err) {
      console.error('Failed to post comment:', err);
    } finally {
      setPosting(false);
    }
  };

  const handleMemeSelect = (memeUrl: string, memeTitle: string) => {
    // Insert meme reference into comment
    const memeRef = `[meme:${memeTitle}](${memeUrl})`;
    setNewComment(prev => prev ? `${prev}\n${memeRef}` : memeRef);
    setMemePickerOpen(false);
  };

  // Keyboard shortcut: Ctrl+M or Cmd+M to open meme picker
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
        e.preventDefault();
        setMemePickerOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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

  const renderCommentText = (text: string) => {
    // Parse markdown-style meme references: [meme:Title](url)
    const memeRegex = /\[meme:([^\]]+)\]\(([^)]+)\)/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = memeRegex.exec(text)) !== null) {
      // Add text before the meme
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }
      
      // Add the meme image
      const title = match[1];
      const url = match[2];
      parts.push(
        <img
          key={match.index}
          src={url}
          alt={title}
          title={title}
          style={{
            maxWidth: '200px',
            maxHeight: '150px',
            display: 'block',
            marginTop: '4px',
            marginBottom: '4px',
            border: '1px solid var(--border)',
          }}
        />
      );
      
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }
    
    return parts.length > 0 ? parts : text;
  };

  const handleUsernameClick = async (comment: Comment) => {
    // If user_id exists (N-Zero user or claimed BaT user), go to their profile
    if (comment.user_id) {
      navigate(`/profile/${comment.user_id}`);
      return;
    }
    
    // For external auction identities, route through external_identities.
    if ((comment.source === 'auction' || comment.source === 'bat') && (comment.author_username || comment.external_identity_id)) {
      let identity = null;
      
      // Try to get identity by external_identity_id first (faster)
      if (comment.external_identity_id) {
        const { data } = await supabase
          .from('external_identities')
          .select('id, claimed_by_user_id, profile_url, handle')
          .eq('id', comment.external_identity_id)
          .maybeSingle();
        identity = data;
      }
      
      // Fallback: get by username
      if (!identity && comment.author_username) {
        const platform =
          (comment.source === 'auction' ? (comment.auction_platform || null) : 'bat') ||
          'bat';
        const { data } = await supabase
          .from('external_identities')
          .select('id, claimed_by_user_id, profile_url, handle')
          .eq('platform', platform)
          .eq('handle', comment.author_username)
          .maybeSingle();
        identity = data;
      }
      
      if (identity?.claimed_by_user_id) {
        // They have a claimed N-Zero profile, navigate there
        navigate(`/profile/${identity.claimed_by_user_id}`);
      } else if (identity?.id) {
        // No claimed profile but we have external identity - show public profile
        navigate(`/profile/external/${identity.id}`);
      } else if (comment.external_identity_id) {
        // Use the external_identity_id from comment
        navigate(`/profile/external/${comment.external_identity_id}`);
      } else if (comment.author_username) {
        // Try to find external identity to show public profile
        const platform =
          (comment.source === 'auction' ? (comment.auction_platform || null) : 'bat') ||
          'bat';
        const { data: extIdentity } = await supabase
          .from('external_identities')
          .select('id, handle, profile_url')
          .eq('platform', platform)
          .eq('handle', comment.author_username)
          .maybeSingle();
        
        if (extIdentity?.id) {
          // Show public profile by external identity
          navigate(`/profile/external/${extIdentity.id}`);
        } else if (extIdentity?.profile_url) {
          // Fallback: open BaT profile
          window.open(extIdentity.profile_url, '_blank');
        } else {
          // Last resort: open claim identity page
          navigate(`/claim-identity?platform=${encodeURIComponent(platform)}&handle=${encodeURIComponent(comment.author_username)}`);
        }
      }
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
              const isAuction = comment.source === 'auction';
              const auctionPlatform = (comment as any).auction_platform ? String((comment as any).auction_platform) : null;
              
              return (
                <div key={comment.id} style={{ 
                  paddingBottom: '12px', 
                  borderBottom: '1px solid var(--border)',
                  paddingLeft: isBaT ? '8px' : '0',
                  borderLeft: isBaT ? '3px solid var(--grey-300)' : 'none'
                }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <FallbackAvatar
                      src={comment.user_avatar}
                      seed={comment.author_username || comment.user_name || comment.id || 'user'}
                      platform={comment.source === 'bat' ? 'bat' : undefined}
                      size={24}
                      alt={comment.author_username || comment.user_name || 'User'}
                    />
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
                        {isAuction && auctionPlatform && auctionPlatform !== 'bat' && (
                          <span style={{ fontSize: '7pt', color: 'var(--text-secondary)', fontWeight: 600 }}>
                            {auctionPlatform === 'cars_and_bids' ? 'Cars & Bids' : auctionPlatform}
                          </span>
                        )}
                        {isBid && comment.bid_amount != null && comment.bid_amount > 0 && (
                          <span style={{ 
                            fontSize: '8pt', 
                            fontWeight: 700, 
                            color: '#059669',
                            backgroundColor: '#d1fae5',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            marginLeft: '4px'
                          }}>
                            ${typeof comment.bid_amount === 'number' ? comment.bid_amount.toLocaleString() : String(comment.bid_amount)} BID
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
                        {renderCommentText(comment.comment_text)}
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
          <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border)', position: 'relative' }}>
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Add a comment... (Ctrl+M for memes)"
              rows={2}
              disabled={posting}
              style={{
                width: '100%',
                fontSize: '8pt',
                padding: '6px',
                border: '1px solid var(--border)',
                resize: 'vertical',
                fontFamily: 'inherit',
                marginBottom: '6px'
              }}
            />
            
            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
              <button
                className="button button-secondary"
                style={{ fontSize: '8pt', padding: '4px 12px' }}
                onClick={() => setMemePickerOpen(!memePickerOpen)}
                title="Meme picker (Ctrl+M)"
              >
                Memes
              </button>
              <button
                className="button button-primary"
                style={{ fontSize: '8pt', padding: '4px 12px' }}
                onClick={handlePostComment}
                disabled={posting || !newComment.trim()}
              >
                {posting ? 'Posting...' : 'Post'}
              </button>
            </div>

            {/* Meme Picker Popup */}
            {memePickerOpen && (
              <div style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                right: 0,
                marginBottom: '4px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                zIndex: 1000,
                maxHeight: '240px',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}>
                <div style={{
                  padding: '4px 6px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'var(--grey-100)',
                }}>
                  <span style={{ fontSize: '8pt', fontWeight: 600 }}>Select Meme</span>
                  <button
                    onClick={() => setMemePickerOpen(false)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '8pt',
                      padding: '2px 4px',
                    }}
                  >
                    X
                  </button>
                </div>
                <div style={{
                  padding: '4px',
                  overflowY: 'auto',
                  flex: 1,
                }}>
                  <VehicleMemePanel 
                    vehicleId={vehicleId} 
                    disabled={disabled}
                    onMemeSelect={handleMemeSelect}
                    pickerMode
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default VehicleCommentsCard;

