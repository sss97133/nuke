
import React from 'react';
import { ProfileTabs } from './ProfileTabs';
import { UserProfileHeader } from '../UserProfileHeader';
import { ProfileLoadingState } from './ProfileLoadingState';
import { ProfileErrorState } from './ProfileErrorState';
import { useProfileData } from '../hooks/useProfileData';
import { SocialLinks, StreamingLinks } from '../types';
import { AnalysisResult } from '../hooks/useProfileAnalysis';

interface ProfileContentProps {
  userId: string;
  isOwnProfile: boolean;
  isLoading: boolean;
  error: string | undefined;
  profileData: any | null;
  analysisData: AnalysisResult | null;
  analysisError: string | undefined;
  onRefresh: () => void;
}

export const ProfileContent = ({
  userId,
  isOwnProfile,
  isLoading,
  error,
  profileData,
  analysisData,
  analysisError,
  onRefresh
}: ProfileContentProps) => {
  if (isLoading) {
    return <ProfileLoadingState />;
  }

  if (error) {
    return <ProfileErrorState error={error} onRetry={onRefresh} />;
  }

  if (!profileData) {
    return <ProfileErrorState error="Profile data not found" onRetry={onRefresh} />;
  }

  const socialLinks: SocialLinks = profileData.social_links || {
    twitter: '',
    instagram: '',
    linkedin: '',
    github: ''
  };
  
  const streamingLinks: StreamingLinks = profileData.streaming_links || {
    twitch: '',
    youtube: '',
    tiktok: ''
  };

  return (
    <div className="space-y-6">
      <UserProfileHeader
        userId={userId}
        fullName={profileData.full_name}
        username={profileData.username}
        avatarUrl={profileData.avatar_url}
        bio={profileData.bio}
      />
      <ProfileTabs
        userId={userId}
        socialLinks={socialLinks}
        streamingLinks={streamingLinks}
        achievements={profileData.achievements || []}
        analysisResult={analysisData}
        onSocialLinksChange={() => {}}
        onStreamingLinksChange={() => {}}
        onSocialLinksSubmit={() => {}}
        onStreamingLinksSubmit={() => {}}
      />
    </div>
  );
};

export const ProfileContentContainer = ({ userId, isOwnProfile }: { userId: string, isOwnProfile: boolean }) => {
  const {
    profile,
    achievements, 
    isLoading, 
    error, 
    refetch
  } = useProfileData();

  const errorMessage = error ? (error instanceof Error ? error.message : String(error)) : undefined;

  return (
    <ProfileContent
      userId={userId}
      isOwnProfile={isOwnProfile}
      isLoading={isLoading}
      error={errorMessage}
      profileData={profile}
      analysisData={null}
      analysisError={undefined}
      onRefresh={refetch}
    />
  );
};
