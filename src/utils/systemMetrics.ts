import { supabase } from "@/integrations/supabase/client";

export interface SystemMetrics {
  connectionStatus: 'ACTIVE' | 'INACTIVE';
  latency: number;
  uptime: number;
}

export const getSystemMetrics = async (): Promise<SystemMetrics> => {
  const start = performance.now();
  
  try {
    // Ping Supabase to check connection and measure latency
    await supabase.from('vehicles').select('count').single();
    const latency = Math.round(performance.now() - start);

    return {
      connectionStatus: 'ACTIVE',
      latency,
      uptime: 99.9 // This would ideally come from a monitoring service
    };
  } catch (error) {
    console.error('Error checking system status:', error);
    return {
      connectionStatus: 'INACTIVE',
      latency: 0,
      uptime: 0
    };
  }
};