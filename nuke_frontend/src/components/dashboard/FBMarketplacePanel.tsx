import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';

interface FBListing {
  id: string;
  facebook_id: string;
  title: string;
  price: number | null;
  location: string | null;
  url: string;
  image_url: string | null;
  description: string | null;
  seller_name: string | null;
  search_query: string | null;
  scraped_at: string;
  all_images: string[] | null;
}

interface FBMarketplacePanelProps {
  onClose: () => void;
}

const FBMarketplacePanel: React.FC<FBMarketplacePanelProps> = ({ onClose }) => {
  const [listings, setListings] = useState<FBListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchListings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from('marketplace_listings')
        .select('*')
        .order('scraped_at', { ascending: false })
        .limit(50);

      if (queryError) throw queryError;
      setListings(data || []);
    } catch (err: any) {
      console.error('Error fetching FB listings:', err);
      setError(err.message || 'Failed to fetch listings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchListings();
    // Auto-refresh every 60 seconds
    const interval = setInterval(fetchListings, 60000);
    return () => clearInterval(interval);
  }, [fetchListings]);

  const formatPrice = (price: number | null) => {
    if (price === null) return 'N/A';
    return '$' + price.toLocaleString();
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  const parseYearMakeFromTitle = (title: string) => {
    const yearMatch = title.match(/\b(19[4-9]\d|200\d|201\d)\b/);
    const year = yearMatch ? yearMatch[1] : null;
    // Try to extract make after year
    const afterYear = year ? title.split(year)[1]?.trim() : title;
    const words = afterYear?.split(/\s+/) || [];
    const make = words[0] || '';
    const model = words.slice(1, 3).join(' ') || '';
    return { year, make, model };
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#1a1a1a] rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden border border-zinc-700">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-700 bg-gradient-to-r from-blue-900/30 to-purple-900/30">
          <div className="flex items-center gap-3">
            <div className="text-2xl">🚗</div>
            <div>
              <h2 className="text-lg font-semibold text-white">FB Marketplace Monitor</h2>
              <p className="text-xs text-zinc-400">
                Classic cars &amp; trucks • Live feed • {listings.length} listings
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={fetchListings}
              disabled={loading}
              className="px-3 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? '⏳' : '🔄'} Refresh
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-zinc-700 rounded-lg transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(90vh-80px)]">
          {error ? (
            <div className="p-6 text-center text-red-400">
              <p>Error: {error}</p>
              <button onClick={fetchListings} className="mt-2 text-blue-400 hover:underline">
                Try again
              </button>
            </div>
          ) : loading && listings.length === 0 ? (
            <div className="p-12 text-center text-zinc-400">
              <div className="animate-spin text-4xl mb-4">🔄</div>
              Loading listings...
            </div>
          ) : listings.length === 0 ? (
            <div className="p-12 text-center text-zinc-400">
              No listings yet. Monitor is running...
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
              {listings.map((listing) => {
                const { year, make, model } = parseYearMakeFromTitle(listing.title);
                const isExpanded = expandedId === listing.id;
                const imageCount = listing.all_images?.length || 0;

                return (
                  <div
                    key={listing.id}
                    className={`bg-zinc-800 rounded-lg overflow-hidden border transition-all cursor-pointer ${
                      isExpanded ? 'border-blue-500 col-span-full' : 'border-zinc-700 hover:border-zinc-500'
                    }`}
                    onClick={() => setExpandedId(isExpanded ? null : listing.id)}
                  >
                    {/* Image */}
                    <div className={`relative ${isExpanded ? 'h-64' : 'h-40'} bg-zinc-900`}>
                      {listing.image_url ? (
                        <img
                          src={listing.image_url}
                          alt={listing.title}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-4xl text-zinc-600">
                          🚗
                        </div>
                      )}
                      {/* Price badge */}
                      <div className="absolute top-2 left-2 px-2 py-1 bg-black/80 rounded text-sm font-bold text-green-400">
                        {formatPrice(listing.price)}
                      </div>
                      {/* Image count badge */}
                      {imageCount > 0 && (
                        <div className="absolute top-2 right-2 px-2 py-1 bg-black/80 rounded text-xs text-zinc-300">
                          📷 {imageCount}
                        </div>
                      )}
                      {/* Time badge */}
                      <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/80 rounded text-xs text-zinc-400">
                        {formatTime(listing.scraped_at)}
                      </div>
                    </div>

                    {/* Info */}
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          {year && (
                            <div className="text-blue-400 text-xs font-medium">{year}</div>
                          )}
                          <h3 className="font-medium text-white truncate text-sm">
                            {make} {model}
                          </h3>
                          {listing.location && (
                            <div className="text-xs text-zinc-500 truncate">
                              📍 {listing.location}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Expanded content */}
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-zinc-700 space-y-3">
                          {/* Full title */}
                          <p className="text-sm text-zinc-300">{listing.title}</p>

                          {/* Description */}
                          {listing.description && (
                            <div className="bg-zinc-900 p-3 rounded text-xs text-zinc-400 max-h-32 overflow-y-auto">
                              {listing.description}
                            </div>
                          )}

                          {/* Seller */}
                          {listing.seller_name && (
                            <div className="text-xs text-zinc-500">
                              👤 Seller: {listing.seller_name}
                            </div>
                          )}

                          {/* Image gallery */}
                          {listing.all_images && listing.all_images.length > 1 && (
                            <div className="grid grid-cols-6 gap-1">
                              {listing.all_images.slice(0, 12).map((img, i) => (
                                <img
                                  key={i}
                                  src={img}
                                  alt={`${i + 1}`}
                                  className="w-full aspect-square object-cover rounded"
                                  loading="lazy"
                                />
                              ))}
                              {listing.all_images.length > 12 && (
                                <div className="w-full aspect-square bg-zinc-700 rounded flex items-center justify-center text-xs text-zinc-400">
                                  +{listing.all_images.length - 12}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Actions */}
                          <div className="flex gap-2">
                            <a
                              href={listing.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded text-xs text-center font-medium transition-colors"
                            >
                              View on Facebook →
                            </a>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FBMarketplacePanel;
