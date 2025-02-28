
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

export const useMenuActions = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleMenuAction = (action: string) => {
    console.log("Menu action:", action);

    // Navigation actions
    if (action === "sitemap") {
      navigate("/dashboard/sitemap");
      return;
    }

    if (action === "glossary") {
      navigate("/dashboard/glossary");
      return;
    }

    if (action === "documentation") {
      navigate("/dashboard/documentation");
      return;
    }

    if (action === "token_management") {
      navigate("/dashboard/token-management");
      return;
    }

    if (action === "dao_governance") {
      navigate("/dashboard/dao-governance");
      return;
    }

    if (action === "professional_dashboard") {
      navigate("/dashboard/professional");
      return;
    }

    if (action === "vin_scanner") {
      navigate("/dashboard/vin-scanner");
      return;
    }

    if (action === "market_analysis") {
      navigate("/dashboard/market-analysis");
      return;
    }

    if (action === "token_analytics") {
      navigate("/dashboard/token-analytics");
      return;
    }

    if (action === "access_control") {
      navigate("/dashboard/access-control");
      return;
    }

    if (action === "studio_config") {
      navigate("/dashboard/studio-config");
      return;
    }

    // Notification actions
    if (action === "toggle_theme") {
      toast({
        title: "Theme Toggled",
        description: "Application theme has been updated",
      });
      return;
    }

    if (action === "preferences") {
      navigate("/dashboard/settings");
      return;
    }

    if (action === "import") {
      navigate("/dashboard/import");
      return;
    }

    if (action === "help") {
      navigate("/dashboard/documentation");
      return;
    }

    // Default fallback for unimplemented actions
    toast({
      title: "Action Not Implemented",
      description: `The '${action}' action is not implemented yet.`,
      variant: "destructive",
    });
  };

  return { handleMenuAction };
};
