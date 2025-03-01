
import React, { useState, useEffect } from 'react';
import { ProfileContent } from './components/ProfileContent';
import { ProfileLoadingState } from './components/ProfileLoadingState';
import { ProfileErrorState } from './components/ProfileErrorState';
import { SocialLinks, StreamingLinks } from './types';
import { useProfileData } from './hooks/useProfileData';

export const UserProfile = () => {
  const [socialLinks, setSocialLinks] = useState<SocialLinks>({
    twitter: '',
    instagram: '',
    linkedin: '',
    github: ''
  });
  const [streamingLinks, setStreamingLinks] = useState<StreamingLinks>({
    twitch: '',
    youtube: '',
    tiktok: ''
  });
  
  const { profile, achievements, isLoading, error, refetch } = useProfileData();

  console.log('Profile render:', { profile, achievements, isLoading, error });

  // Create wrapper functions that match the expected prop types
  const handleSocialLinksChange = (links: SocialLinks) => {
    setSocialLinks(links);
  };

  const handleStreamingLinksChange = (links: StreamingLinks) => {
    setStreamingLinks(links);
  };

  const handleSocialLinksSubmit = () => {
    console.log('Submitting social links:', socialLinks);
    // Actual implementation would call API to update social links
  };

  const handleStreamingLinksSubmit = () => {
    console.log('Submitting streaming links:', streamingLinks);
    // Actual implementation would call API to update streaming links
  };

  useEffect(() => {
    if (profile?.social_links) {
      // Type guard to check if social_links is an object
      if (typeof profile.social_links === 'object' && profile.social_links !== null && !Array.isArray(profile.social_links)) {
        setSocialLinks({
          twitter: (profile.social_links as any).twitter || '',
          instagram: (profile.social_links as any).instagram || '',
          linkedin: (profile.social_links as any).linkedin || '',
          github: (profile.social_links as any).github || ''
        });
      }
    }
    if (profile?.streaming_links) {
      // Type guard to check if streaming_links is an object
      if (typeof profile.streaming_links === 'object' && profile.streaming_links !== null && !Array.isArray(profile.streaming_links)) {
        setStreamingLinks({
          twitch: (profile.streaming_links as any).twitch || '',
          youtube: (profile.streaming_links as any).youtube || '',
          tiktok: (profile.streaming_links as any).tiktok || ''
        });
      }
    }
  }, [profile]);

  if (isLoading) {
    return <ProfileLoadingState />;
  }

  if (error) {
    return <ProfileErrorState error={error} onRetry={refetch} />;
  }

  // Enrich profile with achievements count for UserMetrics
  const enrichedProfile = profile ? {
    ...profile,
    achievements_count: achievements?.length || 0
  } : null;

  return (
    <div className="space-y-4">
      <div className="bg-background p-4 border rounded-lg shadow-sm">
        <ProfileContent
          profile={enrichedProfile}
          achievements={achievements}
          socialLinks={socialLinks}
          streamingLinks={streamingLinks}
          onSocialLinksChange={handleSocialLinksChange}
          onStreamingLinksChange={handleStreamingLinksChange}
          onSocialLinksSubmit={handleSocialLinksSubmit}
          onStreamingLinksSubmit={handleStreamingLinksSubmit}
        />
      </div>
    </div>
  );
};

export default UserProfile;
