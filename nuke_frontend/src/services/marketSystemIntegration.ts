/**
 * Market System Integration Service
 * Connects all market systems: ETFs, vehicle trading, auctions, portfolios
 */

import { supabase } from '../lib/supabase';
import { AuctionMarketEngine } from './auctionMarketEngine';

// =====================================================
// UNIFIED MARKET DATA TYPES
// =====================================================

export interface UnifiedMarketData {
  // Market Segments (ETFs)
  segments: MarketSegment[];
  etfs: MarketETF[];
  
  // Individual Vehicle Trading
  vehicles: TradableVehicle[];
  offerings: VehicleOffering[];
  
  // Portfolio
  holdings: UserHolding[];
  cash_balance: number;
  
  // Market Stats
  overview: MarketOverview;
}

export interface MarketSegment {
  id: string;
  slug: string;
  name: string;
  description: string;
  vehicle_count: number;
  market_cap_usd: number;
  change_7d_pct: number | null;
  change_30d_pct: number | null;
  fund_symbol: string | null;
}

export interface MarketETF {
  id: string;
  symbol: string;
  segment_id: string;
  segment_name: string;
  nav_share_price: number;
  total_aum_usd: number;
  total_shares_outstanding: number;
  change_7d_pct: number | null;
  user_shares_owned: number;
  user_investment_value: number;
}

export interface TradableVehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  current_value: number;
  offering_id: string | null;
  current_share_price: number | null;
  total_shares: number;
  available_shares: number;
  daily_change_pct: number | null;
  has_funding_round: boolean;
  has_bonds: boolean;
  is_for_sale: boolean;
}

export interface VehicleOffering {
  id: string;
  vehicle_id: string;
  vehicle_title: string;
  status: 'active' | 'trading' | 'closed';
  total_shares: number;
  current_share_price: number;
  highest_bid: number | null;
  lowest_ask: number | null;
  bid_ask_spread: number | null;
  daily_volume: number;
  daily_change_pct: number | null;
}

export interface UserHolding {
  type: 'etf' | 'vehicle_shares' | 'vehicle_stake' | 'vehicle_bond';
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  entry_price: number;
  current_price: number;
  market_value: number;
  unrealized_gain_loss: number;
  unrealized_gain_loss_pct: number;
}

export interface MarketOverview {
  total_market_cap: number;
  total_etf_aum: number;
  total_vehicles_trading: number;
  total_active_traders: number;
  daily_volume: number;
  top_gainers: Array<{symbol: string; name: string; change_pct: number}>;
  top_losers: Array<{symbol: string; name: string; change_pct: number}>;
}

// =====================================================
// MARKET SYSTEM INTEGRATION SERVICE
// =====================================================

export class MarketSystemIntegration {
  
  /**
   * Get comprehensive market data for dashboard
   */
  static async getUnifiedMarketData(userId?: string): Promise<UnifiedMarketData> {
    const [segments, etfs, vehicles, offerings, holdings, overview] = await Promise.all([
      this.getMarketSegments(),
      this.getUserETFHoldings(userId),
      this.getTradableVehicles(),
      this.getVehicleOfferings(),
      this.getUserHoldings(userId),
      this.getMarketOverview()
    ]);

    const cashBalance = userId ? await this.getUserCashBalance(userId) : 0;

    return {
      segments,
      etfs,
      vehicles,
      offerings,
      holdings,
      cash_balance: cashBalance,
      overview
    };
  }

  /**
   * Get market segments with performance data
   */
  static async getMarketSegments(): Promise<MarketSegment[]> {
    const { data, error } = await supabase
      .from('market_segments_index')
      .select('*')
      .order('market_cap_usd', { ascending: false });

    if (error) throw error;

    return (data || []).map((row: any) => ({
      id: row.segment_id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      vehicle_count: Number(row.vehicle_count || 0),
      market_cap_usd: Number(row.market_cap_usd || 0),
      change_7d_pct: row.change_7d_pct ? Number(row.change_7d_pct) : null,
      change_30d_pct: row.change_30d_pct ? Number(row.change_30d_pct) : null,
      fund_symbol: row.fund_symbol
    }));
  }

