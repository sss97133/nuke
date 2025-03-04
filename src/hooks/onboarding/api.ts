
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export async function fetchUserOnboardingStatus() {
  // Get current user 
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return null;
  }
  
  // Fetch the user's profile including onboarding information
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('onboarding_step, onboarding_completed')
    .eq('id', user.id)
    .single();
    
  if (error && error.code !== 'PGRST116') {
    console.error("Error fetching profile:", error);
    return null;
  }
  
  return profile;
}

export async function updateUserOnboardingProgress(step: number, completed: boolean = false) {
  // Get current user
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    toast({
      title: "Not signed in",
      description: "Please sign in to save your progress",
      variant: "destructive",
    });
    return false;
  }
  
  // Update the onboarding step in the database
  const { error } = await supabase
    .from('profiles')
    .update({
      onboarding_step: step,
      onboarding_completed: completed,
    })
    .eq('id', user.id);
    
  if (error) {
    console.error("Error updating onboarding progress:", error);
    toast({
      title: "Error",
      description: "Could not save your progress",
      variant: "destructive",
    });
    return false;
  }
  
  return true;
}
