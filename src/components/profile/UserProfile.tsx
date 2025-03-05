
import React, { useState, useEffect } from 'react';
import { ProfileContent } from './components/ProfileContent';
import { ProfileLoadingState } from './components/ProfileLoadingState';
import { ProfileErrorState } from './components/ProfileErrorState';
import { SocialLinks, StreamingLinks } from './types';
import { useProfileData } from './hooks/useProfileData';
import { useProfileAnalysis } from './hooks/useProfileAnalysis';
import { useToast } from '@/hooks/use-toast';

export const UserProfile = () => {
  const { toast } = useToast();
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
  
  const { 
    profile, 
    achievements, 
    isLoading: profileLoading, 
    error: profileError, 
    refetch 
  } = useProfileData();

  // Initialize profile analysis
  const {
    analysisResult,
    isLoading: analysisLoading,
    error: analysisError,
    refreshAnalysis
  } = useProfileAnalysis(
    profile?.id,
    profile,
    achievements,
    socialLinks,
    streamingLinks
  );

  // Create wrapper functions that match the expected prop types
  const handleSocialLinksChange = (links: SocialLinks) => {
    setSocialLinks(links);
  };

  const handleStreamingLinksChange = (links: StreamingLinks) => {
    setStreamingLinks(links);
  };

  const handleSocialLinksSubmit = () => {
    toast({
      title: "Social Links Updated",
      description: "Your social links have been successfully updated.",
    });
    // Actual implementation would call API to update social links
  };

  const handleStreamingLinksSubmit = () => {
    toast({
      title: "Streaming Links Updated",
      description: "Your streaming links have been successfully updated.",
    });
    // Actual implementation would call API to update streaming links
  };

  // Populate initial social and streaming links from profile data
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

  // Handle loading state
  if (profileLoading) {
    return <ProfileLoadingState />;
  }

  // Handle error state
  if (profileError) {
    return (
      <ProfileErrorState 
        error={profileError instanceof Error ? profileError.message : String(profileError)} 
        onRetry={refetch}
      />
    );
  }

  // Ensure profile data exists before rendering content
  if (!profile) {
    return (
      <ProfileErrorState 
        error="Profile data not found" 
        onRetry={refetch}
      />
    );
  }

  const errorMessage = analysisError ? (analysisError instanceof Error ? analysisError.message : String(analysisError)) : undefined;

  return (
    <ProfileContent
      userId={profile.id}
      isOwnProfile={true}
      isLoading={false}
      error={undefined}
      profileData={profile}
      analysisData={analysisResult}
      analysisError={errorMessage}
      onRefresh={refetch}
    />
  );
};

export default UserProfile;
