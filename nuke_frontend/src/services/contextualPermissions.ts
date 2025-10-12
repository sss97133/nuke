import { supabase } from '../lib/supabase';
import rbacService, { Permission, UserRole, VehicleUserRelationship } from './rbacService';

// Context factors that can influence permissions
interface PermissionContext {
  // User context
  userLocation?: { lat: number; lng: number };
  userTimezone?: string;
  deviceType?: 'mobile' | 'tablet' | 'desktop';

  // Session context
  sessionDuration?: number; // minutes
  recentActivity?: string[];

  // Vehicle context
  vehicleLocation?: { lat: number; lng: number };
  vehicleStatus?: 'active' | 'for_sale' | 'sold' | 'private';
  ownerPresence?: boolean; // is owner currently active

  // Temporal context
  timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night';
  dayOfWeek?: 'weekday' | 'weekend';

  // Social context
  collaboratorsOnline?: number;
  recentChanges?: number; // changes in last 24h
  disputesActive?: number;

  // Trust context
  recentTrustEvents?: Array<{
    type: 'positive' | 'negative';
    weight: number;
    timestamp: string;
  }>;
}

// Dynamic permission modifiers based on context
interface PermissionModifier {
  condition: (context: PermissionContext, relationship: VehicleUserRelationship) => boolean;
  effect: 'grant' | 'revoke' | 'enhance' | 'restrict';
  permissions: Permission[];
  reason: string;
  priority: number;
}

const CONTEXTUAL_MODIFIERS: PermissionModifier[] = [
  // Location-based modifiers
  {
    condition: (ctx, rel) => {
      // Grant enhanced permissions if user is near the vehicle
      if (!ctx.userLocation || !ctx.vehicleLocation) return false;
      const distance = calculateDistance(ctx.userLocation, ctx.vehicleLocation);
      return distance < 100; // Within 100 meters
    },
    effect: 'enhance',
    permissions: ['edit_basic_info', 'add_photos', 'add_notes'],
    reason: 'User is physically near the vehicle',
    priority: 10
  },

  // Time-based modifiers
  {
    condition: (ctx, rel) => {
      // Restrict certain permissions during off-hours for non-owners
      if (rel.role === 'owner') return false;
      return ctx.timeOfDay === 'night';
    },
    effect: 'restrict',
    permissions: ['edit_specs', 'delete_content', 'manage_contributors'],
    reason: 'Limited permissions during night hours',
    priority: 5
  },

  // Activity-based modifiers
  {
    condition: (ctx, rel) => {
      // Enhance permissions for active, trusted contributors
      const recentActivity = ctx.recentActivity?.length || 0;
      return (
        recentActivity >= 5 &&
        rel.context_modifiers.trustScore >= 60 &&
        ['contributor', 'restorer', 'mechanic'].includes(rel.role)
      );
    },
    effect: 'enhance',
    permissions: ['verify_data', 'moderate_comments'],
    reason: 'High activity and trust score',
    priority: 8
  },

  // Social collaboration modifiers
  {
    condition: (ctx, rel) => {
      // Grant collaborative permissions when owner is online
      return ctx.ownerPresence === true && rel.role !== 'owner';
    },
    effect: 'grant',
    permissions: ['edit_specs', 'add_parts'],
    reason: 'Owner is present to supervise changes',
    priority: 7
  },

  // Dispute protection
  {
    condition: (ctx, rel) => {
      // Restrict permissions if there are active disputes
      return (ctx.disputesActive || 0) > 0 && rel.role !== 'owner';
    },
    effect: 'restrict',
    permissions: ['edit_basic_info', 'edit_specs', 'delete_content'],
    reason: 'Active disputes require owner approval',
    priority: 15
  },

  // Trust score decay
  {
    condition: (ctx, rel) => {
      // Reduce permissions if user has recent negative trust events
      const negativeEvents = ctx.recentTrustEvents?.filter(e => e.type === 'negative').length || 0;
      return negativeEvents >= 2;
    },
    effect: 'restrict',
    permissions: ['edit_specs', 'manage_contributors', 'verify_data'],
    reason: 'Recent trust issues require review',
    priority: 12
  },

  // Progressive permissions
  {
    condition: (ctx, rel) => {
      // Grant advanced permissions to long-term, active users
      const daysSinceJoined = rel.context_modifiers.timeAsUser;
      const contributions = rel.context_modifiers.contributionCount;
      return (
        daysSinceJoined >= 30 &&
        contributions >= 20 &&
        rel.context_modifiers.trustScore >= 70
      );
    },
    effect: 'enhance',
    permissions: ['professional_tools', 'verify_data'],
    reason: 'Veteran contributor with proven track record',
    priority: 6
  },

  // Device-based restrictions
  {
    condition: (ctx, rel) => {
      // Restrict sensitive operations on mobile devices
      return ctx.deviceType === 'mobile' && rel.role !== 'owner';
    },
    effect: 'restrict',
    permissions: ['delete_content', 'manage_contributors', 'edit_specs'],
    reason: 'Mobile device safety restrictions',
    priority: 3
  },

  // Market activity modifiers
  {
    condition: (ctx, rel) => {
      // Restrict editing when vehicle is actively for sale
      return ctx.vehicleStatus === 'for_sale' && rel.role !== 'owner';
    },
    effect: 'restrict',
    permissions: ['edit_basic_info', 'edit_specs', 'edit_valuations'],
    reason: 'Vehicle is listed for sale',
    priority: 11
  }
];

