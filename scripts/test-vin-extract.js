import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const VIN_PATTERNS = [
  /\b([A-HJ-NPR-Z0-9]{17})\b/gi,
];

function validateModernVIN(vin) {
  if (vin.length !== 17) return false;
  const transliteration = {
    A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,
    S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9,
  };
  const weights = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const char = vin[i].toUpperCase();
    const value = /[0-9]/.test(char) ? parseInt(char) : transliteration[char];
    if (value === undefined) return false;
    sum += value * weights[i];
  }
  const check = sum % 11;
  return vin[8].toUpperCase() === (check === 10 ? 'X' : check.toString());
}

async function main() {
  const { data: posts } = await supabase
    .from('build_posts')
    .select('id, content_text, build_thread_id')
    .or('content_text.ilike.*vin:*,content_text.ilike.*vin #*,content_text.ilike.*serial number*')
    .limit(200);

  console.log('Scanning', posts.length, 'posts with VIN mentions...\n');

  const vinsFound = [];

  for (const post of posts) {
    for (const pattern of VIN_PATTERNS) {
      const matches = post.content_text.matchAll(pattern);
      for (const match of matches) {
        const vin = match[1].toUpperCase();
        if (vin.length === 17) {
          const valid = validateModernVIN(vin);
          if (valid) {
            vinsFound.push({ vin, post_id: post.id });
            console.log('Found valid VIN:', vin);
          }
        }
      }
    }
  }

  console.log('\nTotal valid VINs found:', vinsFound.length);
}

main().catch(console.error);
