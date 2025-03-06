/**
 * API utilities for making HTTP requests with consistent error handling.
 * This module provides a wrapper around fetch with standardized error handling,
 * request timeouts, and response parsing.
 */

import { toast } from '@/hooks/use-toast';

// Interface for standard API error response
export interface ApiError {
  status: number;
  message: string;
  details?: unknown;
}

// Interface for API request options
export interface ApiRequestOptions extends RequestInit {
  /**
   * Timeout in milliseconds
   * @default 30000 (30 seconds)
   */
  timeout?: number;
  /**
   * Whether to show toast notifications on errors
   * @default true
   */
  showErrorToasts?: boolean;
  /**
   * Custom error message to show in toast
   */
  errorMessage?: string;
}

// Default API request options
const defaultOptions: ApiRequestOptions = {
  timeout: 30000, // 30 seconds
  headers: {
    'Content-Type': 'application/json',
  },
  showErrorToasts: true,
};

/**
 * Creates a promise that rejects after the specified timeout
 */
const createTimeoutPromise = (timeout: number): Promise<never> => {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Request timed out after ${timeout}ms`));
    }, timeout);
  });
};

/**
 * Makes an API request with consistent error handling
 */
export async function apiRequest<T>(
  url: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const mergedOptions: ApiRequestOptions = { ...defaultOptions, ...options };
  const { timeout, showErrorToasts, errorMessage, ...fetchOptions } = mergedOptions;

  try {
    // Race between fetch and timeout
    const response = await Promise.race([
      fetch(url, fetchOptions),
      createTimeoutPromise(timeout ?? defaultOptions.timeout!),
    ]) as Response;

    // Parse the response
    let data: any;
    const contentType = response.headers.get('content-type');
    
    if (contentType?.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    // Handle error responses
    if (!response.ok) {
      const error: ApiError = {
        status: response.status,
        message: data?.message || response.statusText,
        details: data,
      };

      throw error;
    }

    return data as T;
  } catch (error) {
    // Handle and transform the error
    console.error('API request failed:', error);

    // Format the error
    let formattedError: ApiError;
    
    if ((error as ApiError).status) {
      formattedError = error as ApiError;
    } else {
      formattedError = {
        status: 0,
        message: (error as Error).message || 'Unknown error occurred',
      };
    }

    // Show toast notification if enabled
    if (showErrorToasts) {
      toast({
        title: 'Request Failed',
        description: errorMessage || formattedError.message,
        variant: 'destructive',
      });
    }

    throw formattedError;
  }
}

/**
 * Convenience method for GET requests
 */
export function get<T>(url: string, options: ApiRequestOptions = {}): Promise<T> {
  return apiRequest<T>(url, { ...options, method: 'GET' });
}

/**
 * Convenience method for POST requests
 */
export function post<T>(url: string, data: unknown, options: ApiRequestOptions = {}): Promise<T> {
  return apiRequest<T>(url, {
    ...options,
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Convenience method for PUT requests
 */
export function put<T>(url: string, data: unknown, options: ApiRequestOptions = {}): Promise<T> {
  return apiRequest<T>(url, {
    ...options,
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/**
 * Convenience method for PATCH requests
 */
export function patch<T>(url: string, data: unknown, options: ApiRequestOptions = {}): Promise<T> {
  return apiRequest<T>(url, {
    ...options,
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/**
 * Convenience method for DELETE requests
 */
export function del<T>(url: string, options: ApiRequestOptions = {}): Promise<T> {
  return apiRequest<T>(url, { ...options, method: 'DELETE' });
}
