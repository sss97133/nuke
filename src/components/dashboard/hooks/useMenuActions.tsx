
import { useButtonActions } from "@/utils/button-actions";
import { trackButtonAction } from "@/utils/button-debug";

export type MenuActionType = 
  | 'sitemap'
  | 'glossary'
  | 'documentation'
  | 'token_management'
  | 'dao_governance'
  | 'professional_dashboard'
  | 'vin_scanner'
  | 'market_analysis'
  | 'token_analytics'
  | 'access_control'
  | 'studio_config'
  | 'toggle_theme'
  | 'preferences'
  | 'import'
  | 'settings'
  | 'help'
  | 'export'
  | 'logout';

export const useMenuActions = () => {
  const { navigateTo, menuActions, toast } = useButtonActions();

  const handleMenuAction = (action: MenuActionType) => {
    // Track the menu action for analytics
    trackButtonAction({
      action: `menu:${action}`,
      component: 'dashboard',
      status: 'success'
    });

    // Map the action strings to our predefined menu actions
    switch (action) {
      case 'sitemap':
        navigateTo(menuActions.sitemap.path, menuActions.sitemap.implemented, { trackAs: 'menu:sitemap' });
        break;
        
      case 'glossary':
        navigateTo(menuActions.glossary.path, menuActions.glossary.implemented, { trackAs: 'menu:glossary' });
        break;
        
      case 'documentation':
        navigateTo(menuActions.documentation.path, menuActions.documentation.implemented, { trackAs: 'menu:documentation' });
        break;
        
      case 'token_management':
        navigateTo(menuActions.tokenManagement.path, menuActions.tokenManagement.implemented, { trackAs: 'menu:tokenManagement' });
        break;
        
      case 'dao_governance':
        navigateTo(menuActions.daoGovernance.path, menuActions.daoGovernance.implemented, { trackAs: 'menu:daoGovernance' });
        break;
        
      case 'professional_dashboard':
        navigateTo(menuActions.professional.path, menuActions.professional.implemented, { trackAs: 'menu:professional' });
        break;
        
      case 'vin_scanner':
        navigateTo(menuActions.vinScanner.path, menuActions.vinScanner.implemented, { trackAs: 'menu:vinScanner' });
        break;
        
      case 'market_analysis':
        navigateTo(menuActions.marketAnalysis.path, menuActions.marketAnalysis.implemented, { trackAs: 'menu:marketAnalysis' });
        break;

      case 'token_analytics':
        navigateTo('/dashboard/token-analytics', false, { trackAs: 'menu:tokenAnalytics' });
        break;
        
      case 'access_control':
        navigateTo('/dashboard/access-control', false, { trackAs: 'menu:accessControl' });
        break;
        
      case 'studio_config':
        navigateTo('/dashboard/studio-config', false, { trackAs: 'menu:studioConfig' });
        break;
        
      case 'toggle_theme':
        // This is a UI action, not navigation
        toast({
          title: "Theme Toggled",
          description: "Application theme has been updated",
        });
        break;
        
      case 'preferences':
      case 'settings':
        navigateTo(menuActions.settings.path, menuActions.settings.implemented, { trackAs: 'menu:settings' });
        break;
        
      case 'import':
        navigateTo('/dashboard/import', false, { trackAs: 'menu:import' });
        break;
        
      case 'help':
        navigateTo(menuActions.help.path, menuActions.help.implemented, { trackAs: 'menu:help' });
        break;
        
      case 'logout':
        // Will be implemented with actual auth logout logic
        toast({
          title: "Logged out",
          description: "You have been logged out successfully",
        });
        navigateTo('/login', true, { replace: true });
        break;
        
      case 'export':
        toast({
          title: "Export not available",
          description: "The export feature is not implemented yet",
          variant: "destructive",
        });
        break;
        
      default:
        // Default fallback for unimplemented actions
        toast({
          title: "Action Not Implemented",
          description: `The '${action}' action is not implemented yet.`,
          variant: "destructive",
        });
    }
  };

  return { 
    handleMenuAction,
    // Export standardized actions for consistency
    menuActions
  };
};

// Create a specialized version for vehicle actions
export const useVehicleMenuActions = () => {
  const { handleMenuAction } = useMenuActions();
  const { executeDbAction, navigateTo } = useButtonActions();
  
  // Vehicle-specific actions that follow the connector framework pattern
  const handleVehicleAction = async (actionType: string, vehicleId: string) => {
    trackButtonAction({
      action: `vehicle:${actionType}`,
      data: { vehicleId },
      status: 'success'
    });
    
    switch (actionType) {
      case 'view':
        navigateTo(`/vehicles/${vehicleId}`, true, { trackAs: 'vehicle:view' });
        break;
        
      case 'service':
        // Navigate to service page with vehicle context
        navigateTo(`/service?vehicleId=${vehicleId}`, true, { trackAs: 'vehicle:service' });
        break;
        
      // Timeline actions following the Timeline Service pattern
      case 'timeline':
        navigateTo(`/vehicles/${vehicleId}/timeline`, true, { trackAs: 'vehicle:timeline' });
        break;
        
      case 'documents':
        navigateTo(`/vehicles/${vehicleId}/documents`, true, { trackAs: 'vehicle:documents' });
        break;
        
      case 'history':
        navigateTo(`/vehicles/${vehicleId}/history`, true, { trackAs: 'vehicle:history' });
        break;

      case 'connector':
        // Launch connector selection interface for multi-source integration
        navigateTo(`/vehicles/${vehicleId}/connectors`, true, { trackAs: 'vehicle:connectors' });
        break;
        
      default:
        // Any unhandled actions
        console.warn(`Unhandled vehicle action: ${actionType}`);
    }
  };
  
  return {
    handleMenuAction,
    handleVehicleAction
  };
};
