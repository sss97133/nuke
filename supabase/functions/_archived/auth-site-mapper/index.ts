import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * AUTHENTICATED SITE MAPPER
 * 
 * Handles sites that require login (Mecum, Barrett-Jackson, etc.)
 * Secure approach without storing actual credentials
 * 
 * Methods:
 * 1. Browser automation with temporary sessions
 * 2. Cookie/session management
 * 3. Public vs authenticated area mapping
 * 4. Secure credential handling
 */

interface AuthSiteConfig {
  site_url: string;
  auth_method: 'login_form' | 'oauth' | 'session_cookies' | 'api_key';
  public_areas: string[];      // URLs accessible without login
  private_areas: string[];     // URLs requiring authentication
  login_indicators: string[];  // How to detect successful login
  extraction_schemas: {
    public: any;               // Extraction for public areas
    authenticated: any;        // Extraction for member areas
  };
}

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    const { action, params = {} } = await req.json();
    
    switch (action) {
      case 'analyze_auth_requirements':
        return await analyzeAuthRequirements(params.site_url);
      
      case 'map_public_areas':
        return await mapPublicAreas(params.site_url);
      
      case 'create_session_config':
        return await createSessionConfig(params);
      
      case 'test_auth_extraction':
        return await testAuthExtraction(params);
      
      default:
        return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
    }
  } catch (error) {
    console.error('Auth site mapper error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }), { status: 500 });
  }
});

async function analyzeAuthRequirements(siteUrl: string) {
  console.log(`🔐 Analyzing auth requirements for: ${siteUrl}`);
  
  // Step 1: Analyze what's public vs private
  const publicAnalysis = await analyzePublicAccess(siteUrl);
  
  // Step 2: Detect authentication methods
  const authMethods = await detectAuthMethods(siteUrl);
  
  // Step 3: Map public areas first
  const publicMapping = await mapPublicAreas(siteUrl);
  
  // Step 4: Identify premium/member content
  const premiumContent = await identifyPremiumContent(siteUrl);
  
  const config: AuthSiteConfig = {
    site_url: siteUrl,
    auth_method: authMethods.primary_method,
    public_areas: publicAnalysis.accessible_urls,
    private_areas: premiumContent.restricted_urls,
    login_indicators: authMethods.success_indicators,
    extraction_schemas: {
      public: publicMapping.extraction_schema,
      authenticated: premiumContent.premium_schema
    }
  };
  
  return new Response(JSON.stringify({
    success: true,
    data: {
      auth_config: config,
      analysis: {
        public_coverage: publicAnalysis.coverage_percentage,
        auth_complexity: authMethods.complexity_score,
        premium_value: premiumContent.value_score
      },
      recommendations: generateAuthRecommendations(config)
    },
    timestamp: new Date().toISOString()
  }));
}

async function mapPublicAreas(siteUrl: string) {
  console.log(`🌐 Mapping public areas of: ${siteUrl}`);
  
  // Use Firecrawl to analyze public pages
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!firecrawlKey) {
    throw new Error('Firecrawl API key not configured');
  }
  
  // Crawl public areas
  // v1: use /map for fast URL discovery (v0 /crawl is deprecated)
  const response = await fetch('https://api.firecrawl.dev/v1/map', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: siteUrl,
      limit: 20
    })
  });
  
  const crawlData = await response.json();
  
  // Analyze what data is available publicly
  const publicSchema = await generatePublicExtractionSchema(crawlData, siteUrl);
  
  return new Response(JSON.stringify({
    success: true,
    data: {
      public_urls: crawlData.links || [],
      extraction_schema: publicSchema,
      coverage_estimate: calculatePublicCoverage(crawlData),
      auth_walls_detected: detectAuthWalls(crawlData)
    },
    timestamp: new Date().toISOString()
  }));
}

async function createSessionConfig(params: any) {
  const { site_url, session_approach = 'browser_automation' } = params;
  
  console.log(`🔧 Creating session config for: ${site_url}`);
  
  const sessionConfig = {
    site_url,
    approach: session_approach,
    
    // Browser automation approach (most secure)
    browser_automation: {
      login_flow: await generateLoginFlow(site_url),
      session_indicators: await identifySessionIndicators(site_url),
      extraction_timing: 'post_login',
      session_duration: '2_hours',
      refresh_strategy: 'periodic_reauth'
    },
    
    // Security settings
    security: {
      store_credentials: false,
      session_token_only: true,
      auto_logout: true,
      rate_limiting: true
    },
    
    // Extraction areas available after auth
    authenticated_areas: await identifyAuthenticatedAreas(site_url)
  };
  
  return new Response(JSON.stringify({
    success: true,
    data: sessionConfig,
    instructions: generateSessionInstructions(sessionConfig),
    timestamp: new Date().toISOString()
  }));
}

