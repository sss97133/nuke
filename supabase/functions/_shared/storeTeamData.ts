/**
 * Store Team/Employee Data (Private)
 * 
 * Stores scraped employee/technician data from dealer websites.
 * This is private data - not shown publicly, used for internal records and future email outreach.
 */

export async function storeTeamData(
  supabase: any,
  businessId: string,
  teamMembers: Array<{
    name: string;
    job_title?: string;
    department?: string;
    role_type?: string;
  }>,
  sourceUrl: string,
  confidenceScore: number = 0.8
): Promise<{ stored: number; errors: number }> {
  
  if (!teamMembers || teamMembers.length === 0) {
    return { stored: 0, errors: 0 };
  }

  let stored = 0;
  let errors = 0;

  for (const member of teamMembers) {
    if (!member.name || member.name.trim().length === 0) {
      continue; // Skip invalid entries
    }

    try {
      const { error } = await supabase
        .from('business_team_data')
        .upsert({
          business_id: businessId,
          name: member.name.trim(),
          job_title: member.job_title?.trim() || null,
          department: member.department?.trim() || null,
          role_type: member.role_type?.trim() || null,
          source_url: sourceUrl,
          confidence_score: confidenceScore,
          is_public: false, // Always private
          can_email: true, // Can be used for email outreach
          scraped_at: new Date().toISOString()
        }, {
          onConflict: 'business_id,name,job_title'
        });

      if (error) {
        console.warn(`Failed to store team member ${member.name}:`, error.message);
        errors++;
      } else {
        stored++;
      }
    } catch (err: any) {
      console.warn(`Error storing team member ${member.name}:`, err.message);
      errors++;
    }
  }

  // Update business has_team_data flag
  if (stored > 0) {
    await supabase
      .from('businesses')
      .update({ has_team_data: true })
      .eq('id', businessId);
  }

  console.log(`✅ Stored ${stored} team members for business ${businessId} (${errors} errors)`);
  return { stored, errors };
}

