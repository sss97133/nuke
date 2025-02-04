import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AuctionComments } from "./AuctionComments";
import { BidHistory } from "./BidHistory";
import { useState, useEffect } from "react";
import { AuctionCard } from "./AuctionCard";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Filter, Globe } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Auction {
  id: string;
  vehicle_id: string;
  starting_price: number;
  current_price: number;
  reserve_price: number | null;
  end_time: string;
  status: string;
  vehicle: {
    make: string;
    model: string;
    year: number;
  };
  _count: {
    auction_bids: number;
    auction_comments: number;
  };
}

interface ExternalAuction {
  make: string;
  model: string;
  year: number;
  price: number;
  url: string;
  source: string;
  endTime?: string;
  imageUrl?: string;
}

export const AuctionList = () => {
  const { toast } = useToast();
  const [selectedAuction, setSelectedAuction] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>("ending-soon");
  const queryClient = useQueryClient();

  const { data: auctions, isLoading, error } = useQuery({
    queryKey: ['auctions', sortBy],
    queryFn: async () => {
      console.log('🔍 Fetching auctions with sort:', sortBy);
      let query = supabase
        .from('auctions')
        .select(`
          *,
          vehicles (
            id,
            make,
            model,
            year
          ),
          auction_bids(count),
          auction_comments(count)
        `)
        .eq('status', 'active')
        .gt('end_time', new Date().toISOString());

      switch (sortBy) {
        case "ending-soon":
          query = query.order('end_time', { ascending: true });
          break;
        case "newest":
          query = query.order('created_at', { ascending: false });
          break;
        case "most-bids":
          query = query.order('current_price', { ascending: false });
          break;
      }

      const { data: response, error: queryError } = await query;

      if (queryError) {
        console.error('❌ Error fetching auctions:', queryError);
        throw queryError;
      }

      console.log('✅ Received auctions data:', response);
      
      const formattedData = response?.map((auction: any) => ({
        ...auction,
        vehicle: auction.vehicles,
        _count: {
          auction_bids: auction.auction_bids?.[0]?.count ?? 0,
          auction_comments: auction.auction_comments?.[0]?.count ?? 0
        }
      })) || [];

      console.log('🔄 Formatted auction data:', formattedData);
      return formattedData;
    }
  });

  useEffect(() => {
    console.log('🔌 Setting up real-time subscriptions...');
    
    const auctionChannel = supabase
      .channel('auction_updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'auctions'
        },
        (payload) => {
          console.log('📢 Received auction update:', payload);
          queryClient.invalidateQueries({ queryKey: ['auctions'] });
          
          if (payload.eventType === 'UPDATE') {
            toast({
              title: "Auction Updated",
              description: "New bid or update received",
              variant: "default",
            });
          }
        }
      )
      .subscribe();

    const bidChannel = supabase
      .channel('bid_updates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'auction_bids'
        },
        (payload) => {
          console.log('💰 Received new bid:', payload);
          queryClient.invalidateQueries({ queryKey: ['auctions'] });
          toast({
            title: "New Bid",
            description: "A new bid has been placed",
            variant: "default",
          });
        }
      )
      .subscribe();

    return () => {
      console.log('🔌 Cleaning up subscriptions...');
      supabase.removeChannel(auctionChannel);
      supabase.removeChannel(bidChannel);
    };
  }, [queryClient, toast]);

  const { data: externalAuctions, isLoading: isLoadingExternal } = useQuery({
    queryKey: ['external-auctions'],
    queryFn: async () => {
      console.log('🔍 Fetching external auctions...');
      const { data, error } = await supabase.functions.invoke('fetch-market-auctions');
      
      if (error) {
        console.error('❌ Error fetching external auctions:', error);
        throw error;
      }

      console.log('✅ Received external auctions:', data);
      return data.data as ExternalAuction[];
    },
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
  });

  const handleBidSubmit = async (auctionId: string, amount: number) => {
    console.log('💸 Submitting bid:', { auctionId, amount });
    const { error } = await supabase
      .from('auction_bids')
      .insert([{
        auction_id: auctionId,
        amount: amount,
        bidder_id: (await supabase.auth.getUser()).data.user?.id
      }]);

    if (error) {
      console.error('❌ Error placing bid:', error);
      toast({
        title: "Error placing bid",
        description: error.message,
        variant: "destructive"
      });
      return;
    }

    console.log('✅ Bid placed successfully');
    toast({
      title: "Bid placed successfully",
      description: `Your bid of $${amount.toLocaleString()} has been placed.`
    });
  };

  const handleToggleDetails = (auctionId: string) => {
    console.log('🔄 Toggling details for auction:', auctionId);
    setSelectedAuction(selectedAuction === auctionId ? null : auctionId);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="animate-pulse text-gray-400">Loading auctions...</div>
      </div>
    );
  }

  if (error) {
    console.error('❌ Error in auction list:', error);
    return (
      <div className="flex items-center justify-center min-h-[200px] text-red-500">
        Error loading auctions. Please try again.
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">Live Auctions</h1>
        <div className="flex items-center gap-4">
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[180px]">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue placeholder="Sort by..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ending-soon">Ending Soon</SelectItem>
              <SelectItem value="newest">Newest Listings</SelectItem>
              <SelectItem value="most-bids">Most Bids</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs defaultValue="local" className="space-y-6">
        <TabsList>
          <TabsTrigger value="local">Local Auctions</TabsTrigger>
          <TabsTrigger value="external">
            <Globe className="w-4 h-4 mr-2" />
            External Auctions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="local">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {auctions?.map((auction) => (
              <div key={auction.id} className="space-y-6">
                <AuctionCard
                  auction={auction}
                  onBidSubmit={handleBidSubmit}
                  onToggleDetails={handleToggleDetails}
                  selectedAuction={selectedAuction}
                />
                
                {selectedAuction === auction.id && (
                  <div className="space-y-6 animate-fade-in">
                    <div className="grid gap-6">
                      <div className="bg-[#2A2F3C] rounded-lg border border-[#3A3F4C]">
                        <BidHistory auctionId={auction.id} />
                      </div>
                      <div className="bg-[#2A2F3C] rounded-lg border border-[#3A3F4C]">
                        <AuctionComments auctionId={auction.id} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="external">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {isLoadingExternal ? (
              <div className="col-span-full text-center text-muted-foreground">
                Loading external auctions...
              </div>
            ) : externalAuctions && externalAuctions.length > 0 ? (
              externalAuctions.map((auction, index) => (
                <div key={`${auction.source}-${index}`} className="bg-[#2A2F3C] rounded-lg border border-[#3A3F4C] overflow-hidden">
                  {auction.imageUrl && (
                    <div className="aspect-video relative">
                      <img 
                        src={auction.imageUrl} 
                        alt={`${auction.year} ${auction.make} ${auction.model}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  <div className="p-4">
                    <h3 className="text-xl font-semibold">
                      {auction.year} {auction.make} {auction.model}
                    </h3>
                    <div className="mt-2 text-sm text-muted-foreground">
                      Source: {auction.source}
                    </div>
                    <div className="mt-4">
                      <span className="text-2xl font-bold">
                        ${auction.price.toLocaleString()}
                      </span>
                      {auction.endTime && (
                        <div className="mt-2 text-sm text-muted-foreground">
                          Ends: {new Date(auction.endTime).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                    <a
                      href={auction.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 block w-full text-center bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 transition-colors"
                    >
                      View Auction
                    </a>
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-full text-center text-muted-foreground">
                No external auctions found
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};
