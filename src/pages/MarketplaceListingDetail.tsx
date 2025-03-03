
import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft } from 'lucide-react';
import { Helmet } from 'react-helmet';
import { useMarketplaceListing } from '@/components/marketplace/hooks/useMarketplaceListing';
import MarketplaceListingHeader from '@/components/marketplace/detail/MarketplaceListingHeader';
import MarketplaceListingGallery from '@/components/marketplace/detail/MarketplaceListingGallery';
import MarketplaceListingDetails from '@/components/marketplace/detail/MarketplaceListingDetails';
import MarketplaceListingComments from '@/components/marketplace/detail/MarketplaceListingComments';
import MarketplaceListingContact from '@/components/marketplace/detail/MarketplaceListingContact';

const MarketplaceListingDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { listing, isLoading, error } = useMarketplaceListing(id || '');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <h1 className="text-2xl font-bold">Listing Not Found</h1>
        <p className="text-muted-foreground">The marketplace listing you are looking for does not exist.</p>
        <Button onClick={() => navigate("/marketplace")}>
          Return to Marketplace
        </Button>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>{listing.title} | Marketplace | Vehicle Management System</title>
        <meta name="description" content={`${listing.title} - $${listing.price.toLocaleString()} - ${listing.location.city}, ${listing.location.state}`} />
      </Helmet>
      
      <ScrollArea className="h-[calc(100vh-4rem)]">
        <div className="container max-w-7xl p-4 md:p-6 space-y-6">
          <Button variant="ghost" onClick={() => navigate("/marketplace")} className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Marketplace
          </Button>
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main content - 2/3 width on desktop */}
            <div className="lg:col-span-2 space-y-6">
              <MarketplaceListingHeader listing={listing} />
              <MarketplaceListingGallery listingId={listing.id} images={listing.images || []} />
              <MarketplaceListingDetails listing={listing} />
              <MarketplaceListingComments listingId={listing.id} />
            </div>
            
            {/* Sidebar - 1/3 width on desktop */}
            <div className="lg:col-span-1 space-y-6">
              <MarketplaceListingContact listing={listing} />
            </div>
          </div>
        </div>
      </ScrollArea>
    </>
  );
};

export default MarketplaceListingDetail;
