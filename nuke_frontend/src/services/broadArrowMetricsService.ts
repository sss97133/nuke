/**
 * Broad Arrow Auctions Metrics Service
 * Calculates volume, revenue, and performance metrics from vehicle data
 */

import { calculateBroadArrowBuyerPremium, calculateBroadArrowRevenue } from '../utils/broadArrowFees';

export interface BroadArrowMetrics {
  totalVehicles: number;
  vehiclesSold: number;
  vehiclesUnsold: number;
  sellThroughRate: number;
  totalHammerPrice: number;
  totalBuyerPremium: number;
  totalRevenue: number;
  averageSalePrice: number;
  averageBuyerPremium: number;
}

export interface VehicleSaleData {
  sale_price?: number | null;
  listing_status?: string | null;
  origin_metadata?: {
    contributor?: any;
    auction_name?: string;
    auction_location?: string;
    price_currency?: string;
  };
}

/**
 * Calculate Broad Arrow metrics from a list of vehicles
 */
export function calculateBroadArrowMetrics(vehicles: VehicleSaleData[]): BroadArrowMetrics {
  const totalVehicles = vehicles.length;
  let vehiclesSold = 0;
  let vehiclesUnsold = 0;
  let totalHammerPrice = 0;
  let totalBuyerPremium = 0;

  vehicles.forEach((vehicle) => {
    const status = (vehicle.listing_status || '').toLowerCase();
    const salePrice = vehicle.sale_price;

    // Count sold/unsold
    if (status === 'sold' || salePrice) {
      vehiclesSold++;
      
      // Calculate revenue from sold vehicles
      if (salePrice && salePrice > 0) {
        // Convert from cents to dollars if needed
        const hammerPrice = salePrice > 1000000 ? salePrice / 100 : salePrice;
        totalHammerPrice += hammerPrice;
        
        // Calculate buyer's premium (Broad Arrow's revenue)
        const calc = calculateBroadArrowBuyerPremium(hammerPrice, true); // Assume motor cars
        totalBuyerPremium += calc.buyerPremium;
      }
    } else if (status === 'unsold' || status === 'ended') {
      vehiclesUnsold++;
    }
  });

  const sellThroughRate = totalVehicles > 0 ? (vehiclesSold / totalVehicles) * 100 : 0;
  const averageSalePrice = vehiclesSold > 0 ? totalHammerPrice / vehiclesSold : 0;
  const averageBuyerPremium = vehiclesSold > 0 ? totalBuyerPremium / vehiclesSold : 0;

  return {
    totalVehicles,
    vehiclesSold,
    vehiclesUnsold,
    sellThroughRate,
    totalHammerPrice,
    totalBuyerPremium,
    totalRevenue: totalBuyerPremium, // Buyer's premium is Broad Arrow's revenue
    averageSalePrice,
    averageBuyerPremium,
  };
}

/**
 * Format metrics for display
 */
export function formatBroadArrowMetrics(metrics: BroadArrowMetrics) {
  return {
    volume: {
      total: metrics.totalVehicles.toLocaleString(),
      sold: metrics.vehiclesSold.toLocaleString(),
      unsold: metrics.vehiclesUnsold.toLocaleString(),
      sellThroughRate: `${metrics.sellThroughRate.toFixed(1)}%`,
    },
    revenue: {
      total: new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(metrics.totalRevenue),
      averagePerSale: new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(metrics.averageBuyerPremium),
    },
    sales: {
      totalHammerPrice: new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(metrics.totalHammerPrice),
      averageSalePrice: new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(metrics.averageSalePrice),
    },
  };
}

