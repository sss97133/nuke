import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Clock, CreditCard, RefreshCw } from 'lucide-react';
import { formatDistanceToNow, isPast } from 'date-fns';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
}

interface Auction {
  id: string;
  vehicle_id: string;
  seller_id: string;
  starting_price: number;
  reserve_price?: number;
  current_price?: number;
  start_time: string;
  end_time: string;
  status: string;
  vehicle?: Vehicle;
  _count?: {
    auction_bids: number;
    auction_comments: number;
  };
}

interface AuctionBid {
  id: string;
  auction_id: string;
  bidder_id: string;
  amount: number;
  created_at: string;
  bidder?: {
    username?: string;
    avatar_url?: string;
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

export const AuctionList: React.FC = () => {
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAuction, setSelectedAuction] = useState<string | null>(null);
  const [bidAmount, setBidAmount] = useState<number>(0);
  const [bidLoading, setBidLoading] = useState(false);
  const [bids, setBids] = useState<{[key: string]: AuctionBid[]}>({});
  const [sortBy, setSortBy] = useState<string>("ending-soon"); 
  const { toast } = useToast();
  
  useEffect(() => {
    fetchAuctions();
    
    // Set up real-time subscription for auctions
    const subscription = supabase
      .channel('auctions-channel')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'auctions' 
      }, (payload) => {
        console.log('Auction changed:', payload);
        fetchAuctions();
      })
      .subscribe();
    
    // Set up real-time subscription for bids
    const bidsSubscription = supabase
      .channel('bids-channel')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'auction_bids' 
      }, (payload) => {
        console.log('Bid placed:', payload);
        fetchAuctions();
      })
      .subscribe();
      
    return () => {
      supabase.removeChannel(subscription);
      supabase.removeChannel(bidsSubscription);
    };
  }, []);
  
  // Set default bid amount when selecting an auction
  useEffect(() => {
    if (!selectedAuction) return;
    
    const auction = auctions.find(a => a.id === selectedAuction);
    if (auction) {
      const minimumBid = auction.current_price 
        ? auction.current_price + 100 
        : auction.starting_price;
      setBidAmount(minimumBid);
    }
  }, [selectedAuction, auctions]);
  
  const fetchAuctions = async () => {
    try {
      setLoading(true);
      
      let query = supabase
        .from('auctions')
        .select(`
          *,
          vehicle:vehicle_id (
            id, make, model, year
          ),
          _count {
            auction_bids,
            auction_comments
          }
        `);
      
      // Apply sort
      if (sortBy === "ending-soon") {
        query = query.order('end_time', { ascending: true });
      } else if (sortBy === "newest") {
        query = query.order('created_at', { ascending: false });
      } else if (sortBy === "highest-bid") {
        query = query.order('current_price', { ascending: false, nullsFirst: false });
      }
      
      const { data, error } = await query;
      
      if (error) {
        console.error("Database query error:", error);
        setError(error.message);
        return;
      }
      
      setAuctions(data || []);
      
      // Fetch bids for each auction
      const auctionIds = (data || []).map(a => a.id);
      await fetchBidsForAuctions(auctionIds);
      
    } catch (err) {
      console.error('Error fetching auctions:', err);
      setError('Failed to load auctions');
    } finally {
      setLoading(false);
    }
  };
  
  const fetchBidsForAuctions = async (auctionIds: string[]) => {
    if (auctionIds.length === 0) return;
    
    try {
      const { data, error } = await supabase
        .from('auction_bids')
        .select(`
          *,
          bidder:bidder_id (
            username, avatar_url
          )
        `)
        .in('auction_id', auctionIds)
        .order('amount', { ascending: false });
      
      if (error) {
        console.error("Database query error:", error);
        return;
      }
      
      // Group bids by auction_id
      const groupedBids = (data || []).reduce((acc: Record<string, AuctionBid[]>, bid) => {
        if (!acc[bid.auction_id]) {
          acc[bid.auction_id] = [];
        }
        acc[bid.auction_id].push(bid);
        return acc;
      }, {});
      
      setBids(groupedBids);
      
    } catch (err) {
      console.error('Error fetching bids:', err);
    }
  };
  
  const placeBid = async (auctionId: string) => {
    if (!bidAmount) {
      toast({
        title: "Invalid Bid",
        description: "Please enter a valid bid amount",
        variant: "destructive"
      });
      return;
    }
    
    const auction = auctions.find(a => a.id === auctionId);
    if (!auction) return;
    
    const minBid = auction.current_price 
      ? auction.current_price + 100 
      : auction.starting_price;
    
    if (bidAmount < minBid) {
      toast({
        title: "Bid Too Low",
        description: `Minimum bid is $${minBid}`,
        variant: "destructive"
      });
      return;
    }
    
    if (isPast(new Date(auction.end_time))) {
      toast({
        title: "Auction Ended",
        description: "This auction has already ended",
        variant: "destructive"
      });
      return;
    }
    
    try {
      setBidLoading(true);
      
      // Get current user
      const { data: userData } = await supabase.auth.getUser();
      
      if (!userData.user) {
        toast({
          title: "Authentication Required",
          description: "Please login to place a bid",
          variant: "destructive"
        });
        return;
      }
      
      // Insert bid
      const { error: bidError } = await supabase
        .from('auction_bids')
        .insert({
          auction_id: auctionId,
          bidder_id: userData.user.id,
          amount: bidAmount
        });
      
      if (bidError) {
        console.error("Database query error:", bidError);
        toast({
          title: "Error",
          description: bidError.message,
          variant: "destructive"
        });
        return;
      }
      
      // Update auction's current price
      const { error: updateError } = await supabase
        .from('auctions')
        .update({ current_price: bidAmount })
        .eq('id', auctionId);
      
      if (updateError) {
        console.error("Database update error:", updateError);
      }
      
      toast({
        title: "Bid Placed",
        description: `Your bid of $${bidAmount} has been placed!`
      });
      
      // Refresh auctions to get updated data
      fetchAuctions();
      setSelectedAuction(null);
      
    } catch (err) {
      console.error('Error placing bid:', err);
      toast({
        title: "Error",
        description: "Failed to place bid",
        variant: "destructive"
      });
    } finally {
      setBidLoading(false);
    }
  };
  
  const isAuctionEnded = (endTime: string) => {
    return isPast(new Date(endTime));
  };
  
  const formatTimeRemaining = (endTime: string) => {
    if (isAuctionEnded(endTime)) {
      return 'Ended';
    }
    return formatDistanceToNow(new Date(endTime), { addSuffix: true });
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[200px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="pt-6">
          <div className="text-center text-red-500">
            <h3 className="text-lg font-medium">Failed to load auctions</h3>
            <p className="text-sm mt-2">{error}</p>
            <Button 
              variant="outline" 
              onClick={fetchAuctions} 
              className="mt-4"
            >
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (auctions.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground">
            <h3 className="text-lg font-medium">No Active Auctions</h3>
            <p className="text-sm mt-2">Check back later for new auctions</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Vehicle Auctions</h2>
        <div className="flex items-center gap-4">
          <div className="flex border rounded-md overflow-hidden">
            <Button 
              variant={sortBy === "ending-soon" ? "default" : "outline"}
              size="sm"
              onClick={() => setSortBy("ending-soon")}
              className="rounded-none border-0"
            >
              Ending Soon
            </Button>
            <Button 
              variant={sortBy === "highest-bid" ? "default" : "outline"}
              size="sm"
              onClick={() => setSortBy("highest-bid")}
              className="rounded-none border-0 border-l"
            >
              Highest Bid
            </Button>
            <Button 
              variant={sortBy === "newest" ? "default" : "outline"}
              size="sm"
              onClick={() => setSortBy("newest")}
              className="rounded-none border-0 border-l"
            >
              Newest
            </Button>
          </div>
          <Button 
            variant="outline" 
            size="icon" 
            onClick={fetchAuctions}
            title="Refresh auctions"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>
      
      {auctions.map((auction) => (
        <Card key={auction.id} className="overflow-hidden">
          <CardHeader className="bg-muted pb-2">
            <div className="flex justify-between items-start">
              <CardTitle>
                {auction.vehicle?.year} {auction.vehicle?.make} {auction.vehicle?.model}
              </CardTitle>
              <Badge 
                variant={isAuctionEnded(auction.end_time) ? "secondary" : "default"}
                className="uppercase text-xs"
              >
                {isAuctionEnded(auction.end_time) ? 'Ended' : 'Active'}
              </Badge>
            </div>
            <div className="flex items-center text-sm text-muted-foreground mt-1">
              <Clock className="h-4 w-4 mr-1" />
              {formatTimeRemaining(auction.end_time)}
            </div>
          </CardHeader>
          
          <CardContent className="pt-4">
            <div className="flex justify-between items-center mb-4">
              <div>
                <p className="text-sm text-muted-foreground">Current Bid</p>
                <p className="text-2xl font-bold">
                  ${auction.current_price || auction.starting_price}
                </p>
                {auction._count && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {auction._count.auction_bids} bid{auction._count.auction_bids !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
              
              {!isAuctionEnded(auction.end_time) && (
                <Button
                  onClick={() => setSelectedAuction(
                    selectedAuction === auction.id ? null : auction.id
                  )}
                  variant={selectedAuction === auction.id ? "secondary" : "default"}
                >
                  Place Bid
                </Button>
              )}
            </div>
            
            {selectedAuction === auction.id && (
              <div className="bg-muted p-3 rounded-md mt-2">
                <div className="flex space-x-2 items-center">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm">Minimum bid: ${auction.current_price ? auction.current_price + 100 : auction.starting_price}</p>
                </div>
                
                <div className="flex mt-2 space-x-2">
                  <Input
                    type="number"
                    value={bidAmount}
                    onChange={(e) => setBidAmount(parseInt(e.target.value) || 0)}
                    className="flex-grow"
                    placeholder="Enter bid amount"
                    min={auction.current_price ? auction.current_price + 100 : auction.starting_price}
                    step="100"
                  />
                  <Button 
                    onClick={() => placeBid(auction.id)}
                    disabled={bidLoading}
                  >
                    {bidLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Bid'}
                  </Button>
                </div>
              </div>
            )}
            
            {/* Show top bids if there are any */}
            {bids[auction.id] && bids[auction.id].length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-medium mb-2">Recent Bids</h4>
                <div className="space-y-2">
                  {bids[auction.id].slice(0, 3).map((bid) => (
                    <div key={bid.id} className="flex justify-between text-sm">
                      <div className="flex items-center">
                        {bid.bidder?.avatar_url && (
                          <div className="h-5 w-5 rounded-full overflow-hidden mr-2">
                            <img 
                              src={bid.bidder.avatar_url} 
                              alt="bidder" 
                              className="h-full w-full object-cover" 
                            />
                          </div>
                        )}
                        <span>{bid.bidder?.username || 'Anonymous'}</span>
                      </div>
                      <span className="font-medium">${bid.amount}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
