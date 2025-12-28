import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Organization {
  id: string;
  business_name: string;
  legal_name?: string;
  website?: string;
  phone?: string;
  email?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  business_type?: string;
}

/**
 * Normalize strings for comparison
 */
function normalizeString(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '')
    .replace(/\s+/g, '');
}

/**
 * Normalize website URL
 */
function normalizeWebsite(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    return urlObj.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase().trim();
  }
}

/**
 * Normalize phone number
 */
function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  return phone.replace(/\D/g, '');
}

/**
 * Calculate string similarity (Levenshtein distance)
 */
function similarity(str1: string, str2: string): number {
  const s1 = normalizeString(str1);
  const s2 = normalizeString(str2);
  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0;
  
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  
  if (longer.includes(shorter)) return shorter.length / longer.length;
  
  // Simple Jaccard similarity
  const set1 = new Set(s1.split(''));
  const set2 = new Set(s2.split(''));
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return intersection.size / union.size;
}

/**
 * Check if two organizations are likely duplicates
 */
function areDuplicates(org1: Organization, org2: Organization): { isDuplicate: boolean; confidence: number; reason: string } {
  // Exact website match (highest confidence)
  const website1 = normalizeWebsite(org1.website);
  const website2 = normalizeWebsite(org2.website);
  if (website1 && website2 && website1 === website2) {
    return { isDuplicate: true, confidence: 0.95, reason: 'exact_website_match' };
  }

  // Exact phone match
  const phone1 = normalizePhone(org1.phone);
  const phone2 = normalizePhone(org2.phone);
  if (phone1 && phone2 && phone1 === phone2 && phone1.length >= 10) {
    return { isDuplicate: true, confidence: 0.90, reason: 'exact_phone_match' };
  }

  // Exact email match
  if (org1.email && org2.email && org1.email.toLowerCase() === org2.email.toLowerCase()) {
    return { isDuplicate: true, confidence: 0.90, reason: 'exact_email_match' };
  }

  // Name similarity + location match
  const nameSim = similarity(org1.business_name, org2.business_name);
  const sameCity = org1.city && org2.city && normalizeString(org1.city) === normalizeString(org2.city);
  const sameState = org1.state && org2.state && normalizeString(org1.state) === normalizeString(org2.state);
  const sameZip = org1.zip_code && org2.zip_code && org1.zip_code === org2.zip_code;

  if (nameSim >= 0.85 && (sameCity || sameZip)) {
    return { isDuplicate: true, confidence: 0.80, reason: 'name_location_match' };
  }

  if (nameSim >= 0.90) {
    return { isDuplicate: true, confidence: 0.75, reason: 'high_name_similarity' };
  }

  // Legal name match
  if (org1.legal_name && org2.legal_name) {
    const legalSim = similarity(org1.legal_name, org2.legal_name);
    if (legalSim >= 0.90) {
      return { isDuplicate: true, confidence: 0.85, reason: 'legal_name_match' };
    }
  }

  return { isDuplicate: false, confidence: 0, reason: 'no_match' };
}

/**
 * Merge source organization into target
 */
