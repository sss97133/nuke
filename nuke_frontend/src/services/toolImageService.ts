import { supabase } from '../lib/supabase';

interface ToolImageSearchResult {
  imageUrl: string | null;
  searchQuery: string;
  confidence: number;
  source: 'catalog' | 'web' | 'generated' | 'placeholder';
}

export class ToolImageService {
  private static CLAUDE_API_KEY = import.meta.env.VITE_NUKE_CLAUDE_API || import.meta.env.VITE_CLAUDE_API_KEY;
  private static GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
  private static GOOGLE_CSE_ID = import.meta.env.VITE_GOOGLE_CSE_ID;
  
  /**
   * Use Claude to generate optimized search queries for finding tool images
   */
  static async generateImageSearchQuery(
    partNumber: string,
    description: string,
    brandName?: string
  ): Promise<string> {
    if (!this.CLAUDE_API_KEY) {
      // Fallback to basic query if no Claude API
      return `${brandName || ''} ${partNumber} ${description} tool`.trim();
    }

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.CLAUDE_API_KEY,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 150,
          messages: [
            {
              role: 'user',
              content: `You are helping find product images for professional tools. Generate TWO search queries for this tool:
              1. An exact search using the part number
              2. A broader search using the description
              
              Tool details:
              - Part Number: ${partNumber}
              - Description: ${description}
              - Brand: ${brandName || 'Unknown'}
              
              Return ONLY the two queries separated by a pipe (|) character.
              Example: SNAP-ON FR80A ratchet|3/8 drive 80 tooth ratchet
              
              Focus on terms that would appear on product pages and catalogs.`
            }
          ]
        })
      });

      if (response.ok) {
        const data = await response.json();
        const query = data.content[0]?.text?.trim();
        if (query) {
          console.log('Claude generated search query:', query);
          return query;
        }
      }
    } catch (error) {
      console.error('Claude API error:', error);
    }

    // Fallback query
    return `${brandName || ''} ${partNumber} ${description} tool`.trim();
  }

  /**
   * Search for Snap-on specific tool images
   */
  static async searchSnapOnCatalog(partNumber: string): Promise<string | null> {
    if (!partNumber) return null;
    
    try {
      // Snap-on catalog image URLs follow a pattern
      // Example: https://shop.snapon.com/product/[PART_NUMBER]
      const catalogUrls = [
        `https://shop.snapon.com/product/${partNumber}`,
        `https://static.snapon.com/productimages/${partNumber}_01.jpg`,
        `https://static.snapon.com/productimages/${partNumber.toLowerCase()}_01.jpg`,
        `https://static.snapon.com/productimages/${partNumber.toUpperCase()}_01.jpg`
      ];
      
      // Try each URL to see if image exists
      for (const url of catalogUrls) {
        try {
          const response = await fetch(url, { method: 'HEAD' });
          if (response.ok) {
            console.log('Found Snap-on catalog image:', url);
            return url;
          }
        } catch {
          // Continue to next URL
        }
      }
    } catch (error) {
      console.error('Error searching Snap-on catalog:', error);
    }
    
    return null;
  }

  /**
   * Search for tool images using Google Custom Search
   */
  static async searchGoogleImages(query: string): Promise<string | null> {
    if (!this.GOOGLE_API_KEY || !this.GOOGLE_CSE_ID) {
      console.log('Google API credentials not configured');
      return null;
    }

    try {
      const searchUrl = new URL('https://www.googleapis.com/customsearch/v1');
      searchUrl.searchParams.append('key', this.GOOGLE_API_KEY);
      searchUrl.searchParams.append('cx', this.GOOGLE_CSE_ID);
      searchUrl.searchParams.append('q', query);
      searchUrl.searchParams.append('searchType', 'image');
      searchUrl.searchParams.append('num', '1');
      searchUrl.searchParams.append('imgType', 'photo');
      searchUrl.searchParams.append('imgSize', 'medium');

      const response = await fetch(searchUrl.toString());
      if (response.ok) {
        const data = await response.json();
        const imageUrl = data.items?.[0]?.link;
        if (imageUrl) {
          console.log('Found image via Google:', imageUrl);
          return imageUrl;
        }
      }
    } catch (error) {
      console.error('Google Image Search error:', error);
    }

    return null;
  }

  /**
   * Get tool image from catalog database if available
   */
  static async getCatalogImage(catalogId: string): Promise<string | null> {
    try {
      const { data, error } = await supabase
        .from('tool_catalog')
        .select('image_url')
        .eq('id', catalogId)
        .single();

      if (!error && data?.image_url) {
        return data.image_url;
      }
    } catch (error) {
      console.error('Error fetching catalog image:', error);
    }
    
    return null;
  }

  /**
   * Main method to find tool image using multiple strategies
   */
  static async findToolImage(
    tool: {
      catalog_id?: string;
      part_number?: string;
      description?: string;
      brand_name?: string;
      name?: string;
    }
  ): Promise<ToolImageSearchResult> {
    // 1. First check if we have a catalog image
    if (tool.catalog_id) {
      const catalogImage = await this.getCatalogImage(tool.catalog_id);
      if (catalogImage) {
        return {
          imageUrl: catalogImage,
          searchQuery: '',
          confidence: 1.0,
          source: 'catalog'
        };
      }
    }

    // 2. Try brand-specific catalog search
    if (tool.part_number && tool.brand_name) {
      const brand = tool.brand_name.toLowerCase();
      let brandImage: string | null = null;
      
      if (brand.includes('snap')) {
        brandImage = await this.searchSnapOnCatalog(tool.part_number);
      }
      // Add more brand-specific searches here (Mac Tools, Matco, etc.)
      
      if (brandImage) {
        return {
          imageUrl: brandImage,
          searchQuery: tool.part_number,
          confidence: 0.9,
          source: 'catalog'
        };
      }
    }

    // 3. Generate search query using Claude
    const searchQuery = await this.generateImageSearchQuery(
      tool.part_number || '',
      tool.description || tool.name || '',
      tool.brand_name
    );

    // 4. Try Google Image Search  
    const googleImage = await this.searchGoogleImages(searchQuery);
    if (googleImage) {
      return {
        imageUrl: googleImage,
        searchQuery,
        confidence: 0.8,
        source: 'web'
      };
    }

    // 5. Return placeholder based on brand
    const placeholderUrl = this.getBrandPlaceholder(tool.brand_name);
    return {
      imageUrl: placeholderUrl,
      searchQuery,
      confidence: 0.2,
      source: 'placeholder'
    };
  }

  /**
   * Get brand-specific placeholder image
   */
  static getBrandPlaceholder(brandName?: string): string | null {
    if (!brandName) return null;
    
    const brand = brandName.toLowerCase();
    
    // Return a generic tool icon placeholder
    // You could also return brand logos as placeholders
    if (brand.includes('snap')) {
      return 'https://cdn-icons-png.flaticon.com/512/3419/3419139.png'; // Wrench icon
    }
    if (brand.includes('mac')) {
      return 'https://cdn-icons-png.flaticon.com/512/3419/3419166.png'; // Screwdriver icon
    }
    if (brand.includes('matco')) {
      return 'https://cdn-icons-png.flaticon.com/512/3419/3419183.png'; // Hammer icon
    }
    
    // Generic tool placeholder
    return 'https://cdn-icons-png.flaticon.com/512/3419/3419151.png';
  }

  /**
   * Update tool with found image
   */
  static async updateToolImage(toolId: string, imageUrl: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('user_tools')
        .update({ 
          image_url: imageUrl,
          metadata: {
            image_source: 'auto_fetched',
            fetched_at: new Date().toISOString()
          }
        })
        .eq('id', toolId);

      if (error) {
        console.error('Error updating tool image:', error);
      } else {
        console.log('Successfully updated tool image');
      }
    } catch (error) {
      console.error('Error updating tool image:', error);
    }
  }

  /**
   * Batch process tools to find missing images
   */
  static async findMissingToolImages(userId: string): Promise<number> {
    try {
      // Get tools without images
      const { data: tools, error } = await supabase
        .from('user_tools')
        .select('id, catalog_id, part_number, description, brand_name, name')
        .eq('user_id', userId)
        .is('image_url', null)
        .limit(10); // Process in batches to avoid rate limits

      if (error || !tools) {
        console.error('Error fetching tools:', error);
        return 0;
      }

      let updatedCount = 0;

      for (const tool of tools) {
        const result = await this.findToolImage(tool);
        
        if (result.imageUrl && result.confidence >= 0.5) {
          await this.updateToolImage(tool.id, result.imageUrl);
          updatedCount++;
          
          // Add delay to respect API rate limits
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      console.log(`Updated ${updatedCount} tool images`);
      return updatedCount;

    } catch (error) {
      console.error('Error in batch image processing:', error);
      return 0;
    }
  }
}
