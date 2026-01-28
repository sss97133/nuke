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
  author_avatar?: string;
  handle: string;
  text: string;
  likes: number;
  retweets: number;
  replies: number;
  posted_at: string;
  url?: string;
}

// Resizable panel hook
function useResizable(initialWidth: number, minWidth: number, maxWidth: number) {
  const [width, setWidth] = useState(initialWidth);
  const isResizing = useRef(false);

  const startResize = useCallback((e: React.MouseEvent) => {
    isResizing.current = true;
    e.preventDefault();
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.min(maxWidth, Math.max(minWidth, e.clientX));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [minWidth, maxWidth]);

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
  const leftPanel = useResizable(280, 200, 400);
  const rightPanel = useResizable(360, 280, 500);

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

    // Load connected accounts
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

    // Load user's vehicles with correct column names
    const { data: userVehicles, error: vehiclesError } = await supabase
      .from('vehicles')
      .select('id, year, make, model, engine_type, transmission, color, mileage, notes')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false });

    if (vehiclesError) {
      console.error('Failed to load vehicles:', vehiclesError);
    }

    if (userVehicles) {
      // Get all images for vehicles
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

      // Add thumbnails and image arrays to vehicles
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
      if (selectedVehicle.notes) vehicleDetails.push(selectedVehicle.notes);

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
          source: post.hook_type || 'AI Generated',
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

      if (result.error) {
        console.error('Meme generation error:', result.error);
        await generateContent();
        return;
      }

      if (result.posts) {
        const newSuggestions: ContentSuggestion[] = result.posts.map((post: any, i: number) => ({
          id: `meme-${Date.now()}-${i}`,
          text: post.text,
          images: images,
          source: `Grok: ${post.format}`,
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
      await generateContent();
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
            message: "What are the top 5 viral car posts on X right now? Give me the authors, engagement numbers, and what makes them work. Format as a list.",
            conversation_history: []
          })
        }
      );

      const result = await response.json();

      // Parse Grok's response into viral posts (mock structure since we can't fetch real posts without premium API)
      // In production, this would use X API v2 with academic/enterprise access
      if (result.reply) {
        // Store as a single "insight" post for now
        setViralPosts([{
          id: 'grok-insight',
          author: 'Grok Analysis',
          handle: 'grok',
          text: result.reply,
          likes: 0,
          retweets: 0,
          replies: 0,
          posted_at: new Date().toISOString()
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
        setReplyDrafts(prev => ({
          ...prev,
          [post.id]: result.replies[0].text
        }));
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
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#000',
        color: '#71767b'
      }}>
        Loading...
      </div>
    );
  }

  const hoveredVehicleData = vehicles.find(v => v.id === hoveredVehicle);

  return (
    <div style={{ minHeight: '100vh', background: '#000', color: '#e7e9ea' }}>
      {/* Header */}
      <div style={{
        borderBottom: '1px solid #2f3336',
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(12px)',
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {xAccount?.avatar ? (
              <img src={xAccount.avatar} alt="" style={{ width: '32px', height: '32px', borderRadius: '50%' }} />
            ) : (
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#333' }} />
            )}
            <div>
              <div style={{ fontSize: '15px', fontWeight: 700 }}>Content Studio</div>
              <div style={{ fontSize: '13px', color: '#71767b' }}>
                {xAccount ? `@${xAccount.handle}` : 'Connect X'}
                {xAccount?.connected && <span style={{ color: '#00ba7c', marginLeft: '6px' }}>●</span>}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '2px', background: '#16181c', padding: '4px', borderRadius: '9999px' }}>
            {(['create', 'engage', 'viral', 'grok'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab);
                  if (tab === 'engage' && engagementPosts.length === 0) findPostsToEngage();
                  if (tab === 'viral' && viralPosts.length === 0) findViralPosts();
                }}
                style={{
                  padding: '8px 16px',
                  background: activeTab === tab ? '#eff3f4' : 'transparent',
                  color: activeTab === tab ? '#0f1419' : '#71767b',
                  border: 'none',
                  borderRadius: '9999px',
                  fontSize: '14px',
                  fontWeight: activeTab === tab ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontSize: '13px', color: '#71767b' }}>
            {vehicles.length} vehicles · {recentImages.length} photos
          </div>
        </div>
      </div>

      {activeTab === 'create' ? (
        <div style={{ display: 'flex', height: 'calc(100vh - 57px)' }}>
          {/* Left Panel - Vehicles */}
          <div
            style={{
              width: leftPanel.width,
              borderRight: '1px solid #2f3336',
              background: '#000',
              overflow: 'auto',
              flexShrink: 0
            }}
          >
            <div style={{ padding: '16px' }}>
              <div style={{
                fontSize: '13px',
                fontWeight: 700,
                color: '#71767b',
                marginBottom: '16px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                Your Builds
              </div>

              {vehicles.length === 0 ? (
                <div style={{ color: '#71767b', fontSize: '14px', padding: '20px 0' }}>
                  No vehicles yet
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {vehicles.map(v => (
                    <div
                      key={v.id}
                      onClick={() => setSelectedVehicle(v)}
                      onMouseEnter={(e) => handleVehicleHover(v.id, e)}
                      onMouseLeave={() => setHoveredVehicle(null)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        background: selectedVehicle?.id === v.id ? '#1d9bf0' : 'transparent',
                        transition: 'background 0.15s'
                      }}
                      onMouseOver={(e) => {
                        if (selectedVehicle?.id !== v.id) {
                          e.currentTarget.style.background = '#16181c';
                        }
                      }}
                      onMouseOut={(e) => {
                        if (selectedVehicle?.id !== v.id) {
                          e.currentTarget.style.background = 'transparent';
                        }
                      }}
                    >
                      {v.thumbnail ? (
                        <img
                          src={v.thumbnail}
                          alt=""
                          style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: '8px',
                            objectFit: 'cover',
                            border: selectedVehicle?.id === v.id ? '2px solid #fff' : 'none'
                          }}
                        />
                      ) : (
                        <div style={{
                          width: '48px',
                          height: '48px',
                          borderRadius: '8px',
                          background: '#2f3336',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '20px'
                        }}>
                          🚗
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: '15px',
                          fontWeight: 700,
                          color: selectedVehicle?.id === v.id ? '#fff' : '#e7e9ea'
                        }}>
                          {v.year} {v.make}
                        </div>
                        <div style={{
                          fontSize: '13px',
                          color: selectedVehicle?.id === v.id ? 'rgba(255,255,255,0.8)' : '#71767b'
                        }}>
                          {v.model}
                        </div>
                        {v.engine_type && (
                          <div style={{
                            fontSize: '12px',
                            color: selectedVehicle?.id === v.id ? 'rgba(255,255,255,0.6)' : '#536471',
                            marginTop: '2px'
                          }}>
                            {v.engine_type}
                          </div>
                        )}
                      </div>
                      <div style={{
                        fontSize: '12px',
                        color: selectedVehicle?.id === v.id ? 'rgba(255,255,255,0.6)' : '#536471'
                      }}>
                        {v.images?.length || 0}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Photo Grid */}
            <div style={{ padding: '16px', borderTop: '1px solid #2f3336' }}>
              <div style={{
                fontSize: '13px',
                fontWeight: 700,
                color: '#71767b',
                marginBottom: '12px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                Photos
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '2px',
                borderRadius: '12px',
                overflow: 'hidden'
              }}>
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
                      cursor: 'pointer',
                      opacity: composeImages.includes(img.image_url) ? 0.5 : 1,
                      transition: 'opacity 0.15s'
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
                width: '4px',
                cursor: 'col-resize',
                background: 'transparent'
              }}
              onMouseOver={(e) => e.currentTarget.style.background = '#1d9bf0'}
              onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
            />
          </div>

          {/* Center - Composer */}
          <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
            {/* Generate Buttons */}
            {selectedVehicle && (
              <div style={{ marginBottom: '20px' }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  marginBottom: '16px'
                }}>
                  <div style={{
                    fontSize: '18px',
                    fontWeight: 700
                  }}>
                    {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}
                  </div>
                  {selectedVehicle.engine_type && (
                    <span style={{
                      fontSize: '13px',
                      color: '#71767b',
                      background: '#16181c',
                      padding: '4px 10px',
                      borderRadius: '9999px'
                    }}>
                      {selectedVehicle.engine_type}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                  <button
                    onClick={generateContent}
                    disabled={generating}
                    style={{
                      flex: 1,
                      padding: '14px 20px',
                      background: '#eff3f4',
                      color: '#0f1419',
                      border: 'none',
                      borderRadius: '9999px',
                      fontSize: '15px',
                      fontWeight: 700,
                      cursor: generating ? 'not-allowed' : 'pointer',
                      opacity: generating ? 0.5 : 1,
                      transition: 'opacity 0.15s'
                    }}
                  >
                    {generating ? 'Generating...' : 'Generate Captions'}
                  </button>
                  <button
                    onClick={generateMeme}
                    disabled={generating}
                    style={{
                      flex: 1,
                      padding: '14px 20px',
                      background: 'linear-gradient(135deg, #1d9bf0 0%, #7856ff 100%)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '9999px',
                      fontSize: '15px',
                      fontWeight: 700,
                      cursor: generating ? 'not-allowed' : 'pointer',
                      opacity: generating ? 0.5 : 1,
                      transition: 'opacity 0.15s'
                    }}
                  >
                    {generating ? 'Creating...' : 'Ask Grok'}
                  </button>
                </div>
              </div>
            )}

            {/* Composer */}
            <div style={{
              background: '#16181c',
              borderRadius: '16px',
              border: '1px solid #2f3336',
              overflow: 'hidden'
            }}>
              <div style={{ display: 'flex', padding: '16px', gap: '12px' }}>
                {xAccount?.avatar ? (
                  <img src={xAccount.avatar} alt="" style={{ width: '40px', height: '40px', borderRadius: '50%' }} />
                ) : (
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#2f3336' }} />
                )}
                <div style={{ flex: 1 }}>
                  <textarea
                    value={composeText}
                    onChange={(e) => setComposeText(e.target.value)}
                    placeholder="What's happening?"
                    style={{
                      width: '100%',
                      minHeight: '120px',
                      background: 'transparent',
                      border: 'none',
                      fontSize: '20px',
                      color: '#e7e9ea',
                      resize: 'none',
                      outline: 'none',
                      fontFamily: 'inherit',
                      lineHeight: 1.4
                    }}
                  />

                  {composeImages.length > 0 && (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: composeImages.length === 1 ? '1fr' : 'repeat(2, 1fr)',
                      gap: '4px',
                      marginTop: '12px',
                      borderRadius: '16px',
                      overflow: 'hidden'
                    }}>
                      {composeImages.map((img, i) => (
                        <div key={i} style={{ position: 'relative' }}>
                          <img
                            src={img}
                            alt=""
                            style={{
                              width: '100%',
                              height: composeImages.length === 1 ? '300px' : '150px',
                              objectFit: 'cover'
                            }}
                          />
                          <button
                            onClick={() => setComposeImages(prev => prev.filter((_, idx) => idx !== i))}
                            style={{
                              position: 'absolute',
                              top: '8px',
                              right: '8px',
                              width: '28px',
                              height: '28px',
                              borderRadius: '50%',
                              background: 'rgba(15,20,25,0.75)',
                              color: '#fff',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: '16px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 16px',
                borderTop: '1px solid #2f3336'
              }}>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    background: 'transparent',
                    border: 'none',
                    color: '#1d9bf0',
                    cursor: 'pointer',
                    fontSize: '18px'
                  }}>
                    🖼️
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    border: `2px solid ${composeText.length > 280 ? '#f4212e' : composeText.length > 260 ? '#ffd400' : '#2f3336'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '10px',
                    color: composeText.length > 280 ? '#f4212e' : '#71767b'
                  }}>
                    {composeText.length > 260 && (280 - composeText.length)}
                  </div>

                  <button
                    onClick={postNow}
                    disabled={!composeText.trim() || composeText.length > 280 || posting || !xAccount?.connected}
                    style={{
                      padding: '10px 20px',
                      background: composeText.trim() && composeText.length <= 280 && !posting && xAccount?.connected
                        ? '#eff3f4'
                        : '#787a7a',
                      color: composeText.trim() && composeText.length <= 280 && !posting && xAccount?.connected
                        ? '#0f1419'
                        : '#0f1419',
                      border: 'none',
                      borderRadius: '9999px',
                      fontSize: '15px',
                      fontWeight: 700,
                      cursor: composeText.trim() && composeText.length <= 280 && !posting && xAccount?.connected
                        ? 'pointer'
                        : 'not-allowed',
                      opacity: composeText.trim() && composeText.length <= 280 && !posting && xAccount?.connected ? 1 : 0.5
                    }}
                  >
                    {posting ? 'Posting...' : 'Post'}
                  </button>
                </div>
              </div>
            </div>

            {/* AI Generated Image */}
            {generatedImage && (
              <div style={{ marginTop: '20px' }}>
                <div style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color: '#7856ff',
                  marginBottom: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <span>✨</span> Grok Generated
                </div>
                <div style={{
                  position: 'relative',
                  borderRadius: '16px',
                  overflow: 'hidden',
                  border: '2px solid #7856ff'
                }}>
                  <img src={generatedImage} alt="Generated" style={{ width: '100%', display: 'block' }} />
                  <button
                    onClick={() => {
                      if (!composeImages.includes(generatedImage)) {
                        setComposeImages(prev => [generatedImage, ...prev]);
                      }
                    }}
                    style={{
                      position: 'absolute',
                      bottom: '12px',
                      right: '12px',
                      padding: '10px 20px',
                      background: composeImages.includes(generatedImage) ? '#00ba7c' : '#eff3f4',
                      color: composeImages.includes(generatedImage) ? '#fff' : '#0f1419',
                      border: 'none',
                      borderRadius: '9999px',
                      fontSize: '14px',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    {composeImages.includes(generatedImage) ? '✓ Added' : 'Use This'}
                  </button>
                </div>
              </div>
            )}

            {/* Preview */}
            {composeText && (
              <div style={{ marginTop: '24px' }}>
                <div style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color: '#71767b',
                  marginBottom: '12px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  Preview
                </div>
                <div style={{
                  background: '#16181c',
                  borderRadius: '16px',
                  border: '1px solid #2f3336',
                  padding: '16px'
                }}>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    {xAccount?.avatar ? (
                      <img src={xAccount.avatar} alt="" style={{ width: '40px', height: '40px', borderRadius: '50%' }} />
                    ) : (
                      <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#2f3336' }} />
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ fontWeight: 700, fontSize: '15px' }}>{xAccount?.handle || 'You'}</span>
                        <span style={{ color: '#71767b', fontSize: '15px' }}>@{xAccount?.handle || 'handle'}</span>
                        <span style={{ color: '#71767b' }}>·</span>
                        <span style={{ color: '#71767b', fontSize: '15px' }}>now</span>
                      </div>
                      <div style={{ marginTop: '4px', fontSize: '15px', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
                        {composeText}
                      </div>
                      {composeImages.length > 0 && (
                        <div style={{
                          marginTop: '12px',
                          display: 'grid',
                          gridTemplateColumns: composeImages.length === 1 ? '1fr' : 'repeat(2, 1fr)',
                          gap: '4px',
                          borderRadius: '16px',
                          overflow: 'hidden'
                        }}>
                          {composeImages.slice(0, 4).map((img, i) => (
                            <img
                              key={i}
                              src={img}
                              alt=""
                              style={{
                                width: '100%',
                                height: composeImages.length === 1 ? '280px' : '140px',
                                objectFit: 'cover'
                              }}
                            />
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
            borderLeft: '1px solid #2f3336',
            background: '#000',
            overflow: 'auto',
            flexShrink: 0,
            position: 'relative'
          }}>
            {/* Resize Handle */}
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startWidth = rightPanel.width;

                const handleMouseMove = (e: MouseEvent) => {
                  const delta = startX - e.clientX;
                  const newWidth = Math.min(500, Math.max(280, startWidth + delta));
                  // Can't update rightPanel width directly, need to manage differently
                };

                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', () => {
                  document.removeEventListener('mousemove', handleMouseMove);
                }, { once: true });
              }}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: '4px',
                cursor: 'col-resize',
                background: 'transparent'
              }}
              onMouseOver={(e) => e.currentTarget.style.background = '#1d9bf0'}
              onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
            />

            <div style={{ padding: '16px' }}>
              <div style={{
                fontSize: '13px',
                fontWeight: 700,
                color: '#71767b',
                marginBottom: '16px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                Generated Content
              </div>

              {suggestions.length === 0 ? (
                <div style={{
                  color: '#71767b',
                  fontSize: '14px',
                  padding: '40px 20px',
                  textAlign: 'center',
                  background: '#16181c',
                  borderRadius: '16px'
                }}>
                  Select a vehicle and generate content
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {suggestions.map(s => (
                    <div
                      key={s.id}
                      onClick={() => selectSuggestion(s)}
                      style={{
                        padding: '16px',
                        borderRadius: '16px',
                        border: selectedContent?.id === s.id ? '2px solid #1d9bf0' : '1px solid #2f3336',
                        cursor: 'pointer',
                        background: selectedContent?.id === s.id ? '#16181c' : 'transparent',
                        transition: 'all 0.15s'
                      }}
                    >
                      <div style={{
                        fontSize: '15px',
                        lineHeight: 1.4,
                        marginBottom: '8px',
                        color: '#e7e9ea'
                      }}>
                        {s.text}
                      </div>
                      <div style={{
                        fontSize: '13px',
                        color: '#71767b',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}>
                        <span style={{
                          background: '#16181c',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '12px'
                        }}>
                          {s.source}
                        </span>
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
        <div style={{ height: 'calc(100vh - 57px)', overflow: 'auto', padding: '20px' }}>
          <div style={{ maxWidth: '700px', margin: '0 auto' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '24px'
            }}>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>Engage</h2>
                <p style={{ fontSize: '14px', color: '#71767b', marginTop: '4px' }}>
                  Reply to posts to grow your following
                </p>
              </div>
              <button
                onClick={findPostsToEngage}
                disabled={loadingEngagement}
                style={{
                  padding: '10px 20px',
                  background: '#eff3f4',
                  color: '#0f1419',
                  border: 'none',
                  borderRadius: '9999px',
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: loadingEngagement ? 'not-allowed' : 'pointer'
                }}
              >
                {loadingEngagement ? 'Searching...' : 'Find Posts'}
              </button>
            </div>

            {engagementPosts.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '80px 20px',
                color: '#71767b',
                background: '#16181c',
                borderRadius: '16px'
              }}>
                {loadingEngagement ? 'Finding posts...' : 'Click "Find Posts" to discover conversations'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {engagementPosts.map(post => (
                  <div
                    key={post.id}
                    style={{
                      background: '#16181c',
                      border: '1px solid #2f3336',
                      borderRadius: '16px',
                      padding: '16px'
                    }}
                  >
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '50%',
                        background: '#2f3336',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '16px'
                      }}>
                        👤
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                          <span style={{ fontWeight: 700, fontSize: '15px' }}>{post.author || 'User'}</span>
                          <span style={{ color: '#71767b', fontSize: '14px' }}>@{post.handle || 'handle'}</span>
                        </div>
                        <div style={{ fontSize: '15px', lineHeight: 1.4 }}>{post.text}</div>
                        <div style={{
                          display: 'flex',
                          gap: '16px',
                          marginTop: '12px',
                          color: '#71767b',
                          fontSize: '13px'
                        }}>
                          <span>💬 {post.replies || 0}</span>
                          <span>🔁 {post.retweets || 0}</span>
                          <span>❤️ {post.likes || 0}</span>
                        </div>
                      </div>
                    </div>

                    {replyDrafts[post.id] ? (
                      <div style={{ marginTop: '16px', marginLeft: '52px' }}>
                        <textarea
                          value={replyDrafts[post.id]}
                          onChange={(e) => setReplyDrafts(prev => ({ ...prev, [post.id]: e.target.value }))}
                          style={{
                            width: '100%',
                            padding: '12px',
                            background: '#000',
                            border: '1px solid #2f3336',
                            borderRadius: '12px',
                            fontSize: '15px',
                            color: '#e7e9ea',
                            minHeight: '80px',
                            resize: 'none',
                            outline: 'none'
                          }}
                        />
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginTop: '12px'
                        }}>
                          <span style={{
                            fontSize: '13px',
                            color: replyDrafts[post.id].length > 280 ? '#f4212e' : '#71767b'
                          }}>
                            {replyDrafts[post.id].length}/280
                          </span>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              onClick={() => generateReplyForPost(post)}
                              style={{
                                padding: '8px 16px',
                                background: 'transparent',
                                border: '1px solid #536471',
                                borderRadius: '9999px',
                                color: '#e7e9ea',
                                fontSize: '14px',
                                fontWeight: 700,
                                cursor: 'pointer'
                              }}
                            >
                              Regenerate
                            </button>
                            <button
                              onClick={() => postReply(post, replyDrafts[post.id])}
                              disabled={!replyDrafts[post.id].trim() || replyDrafts[post.id].length > 280}
                              style={{
                                padding: '8px 16px',
                                background: '#eff3f4',
                                color: '#0f1419',
                                border: 'none',
                                borderRadius: '9999px',
                                fontSize: '14px',
                                fontWeight: 700,
                                cursor: 'pointer'
                              }}
                            >
                              Reply
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ marginTop: '16px', marginLeft: '52px' }}>
                        <button
                          onClick={() => generateReplyForPost(post)}
                          style={{
                            padding: '10px 20px',
                            background: 'linear-gradient(135deg, #1d9bf0 0%, #7856ff 100%)',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '9999px',
                            fontSize: '14px',
                            fontWeight: 700,
                            cursor: 'pointer'
                          }}
                        >
                          Generate Reply
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
        <div style={{ height: 'calc(100vh - 57px)', overflow: 'auto', padding: '20px' }}>
          <div style={{ maxWidth: '700px', margin: '0 auto' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '24px'
            }}>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>Viral Posts</h2>
                <p style={{ fontSize: '14px', color: '#71767b', marginTop: '4px' }}>
                  Learn from what's working on X right now
                </p>
              </div>
              <button
                onClick={findViralPosts}
                disabled={loadingViral}
                style={{
                  padding: '10px 20px',
                  background: 'linear-gradient(135deg, #1d9bf0 0%, #7856ff 100%)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '9999px',
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: loadingViral ? 'not-allowed' : 'pointer'
                }}
              >
                {loadingViral ? 'Analyzing...' : 'Ask Grok'}
              </button>
            </div>

            {viralPosts.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '80px 20px',
                color: '#71767b',
                background: '#16181c',
                borderRadius: '16px'
              }}>
                {loadingViral ? 'Analyzing viral content...' : 'Click "Ask Grok" to see what\'s trending'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {viralPosts.map(post => (
                  <div
                    key={post.id}
                    style={{
                      background: '#16181c',
                      border: '1px solid #2f3336',
                      borderRadius: '16px',
                      padding: '20px'
                    }}
                  >
                    <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                      <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '50%',
                        background: 'linear-gradient(135deg, #1d9bf0 0%, #7856ff 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '20px'
                      }}>
                        ✨
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '15px' }}>{post.author}</div>
                        <div style={{ color: '#71767b', fontSize: '14px' }}>@{post.handle}</div>
                      </div>
                    </div>
                    <div style={{
                      fontSize: '15px',
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap'
                    }}>
                      {post.text}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : userId ? (
        <div style={{ height: 'calc(100vh - 57px)' }}>
          <GrokTerminal userId={userId} />
        </div>
      ) : null}

      {/* Vehicle Hover Preview */}
      {hoveredVehicle && hoveredVehicleData && hoverPosition && (
        <div
          style={{
            position: 'fixed',
            left: hoverPosition.x + 20,
            top: hoverPosition.y - 100,
            background: '#16181c',
            border: '1px solid #2f3336',
            borderRadius: '16px',
            padding: '12px',
            zIndex: 1000,
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            maxWidth: '300px',
            pointerEvents: 'none'
          }}
        >
          {hoveredVehicleData.images && hoveredVehicleData.images.length > 0 ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '4px',
              marginBottom: '12px',
              borderRadius: '12px',
              overflow: 'hidden'
            }}>
              {hoveredVehicleData.images.slice(0, 4).map((img, i) => (
                <img
                  key={i}
                  src={img}
                  alt=""
                  style={{
                    width: '100%',
                    height: '80px',
                    objectFit: 'cover'
                  }}
                />
              ))}
            </div>
          ) : null}
          <div style={{ fontWeight: 700, fontSize: '14px' }}>
            {hoveredVehicleData.year} {hoveredVehicleData.make} {hoveredVehicleData.model}
          </div>
          {hoveredVehicleData.engine_type && (
            <div style={{ fontSize: '13px', color: '#71767b', marginTop: '4px' }}>
              {hoveredVehicleData.engine_type}
            </div>
          )}
          <div style={{ fontSize: '12px', color: '#536471', marginTop: '4px' }}>
            {hoveredVehicleData.images?.length || 0} photos
          </div>
        </div>
      )}
    </div>
  );
}
