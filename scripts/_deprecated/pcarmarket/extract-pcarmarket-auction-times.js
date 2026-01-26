#!/usr/bin/env node
/**
 * EXTRACT PCARMARKET AUCTION TIME PARAMETERS
 * 
 * Extracts all time-related data from PCarMarket auction pages:
 * - Auction start date/time
 * - Auction end date/time
 * - Current time
 * - Time remaining (countdown)
 * - Time since start
 * - Timezone information
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

// Try to import Playwright
let playwright = null;
try {
  playwright = await import('playwright');
} catch (e) {
  console.warn('⚠️  Playwright not available - install with: npm install playwright');
}

/**
 * Calculate time parameters from auction dates
 */
function calculateTimeParameters(startDate, endDate, currentDate = new Date()) {
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;
  const now = new Date(currentDate);
  
  const params = {
    auction_start_date: start ? start.toISOString() : null,
    auction_end_date: end ? end.toISOString() : null,
    current_time: now.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    
    // Status
    is_active: false,
    is_ended: false,
    is_upcoming: false,
    
    // Time calculations
    time_remaining_seconds: null,
    time_remaining_minutes: null,
    time_remaining_hours: null,
    time_remaining_days: null,
    time_remaining_formatted: null,
    
    time_since_start_seconds: null,
    time_since_start_minutes: null,
    time_since_start_hours: null,
    time_since_start_days: null,
    time_since_start_formatted: null,
    
    // Duration
    total_duration_seconds: null,
    total_duration_days: null,
    
    // Countdown details
    countdown: {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      total_seconds: 0,
      is_expired: false
    }
  };
  
  if (end) {
    const remainingMs = end.getTime() - now.getTime();
    const remainingSeconds = Math.floor(remainingMs / 1000);
    
    params.time_remaining_seconds = remainingSeconds;
    params.time_remaining_minutes = Math.floor(remainingSeconds / 60);
    params.time_remaining_hours = Math.floor(remainingSeconds / 3600);
    params.time_remaining_days = Math.floor(remainingSeconds / 86400);
    
    // Format: "X days, Y hours, Z minutes"
    const days = Math.floor(remainingSeconds / 86400);
    const hours = Math.floor((remainingSeconds % 86400) / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    const seconds = remainingSeconds % 60;
    
    if (remainingSeconds > 0) {
      const parts = [];
      if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
      if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
      if (minutes > 0 && days === 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
      if (seconds > 0 && days === 0 && hours === 0) parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);
      params.time_remaining_formatted = parts.join(', ') || 'Less than a minute';
    } else {
      params.time_remaining_formatted = 'Ended';
    }
    
    // Countdown object
    params.countdown = {
      days,
      hours,
      minutes,
      seconds,
      total_seconds: remainingSeconds,
      is_expired: remainingSeconds <= 0
    };
    
    params.is_ended = remainingSeconds <= 0;
    params.is_active = remainingSeconds > 0 && (!start || now >= start);
    params.is_upcoming = start && now < start;
  }
  
  if (start) {
    const sinceStartMs = now.getTime() - start.getTime();
    const sinceStartSeconds = Math.floor(sinceStartMs / 1000);
    
    params.time_since_start_seconds = sinceStartSeconds;
    params.time_since_start_minutes = Math.floor(sinceStartSeconds / 60);
    params.time_since_start_hours = Math.floor(sinceStartSeconds / 3600);
    params.time_since_start_days = Math.floor(sinceStartSeconds / 86400);
    
    // Format: "X days, Y hours"
    const days = Math.floor(sinceStartSeconds / 86400);
    const hours = Math.floor((sinceStartSeconds % 86400) / 3600);
    const parts = [];
    if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
    if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
    params.time_since_start_formatted = parts.join(', ') || 'Just started';
  }
  
  if (start && end) {
    const durationMs = end.getTime() - start.getTime();
    params.total_duration_seconds = Math.floor(durationMs / 1000);
    params.total_duration_days = Math.floor(durationMs / (1000 * 60 * 60 * 24));
  }
  
  return params;
}

/**
 * Extract auction dates from PCarMarket page
 */
async function extractAuctionDates(url) {
  console.log(`\n🔍 Extracting auction time data from: ${url}\n`);
  
  let html = '';
  let page = null;
  let browser = null;
  
  try {
    if (playwright) {
      console.log('   🌐 Using Playwright for full page rendering...');
      browser = await playwright.chromium.launch({ headless: true });
      page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(3000);
      html = await page.content();
    } else {
      // Fallback: Direct fetch
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
      });
      html = await response.text();
    }
    
    const dates = {
      start_date: null,
      end_date: null,
      sale_date: null,
      extracted_at: new Date().toISOString()
    };
    
    // Extract from page using Playwright if available
    if (page) {
      const pageDates = await page.evaluate(() => {
        const dates = {
          start: null,
          end: null,
          sale: null
        };
        
        // Look for date elements
        const dateElements = document.querySelectorAll('[class*="date"], [class*="time"], [class*="end"], [class*="start"], [class*="sold"]');
        dateElements.forEach(el => {
          const text = el.textContent?.toLowerCase() || '';
          
          // Look for "Ends", "Ending", "Ended"
          if (text.includes('end') || text.includes('clos')) {
            // Try to extract date
            const dateMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
            const timeMatch = text.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
            if (dateMatch) {
              dates.end = `${dateMatch[3]}-${dateMatch[1].padStart(2, '0')}-${dateMatch[2].padStart(2, '0')}`;
            }
          }
          
          // Look for "Started", "Starts"
          if (text.includes('start')) {
            const dateMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
            if (dateMatch) {
              dates.start = `${dateMatch[3]}-${dateMatch[1].padStart(2, '0')}-${dateMatch[2].padStart(2, '0')}`;
            }
          }
          
          // Look for "Sold"
          if (text.includes('sold')) {
            const dateMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
            if (dateMatch) {
              dates.sale = `${dateMatch[3]}-${dateMatch[1].padStart(2, '0')}-${dateMatch[2].padStart(2, '0')}`;
            }
          }
        });
        
        // Look for countdown timers and time displays
        const timeElements = document.querySelectorAll('[class*="countdown"], [class*="timer"], [class*="time"], [class*="end"], [id*="countdown"], [id*="timer"]');
        timeElements.forEach(el => {
          const text = el.textContent || '';
          const innerHTML = el.innerHTML || '';
          
          // Look for countdown format: "X days, Y hours, Z minutes"
          const daysMatch = text.match(/(\d+)\s*d(?:ay|ays)?/i);
          const hoursMatch = text.match(/(\d+)\s*h(?:our|ours)?/i);
          const minutesMatch = text.match(/(\d+)\s*m(?:in|inute|inutes)?/i);
          const secondsMatch = text.match(/(\d+)\s*s(?:ec|econd|econds)?/i);
          
          if (daysMatch || hoursMatch || minutesMatch || secondsMatch) {
            const now = new Date();
            let endTime = new Date(now);
            if (daysMatch) endTime.setDate(endTime.getDate() + parseInt(daysMatch[1]));
            if (hoursMatch) endTime.setHours(endTime.getHours() + parseInt(hoursMatch[1]));
            if (minutesMatch) endTime.setMinutes(endTime.getMinutes() + parseInt(minutesMatch[1]));
            if (secondsMatch) endTime.setSeconds(endTime.getSeconds() + parseInt(secondsMatch[1]));
            dates.end = endTime.toISOString();
          }
          
          // Look for ISO date strings
          const isoMatch = text.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
          if (isoMatch) {
            dates.end = new Date(isoMatch[1]).toISOString();
          }
          
          // Look for timestamp (milliseconds)
          const timestampMatch = text.match(/(\d{13})/);
          if (timestampMatch) {
            dates.end = new Date(parseInt(timestampMatch[1])).toISOString();
          }
        });
        
        // Look for data attributes with timestamps
        const dataTimeElements = document.querySelectorAll('[data-end], [data-end-time], [data-end-date], [data-auction-end], [data-timestamp]');
        dataTimeElements.forEach(el => {
          const endTime = el.getAttribute('data-end') || 
                         el.getAttribute('data-end-time') || 
                         el.getAttribute('data-end-date') ||
                         el.getAttribute('data-auction-end') ||
                         el.getAttribute('data-timestamp');
          if (endTime) {
            try {
              const parsed = new Date(endTime);
              if (!isNaN(parsed.getTime())) {
                dates.end = parsed.toISOString();
              }
            } catch (e) {
              // Ignore
            }
          }
        });
        
        // Look in script tags for JSON data with dates
        const scripts = document.querySelectorAll('script[type="application/json"], script:not([src])');
        scripts.forEach(script => {
          try {
            const json = JSON.parse(script.textContent || '{}');
            // Recursively search for date fields
            const findDate = (obj) => {
              if (typeof obj !== 'object' || obj === null) return;
              for (const [key, value] of Object.entries(obj)) {
                if (key.toLowerCase().includes('end') || key.toLowerCase().includes('date') || key.toLowerCase().includes('time')) {
                  if (typeof value === 'string' && value.match(/\d{4}-\d{2}-\d{2}/)) {
                    try {
                      const parsed = new Date(value);
                      if (!isNaN(parsed.getTime())) {
                        dates.end = parsed.toISOString();
                      }
                    } catch (e) {}
                  }
                }
                if (typeof value === 'object') findDate(value);
              }
            };
            findDate(json);
          } catch (e) {
            // Not JSON, ignore
          }
        });
        
        // Look for data attributes
        const dataEnd = document.querySelector('[data-end-date], [data-end-time], [data-auction-end]');
        if (dataEnd) {
          dates.end = dataEnd.getAttribute('data-end-date') || 
                     dataEnd.getAttribute('data-end-time') || 
                     dataEnd.getAttribute('data-auction-end');
        }
        
        return dates;
      });
      
      dates.start_date = pageDates.start;
      dates.end_date = pageDates.end;
      dates.sale_date = pageDates.sale;
    }
    
    // Also try regex extraction from HTML
    if (!dates.end_date) {
      // Also try regex extraction from HTML
      if (!dates.end_date) {
        // Look for date patterns in HTML (use global regex for matchAll)
        const patterns = [
          /ending\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/gi,
          /ends\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/gi,
          /(\d{1,2})\/(\d{1,2})\/(\d{4})/g,
          /(\d{4})-(\d{2})-(\d{2})/g
        ];
        
        for (const pattern of patterns) {
          const matches = Array.from(html.matchAll(pattern));
          for (const match of matches) {
            // Try to parse the date
            let dateStr = match[0];
            try {
              const parsed = new Date(dateStr);
              if (parsed && !isNaN(parsed.getTime())) {
                if (!dates.end_date) {
                  dates.end_date = parsed.toISOString();
                  break;
                }
              }
            } catch (e) {
              // Ignore
            }
          }
          if (dates.end_date) break;
        }
      }
    }
    
    if (browser) {
      await browser.close();
    }
    
    return dates;
    
  } catch (error) {
    if (browser) {
      await browser.close();
    }
    console.error('   ❌ Error extracting dates:', error.message);
    return { start_date: null, end_date: null, sale_date: null, extracted_at: new Date().toISOString() };
  }
}

