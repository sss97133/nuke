
import { supabase } from "@/integrations/supabase/client";
import { Toast } from "@/hooks/use-toast";

export const handleExport = async (toast: Toast) => {
  try {
    const { data: user } = await supabase.auth.getUser();
    if (!user?.user?.id) {
      throw new Error('User not authenticated');
    }
    
    const { data: exportData, error } = await supabase
      .from('vehicles')
      .select('*')
      .eq('user_id', user.user.id);
      
    if (error) throw error;
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'export.json';
    a.click();
    
    toast({
      title: "Export Successful",
      description: "Your data has been exported successfully",
    });
  } catch (error) {
    toast({
      title: "Export Failed",
      description: "Unable to export data. Please try again.",
      variant: "destructive",
    });
  }
};
