import type { Database } from '../types';
import { supabase } from "@/integrations/supabase/client";

export interface SystemMetrics {
  connectionStatus: 'ACTIVE' | 'INACTIVE';
  latency: number;
  uptime: number;
  cicd: {
    status: 'healthy' | 'warning' | 'error';
    lastBuildTime: string;
    buildDuration: number;
    successRate: number;
  };
}

type CICDStatus = 'healthy' | 'warning' | 'error';

export const getSystemMetrics = async (): Promise<SystemMetrics> => {
  const start = performance.now();
  
  try {
    // Ping Supabase to check connection and measure latency
    await supabase.from('vehicles').select('count').single();
    const latency = Math.round(performance.now() - start);

    // Get CI/CD metrics
    const cicdMetrics = await getCICDMetrics();

    return {
      connectionStatus: 'ACTIVE',
      latency,
      uptime: 99.9, // This would ideally come from a monitoring service
      cicd: cicdMetrics
    };
  } catch (error) {
    console.error('Error checking system status:', error);
    return {
      connectionStatus: 'INACTIVE',
      latency: 0,
      uptime: 0,
      cicd: {
        status: 'error' as CICDStatus,
        lastBuildTime: new Date().toISOString(),
        buildDuration: 0,
        successRate: 0
      }
    };
  }
};

async function getCICDMetrics(): Promise<SystemMetrics['cicd']> {
  try {
    const response = await fetch('https://api.github.com/repos/sss97133/nuke/actions/runs');
    const data = await response.json();
    
    if (!data.workflow_runs?.length) {
      return {
        status: 'warning' as CICDStatus,
        lastBuildTime: new Date().toISOString(),
        buildDuration: 0,
        successRate: 0
      };
    }

    const recentRuns = data.workflow_runs.slice(0, 10); // Look at last 10 runs
    const successfulRuns = recentRuns.filter(run => run.conclusion === 'success').length;
    const successRate = (successfulRuns / recentRuns.length) * 100;
    const lastRun = recentRuns[0];

    const status: CICDStatus = successRate > 80 ? 'healthy' : successRate > 50 ? 'warning' : 'error';

    return {
      status,
      lastBuildTime: lastRun.updated_at,
      buildDuration: lastRun.run_duration || 0,
      successRate
    };
  } catch (error) {
    console.error('Error fetching CI/CD metrics:', error);
    return {
      status: 'error' as CICDStatus,
      lastBuildTime: new Date().toISOString(),
      buildDuration: 0,
      successRate: 0
    };
  }
}