  /**
   * Get user's ETF holdings with current values
   */
  static async getUserETFHoldings(userId?: string): Promise<MarketETF[]> {
    if (!userId) return [];

    const { data, error } = await supabase
      .from('market_fund_holdings')
      .select(`
        *,
        fund:market_funds!inner(
          id,
          symbol,
          nav_share_price,
          total_aum_usd,
          total_shares_outstanding,
          segment:market_segments!inner(
            name
          )
        )
      `)
      .eq('user_id', userId);

    if (error) throw error;

    // Get segment stats for change percentages
    const segmentStats = await Promise.all(
      (data || []).map(async (holding: any) => {
        const { data: stats } = await supabase
          .rpc('market_segment_stats', { p_segment_id: holding.fund.segment.id });
        return { holding_id: holding.id, stats: Array.isArray(stats) ? stats[0] : stats };
      })
    );

    return (data || []).map((holding: any) => {
      const stats = segmentStats.find(s => s.holding_id === holding.id)?.stats;
      return {
        id: holding.fund.id,
        symbol: holding.fund.symbol,
        segment_id: holding.fund.segment_id,
        segment_name: holding.fund.segment.name,
        nav_share_price: Number(holding.fund.nav_share_price),
        total_aum_usd: Number(holding.fund.total_aum_usd),
        total_shares_outstanding: Number(holding.fund.total_shares_outstanding),
        change_7d_pct: stats?.change_7d_pct ? Number(stats.change_7d_pct) : null,
        user_shares_owned: Number(holding.shares_owned),
        user_investment_value: Number(holding.shares_owned) * Number(holding.fund.nav_share_price)
      };
    });
  }

  /**
   * Get tradable vehicles with market data
   */
  static async getTradableVehicles(): Promise<TradableVehicle[]> {
    const { data: vehicles, error: vehicleError } = await supabase
      .from('vehicles')
      .select(`
        id,
        make,
        model,
        year,
        current_value,
        is_public
      `)
      .eq('is_public', true)
      .not('current_value', 'is', null)
      .order('current_value', { ascending: false })
      .limit(100);

    if (vehicleError) throw vehicleError;

    const vehicleIds = (vehicles || []).map(v => v.id);

    // Get vehicle offerings (shares trading)
    const { data: offerings } = await supabase
      .from('vehicle_offerings')
      .select('*')
      .in('vehicle_id', vehicleIds)
      .eq('status', 'trading');

    // Get funding rounds
    const { data: fundingRounds } = await supabase
      .from('vehicle_funding_rounds')
      .select('vehicle_id')
      .in('vehicle_id', vehicleIds)
      .in('status', ['fundraising', 'active']);

    // Get bonds
    const { data: bonds } = await supabase
      .from('vehicle_bonds')
      .select('vehicle_id')
      .in('vehicle_id', vehicleIds)
      .eq('status', 'active');

    // Get listings
    const { data: listings } = await supabase
      .from('market_listings')
      .select('vehicle_id')
      .in('vehicle_id', vehicleIds)
      .eq('status', 'active');

    const offeringsMap = new Map((offerings || []).map(o => [o.vehicle_id, o]));
    const fundingRoundsSet = new Set((fundingRounds || []).map(f => f.vehicle_id));
    const bondsSet = new Set((bonds || []).map(b => b.vehicle_id));
    const listingsSet = new Set((listings || []).map(l => l.vehicle_id));

    return (vehicles || []).map((v: any) => {
      const offering = offeringsMap.get(v.id);
      return {
        id: v.id,
        make: v.make || 'Unknown',
        model: v.model || 'Unknown',
        year: v.year,
        current_value: Number(v.current_value || 0),
        offering_id: offering?.id || null,
        current_share_price: offering ? Number(offering.current_share_price) : null,
        total_shares: offering ? Number(offering.total_shares) : 1000,
        available_shares: offering ? Number(offering.total_shares) : 0,
        daily_change_pct: offering ? this.calculateDailyChange(offering) : null,
        has_funding_round: fundingRoundsSet.has(v.id),
        has_bonds: bondsSet.has(v.id),
        is_for_sale: listingsSet.has(v.id)
      };
    });
  }

