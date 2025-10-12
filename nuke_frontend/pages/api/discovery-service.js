/**
 * Discovery Service API
 * Handles first discoveries, enrichments, and leaderboard
 */

const { DatabaseManager, DatabaseOperations } = require('../../lib/database-core');
const { Vehicle } = require('../../lib/data-primitives');
const { VINValidator } = require('../../lib/validation-core');

class DiscoveryService {
  constructor() {
    this.dbManager = new DatabaseManager();
    this.dbOps = new DatabaseOperations(this.dbManager.getServiceClient());
  }

  /**
   * Check if vehicle exists and what data is missing
   */
  async checkVehicle(vin) {
    // Validate VIN
    const validation = VINValidator.validate(vin);
    if (!validation.valid) {
      return { error: validation.error };
    }

    const normalizedVIN = validation.normalized;

    // Check database
    const { data: vehicle, error } = await this.dbOps.client
      .from('vehicles')
      .select('*')
      .eq('vin', normalizedVIN)
      .single();

    if (error && error.code === 'PGRST116') {
      // Vehicle doesn't exist
      return {
        exists: false,
        vin: normalizedVIN
      };
    }

    if (vehicle) {
      // Check for missing fields
      const requiredFields = ['make', 'model', 'year', 'price', 'mileage'];
      const missingFields = requiredFields.filter(field => !vehicle[field]);

      return {
        exists: true,
        vehicle_id: vehicle.id,
        missing_data: missingFields.length > 0,
        missing_fields: missingFields,
        last_updated: vehicle.updated_at
      };
    }

    return { exists: false, vin: normalizedVIN };
  }

  /**
   * Report first discovery
   */
  async reportDiscovery(userId, discoveryData) {
    const { vin, ...vehicleData } = discoveryData;

    // Start transaction
    const client = this.dbOps.client;

    // 1. Create vehicle record
    const { data: vehicle, error: vehicleError } = await client
      .from('vehicles')
      .insert({
        vin,
        ...vehicleData,
        discovered_by: userId,
        discovered_at: new Date().toISOString()
      })
      .select()
      .single();

    if (vehicleError) {
      return { error: vehicleError.message };
    }

    // 2. Award points for first discovery
    const points = this.calculateDiscoveryPoints(vehicleData);

    // 3. Create user activity
    const { data: activity, error: activityError } = await client
      .from('user_activities')
      .insert({
        user_id: userId,
        activity_type: 'vehicle_contribution',
        title: `First Discovery: ${vehicleData.make || 'Unknown'} ${vehicleData.model || ''}`,
        description: `Discovered new vehicle with VIN ending in ...${vin.slice(-5)}`,
        vehicle_id: vehicle.id,
        points_earned: points,
        difficulty_level: 'intermediate',
        verification_status: 'verified',
        metadata: {
          discovery_source: vehicleData.source,
          discovery_url: vehicleData.url,
          is_first_discovery: true
        }
      })
      .select()
      .single();

    if (activityError) {
      console.error('Activity creation failed:', activityError);
    }

    // 4. Update user stats
    await this.updateUserStats(userId, points, 'discovery');

    // 5. Check for rank advancement
    const newRank = await this.checkRankAdvancement(userId);

    // 6. Create timeline event
    await client
      .from('timeline_events')
      .insert({
        user_id: userId,
        vehicle_id: vehicle.id,
        event_type: 'discovery',
        event_data: {
          source: vehicleData.source,
          first_reporter: true,
          points_earned: points
        }
      });

    return {
      success: true,
      vehicle_id: vehicle.id,
      points_earned: points,
      new_rank: newRank,
      total_discoveries: await this.getUserDiscoveryCount(userId)
    };
  }

  /**
   * Enrich existing vehicle data
   */
  async enrichVehicle(userId, enrichmentData) {
    const { vin, ...newData } = enrichmentData;

    // Get existing vehicle
    const { data: vehicle, error: fetchError } = await this.dbOps.client
      .from('vehicles')
      .select('*')
      .eq('vin', vin)
      .single();

    if (fetchError || !vehicle) {
      return { error: 'Vehicle not found' };
    }

    // Determine what's actually new
    const actualNewFields = {};
    for (const [key, value] of Object.entries(newData)) {
      if (value && !vehicle[key]) {
        actualNewFields[key] = value;
      }
    }

    if (Object.keys(actualNewFields).length === 0) {
      return { success: true, points_earned: 0 };
    }

    // Update vehicle
    const { error: updateError } = await this.dbOps.client
      .from('vehicles')
      .update({
        ...actualNewFields,
        updated_at: new Date().toISOString()
      })
      .eq('id', vehicle.id);

    if (updateError) {
      return { error: updateError.message };
    }

    // Award enrichment points
    const points = Object.keys(actualNewFields).length * 10;

    // Record contribution
    await this.dbOps.client
      .from('user_contributions')
      .insert({
        user_id: userId,
        vehicle_id: vehicle.id,
        contribution_type: 'enrichment',
        fields_added: Object.keys(actualNewFields),
        points_earned: points,
        metadata: {
          enrichment_source: enrichmentData.enrichment_source
        }
      });

    // Update stats
    await this.updateUserStats(userId, points, 'enrichment');

    return {
      success: true,
      points_earned: points,
      fields_enriched: Object.keys(actualNewFields)
    };
  }

