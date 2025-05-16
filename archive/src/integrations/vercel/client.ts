import { toast } from '@/hooks/use-toast';

// Fallback value (empty string) - the API key should always be provided via environment
const VERCEL_API_KEY = '';

const vercelApiKey = import.meta.env.VITE_VERCEL_API_KEY || VERCEL_API_KEY;

if (!vercelApiKey) {
  console.error('Missing Vercel API key environment variable');
}

// Track API errors to prevent duplicate notifications
const recentApiErrors = new Set<string>();
const API_ERROR_DEBOUNCE_TIME = 10000; // 10 seconds

// Base URL for Vercel API
const VERCEL_API_BASE_URL = 'https://api.vercel.com';

/**
 * Vercel API client for interacting with Vercel services
 */
class VercelApiClient {
  private apiKey: string;
  private teamId?: string;

  constructor(apiKey: string, teamId?: string) {
    this.apiKey = apiKey;
    this.teamId = teamId;
  }

  /**
   * Make an authenticated request to the Vercel API
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = new URL(`${VERCEL_API_BASE_URL}${endpoint}`);
    
    // Add teamId if provided
    if (this.teamId) {
      url.searchParams.append('teamId', this.teamId);
    }

    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const fetchOptions: RequestInit = {
      ...options,
      headers,
    };

    try {
      const response = await fetch(url.toString(), fetchOptions);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `API request failed with status ${response.status}`;
        
        throw new Error(errorMessage);
      }
      
      return await response.json();
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error occurred');
      this.handleApiError(error);
      throw error;
    }
  }

  /**
   * Handle API errors with toast notifications
   */
  private handleApiError(error: Error, defaultMessage = "An error occurred"): null {
    console.error("Vercel API error:", error);
    
    const message = error.message || defaultMessage;
    
    // Only show toast if we haven't shown this error recently
    if (!recentApiErrors.has(message)) {
      recentApiErrors.add(message);
      
      toast({
        title: "Vercel API Error",
        description: message,
        variant: "destructive",
      });
      
      // Remove from recent errors after debounce time
      setTimeout(() => {
        recentApiErrors.delete(message);
      }, API_ERROR_DEBOUNCE_TIME);
    }
    
    return null;
  }

  /**
   * Get user information
   */
  async getUserInfo() {
    return this.request('/v2/user');
  }

  /**
   * List projects
   */
  async listProjects() {
    return this.request('/v9/projects');
  }

  /**
   * Get a specific project
   */
  async getProject(projectId: string) {
    return this.request(`/v9/projects/${projectId}`);
  }

  /**
   * List deployments for a project
   */
  async listDeployments(projectId: string, limit = 10) {
    return this.request(`/v6/deployments?projectId=${projectId}&limit=${limit}`);
  }

  /**
   * Get a specific deployment
   */
  async getDeployment(deploymentId: string) {
    return this.request(`/v13/deployments/${deploymentId}`);
  }

  /**
   * Create a new deployment
   */
  async createDeployment(projectId: string, payload: any) {
    return this.request(`/v13/deployments`, {
      method: 'POST',
      body: JSON.stringify({
        projectId,
        ...payload
      })
    });
  }

  /**
   * List environment variables for a project
   */
  async listEnvironmentVariables(projectId: string) {
    return this.request(`/v9/projects/${projectId}/env`);
  }

  /**
   * Create environment variables for a project
   */
  async createEnvironmentVariable(projectId: string, variables: Array<{ key: string, value: string, target?: string[] }>) {
    return this.request(`/v10/projects/${projectId}/env`, {
      method: 'POST',
      body: JSON.stringify({ env: variables })
    });
  }

  /**
   * Delete an environment variable
   */
  async deleteEnvironmentVariable(projectId: string, envId: string) {
    return this.request(`/v9/projects/${projectId}/env/${envId}`, {
      method: 'DELETE'
    });
  }

  /**
   * List domains for a project
   */
  async listDomains(projectId: string) {
    return this.request(`/v9/projects/${projectId}/domains`);
  }

  /**
   * Add a domain to a project
   */
  async addDomain(projectId: string, domain: string) {
    return this.request(`/v9/projects/${projectId}/domains`, {
      method: 'POST',
      body: JSON.stringify({ name: domain })
    });
  }

  /**
   * Remove a domain from a project
   */
  async removeDomain(projectId: string, domain: string) {
    return this.request(`/v9/projects/${projectId}/domains/${domain}`, {
      method: 'DELETE'
    });
  }

  /**
   * Check domain availability and price
   */
  async checkDomain(domain: string) {
    return this.request(`/v4/domains/check?domain=${domain}`);
  }
}

// Create and export the Vercel API client instance
export const vercelApi = new VercelApiClient(vercelApiKey);

/**
 * Utility to perform API requests with automatic error handling
 */
export const safeApiCall = async <T>(
  apiFn: () => Promise<T>
): Promise<T | null> => {
  try {
    return await apiFn();
  } catch (error) {
    console.error('Vercel API call failed:', error);
    
    const message = error instanceof Error ? error.message : 'An unknown error occurred';
    
    // Only show toast if we haven't shown this error recently
    if (!recentApiErrors.has(message)) {
      recentApiErrors.add(message);
      
      toast({
        title: "Vercel API Error",
        description: message,
        variant: "destructive",
      });
      
      // Remove from recent errors after debounce time
      setTimeout(() => {
        recentApiErrors.delete(message);
      }, API_ERROR_DEBOUNCE_TIME);
    }
    
    return null;
  }
};
