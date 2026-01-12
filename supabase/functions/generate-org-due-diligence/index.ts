/**
 * Generate Organization Due Diligence Report
 * 
 * Performs comprehensive LLM-based research and analysis of an organization's website
 * to generate an investment-grade description and business intelligence report.
 * 
 * This is the "detective work" - deep analysis of:
 * - Business model and revenue streams
 * - Market positioning and competitive advantages
 * - Services and specializations
 * - History and reputation
 * - Target market and customer base
 * - Financial signals and indicators
 * - Operational capabilities
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DueDiligenceReport {
  // Executive Summary
  executive_summary: string;
  investment_thesis: string;
  investment_grade: 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F';
  
  // Business Overview
  description: string;
  business_model: string;
  revenue_streams: string[];
  specializations: string[];
  services_offered: string[];
  history_background: string;
  
  // Market Analysis
  market_positioning: string;
  target_market: string;
  market_size_estimate: string;
  competitive_landscape: string;
  competitive_advantages: string[];
  market_share_indicators: string[];
  
  // Financial Analysis
  financial_signals: string[];
  pricing_strategy: string;
  revenue_model_details: string;
  cost_structure_indicators: string[];
  profitability_indicators: string[];
  scale_indicators: string[];
  
  // Operational Assessment
  operational_capabilities: string[];
  facilities_equipment: string[];
  team_size_indicators: string[];
  technology_stack: string[];
  operational_efficiency_signals: string[];
  
  // Risk Assessment
  key_risks: Array<{ risk: string; severity: 'high' | 'medium' | 'low'; mitigation: string }>;
  swot_analysis: {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  };
  
  // Growth & Opportunities
  growth_potential: string;
  expansion_opportunities: string[];
  market_trends_alignment: string[];
  
  // Reputation & Credibility
  reputation_indicators: string[];
  credibility_signals: string[];
  customer_testimonials_indicators: string[];
  
  // Investment Considerations
  investment_notes: string[];
  valuation_considerations: string[];
  exit_strategy_indicators: string[];
  investment_timeline: string;
  
  // Structured Database Fields (extracted from website - use these to populate DB)
  database_fields: {
    // Contact & Location
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zip_code?: string;
    country?: string;
    
    // Business Details
    legal_name?: string;
    business_license?: string;
    tax_id?: string;
    registration_state?: string;
    registration_date?: string; // ISO date string
    years_in_business?: number;
    employee_count?: number;
    
    // Service Capabilities (booleans)
    has_lift?: boolean;
    has_paint_booth?: boolean;
    has_dyno?: boolean;
    has_alignment_rack?: boolean;
    accepts_dropoff?: boolean;
    offers_mobile_service?: boolean;
    
    // Pricing
    hourly_rate_min?: number;
    hourly_rate_max?: number;
    service_radius_miles?: number;
    
    // Business Hours (JSON format: {"monday": {"open": "08:00", "close": "17:00"}, ...})
    hours_of_operation?: Record<string, any>;
    
    // Additional structured data
    industry_focus?: string[]; // Array of focus areas
    logo_url?: string;
    cover_image_url?: string;
    
    // Financial & Pricing Data (for profit margin calculation)
    // Auction House Specific
    buyer_premium_rate?: number; // Buyer's premium percentage (e.g., 5.0 for 5%)
    seller_commission_rate?: number; // Seller's commission percentage
    listing_fee?: number; // Listing/entry fee in dollars
    reserve_fee?: number; // Reserve fee in dollars
    photography_fee?: number; // Photography fee in dollars
    processing_fee?: number; // Processing/transaction fee
    
    // Service Business Specific
    labor_rate?: number; // Standard hourly labor rate
    parts_markup_pct?: number; // Parts markup percentage
    service_margin_pct?: number; // Service margin percentage
    
    // Dealership Specific
    average_sale_price?: number; // Average vehicle sale price
    inventory_value?: number; // Total inventory value
    inventory_count?: number; // Number of vehicles in inventory
    
    // Calculated/Inferred Financial Metrics
    estimated_annual_revenue?: number; // Estimated annual revenue if calculable
    estimated_gross_margin_pct?: number; // Estimated gross margin percentage
    estimated_gmv?: number; // Estimated Gross Merchandise Value (for auction houses)
  };
  
  // Missing Critical Fields Assessment
  missing_critical_fields: Array<{ field: string; importance: 'critical' | 'high' | 'medium' | 'low'; reason: string }>;
  
  // Metadata
  confidence_score: number;
  data_quality_notes: string[];
}

/**
 * Extract comprehensive website content for analysis
 */
