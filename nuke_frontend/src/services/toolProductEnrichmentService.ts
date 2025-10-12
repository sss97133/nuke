/**
 * Tool Product Enrichment Service
 * Automatically finds product pages, extracts data, and populates catalog
 */

import { supabase } from '../lib/supabase';
import { ProfessionalToolsService } from './professionalToolsService';

interface ProductSearchResult {
  url: string;
  title: string;
  price?: number;
  imageUrl?: string;
  source: string;
}

interface EnrichedProduct {
  // Core identification
  brand: string;
  partNumber: string;
  
  // Found data
  productUrl?: string;
  productName?: string;
  msrp?: number;
  currentPrice?: number;
  
  // Images
  primaryImageUrl?: string;
  additionalImages?: string[];
  
  // Additional details
  description?: string;
  specifications?: Record<string, any>;
  inStock?: boolean;
  
  // Meta
  source: string;
  scrapedAt: Date;
}

export class ToolProductEnrichmentService {
  
  /**
   * Main enrichment pipeline for a receipt
   */
  static async enrichReceiptProducts(
    receiptText: string,
    userId: string
  ): Promise<{ enriched: number; failed: number; products: EnrichedProduct[] }> {
    // Parse receipt to get products
    const parsedTools = ProfessionalToolsService.parseSnapOnReceipt(receiptText);
    
    const enrichedProducts: EnrichedProduct[] = [];
    let enrichedCount = 0;
    let failedCount = 0;
    for (const tool of parsedTools) {
      try {
        // Detect brand from receipt
        const brand = this.detectBrand(receiptText, tool.name);
        
        if (tool.part_number && brand) {
          // Search for product online
          const enrichedData = await this.enrichProduct(brand, tool.part_number);
          
          if (enrichedData) {
            enrichedProducts.push(enrichedData);
            
            // Save to catalog
            await this.saveToCatalog(enrichedData, userId);
            enrichedCount++;
          } else {
            failedCount++;
          }
        }
      } catch (error) {
        console.error(`Failed to enrich ${tool.part_number}:`, error);
        failedCount++;
      }
    }
    
    return {
      enriched: enrichedCount,
      failed: failedCount,
      products: enrichedProducts
    };
  }
  
  /**
   * Detect brand from receipt text
   */
  static detectBrand(receiptText: string, productName?: string): string {
    const text = (receiptText + ' ' + (productName || '')).toLowerCase();
    
    if (text.includes('snap-on') || text.includes('snapon')) return 'Snap-on';
    if (text.includes('mac tools')) return 'Mac Tools';
    if (text.includes('matco')) return 'Matco Tools';
    if (text.includes('cornwell')) return 'Cornwell Tools';
    if (text.includes('milwaukee')) return 'Milwaukee';
    if (text.includes('dewalt')) return 'DeWalt';
    if (text.includes('blue point')) return 'Blue Point';
    
    // Default to Snap-on if unclear (most common)
    return 'Snap-on';
  }
  
  /**
   * Enrich a single product
   */
  static async enrichProduct(
    brand: string,
    partNumber: string
  ): Promise<EnrichedProduct | null> {
    try {
      // Try multiple search strategies
      let productData: EnrichedProduct | null = null;
      
      // Strategy 1: Direct URL construction
      productData = await this.tryDirectUrl(brand, partNumber);
      
      // Strategy 2: Search via Google Custom Search API
      if (!productData) {
        productData = await this.searchViaGoogle(brand, partNumber);
      }
      
      // Strategy 3: Web scraping service
      if (!productData) {
        productData = await this.searchViaScraper(brand, partNumber);
      }
      
      return productData;
    } catch (error) {
      console.error('Enrichment failed:', error);
      return null;
    }
  }
  
  /**
   * Try constructing direct URL for known patterns
   */
  static async tryDirectUrl(
    brand: string,
    partNumber: string
  ): Promise<EnrichedProduct | null> {
    let url: string | null = null;
    
    switch (brand) {
      case 'Snap-on':
        // Snap-on URL patterns
        url = `https://shop.snapon.com/product/${partNumber}`;
        break;
      case 'Mac Tools':
        url = `https://www.mactools.com/products/${partNumber}`;
        break;
      case 'Matco Tools':
        url = `https://www.matcotools.com/catalog/product/${partNumber}`;
        break;
    }
    
    if (!url) return null;
    
    // Check if URL exists and extract data
    try {
      // Use a web scraping API or proxy service
      const scrapedData = await this.scrapeProductPage(url);
      
      if (scrapedData) {
        return {
          brand,
          partNumber,
          productUrl: url,
          productName: scrapedData.productName || partNumber,
          ...scrapedData,
          source: 'direct_url',
          scrapedAt: new Date()
        };
      }
    } catch (error) {
      console.log(`Direct URL failed for ${partNumber}`);
    }
    
    return null;
  }
  
