
import { NavigateFunction } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Toast } from "@/hooks/use-toast";

export const handleSignOut = async (navigate: NavigateFunction, toast: Toast) => {
  const confirmed = window.confirm('Are you sure you want to exit?');
  if (confirmed) {
    await supabase.auth.signOut();
    navigate('/login');
    toast({
      title: "Signed Out",
      description: "You have been signed out successfully"
    });
  }
};

export const handleKeyboardShortcuts = (toast: Toast) => {
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
