/**
 * Facebook Marketplace Import Component
 *
 * Allows users to:
 * 1. Paste FB Marketplace URL to import listing
 * 2. Claim ownership (for their own listings)
 * 3. Add to watchlist (for others' listings)
 * 4. Report sale outcomes
 */

import React, { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

interface ExtractedData {
  year: number | null;
  make: string | null;
  model: string | null;
  price: number | null;
  location: string | null;
}

interface ImportResult {
  success: boolean;
  listing_id?: string;
  vehicle_id?: string;
  is_new?: boolean;
  extracted?: ExtractedData;
  error?: string;
  message?: string;
}

export default function FacebookMarketplaceImport() {
  const { user } = useAuth();
  const [url, setUrl] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [showSaleForm, setShowSaleForm] = useState(false);

  // Sale reporting state
  const [soldPrice, setSoldPrice] = useState("");
  const [soldDate, setSoldDate] = useState("");
  const [soldToType, setSoldToType] = useState<"private_party" | "dealer" | "unknown">("unknown");
  const [saleLoading, setSaleLoading] = useState(false);

  const isValidUrl = (input: string) => {
    return input.includes("facebook.com/marketplace/item/");
  };

  const handleImport = async () => {
    if (!url || !isValidUrl(url)) {
      setResult({ success: false, error: "Please enter a valid Facebook Marketplace URL" });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke("extract-facebook-marketplace", {
        body: {
          url,
          user_id: user?.id,
          is_owner: isOwner,
        },
      });

      if (error) throw error;
      setResult(data);

      // If this is owner's listing, show sale form option
      if (isOwner && data.success) {
        setShowSaleForm(false); // Reset, they can click to show
      }
    } catch (err: any) {
      setResult({ success: false, error: err.message || "Import failed" });
    } finally {
      setLoading(false);
    }
  };

  const handleReportSale = async () => {
    if (!result?.listing_id) return;

    setSaleLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("report-marketplace-sale", {
        body: {
          listing_id: result.listing_id,
          sold_price: soldPrice ? parseFloat(soldPrice) : null,
          sold_at: soldDate || null,
          sold_to_type: soldToType,
          is_owner: isOwner,
        },
      });

      if (error) throw error;

      setResult({
        ...result,
        message: data.message,
      });
      setShowSaleForm(false);
    } catch (err: any) {
      setResult({
        ...result,
        error: err.message || "Failed to report sale",
      });
    } finally {
      setSaleLoading(false);
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-6 max-w-xl">
      <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
        <svg className="w-6 h-6 text-blue-500" fill="currentColor" viewBox="0 0 24 24">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
        </svg>
        Import from Facebook Marketplace
      </h2>

      <p className="text-gray-400 text-sm mb-4">
        Track private party listings and capture actual sale prices.
      </p>

      {/* URL Input */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Facebook Marketplace URL
          </label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://facebook.com/marketplace/item/..."
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Ownership checkbox */}
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={isOwner}
            onChange={(e) => setIsOwner(e.target.checked)}
            className="w-5 h-5 rounded bg-gray-700 border-gray-600 text-green-500 focus:ring-green-500"
          />
          <div>
            <span className="text-white">This is my listing</span>
            <p className="text-xs text-gray-400">
              You'll earn more points and can report the final sale price
            </p>
          </div>
        </label>

        {/* Import button */}
        <button
          onClick={handleImport}
          disabled={loading || !url}
          className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-medium transition"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Importing...
            </span>
          ) : (
            "Import Listing"
          )}
        </button>
      </div>

      {/* Results */}
      {result && (
        <div className={`mt-6 p-4 rounded-lg ${result.success ? "bg-green-900/30 border border-green-700" : "bg-red-900/30 border border-red-700"}`}>
          {result.success ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="font-medium">
                  {result.is_new ? "Listing imported!" : "Listing already tracked"}
                </span>
              </div>

              {result.extracted && (
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {result.extracted.year && (
                    <div>
                      <span className="text-gray-400">Year:</span>{" "}
                      <span className="text-white">{result.extracted.year}</span>
                    </div>
                  )}
                  {result.extracted.make && (
                    <div>
                      <span className="text-gray-400">Make:</span>{" "}
                      <span className="text-white">{result.extracted.make}</span>
                    </div>
                  )}
                  {result.extracted.model && (
                    <div>
                      <span className="text-gray-400">Model:</span>{" "}
                      <span className="text-white">{result.extracted.model}</span>
                    </div>
                  )}
                  {result.extracted.price && (
                    <div>
                      <span className="text-gray-400">Price:</span>{" "}
                      <span className="text-white">${result.extracted.price.toLocaleString()}</span>
                    </div>
                  )}
                  {result.extracted.location && (
                    <div className="col-span-2">
                      <span className="text-gray-400">Location:</span>{" "}
                      <span className="text-white">{result.extracted.location}</span>
                    </div>
                  )}
                </div>
              )}

              {result.message && (
                <p className="text-green-300 text-sm">{result.message}</p>
              )}

              {/* Sale reporting for owner */}
              {isOwner && result.listing_id && !showSaleForm && (
                <button
                  onClick={() => setShowSaleForm(true)}
                  className="mt-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                >
                  Did this sell? Report the outcome →
                </button>
              )}

              {showSaleForm && (
                <div className="mt-4 p-4 bg-gray-800 rounded-lg space-y-3">
                  <h3 className="font-medium text-white">Report Sale</h3>

                  <div>
                    <label className="block text-sm text-gray-400 mb-1">
                      Final Sale Price
                    </label>
                    <input
                      type="number"
                      value={soldPrice}
                      onChange={(e) => setSoldPrice(e.target.value)}
                      placeholder="15000"
                      className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-400 mb-1">
                      Sale Date
                    </label>
                    <input
                      type="date"
                      value={soldDate}
                      onChange={(e) => setSoldDate(e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-400 mb-1">
                      Sold To
                    </label>
                    <select
                      value={soldToType}
                      onChange={(e) => setSoldToType(e.target.value as any)}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2"
                    >
                      <option value="private_party">Private Party</option>
                      <option value="dealer">Dealer</option>
                      <option value="unknown">Unknown / Prefer not to say</option>
                    </select>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={handleReportSale}
                      disabled={saleLoading}
                      className="flex-1 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 rounded font-medium"
                    >
                      {saleLoading ? "Saving..." : "Report Sale"}
                    </button>
                    <button
                      onClick={() => setShowSaleForm(false)}
                      className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded"
                    >
                      Cancel
                    </button>
                  </div>

                  <p className="text-xs text-gray-400">
                    This data helps build accurate market pricing. Thank you!
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-red-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span>{result.error}</span>
            </div>
          )}
        </div>
      )}

      {/* Info box */}
      <div className="mt-6 p-4 bg-gray-700/50 rounded-lg">
        <h3 className="text-sm font-medium text-gray-300 mb-2">
          Why import from Facebook Marketplace?
        </h3>
        <ul className="text-xs text-gray-400 space-y-1">
          <li>• Track your listing's price history</li>
          <li>• Get notified of similar vehicles</li>
          <li>• Build your vehicle's verified history</li>
          <li>• Help create accurate private party pricing data</li>
        </ul>
      </div>
    </div>
  );
}
