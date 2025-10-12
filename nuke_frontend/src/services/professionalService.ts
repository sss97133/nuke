import { supabase } from '../lib/supabase';

export interface BusinessProfile {
  id: string;
  user_id: string;
  business_name: string;
  business_type: 'independent_shop' | 'dealership' | 'restoration_shop' | 'performance_shop' | 'body_shop' | 'detailing' | 'parts_supplier' | 'mobile_mechanic' | 'specialty_service' | 'other';
  description?: string;
  specializations: string[];
  phone?: string;
  email?: string;
  website?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  years_in_business?: number;
  employee_count?: number;
  service_radius_miles?: number;
  is_verified: boolean;
  verification_date?: string;
  average_rating?: number;
  review_count?: number;
  created_at: string;
  updated_at: string;
}

export interface ProfessionalUser {
  user_id: string;
  email: string;
  username?: string;
  full_name?: string;
  user_type: 'business' | 'professional' | 'individual';
  business_name?: string;
  business_type?: string;
  business_verified: boolean;
  verified_certifications: number;
  specialization_count: number;
  average_rating?: number;
  review_count: number;
  city?: string;
  state?: string;
  service_radius_miles?: number;
  created_at: string;
}

export interface UserSpecialization {
  id: string;
  user_id: string;
  specialization_category: 'engine' | 'transmission' | 'suspension' | 'brakes' | 'electrical' | 'bodywork' | 'paint' | 'interior' | 'performance' | 'restoration' | 'diagnostics' | 'maintenance' | 'fabrication' | 'tuning' | 'other';
  specialization_name: string;
  skill_level: number;
  years_experience?: number;
  description?: string;
}

export interface ProfessionalCertification {
  id: string;
  user_id: string;
  certification_type: 'ase' | 'manufacturer' | 'trade_school' | 'apprenticeship' | 'specialty' | 'business_license' | 'other';
  certification_name: string;
  issuing_organization: string;
  certification_number?: string;
  issue_date?: string;
  expiry_date?: string;
  is_verified: boolean;
}

export interface ProfessionalSearchFilters {
  location?: {
    city?: string;
    state?: string;
    zipCode?: string;
    radiusMiles?: number;
  };
  businessType?: string[];
  specializations?: string[];
  minRating?: number;
  isVerified?: boolean;
  userType?: 'business' | 'professional' | 'individual';
  sortBy?: 'rating' | 'reviews' | 'distance' | 'experience' | 'recent';
  limit?: number;
  offset?: number;
}

class ProfessionalService {
  // Search for professional users and businesses
  async searchProfessionals(filters: ProfessionalSearchFilters = {}): Promise<ProfessionalUser[]> {
    try {
      let query = supabase
        .from('user_professional_status')
        .select('*');

      // Apply filters
      if (filters.userType) {
        query = query.eq('user_type', filters.userType);
      }

      if (filters.businessType && filters.businessType.length > 0) {
        query = query.in('business_type', filters.businessType);
      }

      if (filters.minRating) {
        query = query.gte('average_rating', filters.minRating);
      }

      if (filters.isVerified) {
        query = query.eq('business_verified', true);
      }

      if (filters.location?.state) {
        query = query.eq('state', filters.location.state);
      }

      if (filters.location?.city) {
        query = query.eq('city', filters.location.city);
      }

      // Apply sorting
      switch (filters.sortBy) {
        case 'rating':
          query = query.order('average_rating', { ascending: false, nullsFirst: false });
          break;
        case 'reviews':
          query = query.order('review_count', { ascending: false });
          break;
        case 'experience':
          query = query.order('verified_certifications', { ascending: false });
          break;
        case 'recent':
          query = query.order('created_at', { ascending: false });
          break;
        default:
          query = query.order('average_rating', { ascending: false, nullsFirst: false });
      }

      // Apply pagination
      if (filters.limit) {
        query = query.limit(filters.limit);
      }
      if (filters.offset) {
        query = query.range(filters.offset, filters.offset + (filters.limit || 20) - 1);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error searching professionals:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in searchProfessionals:', error);
      return [];
    }
  }

  // Get business profile for a user
  async getBusinessProfile(userId: string): Promise<BusinessProfile | null> {
    try {
      const { data, error } = await supabase
        .from('business_profiles')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // No business profile found
        }
        console.error('Error fetching business profile:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error in getBusinessProfile:', error);
      return null;
    }
  }