class ContextualPermissionService {

  // Calculate contextual permissions for a user
  async getContextualPermissions(
    vehicleId: string,
    userId: string,
    baseContext?: Partial<PermissionContext>
  ): Promise<{
    permissions: Permission[];
    modifiers: Array<{
      effect: 'grant' | 'revoke' | 'enhance' | 'restrict';
      permissions: Permission[];
      reason: string;
    }>;
  }> {
    try {
      // Get base relationship
      const relationship = await rbacService.getUserVehicleRelationship(vehicleId, userId);
      if (!relationship) {
        return { permissions: [], modifiers: [] };
      }

      // Build full context
      const context = await this.buildContext(vehicleId, userId, baseContext);

      // Get base permissions
      const basePermissions = await rbacService.getUserPermissions(vehicleId, userId);

      // Apply contextual modifiers
      const applicableModifiers = CONTEXTUAL_MODIFIERS
        .filter(modifier => modifier.condition(context, relationship))
        .sort((a, b) => b.priority - a.priority);

      let finalPermissions = [...basePermissions];
      const appliedModifiers = [];

      for (const modifier of applicableModifiers) {
        switch (modifier.effect) {
          case 'grant':
            finalPermissions = [...new Set([...finalPermissions, ...modifier.permissions])];
            break;
          case 'revoke':
            finalPermissions = finalPermissions.filter(p => !modifier.permissions.includes(p));
            break;
          case 'enhance':
            // Add permissions if user already has related permissions
            const canEnhance = modifier.permissions.some(p => basePermissions.includes(p));
            if (canEnhance) {
              finalPermissions = [...new Set([...finalPermissions, ...modifier.permissions])];
            }
            break;
          case 'restrict':
            finalPermissions = finalPermissions.filter(p => !modifier.permissions.includes(p));
            break;
        }

        appliedModifiers.push({
          effect: modifier.effect,
          permissions: modifier.permissions,
          reason: modifier.reason
        });
      }

      return {
        permissions: finalPermissions,
        modifiers: appliedModifiers
      };

    } catch (error) {
      console.error('Error calculating contextual permissions:', error);
      return { permissions: [], modifiers: [] };
    }
  }

