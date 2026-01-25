/**
 * PLATFORM STATUS API
 *
 * Returns platform configuration including demo mode and regulatory status.
 * Used by frontend to gate functionality based on compliance status.
 *
 * GET /platform-status
 * Returns: {
 *   demo_mode: { enabled, message, ... },
 *   regulatory_status: { sec_approved, finra_approved, ... },
 *   features: { trading_enabled, real_money_enabled, ... },
 *   is_live: boolean,
 *   timestamp: string
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DemoModeConfig {
  enabled: boolean;
  message: string;
  allow_real_deposits: boolean;
  show_demo_banner: boolean;
}

interface RegulatoryStatus {
  sec_approved: boolean;
  finra_approved: boolean;
  last_updated: string | null;
  approval_notes: string | null;
}

interface PlatformFeatures {
  trading_enabled: boolean;
  real_money_enabled: boolean;
  kyc_required: boolean;
  accreditation_required: boolean;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Fetch all config values
    const { data: configs, error } = await supabase
      .from("platform_config")
      .select("config_key, config_value")
      .in("config_key", ["demo_mode", "regulatory_status", "platform_features"]);

    if (error) {
      console.error("Error fetching platform config:", error);
      // Return safe defaults if config fetch fails
      return new Response(
        JSON.stringify({
          demo_mode: {
            enabled: true,
            message: "Paper Trading Mode",
            allow_real_deposits: false,
            show_demo_banner: true,
          },
          regulatory_status: {
            sec_approved: false,
            finra_approved: false,
            last_updated: null,
            approval_notes: null,
          },
          features: {
            trading_enabled: true,
            real_money_enabled: false,
            kyc_required: false,
            accreditation_required: false,
          },
          is_live: false,
          timestamp: new Date().toISOString(),
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Parse config values
    const configMap = new Map<string, any>();
    for (const config of configs || []) {
      configMap.set(config.config_key, config.config_value);
    }

    const demoMode: DemoModeConfig = configMap.get("demo_mode") || {
      enabled: true,
      message: "Paper Trading Mode",
      allow_real_deposits: false,
      show_demo_banner: true,
    };

    const regulatoryStatus: RegulatoryStatus = configMap.get("regulatory_status") || {
      sec_approved: false,
      finra_approved: false,
      last_updated: null,
      approval_notes: null,
    };

    const features: PlatformFeatures = configMap.get("platform_features") || {
      trading_enabled: true,
      real_money_enabled: false,
      kyc_required: false,
      accreditation_required: false,
    };

    // Determine if platform is live
    const isLive =
      !demoMode.enabled &&
      regulatoryStatus.sec_approved &&
      regulatoryStatus.finra_approved;

    const response = {
      demo_mode: demoMode,
      regulatory_status: regulatoryStatus,
      features: features,
      is_live: isLive,
      timestamp: new Date().toISOString(),
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("Platform status error:", e);
    return new Response(
      JSON.stringify({
        error: e.message,
        // Return safe defaults on error
        demo_mode: { enabled: true, message: "Paper Trading Mode" },
        regulatory_status: { sec_approved: false, finra_approved: false },
        features: { trading_enabled: true, real_money_enabled: false },
        is_live: false,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
