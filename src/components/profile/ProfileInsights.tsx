
import React from 'react';
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InfoIcon, Zap, Users, Target, Lightbulb, Shield, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AnalysisResult } from './hooks/useProfileAnalysis';
import { Progress } from '@/components/ui/progress';

interface ProfileInsightsProps {
  analysis: AnalysisResult;
  isLoading: boolean;
  error: Error | null;
  onRefresh: () => void;
}

export const ProfileInsights: React.FC<ProfileInsightsProps> = ({
  analysis,
  isLoading,
  error,
  onRefresh
}) => {
  console.log('Rendering ProfileInsights with analysis:', analysis);
  
  if (error) {
    console.error('Error in ProfileInsights:', error);
    return (
      <Card className="p-4">
        <div className="text-center py-4">
          <InfoIcon className="mx-auto h-10 w-10 text-amber-500 mb-2" />
          <h3 className="text-lg font-medium">Analysis Unavailable</h3>
          <p className="text-muted-foreground mt-2 mb-4">
            We encountered an issue while analyzing this profile.
          </p>
          <Button onClick={onRefresh} disabled={isLoading}>
            {isLoading ? 'Analyzing...' : 'Try Again'}
          </Button>
        </div>
      </Card>
    );
  }

  if (isLoading || !analysis.isReady) {
    return (
      <Card className="p-4">
        <div className="text-center py-8">
          <div className="animate-spin h-10 w-10 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-muted-foreground">Analyzing profile data...</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            Profile Insights
          </h2>
          <p className="text-muted-foreground text-sm">
            AI-powered analysis of your profile and activity
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Refreshing...
            </>
          ) : (
            'Refresh Analysis'
          )}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        <PersonaScoreCard 
          title="Professional" 
          score={analysis.professionalScore} 
          isActive={analysis.userPersona === 'Professional'} 
        />
        <PersonaScoreCard 
          title="Collector" 
          score={analysis.collectorScore}
          isActive={analysis.userPersona === 'Collector'} 
        />
        <PersonaScoreCard 
          title="Creator" 
          score={analysis.creatorScore}
          isActive={analysis.userPersona === 'Creator'} 
        />
        <PersonaScoreCard 
          title="Enthusiast" 
          score={analysis.enthusiastScore}
          isActive={analysis.userPersona === 'Enthusiast'} 
        />
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="flex overflow-x-auto pb-px mb-4">
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <Zap className="w-4 h-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="audience" className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            Audience
          </TabsTrigger>
          <TabsTrigger value="growth" className="flex items-center gap-2">
            <Target className="w-4 h-4" />
            Growth
          </TabsTrigger>
          <TabsTrigger value="privacy" className="flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Privacy
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-medium mb-2">Primary Persona</h3>
              <div className="bg-primary/10 p-4 rounded-lg">
                <p className="font-semibold text-lg">{analysis.userPersona}</p>
                <p className="text-muted-foreground">
                  {getPersonaDescription(analysis.userPersona)}
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">Content Affinities</h3>
              <div className="flex flex-wrap gap-2">
                {analysis.contentAffinities.map((affinity, index) => (
                  <Badge key={index} variant="secondary" className="py-1">
                    <Tag className="w-3 h-3 mr-1" />
                    {affinity}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">Marketable Skills</h3>
              {analysis.marketableSkills.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {analysis.marketableSkills.map((skill, index) => (
                    <Badge key={index} className="py-1 bg-blue-500 hover:bg-blue-600">
                      {skill}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">
                  No specific marketable skills identified yet. As you engage with the platform,
                  we'll identify your areas of expertise.
                </p>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="audience" className="space-y-4">
          <div>
            <h3 className="text-lg font-medium mb-2">Audience Match</h3>
            <p className="text-muted-foreground mb-4">
              Based on your profile and activity, your content and interactions are most relevant to:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {analysis.audienceMatch.map((audience, index) => (
                <div key={index} className="border rounded-lg p-4">
                  <Users className="h-8 w-8 text-primary mb-2" />
                  <h4 className="font-medium">{audience}</h4>
                  <p className="text-sm text-muted-foreground">
                    {getAudienceDescription(audience)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="growth" className="space-y-4">
          <div>
            <h3 className="text-lg font-medium mb-2">Growth Opportunities</h3>
            <p className="text-muted-foreground mb-4">
              Here are some recommendations to enhance your profile and expand your reach:
            </p>
            <div className="space-y-3">
              {analysis.growthOpportunities.map((opportunity, index) => (
                <div key={index} className="flex items-start gap-3 p-3 border rounded-lg">
                  <Lightbulb className="h-5 w-5 text-yellow-500 mt-0.5" />
                  <div>
                    <p className="font-medium">{opportunity}</p>
                    <p className="text-sm text-muted-foreground">
                      {getOpportunityDescription(opportunity)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="privacy" className="space-y-4">
          <div>
            <h3 className="text-lg font-medium mb-2">Privacy Recommendation</h3>
            <div className="bg-primary/10 p-4 rounded-lg mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="h-5 w-5 text-primary" />
                <p className="font-semibold">
                  Recommended Setting: {capitalizeFirstLetter(analysis.privacyRecommendation)}
                </p>
              </div>
              <p className="text-muted-foreground">
                {getPrivacyDescription(analysis.privacyRecommendation)}
              </p>
            </div>
            
            <div className="mt-6">
              <h3 className="text-lg font-medium mb-2">Privacy Options</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <PrivacyOptionCard
                  title="Public"
                  description="Your full profile is visible to everyone"
                  isRecommended={analysis.privacyRecommendation === 'public'}
                />
                <PrivacyOptionCard
                  title="Limited"
                  description="Some personal details are hidden from the public"
                  isRecommended={analysis.privacyRecommendation === 'limited'}
                />
                <PrivacyOptionCard
                  title="Private"
                  description="Your profile is only visible to connections you approve"
                  isRecommended={analysis.privacyRecommendation === 'private'}
                />
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </Card>
  );
};

// Helper component for persona score cards
const PersonaScoreCard: React.FC<{ title: string; score: number; isActive: boolean }> = ({ 
  title, 
  score,
  isActive 
}) => {
  console.log(`Rendering PersonaScoreCard: ${title}, score: ${score}, isActive: ${isActive}`);
  
  return (
    <div className={`border rounded-lg p-3 ${isActive ? 'border-primary bg-primary/5' : ''}`}>
      <div className="flex justify-between items-center mb-2">
        <h4 className="font-medium">{title}</h4>
        {isActive && (
          <Badge variant="outline" className="bg-primary text-primary-foreground">
            Primary
          </Badge>
        )}
      </div>
      <div className="space-y-2">
        <Progress value={score} className="h-2" />
        <p className="text-sm text-right text-muted-foreground">{score}%</p>
      </div>
    </div>
  );
};

// Helper component for privacy option cards
const PrivacyOptionCard: React.FC<{ 
  title: string; 
  description: string; 
  isRecommended: boolean 
}> = ({ 
  title, 
  description, 
  isRecommended 
}) => (
  <div className={`border rounded-lg p-4 ${isRecommended ? 'border-primary' : ''}`}>
    <div className="flex justify-between items-center mb-2">
      <h4 className="font-medium">{title}</h4>
      {isRecommended && (
        <Badge className="bg-primary text-primary-foreground">
          Recommended
        </Badge>
      )}
    </div>
    <p className="text-sm text-muted-foreground">{description}</p>
  </div>
);

// Helper functions for descriptive text
function getPersonaDescription(persona: string): string {
  switch (persona) {
    case 'Professional':
      return 'You use this platform primarily for business and professional networking. You likely value industry connections and technical information.';
    case 'Collector':
      return 'You focus on collecting and preserving vehicles. You value information about rare finds, valuation, and vehicle history.';
    case 'Creator':
      return 'You create content and share your expertise with others. You value audience engagement and growth opportunities.';
    case 'Enthusiast':
    default:
      return 'You enjoy exploring automotive content and connecting with the community. You value information and social connections.';
  }
}

function getAudienceDescription(audience: string): string {
  const descriptions: Record<string, string> = {
    'Industry Professionals': 'People working in automotive or related industries',
    'Business Clients': 'Potential clients looking for professional services',
    'Technical Enthusiasts': 'People with technical knowledge seeking expertise',
    'Fellow Collectors': 'Other collectors interested in rare and valuable vehicles',
    'Enthusiasts': 'Passionate automotive fans with varied interests',
    'Potential Buyers': 'People looking to purchase vehicles or parts',
    'Content Viewers': 'People who consume automotive content regularly',
    'Fellow Creators': 'Other content creators in the automotive space',
    'Brand Sponsors': 'Companies looking for influencers and personalities',
    'Community Members': 'Regular participants in the automotive community',
    'Like-minded Enthusiasts': 'People who share your specific automotive interests'
  };
  
  return descriptions[audience] || 'People interested in automotive content';
}

function getOpportunityDescription(opportunity: string): string {
  const descriptions: Record<string, string> = {
    'Add a detailed bio': 'A complete bio helps others understand your background and interests.',
    'Upload a profile picture': 'A profile image helps others recognize you and makes your profile more approachable.',
    'Connect with industry professionals': 'Building your network can lead to business opportunities and knowledge sharing.',
    'Showcase expertise through content': 'Sharing your knowledge positions you as an authority in your field.',
    'Document your collection': 'Cataloging your vehicles creates a valuable resource and history.',
    'Connect with other collectors': 'Networking with fellow collectors can lead to discoveries and trading opportunities.',
    'Cross-promote on social platforms': 'Linking your social accounts extends your reach to different audiences.',
    'Engage with audience through streams': 'Live interactions build stronger connections with your followers.',
    'Join discussions on topics of interest': 'Participating in community conversations increases your visibility.',
    'Participate in community events': 'Events are great opportunities to network and learn from others.'
  };
  
  return descriptions[opportunity] || 'This will help improve your profile and expand your reach.';
}

function getPrivacyDescription(recommendation: 'public' | 'limited' | 'private'): string {
  switch (recommendation) {
    case 'public':
      return 'Based on your profile type and goals, a public profile will help you maximize visibility and connections. This is ideal for professionals and content creators looking to grow their audience.';
    case 'limited':
      return 'A balanced approach to privacy is recommended for your profile type. Some information will be public to help with connections, while more sensitive details remain private.';
    case 'private':
      return 'Your profile type suggests you may prefer to keep your information private. This setting limits who can see your profile details and activity.';
  }
}

function capitalizeFirstLetter(string: string): string {
  return string.charAt(0).toUpperCase() + string.slice(1);
}
