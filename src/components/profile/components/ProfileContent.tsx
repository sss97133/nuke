
import React from 'react';
import { UserProfileHeader } from '../UserProfileHeader';
import { UserMetrics } from '../UserMetrics';
import { ContributionsGraph } from '../ContributionsGraph';
import { ProfileTabs } from './ProfileTabs';
import { ProfileInsights } from '../ProfileInsights';
import { AlertCircle } from 'lucide-react';
import { SocialLinks, StreamingLinks, Achievement } from '../types';
import { AnalysisResult } from '../hooks/useProfileAnalysis';

interface ProfileData {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  user_type: string;
  reputation_score: number;
  achievements_count: number;
  viewer_percentile?: number;
  owner_percentile?: number;
  technician_percentile?: number;
  investor_percentile?: number;
  discovery_count?: number;
}

interface ProfileContentProps {
  profile: ProfileData | null;
  achievements: Achievement[] | null;
  socialLinks: SocialLinks;
  streamingLinks: StreamingLinks;
  analysisResult: AnalysisResult;
  analysisLoading: boolean;
  analysisError: Error | null;
  onRefreshAnalysis: () => void;
  onSocialLinksChange: (links: SocialLinks) => void;
  onStreamingLinksChange: (links: StreamingLinks) => void;
  onSocialLinksSubmit: () => void;
  onStreamingLinksSubmit: () => void;
}

export const ProfileContent = ({
  profile,
  achievements,
  socialLinks,
  streamingLinks,
  analysisResult,
  analysisLoading,
  analysisError,
  onRefreshAnalysis,
  onSocialLinksChange,
  onStreamingLinksChange,
  onSocialLinksSubmit,
  onStreamingLinksSubmit
}: ProfileContentProps) => {
  console.log('Rendering ProfileContent:', { 
    hasProfile: !!profile, 
    hasInsights: analysisResult.isReady,
    persona: analysisResult.userPersona 
  });
  
  if (!profile) {
    console.log('No profile data available');
    return (
      <div className="text-center py-8">
        <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
        <h3 className="text-lg font-medium">Profile Not Found</h3>
        <p className="text-muted-foreground mt-2">
          Unable to load profile information. Please try again later.
        </p>
      </div>
    );
  }

  return (
    <>
      <UserProfileHeader 
        userId={profile.id}
        fullName={profile.full_name} 
        username={profile.username}
        avatarUrl={profile.avatar_url}
        bio={profile.bio}
      />
      
      <UserMetrics profile={profile} />

      {profile.id && (
        <div className="mt-6 border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <ContributionsGraph userId={profile.id} />
          </div>
        </div>
      )}
      
      <div className="mt-6">
        <ProfileInsights 
          analysis={analysisResult}
          isLoading={analysisLoading}
          error={analysisError}
          onRefresh={onRefreshAnalysis}
        />
      </div>

      <ProfileTabs
        userId={profile.id}
        socialLinks={socialLinks}
        streamingLinks={streamingLinks}
        achievements={achievements}
        onSocialLinksChange={onSocialLinksChange}
        onStreamingLinksChange={onStreamingLinksChange}
        onSocialLinksSubmit={onSocialLinksSubmit}
        onStreamingLinksSubmit={onStreamingLinksSubmit}
      />
    </>
  );
};