async function extractWebsiteContent(url: string): Promise<{
  homepage: string;
  aboutPage: string | null;
  servicesPage: string | null;
  contactPage: string | null;
  keyPages: Array<{ url: string; content: string; title: string }>;
}> {
  const baseUrl = new URL(url);
  const origin = baseUrl.origin;

  // Fetch homepage
  const homepageResponse = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!homepageResponse.ok) {
    throw new Error(`Failed to fetch homepage: ${homepageResponse.status}`);
  }

  const homepageHtml = await homepageResponse.text();
  const homepageDoc = new DOMParser().parseFromString(homepageHtml, 'text/html');
  const homepageText = extractTextContent(homepageDoc);

  // Find and fetch key pages
  const keyPages: Array<{ url: string; content: string; title: string }> = [];
  
  // Find navigation links
  const navLinks = homepageDoc.querySelectorAll('nav a, header a, .menu a, .navigation a');
  const pageUrls = new Set<string>();
  
  for (const link of Array.from(navLinks)) {
    const href = link.getAttribute('href');
    if (!href) continue;
    
    const linkText = (link.textContent || '').toLowerCase().trim();
    const fullUrl = href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? href : `/${href}`}`;
    
    // Identify key pages by link text
    if (linkText.includes('about') || linkText.includes('story') || linkText.includes('history')) {
      pageUrls.add(fullUrl);
    } else if (linkText.includes('service') || linkText.includes('what we do') || linkText.includes('capabilities')) {
      pageUrls.add(fullUrl);
    } else if (linkText.includes('contact') || linkText.includes('location')) {
      pageUrls.add(fullUrl);
    }
  }

  // Fetch key pages (limit to 3 most important to reduce API costs)
  const pagesToFetch = Array.from(pageUrls).slice(0, 3);
  for (const pageUrl of pagesToFetch) {
    try {
      const pageResponse = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (pageResponse.ok) {
        const pageHtml = await pageResponse.text();
        const pageDoc = new DOMParser().parseFromString(pageHtml, 'text/html');
        const pageText = extractTextContent(pageDoc);
        const pageTitle = pageDoc.querySelector('title')?.textContent || pageUrl;
        
        keyPages.push({
          url: pageUrl,
          content: pageText,
          title: pageTitle
        });
      }
    } catch (err) {
      console.warn(`Failed to fetch ${pageUrl}:`, err);
    }
  }

  // Identify specific pages
  const aboutPage = keyPages.find(p => 
    p.url.toLowerCase().includes('about') || 
    p.title.toLowerCase().includes('about')
  )?.content || null;

  const servicesPage = keyPages.find(p => 
    p.url.toLowerCase().includes('service') || 
    p.title.toLowerCase().includes('service')
  )?.content || null;

  const contactPage = keyPages.find(p => 
    p.url.toLowerCase().includes('contact') || 
    p.title.toLowerCase().includes('contact')
  )?.content || null;

  return {
    homepage: homepageText,
    aboutPage,
    servicesPage,
    contactPage,
    keyPages: keyPages.map(p => ({ url: p.url, content: p.content, title: p.title }))
  };
}

/**
 * Extract clean text content from HTML - optimized for LLM efficiency
 */
function extractTextContent(doc: any): string {
  // Remove script and style elements
  const scripts = doc.querySelectorAll('script, style, noscript, nav, footer, header');
  scripts.forEach((el: any) => el.remove());

  // Get main content areas (prioritize semantic HTML)
  const mainContent = doc.querySelector('main, article, .content, .main-content, #content, .about, .description') || doc.body;
  
  if (!mainContent) return '';

  // Extract key sections only (headings + first 2 paragraphs per section)
  let text = '';
  const sections: Array<{ heading: string; content: string }> = [];
  
  // Get all headings
  const headings = mainContent.querySelectorAll('h1, h2, h3');
  let currentSection = { heading: '', content: '' };
  
  for (const element of Array.from(mainContent.children)) {
    const tagName = element.tagName?.toLowerCase();
    const elementText = (element.textContent || '').trim();
    
    if (['h1', 'h2', 'h3'].includes(tagName)) {
      if (currentSection.heading || currentSection.content) {
        sections.push(currentSection);
      }
      currentSection = { heading: elementText, content: '' };
    } else if (['p', 'div'].includes(tagName) && elementText.length > 30) {
      if (currentSection.content.split('\n').length < 3) { // Limit to 2 paragraphs per section
        currentSection.content += elementText + '\n';
      }
    }
  }
  
  if (currentSection.heading || currentSection.content) {
    sections.push(currentSection);
  }

  // Combine sections, prioritizing key ones
  const prioritySections = ['about', 'services', 'history', 'company', 'story', 'mission', 'what we do'];
  const sortedSections = sections.sort((a, b) => {
    const aPriority = prioritySections.some(p => a.heading.toLowerCase().includes(p)) ? 1 : 0;
    const bPriority = prioritySections.some(p => b.heading.toLowerCase().includes(p)) ? 1 : 0;
    return bPriority - aPriority;
  });

  // Take top 8 sections max, limit each to 500 chars
  for (const section of sortedSections.slice(0, 8)) {
    if (section.heading) text += `## ${section.heading}\n`;
    text += section.content.substring(0, 500) + '\n\n';
  }

  // Fallback: if we got very little, take first few paragraphs
  if (text.length < 300) {
    const paragraphs = mainContent.querySelectorAll('p');
    for (const p of Array.from(paragraphs).slice(0, 5)) {
      const pText = (p.textContent || '').trim();
      if (pText.length > 30) {
        text += pText.substring(0, 400) + '\n\n';
      }
    }
  }

  // Aggressive limit: 2000 chars max (reduces token usage significantly)
  return text.substring(0, 2000).trim();
}

