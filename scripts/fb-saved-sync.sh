#!/bin/bash
# Facebook Saved Vehicles → Nuke Sync
#
# Two-phase extraction:
#   Phase 1: AppleScript runs JS in Chrome to extract saved vehicle data from DOM
#   Phase 2: curl POSTs the extracted JSON to Nuke's batch endpoint
#
# Facebook's CSP blocks cross-origin fetch from their pages, so the POST
# must happen outside the browser.
#
# Requirements:
#   - Chrome open and logged into Facebook
#   - Chrome → View → Developer → Allow JavaScript from Apple Events (✓)
#
# Schedule: LaunchAgent runs every 30 min (com.nuke.fb-saved-sync.plist)
# Usage: ./scripts/fb-saved-sync.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/fb-saved-sync.log"
ENDPOINT="https://qkgaybvrernstplzjaam.supabase.co/functions/v1/extract-facebook-marketplace"

mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"; }

log "=== Starting FB Saved Sync ==="

# Check if Chrome is running
if ! pgrep -q "Google Chrome"; then
  log "SKIP: Chrome not running"
  exit 0
fi

# ── Phase 1: Extract from Chrome DOM ─────────────────────────────────────────
# The JS scrolls facebook.com/saved, parses marketplace item cards, and returns
# a JSON array of vehicles. No cross-origin fetch — just DOM reading.

EXTRACTED_JSON=$(osascript 2>>"$LOG_FILE" <<'APPLESCRIPT'
on run
  tell application "Google Chrome"
    -- Find facebook.com/saved tab
    set foundTab to missing value
    repeat with w in windows
      repeat with t in tabs of w
        if URL of t contains "facebook.com/saved" then
          set foundTab to t
          exit repeat
        end if
      end repeat
      if foundTab is not missing value then exit repeat
    end repeat

    -- If no saved tab, find any FB tab and navigate
    if foundTab is missing value then
      repeat with w in windows
        repeat with t in tabs of w
          if URL of t contains "facebook.com" then
            set foundTab to t
            set URL of t to "https://www.facebook.com/saved"
            delay 6
            exit repeat
          end if
        end repeat
        if foundTab is not missing value then exit repeat
      end repeat
    end if

    -- No FB tabs at all — skip silently
    if foundTab is missing value then
      return "{\"vehicles\":[]}"
    end if

    -- Auto-scroll to load all saved items
    execute foundTab javascript "
      (async () => {
        let sc = 0, last = 0;
        for (let i = 0; i < 40; i++) {
          window.scrollTo(0, document.body.scrollHeight);
          await new Promise(r => setTimeout(r, 1500));
          const c = document.querySelectorAll('a[href*=\"/marketplace/item/\"]').length;
          if (c === last) { sc++; if (sc >= 3) break; } else sc = 0;
          last = c;
        }
        return 'scrolled';
      })();
    "
    delay 2

    -- Extract vehicle data from DOM
    set jsResult to execute foundTab javascript "
      (() => {
        const MM = {chevy:'Chevrolet',chevrolet:'Chevrolet',ford:'Ford',dodge:'Dodge',
          jeep:'Jeep',toyota:'Toyota',nissan:'Nissan',honda:'Honda',gmc:'GMC',ram:'RAM',
          bmw:'BMW',porsche:'Porsche',mercedes:'Mercedes-Benz',volkswagen:'Volkswagen',
          vw:'Volkswagen',volvo:'Volvo',cadillac:'Cadillac',lincoln:'Lincoln',buick:'Buick',
          pontiac:'Pontiac',oldsmobile:'Oldsmobile',chrysler:'Chrysler',plymouth:'Plymouth',
          mercury:'Mercury',amc:'AMC',studebaker:'Studebaker',datsun:'Datsun',
          international:'International',willys:'Willys',shelby:'Shelby',ih:'International',
          subaru:'Subaru',mazda:'Mazda',jaguar:'Jaguar',fiat:'FIAT',ferrari:'Ferrari',
          triumph:'Triumph',mg:'MG'};
        const MI = {corvette:'Chevrolet',camaro:'Chevrolet',chevelle:'Chevrolet',
          nova:'Chevrolet',impala:'Chevrolet',blazer:'Chevrolet',c10:'Chevrolet',
          k10:'Chevrolet',k5:'Chevrolet',mustang:'Ford',bronco:'Ford',f100:'Ford',
          charger:'Dodge',challenger:'Dodge',firebird:'Pontiac',gto:'Pontiac',
          scout:'International Harvester'};
        function pt(t){
          if(!t)return{year:null,make:null,model:null};
          const c=t.replace(/[\\u00b7\\u2022\\u2014\\u2013|]/g,' ').replace(/\\s+/g,' ').trim();
          const ym=c.match(/\\b(19[2-9]\\d|20[0-2]\\d)\\b/);
          if(!ym)return{year:null,make:null,model:null};
          const yr=parseInt(ym[1],10);
          const a=c.split(String(yr))[1]?.trim()||'';
          const w=a.split(/\\s+/).filter(Boolean);
          if(!w.length)return{year:yr,make:null,model:null};
          const r=w[0].toLowerCase();
          let mk=MM[r]||null;
          if(mk)w.shift();
          if(!mk){const rem=a.toLowerCase();for(const[k,v]of Object.entries(MI)){if(rem.includes(k)){mk=v;break;}}}
          if(!mk&&w.length>0){mk=w.shift();mk=mk[0].toUpperCase()+mk.slice(1).toLowerCase();}
          const md=w.slice(0,3).join(' ').replace(/[,$].*/,'').trim()||null;
          return{year:yr,make:mk,model:md};
        }
        const links=document.querySelectorAll('a[href*=\"/marketplace/item/\"]');
        const seen=new Set(),vs=[];
        const NV=[/sailboat/i,/camper/i,/trailer/i,/forklift/i,/shelving/i,/steel beam/i,/lumber/i];
        for(const l of links){
          const m=l.href.match(/\\/marketplace\\/item\\/(\\d+)/);
          if(!m)continue;
          const fid=m[1];if(seen.has(fid))continue;seen.add(fid);
          let card=l;for(let i=0;i<3;i++)if(card.parentElement)card=card.parentElement;
          const lines=(card.innerText||'').split('\\n').map(x=>x.trim()).filter(Boolean);
          if(lines.length<2)continue;
          const title=lines[0];
          if(NV.some(r=>r.test(title)))continue;
          let price=null,seller=null,sold=false;
          const meta=lines[1];
          const pm=meta.match(/\\$(\\d[\\d,]*)/);
          if(pm)price=parseInt(pm[1].replace(/,/g,''),10);
          const parts=meta.split(/\\s*[\\u00b7\\u2022]\\s*/);
          if(parts.length>=3)seller=parts[2].replace(/\\s*Sold\\s*$/,'').trim()||null;
          sold=/\\bSold\\b/i.test(meta);
          const p=pt(title);
          if(!p.year)continue;
          vs.push({facebook_id:fid,title:title,year:p.year,price:price,
            seller:seller,sold:sold,parsed_make:p.make,parsed_model:p.model});
        }
        return JSON.stringify({vehicles:vs,total:vs.length});
      })();
    "
    return jsResult
  end tell
end run
APPLESCRIPT
)

