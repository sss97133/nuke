import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Gavel,
  Clock,
  Users,
  TrendingUp,
  AlertCircle,
  ChevronRight,
  Share2,
  Eye,
} from "lucide-react";

interface AuctionSectionProps {
  vehicleId: string;
  isOwner: boolean;
}

interface Auction {
  id: string;
  type: 'standard' | 'reserve' | 'dutch';
  status: 'upcoming' | 'active' | 'ended';
  start_time: string;
  end_time: string;
  current_bid: number;
  reserve_price?: number;
  min_bid: number;
  bid_count: number;
  viewer_count: number;
  currency: string;
  description: string;
}

interface AuctionMetrics {
  engagement_rate: number;
  avg_bid_increase: number;
  time_between_bids: number;
  viewer_retention: number;
  similar_auctions_avg_price: number;
}

interface AuctionRecommendation {
  type: 'engagement' | 'timing' | 'retention';
  message: string;
}

export const AuctionSection = ({ vehicleId, isOwner }: AuctionSectionProps) => {
  const [auction, setAuction] = useState<Auction | null>(null);
  const [metrics, setMetrics] = useState<AuctionMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState<string>('');
  const [bidAmount, setBidAmount] = useState<string>('');
  const [showBidConfirm, setShowBidConfirm] = useState(false);

  useEffect(() => {
    const fetchAuctionData = async () => {
      try {
        const { data: auctionData, error: auctionError } = await supabase
          .from('vehicle_auctions')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .eq('status', 'active')
          .single();

        if (auctionError) throw auctionError;
        setAuction(auctionData);

        // Fetch auction metrics
        const { data: metricsData, error: metricsError } = await supabase
          .from('auction_metrics')
          .select('*')
          .eq('auction_id', auctionData.id)
          .single();

        if (metricsError) throw metricsError;
        setMetrics(metricsData);
      } catch (error) {
        console.error('Error fetching auction data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAuctionData();
  }, [vehicleId]);

  useEffect(() => {
    if (!auction?.end_time) return;

    const updateTimeLeft = () => {
      const now = new Date().getTime();
      const end = new Date(auction.end_time).getTime();
      const distance = end - now;

      if (distance < 0) {
        setTimeLeft('Auction ended');
        return;
      }

      const days = Math.floor(distance / (1000 * 60 * 60 * 24));
      const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((distance % (1000 * 60)) / 1000);

      setTimeLeft(`${days}d ${hours}h ${minutes}m ${seconds}s`);
    };

    const timer = setInterval(updateTimeLeft, 1000);
    return () => clearInterval(timer);
  }, [auction?.end_time]);

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency
    }).format(amount);
  };

  const handleBid = async () => {
    if (!auction || !bidAmount) return;

    const bidValue = parseFloat(bidAmount);
    if (bidValue <= auction.current_bid) {
      alert('Bid must be higher than current bid');
      return;
    }

    try {
      const { error } = await supabase
        .from('auction_bids')
        .insert({
          auction_id: auction.id,
          amount: bidValue,
          currency: auction.currency
        });

      if (error) throw error;

      // Update auction data
      setAuction(prev => prev ? {
        ...prev,
        current_bid: bidValue,
        bid_count: prev.bid_count + 1
      } : null);

      setShowBidConfirm(false);
      setBidAmount('');
    } catch (error) {
      console.error('Error placing bid:', error);
      alert('Failed to place bid. Please try again.');
    }
  };

  const getAIRecommendations = () => {
    if (!metrics) return null;

    const recommendations: AuctionRecommendation[] = [];

    if (metrics.engagement_rate < 0.5) {
      recommendations.push({
        type: 'engagement',
        message: 'Consider lowering the reserve price to increase bidder participation'
      });
    }

    if (metrics.time_between_bids > 3600) { // more than 1 hour
      recommendations.push({
        type: 'timing',
        message: 'Long gaps between bids - consider promotional actions'
      });
    }

    if (metrics.viewer_retention < 0.3) {
      recommendations.push({
        type: 'retention',
        message: 'Low viewer retention - add more vehicle details or media'
      });
    }

    return recommendations;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-muted rounded w-1/3" />
            <div className="h-4 bg-muted rounded w-1/4" />
            <div className="h-32 bg-muted rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!auction) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center space-y-4">
            <Gavel className="h-12 w-12 mx-auto text-muted-foreground" />
            <h3 className="text-lg font-semibold">No Active Auction</h3>
            {isOwner && (
              <Button>Create Auction</Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Current Auction</CardTitle>
            <Badge variant={auction.status === 'active' ? 'default' : 'secondary'}>
              {auction.status.charAt(0).toUpperCase() + auction.status.slice(1)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <h3 className="text-2xl font-bold">
                  {formatCurrency(auction.current_bid, auction.currency)}
                </h3>
                {auction.reserve_price && (
                  <Badge variant="outline">Reserve Price</Badge>
                )}
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span>Time Left: {timeLeft}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span>{auction.bid_count} bids • {auction.viewer_count} watching</span>
                </div>
              </div>

              {auction.status === 'active' && !isOwner && (
                <div className="mt-6">
                  <Dialog open={showBidConfirm} onOpenChange={setShowBidConfirm}>
                    <DialogTrigger asChild>
                      <Button className="w-full">Place Bid</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Place Your Bid</DialogTitle>
                        <DialogDescription>
                          Current bid is {formatCurrency(auction.current_bid, auction.currency)}
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label>Your Bid Amount</Label>
                          <Input
                            type="number"
                            value={bidAmount}
                            onChange={(e) => setBidAmount(e.target.value)}
                            min={auction.current_bid + auction.min_bid}
                            step={auction.min_bid}
                          />
                          <p className="text-sm text-muted-foreground">
                            Minimum bid increment: {formatCurrency(auction.min_bid, auction.currency)}
                          </p>
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setShowBidConfirm(false)}>
                          Cancel
                        </Button>
                        <Button onClick={handleBid}>
                          Confirm Bid
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              )}
            </div>
            
            <div className="space-y-4">
              {metrics && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-muted rounded-lg">
                    <div className="text-sm text-muted-foreground">Engagement Rate</div>
                    <div className="text-lg font-semibold">
                      {(metrics.engagement_rate * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="p-4 bg-muted rounded-lg">
                    <div className="text-sm text-muted-foreground">Avg. Bid Increase</div>
                    <div className="text-lg font-semibold">
                      {formatCurrency(metrics.avg_bid_increase, auction.currency)}
                    </div>
                  </div>
                </div>
              )}

              {isOwner && getAIRecommendations()?.map((rec, index) => (
                <div key={index} className="flex items-start gap-2 p-4 bg-muted rounded-lg">
                  <AlertCircle className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <div className="font-medium">{rec.type}</div>
                    <p className="text-sm text-muted-foreground">{rec.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Market Analysis */}
      {metrics?.similar_auctions_avg_price && (
        <Card>
          <CardHeader>
            <CardTitle>Market Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                <div>
                  <div className="text-sm text-muted-foreground">Similar Auctions Average</div>
                  <div className="text-lg font-semibold">
                    {formatCurrency(metrics.similar_auctions_avg_price, auction.currency)}
                  </div>
                </div>
                <TrendingUp className="h-5 w-5 text-muted-foreground" />
              </div>
              
              <Button variant="outline" className="w-full">
                View Full Market Report
                <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}; 