/**
 * Generate due diligence report using LLM
 */
async function generateDueDiligenceReport(
  organizationName: string,
  websiteContent: {
    homepage: string;
    aboutPage: string | null;
    servicesPage: string | null;
    contactPage: string | null;
    keyPages: Array<{ url: string; content: string; title: string }>;
  },
  websiteUrl: string
): Promise<DueDiligenceReport> {
  // Use OpenAI API (or Anthropic if preferred)
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  // Build optimized content summary (aggressively limit to reduce tokens)
  // Prioritize: About > Services > Homepage > Contact
  const contentSummary = [
    websiteContent.aboutPage ? `ABOUT:\n${websiteContent.aboutPage.substring(0, 800)}` : null,
    websiteContent.servicesPage ? `SERVICES:\n${websiteContent.servicesPage.substring(0, 800)}` : null,
    websiteContent.homepage ? `HOME:\n${websiteContent.homepage.substring(0, 1000)}` : null,
    websiteContent.contactPage ? `CONTACT:\n${websiteContent.contactPage.substring(0, 400)}` : null,
    ...websiteContent.keyPages.slice(0, 2).map(p => `${p.title}:\n${p.content.substring(0, 600)}`)
  ].filter(Boolean).join('\n\n').substring(0, 3000); // Hard limit: 3000 chars total

  // Investment-grade due diligence prompt
  const prompt = `You are a senior investment analyst at a private equity firm specializing in automotive businesses. Perform comprehensive due diligence on this company and generate an investment-grade report suitable for a $100K-$10M investment decision.

ORGANIZATION: ${organizationName}
WEBSITE: ${websiteUrl}

WEBSITE CONTENT:
${contentSummary}

Generate a comprehensive investment-grade due diligence report in JSON format. This report will be used by investors to make multi-million dollar investment decisions. Be thorough, analytical, and investment-focused.

Return JSON with this structure:
{
  "executive_summary": "3-4 paragraph executive summary covering: business model, market position, key financial indicators, investment appeal, and primary risks. Write for a busy investor.",
  "investment_thesis": "2-3 paragraph investment thesis: Why invest in this business? What makes it attractive? What's the value proposition?",
  "investment_grade": "A+ | A | B+ | B | C+ | C | D | F - Overall investment grade based on risk/reward",
  
  "description": "2-3 paragraph comprehensive business description: what they do, how they operate, their unique value proposition",
  "business_model": "Primary revenue model (e.g., 'Retail sales', 'Service/repair', 'Custom builds', 'Brokerage', 'Auction platform', 'Hybrid')",
  "revenue_streams": ["List all identifiable revenue streams: e.g., 'Vehicle sales', 'Service labor', 'Parts sales', 'Consignment fees'"],
  "specializations": ["Specific areas of expertise: e.g., 'Classic car restoration', 'Performance tuning', 'Exotic car sales'"],
  "services_offered": ["Detailed list of services/products offered"],
  "history_background": "Company history: founding story, years in business, key milestones, ownership changes, growth trajectory",
  
  "market_positioning": "How they position themselves: premium, budget, niche, mass market, luxury, etc.",
  "target_market": "Detailed target customer base: demographics, psychographics, geographic focus",
  "market_size_estimate": "Estimated addressable market size if mentioned or inferable (e.g., 'Regional market', 'National', '$X million TAM')",
  "competitive_landscape": "Analysis of competitive environment: who are competitors, how crowded is the market",
  "competitive_advantages": ["Key differentiators and competitive moats"],
  "market_share_indicators": ["Signals of market position: e.g., 'Leading dealer in region', 'Top 3 in specialty'"],
  
  "financial_signals": ["Visible financial indicators: inventory size, price ranges, transaction volume, revenue scale indicators"],
  "pricing_strategy": "Pricing approach: premium pricing, value pricing, competitive, etc.",
  "revenue_model_details": "Detailed revenue model explanation: how money is made, pricing structure, margins if visible",
  "cost_structure_indicators": ["Signals about cost structure: e.g., 'High fixed costs (facility)', 'Low overhead (online-only)'"],
  "profitability_indicators": ["Signals of profitability: e.g., 'Premium pricing suggests healthy margins', 'High inventory turnover'"],
  "scale_indicators": ["Signals of business scale: e.g., 'Large inventory (50+ vehicles)', 'Multiple locations', 'High transaction volume'"],
  
  "operational_capabilities": ["Core operational capabilities: what they can do in-house"],
  "facilities_equipment": ["Facilities and equipment mentioned: e.g., 'Paint booth', 'Dyno facility', 'Showroom', 'Service bays'"],
  "team_size_indicators": ["Signals of team size: e.g., 'Small team (2-5)', 'Medium (10-20)', 'Large (50+)'"],
  "technology_stack": ["Technology mentioned: e.g., 'Online platform', 'CRM system', 'Inventory management'"],
  "operational_efficiency_signals": ["Signals of operational efficiency: e.g., 'Streamlined processes', 'Automated systems'"],
  
  "key_risks": [
    {"risk": "Specific risk identified", "severity": "high|medium|low", "mitigation": "How they mitigate or how investor could mitigate"}
  ],
  "swot_analysis": {
    "strengths": ["Key strengths"],
    "weaknesses": ["Key weaknesses"],
    "opportunities": ["Growth opportunities"],
    "threats": ["Market threats"]
  },
  
  "growth_potential": "Assessment of growth potential: scalability, expansion opportunities, market trends",
  "expansion_opportunities": ["Identified expansion opportunities: geographic, service line, market segment"],
  "market_trends_alignment": ["How they align with market trends: e.g., 'Rising classic car values', 'Growing EV market'"],
  
  "reputation_indicators": ["Reputation signals: awards, media coverage, industry recognition"],
  "credibility_signals": ["Credibility indicators: certifications, licenses, partnerships, years in business"],
  "customer_testimonials_indicators": ["Signals of customer satisfaction: testimonials, reviews, repeat business"],
  
  "investment_notes": ["Key investment considerations: what investors should know"],
  "valuation_considerations": ["Valuation factors: revenue multiples, asset value, growth trajectory, comparable companies"],
  "exit_strategy_indicators": ["Exit potential: acquisition targets, IPO potential, strategic buyers"],
  "investment_timeline": "Recommended investment timeline: short-term (1-2 years), medium (3-5 years), long-term (5+ years)",
  
  "database_fields": {
    "email": "email address if found on website (extract from contact page, footer, etc.)",
    "phone": "phone number if found (format: +1-XXX-XXX-XXXX or similar)",
    "address": "street address if found",
    "city": "city name if found",
    "state": "state abbreviation if found (e.g., 'CA', 'TX')",
    "zip_code": "zip code if found",
    "country": "country if found (default 'US' if not specified)",
    "legal_name": "legal/registered business name if different from business_name",
    "business_license": "license number if mentioned",
    "tax_id": "EIN or tax ID if mentioned",
    "registration_state": "state of registration if mentioned",
    "registration_date": "date of registration if mentioned (ISO format: YYYY-MM-DD)",
    "years_in_business": "number of years in business (integer, calculate from founding date if available)",
    "employee_count": "number of employees (integer, extract from phrases like 'team of 10', '5 employees', 'we have 20 staff')",
    "has_lift": "true if lift/hoist mentioned, false if not mentioned",
    "has_paint_booth": "true if paint booth mentioned, false if not mentioned",
    "has_dyno": "true if dyno/dynamometer mentioned, false if not mentioned",
    "has_alignment_rack": "true if alignment rack mentioned, false if not mentioned",
    "accepts_dropoff": "true if dropoff service mentioned, false if not mentioned",
    "offers_mobile_service": "true if mobile service mentioned, false if not mentioned",
    "hourly_rate_min": "minimum hourly rate (number, extract from pricing info)",
    "hourly_rate_max": "maximum hourly rate (number, extract from pricing info)",
    "service_radius_miles": "service radius in miles (integer, extract from phrases like 'serves 50 mile radius')",
    "hours_of_operation": "business hours as JSON object: {\"monday\": {\"open\": \"08:00\", \"close\": \"17:00\"}, \"tuesday\": {...}, etc.} or null if not found",
    "industry_focus": ["array of focus areas: e.g., 'classic_cars', 'exotics', 'racing', 'restoration'"],
    "logo_url": "URL to logo image if found on website",
    "cover_image_url": "URL to cover/banner image if found",
    
    "buyer_premium_rate": "Buyer's premium percentage if auction house (e.g., 5.0 for 5%, 10.0 for 10%)",
    "seller_commission_rate": "Seller's commission percentage if auction house (e.g., 3.0 for 3%, 5.0 for 5%)",
    "listing_fee": "Listing/entry fee in dollars if mentioned",
    "reserve_fee": "Reserve fee in dollars if mentioned",
    "photography_fee": "Photography fee in dollars if mentioned",
    "processing_fee": "Processing/transaction fee in dollars if mentioned",
    "labor_rate": "Standard hourly labor rate in dollars (extract from pricing pages, service descriptions)",
    "parts_markup_pct": "Parts markup percentage if mentioned (e.g., 30.0 for 30% markup)",
    "service_margin_pct": "Service margin percentage if mentioned",
    "average_sale_price": "Average vehicle sale price if mentioned or inferable",
    "inventory_value": "Total inventory value if mentioned (e.g., '$2M inventory', '50 vehicles averaging $40k')",
    "inventory_count": "Number of vehicles in inventory if mentioned",
    "estimated_annual_revenue": "ONLY if explicitly stated on website (e.g., 'We process $5M annually'). Do NOT calculate.",
    "estimated_gross_margin_pct": "ONLY if explicitly reported as profit margin on website (e.g., 'Our profit margin is 15%'). Do NOT infer from commission rates or calculate.",
    "estimated_gmv": "ONLY if explicitly stated (e.g., 'We've sold $50M in vehicles'). Do NOT calculate from vehicle counts × prices."
  },
  "missing_critical_fields": [
    {"field": "field_name", "importance": "critical|high|medium|low", "reason": "Why this field is important for investment decision"}
  ],
  
  "confidence_score": 0.85,
  "data_quality_notes": ["Notes on data quality: what's based on evidence vs. inference, what's missing"]
}

CRITICAL: This is for investment decisions. Be thorough, analytical, and honest about risks. If information is unavailable, state that clearly. Use evidence from the website content. Be specific with numbers, examples, and concrete details when available.

CRITICAL: The "database_fields" object is the PRIMARY DATA SOURCE for populating database records. Extract ALL structured data you can find from the website:

**Contact & Business Info:**
- Contact info (email, phone, address) - look in contact pages, footers, headers
- Business details (legal name, license, years in business, employee count) - look in about pages, footer text
- Service capabilities (has_lift, has_paint_booth, etc.) - infer from service descriptions, facility photos, equipment mentions
- Business hours - look in contact/about pages, footer
- Industry focus - infer from specializations, services offered, vehicle types mentioned

**Financial & Pricing Data (CRITICAL FOR PROFIT MARGIN CALCULATION):**
- **Auction Houses**: Extract commission rates (buyer's premium, seller's commission), listing fees, reserve fees, photography fees. Look in "fees", "pricing", "how it works" pages. Example: "5% buyer's premium" → buyer_premium_rate: 5.0, "3% seller commission" → seller_commission_rate: 3.0
- **Service Businesses**: Extract labor rates, parts markup, service margins. Look in pricing pages, service descriptions. Example: "$125/hour" → labor_rate: 125, "30% parts markup" → parts_markup_pct: 30.0
- **Dealerships**: Extract average sale prices, inventory counts, inventory values. Look in inventory pages, about pages. Example: "50 vehicles in stock" → inventory_count: 50, "average sale price $45k" → average_sale_price: 45000

**Reported Financial Metrics (ONLY if explicitly stated on website):**
- **estimated_annual_revenue**: ONLY if website explicitly states revenue (e.g., "We generate $5M annually"). Do NOT calculate.
- **estimated_gross_margin_pct**: ONLY if website explicitly reports profit margin (e.g., "Our profit margin is 15%"). Do NOT infer from commission rates.
- **estimated_gmv**: ONLY if website explicitly states GMV (e.g., "We've sold $50M in vehicles"). Do NOT calculate.

**CRITICAL: We are building the EQUATION, not calculating final numbers. Extract reported components (commission rates, fees, pricing) so users can input their actual data later.**

Be aggressive in extraction of REPORTED data - if you see "established in 1995", calculate years_in_business. If you see "team of 15", set employee_count to 15. If you see "state-of-the-art paint booth", set has_paint_booth to true. 

For financial data, extract ONLY what's explicitly stated:
- Commission rates: "5% buyer's premium" → buyer_premium_rate: 5.0
- Fees: "$500 listing fee" → listing_fee: 500
- Pricing: "$125/hour" → labor_rate: 125

DO NOT calculate profit margins, revenue, or GMV unless explicitly stated. We're building the equation structure (revenue = GMV × commission_rate), not the final numbers. Users will input their actual data to complete the equation.

In "missing_critical_fields", identify which database fields are still missing that would be critical for investment decisions (e.g., financial data, legal registration, contact info, operational capabilities).`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo', // Use cheaper model first (10x cheaper than gpt-4o)
        messages: [
          {
            role: 'system',
            content: 'You are an expert investment analyst specializing in automotive businesses. Generate comprehensive, accurate reports based on available evidence. Be concise but thorough.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.2, // Very low temperature for factual output
        max_tokens: 4000, // Increased for comprehensive investment-grade report
        response_format: { type: 'json_object' }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Try fallback to gpt-4o if gpt-3.5-turbo fails (for better quality if needed)
      if (response.status === 403 && errorText.includes('model_not_found')) {
        console.log('⚠️ gpt-3.5-turbo not available, trying gpt-4o fallback...');
        const fallbackResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              {
                role: 'system',
                content: 'You are an expert investment analyst specializing in automotive businesses. Generate comprehensive, accurate reports based on available evidence.'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.2,
            max_tokens: 4000,
            response_format: { type: 'json_object' }
          }),
        });

        if (!fallbackResponse.ok) {
          const fallbackError = await fallbackResponse.text();
          throw new Error(`OpenAI API error: ${fallbackResponse.status} - ${fallbackError}`);
        }

        const fallbackData = await fallbackResponse.json();
        const reportJson = fallbackData.choices[0]?.message?.content;
        
        if (!reportJson) {
          throw new Error('No response from OpenAI (fallback)');
        }

        const report = JSON.parse(reportJson) as DueDiligenceReport;
        // Use same validation function as main path (extracted below)
        return validateAndCleanReport(report);
      }
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const reportJson = data.choices[0]?.message?.content;
    
    if (!reportJson) {
      throw new Error('No response from OpenAI');
    }

    const report = JSON.parse(reportJson) as DueDiligenceReport;
    
    // Validate and clean the comprehensive investment-grade report
    return validateAndCleanReport(report);
  } catch (error: any) {
    console.error('LLM generation error:', error);
    throw new Error(`Failed to generate due diligence report: ${error.message}`);
  }
}

