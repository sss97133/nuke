#!/usr/bin/env npx tsx
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  console.log('🎭 Playwright Queue Processor\n');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
  });
  
  let processed = 0, success = 0;
  
  while (true) {
    const { data: items } = await supabase
      .from('import_queue')
      .select('id, listing_url, attempts')
      .eq('status', 'pending')
      .lt('attempts', 5)
      .limit(20);
    
    if (!items?.length) {
      console.log('No items, waiting 30s...');
      await new Promise(r => setTimeout(r, 30000));
      continue;
    }
    
    for (const item of items) {
      const page = await context.newPage();
      try {
        await supabase.from('import_queue').update({ status: 'processing' }).eq('id', item.id);
        
        await page.goto(item.listing_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        if (page.url().includes('login')) throw new Error('RATE_LIMITED');
        
        const data = await page.evaluate(() => {
          const h1 = document.querySelector('h1');
          const title = h1?.textContent?.trim() || '';
          const match = title.match(/^(\d{4})\s+(.+?)\s+(.+)/);
          const body = document.body.innerText;
          const vin = body.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i)?.[1];
          const price = body.match(/\$\s*([\d,]+)/)?.[1];
          return { title, year: match?.[1], make: match?.[2], model: match?.[3], vin, price: price?.replace(/,/g,'') };
        });
        
        if (data.year || data.vin) {
          const { data: v } = await supabase.from('vehicles')
            .insert({ discovery_url: item.listing_url, year: parseInt(data.year||'0')||null, make: data.make, model: data.model, vin: data.vin?.toUpperCase(), sale_price: parseInt(data.price||'0')||null, title: data.title })
            .select('id').single();
          
          await supabase.from('import_queue').update({ status: 'complete', vehicle_id: v?.id }).eq('id', item.id);
          console.log(`✅ ${data.year} ${data.make} ${data.model}`);
          success++;
        } else {
          throw new Error('No data');
        }
      } catch (e: any) {
        const msg = e.message?.slice(0,100) || String(e);
        if (msg.includes('duplicate')) {
          await supabase.from('import_queue').update({ status: 'complete' }).eq('id', item.id);
        } else if (msg.includes('RATE')) {
          await supabase.from('import_queue').update({ status: 'pending', error_message: msg }).eq('id', item.id);
          console.log('⚠️ Rate limited, pausing 2min');
          await new Promise(r => setTimeout(r, 120000));
        } else {
          await supabase.from('import_queue').update({ 
            status: item.attempts >= 4 ? 'failed' : 'pending', 
            error_message: msg, 
            attempts: item.attempts + 1 
          }).eq('id', item.id);
        }
        console.log(`❌ ${item.listing_url.slice(0,50)}...`);
      } finally {
        await page.close();
      }
      processed++;
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
    }
    console.log(`📊 ${success}/${processed} successful`);
  }
}

main().catch(console.error);