  /**
   * Search using Google Custom Search API
   */
  static async searchViaGoogle(
    brand: string,
    partNumber: string
  ): Promise<EnrichedProduct | null> {
    // Check if we have Google API credentials (Vite uses import.meta.env)
    const apiKey = import.meta.env?.VITE_GOOGLE_API_KEY;
    const searchEngineId = import.meta.env?.VITE_GOOGLE_SEARCH_ENGINE_ID;
    
    if (!apiKey || !searchEngineId) {
      return null;
    }
    
    try {
      const query = `${brand} ${partNumber} site:${this.getBrandDomain(brand)}`;
      const searchUrl = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${apiKey}&cx=${searchEngineId}`;
      
      const response = await fetch(searchUrl);
      const data = await response.json();
      
      if (data.items && data.items.length > 0) {
        const firstResult = data.items[0];
        
        // Scrape the found page
        const scrapedData = await this.scrapeProductPage(firstResult.link);
        
        return {
          brand,
          partNumber,
          productUrl: firstResult.link,
          productName: firstResult.title,
          ...scrapedData,
          source: 'google_search',
          scrapedAt: new Date()
        };
      }
    } catch (error) {
      console.error('Google search failed:', error);
    }
    
    return null;
  }
  
  /**
   * Use a web scraping service (ScraperAPI, Puppeteer, etc.)
   */
  static async searchViaScraper(
    brand: string,
    partNumber: string
  ): Promise<EnrichedProduct | null> {
    // This would integrate with a scraping service
    // For now, we'll use a proxy/CORS solution
    
    try {
      // Build search URL for brand website
      const searchUrl = this.getBrandSearchUrl(brand, partNumber);
      
      // Use a CORS proxy or backend service
      const proxyUrl = import.meta.env?.VITE_CORS_PROXY_URL || 'https://api.allorigins.win/raw?url=';
      const response = await fetch(`${proxyUrl}${encodeURIComponent(searchUrl)}`);
      const html = await response.text();
      
      // Parse HTML to find product
      const productData = this.parseSearchResults(html, brand, partNumber);
      
      if (productData) {
        return {
          brand,
          partNumber,
          productUrl: productData.productUrl || '',
          productName: productData.productName || partNumber,
          ...productData,
          source: 'web_scraper',
          scrapedAt: new Date()
        };
      }
    } catch (error) {
      console.error('Scraper search failed:', error);
    }
    
    return null;
  }
  
  /**
   * Scrape a specific product page
   */
  static async scrapeProductPage(url: string): Promise<Partial<EnrichedProduct>> {
    try {
      // Use CORS proxy for client-side
      const proxyUrl = import.meta.env?.VITE_CORS_PROXY_URL || 'https://api.allorigins.win/raw?url=';
      const response = await fetch(`${proxyUrl}${encodeURIComponent(url)}`);
      const html = await response.text();
      
      // Parse HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // Extract common patterns
      const productData: Partial<EnrichedProduct> = {};
      
      // Try to find product name
      const titleElement = doc.querySelector('h1, .product-title, .product-name, [itemprop="name"]');
      if (titleElement) {
        productData.productName = titleElement.textContent?.trim();
      }
      
      // Try to find price
      const priceElement = doc.querySelector('.price, .product-price, [itemprop="price"], .msrp');
      if (priceElement) {
        const priceText = priceElement.textContent || '';
        const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));
        if (!isNaN(price)) {
          productData.currentPrice = price;
        }
      }
      
      // Try to find main product image
      const imageElement = doc.querySelector('.product-image img, .main-image img, [itemprop="image"]') as HTMLImageElement;
      if (imageElement) {
        productData.primaryImageUrl = this.resolveImageUrl(imageElement.src, url);
      }
      
      // Try to find additional images
      const additionalImages: string[] = [];
      const galleryImages = doc.querySelectorAll('.product-gallery img, .thumbnail img');
      galleryImages.forEach((img: Element) => {
        const imgSrc = (img as HTMLImageElement).src;
        if (imgSrc) {
          additionalImages.push(this.resolveImageUrl(imgSrc, url));
        }
      });
      if (additionalImages.length > 0) {
        productData.additionalImages = additionalImages;
      }
      
      // Try to find description
      const descElement = doc.querySelector('.product-description, .description, [itemprop="description"]');
      if (descElement) {
        productData.description = descElement.textContent?.trim();
      }
      
      // Try to find specifications
      const specs: Record<string, string> = {};
      const specRows = doc.querySelectorAll('.specifications tr, .specs-table tr, .product-specs li');
      specRows.forEach((row: Element) => {
        const label = row.querySelector('td:first-child, .spec-label')?.textContent?.trim();
        const value = row.querySelector('td:last-child, .spec-value')?.textContent?.trim();
        if (label && value) {
          specs[label] = value;
        }
      });
      if (Object.keys(specs).length > 0) {
        productData.specifications = specs;
      }
      
      return productData;
    } catch (error) {
      console.error('Page scraping failed:', error);
      return {};
    }
  }
  
  /**
   * Parse search results HTML
   */
  static parseSearchResults(
    html: string,
    brand: string,
    partNumber: string
  ): Partial<EnrichedProduct> | null {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Look for product links containing the part number
    const links = doc.querySelectorAll('a');
    for (const link of links) {
      const href = link.getAttribute('href');
      const text = link.textContent || '';
      
      if (href && text.includes(partNumber)) {
        // Found a potential product link
        const fullUrl = this.resolveUrl(href, this.getBrandDomain(brand));
        
        return {
          productUrl: fullUrl,
          productName: text.trim()
        };
      }
    }
    
    return null;
  }
  
  /**
   * Save enriched product to catalog
   */
  static async saveToCatalog(
    product: EnrichedProduct,
    userId: string
  ): Promise<void> {
    try {
      // Get brand ID
      const { data: brand } = await supabase
        .from('tool_brands')
        .select('id')
        .eq('name', product.brand)
        .single();
      
      if (!brand) {
        console.error('Brand not found:', product.brand);
        return;
      }
      
      // Upsert product to catalog
      const { data: catalog, error: catalogError } = await supabase
        .from('tool_catalog')
        .upsert({
          brand_id: brand.id,
          part_number: product.partNumber,
          name: product.productName,
          description: product.description,
          msrp: product.msrp || product.currentPrice,
          product_url: product.productUrl,
          specifications: product.specifications,
          metadata: {
            scraped_at: product.scrapedAt,
            source: product.source
          }
        }, {
          onConflict: 'brand_id,part_number'
        })
        .select()
        .single();
      
      if (catalogError) {
        console.error('Catalog save error:', catalogError);
        return;
      }
      
      // Save primary image
      if (product.primaryImageUrl && catalog) {
        // Use OpenAI to extract structured data if available
        if (import.meta.env?.VITE_OPENAI_API_KEY && product.primaryImageUrl) {
          try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${import.meta.env.VITE_OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                prompt: `Extract structured data from the image at ${product.primaryImageUrl}`,
                max_tokens: 100
              })
            });
            const data = await response.json();
            console.log('OpenAI response:', data);
          } catch (error) {
            console.error('OpenAI error:', error);
          }
        }
      }
      
      // Save additional images
      if (product.additionalImages && catalog) {
        const imageInserts = product.additionalImages.map((url, index) => ({
          catalog_id: catalog.id,
          image_url: url,
          image_type: 'gallery' as const,
          sort_order: index + 1
        }));
        
        await supabase
          .from('tool_catalog_images')
          .upsert(imageInserts, {
            onConflict: 'catalog_id,image_url'
          });
      }
      
      // Save price history
      if (product.currentPrice && catalog) {
        await supabase
          .from('tool_price_history')
          .insert({
            catalog_id: catalog.id,
            price_date: new Date().toISOString().split('T')[0],
            msrp: product.msrp,
            street_price: product.currentPrice,
            source: product.productUrl
          });
      }
      
      console.log(`Saved ${product.partNumber} to catalog`);
    } catch (error) {
      console.error('Failed to save to catalog:', error);
    }
  }
  
  /**
   * Get brand domain for searches
   */
  static getBrandDomain(brand: string): string {
    const domains: Record<string, string> = {
      'Snap-on': 'shop.snapon.com',
      'Mac Tools': 'mactools.com',
      'Matco Tools': 'matcotools.com',
      'Cornwell Tools': 'cornwelltools.com',
      'Milwaukee': 'milwaukeetool.com',
      'DeWalt': 'dewalt.com',
      'Blue Point': 'bluepoint.snapon.com'
    };
    
    return domains[brand] || 'google.com';
  }
  
  /**
   * Get brand search URL
   */
  static getBrandSearchUrl(brand: string, partNumber: string): string {
    const searchUrls: Record<string, string> = {
      'Snap-on': `https://shop.snapon.com/search?q=${partNumber}`,
      'Mac Tools': `https://www.mactools.com/search?q=${partNumber}`,
      'Matco Tools': `https://www.matcotools.com/search?q=${partNumber}`,
      'Cornwell Tools': `https://www.cornwelltools.com/search?q=${partNumber}`
    };
    
    return searchUrls[brand] || `https://www.google.com/search?q=${brand}+${partNumber}`;
  }
  
  /**
   * Resolve relative URLs
   */
  static resolveUrl(url: string, baseUrl: string): string {
    if (url.startsWith('http')) return url;
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('/')) return `https://${baseUrl}${url}`;
    return `https://${baseUrl}/${url}`;
  }
  
  /**
   * Resolve image URLs
   */
  static resolveImageUrl(url: string, pageUrl: string): string {
    if (url.startsWith('http')) return url;
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('/')) {
      const urlObj = new URL(pageUrl);
      return `${urlObj.origin}${url}`;
    }
    // Relative to current path
    const urlObj = new URL(pageUrl);
    const pathParts = urlObj.pathname.split('/');
    pathParts.pop(); // Remove filename
    return `${urlObj.origin}${pathParts.join('/')}/${url}`;
  }
  
  /**
   * Get all product images for a tool
   */
  static async getProductImages(catalogId: string): Promise<string[]> {
    const { data } = await supabase
      .from('tool_catalog_images')
      .select('image_url')
      .eq('catalog_id', catalogId)
      .order('sort_order');
    
    return data?.map(img => img.image_url) || [];
  }
}