/**
 * Validate and clean the due diligence report structure
 */
function validateAndCleanReport(report: any): DueDiligenceReport {
  return {
      executive_summary: report.executive_summary || '',
      investment_thesis: report.investment_thesis || '',
      investment_grade: (['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F'].includes(report.investment_grade)) ? report.investment_grade : 'C',
      
      description: report.description || '',
      business_model: report.business_model || '',
      revenue_streams: Array.isArray(report.revenue_streams) ? report.revenue_streams : [],
      specializations: Array.isArray(report.specializations) ? report.specializations : [],
      services_offered: Array.isArray(report.services_offered) ? report.services_offered : [],
      history_background: report.history_background || '',
      
      market_positioning: report.market_positioning || '',
      target_market: report.target_market || '',
      market_size_estimate: report.market_size_estimate || '',
      competitive_landscape: report.competitive_landscape || '',
      competitive_advantages: Array.isArray(report.competitive_advantages) ? report.competitive_advantages : [],
      market_share_indicators: Array.isArray(report.market_share_indicators) ? report.market_share_indicators : [],
      
      financial_signals: Array.isArray(report.financial_signals) ? report.financial_signals : [],
      pricing_strategy: report.pricing_strategy || '',
      revenue_model_details: report.revenue_model_details || '',
      cost_structure_indicators: Array.isArray(report.cost_structure_indicators) ? report.cost_structure_indicators : [],
      profitability_indicators: Array.isArray(report.profitability_indicators) ? report.profitability_indicators : [],
      scale_indicators: Array.isArray(report.scale_indicators) ? report.scale_indicators : [],
      
      operational_capabilities: Array.isArray(report.operational_capabilities) ? report.operational_capabilities : [],
      facilities_equipment: Array.isArray(report.facilities_equipment) ? report.facilities_equipment : [],
      team_size_indicators: Array.isArray(report.team_size_indicators) ? report.team_size_indicators : [],
      technology_stack: Array.isArray(report.technology_stack) ? report.technology_stack : [],
      operational_efficiency_signals: Array.isArray(report.operational_efficiency_signals) ? report.operational_efficiency_signals : [],
      
      key_risks: Array.isArray(report.key_risks) ? report.key_risks.map((r: any) => ({
        risk: r.risk || '',
        severity: (['high', 'medium', 'low'].includes(r.severity)) ? r.severity : 'medium',
        mitigation: r.mitigation || ''
      })) : [],
      swot_analysis: {
        strengths: Array.isArray(report.swot_analysis?.strengths) ? report.swot_analysis.strengths : [],
        weaknesses: Array.isArray(report.swot_analysis?.weaknesses) ? report.swot_analysis.weaknesses : [],
        opportunities: Array.isArray(report.swot_analysis?.opportunities) ? report.swot_analysis.opportunities : [],
        threats: Array.isArray(report.swot_analysis?.threats) ? report.swot_analysis.threats : []
      },
      
      growth_potential: report.growth_potential || '',
      expansion_opportunities: Array.isArray(report.expansion_opportunities) ? report.expansion_opportunities : [],
      market_trends_alignment: Array.isArray(report.market_trends_alignment) ? report.market_trends_alignment : [],
      
      reputation_indicators: Array.isArray(report.reputation_indicators) ? report.reputation_indicators : [],
      credibility_signals: Array.isArray(report.credibility_signals) ? report.credibility_signals : [],
      customer_testimonials_indicators: Array.isArray(report.customer_testimonials_indicators) ? report.customer_testimonials_indicators : [],
      
      investment_notes: Array.isArray(report.investment_notes) ? report.investment_notes : [],
      valuation_considerations: Array.isArray(report.valuation_considerations) ? report.valuation_considerations : [],
      exit_strategy_indicators: Array.isArray(report.exit_strategy_indicators) ? report.exit_strategy_indicators : [],
      investment_timeline: report.investment_timeline || '',
      
      database_fields: report.database_fields || {},
      missing_critical_fields: Array.isArray(report.missing_critical_fields) ? report.missing_critical_fields.map((f: any) => ({
        field: f.field || '',
        importance: (['critical', 'high', 'medium', 'low'].includes(f.importance)) ? f.importance : 'medium',
        reason: f.reason || ''
      })) : [],
      
      confidence_score: typeof report.confidence_score === 'number' ? report.confidence_score : 0.5,
      data_quality_notes: Array.isArray(report.data_quality_notes) ? report.data_quality_notes : []
    };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { organizationId, websiteUrl, forceRegenerate = false } = await req.json();

    if (!organizationId) {
      return new Response(
        JSON.stringify({ error: 'organizationId required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get organization with all fields to check what's missing
    const { data: org, error: orgError } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', organizationId)
      .single();

    if (orgError || !org) {
      throw new Error(`Organization not found: ${orgError?.message}`);
    }

    // Check if we already have a due diligence report
    const hasExistingReport = org.metadata?.due_diligence_report && !forceRegenerate;
    if (hasExistingReport) {
      return new Response(
        JSON.stringify({
          message: 'Due diligence report already exists',
          report: org.metadata.due_diligence_report,
          cached: true
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Determine website URL
    const url = websiteUrl || org.website;
    if (!url) {
      throw new Error('Website URL required for due diligence analysis');
    }

    console.log(`🔍 Performing due diligence research on: ${org.business_name} (${url})`);

    // Extract comprehensive website content
    const websiteContent = await extractWebsiteContent(url);
    console.log(`✅ Extracted content from ${websiteContent.keyPages.length + 1} pages`);

    // Generate due diligence report
    const report = await generateDueDiligenceReport(org.business_name, websiteContent, url);
    console.log(`✅ Generated due diligence report (confidence: ${report.confidence_score})`);

    // Update organization with report and extractable fields
    //
    // Slop guard: never overwrite a human/curated description by default.
    // Only set businesses.description if it's currently empty OR it was previously set by this AI job.
    const nowIso = new Date().toISOString();
    const updates: any = {
      metadata: {
        ...(org.metadata || {}),
        due_diligence_report: report,
        due_diligence_generated_at: nowIso,
        due_diligence_website_url: url,
        missing_critical_fields: report.missing_critical_fields || []
      }
    };

    const descriptionWasAi = org.metadata?.description_source === 'ai_due_diligence';
    const shouldSetDescription = !org.description || descriptionWasAi;
    if (shouldSetDescription) {
      updates.description = report.executive_summary || report.description || null;
      updates.metadata = {
        ...updates.metadata,
        description_source: 'ai_due_diligence',
        ai_synopsis: report.executive_summary || report.description || null
      };
    } else {
      // Still store a synopsis for the UI, but keep the curated description untouched.
      updates.metadata = {
        ...updates.metadata,
        ai_synopsis: report.executive_summary || report.description || null
      };
    }

    // Populate database fields from the report (this is the structured data source)
    const dbFields = report.database_fields || {};
    // Populate all database fields from the structured report data
    if (dbFields.email && !org.email) updates.email = dbFields.email;
    if (dbFields.phone && !org.phone) updates.phone = dbFields.phone;
    if (dbFields.address && !org.address) updates.address = dbFields.address;
    if (dbFields.city && !org.city) updates.city = dbFields.city;
    if (dbFields.state && !org.state) updates.state = dbFields.state;
    if (dbFields.zip_code && !org.zip_code) updates.zip_code = dbFields.zip_code;
    if (dbFields.country && !org.country) updates.country = dbFields.country;
    if (dbFields.legal_name && !org.legal_name) updates.legal_name = dbFields.legal_name;
    if (dbFields.business_license && !org.business_license) updates.business_license = dbFields.business_license;
    if (dbFields.tax_id && !org.tax_id) updates.tax_id = dbFields.tax_id;
    if (dbFields.registration_state && !org.registration_state) updates.registration_state = dbFields.registration_state;
    if (dbFields.registration_date && !org.registration_date) updates.registration_date = dbFields.registration_date;
    if (dbFields.years_in_business !== undefined && !org.years_in_business) updates.years_in_business = dbFields.years_in_business;
    if (dbFields.employee_count !== undefined && !org.employee_count) updates.employee_count = dbFields.employee_count;
    if (dbFields.has_lift !== undefined) updates.has_lift = dbFields.has_lift;
    if (dbFields.has_paint_booth !== undefined) updates.has_paint_booth = dbFields.has_paint_booth;
    if (dbFields.has_dyno !== undefined) updates.has_dyno = dbFields.has_dyno;
    if (dbFields.has_alignment_rack !== undefined) updates.has_alignment_rack = dbFields.has_alignment_rack;
    if (dbFields.accepts_dropoff !== undefined) updates.accepts_dropoff = dbFields.accepts_dropoff;
    if (dbFields.offers_mobile_service !== undefined) updates.offers_mobile_service = dbFields.offers_mobile_service;
    if (dbFields.hourly_rate_min !== undefined && !org.hourly_rate_min) updates.hourly_rate_min = dbFields.hourly_rate_min;
    if (dbFields.hourly_rate_max !== undefined && !org.hourly_rate_max) updates.hourly_rate_max = dbFields.hourly_rate_max;
    if (dbFields.service_radius_miles !== undefined && !org.service_radius_miles) updates.service_radius_miles = dbFields.service_radius_miles;
    // hours_of_operation column doesn't exist in businesses table, store in metadata instead
    if (dbFields.hours_of_operation) {
      updates.metadata = {
        ...updates.metadata,
        hours_of_operation: dbFields.hours_of_operation
      };
    }
    if (dbFields.industry_focus && Array.isArray(dbFields.industry_focus) && dbFields.industry_focus.length > 0) {
      updates.industry_focus = dbFields.industry_focus;
    }
    if (dbFields.logo_url && !org.logo_url) updates.logo_url = dbFields.logo_url;
    if (dbFields.cover_image_url && !org.banner_url) updates.banner_url = dbFields.cover_image_url;
    
    // Financial & Pricing Data (for profit margin calculation)
    // Parse and validate numeric values
    const parseNumeric = (val: any): number | undefined => {
      if (val === undefined || val === null) return undefined;
      if (typeof val === 'number') return val;
      if (typeof val === 'string') {
        // Remove currency symbols, commas, spaces
        const cleaned = val.replace(/[$,\s]/g, '').toLowerCase();
        // Handle "M" for millions, "K" for thousands
        if (cleaned.includes('m')) {
          return parseFloat(cleaned.replace('m', '')) * 1000000;
        }
        if (cleaned.includes('k')) {
          return parseFloat(cleaned.replace('k', '')) * 1000;
        }
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? undefined : parsed;
      }
      return undefined;
    };

    const parsedLaborRate = parseNumeric(dbFields.labor_rate);
    if (parsedLaborRate !== undefined && !org.labor_rate) updates.labor_rate = parsedLaborRate;
    
    const parsedGmv = parseNumeric(dbFields.estimated_gmv);
    if (parsedGmv !== undefined && !org.gmv) updates.gmv = parsedGmv;
    
    // DO NOT calculate profit margins - only store reported components
    // Users will input their actual data to calculate final margins
    // We're building the equation structure, not the final numbers
    
    // Only populate gross_margin_pct if it's EXPLICITLY reported on the website
    // (e.g., "Our profit margin is 15%", not inferred from commission rates)
    const reportedMargin = parseNumeric(dbFields.estimated_gross_margin_pct);
    if (reportedMargin !== undefined && reportedMargin > 0 && !org.gross_margin_pct) {
      // Only use if it's explicitly stated as a margin/profit percentage
      // This should be rare - most sites don't report margins directly
      updates.gross_margin_pct = reportedMargin;
    }
    
    // Store commission rates and fees in metadata for reference
    if (dbFields.buyer_premium_rate !== undefined || dbFields.seller_commission_rate !== undefined || 
        dbFields.listing_fee !== undefined || dbFields.reserve_fee !== undefined ||
        dbFields.photography_fee !== undefined || dbFields.processing_fee !== undefined ||
        dbFields.parts_markup_pct !== undefined || dbFields.service_margin_pct !== undefined) {
      updates.metadata = {
        ...updates.metadata,
        // Equation components (reported numbers only - users will input actual data to complete equation)
        equation_components: {
          // Auction house equation: Revenue = GMV × (seller_commission_rate + buyer_premium_rate) / 100
          seller_commission_rate: dbFields.seller_commission_rate,
          buyer_premium_rate: dbFields.buyer_premium_rate,
          listing_fee: dbFields.listing_fee,
          reserve_fee: dbFields.reserve_fee,
          photography_fee: dbFields.photography_fee,
          processing_fee: dbFields.processing_fee,
          
          // Service business equation: Revenue = labor_rate × hours, Cost = (labor_rate × hours) - profit
          labor_rate: dbFields.labor_rate,
          parts_markup_pct: dbFields.parts_markup_pct,
          service_margin_pct: dbFields.service_margin_pct,
          
          // Dealership equation: Revenue = inventory_count × average_sale_price, Margin = (sale_price - cost) / sale_price
          average_sale_price: dbFields.average_sale_price,
          inventory_value: dbFields.inventory_value,
          inventory_count: dbFields.inventory_count,
          
          // Only include if EXPLICITLY reported on website (not calculated)
          reported_annual_revenue: dbFields.estimated_annual_revenue, // Only if website states it
          reported_gmv: dbFields.estimated_gmv, // Only if website states it
          reported_profit_margin: dbFields.estimated_gross_margin_pct // Only if website states it
        }
      };
    }

    // Update business type if we can infer it from the report
    if (report.business_model) {
      const businessTypeMap: Record<string, string> = {
        'retail sales': 'dealership',
        'service/repair': 'garage',
        'custom builds': 'fabrication',
        'restoration': 'restoration_shop',
        'performance': 'performance_shop',
        'auction platform': 'auction_house',
        'brokerage': 'dealership',
      };

      const inferredType = Object.entries(businessTypeMap).find(([key]) =>
        report.business_model.toLowerCase().includes(key)
      )?.[1];

      if (inferredType && (!org.business_type || org.business_type === 'other')) {
        updates.business_type = inferredType;
      }
    }

    // Update specializations if available
    if (report.specializations && report.specializations.length > 0) {
      updates.specializations = report.specializations;
    }

    // Update services_offered if available
    if (report.services_offered && report.services_offered.length > 0) {
      updates.services_offered = report.services_offered;
    }

    const { error: updateError } = await supabase
      .from('businesses')
      .update(updates)
      .eq('id', organizationId);

    if (updateError) {
      throw new Error(`Failed to update organization: ${updateError.message}`);
    }

    // Count how many fields were updated
    const updatedFields = Object.keys(updates).filter(k => k !== 'metadata' && k !== 'description');
    const extractedFields = Object.keys(dbFields).filter(k => dbFields[k] !== undefined && dbFields[k] !== null);

    return new Response(
      JSON.stringify({
        success: true,
        report,
        updated: {
          description: !!report.description,
          business_type: !!updates.business_type,
          specializations: report.specializations.length,
          services_offered: report.services_offered.length,
          database_fields_populated: updatedFields.length,
          extractable_fields_found: extractedFields.length,
          missing_critical_fields: report.missing_critical_fields.length
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error: any) {
    console.error('Due diligence error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

