
import React from 'react';
import { ProfileTabs } from './ProfileTabs';
import { UserProfileHeader } from '../UserProfileHeader';
import { ProfileLoadingState } from './ProfileLoadingState';
import { ProfileErrorState } from './ProfileErrorState';
import { useProfileData } from '../hooks/useProfileData';

interface ProfileContentProps {
  userId: string;
  isOwnProfile: boolean;
  isLoading: boolean;
  error: string | undefined;
  profileData: any | null;
  analysisData: any | null;
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

  return (
    <div className="space-y-6">
      <UserProfileHeader
        profileData={profileData}
        isOwnProfile={isOwnProfile}
      />
      <ProfileTabs
        userId={userId}
        profileData={profileData}
        analysisData={analysisData}
        isOwnProfile={isOwnProfile}
        analysisError={analysisError}
      />
    </div>
  );
};

export const ProfileContentContainer = ({ userId, isOwnProfile }: { userId: string, isOwnProfile: boolean }) => {
  const {
    isLoading,
    error,
    profileData,
    analysisData,
    analysisError,
    refreshData
  } = useProfileData(userId);

  return (
    <ProfileContent
      userId={userId}
      isOwnProfile={isOwnProfile}
      isLoading={isLoading}
      error={error}
      profileData={profileData}
      analysisData={analysisData}
      analysisError={analysisError}
      onRefresh={refreshData}
    />
  );
};