/**
 * Update vehicle with time parameters
 */
async function updateVehicleTimes(vehicleId, timeParams) {
  console.log('\n📝 Updating vehicle with time parameters...\n');
  
  // Update vehicle record
  const updates = {
    auction_end_date: timeParams.auction_end_date || null,
    updated_at: new Date().toISOString()
  };
  
  // Update origin_metadata with all time parameters
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('origin_metadata')
    .eq('id', vehicleId)
    .single();
  
  const existingMetadata = vehicle?.origin_metadata || {};
  const updatedMetadata = {
    ...existingMetadata,
    auction_times: {
      auction_start_date: timeParams.auction_start_date,
      auction_end_date: timeParams.auction_end_date,
      current_time: timeParams.current_time,
      timezone: timeParams.timezone,
      is_active: timeParams.is_active,
      is_ended: timeParams.is_ended,
      is_upcoming: timeParams.is_upcoming,
      time_remaining_seconds: timeParams.time_remaining_seconds,
      time_remaining_formatted: timeParams.time_remaining_formatted,
      time_since_start_formatted: timeParams.time_since_start_formatted,
      total_duration_days: timeParams.total_duration_days,
      countdown: timeParams.countdown,
      calculated_at: new Date().toISOString()
    }
  };
  
  updates.origin_metadata = updatedMetadata;
  
  const { error } = await supabase
    .from('vehicles')
    .update(updates)
    .eq('id', vehicleId);
  
  if (error) {
    console.error('   ❌ Error updating vehicle:', error.message);
    return false;
  }
  
  console.log('   ✅ Vehicle updated with time parameters');
  return true;
}

