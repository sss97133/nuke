/**
 * Intelligent Content Detector
 * Analyzes comment text to detect valuable data contributions
 * Supports: URLs, specs, prices, VINs, contact info, structured data
 */

import { supabase } from '../lib/supabase';

export interface DetectedContent {
  type: 'listing_url' | 'youtube_video' | 'document_url' | 'specs_data' | 
        'price_data' | 'timeline_event' | 'image_url' | 'contact_info' | 
        'vin_data' | 'unknown';
  content: string;
  context: string;
  confidence: number;
  source: string; // Which marketplace/platform
  metadata?: Record<string, any>;
}

export class ContentDetector {
  /**
   * Main entry point: Analyze comment text for extractable content
   */
  static async analyzeComment(
    commentText: string,
    vehicleId: string,
    commentId?: string,
    commentTable?: string
  ): Promise<DetectedContent[]> {
    const detected: DetectedContent[] = [];
    
    // 1. Detect Listing URLs (highest priority)
    detected.push(...this.detectListingURLs(commentText));
    
    // 2. Detect YouTube videos (walkarounds, reviews)
    detected.push(...this.detectYouTubeVideos(commentText));
    
    // 3. Detect VIN numbers
    detected.push(...this.detectVINs(commentText));
    
    // 4. Detect specs and technical data
    detected.push(...this.detectSpecs(commentText));
    
    // 5. Detect price data
    detected.push(...this.detectPrices(commentText));
    
    // 6. Detect timeline events (maintenance, repairs)
    detected.push(...this.detectTimelineEvents(commentText));
    
    // 7. Detect image URLs
    detected.push(...this.detectImageURLs(commentText));
    
    // 8. Detect contact info (seller/buyer details)
    detected.push(...this.detectContactInfo(commentText));
    
    // 9. Detect document URLs (PDFs, service manuals)
    detected.push(...this.detectDocumentURLs(commentText));
    
    return detected.filter(d => d.confidence >= 0.3); // Filter low-confidence detections
  }