  // Get user specializations
  async getUserSpecializations(userId: string): Promise<UserSpecialization[]> {
    try {
      const { data, error } = await supabase
        .from('user_specializations')
        .select('*')
        .eq('user_id', userId)
        .order('skill_level', { ascending: false });

      if (error) {
        console.error('Error fetching user specializations:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getUserSpecializations:', error);
      return [];
    }
  }

  // Get user certifications
  async getUserCertifications(userId: string): Promise<ProfessionalCertification[]> {
    try {
      const { data, error } = await supabase
        .from('professional_certifications')
        .select('*')
        .eq('user_id', userId)
        .order('is_verified', { ascending: false });

      if (error) {
        console.error('Error fetching user certifications:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getUserCertifications:', error);
      return [];
    }
  }

  // Create or update business profile
  async upsertBusinessProfile(profile: Partial<BusinessProfile>): Promise<BusinessProfile | null> {
    try {
      const { data, error } = await supabase
        .from('business_profiles')
        .upsert(profile, { onConflict: 'user_id' })
        .select()
        .single();

      if (error) {
        console.error('Error upserting business profile:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error in upsertBusinessProfile:', error);
      return null;
    }
  }

  // Add user specialization
  async addUserSpecialization(specialization: Omit<UserSpecialization, 'id' | 'created_at' | 'updated_at'>): Promise<UserSpecialization | null> {
    try {
      const { data, error } = await supabase
        .from('user_specializations')
        .insert(specialization)
        .select()
        .single();

      if (error) {
        console.error('Error adding user specialization:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error in addUserSpecialization:', error);
      return null;
    }
  }

  // Add professional certification
  async addProfessionalCertification(certification: Omit<ProfessionalCertification, 'id' | 'created_at' | 'updated_at'>): Promise<ProfessionalCertification | null> {
    try {
      const { data, error } = await supabase
        .from('professional_certifications')
        .insert(certification)
        .select()
        .single();

      if (error) {
        console.error('Error adding professional certification:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error in addProfessionalCertification:', error);
      return null;
    }
  }

  // Calculate professional trust score
  async calculateTrustScore(userId: string): Promise<number> {
    try {
      const { data, error } = await supabase
        .rpc('calculate_professional_trust_score', { user_uuid: userId });

      if (error) {
        console.error('Error calculating trust score:', error);
        return 0.0;
      }

      return data || 0.0;
    } catch (error) {
      console.error('Error in calculateTrustScore:', error);
      return 0.0;
    }
  }

  // Get professional stats for dashboard
  async getProfessionalStats(): Promise<{
    totalProfessionals: number;
    totalBusinesses: number;
    verifiedBusinesses: number;
    averageRating: number;
  }> {
    try {
      const [professionalsResult, businessesResult, verifiedResult, ratingsResult] = await Promise.all([
        supabase
          .from('user_professional_status')
          .select('user_id', { count: 'exact', head: true })
          .neq('user_type', 'individual'),
        
        supabase
          .from('user_professional_status')
          .select('user_id', { count: 'exact', head: true })
          .eq('user_type', 'business'),
        
        supabase
          .from('user_professional_status')
          .select('user_id', { count: 'exact', head: true })
          .eq('business_verified', true),
        
        supabase
          .from('user_professional_status')
          .select('average_rating')
          .not('average_rating', 'is', null)
      ]);

      const totalProfessionals = professionalsResult.count || 0;
      const totalBusinesses = businessesResult.count || 0;
      const verifiedBusinesses = verifiedResult.count || 0;
      
      const ratings = ratingsResult.data || [];
      const averageRating = ratings.length > 0 
        ? ratings.reduce((sum, r) => sum + (r.average_rating || 0), 0) / ratings.length 
        : 0;

      return {
        totalProfessionals,
        totalBusinesses,
        verifiedBusinesses,
        averageRating: Math.round(averageRating * 10) / 10
      };
    } catch (error) {
      console.error('Error fetching professional stats:', error);
      return {
        totalProfessionals: 0,
        totalBusinesses: 0,
        verifiedBusinesses: 0,
        averageRating: 0
      };
    }
  }
}

export const professionalService = new ProfessionalService();
