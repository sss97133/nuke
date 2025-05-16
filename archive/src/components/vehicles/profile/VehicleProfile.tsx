import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Database } from '@/types/database';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AIProfileOrchestrator, SectionWeight } from './AIProfileOrchestrator';
import {
  Car,
  Image as ImageIcon,
  History,
  Store,
  Gavel,
  Video,
  BarChart,
  Users,
  FileText,
  Settings,
  Coins,
  Radio,
  Calendar,
  MessageSquare,
  Bell,
} from 'lucide-react';

// Sub-components
import { VehicleHeader } from './sections/VehicleHeader';
import { MediaGallery } from './sections/MediaGallery';
import { UpdatesFeed } from './sections/UpdatesFeed';
import { CommentSection } from './sections/CommentSection';
import { MarketplaceSection } from './sections/MarketplaceSection';
import { AuctionSection } from './sections/AuctionSection';
import { LiveSection } from './sections/LiveSection';
import { InvestmentSection } from './sections/InvestmentSection';
import { DocumentationSection } from './sections/DocumentationSection';
import { ActivityTimeline } from './sections/ActivityTimeline';
import { EngagementMetrics } from './sections/EngagementMetrics';

interface VehicleProfileProps {
  isOwner?: boolean;
}

interface SectionConfig {
  id: string;
  label: string;
  icon: React.ReactNode;
  component: React.ReactNode;
  priority?: number;
  visibility?: 'hidden' | 'secondary' | 'visible';
}

export const VehicleProfile = ({ isOwner = false }: VehicleProfileProps) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [vehicle, setVehicle] = useState<Database["public"]["Tables"]["vehicles"]["Row"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeFeatures, setActiveFeatures] = useState({
    marketplace: false,
    auction: false,
    livestream: false,
    liveData: false,
    investment: false,
  });
  const [sectionLayout, setSectionLayout] = useState<SectionConfig[]>([]);

  useEffect(() => {
    const fetchVehicleData = async () => {
      if (!id) return;

      try {
        const { data, error } = await supabase
          .from('vehicles')
          .select(`
            *,
            media_gallery:vehicle_media(*),
            market_data:vehicle_market_data(*),
            auction_history:vehicle_auctions(*),
            live_streams:vehicle_streams(*),
            investment_data:vehicle_investments(*),
            comments:vehicle_comments(*)
          `)
          .eq('id', id)
          .single();

        if (error) throw error;
        setVehicle(data);
      } catch (error) {
        toast({
          title: "Error loading vehicle",
          description: "Could not load vehicle profile data.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchVehicleData();
  }, [id]);

  const sections: SectionConfig[] = [
    {
      id: 'updates',
      label: 'Updates',
      icon: <Bell className="h-4 w-4" />,
      component: <UpdatesFeed vehicleId={id!} />
    },
    {
      id: 'media',
      label: 'Media',
      icon: <ImageIcon className="h-4 w-4" />,
      component: <MediaGallery vehicleId={id!} isOwner={isOwner} />
    },
    {
      id: 'timeline',
      label: 'Timeline',
      icon: <History className="h-4 w-4" />,
      component: <ActivityTimeline vehicleId={id!} />
    },
    {
      id: 'marketplace',
      label: 'Market',
      icon: <Store className="h-4 w-4" />,
      component: <MarketplaceSection vehicleId={id!} isOwner={isOwner} />
    },
    {
      id: 'auction',
      label: 'Auction',
      icon: <Gavel className="h-4 w-4" />,
      component: <AuctionSection vehicleId={id!} isOwner={isOwner} />
    },
    {
      id: 'live',
      label: 'Live',
      icon: <Video className="h-4 w-4" />,
      component: <LiveSection vehicleId={id!} isOwner={isOwner} />
    },
    {
      id: 'invest',
      label: 'Invest',
      icon: <Coins className="h-4 w-4" />,
      component: <InvestmentSection vehicleId={id!} isOwner={isOwner} />
    },
    {
      id: 'docs',
      label: 'Docs',
      icon: <FileText className="h-4 w-4" />,
      component: <DocumentationSection vehicleId={id!} isOwner={isOwner} />
    },
    {
      id: 'community',
      label: 'Community',
      icon: <Users className="h-4 w-4" />,
      component: (
        <>
          <CommentSection vehicleId={id!} />
          <EngagementMetrics vehicleId={id!} />
        </>
      )
    }
  ];

  const handleLayoutUpdate = (newLayout: SectionWeight[]) => {
    // Map the new layout weights/priorities back to the full section config
    const updatedSections = sections.map(section => {
      const layoutInfo = newLayout.find(l => l.id === section.id);
      return {
        ...section,
        priority: layoutInfo?.priority ?? 99, // Default priority if not found
        visibility: layoutInfo?.visibility ?? 'hidden' // Default visibility
      };
    }).sort((a, b) => a.priority - b.priority); // Sort by the new priority

    setSectionLayout(updatedSections);
  };

  if (loading) {
    return <VehicleProfileSkeleton />;
  }

  if (!vehicle) {
    return <VehicleNotFound />;
  }

  return (
    <AIProfileOrchestrator
      vehicleId={id!}
      onLayoutUpdate={handleLayoutUpdate}
    >
      <div className="container mx-auto p-4 space-y-6">
        <VehicleHeader 
          vehicle={vehicle} 
          isOwner={isOwner}
          activeFeatures={activeFeatures}
          onToggleFeature={(feature) => 
            setActiveFeatures(prev => ({ ...prev, [feature]: !prev[feature] }))
          }
        />

        <Tabs defaultValue="updates" className="w-full">
          <TabsList className="grid grid-cols-4 sm:grid-cols-8 lg:grid-cols-12 gap-2">
            {sectionLayout
              .filter(section => section.visibility !== 'hidden')
              .map(section => (
                <TabsTrigger 
                  key={section.id}
                  value={section.id} 
                  className={`flex items-center gap-2 ${
                    section.visibility === 'secondary'
                      ? 'opacity-70'
                      : ''
                  }`}
                >
                  {section.icon}
                  <span className="hidden sm:inline">{section.label}</span>
                </TabsTrigger>
              ))}
          </TabsList>

          <div className="mt-6">
            {sectionLayout.map(section => (
              <TabsContent key={section.id} value={section.id}>
                {section.component}
              </TabsContent>
            ))}
          </div>
        </Tabs>
      </div>
    </AIProfileOrchestrator>
  );
};

const VehicleProfileSkeleton = () => (
  <div className="container mx-auto p-4 space-y-6">
    <Card>
      <CardHeader>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </CardContent>
    </Card>
  </div>
);

const VehicleNotFound = () => (
  <div className="container mx-auto p-4">
    <Card>
      <CardHeader>
        <CardTitle>Vehicle Not Found</CardTitle>
      </CardHeader>
      <CardContent>
        <p>The requested vehicle profile could not be found.</p>
        <Button onClick={() => navigate('/vehicles')} className="mt-4">
          Back to Vehicles
        </Button>
      </CardContent>
    </Card>
  </div>
); 