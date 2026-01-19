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
  updated_at?: string; // For detecting edited comments
  posted_at?: string;
  user_name?: string;
  user_avatar?: string;
  author_username?: string; // For external platform comments (BaT, Cars & Bids, etc.)
  comment_type?: string; // 'bid', 'question', 'observation', etc.
  bid_amount?: number;
  is_seller?: boolean;
  source?: 'nzero' | 'auction' | 'bat' | 'facebook' | 'instagram' | 'sbx' | 'pcar' | 'cars_and_bids'; // All comment sources
  auction_platform?: string | null; // Platform name: 'bat', 'cars_and_bids', 'pcarmarket', 'sbx', 'facebook', 'instagram', etc.
  external_identity_id?: string; // For linking to profiles
  media_urls?: string[]; // For Instagram images, Facebook photos, etc.
  comment_url?: string; // Direct link to original comment
}

interface VehicleCommentsCardProps {
  vehicleId: string;
  session: any;
  collapsed?: boolean;
  maxVisible?: number;
  disabled?: boolean;
  containerId?: string;
  containerClassName?: string;
  containerStyle?: React.CSSProperties;
}

export const VehicleCommentsCard: React.FC<VehicleCommentsCardProps> = ({
  vehicleId,
  session,
  collapsed = true,
  maxVisible = 2,
  disabled = false,
  containerId,
  containerClassName,
  containerStyle,
}) => {
  const navigate = useNavigate();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(!collapsed);
  const [newComment, setNewComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [memePickerOpen, setMemePickerOpen] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [updating, setUpdating] = useState(false);

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
      // Use pagination to fetch all comments (Supabase default limit is 1000, so we fetch in batches)
      const fetchAllComments = async (table: string, select: string, orderBy: string, orderDir: 'asc' | 'desc' = 'desc') => {
        const allResults: any[] = [];
        let offset = 0;
        const batchSize = 1000;
        let hasMore = true;

        while (hasMore) {
          const query = supabase
            .from(table)
            .select(select)
            .eq('vehicle_id', vehicleId)
            .order(orderBy, { ascending: orderDir === 'asc' })
            .range(offset, offset + batchSize - 1);

          const { data, error } = await query;

          if (error) {
            console.warn(`Error fetching ${table}:`, error);
            break;
          }

          if (data && data.length > 0) {
            allResults.push(...data);
            offset += batchSize;
            hasMore = data.length === batchSize; // If we got a full batch, there might be more
          } else {
            hasMore = false;
          }
        }

        return { data: allResults, error: null };
      };

      const [nzeroCommentsResult, auctionCommentsResult, batCommentsResult] = await Promise.all([
        // N-Zero vehicle comments
        fetchAllComments('vehicle_comments', 'id, user_id, comment_text, created_at, updated_at', 'created_at', 'desc'),
        
        // Auction comments (from auction_comments table) - supports: BaT, Cars & Bids, PCar Market, SBX Cars, etc.
        fetchAllComments('auction_comments', 'id, author_username, comment_text, posted_at, comment_type, bid_amount, is_seller, platform, source_url, auction_event_id, external_identity_id, vehicle_id, media_urls', 'posted_at', 'desc'),
        
        // BaT comments (from bat_comments table) - legacy BaT-specific table
        fetchAllComments('bat_comments', 'id, bat_username, comment_text, comment_timestamp, bat_listing_id, vehicle_id, external_identity_id, contains_bid, is_seller_comment, likes_count', 'comment_timestamp', 'desc')
      ]);

      const allComments: Comment[] = [];

      const normalizeExternalPlatform = (raw: any): string | null => {
        if (!raw) return null;
        const s = String(raw);
        if (!s) return null;
        if (s === 'bringatrailer') return 'bat';
        if (s === 'carsandbids') return 'cars_and_bids';
        return s;
      };

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
            const mapped = normalizeExternalPlatform(src);
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
            updated_at: c.updated_at,
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
          const eventPlatform =
            normalizeExternalPlatform(c.platform ? String(c.platform) : null) ||
            normalizeExternalPlatform(auctionEventPlatformMap.get(String(c.auction_event_id))) ||
            null;
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
          const auctionPlatform =
            normalizeExternalPlatform((c as any).platform ? String((c as any).platform) : null) ||
            normalizeExternalPlatform(auctionEventPlatformMap.get(String((c as any).auction_event_id))) ||
            null;

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
          
          // Determine source based on platform
          let commentSource: 'auction' | 'bat' | 'facebook' | 'instagram' | 'sbx' | 'pcar' | 'cars_and_bids' = 'auction';
          if (auctionPlatform === 'bat' || auctionPlatform === 'bringatrailer') {
            commentSource = 'bat';
          } else if (auctionPlatform === 'cars_and_bids' || auctionPlatform === 'carsandbids') {
            commentSource = 'cars_and_bids';
          } else if (auctionPlatform === 'pcarmarket' || auctionPlatform === 'pcar') {
            commentSource = 'pcar';
          } else if (auctionPlatform === 'sbx' || auctionPlatform === 'sbxcars') {
            commentSource = 'sbx';
          } else if (auctionPlatform === 'facebook') {
            commentSource = 'facebook';
          } else if (auctionPlatform === 'instagram') {
            commentSource = 'instagram';
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
            source: commentSource,
            auction_platform: auctionPlatform,
            external_identity_id: identity?.id || c.external_identity_id,
            user_avatar: identity?.profile_url || undefined,
            media_urls: Array.isArray(c.media_urls) ? c.media_urls : undefined,
            comment_url: c.source_url || undefined
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

          const commentText = String(c.comment_text || '');
          const soldMatch = commentText.match(/\bsold\s+for\s+\$?\s*([\d,]+)/i);

          // BaT can set contains_bid=true for "Sold for $X" comments. Treat those as SOLD (not BID).
          let commentType: 'comment' | 'bid' | 'sold' = 'comment';
          let amount: number | undefined = undefined;

          if (soldMatch) {
            commentType = 'sold';
            const n = Number(String(soldMatch[1] || '').replace(/,/g, ''));
            if (!Number.isNaN(n) && n > 0) amount = n;
          } else if (c.contains_bid) {
            commentType = 'bid';
            const bidMatch = commentText.match(/\$?\s*([\d,]+)/);
            if (bidMatch) {
              const n = Number(String(bidMatch[1] || '').replace(/,/g, ''));
              if (!Number.isNaN(n) && n > 0) amount = n;
            }
          }

          allComments.push({
            id: `bat-comment-${c.id}`,
            user_id: identity?.claimed_by_user_id || null,
            author_username: c.bat_username,
            comment_text: commentText,
            created_at: c.comment_timestamp,
            posted_at: c.comment_timestamp,
            user_name: c.bat_username,
            comment_type: commentType,
            bid_amount: amount,
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

  const handleStartEdit = (comment: Comment) => {
    setEditingCommentId(comment.id);
    setEditingText(comment.comment_text);
  };

  const handleCancelEdit = () => {
    setEditingCommentId(null);
    setEditingText('');
  };

  const handleUpdateComment = async (commentId: string) => {
    if (!session?.user?.id || !editingText.trim()) return;

    setUpdating(true);
    try {
      const { error } = await supabase
        .from('vehicle_comments')
        .update({
          comment_text: editingText.trim(),
          updated_at: new Date().toISOString()
        })
        .eq('id', commentId)
        .eq('user_id', session.user.id); // Ensure user owns the comment

      if (!error) {
        setEditingCommentId(null);
        setEditingText('');
        loadComments();
      } else {
        console.error('Failed to update comment:', error);
      }
    } catch (err) {
      console.error('Failed to update comment:', err);
    } finally {
      setUpdating(false);
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
    <div
      id={containerId}
      className={['card', containerClassName].filter(Boolean).join(' ')}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        ...(containerStyle || {}),
      }}
    >
      <div
        className="card-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <div>Comments &amp; Bids ({comments.length})</div>
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
      <div 
        className="card-body comments-scroll-container"
        style={{ 
          flex: '1 1 auto', 
          minHeight: 0, 
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
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
              // Check if this is a bid - either comment_type is 'bid' OR bid_amount is set
              const type = String(comment.comment_type || '').toLowerCase();
              const isSoldComment = type === 'sold';
              const hasBidAmount = comment.bid_amount != null && (typeof comment.bid_amount === 'number' ? comment.bid_amount > 0 : Number(comment.bid_amount) > 0);
              const isBid = type === 'bid' || (!isSoldComment && hasBidAmount);
              const isBaT = comment.source === 'bat';
              const isAuction = comment.source === 'auction';
              const auctionPlatform = (comment as any).auction_platform ? String((comment as any).auction_platform) : null;
              
              // Amount (bid or sold) for display
              const amount = hasBidAmount ? (typeof comment.bid_amount === 'number' ? comment.bid_amount : Number(comment.bid_amount)) : null;
              
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
                      platform={comment.source === 'bat' || comment.source === 'facebook' || comment.source === 'instagram' ? comment.source : undefined}
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
                        {/* Platform badges for all external sources */}
                        {comment.source === 'bat' && (
                          <span style={{ fontSize: '7pt', color: '#2563eb', fontWeight: 600 }}>
                            BaT
                          </span>
                        )}
                        {comment.source === 'auction' && auctionPlatform && (
                          <span style={{ fontSize: '7pt', color: 'var(--text-secondary)', fontWeight: 600 }}>
                            {auctionPlatform === 'cars_and_bids' ? 'Cars & Bids' :
                             auctionPlatform === 'pcarmarket' ? 'PCar Market' :
                             auctionPlatform === 'sbx' ? 'SBX Cars' :
                             auctionPlatform === 'bringatrailer' ? 'BaT' :
                             auctionPlatform}
                          </span>
                        )}
                        {comment.source === 'facebook' && (
                          <span style={{ fontSize: '7pt', color: '#1877f2', fontWeight: 600 }}>
                            Facebook
                          </span>
                        )}
                        {comment.source === 'instagram' && (
                          <span style={{ fontSize: '7pt', color: '#e4405f', fontWeight: 600 }}>
                            Instagram
                          </span>
                        )}
                        {comment.source === 'sbx' && (
                          <span style={{ fontSize: '7pt', color: 'var(--text-secondary)', fontWeight: 600 }}>
                            SBX Cars
                          </span>
                        )}
                        {comment.source === 'pcar' && (
                          <span style={{ fontSize: '7pt', color: 'var(--text-secondary)', fontWeight: 600 }}>
                            PCar Market
                          </span>
                        )}
                        {comment.source === 'cars_and_bids' && (
                          <span style={{ fontSize: '7pt', color: 'var(--text-secondary)', fontWeight: 600 }}>
                            Cars & Bids
                          </span>
                        )}
                        {isSoldComment && (
                          <span style={{
                            fontSize: '8pt',
                            fontWeight: 700,
                            color: '#22c55e',
                            backgroundColor: '#dcfce7',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            marginLeft: '4px'
                          }}>
                            {amount && amount > 0 ? `$${amount.toLocaleString()} SOLD` : 'SOLD'}
                          </span>
                        )}
                        {isBid && amount && amount > 0 && (
                          <span style={{ 
                            fontSize: '8pt', 
                            fontWeight: 700, 
                            color: '#059669',
                            backgroundColor: '#d1fae5',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            marginLeft: '4px'
                          }}>
                            ${amount.toLocaleString()} BID
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
                          {comment.updated_at && comment.updated_at !== comment.created_at && (
                            <span style={{ marginLeft: '4px', fontStyle: 'italic' }}>(edited)</span>
                          )}
                        </span>
                        {/* Edit button - only for user's own N-Zero comments */}
                        {comment.source === 'nzero' && comment.user_id === session?.user?.id && !editingCommentId && (
                          <button
                            onClick={() => handleStartEdit(comment)}
                            style={{
                              fontSize: '7pt',
                              background: 'none',
                              border: 'none',
                              padding: '2px 6px',
                              cursor: 'pointer',
                              color: 'var(--text-muted)',
                              textDecoration: 'underline',
                              marginLeft: '8px'
                            }}
                            title="Edit comment"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                      <div style={{ fontSize: '9pt', lineHeight: 1.4 }}>
                        {editingCommentId === comment.id ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <textarea
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                              rows={3}
                              disabled={updating}
                              style={{
                                width: '100%',
                                fontSize: '8pt',
                                padding: '6px',
                                border: '1px solid var(--border)',
                                resize: 'vertical',
                                fontFamily: 'inherit'
                              }}
                            />
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                onClick={() => handleUpdateComment(comment.id)}
                                disabled={updating || !editingText.trim()}
                                className="button button-primary"
                                style={{ fontSize: '8pt', padding: '4px 12px' }}
                              >
                                {updating ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                onClick={handleCancelEdit}
                                disabled={updating}
                                className="button button-secondary"
                                style={{ fontSize: '8pt', padding: '4px 12px' }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {renderCommentText(comment.comment_text)}
                            {/* Show media URLs for Instagram/Facebook comments */}
                            {comment.media_urls && comment.media_urls.length > 0 && (
                              <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {comment.media_urls.slice(0, 3).map((url, idx) => (
                                  <img
                                    key={idx}
                                    src={url}
                                    alt={`Media ${idx + 1}`}
                                    style={{
                                      maxWidth: '100px',
                                      maxHeight: '100px',
                                      objectFit: 'cover',
                                      borderRadius: '4px',
                                      border: '1px solid var(--border)',
                                      cursor: 'pointer'
                                    }}
                                    onClick={() => window.open(url, '_blank')}
                                  />
                                ))}
                                {comment.media_urls.length > 3 && (
                                  <span style={{ fontSize: '7pt', color: 'var(--text-muted)', alignSelf: 'center' }}>
                                    +{comment.media_urls.length - 3} more
                                  </span>
                                )}
                              </div>
                            )}
                            {/* Link to original comment if available */}
                            {comment.comment_url && (
                              <div style={{ marginTop: '4px' }}>
                                <a
                                  href={comment.comment_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    fontSize: '7pt',
                                    color: 'var(--text-muted)',
                                    textDecoration: 'underline'
                                  }}
                                >
                                  View original →
                                </a>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add comment input (kept outside scroll area so it's always accessible) */}
      {session?.user?.id && (
        <div
          className="card-footer"
          style={{
            position: 'relative',
            flexShrink: 0,
          }}
        >
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
  );
};

export default VehicleCommentsCard;

