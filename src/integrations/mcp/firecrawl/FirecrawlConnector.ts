/**
 * Firecrawl API Connector MCP
 * 
 * This MCP connects to the Firecrawl API for fetching real documentation and content
 * from vehicle manufacturer websites and documentation resources, maintaining our
 * commitment to using only authentic vehicle data.
 */

import axios, { AxiosInstance } from 'axios';
import { getEnv } from '../../../utils/environment';

export interface FirecrawlOptions {
  timeout?: number;
  cacheResults?: boolean;
  cacheDuration?: number; // in seconds
}

export interface ScrapingResult {
  url: string;
  content: string;
  contentType: string;
  status: number;
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface BatchScrapingResult {
  results: ScrapingResult[];
  failedUrls?: string[];
  cached?: boolean;
}

export interface SiteMapResult {
  url: string;
  subPages: string[];
}

export class FirecrawlConnector {
  private client: AxiosInstance;
  private baseUrl: string = 'https://api.firecrawl.dev/v1';
  private cacheEnabled: boolean;
  private cacheDuration: number; // in seconds
  private resultCache: Map<string, { result: any; timestamp: number }> = new Map();

  constructor(options: FirecrawlOptions = {}) {
    // Get API key from environment variables for security
    const apiKey = getEnv('FIRECRAWL_API_KEY', '');
    
    if (!apiKey) {
      console.warn('Firecrawl API key not found in environment variables. Set FIRECRAWL_API_KEY to use this connector.');
    }

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: options.timeout || 30000,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    this.cacheEnabled = options.cacheResults ?? true;
    this.cacheDuration = options.cacheDuration ?? 3600; // 1 hour default
  }

  /**
   * Scrape content from a single URL
   */
  async scrapeUrl(url: string): Promise<ScrapingResult> {
    const cacheKey = `scrape:${url}`;
    
    // Check cache if enabled
    if (this.cacheEnabled) {
      const cachedResult = this.getCachedResult<ScrapingResult>(cacheKey);
      if (cachedResult) return cachedResult;
    }

    try {
      const response = await this.client.post('/scrape', { url });
      const result = response.data as ScrapingResult;
      
      // Cache result if enabled
      if (this.cacheEnabled) {
        this.cacheResult(cacheKey, result);
      }
      
      return result;
    } catch (error) {
      console.error(`Error scraping URL ${url}:`, error);
      throw new Error(`Failed to scrape URL: ${url}`);
    }
  }

  /**
   * Batch scrape multiple URLs
   */
  async batchScrapeUrls(urls: string[]): Promise<BatchScrapingResult> {
    if (!urls.length) return { results: [] };
    
    const cacheKey = `batch:${urls.sort().join(',')}`;
    
    // Check cache if enabled
    if (this.cacheEnabled) {
      const cachedResult = this.getCachedResult<BatchScrapingResult>(cacheKey);
      if (cachedResult) return { ...cachedResult, cached: true };
    }

    try {
      const response = await this.client.post('/batch-scrape', { urls });
      const result = response.data as BatchScrapingResult;
      
      // Cache result if enabled
      if (this.cacheEnabled) {
        this.cacheResult(cacheKey, result);
      }
      
      return result;
    } catch (error) {
      console.error('Error batch scraping URLs:', error);
      throw new Error('Failed to batch scrape URLs');
    }
  }

  /**
   * Get site map (all sub-pages) for a domain or specific URL
   */
  async getSiteMap(url: string): Promise<SiteMapResult> {
    const cacheKey = `sitemap:${url}`;
    
    // Check cache if enabled
    if (this.cacheEnabled) {
      const cachedResult = this.getCachedResult<SiteMapResult>(cacheKey);
      if (cachedResult) return cachedResult;
    }

    try {
      const response = await this.client.post('/site-map', { url });
      const result = response.data as SiteMapResult;
      
      // Cache result if enabled
      if (this.cacheEnabled) {
        this.cacheResult(cacheKey, result);
      }
      
      return result;
    } catch (error) {
      console.error(`Error getting site map for ${url}:`, error);
      throw new Error(`Failed to get site map for: ${url}`);
    }
  }

  /**
   * Filter URLs from a site map based on relevance to a query
   * Useful for finding vehicle-specific documentation pages
   */
  async filterRelevantUrls(
    siteMapUrl: string, 
    query: string, 
    limit: number = 20
  ): Promise<string[]> {
    try {
      // First get the site map
      const siteMap = await this.getSiteMap(siteMapUrl);
      
      // Then filter the URLs with Firecrawl's relevance endpoint
      const response = await this.client.post('/filter-relevant', {
        urls: siteMap.subPages,
        query,
        limit
      });
      
      return response.data.relevantUrls as string[];
    } catch (error) {
      console.error('Error filtering relevant URLs:', error);
      throw new Error('Failed to filter relevant URLs');
    }
  }

  /**
   * Get useful code examples from technical documentation
   * Perfect for vehicle diagnostic or repair information
   */
  async extractCodeExamples(
    docUrl: string, 
    context?: string
  ): Promise<{ codeExamples: string[], sourceUrl: string }> {
    const cacheKey = `code:${docUrl}:${context || ''}`;
    
    // Check cache if enabled
    if (this.cacheEnabled) {
      const cachedResult = this.getCachedResult<{ codeExamples: string[], sourceUrl: string }>(cacheKey);
      if (cachedResult) return cachedResult;
    }

    try {
      const response = await this.client.post('/extract-code', { 
        url: docUrl,
        context
      });
      
      const result = {
        codeExamples: response.data.examples as string[],
        sourceUrl: response.data.sourceUrl as string
      };
      
      // Cache result if enabled
      if (this.cacheEnabled) {
        this.cacheResult(cacheKey, result);
      }
      
      return result;
    } catch (error) {
      console.error(`Error extracting code examples from ${docUrl}:`, error);
      throw new Error(`Failed to extract code examples from: ${docUrl}`);
    }
  }

  /**
   * Search for vehicle-specific documentation across multiple domains
   */
  async searchVehicleDocs(
    query: string,
    domains: string[],
    options: { limit?: number, year?: number, make?: string, model?: string }
  ): Promise<{ url: string, title: string, snippet: string }[]> {
    try {
      const response = await this.client.post('/search', {
        query,
        domains,
        limit: options.limit || 10,
        filters: {
          year: options.year,
          make: options.make,
          model: options.model
        }
      });
      
      return response.data.results;
    } catch (error) {
      console.error('Error searching vehicle documentation:', error);
      throw new Error('Failed to search vehicle documentation');
    }
  }

  /**
   * Clear the entire cache or a specific cache entry
   */
  clearCache(key?: string): void {
    if (key) {
      this.resultCache.delete(key);
    } else {
      this.resultCache.clear();
    }
  }

  /**
   * Get a cached result if it exists and is not expired
   */
  private getCachedResult<T>(key: string): T | null {
    const cached = this.resultCache.get(key);
    
    if (!cached) return null;
    
    const now = Date.now();
    const isExpired = now - cached.timestamp > this.cacheDuration * 1000;
    
    if (isExpired) {
      this.resultCache.delete(key);
      return null;
    }
    
    return cached.result as T;
  }

  /**
   * Cache a result with the current timestamp
   */
  private cacheResult(key: string, result: any): void {
    this.resultCache.set(key, {
      result,
      timestamp: Date.now()
    });
  }
}