async function mergeOrganizations(
  sourceId: string,
  targetId: string,
  supabase: any
): Promise<void> {
  console.log(`Merging ${sourceId} into ${targetId}`);

  // Merge organization_vehicles
  const { error: vehError } = await supabase
    .from('organization_vehicles')
    .update({ organization_id: targetId })
    .eq('organization_id', sourceId);

  if (vehError) {
    console.error(`Error merging vehicles: ${vehError.message}`);
    throw vehError;
  }

  // Merge organization_images
  const { error: imgError } = await supabase
    .from('organization_images')
    .update({ organization_id: targetId })
    .eq('organization_id', sourceId);

  if (imgError) {
    console.error(`Error merging images: ${imgError.message}`);
    throw imgError;
  }

  // Merge organization_contributors (handle conflicts)
  const { data: sourceContributors } = await supabase
    .from('organization_contributors')
    .select('user_id, role, status')
    .eq('organization_id', sourceId);

  if (sourceContributors && sourceContributors.length > 0) {
    for (const contrib of sourceContributors) {
      // Check if contributor already exists in target
      const { data: existing } = await supabase
        .from('organization_contributors')
        .select('id')
        .eq('organization_id', targetId)
        .eq('user_id', contrib.user_id)
        .maybeSingle();

      if (!existing) {
        // Move contributor
        await supabase
          .from('organization_contributors')
          .update({ organization_id: targetId })
          .eq('organization_id', sourceId)
          .eq('user_id', contrib.user_id);
      } else {
        // Delete duplicate from source
        await supabase
          .from('organization_contributors')
          .delete()
          .eq('organization_id', sourceId)
          .eq('user_id', contrib.user_id);
      }
    }
  }

  // Merge organization_followers
  const { error: followError } = await supabase
    .from('organization_followers')
    .update({ organization_id: targetId })
    .eq('organization_id', sourceId);

  if (followError) {
    console.error(`Error merging followers: ${followError.message}`);
  }

  // Merge business_timeline_events
  const { error: timelineError } = await supabase
    .from('business_timeline_events')
    .update({ business_id: targetId })
    .eq('business_id', sourceId);

  if (timelineError) {
    console.error(`Error merging timeline events: ${timelineError.message}`);
  }

  // Update target organization with best data from source
  const { data: sourceOrg } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', sourceId)
    .single();

  const { data: targetOrg } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', targetId)
    .single();

  if (sourceOrg && targetOrg) {
    const updates: any = {};
    
    // Prefer non-null values, or source if target is null
    if (!targetOrg.website && sourceOrg.website) updates.website = sourceOrg.website;
    if (!targetOrg.phone && sourceOrg.phone) updates.phone = sourceOrg.phone;
    if (!targetOrg.email && sourceOrg.email) updates.email = sourceOrg.email;
    if (!targetOrg.address && sourceOrg.address) updates.address = sourceOrg.address;
    if (!targetOrg.city && sourceOrg.city) updates.city = sourceOrg.city;
    if (!targetOrg.state && sourceOrg.state) updates.state = sourceOrg.state;
    if (!targetOrg.zip_code && sourceOrg.zip_code) updates.zip_code = sourceOrg.zip_code;
    if (!targetOrg.logo_url && sourceOrg.logo_url) updates.logo_url = sourceOrg.logo_url;
    if (!targetOrg.description && sourceOrg.description) updates.description = sourceOrg.description;
    if (!targetOrg.legal_name && sourceOrg.legal_name) updates.legal_name = sourceOrg.legal_name;
    if (!targetOrg.business_type && sourceOrg.business_type) updates.business_type = sourceOrg.business_type;

    if (Object.keys(updates).length > 0) {
      await supabase
        .from('businesses')
        .update(updates)
        .eq('id', targetId);
    }
  }

  // Hide source organization
  await supabase
    .from('businesses')
    .update({ is_public: false })
    .eq('id', sourceId);

  // Enrich target organization with due diligence report if missing description
  const { data: finalTarget } = await supabase
    .from('businesses')
    .select('id, description, business_type, website, metadata')
    .eq('id', targetId)
    .single();

  if (finalTarget && (!finalTarget.description || finalTarget.business_type === 'other') && finalTarget.website) {
    try {
      // Generate comprehensive due diligence report
      await supabase.functions.invoke('generate-org-due-diligence', {
        body: { 
          organizationId: targetId, 
          websiteUrl: finalTarget.website,
          forceRegenerate: false
        }
      });
    } catch (enrichError) {
      console.warn('⚠️ Failed to generate due diligence report (non-critical):', enrichError);
      // Fallback to basic enrichment
      try {
        await supabase.functions.invoke('update-org-from-website', {
          body: { organizationId: targetId, websiteUrl: finalTarget.website }
        });
      } catch (basicEnrichError) {
        console.warn('⚠️ Failed to enrich merged organization (non-critical):', basicEnrichError);
      }
    }
  }
}

/**
 * Find and merge duplicates for a specific organization
 */
async function findAndMergeDuplicates(orgId: string, supabase: any): Promise<{ merged: boolean; targetId?: string }> {
  const { data: org, error } = await supabase
    .from('businesses')
    .select('id, business_name, legal_name, website, phone, email, city, state, zip_code, business_type')
    .eq('id', orgId)
    .single();

  if (error || !org) {
    return { merged: false };
  }

  // Find potential duplicates
  const { data: candidates } = await supabase
    .from('businesses')
    .select('id, business_name, legal_name, website, phone, email, city, state, zip_code, business_type')
    .eq('is_public', true)
    .neq('id', orgId);

  if (!candidates || candidates.length === 0) {
    return { merged: false };
  }

  // Check each candidate
  for (const candidate of candidates) {
    const { isDuplicate, confidence } = areDuplicates(org, candidate);
    
    if (isDuplicate && confidence >= 0.75) {
      // Determine which is the "target" (keep the one with more data or older)
      const orgDataCount = [
        org.website, org.phone, org.email, org.address, org.logo_url, org.description
      ].filter(Boolean).length;
      
      const candidateDataCount = [
        candidate.website, candidate.phone, candidate.email, candidate.address, candidate.logo_url, candidate.description
      ].filter(Boolean).length;

      // Prefer the one with more data, or the older one if equal
      const targetId = candidateDataCount > orgDataCount ? candidate.id : org.id;
      const sourceId = targetId === candidate.id ? org.id : candidate.id;

      try {
        await mergeOrganizations(sourceId, targetId, supabase);
        console.log(`✅ Auto-merged duplicate: ${sourceId} → ${targetId} (confidence: ${confidence.toFixed(2)})`);
        return { merged: true, targetId };
      } catch (error: any) {
        console.error(`❌ Failed to merge: ${error.message}`);
        return { merged: false };
      }
    }
  }

  return { merged: false };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { organizationId, scanAll } = await req.json().catch(() => ({}));

    if (organizationId) {
      // Check and merge duplicates for a specific organization
      const result = await findAndMergeDuplicates(organizationId, supabase);
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    } else if (scanAll) {
      // Scan all organizations for duplicates
      const { data: orgs } = await supabase
        .from('businesses')
        .select('id')
        .eq('is_public', true)
        .order('created_at', { ascending: true });

      const results = [];
      for (const org of orgs || []) {
        const result = await findAndMergeDuplicates(org.id, supabase);
        if (result.merged) {
          results.push({ sourceId: org.id, targetId: result.targetId });
        }
      }

      return new Response(
        JSON.stringify({ merged: results.length, results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    } else {
      return new Response(
        JSON.stringify({ error: 'organizationId or scanAll required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }
  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

