import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import GrokTerminal from '../components/GrokTerminal';

interface Vehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  thumbnail?: string;
  engine_type?: string;
  transmission?: string;
  color?: string;
  mileage?: number;
  notes?: string;
  images?: string[];
}

interface VehicleImage {
  id: string;
  image_url: string;
  vehicle_id: string;
  category?: string;
}

interface ContentSuggestion {
  id: string;
  text: string;
  images: string[];
  source: string;
  vehicle?: Vehicle;
}

interface ConnectedAccount {
  platform: string;
  handle: string;
  connected: boolean;
  avatar?: string;
}

interface ViralPost {
  id: string;
  author: string;
  handle: string;
  text: string;
  likes: number;
  retweets: number;
  replies: number;
}

// X Icons as simple SVG components
const IconX = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);

const IconImage = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
    <path d="M21 15l-5-5L5 21"/>
  </svg>
);

const IconSend = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/>
  </svg>
);

const IconReply = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
  </svg>
);

const IconRetweet = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
    <path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
  </svg>
);

const IconHeart = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
  </svg>
);

const IconSparkle = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z"/>
  </svg>
);

// Resizable panel hook
function useResizable(initialWidth: number, minWidth: number, maxWidth: number, side: 'left' | 'right' = 'left') {
  const [width, setWidth] = useState(initialWidth);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(initialWidth);

  const startResize = useCallback((e: React.MouseEvent) => {
    isResizing.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    e.preventDefault();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = side === 'left'
        ? e.clientX - startX.current
        : startX.current - e.clientX;
      const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth.current + delta));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [minWidth, maxWidth, side]);

  return { width, startResize };
}

