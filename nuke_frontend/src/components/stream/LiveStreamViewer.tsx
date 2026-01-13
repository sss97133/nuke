import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import StreamActionOverlay from './StreamActionOverlay';
import StreamActionPanel from './StreamActionPanel';
import type { StreamActionEvent } from '../../services/streamActionsService';
import StreamTipOverlay, { type StreamTipEvent } from './StreamTipOverlay';
import { StreamTipService } from '../../services/streamTipService';
import { CashflowDealsService, type CashflowDealSummary, type CashflowDealType } from '../../services/cashflowDealsService';
import '../../design-system.css';

interface LiveStream {
  id: string;
  title: string;
  description: string;
  stream_type: string;
  status: string;
  streamer_id: string;
  streamer_name: string;
  streamer_avatar: string;
  viewer_count: number;
  started_at: string;
  hls_url: string;
  tags: string[];
  allow_chat: boolean;
}

interface ChatMessage {
  id: string;
  user_id: string;
  message: string;
  timestamp_offset: number;
  user_name: string;
  user_avatar: string;
  created_at: string;
  message_type?: string;
  donation_cents?: number;
  highlighted?: boolean;
}

interface LiveStreamViewerProps {
  streamId: string;
}

const LiveStreamViewer = ({ streamId }: LiveStreamViewerProps) => {
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [stream, setStream] = useState<LiveStream | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isFollowing, setIsFollowing] = useState(false);
  const [viewerSessionId, setViewerSessionId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [lastActionEvent, setLastActionEvent] = useState<StreamActionEvent | null>(null);
  const [lastTipEvent, setLastTipEvent] = useState<StreamTipEvent | null>(null);
  const [tipAmount, setTipAmount] = useState<string>('1.00');
  const [tipMessage, setTipMessage] = useState<string>('');
  const [tipping, setTipping] = useState(false);
  const [investmentDeals, setInvestmentDeals] = useState<CashflowDealSummary[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(false);
  const [dealError, setDealError] = useState<string | null>(null);
  const [investAmounts, setInvestAmounts] = useState<Record<string, string>>({});
  const [investingDealId, setInvestingDealId] = useState<string | null>(null);
  const [creatingDeal, setCreatingDeal] = useState(false);

  useEffect(() => {
    loadStream();
    joinStream();
    loadChatHistory();

    const subscription = supabase
      .channel(`stream_${streamId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'stream_chat',
          filter: `stream_id=eq.${streamId}`
        },
        (payload) => {
          addChatMessage(payload.new as any);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'stream_action_events',
          filter: `stream_id=eq.${streamId}`
        },
        (payload) => {
          setLastActionEvent(payload.new as any);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'stream_tip_events',
          filter: `stream_id=eq.${streamId}`
        },
        (payload) => {
          setLastTipEvent(payload.new as any);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
      leaveStream();
    };
  }, [streamId]);

  useEffect(() => {
    if (!stream?.streamer_id) return;
    loadInvestmentDeals(stream.streamer_id);
  }, [stream?.streamer_id]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const loadStream = async () => {
    const { data, error } = await supabase
      .from('live_streams')
      .select(`
        *,
        streamer:streamer_id(display_name, avatar_url)
      `)
      .eq('id', streamId)
      .single();

    if (error) {
      console.error('Error loading stream:', error);
    } else {
      setStream({
        ...data,
        streamer_name: data.streamer?.display_name || 'Unknown',
        streamer_avatar: data.streamer?.avatar_url || '',
        viewer_count: 0
      });

      if (data.hls_url && videoRef.current) {
        videoRef.current.src = data.hls_url;
      }
    }
    setLoading(false);
  };

  const joinStream = async () => {
    try {
      const { data, error } = await supabase.rpc('join_stream', {
        stream_id_param: streamId,
        viewer_id_param: user?.id || null
      });

      if (error) {
        console.error('Error joining stream:', error);
      } else {
        setViewerSessionId(data);
      }
    } catch (error) {
      console.error('Join stream error:', error);
    }
  };

  const leaveStream = async () => {
    if (viewerSessionId) {
      await supabase
        .from('stream_viewers')
        .update({
          left_at: new Date().toISOString(),
          watch_time_seconds: Math.floor((Date.now() - new Date(stream?.started_at || Date.now()).getTime()) / 1000)
        })
        .eq('id', viewerSessionId);
    }
  };

  const loadChatHistory = async () => {
    const { data, error } = await supabase
      .from('stream_chat')
      .select(`
        *,
        user:user_id(display_name, avatar_url)
      `)
      .eq('stream_id', streamId)
      .eq('deleted', false)
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) {
      console.error('Error loading chat:', error);
    } else {
      setChatMessages(data?.map(msg => ({
        ...msg,
        user_name: msg.user?.display_name || 'Anonymous',
        user_avatar: msg.user?.avatar_url || ''
      })) || []);
    }
  };

  const addChatMessage = (message: any) => {
    setChatMessages(prev => [...prev, {
      ...message,
      user_name: message.user?.display_name || 'Anonymous',
      user_avatar: message.user?.avatar_url || ''
    }]);
  };

  const sendChatMessage = async () => {
    if (!user || !newMessage.trim() || !stream?.allow_chat) return;

    const streamStartTime = new Date(stream.started_at).getTime();
    const timestampOffset = Math.floor((Date.now() - streamStartTime) / 1000);

    try {
      await supabase.rpc('add_chat_message', {
        stream_id_param: streamId,
        user_id_param: user.id,
        message_param: newMessage.trim(),
        timestamp_offset_param: timestampOffset
      });

      setNewMessage('');
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  const sendTip = async (amountCents: number) => {
    if (!user) return;
    if (!stream) return;
    try {
      setTipping(true);
      const message = tipMessage.trim() || null;
      await StreamTipService.tipStream(streamId, amountCents, message);
      setTipMessage('');
    } catch (error: any) {
      console.error('Tip failed:', error);
      // Avoid noisy UI frameworks here; minimal error
      alert(error?.message || 'Tip failed');
    } finally {
      setTipping(false);
    }
  };

  const parseTipAmountCents = (): number | null => {
    const v = Number(tipAmount);
    if (!Number.isFinite(v) || v <= 0) return null;
    return Math.round(v * 100);
  };

  const loadInvestmentDeals = async (streamerId: string) => {
    try {
      setLoadingDeals(true);
      setDealError(null);
      const deals = await CashflowDealsService.listPublicDealsForUser(streamerId);
      setInvestmentDeals(deals);
    } catch (e: any) {
      console.error('Failed to load investment deals:', e);
      setDealError(e?.message || 'Failed to load deals');
      setInvestmentDeals([]);
    } finally {
      setLoadingDeals(false);
    }
  };

  const investInDeal = async (dealId: string) => {
    if (!user) {
      alert('Please sign in to invest');
      return;
    }

    const raw = (investAmounts[dealId] || '').trim() || '25.00';
    const dollars = Number(raw);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      alert('Enter a valid amount');
      return;
    }

    const cents = Math.round(dollars * 100);

    try {
      setInvestingDealId(dealId);
      await CashflowDealsService.fundDeal(dealId, cents);
      alert('Investment submitted');
    } catch (e: any) {
      console.error('Investment failed:', e);
      alert(e?.message || 'Investment failed');
    } finally {
      setInvestingDealId(null);
    }
  };

  const createDefaultDeal = async (dealType: CashflowDealType) => {
    if (!user || !stream) return;
    if (user.id !== stream.streamer_id) return;

    try {
      setCreatingDeal(true);
      if (dealType === 'advance') {
        await CashflowDealsService.createUserDeal({
          subjectUserId: stream.streamer_id,
          dealType: 'advance',
          title: 'Advance (Recoupable)',
          rateBps: 2000, // 20%
          capMultipleBps: 13000, // 1.30x
          isPublic: true,
        });
      } else {
        await CashflowDealsService.createUserDeal({
          subjectUserId: stream.streamer_id,
          dealType: 'revenue_share',
          title: 'Revenue Share',
          rateBps: 1000, // 10%
          capMultipleBps: null,
          isPublic: true,
        });
      }

      await loadInvestmentDeals(stream.streamer_id);
    } catch (e: any) {
      console.error('Failed to create deal:', e);
      alert(e?.message || 'Failed to create deal');
    } finally {
      setCreatingDeal(false);
    }
  };

  const toggleFollow = async () => {
    if (!user || !stream) return;

    try {
      if (isFollowing) {
        await supabase
          .from('stream_follows')
          .delete()
          .eq('follower_id', user.id)
          .eq('streamer_id', stream.streamer_id);
        setIsFollowing(false);
      } else {
        await supabase
          .from('stream_follows')
          .insert({
            follower_id: user.id,
            streamer_id: stream.streamer_id
          });
        setIsFollowing(true);
      }
    } catch (error) {
      console.error('Error toggling follow:', error);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  if (loading) {
    return (
      <div style={{
        background: 'var(--bg)',
        border: '1px solid #bdbdbd',
        padding: '16px',
        margin: '16px',
        fontSize: '8pt',
        textAlign: 'center'
      }}>
        Loading stream...
      </div>
    );
  }

  if (!stream) {
    return (
      <div style={{
        background: 'var(--bg)',
        border: '1px solid #bdbdbd',
        padding: '16px',
        margin: '16px',
        fontSize: '8pt',
        textAlign: 'center'
      }}>
        Stream not found
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--bg)',
      border: '1px solid #bdbdbd',
      padding: '0px',
      margin: '16px',
      fontFamily: 'Arial, sans-serif'
    }}>
      <div style={{ display: 'flex', height: '600px' }}>
        {/* Video Player */}
        <div style={{ flex: '2', background: 'black', position: 'relative' }}>
          {stream.status === 'live' && stream.hls_url ? (
            <video
              ref={videoRef}
              controls
              autoPlay
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain'
              }}
            />
          ) : (
            <div style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: '8pt'
            }}>
              {stream.status === 'scheduled' ? 'Stream scheduled' : 'Stream offline'}
            </div>
          )}

          {/* Action Overlay */}
          <StreamActionOverlay lastEvent={lastActionEvent} />
          <StreamTipOverlay lastTip={lastTipEvent} />

          {/* Stream Info Overlay */}
          <div style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            background: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '8px',
            fontSize: '8pt',
            maxWidth: '300px'
          }}>
            <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
              {stream.title}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              {stream.streamer_avatar && (
                <img
                  src={stream.streamer_avatar}
                  alt={stream.streamer_name}
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%'
                  }}
                />
              )}
              <span>{stream.streamer_name}</span>
              <span>VIEWERS: {stream.viewer_count}</span>
            </div>
            <div style={{ fontSize: '7pt', color: '#ccc' }}>
              {stream.tags.map(tag => `#${tag}`).join(' ')}
            </div>
          </div>
        </div>

        {/* Chat Panel */}
        {stream.allow_chat && (
          <div style={{
            flex: '1',
            background: 'var(--surface)',
            border: '1px solid #bdbdbd',
            display: 'flex',
            flexDirection: 'column',
            minWidth: '300px'
          }}>
            {/* Chat Header */}
            <div style={{
              background: '#e0e0e0',
              padding: '8px',
              borderBottom: '1px solid #bdbdbd',
              fontSize: '8pt',
              fontWeight: 'bold'
            }}>
              LIVE CHAT
            </div>

            {/* Chat Messages */}
            <div
              ref={chatContainerRef}
              style={{
                flex: '1',
                overflowY: 'auto',
                padding: '8px',
                fontSize: '8pt'
              }}
            >
              {chatMessages.map(msg => (
                <div
                  key={msg.id}
                  style={{
                    marginBottom: '8px',
                    padding: '4px',
                    borderBottom: '1px solid #f0f0f0',
                    background:
                      msg.message_type === 'super_chat' || (msg.donation_cents || 0) > 0
                        ? 'rgba(245, 158, 11, 0.16)'
                        : 'transparent'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                    {msg.user_avatar && (
                      <img
                        src={msg.user_avatar}
                        alt={msg.user_name}
                        style={{
                          width: '12px',
                          height: '12px',
                          borderRadius: '50%'
                        }}
                      />
                    )}
                    <span style={{ fontWeight: 'bold', color: '#424242' }}>
                      {msg.user_name}
                    </span>
                    {(msg.donation_cents || 0) > 0 && (
                      <span style={{ fontSize: '7pt', color: '#92400e', fontWeight: 'bold' }}>
                        TIP ${((msg.donation_cents || 0) / 100).toFixed(2)}
                      </span>
                    )}
                    <span style={{ fontSize: '7pt', color: '#9e9e9e' }}>
                      {formatTimestamp(msg.created_at)}
                    </span>
                  </div>
                  <div>{msg.message}</div>
                </div>
              ))}
            </div>

            {/* Tip Panel */}
            <div style={{ borderTop: '1px solid #bdbdbd', padding: '8px', fontSize: '8pt' }}>
              <div style={{ fontWeight: 'bold', marginBottom: 6 }}>TIP STREAMER</div>
              {!user && (
                <div style={{ color: '#757575' }}>Login to tip.</div>
              )}
              {user && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {[
                      { label: '$1', cents: 100 },
                      { label: '$5', cents: 500 },
                      { label: '$20', cents: 2000 },
                    ].map((b) => (
                      <button
                        key={b.label}
                        onClick={() => sendTip(b.cents)}
                        disabled={tipping}
                        style={{
                          padding: '4px 8px',
                          fontSize: '8pt',
                          border: '1px solid #bdbdbd',
                          background: '#111827',
                          color: 'white',
                          borderRadius: '0px',
                          cursor: 'pointer',
                          opacity: tipping ? 0.7 : 1,
                        }}
                      >
                        {tipping ? 'SENDING...' : b.label}
                      </button>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={tipAmount}
                      onChange={(e) => setTipAmount(e.target.value)}
                      style={{
                        width: 110,
                        padding: '4px',
                        border: '1px solid #bdbdbd',
                        borderRadius: '0px',
                        fontSize: '8pt',
                      }}
                    />
                    <input
                      type="text"
                      value={tipMessage}
                      onChange={(e) => setTipMessage(e.target.value)}
                      placeholder="Message (optional)"
                      style={{
                        flex: 1,
                        padding: '4px',
                        border: '1px solid #bdbdbd',
                        borderRadius: '0px',
                        fontSize: '8pt',
                      }}
                    />
                    <button
                      onClick={() => {
                        const cents = parseTipAmountCents();
                        if (!cents) return;
                        sendTip(cents);
                      }}
                      disabled={tipping || !parseTipAmountCents()}
                      style={{
                        padding: '4px 8px',
                        fontSize: '8pt',
                        border: '1px solid #bdbdbd',
                        background: '#111827',
                        color: 'white',
                        borderRadius: '0px',
                        cursor: 'pointer',
                        opacity: tipping || !parseTipAmountCents() ? 0.6 : 1,
                      }}
                    >
                      {tipping ? 'SENDING...' : 'SEND'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Invest Panel */}
            <div style={{ borderTop: '1px solid #bdbdbd', padding: '8px', fontSize: '8pt' }}>
              <div style={{ fontWeight: 'bold', marginBottom: 6 }}>INVEST</div>
              {loadingDeals && <div style={{ color: '#757575' }}>Loading deals...</div>}
              {dealError && <div style={{ color: '#b91c1c' }}>{dealError}</div>}

              {!loadingDeals && !dealError && investmentDeals.length === 0 && (
                <div style={{ color: '#757575' }}>No public deals.</div>
              )}

              {investmentDeals.map((d) => {
                const ratePct = (Number(d.rate_bps || 0) / 100);
                const capMult = d.cap_multiple_bps ? (Number(d.cap_multiple_bps) / 10000).toFixed(2) : null;
                const amount = investAmounts[d.id] ?? '25.00';
                const investing = investingDealId === d.id;
                const typeLabel = d.deal_type === 'advance' ? 'ADVANCE' : 'REV SHARE';

                return (
                  <div
                    key={d.id}
                    style={{
                      border: '1px solid #bdbdbd',
                      padding: '6px',
                      marginBottom: '6px',
                      background: 'transparent'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontWeight: 'bold' }}>{d.title}</div>
                      <div style={{ fontSize: '7pt', color: '#6b7280', fontWeight: 'bold' }}>{typeLabel}</div>
                    </div>
                    <div style={{ fontSize: '7pt', color: '#6b7280', marginTop: 2 }}>
                      Rate: {ratePct.toFixed(2)}%
                      {capMult ? ` • Cap: ${capMult}x` : ''}
                      {d.term_end_at ? ` • Ends: ${new Date(d.term_end_at).toLocaleDateString()}` : ''}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={amount}
                        onChange={(e) => {
                          const v = e.target.value;
                          setInvestAmounts((prev) => ({ ...prev, [d.id]: v }));
                        }}
                        disabled={!user || investing}
                        style={{
                          width: 110,
                          padding: '4px',
                          border: '1px solid #bdbdbd',
                          borderRadius: '0px',
                          fontSize: '8pt',
                        }}
                      />
                      <button
                        onClick={() => investInDeal(d.id)}
                        disabled={!user || investing}
                        style={{
                          padding: '4px 8px',
                          fontSize: '8pt',
                          border: '1px solid #bdbdbd',
                          background: '#111827',
                          color: 'white',
                          borderRadius: '0px',
                          cursor: 'pointer',
                          opacity: !user || investing ? 0.7 : 1,
                        }}
                      >
                        {investing ? 'INVESTING...' : 'INVEST'}
                      </button>
                    </div>
                  </div>
                );
              })}

              {user && stream && user.id === stream.streamer_id && (
                <div style={{ marginTop: 8, borderTop: '1px solid #e0e0e0', paddingTop: 8 }}>
                  <div style={{ fontWeight: 'bold', marginBottom: 6 }}>CREATE DEAL</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      onClick={() => createDefaultDeal('advance')}
                      disabled={creatingDeal}
                      style={{
                        padding: '4px 8px',
                        fontSize: '8pt',
                        border: '1px solid #bdbdbd',
                        background: '#111827',
                        color: 'white',
                        borderRadius: '0px',
                        cursor: 'pointer',
                        opacity: creatingDeal ? 0.7 : 1,
                      }}
                    >
                      {creatingDeal ? 'CREATING...' : 'CREATE ADVANCE'}
                    </button>
                    <button
                      onClick={() => createDefaultDeal('revenue_share')}
                      disabled={creatingDeal}
                      style={{
                        padding: '4px 8px',
                        fontSize: '8pt',
                        border: '1px solid #bdbdbd',
                        background: '#111827',
                        color: 'white',
                        borderRadius: '0px',
                        cursor: 'pointer',
                        opacity: creatingDeal ? 0.7 : 1,
                      }}
                    >
                      {creatingDeal ? 'CREATING...' : 'CREATE REV SHARE'}
                    </button>
                  </div>
                  <div style={{ color: '#757575', fontSize: '7pt', marginTop: 6 }}>
                    Tips create cashflow events and auto-sweep payouts when deals are active.
                  </div>
                </div>
              )}
            </div>

            {/* Chat Input */}
            {user && (
              <div style={{
                padding: '8px',
                borderTop: '1px solid #bdbdbd',
                display: 'flex',
                gap: '4px'
              }}>
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
                  placeholder="Type a message..."
                  style={{
                    flex: '1',
                    padding: '4px',
                    border: '1px solid #bdbdbd',
                    borderRadius: '0px',
                    fontSize: '8pt'
                  }}
                />
                <button
                  onClick={sendChatMessage}
                  disabled={!newMessage.trim()}
                  style={{
                    padding: '4px 8px',
                    fontSize: '8pt',
                    border: '1px solid #bdbdbd',
                    background: newMessage.trim() ? '#424242' : '#e0e0e0',
                    color: newMessage.trim() ? 'white' : '#9e9e9e',
                    borderRadius: '0px',
                    cursor: newMessage.trim() ? 'pointer' : 'not-allowed'
                  }}
                >
                  Send
                </button>
              </div>
            )}

            {!user && (
              <div style={{
                padding: '8px',
                borderTop: '1px solid #bdbdbd',
                fontSize: '8pt',
                textAlign: 'center',
                color: '#757575'
              }}>
                Login to participate in chat
              </div>
            )}

            {/* Stream Actions (paid overlays) */}
            <StreamActionPanel streamId={streamId} disabled={stream.status !== 'live'} />
          </div>
        )}
      </div>

      {/* Stream Details */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid #bdbdbd',
        padding: '12px',
        fontSize: '8pt'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <h3 style={{ fontSize: '8pt', fontWeight: 'bold', margin: '0' }}>
            {stream.title}
          </h3>
          {user && (
            <button
              onClick={toggleFollow}
              style={{
                padding: '4px 8px',
                fontSize: '8pt',
                border: '1px solid #bdbdbd',
                background: isFollowing ? '#e0e0e0' : '#424242',
                color: isFollowing ? '#424242' : 'white',
                borderRadius: '0px',
                cursor: 'pointer'
              }}
            >
              {isFollowing ? '✓ Following' : '+ Follow'}
            </button>
          )}
        </div>

        {stream.description && (
          <div style={{ marginBottom: '8px', color: '#6b7280' }}>
            {stream.description}
          </div>
        )}

        <div style={{ display: 'flex', gap: '16px', fontSize: '7pt', color: '#6b7280' }}>
          <div>Type: {stream.stream_type.replace('_', ' ')}</div>
          <div>Status: {stream.status}</div>
          {stream.started_at && (
            <div>Started: {new Date(stream.started_at).toLocaleString()}</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LiveStreamViewer;