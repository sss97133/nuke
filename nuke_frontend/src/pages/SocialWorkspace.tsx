import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

interface FeedItem {
  id: string;
  type: 'viral_opportunity' | 'engagement_update' | 'trending_topic' | 'queued_post' | 'alert';
  source_account?: string;
  content: string;
  engagement?: {
    likes: number;
    retweets: number;
    replies: number;
    views?: number;
  };
  url?: string;
  suggested_reply?: string;
  urgency?: 'now' | 'soon' | 'when_ready';
  relevance_score?: number;
  timestamp: string;
}

interface ConnectedAccount {
  platform: string;
  handle: string;
  connected: boolean;
}

interface EngagementStats {
  total_posts: number;
  viral_posts: number;
  total_likes: number;
  total_retweets: number;
  total_views: number;
}

export default function SocialWorkspace() {
  const [activeTab, setActiveTab] = useState<'feed' | 'compose' | 'queue' | 'analytics'>('feed');
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [composeText, setComposeText] = useState('');
  const [replyingTo, setReplyingTo] = useState<FeedItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedLoading, setFeedLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [stats, setStats] = useState<EngagementStats | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    loadUserAndAccounts();
  }, []);

  useEffect(() => {
    if (userId) {
      loadLiveFeed();
      // Auto-refresh every 60 seconds
      const interval = setInterval(loadLiveFeed, 60000);
      return () => clearInterval(interval);
    }
  }, [userId]);

  const loadUserAndAccounts = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      setUserId(user.id);

      const { data: identities } = await supabase
        .from('external_identities')
        .select('platform, handle, metadata')
        .eq('claimed_by_user_id', user.id)
        .in('platform', ['x', 'instagram', 'threads', 'tiktok', 'youtube']);

      if (identities) {
        setAccounts(identities.map(i => ({
          platform: i.platform,
          handle: i.handle,
          connected: !!i.metadata?.access_token
        })));
      }
    }
    setLoading(false);
  };

  const loadLiveFeed = useCallback(async () => {
    if (!userId) return;
    setFeedLoading(true);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/x-live-feed`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            user_id: userId,
            sections: ['viral', 'engagement', 'trending', 'alerts'],
            generate_replies: true
          })
        }
      );

      const data = await response.json();
      if (data.feed) {
        setFeedItems(data.feed);
      }
      if (data.summary) {
        setStats({
          total_posts: data.summary.total_items || 0,
          viral_posts: data.summary.viral_opportunities || 0,
          total_likes: 0,
          total_retweets: 0,
          total_views: 0
        });
      }
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Failed to load feed:', err);
    } finally {
      setFeedLoading(false);
    }
  }, [userId]);

  const loadEngagementStats = useCallback(async () => {
    if (!userId) return;

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/x-engagement-tracker`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            user_id: userId,
            mode: 'recent',
            hours_back: 168 // 7 days
          })
        }
      );

      const data = await response.json();
      if (data.summary) {
        setStats({
          total_posts: data.summary.total_posts || 0,
          viral_posts: data.summary.viral_posts || 0,
          total_likes: data.summary.total_likes || 0,
          total_retweets: data.summary.total_retweets || 0,
          total_views: data.summary.total_views || 0
        });
      }
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  }, [userId]);

  useEffect(() => {
    if (activeTab === 'analytics' && userId) {
      loadEngagementStats();
    }
  }, [activeTab, userId, loadEngagementStats]);

  const quickReply = (item: FeedItem) => {
    setReplyingTo(item);
    if (item.suggested_reply) {
      setComposeText(item.suggested_reply);
    }
    setActiveTab('compose');
  };

  const postNow = async () => {
    if (!composeText.trim() || !userId) return;
    setPosting(true);

    try {
      // Extract tweet ID from URL if replying
      let replyToId: string | undefined;
      if (replyingTo?.url) {
        const match = replyingTo.url.match(/status\/(\d+)/);
        if (match) replyToId = match[1];
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/x-post`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            user_id: userId,
            text: composeText,
            reply_to: replyToId
          })
        }
      );

      const result = await response.json();
      if (result.success) {
        setComposeText('');
        setReplyingTo(null);
        // Refresh feed to show our new post
        loadLiveFeed();
      } else {
        console.error('Post failed:', result.error);
      }
    } catch (err) {
      console.error('Post failed:', err);
    } finally {
      setPosting(false);
    }
  };

  const formatNumber = (n: number): string => {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  };

  const formatTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  };

  const viralItems = feedItems.filter(f => f.type === 'viral_opportunity');
  const trendingItems = feedItems.filter(f => f.type === 'trending_topic');
  const engagementItems = feedItems.filter(f => f.type === 'engagement_update');
  const alertItems = feedItems.filter(f => f.type === 'alert');

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#0a0a0a',
        color: '#737373'
      }}>
        Loading workspace...
      </div>
    );
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '280px 1fr 320px',
      height: '100vh',
      background: '#0a0a0a',
      color: '#e5e5e5'
    }}>
      {/* Left Sidebar - Accounts & Navigation */}
      <div style={{
        borderRight: '1px solid #262626',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px'
      }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>Social</h1>
          <p style={{ fontSize: '12px', color: '#737373', margin: '4px 0 0 0' }}>Workspace</p>
        </div>

        {/* Connected Accounts */}
        <div>
          <h3 style={{ fontSize: '11px', fontWeight: 600, color: '#737373', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Accounts
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {accounts.length > 0 ? accounts.map(acc => (
              <div key={acc.platform} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 12px',
                background: '#171717',
                borderRadius: '8px'
              }}>
                <span style={{ fontSize: '16px' }}>
                  {acc.platform === 'x' ? 'X' : acc.platform === 'instagram' ? 'IG' : acc.platform}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: 500 }}>@{acc.handle}</div>
                  <div style={{ fontSize: '10px', color: acc.connected ? '#22c55e' : '#737373' }}>
                    {acc.connected ? 'Connected' : 'Disconnected'}
                  </div>
                </div>
              </div>
            )) : (
              <div style={{ padding: '20px', textAlign: 'center', color: '#525252', fontSize: '12px' }}>
                No accounts connected
              </div>
            )}
            <button
              onClick={() => window.location.href = '/profile'}
              style={{
                padding: '10px',
                background: 'transparent',
                border: '1px dashed #404040',
                borderRadius: '8px',
                color: '#737373',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              + Connect Account
            </button>
          </div>
        </div>

        {/* Navigation */}
        <div>
          <h3 style={{ fontSize: '11px', fontWeight: 600, color: '#737373', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Workspace
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {[
              { id: 'feed', label: 'Viral Feed', badge: viralItems.length > 0 ? viralItems.filter(v => v.urgency === 'now').length : 0 },
              { id: 'compose', label: 'Compose', badge: 0 },
              { id: 'queue', label: 'Queue', badge: 0 },
              { id: 'analytics', label: 'Analytics', badge: 0 }
            ].map(item => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as any)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  background: activeTab === item.id ? '#262626' : 'transparent',
                  border: 'none',
                  borderRadius: '8px',
                  color: activeTab === item.id ? '#fff' : '#a3a3a3',
                  fontSize: '13px',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                {item.label}
                {item.badge > 0 && (
                  <span style={{
                    padding: '2px 6px',
                    background: '#ef4444',
                    borderRadius: '10px',
                    fontSize: '10px',
                    fontWeight: 600,
                    color: '#fff'
                  }}>{item.badge}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Alerts */}
        {alertItems.length > 0 && (
          <div>
            <h3 style={{ fontSize: '11px', fontWeight: 600, color: '#737373', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Alerts
            </h3>
            {alertItems.slice(0, 3).map(alert => (
              <div key={alert.id} style={{
                padding: '10px',
                background: '#171717',
                borderRadius: '8px',
                borderLeft: '3px solid #f59e0b',
                marginBottom: '8px',
                fontSize: '12px'
              }}>
                {alert.content}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* Tab Content */}
        {activeTab === 'feed' && (
          <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Viral Feed</h2>
                <p style={{ fontSize: '12px', color: '#737373', margin: '4px 0 0 0' }}>
                  {feedLoading ? 'Refreshing...' : `Updated ${formatTime(lastRefresh.toISOString())} ago`}
                </p>
              </div>
              <button
                onClick={loadLiveFeed}
                disabled={feedLoading}
                style={{
                  padding: '8px 16px',
                  background: '#262626',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#e5e5e5',
                  fontSize: '12px',
                  cursor: feedLoading ? 'not-allowed' : 'pointer',
                  opacity: feedLoading ? 0.5 : 1
                }}
              >
                Refresh
              </button>
            </div>

            {viralItems.length === 0 && !feedLoading ? (
              <div style={{
                padding: '40px',
                textAlign: 'center',
                color: '#525252',
                background: '#171717',
                borderRadius: '12px'
              }}>
                <div style={{ fontSize: '32px', marginBottom: '12px' }}>No opportunities found</div>
                <div style={{ fontSize: '14px' }}>Connect your X account to see viral content</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {viralItems.map(item => (
                  <div key={item.id} style={{
                    padding: '16px',
                    background: '#171717',
                    borderRadius: '12px',
                    border: item.urgency === 'now' ? '1px solid #f59e0b' : '1px solid #262626'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                      <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '50%',
                        background: '#262626',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '14px',
                        fontWeight: 600
                      }}>
                        {item.source_account?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600 }}>@{item.source_account}</div>
                        <div style={{ fontSize: '11px', color: '#737373' }}>{formatTime(item.timestamp)}</div>
                      </div>
                      {item.urgency === 'now' && (
                        <span style={{
                          padding: '4px 8px',
                          background: '#f59e0b',
                          borderRadius: '4px',
                          fontSize: '10px',
                          fontWeight: 600,
                          color: '#000'
                        }}>HOT</span>
                      )}
                    </div>
                    <div style={{ fontSize: '14px', lineHeight: 1.5, marginBottom: '12px' }}>
                      {item.content}
                    </div>
                    {item.engagement && (
                      <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', fontSize: '12px', color: '#737373' }}>
                        <span>{formatNumber(item.engagement.likes)} likes</span>
                        <span>{formatNumber(item.engagement.retweets)} RTs</span>
                        <span>{formatNumber(item.engagement.replies)} replies</span>
                        {item.engagement.views && <span>{formatNumber(item.engagement.views)} views</span>}
                      </div>
                    )}
                    {item.suggested_reply && (
                      <div style={{
                        padding: '10px',
                        background: '#262626',
                        borderRadius: '6px',
                        marginBottom: '12px',
                        fontSize: '13px',
                        fontStyle: 'italic',
                        color: '#a3a3a3'
                      }}>
                        Suggested: "{item.suggested_reply}"
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => quickReply(item)}
                        style={{
                          padding: '8px 16px',
                          background: '#3b82f6',
                          border: 'none',
                          borderRadius: '6px',
                          color: '#fff',
                          fontSize: '12px',
                          fontWeight: 500,
                          cursor: 'pointer'
                        }}
                      >
                        {item.suggested_reply ? 'Use Reply' : 'Quick Reply'}
                      </button>
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            padding: '8px 16px',
                            background: 'transparent',
                            border: '1px solid #404040',
                            borderRadius: '6px',
                            color: '#a3a3a3',
                            fontSize: '12px',
                            textDecoration: 'none',
                            cursor: 'pointer'
                          }}
                        >
                          View on X
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'compose' && (
          <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
            <div style={{ marginBottom: '20px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Compose</h2>
              <p style={{ fontSize: '12px', color: '#737373', margin: '4px 0 0 0' }}>
                Create and schedule posts
              </p>
            </div>

            {replyingTo && (
              <div style={{
                padding: '12px',
                background: '#171717',
                borderRadius: '8px',
                marginBottom: '16px',
                borderLeft: '3px solid #3b82f6'
              }}>
                <div style={{ fontSize: '11px', color: '#737373', marginBottom: '6px' }}>
                  Replying to @{replyingTo.source_account}
                </div>
                <div style={{ fontSize: '13px', color: '#a3a3a3' }}>
                  {replyingTo.content.substring(0, 150)}...
                </div>
                <button
                  onClick={() => { setReplyingTo(null); setComposeText(''); }}
                  style={{
                    marginTop: '8px',
                    padding: '4px 8px',
                    background: 'transparent',
                    border: '1px solid #404040',
                    borderRadius: '4px',
                    color: '#737373',
                    fontSize: '11px',
                    cursor: 'pointer'
                  }}
                >
                  Cancel reply
                </button>
              </div>
            )}

            <div style={{
              background: '#171717',
              borderRadius: '12px',
              border: '1px solid #262626',
              overflow: 'hidden'
            }}>
              <textarea
                value={composeText}
                onChange={(e) => setComposeText(e.target.value)}
                placeholder={replyingTo ? "Write your reply..." : "What's happening?"}
                style={{
                  width: '100%',
                  minHeight: '150px',
                  padding: '16px',
                  background: 'transparent',
                  border: 'none',
                  color: '#e5e5e5',
                  fontSize: '15px',
                  lineHeight: 1.5,
                  resize: 'none',
                  outline: 'none'
                }}
              />
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 16px',
                borderTop: '1px solid #262626'
              }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button style={{
                    padding: '8px',
                    background: 'transparent',
                    border: 'none',
                    color: '#737373',
                    cursor: 'pointer',
                    fontSize: '16px'
                  }}>IMG</button>
                  <button style={{
                    padding: '8px',
                    background: 'transparent',
                    border: 'none',
                    color: '#737373',
                    cursor: 'pointer',
                    fontSize: '16px'
                  }}>VID</button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{
                    fontSize: '12px',
                    color: composeText.length > 280 ? '#ef4444' : '#737373'
                  }}>
                    {composeText.length}/280
                  </span>
                  <button
                    onClick={postNow}
                    disabled={!composeText.trim() || composeText.length > 280 || posting}
                    style={{
                      padding: '8px 20px',
                      background: composeText.trim() && composeText.length <= 280 && !posting ? '#3b82f6' : '#262626',
                      border: 'none',
                      borderRadius: '20px',
                      color: '#fff',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: composeText.trim() && composeText.length <= 280 && !posting ? 'pointer' : 'not-allowed'
                    }}
                  >
                    {posting ? 'Posting...' : 'Post'}
                  </button>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '20px' }}>
              <h3 style={{ fontSize: '12px', color: '#737373', marginBottom: '12px' }}>Quick responses</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {[
                  "...to buy some trucks",
                  "this is the way",
                  "she ready",
                  "if you know you know",
                  "LS swap everything"
                ].map(q => (
                  <button
                    key={q}
                    onClick={() => setComposeText(composeText ? `${composeText} ${q}` : q)}
                    style={{
                      padding: '8px 12px',
                      background: '#262626',
                      border: 'none',
                      borderRadius: '20px',
                      color: '#a3a3a3',
                      fontSize: '12px',
                      cursor: 'pointer'
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'queue' && (
          <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
            <div style={{ marginBottom: '20px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Queue</h2>
              <p style={{ fontSize: '12px', color: '#737373', margin: '4px 0 0 0' }}>
                Scheduled posts
              </p>
            </div>
            <div style={{
              padding: '40px',
              textAlign: 'center',
              color: '#525252',
              background: '#171717',
              borderRadius: '12px'
            }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>No scheduled posts</div>
              <div style={{ fontSize: '12px', color: '#404040', marginTop: '4px' }}>
                Schedule posts for optimal times
              </div>
            </div>
          </div>
        )}

        {activeTab === 'analytics' && (
          <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
            <div style={{ marginBottom: '20px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Analytics</h2>
              <p style={{ fontSize: '12px', color: '#737373', margin: '4px 0 0 0' }}>
                Track engagement (last 7 days)
              </p>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '12px'
            }}>
              {[
                { label: 'Posts', value: stats?.total_posts || 0 },
                { label: 'Viral Posts', value: stats?.viral_posts || 0 },
                { label: 'Total Likes', value: stats?.total_likes || 0 },
                { label: 'Total Views', value: stats?.total_views || 0 }
              ].map(stat => (
                <div key={stat.label} style={{
                  padding: '20px',
                  background: '#171717',
                  borderRadius: '12px'
                }}>
                  <div style={{ fontSize: '12px', color: '#737373' }}>{stat.label}</div>
                  <div style={{ fontSize: '28px', fontWeight: 600, marginTop: '4px' }}>
                    {formatNumber(stat.value)}
                  </div>
                </div>
              ))}
            </div>

            {engagementItems.length > 0 && (
              <div style={{ marginTop: '24px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Recent Performance</h3>
                {engagementItems.slice(0, 5).map(item => (
                  <div key={item.id} style={{
                    padding: '12px',
                    background: '#171717',
                    borderRadius: '8px',
                    marginBottom: '8px'
                  }}>
                    <div style={{ fontSize: '13px', marginBottom: '8px' }}>
                      {item.content.substring(0, 100)}...
                    </div>
                    {item.engagement && (
                      <div style={{ display: 'flex', gap: '12px', fontSize: '12px', color: '#737373' }}>
                        <span>{formatNumber(item.engagement.likes)} likes</span>
                        <span>{formatNumber(item.engagement.retweets)} RTs</span>
                        {item.engagement.views && <span>{formatNumber(item.engagement.views)} views</span>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right Sidebar - Context & Trends */}
      <div style={{
        borderLeft: '1px solid #262626',
        padding: '20px',
        overflow: 'auto'
      }}>
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Trending Now</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {trendingItems.length > 0 ? trendingItems.slice(0, 10).map(t => (
              <div key={t.id} style={{
                padding: '12px',
                background: '#171717',
                borderRadius: '8px',
                cursor: 'pointer'
              }} onClick={() => {
                if (t.url) window.open(t.url, '_blank');
              }}>
                <div style={{ fontSize: '13px', fontWeight: 500 }}>{t.content}</div>
                {t.engagement?.views && t.engagement.views > 0 && (
                  <div style={{ fontSize: '11px', color: '#737373' }}>
                    {formatNumber(t.engagement.views)} posts
                  </div>
                )}
              </div>
            )) : (
              ['#SquareBody', '#ClassicCars', '#Restomod', '#ProjectCar', '#CarTwitter'].map(topic => (
                <div key={topic} style={{
                  padding: '12px',
                  background: '#171717',
                  borderRadius: '8px'
                }}>
                  <div style={{ fontSize: '13px', fontWeight: 500 }}>{topic}</div>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Watch List</h3>
          <p style={{ fontSize: '11px', color: '#525252', marginBottom: '12px' }}>
            High-value accounts being monitored
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {['elonmusk', 'DougDeMuro', 'VINwiki', 'Hagerty', 'bringatrailer'].map(handle => (
              <div key={handle} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px',
                background: '#171717',
                borderRadius: '8px'
              }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: '#262626',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px'
                }}>
                  {handle[0].toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '12px', fontWeight: 500 }}>@{handle}</div>
                </div>
                <a
                  href={`https://x.com/${handle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: '10px',
                    color: '#3b82f6',
                    textDecoration: 'none'
                  }}
                >
                  View
                </a>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