export default function SocialWorkspace() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [recentImages, setRecentImages] = useState<VehicleImage[]>([]);
  const [suggestions, setSuggestions] = useState<ContentSuggestion[]>([]);
  const [selectedContent, setSelectedContent] = useState<ContentSuggestion | null>(null);
  const [composeText, setComposeText] = useState('');
  const [composeImages, setComposeImages] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'create' | 'engage' | 'viral' | 'grok'>('create');
  const [engagementPosts, setEngagementPosts] = useState<any[]>([]);
  const [loadingEngagement, setLoadingEngagement] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [viralPosts, setViralPosts] = useState<ViralPost[]>([]);
  const [loadingViral, setLoadingViral] = useState(false);
  const [hoveredVehicle, setHoveredVehicle] = useState<string | null>(null);
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number } | null>(null);

  // Resizable panels
  const leftPanel = useResizable(240, 180, 360, 'left');
  const rightPanel = useResizable(320, 240, 440, 'right');

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    setUserId(user.id);

    const { data: identities } = await supabase
      .from('external_identities')
      .select('platform, handle, metadata')
      .eq('claimed_by_user_id', user.id)
      .in('platform', ['x']);

    if (identities) {
      setAccounts(identities.map(i => ({
        platform: i.platform,
        handle: i.handle,
        connected: !!i.metadata?.access_token,
        avatar: i.metadata?.profile_image_url
      })));
    }

    const { data: userVehicles } = await supabase
      .from('vehicles')
      .select('id, year, make, model, engine_type, transmission, color, mileage, notes')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false });

    if (userVehicles) {
      const vehicleIds = userVehicles.map(v => v.id);
      let allImages: VehicleImage[] = [];

      if (vehicleIds.length > 0) {
        const { data: images } = await supabase
          .from('vehicle_images')
          .select('id, image_url, vehicle_id, category')
          .in('vehicle_id', vehicleIds)
          .order('created_at', { ascending: false });

        allImages = images || [];
        setRecentImages(allImages);
      }

      const vehiclesWithImages = userVehicles.map(v => {
        const vehicleImgs = allImages.filter(img => img.vehicle_id === v.id);
        return {
          ...v,
          thumbnail: vehicleImgs[0]?.image_url,
          images: vehicleImgs.map(img => img.image_url)
        };
      });

      setVehicles(vehiclesWithImages);
      if (vehiclesWithImages.length > 0) {
        setSelectedVehicle(vehiclesWithImages[0]);
      }
    }

    setLoading(false);
  };

  const generateContent = async () => {
    if (!selectedVehicle || !userId) return;
    setGenerating(true);

    try {
      const vehicleDetails: string[] = [];
      if (selectedVehicle.engine_type) vehicleDetails.push(`Engine: ${selectedVehicle.engine_type}`);
      if (selectedVehicle.transmission) vehicleDetails.push(`Trans: ${selectedVehicle.transmission}`);
      if (selectedVehicle.color) vehicleDetails.push(`Color: ${selectedVehicle.color}`);
      if (selectedVehicle.mileage) vehicleDetails.push(`${selectedVehicle.mileage.toLocaleString()} miles`);

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-viral-content`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            topic: `${selectedVehicle.year} ${selectedVehicle.make} ${selectedVehicle.model}`,
            vehicle: {
              year: selectedVehicle.year,
              make: selectedVehicle.make,
              model: selectedVehicle.model,
              details: vehicleDetails.join(', ')
            },
            style: 'flex'
          })
        }
      );

      const result = await response.json();
      const images = selectedVehicle.images?.slice(0, 4) || [];

      if (result.posts) {
        const newSuggestions: ContentSuggestion[] = result.posts.map((post: any, i: number) => ({
          id: `gen-${Date.now()}-${i}`,
          text: post.text,
          images: images,
          source: post.hook_type || 'AI',
          vehicle: selectedVehicle
        }));

        setSuggestions(newSuggestions);
        if (newSuggestions.length > 0) {
          setSelectedContent(newSuggestions[0]);
          setComposeText(newSuggestions[0].text);
          setComposeImages(images.slice(0, 2));
        }
      }
    } catch (err) {
      console.error('Failed to generate:', err);
    } finally {
      setGenerating(false);
    }
  };

  const generateMeme = async () => {
    if (!selectedVehicle || !userId) return;
    setGenerating(true);
    setGeneratedImage(null);

    try {
      const images = selectedVehicle.images?.slice(0, 4) || [];

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-meme`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            vehicle: {
              year: selectedVehicle.year,
              make: selectedVehicle.make,
              model: selectedVehicle.model,
              details: selectedVehicle.engine_type || ''
            },
            style: 'flex',
            include_image: true
          })
        }
      );

      const result = await response.json();

      if (result.posts) {
        const newSuggestions: ContentSuggestion[] = result.posts.map((post: any, i: number) => ({
          id: `meme-${Date.now()}-${i}`,
          text: post.text,
          images: images,
          source: `Grok`,
          vehicle: selectedVehicle
        }));

        setSuggestions(newSuggestions);

        if (result.images?.[0]?.url) {
          setGeneratedImage(result.images[0].url);
          setComposeImages([result.images[0].url]);
        } else {
          setComposeImages(images.slice(0, 2));
        }

        if (newSuggestions.length > 0) {
          setSelectedContent(newSuggestions[0]);
          setComposeText(newSuggestions[0].text);
        }
      }
    } catch (err) {
      console.error('Meme generation failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  const selectSuggestion = (suggestion: ContentSuggestion) => {
    setSelectedContent(suggestion);
    setComposeText(suggestion.text);
    setComposeImages(suggestion.images);
  };

  const findViralPosts = async () => {
    if (!userId) return;
    setLoadingViral(true);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/grok-agent`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            user_id: userId,
            message: "What are the top 5 viral car posts on X right now? Give me the authors, engagement numbers, and what makes them work.",
            conversation_history: []
          })
        }
      );

      const result = await response.json();
      if (result.reply) {
        setViralPosts([{
          id: 'grok-insight',
          author: 'Grok Analysis',
          handle: 'grok',
          text: result.reply,
          likes: 0,
          retweets: 0,
          replies: 0
        }]);
      }
    } catch (err) {
      console.error('Failed to find viral posts:', err);
    } finally {
      setLoadingViral(false);
    }
  };

  const findPostsToEngage = async () => {
    if (!userId) return;
    setLoadingEngagement(true);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/x-engagement-agent`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            user_id: userId,
            mode: 'find_posts',
            max_replies: 10
          })
        }
      );

      const result = await response.json();
      if (result.posts) {
        setEngagementPosts(result.posts);
      }
    } catch (err) {
      console.error('Failed to find posts:', err);
    } finally {
      setLoadingEngagement(false);
    }
  };

  const generateReplyForPost = async (post: any) => {
    if (!userId) return;

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/x-engagement-agent`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            user_id: userId,
            mode: 'generate_reply',
            tweet_id: post.id,
            tweet_text: post.text
          })
        }
      );

      const result = await response.json();
      if (result.replies?.[0]) {
        setReplyDrafts(prev => ({ ...prev, [post.id]: result.replies[0].text }));
      }
    } catch (err) {
      console.error('Failed to generate reply:', err);
    }
  };

  const postReply = async (post: any, replyText: string) => {
    if (!userId || !replyText.trim()) return;

    try {
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
            text: replyText,
            reply_to: post.id
          })
        }
      );

      const result = await response.json();
      if (result.success) {
        setEngagementPosts(prev => prev.filter(p => p.id !== post.id));
        setReplyDrafts(prev => {
          const next = { ...prev };
          delete next[post.id];
          return next;
        });
      }
    } catch (err) {
      console.error('Failed to post reply:', err);
    }
  };

  const postNow = async () => {
    if (!composeText.trim() || !userId) return;
    setPosting(true);

    try {
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
            image_urls: composeImages.length > 0 ? composeImages : undefined
          })
        }
      );

      const result = await response.json();
      if (result.success) {
        setComposeText('');
        setComposeImages([]);
        setSelectedContent(null);
      }
    } catch (err) {
      console.error('Post failed:', err);
    } finally {
      setPosting(false);
    }
  };

  const handleVehicleHover = (vehicleId: string, e: React.MouseEvent) => {
    setHoveredVehicle(vehicleId);
    setHoverPosition({ x: e.clientX, y: e.clientY });
  };

  const xAccount = accounts.find(a => a.platform === 'x');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg)', color: 'var(--text-secondary)' }}>
        Loading...
      </div>
    );
  }

  const hoveredVehicleData = vehicles.find(v => v.id === hoveredVehicle);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-family)', fontSize: 'var(--fs-10)' }}>
      {/* Header */}
      <div style={{
        borderBottom: '2px solid var(--border)',
        background: 'var(--surface)',
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <IconX />
            <div>
              <div style={{ fontSize: 'var(--fs-11)', fontWeight: 700 }}>Content Studio</div>
              <div style={{ fontSize: 'var(--fs-9)', color: 'var(--text-secondary)' }}>
                {xAccount ? `@${xAccount.handle}` : 'Connect X'}
                {xAccount?.connected && <span style={{ color: 'var(--success)', marginLeft: '4px' }}>connected</span>}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '2px', background: 'var(--bg)', padding: '2px', borderRadius: 'var(--radius)', border: '2px solid var(--border)' }}>
            {(['create', 'engage', 'viral', 'grok'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab);
                  if (tab === 'engage' && engagementPosts.length === 0) findPostsToEngage();
                  if (tab === 'viral' && viralPosts.length === 0) findViralPosts();
                }}
                className="btn-utility"
                style={{
                  background: activeTab === tab ? 'var(--text)' : 'transparent',
                  color: activeTab === tab ? 'var(--surface)' : 'var(--text-secondary)',
                  border: 'none',
                  padding: '4px 12px',
                  fontSize: 'var(--fs-9)',
                  fontWeight: 600
                }}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div style={{ fontSize: 'var(--fs-9)', color: 'var(--text-secondary)' }}>
          {vehicles.length} vehicles / {recentImages.length} photos
        </div>
      </div>

      {activeTab === 'create' ? (
        <div style={{ display: 'flex', height: 'calc(100vh - 49px)' }}>
          {/* Left Panel - Vehicles */}
          <div style={{
            width: leftPanel.width,
            borderRight: '2px solid var(--border)',
            background: 'var(--surface)',
            overflow: 'auto',
            flexShrink: 0,
            position: 'relative'
          }}>
            <div style={{ padding: '12px' }}>
              <div style={{ fontSize: 'var(--fs-9)', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Vehicles
              </div>

              {vehicles.length === 0 ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-9)', padding: '12px 0' }}>No vehicles</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {vehicles.map(v => (
                    <div
                      key={v.id}
                      onClick={() => setSelectedVehicle(v)}
                      onMouseEnter={(e) => handleVehicleHover(v.id, e)}
                      onMouseLeave={() => setHoveredVehicle(null)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px',
                        borderRadius: 'var(--radius)',
                        cursor: 'pointer',
                        background: selectedVehicle?.id === v.id ? 'var(--text)' : 'transparent',
                        color: selectedVehicle?.id === v.id ? 'var(--surface)' : 'var(--text)',
                        border: '2px solid transparent',
                        transition: 'var(--transition)'
                      }}
                    >
                      {v.thumbnail ? (
                        <img src={v.thumbnail} alt="" style={{ width: '36px', height: '36px', borderRadius: 'var(--radius)', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: '36px', height: '36px', borderRadius: 'var(--radius)', background: 'var(--border)' }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 'var(--fs-10)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {v.year} {v.make}
                        </div>
                        <div style={{ fontSize: 'var(--fs-9)', opacity: 0.7 }}>{v.model}</div>
                      </div>
                      <div style={{ fontSize: 'var(--fs-8)', opacity: 0.5 }}>{v.images?.length || 0}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ padding: '12px', borderTop: '2px solid var(--border)' }}>
              <div style={{ fontSize: 'var(--fs-9)', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Photos
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '2px' }}>
                {recentImages.slice(0, 9).map(img => (
                  <img
                    key={img.id}
                    src={img.image_url}
                    alt=""
                    onClick={() => {
                      if (!composeImages.includes(img.image_url)) {
                        setComposeImages(prev => [...prev, img.image_url]);
                      }
                    }}
                    style={{
                      width: '100%',
                      aspectRatio: '1',
                      objectFit: 'cover',
                      borderRadius: 'var(--radius)',
                      cursor: 'pointer',
                      opacity: composeImages.includes(img.image_url) ? 0.5 : 1,
                      border: composeImages.includes(img.image_url) ? '2px solid var(--accent)' : '2px solid transparent'
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Resize Handle */}
            <div
              onMouseDown={leftPanel.startResize}
              style={{
                position: 'absolute',
                right: 0,
                top: 0,
                bottom: 0,
                width: '6px',
                cursor: 'col-resize',
                background: 'transparent'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--accent-dim)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            />
          </div>

          {/* Center - Composer */}
          <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
            {selectedVehicle && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <div style={{ fontSize: 'var(--fs-11)', fontWeight: 700 }}>
                    {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}
                  </div>
                  {selectedVehicle.engine_type && (
                    <span style={{ fontSize: 'var(--fs-9)', color: 'var(--text-secondary)', background: 'var(--bg)', padding: '2px 6px', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                      {selectedVehicle.engine_type}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={generateContent} disabled={generating} className="btn-primary" style={{ flex: 1, opacity: generating ? 0.5 : 1 }}>
                    {generating ? 'Generating...' : 'Generate Captions'}
                  </button>
                  <button onClick={generateMeme} disabled={generating} className="btn-primary" style={{ flex: 1, opacity: generating ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                    <IconSparkle /> {generating ? 'Creating...' : 'Ask Grok'}
                  </button>
                </div>
              </div>
            )}

            {/* Composer */}
            <div className="card">
              <div style={{ padding: '12px' }}>
                <textarea
                  value={composeText}
                  onChange={(e) => setComposeText(e.target.value)}
                  placeholder="What's happening?"
                  style={{
                    width: '100%',
                    minHeight: '100px',
                    background: 'var(--bg)',
                    border: '2px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    padding: '8px',
                    fontSize: 'var(--fs-10)',
                    color: 'var(--text)',
                    resize: 'vertical',
                    fontFamily: 'var(--font-family)'
                  }}
                />

                {composeImages.length > 0 && (
                  <div style={{ display: 'flex', gap: '4px', marginTop: '8px', flexWrap: 'wrap' }}>
                    {composeImages.map((img, i) => (
                      <div key={i} style={{ position: 'relative' }}>
                        <img src={img} alt="" style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: 'var(--radius)' }} />
                        <button
                          onClick={() => setComposeImages(prev => prev.filter((_, idx) => idx !== i))}
                          style={{
                            position: 'absolute',
                            top: '-4px',
                            right: '-4px',
                            width: '16px',
                            height: '16px',
                            borderRadius: '50%',
                            background: 'var(--text)',
                            color: 'var(--surface)',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >x</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderTop: '2px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <IconImage />
                  <span style={{ fontSize: 'var(--fs-9)', color: composeText.length > 280 ? 'var(--error)' : 'var(--text-secondary)' }}>
                    {composeText.length}/280
                  </span>
                </div>
                <button
                  onClick={postNow}
                  disabled={!composeText.trim() || composeText.length > 280 || posting || !xAccount?.connected}
                  className="btn-primary"
                  style={{ opacity: (!composeText.trim() || composeText.length > 280 || posting || !xAccount?.connected) ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <IconSend /> {posting ? 'Posting...' : 'Post'}
                </button>
              </div>
            </div>

            {/* Generated Image */}
            {generatedImage && (
              <div style={{ marginTop: '16px' }}>
                <div style={{ fontSize: 'var(--fs-9)', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <IconSparkle /> Grok Generated
                </div>
                <div className="card" style={{ overflow: 'hidden' }}>
                  <img src={generatedImage} alt="Generated" style={{ width: '100%', display: 'block' }} />
                  <div style={{ padding: '8px' }}>
                    <button
                      onClick={() => {
                        if (!composeImages.includes(generatedImage)) {
                          setComposeImages(prev => [generatedImage, ...prev]);
                        }
                      }}
                      className="btn-utility"
                      style={{ width: '100%' }}
                    >
                      {composeImages.includes(generatedImage) ? 'Added' : 'Use This'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Preview */}
            {composeText && (
              <div style={{ marginTop: '16px' }}>
                <div style={{ fontSize: 'var(--fs-9)', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Preview
                </div>
                <div className="card" style={{ padding: '12px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--border)' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 700, fontSize: 'var(--fs-10)' }}>{xAccount?.handle || 'You'}</span>
                        <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-9)' }}>@{xAccount?.handle || 'handle'}</span>
                      </div>
                      <div style={{ fontSize: 'var(--fs-10)', whiteSpace: 'pre-wrap' }}>{composeText}</div>
                      {composeImages.length > 0 && (
                        <div style={{ display: 'grid', gridTemplateColumns: composeImages.length === 1 ? '1fr' : 'repeat(2, 1fr)', gap: '2px', marginTop: '8px', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                          {composeImages.slice(0, 4).map((img, i) => (
                            <img key={i} src={img} alt="" style={{ width: '100%', height: composeImages.length === 1 ? '200px' : '100px', objectFit: 'cover' }} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Panel - Suggestions */}
          <div style={{
            width: rightPanel.width,
            borderLeft: '2px solid var(--border)',
            background: 'var(--surface)',
            overflow: 'auto',
            flexShrink: 0,
            position: 'relative'
          }}>
            {/* Resize Handle */}
            <div
              onMouseDown={rightPanel.startResize}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: '6px',
                cursor: 'col-resize',
                background: 'transparent'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--accent-dim)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            />

            <div style={{ padding: '12px' }}>
              <div style={{ fontSize: 'var(--fs-9)', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Generated
              </div>

              {suggestions.length === 0 ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-9)', padding: '20px', textAlign: 'center', background: 'var(--bg)', borderRadius: 'var(--radius)', border: '2px solid var(--border)' }}>
                  Select a vehicle and generate
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {suggestions.map(s => (
                    <div
                      key={s.id}
                      onClick={() => selectSuggestion(s)}
                      className="card"
                      style={{
                        padding: '10px',
                        cursor: 'pointer',
                        border: selectedContent?.id === s.id ? '2px solid var(--accent)' : '2px solid var(--border)'
                      }}
                    >
                      <div style={{ fontSize: 'var(--fs-10)', marginBottom: '6px' }}>{s.text}</div>
                      <div style={{ fontSize: 'var(--fs-9)', color: 'var(--text-secondary)', display: 'flex', gap: '8px' }}>
                        <span>{s.source}</span>
                        <span>{s.text.length}/280</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : activeTab === 'engage' ? (
        <div style={{ height: 'calc(100vh - 49px)', overflow: 'auto', padding: '16px' }}>
          <div style={{ maxWidth: '600px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <div style={{ fontSize: 'var(--fs-11)', fontWeight: 700 }}>Engage</div>
                <div style={{ fontSize: 'var(--fs-9)', color: 'var(--text-secondary)' }}>Reply to grow your following</div>
              </div>
              <button onClick={findPostsToEngage} disabled={loadingEngagement} className="btn-primary">
                {loadingEngagement ? 'Searching...' : 'Find Posts'}
              </button>
            </div>

            {engagementPosts.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                {loadingEngagement ? 'Finding posts...' : 'Click "Find Posts" to discover conversations'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {engagementPosts.map(post => (
                  <div key={post.id} className="card" style={{ padding: '12px' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--border)' }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                          <span style={{ fontWeight: 700, fontSize: 'var(--fs-10)' }}>{post.author || 'User'}</span>
                          <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-9)' }}>@{post.handle || 'handle'}</span>
                        </div>
                        <div style={{ fontSize: 'var(--fs-10)' }}>{post.text}</div>
                        <div style={{ display: 'flex', gap: '12px', marginTop: '8px', color: 'var(--text-secondary)', fontSize: 'var(--fs-9)' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><IconReply /> {post.replies || 0}</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><IconRetweet /> {post.retweets || 0}</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><IconHeart /> {post.likes || 0}</span>
                        </div>
                      </div>
                    </div>

                    {replyDrafts[post.id] ? (
                      <div style={{ marginTop: '12px', marginLeft: '40px' }}>
                        <textarea
                          value={replyDrafts[post.id]}
                          onChange={(e) => setReplyDrafts(prev => ({ ...prev, [post.id]: e.target.value }))}
                          style={{
                            width: '100%',
                            padding: '8px',
                            background: 'var(--bg)',
                            border: '2px solid var(--border)',
                            borderRadius: 'var(--radius)',
                            fontSize: 'var(--fs-10)',
                            color: 'var(--text)',
                            minHeight: '60px',
                            resize: 'vertical'
                          }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                          <span style={{ fontSize: 'var(--fs-9)', color: replyDrafts[post.id].length > 280 ? 'var(--error)' : 'var(--text-secondary)' }}>
                            {replyDrafts[post.id].length}/280
                          </span>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => generateReplyForPost(post)} className="btn-utility">Regenerate</button>
                            <button onClick={() => postReply(post, replyDrafts[post.id])} disabled={!replyDrafts[post.id].trim() || replyDrafts[post.id].length > 280} className="btn-primary">Reply</button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ marginTop: '12px', marginLeft: '40px' }}>
                        <button onClick={() => generateReplyForPost(post)} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <IconSparkle /> Generate Reply
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : activeTab === 'viral' ? (
        <div style={{ height: 'calc(100vh - 49px)', overflow: 'auto', padding: '16px' }}>
          <div style={{ maxWidth: '600px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <div style={{ fontSize: 'var(--fs-11)', fontWeight: 700 }}>Viral Posts</div>
                <div style={{ fontSize: 'var(--fs-9)', color: 'var(--text-secondary)' }}>Learn from what works</div>
              </div>
              <button onClick={findViralPosts} disabled={loadingViral} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <IconSparkle /> {loadingViral ? 'Analyzing...' : 'Ask Grok'}
              </button>
            </div>

            {viralPosts.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                {loadingViral ? 'Analyzing viral content...' : 'Click "Ask Grok" to see what\'s trending'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {viralPosts.map(post => (
                  <div key={post.id} className="card" style={{ padding: '12px' }}>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--surface)' }}>
                        <IconSparkle />
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 'var(--fs-10)' }}>{post.author}</div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-9)' }}>@{post.handle}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 'var(--fs-10)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{post.text}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : userId ? (
        <div style={{ height: 'calc(100vh - 49px)' }}>
          <GrokTerminal userId={userId} />
        </div>
      ) : null}

      {/* Vehicle Hover Preview */}
      {hoveredVehicle && hoveredVehicleData && hoverPosition && (
        <div
          style={{
            position: 'fixed',
            left: Math.min(hoverPosition.x + 16, window.innerWidth - 220),
            top: Math.max(16, hoverPosition.y - 80),
            background: 'var(--surface)',
            border: '2px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '8px',
            zIndex: 1000,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            width: '200px',
            pointerEvents: 'none'
          }}
        >
          {hoveredVehicleData.images && hoveredVehicleData.images.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '2px', marginBottom: '8px', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
              {hoveredVehicleData.images.slice(0, 4).map((img, i) => (
                <img key={i} src={img} alt="" style={{ width: '100%', height: '48px', objectFit: 'cover' }} />
              ))}
            </div>
          )}
          <div style={{ fontWeight: 700, fontSize: 'var(--fs-10)' }}>
            {hoveredVehicleData.year} {hoveredVehicleData.make} {hoveredVehicleData.model}
          </div>
          {hoveredVehicleData.engine_type && (
            <div style={{ fontSize: 'var(--fs-9)', color: 'var(--text-secondary)', marginTop: '2px' }}>{hoveredVehicleData.engine_type}</div>
          )}
          <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-disabled)', marginTop: '2px' }}>{hoveredVehicleData.images?.length || 0} photos</div>
        </div>
      )}
    </div>
  );
}