// Helper functions

async function analyzePublicAccess(siteUrl: string) {
  // Determine what's accessible without login
  return {
    accessible_urls: [
      `${siteUrl}/auctions`,
      `${siteUrl}/results`, 
      `${siteUrl}/upcoming`
    ],
    coverage_percentage: 60 // mock - 60% public, 40% requires auth
  };
}

async function detectAuthMethods(siteUrl: string) {
  // Analyze how authentication works
  return {
    primary_method: 'login_form',
    complexity_score: 0.7,
    success_indicators: ['dashboard', 'profile', 'member'],
    login_url: `${siteUrl}/login`,
    logout_url: `${siteUrl}/logout`
  };
}

async function identifyPremiumContent(siteUrl: string) {
  // Find what premium/authenticated content is available
  return {
    restricted_urls: [
      `${siteUrl}/member/auctions`,
      `${siteUrl}/bidding`,
      `${siteUrl}/watch-list`
    ],
    value_score: 0.8, // High value content behind auth
    premium_schema: {
      // Enhanced schema for authenticated areas
      selectors: {
        detailed_description: '.member-only-description',
        condition_report: '.condition-details',
        bidding_history: '.bid-history',
        reserve_price: '.reserve-info'
      }
    }
  };
}

async function generatePublicExtractionSchema(crawlData: any, siteUrl: string) {
  // Generate extraction schema for public pages only
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) {
    throw new Error('OpenAI API key not configured');
  }
  
  const prompt = `Analyze this auction site's public pages and create extraction schema for vehicle data.

Site: ${siteUrl}
Public pages analyzed: ${JSON.stringify(crawlData.results?.slice(0, 3), null, 2)}

Create extraction schema for public data only:
{
  "selectors": {
    "lot_number": "CSS selector",
    "year": "CSS selector", 
    "make": "CSS selector",
    "model": "CSS selector",
    "estimate": "CSS selector for price estimate",
    "auction_date": "CSS selector",
    "images": "CSS selector for image gallery",
    "basic_description": "CSS selector"
  },
  "auth_required_fields": ["detailed_condition", "bidding_history", "reserve_price"],
  "public_completeness": 0.0-1.0
}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
      temperature: 0.1,
      response_format: { type: "json_object" }
    })
  });
  
  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

async function generateLoginFlow(siteUrl: string) {
  // Generate browser automation steps for login
  return {
    steps: [
      { action: 'navigate', url: `${siteUrl}/login` },
      { action: 'wait_for_element', selector: 'input[name="email"]' },
      { action: 'type', selector: 'input[name="email"]', value: '${EMAIL}' },
      { action: 'type', selector: 'input[name="password"]', value: '${PASSWORD}' },
      { action: 'click', selector: 'button[type="submit"]' },
      { action: 'wait_for_element', selector: '.user-dashboard, .profile, .member-area' }
    ],
    success_url_pattern: '/dashboard|/profile|/member',
    session_cookie_names: ['session', 'auth_token', 'remember_token']
  };
}

function generateAuthRecommendations(config: AuthSiteConfig): string[] {
  const recommendations = [];
  
  // Public-first approach
  if (config.public_areas.length > 0) {
    recommendations.push('✅ Start with public areas - no authentication needed');
    recommendations.push(`📊 Public coverage: ${config.public_areas.length} areas accessible`);
  }
  
  // Authentication strategy
  if (config.auth_method === 'login_form') {
    recommendations.push('🔐 Use browser automation for secure login handling');
    recommendations.push('⚠️ Never store credentials - use session tokens only');
  }
  
  // Value assessment
  if (config.private_areas.length > config.public_areas.length) {
    recommendations.push('💰 Premium content behind auth - consider authentication worth it');
  } else {
    recommendations.push('🎯 Focus on public areas first - most content is accessible');
  }
  
  return recommendations;
}

function generateSessionInstructions(config: any): string[] {
  return [
    '1. Map public areas first (no auth required)',
    '2. Set up browser automation for secure login',
    '3. Use session tokens, never store passwords', 
    '4. Extract authenticated content with temporary sessions',
    '5. Auto-logout after extraction'
  ];
}

// Mock implementations
function calculatePublicCoverage(crawlData: any): number {
  return 0.65; // 65% of content accessible publicly
}

function detectAuthWalls(crawlData: any): string[] {
  return ['member_only_sections', 'bidding_requires_registration'];
}

async function identifySessionIndicators(siteUrl: string) {
  return ['user-dashboard', 'profile-menu', 'logout-link'];
}

async function identifyAuthenticatedAreas(siteUrl: string) {
  return [
    `${siteUrl}/member/lots`,
    `${siteUrl}/bidding/live`,
    `${siteUrl}/condition-reports`
  ];
}