// Main
async function main() {
  const url = process.argv[2];
  const vehicleId = process.argv[3];
  
  if (!url) {
    console.log('Usage: node scripts/extract-pcarmarket-auction-times.js <auction_url> [vehicle_id]');
    console.log('\nExample:');
    console.log('  node scripts/extract-pcarmarket-auction-times.js https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2 e92537b2-4ee6-4a84-9c30-ebe7d2afb4f8');
    process.exit(1);
  }
  
  // Extract dates
  const dates = await extractAuctionDates(url);
  
  console.log('\n📅 Extracted Dates:');
  console.log(`   Start Date: ${dates.start_date || 'Not found'}`);
  console.log(`   End Date: ${dates.end_date || 'Not found'}`);
  console.log(`   Sale Date: ${dates.sale_date || 'Not found'}`);
  
  // Calculate time parameters
  const timeParams = calculateTimeParameters(dates.start_date, dates.end_date);
  
  console.log('\n⏰ Time Parameters:');
  console.log(`   Current Time: ${timeParams.current_time}`);
  console.log(`   Timezone: ${timeParams.timezone}`);
  console.log(`   Status: ${timeParams.is_active ? 'Active' : timeParams.is_ended ? 'Ended' : timeParams.is_upcoming ? 'Upcoming' : 'Unknown'}`);
  console.log(`   Time Remaining: ${timeParams.time_remaining_formatted || 'N/A'}`);
  console.log(`   Time Since Start: ${timeParams.time_since_start_formatted || 'N/A'}`);
  console.log(`   Total Duration: ${timeParams.total_duration_days ? timeParams.total_duration_days + ' days' : 'N/A'}`);
  
  console.log('\n⏱️  Countdown:');
  console.log(`   Days: ${timeParams.countdown.days}`);
  console.log(`   Hours: ${timeParams.countdown.hours}`);
  console.log(`   Minutes: ${timeParams.countdown.minutes}`);
  console.log(`   Seconds: ${timeParams.countdown.seconds}`);
  console.log(`   Total Seconds: ${timeParams.countdown.total_seconds}`);
  console.log(`   Expired: ${timeParams.countdown.is_expired ? 'Yes' : 'No'}`);
  
  // Update vehicle if ID provided
  if (vehicleId) {
    await updateVehicleTimes(vehicleId, timeParams);
  } else {
    console.log('\n💡 To update vehicle, provide vehicle_id:');
    console.log(`   node scripts/extract-pcarmarket-auction-times.js ${url} <vehicle_id>`);
  }
  
  console.log('\n✅ Extraction complete!\n');
}

main();