if [ -z "$EXTRACTED_JSON" ] || [ "$EXTRACTED_JSON" = '{"vehicles":[]}' ]; then
  log "No vehicles extracted (no FB tab or empty saved list)"
  log "=== FB Saved Sync complete (nothing to sync) ==="
  exit 0
fi

# Parse count
VEHICLE_COUNT=$(echo "$EXTRACTED_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('total',0))" 2>/dev/null || echo "0")
log "Extracted $VEHICLE_COUNT vehicles from Chrome"

if [ "$VEHICLE_COUNT" = "0" ]; then
  log "=== FB Saved Sync complete (0 vehicles) ==="
  exit 0
fi

# ── Phase 2: POST to Nuke ────────────────────────────────────────────────────
# Build the batch payload and curl it to the edge function

BATCH_PAYLOAD=$(python3 -c "
import sys, json
data = json.loads('''$EXTRACTED_JSON''')
payload = {
    'mode': 'batch',
    'source': 'facebook_saved',
    'batch': data['vehicles']
}
print(json.dumps(payload))
" 2>/dev/null)

if [ -z "$BATCH_PAYLOAD" ]; then
  log "ERROR: Failed to build batch payload"
  exit 1
fi

RESPONSE=$(curl -s -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "$BATCH_PAYLOAD" \
  --max-time 30 2>>"$LOG_FILE")

log "Response: $RESPONSE"
log "=== FB Saved Sync complete ==="
