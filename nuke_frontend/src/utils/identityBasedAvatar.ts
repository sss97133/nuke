/**
 * Identity-Based Avatar Generator
 * Creates avatars based on user profile data, comments, and identity traits
 * Falls back to username analysis if profile is limited
 */

import { supabase } from '../lib/supabase';

export interface UserIdentity {
  username: string;
  username_parts?: string[];
  profile_data?: {
    member_since?: string;
    location?: string;
    total_comments?: number;
    total_listings?: number;
  };
  comment_analysis?: {
    mentioned_makes?: string[];
    mentioned_models?: string[];
    technical_terms?: string[];
    era_focus?: string[];
    avg_comment_length?: number;
    comment_count?: number;
  };
  comments?: Array<{
    vehicle_title: string;
    comment_text: string;
    posted_at: string;
  }>;
}

/**
 * Generate avatar pattern based on user identity
 * Uses profile data, comments, and username analysis
 */
export async function generateIdentityBasedAvatar(
  seed: string,
  platform?: 'bat' | 'nzero',
  userId?: string
): Promise<string> {
  // Try to load user identity data
  const identity = await loadUserIdentity(seed, platform, userId);
  
  // Generate pattern based on identity
  return generatePatternFromIdentity(identity);
}

/**
 * Load user identity from database
 */
async function loadUserIdentity(
  seed: string,
  platform?: 'bat' | 'nzero',
  userId?: string
): Promise<UserIdentity> {
  const identity: UserIdentity = {
    username: seed
  };

  // If BaT platform, check external_identities
  if (platform === 'bat') {
    const { data: extIdentity } = await supabase
      .from('external_identities')
      .select('handle, metadata, claimed_by_user_id')
      .eq('platform', 'bat')
      .eq('handle', seed)
      .maybeSingle();

    if (extIdentity?.metadata) {
      identity.comment_analysis = extIdentity.metadata.comment_analysis;
      identity.profile_data = {
        member_since: extIdentity.metadata.member_since,
        location: extIdentity.metadata.location,
        total_comments: extIdentity.metadata.comments_count,
        total_listings: extIdentity.metadata.listings_count
      };
    }

    // Get comments from bat_comments table
    const { data: comments } = await supabase
      .from('bat_comments')
      .select('comment_text, vehicle_id, comment_timestamp, vehicle:vehicles(title)')
      .eq('bat_username', seed)
      .order('comment_timestamp', { ascending: false })
      .limit(50);

    if (comments && comments.length > 0) {
      identity.comments = comments.map(c => ({
        vehicle_title: (c.vehicle as any)?.title || 'Unknown',
        comment_text: c.comment_text,
        posted_at: c.comment_timestamp || new Date().toISOString()
      }));
    }
  }

  // Analyze username if no other data
  if (!identity.comment_analysis && !identity.comments) {
    identity.username_parts = analyzeUsername(seed);
  }

  return identity;
}

/**
 * Analyze username for meaning (e.g., "mrgem" -> ["mr", "gem"])
 */
function analyzeUsername(username: string): string[] {
  // Split on common separators
  const parts = username.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  
  // If no separators, try to split on case changes or common patterns
  if (parts.length === 1) {
    const word = parts[0];
    // Try to find word boundaries (e.g., "mrgem" -> ["mr", "gem"])
    const commonPrefixes = ['mr', 'ms', 'dr', 'prof', 'the', 'my', 'our'];
    for (const prefix of commonPrefixes) {
      if (word.startsWith(prefix) && word.length > prefix.length) {
        return [prefix, word.slice(prefix.length)];
      }
    }
    
    // Try splitting on common patterns
    if (word.length > 4) {
      // Try 2-3 char prefix + rest
      for (let i = 2; i <= 3; i++) {
        const prefix = word.slice(0, i);
        const suffix = word.slice(i);
        if (suffix.length >= 2) {
          return [prefix, suffix];
        }
      }
    }
  }
  
  return parts;
}

/**
 * Generate ASCII pattern from user identity
 */
function generatePatternFromIdentity(identity: UserIdentity): string {
  // Create seed from identity traits
  let seed = identity.username;
  
  // Add identity traits to seed for more unique patterns
  if (identity.username_parts) {
    seed += identity.username_parts.join('');
  }
  
  if (identity.comment_analysis?.mentioned_makes) {
    seed += identity.comment_analysis.mentioned_makes.slice(0, 3).join('');
  }
  
  if (identity.comment_analysis?.era_focus) {
    seed += identity.comment_analysis.era_focus.join('');
  }
  
  // Generate hash from seed
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash = hash & hash;
  }
  
  const rng = (seed: number) => {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  };
  
  // Choose character set based on identity
  let chars: string[];
  if (identity.comment_analysis?.technical_terms && identity.comment_analysis.technical_terms.length > 0) {
    // Technical/enthusiast - use more structured chars
    chars = ['.', ':', '-', '=', '+', 'X'];
  } else if (identity.username_parts && identity.username_parts.length > 1) {
    // Compound username - use flowing chars
    chars = ['.', ':', '-', '=', '+'];
  } else {
    // Simple username - use basic chars
    chars = ['.', ':', '-', '='];
  }
  
  const width = 12;
  const height = 12;
  
  let pattern = '';
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const centerX = width / 2;
      const centerY = height / 2;
      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);
      const normalizedDist = dist / maxDist;
      
      // Adjust pattern based on identity
      let density = 0;
      
      if (identity.comment_analysis?.comment_count && identity.comment_analysis.comment_count > 50) {
        // Active commenter - denser pattern
        const angle = Math.atan2(dy, dx);
        const wave1 = Math.sin(dist * 0.8 + angle * 3) * 0.5 + 0.5;
        const wave2 = Math.cos(dist * 1.2 - angle * 2) * 0.3 + 0.3;
        const noise = rng(hash + x * 13 + y * 17);
        density = (1 - normalizedDist * 0.6) * (wave1 * 0.6 + wave2 * 0.4) + noise * 0.25;
      } else {
        // Less active - simpler pattern
        const noise = rng(hash + x * 7 + y * 11);
        density = (1 - normalizedDist * 0.8) * 0.7 + noise * 0.2;
      }
      
      if (density > 0.3) {
        const charIndex = Math.min(
          Math.floor((density - 0.3) / 0.7 * chars.length),
          chars.length - 1
        );
        pattern += chars[charIndex];
      } else {
        pattern += ' ';
      }
    }
    pattern += '\n';
  }
  
  return pattern;
}

/**
 * Get monogram from identity (prefer meaningful parts)
 */
export function getMonogramFromIdentity(identity: UserIdentity): string {
  if (identity.username_parts && identity.username_parts.length > 1) {
    // Use first letter of each meaningful part
    return identity.username_parts
      .slice(0, 2)
      .map(p => p.charAt(0).toUpperCase())
      .join('');
  }
  
  // Fallback to first character
  return identity.username.charAt(0).toUpperCase();
}