  // Build comprehensive context for permission calculation
  private async buildContext(
    vehicleId: string,
    userId: string,
    baseContext?: Partial<PermissionContext>
  ): Promise<PermissionContext> {
    const context: PermissionContext = { ...baseContext };

    try {
      // Get temporal context
      const now = new Date();
      const hour = now.getHours();
      context.timeOfDay = hour < 6 ? 'night'
        : hour < 12 ? 'morning'
        : hour < 18 ? 'afternoon'
        : hour < 22 ? 'evening' : 'night';

      context.dayOfWeek = [0, 6].includes(now.getDay()) ? 'weekend' : 'weekday';

      // Get vehicle status
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('status, latitude, longitude')
        .eq('id', vehicleId)
        .single();

      if (vehicle) {
        context.vehicleStatus = vehicle.status || 'active';
        if (vehicle.latitude && vehicle.longitude) {
          context.vehicleLocation = { lat: vehicle.latitude, lng: vehicle.longitude };
        }
      }

      // Check owner presence (simplified)
      const { data: ownerSessions } = await supabase
        .from('user_sessions')
        .select('user_id')
        .eq('vehicle_id', vehicleId)
        .gte('last_seen', new Date(Date.now() - 15 * 60 * 1000).toISOString()); // 15 minutes

      context.ownerPresence = ownerSessions && ownerSessions.length > 0;

      // Get recent activity
      const { data: recentActivity } = await supabase
        .from('activity_log')
        .select('action')
        .eq('user_id', userId)
        .eq('vehicle_id', vehicleId)
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(20);

      context.recentActivity = recentActivity?.map(a => a.action) || [];

      // Get active disputes
      const { data: disputes } = await supabase
        .from('disputes')
        .select('id')
        .eq('vehicle_id', vehicleId)
        .eq('status', 'active');

      context.disputesActive = disputes?.length || 0;

      // Get recent changes count
      const { data: recentChanges } = await supabase
        .from('change_log')
        .select('id')
        .eq('vehicle_id', vehicleId)
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      context.recentChanges = recentChanges?.length || 0;

      // Get collaborators online
      const { data: collaborators } = await supabase
        .from('vehicle_user_relationships')
        .select('user_id')
        .eq('vehicle_id', vehicleId)
        .eq('status', 'active');

      const collaboratorIds = collaborators?.map(c => c.user_id) || [];

      if (collaboratorIds.length > 0) {
        const { data: onlineUsers } = await supabase
          .from('user_sessions')
          .select('user_id')
          .in('user_id', collaboratorIds)
          .gte('last_seen', new Date(Date.now() - 15 * 60 * 1000).toISOString());

        context.collaboratorsOnline = onlineUsers?.length || 0;
      }

    } catch (error) {
      console.error('Error building permission context:', error);
    }

    return context;
  }

  // Record user activity for future context building
  async recordActivity(
    userId: string,
    vehicleId: string,
    action: string,
    metadata?: any
  ): Promise<void> {
    try {
      await supabase
        .from('activity_log')
        .insert({
          user_id: userId,
          vehicle_id: vehicleId,
          action,
          metadata: metadata || {},
          created_at: new Date().toISOString()
        });
    } catch (error) {
      console.error('Error recording activity:', error);
    }
  }

  // Update user trust score based on actions
  async updateTrustScore(
    userId: string,
    vehicleId: string,
    delta: number,
    reason: string
  ): Promise<void> {
    try {
      // Record trust event
      await supabase
        .from('trust_events')
        .insert({
          user_id: userId,
          vehicle_id: vehicleId,
          delta,
          reason,
          created_at: new Date().toISOString()
        });

      // Update relationship trust score
      await supabase.rpc('update_trust_score', {
        p_user_id: userId,
        p_vehicle_id: vehicleId,
        p_delta: delta
      });

    } catch (error) {
      console.error('Error updating trust score:', error);
    }
  }
}

// Utility function to calculate distance between two coordinates
function calculateDistance(
  coord1: { lat: number; lng: number },
  coord2: { lat: number; lng: number }
): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = coord1.lat * Math.PI / 180;
  const φ2 = coord2.lat * Math.PI / 180;
  const Δφ = (coord2.lat - coord1.lat) * Math.PI / 180;
  const Δλ = (coord2.lng - coord1.lng) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

export const contextualPermissionService = new ContextualPermissionService();
export default contextualPermissionService;