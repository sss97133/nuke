// Facebook Marketplace Monitor - INDUSTRIAL SCALE
// Cautious & consistent: only vehicles older than 1992 (year ≤ 1991).

// Every major US market - classic vehicles (1991 and older only)
export const MARKETPLACE_URLS = [
  // WEST COAST
  'https://www.facebook.com/marketplace/seattle/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/portland/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/sanfrancisco/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/oakland/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/sanjose/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/sacramento/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/fresno/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/la/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/sandiego/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/longbeach/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/riverside/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/bakersfield/vehicles?maxYear=1991&exact=false',

  // SOUTHWEST
  'https://www.facebook.com/marketplace/lasvegas/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/phoenix/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/tucson/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/albuquerque/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/denver/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/saltlakecity/vehicles?maxYear=1991&exact=false',

  // TEXAS
  'https://www.facebook.com/marketplace/dallas/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/houston/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/austin/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/sanantonio/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/elpaso/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/fortworth/vehicles?maxYear=1991&exact=false',

  // MIDWEST
  'https://www.facebook.com/marketplace/chicago/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/detroit/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/minneapolis/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/stlouis/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/kansascity/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/indianapolis/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/columbus/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/cleveland/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/milwaukee/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/omaha/vehicles?maxYear=1991&exact=false',

  // SOUTH
  'https://www.facebook.com/marketplace/atlanta/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/miami/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/tampa/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/orlando/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/jacksonville/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/charlotte/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/nashville/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/memphis/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/neworleans/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/birmingham/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/louisville/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/raleigh/vehicles?maxYear=1991&exact=false',

  // NORTHEAST
  'https://www.facebook.com/marketplace/nyc/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/boston/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/philadelphia/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/pittsburgh/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/baltimore/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/dc/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/newjersey/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/hartford/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/providence/vehicles?maxYear=1991&exact=false',
  'https://www.facebook.com/marketplace/buffalo/vehicles?maxYear=1991&exact=false',
];

// No keyword searches needed - direct category browsing is better
export const SEARCH_QUERIES: string[] = [];

// Search radius in miles
export const SEARCH_RADIUS_MILES = 500;

// How often to run searches (in minutes)
export const SEARCH_INTERVAL_MINUTES = 30;

// Your location (for Marketplace search)
export const LOCATION = {
  city: 'Las Vegas',
  state: 'NV',
  // You can also use lat/lng if needed
};

// Price filters
export const PRICE_MIN = 1000;  // Skip junk
export const PRICE_MAX = 250000; // Skip supercars you don't care about

// Year filter - classic cars only (cautious & consistent: older than 1992)
export const YEAR_MAX = 1991; // Only cars 1991 and older

// Notification settings
export const NOTIFICATIONS = {
  // Send text via Twilio (if configured)
  sms: true,
  smsNumber: '+17022106857', // Your number

  // Send to Supabase for dashboard
  supabase: true,

  // Log to console
  console: true,
};

// Browser settings
export const BROWSER = {
  headless: true, // Headless for overnight running
  slowMo: 100, // Milliseconds between actions (human-like)
  userDataDir: './fb-session', // Persistent login storage
};
