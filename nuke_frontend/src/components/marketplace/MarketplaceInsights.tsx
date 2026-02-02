/**
 * Marketplace Insights Component
 *
 * Shows the VALUE of the FB Marketplace data:
 * - Private party pricing vs retail
 * - Time to sell by make/model
 * - Price negotiation patterns
 * - Geographic trends
 *
 * This is what we'd sell to Hagerty, CarGurus, etc.
 */

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface MarketInsight {
  make: string;
  model: string | null;
  year: number | null;
  state: string | null;
  total_listings: number;
  active_listings: number;
  sold_listings: number;
  avg_asking_price: number | null;
  avg_sold_price: number | null;
  avg_days_to_sell: number | null;
  avg_discount_pct: number | null;
}

interface AggregateStats {
  total_listings: number;
  total_sold: number;
  total_sale_value: number;
  avg_days_to_sell: number;
  sale_capture_rate: number;
}

export default function MarketplaceInsights() {
  const [insights, setInsights] = useState<MarketInsight[]>([]);
  const [stats, setStats] = useState<AggregateStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterMake, setFilterMake] = useState<string>("");
  const [filterState, setFilterState] = useState<string>("");

  useEffect(() => {
    fetchInsights();
  }, [filterMake, filterState]);

  const fetchInsights = async () => {
    setLoading(true);

    try {
      // Get insights from view
      let query = supabase
        .from("marketplace_analytics")
        .select("*")
        .order("sold_listings", { ascending: false })
        .limit(50);

      if (filterMake) {
        query = query.ilike("make", filterMake);
      }
      if (filterState) {
        query = query.eq("state", filterState);
      }

      const { data, error } = await query;

      if (error) throw error;
      setInsights(data || []);

      // Get aggregate stats
      const { data: aggData } = await supabase
        .from("marketplace_listings")
        .select("id, status, sold_price, days_listed")
        .throwOnError();

      if (aggData) {
        const total = aggData.length;
        const sold = aggData.filter((l) => l.status === "sold");
        const withPrice = sold.filter((l) => l.sold_price);

        setStats({
          total_listings: total,
          total_sold: sold.length,
          total_sale_value: withPrice.reduce((sum, l) => sum + (l.sold_price || 0), 0),
          avg_days_to_sell: sold.length > 0
            ? sold.reduce((sum, l) => sum + (l.days_listed || 0), 0) / sold.length
            : 0,
          sale_capture_rate: total > 0 ? (withPrice.length / total) * 100 : 0,
        });
      }
    } catch (err) {
      console.error("Failed to fetch insights:", err);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (val: number | null) => {
    if (val === null) return "-";
    return "$" + val.toLocaleString(undefined, { maximumFractionDigits: 0 });
  };

  const formatPct = (val: number | null) => {
    if (val === null) return "-";
    return val.toFixed(1) + "%";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold">Private Party Market Intelligence</h2>
        <p className="text-gray-400 dark:text-gray-500 dark:text-gray-400">
          Real transaction data from Facebook Marketplace
        </p>
      </div>

      {/* Aggregate Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-3xl font-bold text-white">
              {stats.total_listings.toLocaleString()}
            </div>
            <div className="text-sm text-gray-400 dark:text-gray-500 dark:text-gray-400">Total Listings Tracked</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-3xl font-bold text-green-400">
              {stats.total_sold.toLocaleString()}
            </div>
            <div className="text-sm text-gray-400 dark:text-gray-500 dark:text-gray-400">Confirmed Sales</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-3xl font-bold text-blue-400">
              {formatCurrency(stats.total_sale_value)}
            </div>
            <div className="text-sm text-gray-400 dark:text-gray-500 dark:text-gray-400">Total Transaction Value</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-3xl font-bold text-yellow-400">
              {stats.avg_days_to_sell.toFixed(0)}
            </div>
            <div className="text-sm text-gray-400 dark:text-gray-500 dark:text-gray-400">Avg Days to Sell</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-3xl font-bold text-purple-400">
              {formatPct(stats.sale_capture_rate)}
            </div>
            <div className="text-sm text-gray-400 dark:text-gray-500 dark:text-gray-400">Price Capture Rate</div>
          </div>
        </div>
      )}

      {/* Value Proposition Callout */}
      <div className="bg-gradient-to-r from-blue-900/50 to-purple-900/50 rounded-lg p-6 border border-blue-700/50">
        <h3 className="text-lg font-semibold text-white mb-2">
          📊 Data Nobody Else Has
        </h3>
        <div className="grid md:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-blue-300 font-medium">Carfax/AutoCheck:</span>
            <p className="text-gray-400 dark:text-gray-500 dark:text-gray-400">
              Service records only. No pricing data.
            </p>
          </div>
          <div>
            <span className="text-blue-300 font-medium">Hagerty/KBB:</span>
            <p className="text-gray-400 dark:text-gray-500 dark:text-gray-400">
              Auction prices (10-15% higher than private party).
            </p>
          </div>
          <div>
            <span className="text-blue-300 font-medium">Nuke:</span>
            <p className="text-gray-400 dark:text-gray-500 dark:text-gray-400">
              Actual private party transaction prices + time to sell.
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <input
          type="text"
          value={filterMake}
          onChange={(e) => setFilterMake(e.target.value)}
          placeholder="Filter by make..."
          className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
        />
        <select
          value={filterState}
          onChange={(e) => setFilterState(e.target.value)}
          className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
        >
          <option value="">All States</option>
          <option value="CA">California</option>
          <option value="TX">Texas</option>
          <option value="FL">Florida</option>
          <option value="AZ">Arizona</option>
          <option value="NY">New York</option>
        </select>
      </div>

      {/* Insights Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500 dark:text-gray-400">Loading...</div>
      ) : insights.length === 0 ? (
        <div className="text-center py-12 bg-gray-800 rounded-lg">
          <p className="text-gray-400 dark:text-gray-500 dark:text-gray-400 mb-2">No market data yet</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Import listings to start building market intelligence
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 dark:text-gray-500 dark:text-gray-400 border-b border-gray-700">
                <th className="pb-3 font-medium">Make/Model</th>
                <th className="pb-3 font-medium text-right">Active</th>
                <th className="pb-3 font-medium text-right">Sold</th>
                <th className="pb-3 font-medium text-right">Avg Asking</th>
                <th className="pb-3 font-medium text-right">Avg Sold</th>
                <th className="pb-3 font-medium text-right">Discount</th>
                <th className="pb-3 font-medium text-right">Days to Sell</th>
              </tr>
            </thead>
            <tbody>
              {insights.map((row, i) => (
                <tr key={i} className="border-b border-gray-800">
                  <td className="py-3">
                    <div className="font-medium text-white">
                      {row.year || ""} {row.make}
                    </div>
                    {row.model && (
                      <div className="text-gray-400 dark:text-gray-500 dark:text-gray-400 text-xs">{row.model}</div>
                    )}
                    {row.state && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">{row.state}</span>
                    )}
                  </td>
                  <td className="py-3 text-right text-gray-300">
                    {row.active_listings}
                  </td>
                  <td className="py-3 text-right text-green-400">
                    {row.sold_listings}
                  </td>
                  <td className="py-3 text-right text-gray-300">
                    {formatCurrency(row.avg_asking_price)}
                  </td>
                  <td className="py-3 text-right text-white font-medium">
                    {formatCurrency(row.avg_sold_price)}
                  </td>
                  <td className={`py-3 text-right ${
                    row.avg_discount_pct && row.avg_discount_pct > 0
                      ? "text-red-400"
                      : "text-green-400"
                  }`}>
                    {row.avg_discount_pct !== null
                      ? (row.avg_discount_pct > 0 ? "-" : "+") + Math.abs(row.avg_discount_pct).toFixed(1) + "%"
                      : "-"}
                  </td>
                  <td className="py-3 text-right text-yellow-400">
                    {row.avg_days_to_sell?.toFixed(0) || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* API Teaser */}
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h3 className="font-semibold text-white mb-2">
          Want this data via API?
        </h3>
        <p className="text-gray-400 dark:text-gray-500 dark:text-gray-400 text-sm mb-4">
          Private party transaction data, updated daily. Perfect for:
        </p>
        <ul className="text-sm text-gray-400 dark:text-gray-500 dark:text-gray-400 space-y-1 mb-4">
          <li>• Insurance valuations (actual market prices)</li>
          <li>• Dealer acquisition strategy (what to pay)</li>
          <li>• Market timing (days to sell trends)</li>
          <li>• Geographic pricing analysis</li>
        </ul>
        <button className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium">
          Contact for API Access
        </button>
      </div>
    </div>
  );
}
