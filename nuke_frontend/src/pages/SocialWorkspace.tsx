import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import GrokTerminal from '../components/GrokTerminal';

interface Vehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  thumbnail?: string;
  engine?: string;
  transmission?: string;
  exterior_color?: string;
  mileage?: number;
  notes?: string;
}

interface VehicleImage {
  id: string;
  url: string;
  vehicle_id: string;
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
  const [activeTab, setActiveTab] = useState<'create' | 'engage' | 'grok'>('create');
  const [engagementPosts, setEngagementPosts] = useState<any[]>([]);
  const [loadingEngagement, setLoadingEngagement] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [grokMessages, setGrokMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [grokInput, setGrokInput] = useState('');
  const [grokLoading, setGrokLoading] = useState(false);

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
        connected: !!i.metadata?.access_token
      })));
    }

    // Load user's vehicles with all details
    const { data: userVehicles, error: vehiclesError } = await supabase
      .from('vehicles')
      .select('id, year, make, model, engine, transmission, exterior_color, mileage, notes')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false });

    if (vehiclesError) {
      console.error('Failed to load vehicles:', vehiclesError);
    }

    if (userVehicles) {
      // Get thumbnails
      const vehiclesWithThumbs = await Promise.all(
        userVehicles.map(async (v) => {
          const { data: img } = await supabase
            .from('vehicle_images')
            .select('url')
            .eq('vehicle_id', v.id)
            .limit(1)
            .single();
          return { ...v, thumbnail: img?.url };
        })
      );
      setVehicles(vehiclesWithThumbs);

      if (vehiclesWithThumbs.length > 0) {
        setSelectedVehicle(vehiclesWithThumbs[0]);
      }
    }

    // Load recent images across all vehicles (only if we have vehicles)
    if (userVehicles && userVehicles.length > 0) {
      const vehicleIds = userVehicles.map(v => v.id);
      const { data: images, error: imagesError } = await supabase
        .from('vehicle_images')
        .select('id, url, vehicle_id')
        .in('vehicle_id', vehicleIds)
        .order('created_at', { ascending: false })
        .limit(20);

      if (imagesError) {
        console.error('Failed to load vehicle images:', imagesError);
      } else if (images) {
        setRecentImages(images);
      }
    }

    setLoading(false);
  };

  const generateContent = async () => {
    if (!selectedVehicle || !userId) return;
    setGenerating(true);

    try {
      // Get full vehicle details
      const { data: fullVehicle } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', selectedVehicle.id)
        .single();

      // Get vehicle images
      const { data: vehicleImages } = await supabase
        .from('vehicle_images')
        .select('url')
        .eq('vehicle_id', selectedVehicle.id)
        .order('created_at', { ascending: false })
        .limit(10);

      const images = vehicleImages?.map(i => i.url) || [];

      // Build detailed vehicle context
      const vehicleDetails: string[] = [];
      if (fullVehicle?.engine) vehicleDetails.push(`Engine: ${fullVehicle.engine}`);
      if (fullVehicle?.transmission) vehicleDetails.push(`Trans: ${fullVehicle.transmission}`);
      if (fullVehicle?.exterior_color) vehicleDetails.push(`Color: ${fullVehicle.exterior_color}`);
      if (fullVehicle?.mileage) vehicleDetails.push(`${fullVehicle.mileage.toLocaleString()} miles`);
      if (fullVehicle?.notes) vehicleDetails.push(fullVehicle.notes);

      // Call AI to generate content
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

      if (result.posts) {
        const newSuggestions: ContentSuggestion[] = result.posts.map((post: any, i: number) => ({
          id: `gen-${Date.now()}-${i}`,
          text: post.text,
          images: images.slice(0, 2),
          source: post.hook_type || 'AI Generated',
          vehicle: selectedVehicle
        }));

        setSuggestions(newSuggestions);

        // Auto-select first suggestion and attach images
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
      // Get vehicle images as fallback
      const { data: vehicleImages } = await supabase
        .from('vehicle_images')
        .select('url')
        .eq('vehicle_id', selectedVehicle.id)
        .limit(4);

      const images = vehicleImages?.map(i => i.url) || [];

      // Call Grok meme generator
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
              details: selectedVehicle.engine || ''
            },
            style: 'flex',
            include_image: true
          })
        }
      );

      const result = await response.json();

      if (result.error) {
        console.error('Meme generation error:', result.error);
        // Fall back to regular generation
        await generateContent();
        return;
      }

      if (result.posts) {
        const newSuggestions: ContentSuggestion[] = result.posts.map((post: any, i: number) => ({
          id: `meme-${Date.now()}-${i}`,
          text: post.text,
          images: images.slice(0, 2),
          source: `Meme: ${post.format}`,
          vehicle: selectedVehicle
        }));

        setSuggestions(newSuggestions);

        // Use Grok-generated image if available, otherwise use vehicle images
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
      // Fall back to regular generation
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
        // Remove from list
        setEngagementPosts(prev => prev.filter(p => p.id !== post.id));
        setReplyDrafts(prev => {
          const next = { ...prev };
          delete next[post.id];
          return next;
        });
        alert(`Replied! ${result.url}`);
      } else {
        alert(`Failed: ${result.error}`);
      }
    } catch (err) {
      console.error('Failed to post reply:', err);
    }
  };

  const sendToGrok = async () => {
    if (!userId || !grokInput.trim()) return;

    const userMessage = grokInput.trim();
    setGrokInput('');
    setGrokLoading(true);

    // Add user message immediately
    const newMessages = [...grokMessages, { role: 'user' as const, content: userMessage }];
    setGrokMessages(newMessages);

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
            message: userMessage,
            conversation_history: grokMessages
          })
        }
      );

      const result = await response.json();
      if (result.reply) {
        setGrokMessages(prev => [...prev, { role: 'assistant', content: result.reply }]);
      } else if (result.error) {
        setGrokMessages(prev => [...prev, { role: 'assistant', content: `Error: ${result.error}` }]);
      }
    } catch (err) {
      console.error('Grok chat failed:', err);
      setGrokMessages(prev => [...prev, { role: 'assistant', content: 'Failed to connect to Grok' }]);
    } finally {
      setGrokLoading(false);
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
        alert(`Posted! ${result.url}`);
      } else {
        alert(`Failed: ${result.error}`);
      }
    } catch (err) {
      console.error('Post failed:', err);
    } finally {
      setPosting(false);
    }
  };

  const xAccount = accounts.find(a => a.platform === 'x');

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#fafafa' }}>
        Loading your content...
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#fafafa' }}>
      {/* Header */}
      <div style={{
        borderBottom: '1px solid #e5e5e5',
        background: '#fff',
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <div>
            <h1 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Content Studio</h1>
            <div style={{ fontSize: '12px', color: '#737373', marginTop: '2px' }}>
              {xAccount ? `@${xAccount.handle} ${xAccount.connected ? '· Ready' : '· Reconnect needed'}` : 'Connect X to post'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '4px', background: '#f5f5f5', padding: '4px', borderRadius: '8px' }}>
            <button
              onClick={() => setActiveTab('create')}
              style={{
                padding: '8px 16px',
                background: activeTab === 'create' ? '#000' : 'transparent',
                color: activeTab === 'create' ? '#fff' : '#666',
                border: 'none',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              Create
            </button>
            <button
              onClick={() => { setActiveTab('engage'); if (engagementPosts.length === 0) findPostsToEngage(); }}
              style={{
                padding: '8px 16px',
                background: activeTab === 'engage' ? '#000' : 'transparent',
                color: activeTab === 'engage' ? '#fff' : '#666',
                border: 'none',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              Engage
            </button>
            <button
              onClick={() => setActiveTab('grok')}
              style={{
                padding: '8px 16px',
                background: activeTab === 'grok' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'transparent',
                color: activeTab === 'grok' ? '#fff' : '#666',
                border: 'none',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              Grok
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'create' ? (
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr 400px', height: 'calc(100vh - 65px)' }}>

        {/* Left: Your Vehicles & Images */}
        <div style={{ borderRight: '1px solid #e5e5e5', background: '#fff', overflow: 'auto' }}>
          <div style={{ padding: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#737373', marginBottom: '12px', textTransform: 'uppercase' }}>
              Your Vehicles
            </div>
            {vehicles.length === 0 ? (
              <div style={{ fontSize: '13px', color: '#999', padding: '20px 0' }}>No vehicles yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {vehicles.map(v => (
                  <div
                    key={v.id}
                    onClick={() => setSelectedVehicle(v)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '10px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      background: selectedVehicle?.id === v.id ? '#f0f0f0' : 'transparent',
                      border: selectedVehicle?.id === v.id ? '1px solid #ddd' : '1px solid transparent'
                    }}
                  >
                    {v.thumbnail ? (
                      <img src={v.thumbnail} alt="" style={{ width: '48px', height: '48px', borderRadius: '6px', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '48px', height: '48px', borderRadius: '6px', background: '#e5e5e5' }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 500 }}>{v.year} {v.make}</div>
                      <div style={{ fontSize: '12px', color: '#737373' }}>{v.model}</div>
                      {v.engine && <div style={{ fontSize: '10px', color: '#999', marginTop: '2px' }}>{v.engine}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ padding: '16px', borderTop: '1px solid #f0f0f0' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#737373', marginBottom: '12px', textTransform: 'uppercase' }}>
              Recent Photos
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
              {recentImages.slice(0, 9).map(img => (
                <img
                  key={img.id}
                  src={img.url}
                  alt=""
                  onClick={() => {
                    if (!composeImages.includes(img.url)) {
                      setComposeImages(prev => [...prev, img.url]);
                    }
                  }}
                  style={{
                    width: '100%',
                    aspectRatio: '1',
                    objectFit: 'cover',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    opacity: composeImages.includes(img.url) ? 0.5 : 1,
                    border: composeImages.includes(img.url) ? '2px solid #000' : 'none'
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Center: Composer & Preview */}
        <div style={{ overflow: 'auto', padding: '24px' }}>
          {/* Quick Actions */}
          {selectedVehicle && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#737373', marginBottom: '8px', textTransform: 'uppercase' }}>
                Quick Post Templates
              </div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                {[
                  `${selectedVehicle.year} ${selectedVehicle.make} ${selectedVehicle.model}${selectedVehicle.engine ? ` - ${selectedVehicle.engine}` : ''}`,
                  `she ready 🔥`,
                  `${selectedVehicle.year} vibes`,
                ].map((template, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setComposeText(template);
                      // Auto-attach first 2 images
                      const vehicleImgs = recentImages.filter(img => img.vehicle_id === selectedVehicle.id);
                      setComposeImages(vehicleImgs.slice(0, 2).map(i => i.url));
                    }}
                    style={{
                      padding: '8px 12px',
                      background: '#f5f5f5',
                      border: '1px solid #e5e5e5',
                      borderRadius: '6px',
                      fontSize: '12px',
                      cursor: 'pointer'
                    }}
                  >
                    {template.length > 30 ? template.substring(0, 30) + '...' : template}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={generateContent}
                  disabled={generating}
                  style={{
                    flex: 1,
                    padding: '14px',
                    background: '#000',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: generating ? 'not-allowed' : 'pointer',
                    opacity: generating ? 0.7 : 1
                  }}
                >
                  {generating ? 'Generating...' : 'Generate Content'}
                </button>
                <button
                  onClick={generateMeme}
                  disabled={generating}
                  style={{
                    flex: 1,
                    padding: '14px',
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: generating ? 'not-allowed' : 'pointer',
                    opacity: generating ? 0.7 : 1
                  }}
                >
                  {generating ? 'Creating...' : 'Grok Meme'}
                </button>
              </div>
            </div>
          )}

          {/* Composer */}
          <div style={{
            background: '#fff',
            borderRadius: '12px',
            border: '1px solid #e5e5e5',
            overflow: 'hidden'
          }}>
            <textarea
              value={composeText}
              onChange={(e) => setComposeText(e.target.value)}
              placeholder="Write your post or generate from your vehicle..."
              style={{
                width: '100%',
                minHeight: '120px',
                padding: '16px',
                border: 'none',
                fontSize: '15px',
                lineHeight: 1.5,
                resize: 'none',
                outline: 'none',
                fontFamily: 'inherit'
              }}
            />

            {composeImages.length > 0 && (
              <div style={{ padding: '0 16px 12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {composeImages.map((img, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={img} alt="" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '6px' }} />
                    <button
                      onClick={() => setComposeImages(prev => prev.filter((_, idx) => idx !== i))}
                      style={{
                        position: 'absolute', top: '-6px', right: '-6px',
                        width: '20px', height: '20px', borderRadius: '50%',
                        background: '#000', color: '#fff', border: 'none',
                        cursor: 'pointer', fontSize: '12px'
                      }}
                    >×</button>
                  </div>
                ))}
              </div>
            )}

            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 16px',
              borderTop: '1px solid #f0f0f0'
            }}>
              <span style={{ fontSize: '13px', color: composeText.length > 280 ? '#dc2626' : '#737373' }}>
                {composeText.length}/280
              </span>
              <button
                onClick={postNow}
                disabled={!composeText.trim() || composeText.length > 280 || posting || !xAccount?.connected}
                style={{
                  padding: '10px 24px',
                  background: composeText.trim() && composeText.length <= 280 && !posting && xAccount?.connected ? '#000' : '#ccc',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: composeText.trim() && composeText.length <= 280 && !posting && xAccount?.connected ? 'pointer' : 'not-allowed'
                }}
              >
                {posting ? 'Posting...' : 'Post to X'}
              </button>
            </div>
          </div>

          {/* Grok Generated Image */}
          {generatedImage && (
            <div style={{ marginTop: '16px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#667eea', marginBottom: '8px', textTransform: 'uppercase' }}>
                AI Generated Image (Grok)
              </div>
              <div style={{ position: 'relative', borderRadius: '8px', overflow: 'hidden', border: '2px solid #667eea' }}>
                <img src={generatedImage} alt="Generated" style={{ width: '100%', display: 'block' }} />
                <button
                  onClick={() => {
                    if (!composeImages.includes(generatedImage)) {
                      setComposeImages(prev => [generatedImage, ...prev]);
                    }
                  }}
                  style={{
                    position: 'absolute',
                    bottom: '8px',
                    right: '8px',
                    padding: '8px 16px',
                    background: composeImages.includes(generatedImage) ? '#22c55e' : '#000',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  {composeImages.includes(generatedImage) ? 'Added' : 'Use This'}
                </button>
              </div>
            </div>
          )}

          {/* Preview */}
          {composeText && (
            <div style={{ marginTop: '24px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#737373', marginBottom: '8px', textTransform: 'uppercase' }}>Preview</div>
              <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e5e5e5', padding: '16px' }}>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#e5e5e5', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '15px' }}>
                      {xAccount?.handle || 'You'} <span style={{ fontWeight: 400, color: '#737373' }}>@{xAccount?.handle || 'handle'}</span>
                    </div>
                    <div style={{ marginTop: '4px', fontSize: '15px', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{composeText}</div>
                    {composeImages.length > 0 && (
                      <div style={{
                        marginTop: '12px',
                        display: 'grid',
                        gridTemplateColumns: composeImages.length === 1 ? '1fr' : 'repeat(2, 1fr)',
                        gap: '4px',
                        borderRadius: '12px',
                        overflow: 'hidden'
                      }}>
                        {composeImages.slice(0, 4).map((img, i) => (
                          <img key={i} src={img} alt="" style={{ width: '100%', height: composeImages.length === 1 ? '280px' : '140px', objectFit: 'cover' }} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Suggestions */}
        <div style={{ borderLeft: '1px solid #e5e5e5', background: '#fff', overflow: 'auto' }}>
          <div style={{ padding: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#737373', marginBottom: '12px', textTransform: 'uppercase' }}>
              Generated Content
            </div>
            {suggestions.length === 0 ? (
              <div style={{ fontSize: '13px', color: '#999', padding: '20px 0', textAlign: 'center' }}>
                Select a vehicle and click Generate
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {suggestions.map(s => (
                  <div
                    key={s.id}
                    onClick={() => selectSuggestion(s)}
                    style={{
                      padding: '12px',
                      borderRadius: '8px',
                      border: selectedContent?.id === s.id ? '2px solid #000' : '1px solid #e5e5e5',
                      cursor: 'pointer',
                      background: selectedContent?.id === s.id ? '#fafafa' : '#fff'
                    }}
                  >
                    <div style={{ fontSize: '14px', lineHeight: 1.4, marginBottom: '8px' }}>
                      {s.text.length > 150 ? s.text.substring(0, 150) + '...' : s.text}
                    </div>
                    <div style={{ fontSize: '11px', color: '#737373' }}>
                      {s.text.length}/280 · Click to use
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      ) : activeTab === 'engage' ? (
        /* Engagement Tab */
        <div style={{ height: 'calc(100vh - 65px)', overflow: 'auto', padding: '24px' }}>
          <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>Find Posts to Engage With</h2>
                <p style={{ fontSize: '13px', color: '#737373', marginTop: '4px' }}>
                  Reply to relevant posts to build your following
                </p>
              </div>
              <button
                onClick={findPostsToEngage}
                disabled={loadingEngagement}
                style={{
                  padding: '10px 20px',
                  background: '#000',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '13px',
                  cursor: loadingEngagement ? 'not-allowed' : 'pointer'
                }}
              >
                {loadingEngagement ? 'Searching...' : 'Find Posts'}
              </button>
            </div>

            {engagementPosts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: '#999' }}>
                {loadingEngagement ? 'Finding posts to engage with...' : 'Click "Find Posts" to discover relevant conversations'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {engagementPosts.map(post => (
                  <div
                    key={post.id}
                    style={{
                      background: '#fff',
                      border: '1px solid #e5e5e5',
                      borderRadius: '12px',
                      padding: '16px'
                    }}
                  >
                    <div style={{ fontSize: '14px', lineHeight: 1.5, marginBottom: '12px' }}>
                      {post.text}
                    </div>
                    <div style={{ fontSize: '12px', color: '#737373', marginBottom: '12px' }}>
                      {post.likes} likes · {post.retweets} retweets
                    </div>

                    {replyDrafts[post.id] ? (
                      <div style={{ marginTop: '12px' }}>
                        <textarea
                          value={replyDrafts[post.id]}
                          onChange={(e) => setReplyDrafts(prev => ({ ...prev, [post.id]: e.target.value }))}
                          style={{
                            width: '100%',
                            padding: '12px',
                            border: '1px solid #e5e5e5',
                            borderRadius: '8px',
                            fontSize: '14px',
                            minHeight: '60px',
                            resize: 'none'
                          }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                          <span style={{ fontSize: '12px', color: replyDrafts[post.id].length > 280 ? '#dc2626' : '#737373' }}>
                            {replyDrafts[post.id].length}/280
                          </span>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              onClick={() => generateReplyForPost(post)}
                              style={{
                                padding: '8px 12px',
                                background: '#f5f5f5',
                                border: '1px solid #e5e5e5',
                                borderRadius: '6px',
                                fontSize: '12px',
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
                                background: '#000',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '6px',
                                fontSize: '12px',
                                cursor: 'pointer'
                              }}
                            >
                              Reply
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => generateReplyForPost(post)}
                        style={{
                          padding: '10px 16px',
                          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '13px',
                          cursor: 'pointer'
                        }}
                      >
                        Generate Reply with Grok
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : userId ? (
        /* Grok Terminal */
        <div style={{ height: 'calc(100vh - 65px)' }}>
          <GrokTerminal userId={userId} />
        </div>
      ) : null}
    </div>
  );
}
