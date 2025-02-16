
import { NavigateFunction } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ToastFunction } from "./types";

export const handleSignOut = async (navigate: NavigateFunction, toast: ToastFunction) => {
  const confirmed = window.confirm('Are you sure you want to exit?');
  if (confirmed) {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      
      localStorage.clear();
      sessionStorage.clear();
      
      toast({
        title: "Signed Out",
        description: "You have been signed out successfully"
      });
      
      window.location.replace('/login');
    } catch (error) {
      console.error('Error:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to sign out. Please try again."
      });
    }
  }
};

export const handleKeyboardShortcuts = (toast: ToastFunction) => {
  toast({
    title: "Keyboard Shortcuts",
    description: [
      "⌘K - Open Command Bar",
      "⌘/ - Toggle Help",
      "⌘B - Toggle Sidebar",
      "⌘T - Toggle Theme",
      "⌘\\ - Toggle Activity Panel"
    ].join('\n'),
  });
};

export const handleProjectNavigation = async (navigate: NavigateFunction, toast: ToastFunction, action: string) => {
  try {
    console.log('Navigating to action:', action);
    
    // Get the route for this action from the database
    const { data: route, error } = await supabase
      .from('routes')
      .select('*')
      .eq('action', action)
      .single();

    if (error) {
      console.error('Route fetch error:', error);
      throw error;
    }
    
    if (!route) {
      console.error('Route not found for action:', action);
      toast({
        title: "Not Found",
        description: "The requested page could not be found",
        variant: "destructive"
      });
      return;
    }

    // Check authentication requirement
    if (route.requires_auth) {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({
          title: "Login Required",
          description: "Please log in to access this feature",
          variant: "destructive"
        });
        navigate('/login');
        return;
      }
    }

    console.log('Found route:', route);

    // Navigate to the route
    navigate(route.path);

    // Show toast for specific navigation actions
    if (route.show_toast) {
      toast({
        title: route.title,
        description: route.description || `Opening ${route.title.toLowerCase()}`
      });
    }

  } catch (error) {
    console.error('Navigation error:', error);
    toast({
      title: "Navigation Error",
      description: "Failed to navigate to the requested page",
      variant: "destructive"
    });
  }
};
