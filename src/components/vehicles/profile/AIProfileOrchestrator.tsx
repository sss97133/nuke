import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export interface ProfileMetrics {
  engagement: {
    views: number;
    saves: number;
    shares: number;
    comments: number;
    avgTimeSpent: number;
  };
  market: {
    recentViews: number;
    saveRate: number;
    inquiryRate: number;
    marketRelevance: number;
  };
  content: {
    photoCount: number;
    videoCount: number;
    documentCount: number;
    updateFrequency: number;
    contentQuality: number;
  };
  owner: {
    activityScore: number;
    responseRate: number;
    contentCreationRate: number;
    communityStanding: number;
  };
}

export interface SectionWeight {
  id: string;
  weight: number;
  priority: number;
  visibility: 'visible' | 'secondary' | 'hidden';
}

interface AIProfileOrchestratorProps {
  vehicleId: string;
  children: React.ReactNode;
  onLayoutUpdate: (layout: SectionWeight[]) => void;
}

export const AIProfileOrchestrator = ({
  vehicleId,
  children,
  onLayoutUpdate
}: AIProfileOrchestratorProps) => {
  const [metrics, setMetrics] = useState<ProfileMetrics | null>(null);
  const [layout, setLayout] = useState<SectionWeight[]>([]);

  // Fetch profile metrics
  useEffect(() => {
    const fetchMetrics = async () => {
      const { data: viewData } = await supabase
        .from('vehicle_analytics')
        .select('views, avg_time_spent')
        .eq('vehicle_id', vehicleId)
        .single();

      const { data: marketData } = await supabase
        .from('vehicle_market_metrics')
        .select('save_rate, inquiry_rate, market_relevance')
        .eq('vehicle_id', vehicleId)
        .single();

      const { data: contentData } = await supabase
        .from('vehicle_content_metrics')
        .select('photo_count, video_count, document_count, update_frequency, content_quality')
        .eq('vehicle_id', vehicleId)
        .single();

      // Combine and process metrics
      setMetrics({
        engagement: {
          views: viewData?.views || 0,
          saves: viewData?.saves || 0,
          shares: viewData?.shares || 0,
          comments: viewData?.comments || 0,
          avgTimeSpent: viewData?.avg_time_spent || 0
        },
        market: {
          recentViews: marketData?.recent_views || 0,
          saveRate: marketData?.save_rate || 0,
          inquiryRate: marketData?.inquiry_rate || 0,
          marketRelevance: marketData?.market_relevance || 0
        },
        content: {
          photoCount: contentData?.photo_count || 0,
          videoCount: contentData?.video_count || 0,
          documentCount: contentData?.document_count || 0,
          updateFrequency: contentData?.update_frequency || 0,
          contentQuality: contentData?.content_quality || 0
        },
        owner: {
          activityScore: 0,
          responseRate: 0,
          contentCreationRate: 0,
          communityStanding: 0
        }
      });
    };

    fetchMetrics();
  }, [vehicleId]);

  // AI-driven layout optimization
  useEffect(() => {
    if (!metrics) return;

    const calculateSectionWeight = (section: string): number => {
      switch (section) {
        case 'media':
          return (
            metrics.content.photoCount * 0.3 +
            metrics.content.videoCount * 0.4 +
            metrics.content.contentQuality * 0.3
          );
        case 'marketplace':
          return (
            metrics.market.marketRelevance * 0.4 +
            metrics.market.inquiryRate * 0.3 +
            metrics.engagement.views * 0.3
          );
        case 'updates':
          return (
            metrics.content.updateFrequency * 0.4 +
            metrics.engagement.comments * 0.3 +
            metrics.owner.activityScore * 0.3
          );
        case 'community':
          return (
            metrics.engagement.comments * 0.4 +
            metrics.owner.communityStanding * 0.3 +
            metrics.engagement.shares * 0.3
          );
        default:
          return 0;
      }
    };

    // Calculate weights for each section
    const weights: SectionWeight[] = [
      'media',
      'marketplace',
      'updates',
      'community',
      'docs',
      'timeline'
    ].map(section => ({
      id: section,
      weight: calculateSectionWeight(section),
      priority: 0,
      visibility: 'visible'
    }));

    // Sort by weight and assign priorities
    weights.sort((a, b) => b.weight - a.weight);
    weights.forEach((section, index) => {
      section.priority = index + 1;
      section.visibility = index < 3 ? 'visible' : 
                         index < 5 ? 'secondary' : 
                         'hidden';
    });

    setLayout(weights);
    onLayoutUpdate(weights); // Call the prop function
  }, [metrics, onLayoutUpdate]); // Add onLayoutUpdate to dependencies

  // AI-driven content recommendations
  useEffect(() => {
    if (!metrics) return;

    // Analyze metrics and generate content recommendations
    const generateRecommendations = () => {
      const recommendations = [];

      if (metrics.content.photoCount < 5) {
        recommendations.push({
          type: 'content',
          priority: 'high',
          message: 'Add more photos to increase engagement'
        });
      }

      if (metrics.market.marketRelevance > 0.7 && !metrics.market.saveRate) {
        recommendations.push({
          type: 'market',
          priority: 'high',
          message: 'High market interest - consider enabling marketplace features'
        });
      }

      if (metrics.engagement.comments > 100 && metrics.owner.responseRate < 0.5) {
        recommendations.push({
          type: 'engagement',
          priority: 'medium',
          message: 'Increase response rate to maintain community engagement'
        });
      }

      return recommendations;
    };

    const recommendations = generateRecommendations();
    // Handle recommendations (could be passed to parent or displayed)
  }, [metrics]);

  return <>{children}</>;
}; 