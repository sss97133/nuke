# REAL-TIME BACKFILL TRACKING

## Quick Check (Run This Anytime)

```bash
cd /Users/skylar/nuke && node -e "
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
const env = dotenv.parse(fs.readFileSync('.env.local'));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY);

const { count: processed } = await sb.from('vehicle_images').select('*', { count: 'exact', head: true }).not('ai_last_scanned', 'is', null).not('vehicle_id', 'is', null);
const { count: total } = await sb.from('vehicle_images').select('*', { count: 'exact', head: true }).not('vehicle_id', 'is', null);

console.log('');
console.log('════════════════════════════════════════════');
console.log('  IMAGE BACKFILL PROGRESS');
console.log('════════════════════════════════════════════');
console.log('');
console.log('  Processed:  ' + processed + ' / ' + total);
console.log('  Remaining:  ' + (total - processed));
console.log('  Percent:    ' + (processed / total * 100).toFixed(1) + '%');
console.log('');
console.log('════════════════════════════════════════════');
console.log('');
"
```

---

## Watch Log File

```bash
tail -f /Users/skylar/nuke/context-backfill.log
```

Shows each image being processed with context score.

---

## Count Lines in Log

```bash
# How many images processed
grep -c "Context:" /Users/skylar/nuke/context-backfill.log

# Last 10 processed
tail -20 /Users/skylar/nuke/context-backfill.log
```

---

## Auto-Refresh Progress (Loop)

```bash
while true; do
  clear
  echo "🔄 BACKFILL PROGRESS (refreshing every 5s)"
  echo ""
  cd /Users/skylar/nuke && node -e "
    import { createClient } from '@supabase/supabase-js';
    import dotenv from 'dotenv';
    import fs from 'fs';
    const env = dotenv.parse(fs.readFileSync('.env.local'));
    const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY);
    const { count: p } = await sb.from('vehicle_images').select('*', { count: 'exact', head: true }).not('ai_last_scanned', 'is', null).not('vehicle_id', 'is', null);
    const { count: t } = await sb.from('vehicle_images').select('*', { count: 'exact', head: true }).not('vehicle_id', 'is', null);
    console.log('Processed: ' + p + ' / ' + t + ' (' + (p/t*100).toFixed(1) + '%)');
    console.log('Remaining: ' + (t-p));
  "
  echo ""
  echo "$(date '+%H:%M:%S')"
  sleep 5
done
```

---

## Is It Still Running?

```bash
ps aux | grep context-driven-processor | grep -v grep
```

If you see output → it's running  
If empty → it finished or crashed

---

## Check Last Error (If Any)

```bash
tail -100 /Users/skylar/nuke/context-backfill.log | grep -i error
```

---

## SIMPLEST TRACKER (Copy & Run)

```bash
cd /Users/skylar/nuke

# One-line progress check
node -e "import {createClient} from '@supabase/supabase-js';import dotenv from 'dotenv';import fs from 'fs';const e=dotenv.parse(fs.readFileSync('.env.local'));const s=createClient(e.VITE_SUPABASE_URL,e.VITE_SUPABASE_SERVICE_ROLE_KEY||e.SUPABASE_SERVICE_ROLE_KEY);const {count:p}=await s.from('vehicle_images').select('*',{count:'exact',head:true}).not('ai_last_scanned','is',null).not('vehicle_id','is',null);const {count:t}=await s.from('vehicle_images').select('*',{count:'exact',head:true}).not('vehicle_id','is',null);console.log('Progress: '+p+'/'+t+' ('+(p/t*100).toFixed(1)+'%) | Remaining: '+(t-p));"
```

Run that anytime to see current progress!