  /**
   * Detect listing URLs from major marketplaces
   */
  private static detectListingURLs(text: string): DetectedContent[] {
    const detected: DetectedContent[] = [];
    
    const patterns: Array<{regex: RegExp, source: string, priority: number}> = [
      { regex: /https?:\/\/(?:www\.)?bringatrailer\.com\/listing\/[^\s\)]+/gi, source: 'bat', priority: 0.95 },
      { regex: /https?:\/\/(?:www\.)?mecum\.com\/lots\/[^\s\)]+/gi, source: 'mecum', priority: 0.9 },
      { regex: /https?:\/\/(?:www\.)?cars\.ksl\.com\/listing\/[^\s\)]+/gi, source: 'ksl', priority: 0.9 },
      { regex: /https?:\/\/[a-z]+\.craigslist\.org\/[^\s\)]+/gi, source: 'craigslist', priority: 0.85 },
      { regex: /https?:\/\/(?:www\.)?ebay\.com\/itm\/[^\s\)]+/gi, source: 'ebay', priority: 0.85 },
      { regex: /https?:\/\/(?:www\.)?classiccars\.com\/listings\/view\/[^\s\)]+/gi, source: 'classiccars', priority: 0.8 },
      { regex: /https?:\/\/(?:www\.)?classic\.com\/veh\/[^\s\)]+/gi, source: 'classiccom', priority: 0.8 },
      { regex: /https?:\/\/(?:www\.)?cars\.com\/vehicledetail\/[^\s\)]+/gi, source: 'carscom', priority: 0.75 },
      { regex: /https?:\/\/(?:www\.)?autotrader\.com\/[^\s\)]+/gi, source: 'autotrader', priority: 0.75 },
      { regex: /https?:\/\/(?:www\.)?hemmings\.com\/[^\s\)]+/gi, source: 'hemmings', priority: 0.8 },
      { regex: /https?:\/\/(?:www\.)?barrett-jackson\.com\/Archive\/Event\/Item\/[^\s\)]+/gi, source: 'barrettjackson', priority: 0.85 },
      { regex: /https?:\/\/(?:www\.)?gooding\.com\/lot\/[^\s\)]+/gi, source: 'gooding', priority: 0.85 },
      { regex: /https?:\/\/facebook\.com\/marketplace\/item\/[^\s\)]+/gi, source: 'facebook', priority: 0.7 },
      { regex: /https?:\/\/(?:www\.)?carsforsale\.com\/vehicle\/details\/[^\s\)]+/gi, source: 'carsforsale', priority: 0.7 },
    ];
    
    for (const pattern of patterns) {
      const matches = text.matchAll(pattern.regex);
      
      for (const match of matches) {
        const url = match[0];
        const contextStart = Math.max(0, match.index! - 100);
        const contextEnd = Math.min(text.length, match.index! + url.length + 100);
        const context = text.substring(contextStart, contextEnd);
        
        detected.push({
          type: 'listing_url',
          content: url,
          context,
          confidence: pattern.priority,
          source: pattern.source,
          metadata: {
            marketplace: pattern.source,
            url: url
          }
        });
      }
    }
    
    return detected;
  }

  /**
   * Detect YouTube videos (walkarounds, reviews, auction videos)
   */
  private static detectYouTubeVideos(text: string): DetectedContent[] {
    const detected: DetectedContent[] = [];
    
    const patterns = [
      /https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/gi,
      /https?:\/\/youtu\.be\/([a-zA-Z0-9_-]{11})/gi,
      /https?:\/\/(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/gi,
    ];
    
    for (const pattern of patterns) {
      const matches = text.matchAll(pattern);
      
      for (const match of matches) {
        const url = match[0];
        const videoId = match[1];
        const contextStart = Math.max(0, match.index! - 100);
        const contextEnd = Math.min(text.length, match.index! + url.length + 100);
        const context = text.substring(contextStart, contextEnd);
        
        // Higher confidence if context mentions walkaround, review, video
        let confidence = 0.7;
        const contextLower = context.toLowerCase();
        if (contextLower.includes('walkaround') || 
            contextLower.includes('review') || 
            contextLower.includes('video') ||
            contextLower.includes('watch') ||
            contextLower.includes('footage')) {
          confidence = 0.9;
        }
        
        detected.push({
          type: 'youtube_video',
          content: url,
          context,
          confidence,
          source: 'youtube',
          metadata: {
            video_id: videoId,
            url: url
          }
        });
      }
    }
    
    return detected;
  }

  /**
   * Detect VIN numbers (17-character) and legacy chassis identifiers (4-16)
   */
  private static detectVINs(text: string): DetectedContent[] {
    const detected: DetectedContent[] = [];
    
    // VIN pattern: 17 characters, no I, O, or Q
    const vinPattern = /\b([A-HJ-NPR-Z0-9]{17})\b/gi;
    const matches = text.matchAll(vinPattern);
    
    for (const match of matches) {
      const vin = match[1].toUpperCase();
      
      // Validate: no I, O, Q allowed in VINs
      if (/[IOQ]/.test(vin)) continue;
      
      const contextStart = Math.max(0, match.index! - 50);
      const contextEnd = Math.min(text.length, match.index! + vin.length + 50);
      const context = text.substring(contextStart, contextEnd);
      
      // Higher confidence if context explicitly mentions VIN
      let confidence = 0.75;
      const contextLower = context.toLowerCase();
      if (contextLower.includes('vin') || 
          contextLower.includes('vehicle identification')) {
        confidence = 0.95;
      }
      
      detected.push({
        type: 'vin_data',
        content: vin,
        context,
        confidence,
        source: 'regex',
        metadata: {
          vin: vin
        }
      });
    }

    // Legacy chassis identifiers: only accept when explicitly labeled
    const labeledPatterns = [
      /(?:\bvin\b|vehicle identification|chassis(?:\s*(?:no|number))?|serial(?:\s*(?:no|number))?)\D{0,40}([A-HJ-NPR-Z0-9]{4,16})/gi,
      /\bchassis\s+([A-HJ-NPR-Z0-9]{4,16})\b/gi,
    ];

    for (const pattern of labeledPatterns) {
      const labeledMatches = text.matchAll(pattern);
      for (const match of labeledMatches) {
        const candidate = match[1]?.toUpperCase();
        if (!candidate) continue;
        if (/[IOQ]/.test(candidate)) continue;
        if (!/\d/.test(candidate)) continue;
        const contextStart = Math.max(0, match.index! - 50);
        const contextEnd = Math.min(text.length, match.index! + candidate.length + 50);
        const context = text.substring(contextStart, contextEnd);

        detected.push({
          type: 'vin_data',
          content: candidate,
          context,
          confidence: 0.85,
          source: 'regex',
          metadata: {
            vin: candidate,
            legacy: true
          }
        });
      }
    }
    
    return detected;
  }

  /**
   * Detect specs and technical data (horsepower, torque, transmission, etc.)
   */
  private static detectSpecs(text: string): DetectedContent[] {
    const detected: DetectedContent[] = [];
    
    const specPatterns = [
      // Horsepower
      { regex: /(\d+)\s*(?:hp|horsepower|bhp)/gi, field: 'horsepower', confidence: 0.8 },
      // Torque
      { regex: /(\d+)\s*(?:lb-ft|ft-lbs?|nm|torque)/gi, field: 'torque', confidence: 0.8 },
      // Engine size
      { regex: /(\d+\.?\d*)\s*(?:L|liter|litre)\s*(?:V\d+)?/gi, field: 'engine_size', confidence: 0.7 },
      // Cylinder count
      { regex: /(V\d+|I\d+|straight-\d+|inline-\d+|flat-\d+)/gi, field: 'cylinders', confidence: 0.7 },
      // Transmission
      { regex: /(manual|automatic|auto|5-speed|6-speed|7-speed|8-speed|9-speed|10-speed|CVT|dual-clutch)/gi, field: 'transmission', confidence: 0.6 },
      // Drivetrain
      { regex: /(4WD|AWD|FWD|RWD|4x4|all-wheel drive|four-wheel drive|front-wheel drive|rear-wheel drive)/gi, field: 'drivetrain', confidence: 0.7 },
      // Mileage
      { regex: /(\d{1,3}(?:,\d{3})*)\s*(?:miles?|mi|km|kilometers?)/gi, field: 'mileage', confidence: 0.6 },
    ];
    
    for (const pattern of specPatterns) {
      const matches = text.matchAll(pattern.regex);
      
      for (const match of matches) {
        const contextStart = Math.max(0, match.index! - 80);
        const contextEnd = Math.min(text.length, match.index! + match[0].length + 80);
        const context = text.substring(contextStart, contextEnd);
        
        detected.push({
          type: 'specs_data',
          content: match[0],
          context,
          confidence: pattern.confidence,
          source: 'pattern_match',
          metadata: {
            field: pattern.field,
            value: match[1] || match[0]
          }
        });
      }
    }
    
    return detected;
  }

  /**
   * Detect price data (sale prices, asking prices, auction results)
   */
  private static detectPrices(text: string): DetectedContent[] {
    const detected: DetectedContent[] = [];
    
    const pricePatterns = [
      // USD prices
      { regex: /\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g, currency: 'USD' },
      // "sold for" context
      { regex: /(?:sold|final price|hammer price|winning bid)[\s:]+\$?(\d{1,3}(?:,\d{3})*)/gi, currency: 'USD' },
      // "asking" context
      { regex: /(?:asking|listed at|priced at)[\s:]+\$?(\d{1,3}(?:,\d{3})*)/gi, currency: 'USD' },
    ];
    
    for (const pattern of pricePatterns) {
      const matches = text.matchAll(pattern.regex);
      
      for (const match of matches) {
        const priceText = match[0];
        const priceValue = match[1].replace(/,/g, '');
        
        // Skip small amounts (likely not vehicle prices)
        const numericValue = parseInt(priceValue);
        if (numericValue < 1000) continue;
        
        const contextStart = Math.max(0, match.index! - 100);
        const contextEnd = Math.min(text.length, match.index! + priceText.length + 100);
        const context = text.substring(contextStart, contextEnd);
        
        // Determine price type from context
        const contextLower = context.toLowerCase();
        let priceType = 'unknown';
        let confidence = 0.6;
        
        if (contextLower.includes('sold') || contextLower.includes('final') || contextLower.includes('hammer')) {
          priceType = 'sold_price';
          confidence = 0.9;
        } else if (contextLower.includes('asking') || contextLower.includes('listed')) {
          priceType = 'asking_price';
          confidence = 0.8;
        } else if (contextLower.includes('bid') || contextLower.includes('offer')) {
          priceType = 'bid_price';
          confidence = 0.7;
        }
        
        detected.push({
          type: 'price_data',
          content: priceText,
          context,
          confidence,
          source: 'pattern_match',
          metadata: {
            price_type: priceType,
            amount: numericValue,
            currency: pattern.currency
          }
        });
      }
    }
    
    return detected;
  }

  /**
   * Detect timeline events (maintenance, repairs, modifications)
   */
  private static detectTimelineEvents(text: string): DetectedContent[] {
    const detected: DetectedContent[] = [];
    
    const eventKeywords = [
      'oil change', 'brake', 'tire', 'transmission', 'engine rebuild',
      'paint', 'body work', 'restoration', 'service', 'maintenance',
      'replaced', 'installed', 'upgraded', 'repaired', 'fixed',
      'modified', 'tuned', 'dyno', 'inspection'
    ];
    
    const sentences = text.split(/[.!?]+/);
    
    for (const sentence of sentences) {
      const sentenceLower = sentence.toLowerCase();
      
      // Check if sentence contains event keywords
      const matchedKeywords = eventKeywords.filter(kw => sentenceLower.includes(kw));
      
      if (matchedKeywords.length > 0) {
        // Check for dates in the sentence
        const datePattern = /\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4})/gi;
        const hasDate = datePattern.test(sentenceLower);
        
        // Check for mileage
        const hasMileage = /\d{1,3}(?:,\d{3})*\s*(?:miles?|mi|km)/i.test(sentenceLower);
        
        let confidence = 0.5;
        if (hasDate) confidence += 0.2;
        if (hasMileage) confidence += 0.1;
        if (matchedKeywords.length >= 2) confidence += 0.1;
        
        detected.push({
          type: 'timeline_event',
          content: sentence.trim(),
          context: sentence.trim(),
          confidence: Math.min(confidence, 0.95),
          source: 'nlp',
          metadata: {
            keywords: matchedKeywords,
            has_date: hasDate,
            has_mileage: hasMileage
          }
        });
      }
    }
    
    return detected;
  }

  /**
   * Detect image URLs (direct links to vehicle photos)
   */
  private static detectImageURLs(text: string): DetectedContent[] {
    const detected: DetectedContent[] = [];
    
    const imagePattern = /https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|bmp)/gi;
    const matches = text.matchAll(imagePattern);
    
    for (const match of matches) {
      const url = match[0];
      const contextStart = Math.max(0, match.index! - 50);
      const contextEnd = Math.min(text.length, match.index! + url.length + 50);
      const context = text.substring(contextStart, contextEnd);
      
      detected.push({
        type: 'image_url',
        content: url,
        context,
        confidence: 0.8,
        source: 'regex',
        metadata: {
          url: url
        }
      });
    }
    
    return detected;
  }

  /**
   * Detect contact information (phone, email, address)
   */
  private static detectContactInfo(text: string): DetectedContent[] {
    const detected: DetectedContent[] = [];
    
    // Phone numbers
    const phonePattern = /(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g;
    const phoneMatches = text.matchAll(phonePattern);
    
    for (const match of phoneMatches) {
      const contextStart = Math.max(0, match.index! - 50);
      const contextEnd = Math.min(text.length, match.index! + match[0].length + 50);
      const context = text.substring(contextStart, contextEnd);
      
      detected.push({
        type: 'contact_info',
        content: match[0],
        context,
        confidence: 0.7,
        source: 'regex',
        metadata: {
          contact_type: 'phone',
          value: match[0]
        }
      });
    }
    
    // Email addresses
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    const emailMatches = text.matchAll(emailPattern);
    
    for (const match of emailMatches) {
      const contextStart = Math.max(0, match.index! - 50);
      const contextEnd = Math.min(text.length, match.index! + match[0].length + 50);
      const context = text.substring(contextStart, contextEnd);
      
      detected.push({
        type: 'contact_info',
        content: match[0],
        context,
        confidence: 0.8,
        source: 'regex',
        metadata: {
          contact_type: 'email',
          value: match[0]
        }
      });
    }
    
    return detected;
  }

  /**
   * Detect document URLs (PDFs, service manuals, brochures)
   */
  private static detectDocumentURLs(text: string): DetectedContent[] {
    const detected: DetectedContent[] = [];
    
    const docPattern = /https?:\/\/[^\s]+\.(?:pdf|doc|docx)/gi;
    const matches = text.matchAll(docPattern);
    
    for (const match of matches) {
      const url = match[0];
      const contextStart = Math.max(0, match.index! - 80);
      const contextEnd = Math.min(text.length, match.index! + url.length + 80);
      const context = text.substring(contextStart, contextEnd);
      
      // Higher confidence if context mentions manual, brochure, document
      let confidence = 0.7;
      const contextLower = context.toLowerCase();
      if (contextLower.includes('manual') || 
          contextLower.includes('brochure') || 
          contextLower.includes('service') ||
          contextLower.includes('documentation')) {
        confidence = 0.9;
      }
      
      detected.push({
        type: 'document_url',
        content: url,
        context,
        confidence,
        source: 'regex',
        metadata: {
          url: url,
          file_type: url.split('.').pop()
        }
      });
    }
    
    return detected;
  }

  /**
   * Queue detected content for processing
   */
  static async queueDetectedContent(
    detected: DetectedContent[],
    vehicleId: string,
    userId: string,
    commentId?: string,
    commentTable?: string
  ): Promise<void> {
    for (const item of detected) {
      try {
        const { error } = await supabase.rpc('queue_content_extraction', {
          p_vehicle_id: vehicleId,
          p_comment_id: commentId || null,
          p_comment_table: commentTable || null,
          p_user_id: userId,
          p_content_type: item.type,
          p_raw_content: item.content,
          p_context: item.context,
          p_confidence_score: item.confidence,
          p_detection_method: item.source
        });
        
        if (error) {
          console.error('Error queueing content:', error);
        } else {
          console.log(`Queued ${item.type}: ${item.content.substring(0, 50)}...`);
        }
      } catch (err) {
        console.error('Error queueing content:', err);
      }
    }
  }
}

export default ContentDetector;

