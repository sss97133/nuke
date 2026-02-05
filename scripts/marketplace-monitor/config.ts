// Facebook Marketplace Monitor - INDUSTRIAL SCALE (5-10k/day target)
// Only vehicles older than 1992 (year ≤ 1991).

// 150+ US markets for maximum coverage
export const MARKETPLACE_URLS = [
  // === WEST COAST ===
  'https://www.facebook.com/marketplace/seattle/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/tacoma/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/spokane/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/portland/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/eugene/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/salem/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/sanfrancisco/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/oakland/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/sanjose/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/sacramento/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/fresno/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/stockton/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/modesto/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/la/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/sandiego/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/longbeach/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/riverside/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/bakersfield/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/anaheim/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/santaana/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/irvine/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/oxnard/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/santabarbara/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/ventura/vehicles?sortBy=creation_time_descend',

  // === SOUTHWEST ===
  'https://www.facebook.com/marketplace/lasvegas/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/henderson/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/reno/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/phoenix/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/mesa/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/scottsdale/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/tucson/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/albuquerque/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/santafe/vehicles?sortBy=creation_time_descend',

  // === MOUNTAIN ===
  'https://www.facebook.com/marketplace/denver/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/coloradosprings/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/aurora/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/boulder/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/fortcollins/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/saltlakecity/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/provo/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/boise/vehicles?sortBy=creation_time_descend',

  // === TEXAS ===
  'https://www.facebook.com/marketplace/dallas/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/fortworth/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/arlington/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/plano/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/houston/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/austin/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/sanantonio/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/elpaso/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/corpuschristi/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/lubbock/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/amarillo/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/waco/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/mcallen/vehicles?sortBy=creation_time_descend',

  // === MIDWEST ===
  'https://www.facebook.com/marketplace/chicago/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/aurora-il/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/rockford/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/springfield-il/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/detroit/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/grandrapids/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/annarbor/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/lansing/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/minneapolis/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/stpaul/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/rochester-mn/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/stlouis/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/kansascity/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/springfield-mo/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/indianapolis/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/fortwayne/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/columbus/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/cleveland/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/cincinnati/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/toledo/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/akron/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/milwaukee/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/madison/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/greenbay/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/omaha/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/lincoln/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/desmoines/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/wichita/vehicles?sortBy=creation_time_descend',

  // === SOUTH ===
  'https://www.facebook.com/marketplace/atlanta/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/augusta/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/savannah/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/miami/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/fortlauderdale/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/westpalmbeach/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/tampa/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/stpetersburg/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/orlando/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/jacksonville/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/tallahassee/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/pensacola/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/charlotte/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/raleigh/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/greensboro/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/wilmington-nc/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/charleston/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/columbia-sc/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/nashville/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/memphis/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/knoxville/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/chattanooga/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/neworleans/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/batonrouge/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/shreveport/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/birmingham/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/huntsville/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/mobile/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/montgomery/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/jackson-ms/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/littlerock/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/louisville/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/lexington/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/virginiabeach/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/norfolk/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/richmond/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/oklahomacity/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/tulsa/vehicles?sortBy=creation_time_descend',

  // === NORTHEAST ===
  'https://www.facebook.com/marketplace/nyc/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/longisland/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/westchester/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/albany/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/buffalo/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/rochester/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/syracuse/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/boston/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/worcester/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/springfield-ma/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/philadelphia/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/pittsburgh/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/allentown/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/harrisburg/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/baltimore/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/dc/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/newjersey/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/newark/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/jerseycity/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/hartford/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/newhaven/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/providence/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/manchester-nh/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/portland-me/vehicles?sortBy=creation_time_descend',
  'https://www.facebook.com/marketplace/burlington-vt/vehicles?sortBy=creation_time_descend',
];

// No keyword searches - direct browsing is more efficient
export const SEARCH_QUERIES: string[] = [];

// Search radius in miles
export const SEARCH_RADIUS_MILES = 100;

// How often to run searches (in minutes) - faster cycling
export const SEARCH_INTERVAL_MINUTES = 15;

// Your location
export const LOCATION = {
  city: 'Las Vegas',
  state: 'NV',
};

// Price filters
export const PRICE_MIN = 500;
export const PRICE_MAX = 250000;

// Year filter - classic cars only
export const YEAR_MAX = 1991;

// Notification settings
export const NOTIFICATIONS = {
  sms: false,
  smsNumber: '+17022106857',
  supabase: true,
  console: true,
};

// Browser settings
export const BROWSER = {
  headless: true,
  slowMo: 50, // Faster
  userDataDir: process.env.FB_SESSION_DIR || './fb-session',
};
