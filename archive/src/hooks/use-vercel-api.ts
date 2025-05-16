
import { useState, useCallback } from 'react';
import { vercelApi, safeApiCall } from '@/integrations/vercel/client';
import type { 
  VercelProject, 
  VercelDeployment, 
  VercelDomain, 
  VercelEnvVariable,
  VercelDeploymentOptions,
  CreateEnvRequest
} from '@/integrations/vercel/types';

/**
 * Hook for interacting with the Vercel API in React components
 */
export function useVercelApi() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Wrapper for API calls to handle loading and error states
   */
  const callApi = useCallback(async <T>(
    apiFunction: () => Promise<T>
  ): Promise<T | null> => {
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await safeApiCall(apiFunction);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // User information
  const getUserInfo = useCallback(() => {
    return callApi(() => vercelApi.getUserInfo());
  }, [callApi]);

  // Projects
  const getProjects = useCallback(() => {
    return callApi(() => vercelApi.listProjects());
  }, [callApi]);

  const getProject = useCallback((projectId: string) => {
    return callApi(() => vercelApi.getProject(projectId));
  }, [callApi]);

  // Deployments
  const getDeployments = useCallback((projectId: string, limit = 10) => {
    return callApi(() => vercelApi.listDeployments(projectId, limit));
  }, [callApi]);

  const getDeployment = useCallback((deploymentId: string) => {
    return callApi(() => vercelApi.getDeployment(deploymentId));
  }, [callApi]);

  const createDeployment = useCallback((projectId: string, options: VercelDeploymentOptions) => {
    return callApi(() => vercelApi.createDeployment(projectId, options));
  }, [callApi]);

  // Environment Variables
  const getEnvironmentVariables = useCallback((projectId: string) => {
    return callApi(() => vercelApi.listEnvironmentVariables(projectId));
  }, [callApi]);

  const createEnvironmentVariable = useCallback((
    projectId: string, 
    variables: CreateEnvRequest[]
  ) => {
    return callApi(() => vercelApi.createEnvironmentVariable(projectId, variables));
  }, [callApi]);

  const deleteEnvironmentVariable = useCallback((projectId: string, envId: string) => {
    return callApi(() => vercelApi.deleteEnvironmentVariable(projectId, envId));
  }, [callApi]);

  // Domains
  const getDomains = useCallback((projectId: string) => {
    return callApi(() => vercelApi.listDomains(projectId));
  }, [callApi]);

  const addDomain = useCallback((projectId: string, domain: string) => {
    return callApi(() => vercelApi.addDomain(projectId, domain));
  }, [callApi]);

  const removeDomain = useCallback((projectId: string, domain: string) => {
    return callApi(() => vercelApi.removeDomain(projectId, domain));
  }, [callApi]);

  const checkDomain = useCallback((domain: string) => {
    return callApi(() => vercelApi.checkDomain(domain));
  }, [callApi]);

  return {
    isLoading,
    error,
    // User
    getUserInfo,
    // Projects
    getProjects,
    getProject,
    // Deployments
    getDeployments,
    getDeployment,
    createDeployment,
    // Environment Variables
    getEnvironmentVariables,
    createEnvironmentVariable,
    deleteEnvironmentVariable,
    // Domains
    getDomains,
    addDomain,
    removeDomain,
    checkDomain,
  };
}
