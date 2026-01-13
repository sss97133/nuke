/**
 * Extract Instagram profiles from Mendable ingested pages
 * 
 * Usage:
 *   node scripts/extract-instagram-from-mendable.js
 */

import dotenv from "dotenv";
dotenv.config();

const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "").trim();

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  process.exit(1);
}

async function callMendableProxy(body) {
  const url = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/query-mendable-v2`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${supabaseAnonKey}`,
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return await res.json();
}

async function extractInstagramProfiles() {
  console.log("Step 1: Getting list of all sources from Mendable...\n");
  
  // Get all sources
  const sourcesResp = await callMendableProxy({ action: "getSources" });
  const sources = sourcesResp?.result ?? sourcesResp?.data ?? sourcesResp;
  const sourceList = Array.isArray(sources) ? sources : sources?.sources || sources?.data || [];
  
  console.log(`Found ${sourceList.length} total sources indexed in Mendable\n`);

  // Create a new conversation for our queries
  const convResp = await callMendableProxy({ action: "newConversation" });
  const conversationId = convResp?.conversation_id || convResp?.result?.conversation_id;

  console.log("Step 2: Querying Mendable for Instagram profiles...\n");

  const queries = [
    "Extract all Instagram profile URLs (instagram.com/username) from all ingested pages. List each unique Instagram username and the full URL.",
    "Find all Instagram handles, usernames, or @ mentions in the ingested content. Include any social media links.",
    "Search for Instagram accounts mentioned in seller profiles, dealer websites, or organization pages. Extract the Instagram username and profile URL.",
    "Find any Instagram links, Instagram handles, or Instagram profile URLs in vehicle listings, auction pages, or seller information.",
  ];

  const allProfiles = new Set();
  const profileSources = new Map();

  for (let i = 0; i < queries.length; i++) {
    console.log(`Query ${i + 1}/${queries.length}: ${queries[i].substring(0, 60)}...`);
    
    try {
      const chatResp = await callMendableProxy({
        question: queries[i],
        conversation_id: conversationId,
        history: [],
        shouldStream: false,
        num_chunks: 10,
      });

      if (chatResp?.success && chatResp?.answer) {
        const answer = chatResp.answer;
        
        // Extract Instagram URLs and usernames from the answer
        const instagramUrlRegex = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)/gi;
        const instagramHandleRegex = /@([a-zA-Z0-9._]+)/gi;
        
        let match;
        while ((match = instagramUrlRegex.exec(answer)) !== null) {
          const username = match[1].toLowerCase();
          allProfiles.add(username);
          if (!profileSources.has(username)) {
            profileSources.set(username, []);
          }
        }
        
        while ((match = instagramHandleRegex.exec(answer)) !== null) {
          const username = match[1].toLowerCase();
          allProfiles.add(username);
          if (!profileSources.has(username)) {
            profileSources.set(username, []);
          }
        }

        // Also check sources from the response
        const sourcesOut = chatResp?.result?.sources ?? chatResp?.result?.data?.sources ?? [];
        if (Array.isArray(sourcesOut)) {
          sourcesOut.forEach((source) => {
            const url = source?.source || source?.url || source?.href || source?.document_url || "";
            if (url) {
              const urlMatch = url.match(/instagram\.com\/([a-zA-Z0-9._]+)/i);
              if (urlMatch) {
                const username = urlMatch[1].toLowerCase();
                allProfiles.add(username);
                if (!profileSources.has(username)) {
                  profileSources.set(username, []);
                }
                profileSources.get(username).push(url);
              }
            }
          });
        }

        console.log(`  Found ${allProfiles.size} unique Instagram profiles so far\n`);
      }
    } catch (err) {
      console.error(`  Error in query ${i + 1}:`, err.message);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`FINAL RESULTS: Found ${allProfiles.size} unique Instagram profiles\n`);

  if (allProfiles.size === 0) {
    console.log("No Instagram profiles found in the ingested pages.");
    console.log("This could mean:");
    console.log("  1. The ingested pages don't contain Instagram links");
    console.log("  2. The pages need to be re-ingested with Instagram content");
    console.log("  3. The search queries need to be more specific");
    return;
  }

  // Output structured results
  const profiles = Array.from(allProfiles).sort();
  
  console.log("Instagram Profiles Found:\n");
  profiles.forEach((username, index) => {
    console.log(`${index + 1}. @${username}`);
    console.log(`   URL: https://www.instagram.com/${username}/`);
    const sources = profileSources.get(username) || [];
    if (sources.length > 0) {
      console.log(`   Found in ${sources.length} source(s)`);
      sources.slice(0, 3).forEach((url) => {
        console.log(`     - ${url}`);
      });
    }
    console.log("");
  });

  // Output as JSON for programmatic use
  const output = {
    total_profiles: allProfiles.size,
    profiles: profiles.map((username) => ({
      username,
      handle: `@${username}`,
      url: `https://www.instagram.com/${username}/`,
      sources: profileSources.get(username) || [],
    })),
  };

  console.log("\n" + "=".repeat(60));
  console.log("JSON Output (for programmatic use):\n");
  console.log(JSON.stringify(output, null, 2));
}

extractInstagramProfiles().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