  /**
   * Get vehicle offerings with market data
   */
  static async getVehicleOfferings(): Promise<VehicleOffering[]> {
    const { data, error } = await supabase
      .from('vehicle_offerings')
      .select(`
        id,
        vehicle_id,
        total_shares,
        current_share_price,
        highest_bid,
        lowest_ask,
        bid_ask_spread,
        status,
        vehicles!inner(
          make,
          model,
          year
        )
      `)
      .in('status', ['active', 'trading'])
      .order('total_volume_usd', { ascending: false })
      .limit(50);

    if (error) throw error;

    return (data || []).map((offering: any) => ({
      id: offering.id,
      vehicle_id: offering.vehicle_id,
      vehicle_title: `${offering.vehicles.year} ${offering.vehicles.make} ${offering.vehicles.model}`,
      status: offering.status,
      total_shares: Number(offering.total_shares),
      current_share_price: Number(offering.current_share_price),
      highest_bid: offering.highest_bid ? Number(offering.highest_bid) : null,
      lowest_ask: offering.lowest_ask ? Number(offering.lowest_ask) : null,
      bid_ask_spread: offering.bid_ask_spread ? Number(offering.bid_ask_spread) : null,
      daily_volume: 0, // TODO: calculate from market_trades
      daily_change_pct: this.calculateDailyChange(offering)
    }));
  }

  /**
   * Get user's complete holdings across all products
   */
  static async getUserHoldings(userId?: string): Promise<UserHolding[]> {
    if (!userId) return [];

    const [etfHoldings, shareHoldings, stakes, bonds] = await Promise.all([
      this.getUserETFHoldings(userId),
      this.getUserShareHoldings(userId),
      this.getUserStakes(userId),
      this.getUserBonds(userId)
    ]);

    const holdings: UserHolding[] = [];

    // ETF Holdings
    etfHoldings.forEach(etf => {
      holdings.push({
        type: 'etf',
        id: etf.id,
        symbol: etf.symbol,
        name: etf.segment_name,
        quantity: etf.user_shares_owned,
        entry_price: etf.nav_share_price, // TODO: get actual entry price
        current_price: etf.nav_share_price,
        market_value: etf.user_investment_value,
        unrealized_gain_loss: 0, // TODO: calculate
        unrealized_gain_loss_pct: 0
      });
    });

    // Share Holdings
    shareHoldings.forEach(share => {
      holdings.push({
        type: 'vehicle_shares',
        id: share.id,
        symbol: share.vehicle_title,
        name: share.vehicle_title,
        quantity: share.shares_owned,
        entry_price: share.entry_price,
        current_price: share.current_mark,
        market_value: share.current_mark * share.shares_owned,
        unrealized_gain_loss: share.unrealized_gain_loss,
        unrealized_gain_loss_pct: share.unrealized_gain_loss_pct
      });
    });

    // Stakes
    stakes.forEach(stake => {
      holdings.push({
        type: 'vehicle_stake',
        id: stake.id,
        symbol: `${stake.vehicle_title} Stake`,
        name: `${stake.vehicle_title} Stake`,
        quantity: 1,
        entry_price: stake.amount_staked_cents / 100,
        current_price: stake.estimated_value_cents / 100,
        market_value: stake.estimated_value_cents / 100,
        unrealized_gain_loss: (stake.estimated_value_cents - stake.amount_staked_cents) / 100,
        unrealized_gain_loss_pct: ((stake.estimated_value_cents - stake.amount_staked_cents) / stake.amount_staked_cents) * 100
      });
    });

    // Bonds
    bonds.forEach(bond => {
      holdings.push({
        type: 'vehicle_bond',
        id: bond.id,
        symbol: `${bond.vehicle_title} Bond`,
        name: `${bond.vehicle_title} Bond`,
        quantity: 1,
        entry_price: bond.principal_cents / 100,
        current_price: bond.current_value_cents / 100,
        market_value: bond.current_value_cents / 100,
        unrealized_gain_loss: (bond.current_value_cents - bond.principal_cents) / 100,
        unrealized_gain_loss_pct: ((bond.current_value_cents - bond.principal_cents) / bond.principal_cents) * 100
      });
    });

    return holdings;
  }