  /**
   * Get leaderboard
   */
  async getLeaderboard(timeframe = 'all') {
    let query = this.dbOps.client
      .from('user_legitimacy_scores')
      .select(`
        user_id,
        total_points,
        activity_count,
        skill_level,
        profiles!inner(username, avatar_url)
      `)
      .order('total_points', { ascending: false })
      .limit(100);

    // Filter by timeframe if needed
    if (timeframe === 'week') {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      query = query.gte('last_activity', weekAgo.toISOString());
    } else if (timeframe === 'month') {
      const monthAgo = new Date();
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      query = query.gte('last_activity', monthAgo.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      return { error: error.message };
    }

    // Format leaderboard
    return data.map((entry, index) => ({
      rank: index + 1,
      username: entry.profiles.username || 'Anonymous',
      avatar: entry.profiles.avatar_url,
      points: entry.total_points,
      discoveries: entry.activity_count,
      level: entry.skill_level,
      trend: this.calculateTrend(entry.user_id)
    }));
  }

  /**
   * Get discovery feed
   */
  async getDiscoveryFeed(limit = 50) {
    const { data, error } = await this.dbOps.client
      .from('vehicles')
      .select(`
        *,
        discovered_by,
        profiles!discovered_by(username, avatar_url),
        timeline_events(
          event_type,
          event_data,
          created_at
        )
      `)
      .order('discovered_at', { ascending: false })
      .limit(limit);

    if (error) {
      return { error: error.message };
    }

    // Format feed
    return data.map(vehicle => ({
      id: vehicle.id,
      vin_preview: `...${vehicle.vin.slice(-5)}`,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      discoverer: {
        username: vehicle.profiles?.username || 'Anonymous',
        avatar: vehicle.profiles?.avatar_url
      },
      discovered_at: vehicle.discovered_at,
      source: vehicle.source,
      url: vehicle.url,
      enrichments: vehicle.timeline_events.filter(e => e.event_type === 'enrichment').length,
      views: vehicle.timeline_events.filter(e => e.event_type === 'view').length
    }));
  }

  // Helper methods
  calculateDiscoveryPoints(vehicleData) {
    let points = 100; // Base discovery points

    // Bonus for complete data
    if (vehicleData.make && vehicleData.model) points += 20;
    if (vehicleData.year) points += 10;
    if (vehicleData.price) points += 15;
    if (vehicleData.mileage) points += 15;
    if (vehicleData.exterior_color) points += 10;

    // Bonus for rare sources
    const rareSourceBonus = {
      'CL': 30,  // Craigslist is harder to track
      'FB': 25,  // Facebook Marketplace
      'Hemmings': 20
    };
    
    if (rareSourceBonus[vehicleData.source]) {
      points += rareSourceBonus[vehicleData.source];
    }

    return points;
  }

  async updateUserStats(userId, points, type) {
    // Upsert user stats
    const { data: current } = await this.dbOps.client
      .from('user_legitimacy_scores')
      .select('*')
      .eq('user_id', userId)
      .single();

    const newStats = {
      user_id: userId,
      total_points: (current?.total_points || 0) + points,
      activity_count: (current?.activity_count || 0) + 1,
      last_activity: new Date().toISOString()
    };

    // Calculate new skill level
    newStats.skill_level = this.calculateSkillLevel(newStats.total_points);

    await this.dbOps.client
      .from('user_legitimacy_scores')
      .upsert(newStats);
  }

  calculateSkillLevel(points) {
    if (points < 100) return 'novice';
    if (points < 500) return 'apprentice';
    if (points < 2000) return 'journeyman';
    if (points < 10000) return 'expert';
    return 'master';
  }

  async checkRankAdvancement(userId) {
    const { data } = await this.dbOps.client
      .from('user_legitimacy_scores')
      .select('skill_level')
      .eq('user_id', userId)
      .single();

    return data?.skill_level;
  }

  async getUserDiscoveryCount(userId) {
    const { count } = await this.dbOps.client
      .from('vehicles')
      .select('*', { count: 'exact', head: true })
      .eq('discovered_by', userId);

    return count || 0;
  }

  calculateTrend(userId) {
    // This would calculate if user is trending up/down
    // For now, return random trend
    return ['up', 'down', 'stable'][Math.floor(Math.random() * 3)];
  }
}

// API endpoints
export default async function handler(req, res) {
  const service = new DiscoveryService();
  const { action, ...params } = req.body;

  // Get user from auth header
  const token = req.headers.authorization?.replace('Bearer ', '');
  const userId = await getUserIdFromToken(token);

  try {
    switch (action) {
      case 'check':
        const checkResult = await service.checkVehicle(params.vin);
        return res.status(200).json(checkResult);

      case 'discover':
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        const discoveryResult = await service.reportDiscovery(userId, params);
        return res.status(200).json(discoveryResult);

      case 'enrich':
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        const enrichResult = await service.enrichVehicle(userId, params);
        return res.status(200).json(enrichResult);

      case 'leaderboard':
        const leaderboard = await service.getLeaderboard(params.timeframe);
        return res.status(200).json(leaderboard);

      case 'feed':
        const feed = await service.getDiscoveryFeed(params.limit);
        return res.status(200).json(feed);

      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('Discovery service error:', error);
    return res.status(500).json({ error: error.message });
  }
}

async function getUserIdFromToken(token) {
  // Validate token and get user ID
  // This would integrate with your auth system
  return null; // Placeholder
}