  /**
   * Get market overview statistics
   */
  static async getMarketOverview(): Promise<MarketOverview> {
    // Get aggregate stats from multiple sources
    const [segmentData, offeringData, tradeData] = await Promise.all([
      supabase.from('market_segments_index').select('market_cap_usd, total_aum_usd'),
      supabase.from('vehicle_offerings').select('current_share_price, total_shares').eq('status', 'trading'),
      supabase.from('market_trades').select('total_value').gte('executed_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    ]);

    const totalMarketCap = (segmentData.data || []).reduce((sum, s) => sum + Number(s.market_cap_usd || 0), 0);
    const totalEtfAum = (segmentData.data || []).reduce((sum, s) => sum + Number(s.total_aum_usd || 0), 0);
    const totalVehiclesTrading = (offeringData.data || []).length;
    const dailyVolume = (tradeData.data || []).reduce((sum, t) => sum + Number(t.total_value || 0), 0);

    return {
      total_market_cap: totalMarketCap,
      total_etf_aum: totalEtfAum,
      total_vehicles_trading: totalVehiclesTrading,
      total_active_traders: 0, // TODO: count from user_trading_stats
      daily_volume: dailyVolume,
      top_gainers: [], // TODO: implement
      top_losers: [] // TODO: implement
    };
  }

  /**
   * Get user's cash balance
   */
  static async getUserCashBalance(userId: string): Promise<number> {
    const { data, error } = await supabase
      .from('user_cash_balances')
      .select('available_cents')
      .eq('user_id', userId)
      .single();

    if (error) return 0;
    return Number(data?.available_cents || 0);
  }

  /**
   * Place order (integrates with auction engine)
   */
  static async placeOrder(
    offeringId: string,
    userId: string,
    orderType: 'buy' | 'sell',
    shares: number,
    pricePerShare: number
  ) {
    return await AuctionMarketEngine.placeOrder(
      offeringId,
      userId,
      orderType,
      shares,
      pricePerShare
    );
  }

  /**
   * Get order book for vehicle
   */
  static async getOrderBook(offeringId: string) {
    return await AuctionMarketEngine.getOrderBook(offeringId);
  }

  /**
   * Get user's portfolio value
   */
  static async getPortfolioValue(userId: string) {
    return await AuctionMarketEngine.getPortfolioValue(userId);
  }

  // =====================================================
  // HELPER METHODS
  // =====================================================

  private static async getUserShareHoldings(userId: string): Promise<any[]> {
    const { data } = await supabase
      .from('share_holdings')
      .select(`
        *,
        offering:vehicle_offerings!inner(
          vehicle:vehicles!inner(
            make,
            model,
            year
          )
        )
      `)
      .eq('user_id', userId);

    return (data || []).map((holding: any) => ({
      ...holding,
      vehicle_title: `${holding.offering.vehicle.year} ${holding.offering.vehicle.make} ${holding.offering.vehicle.model}`
    }));
  }

  private static async getUserStakes(userId: string): Promise<any[]> {
    const { data } = await supabase
      .from('profit_share_stakes')
      .select(`
        *,
        funding_round:vehicle_funding_rounds!inner(
          vehicle:vehicles!inner(
            make,
            model,
            year
          )
        )
      `)
      .eq('staker_id', userId);

    return (data || []).map((stake: any) => ({
      ...stake,
      vehicle_title: `${stake.funding_round.vehicle.year} ${stake.funding_round.vehicle.make} ${stake.funding_round.vehicle.model}`,
      estimated_value_cents: stake.amount_staked_cents // TODO: calculate actual estimated value
    }));
  }

  private static async getUserBonds(userId: string): Promise<any[]> {
    const { data } = await supabase
      .from('bond_holdings')
      .select(`
        *,
        bond:vehicle_bonds!inner(
          vehicle:vehicles!inner(
            make,
            model,
            year
          )
        )
      `)
      .eq('user_id', userId);

    return (data || []).map((holding: any) => ({
      ...holding,
      vehicle_title: `${holding.bond.vehicle.year} ${holding.bond.vehicle.make} ${holding.bond.vehicle.model}`,
      current_value_cents: holding.principal_cents // TODO: add accrued interest
    }));
  }

  private static calculateDailyChange(offering: any): number | null {
    // TODO: Implement by comparing current_share_price to opening_price
    // For now return mock data
    return Math.random() * 10 - 5; // -5% to +5%
  }
}
