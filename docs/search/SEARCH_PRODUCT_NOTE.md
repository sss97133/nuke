# Search: What Good Looks Like

**Goal of querying:** Understanding the context on both sides of the action.

1. **What we know about the user** (at the moment they type and hit enter or select something)  
   - Who they are (auth, history, preferences)  
   - Where they are (location when relevant)  
   - What they’re trying to do (intent inferred from query and context)

2. **What information we have**  
   - Corpus: vehicles, orgs, people, parts, events, etc.  
   - Structure and signals we can use for ranking and filtering

Good search uses both sides: user context + corpus context, at the moment of the action, to return **fewer, better results** that feel useful—not slow, goofy, or overwhelming.

**Anti-patterns we’re fixing:**  
- Too much on screen (workstation sections, lanes, dozens of type filters before any result)  
- Requesting 150 results every time (slow, noisy)  
- Not passing user/location to the backend (no personalization or “near me” ranking)  
- Results that feel useless (wrong ranking, no clear intent)

**Direction:**  
- **Less noise:** One clear results block; optional “lanes”/workstation collapsed by default.  
- **Faster first paint:** Smaller initial result set (e.g. 24); “Show more” or type tabs for the rest.  
- **Context-aware:** Send user_id and user_location to the edge function; use for ranking (e.g. “near me”, later “my stuff first”).  
- **Intent:** Show a short summary of what we searched and what we’re showing (e.g. “Vehicles and organizations for ‘porsche 911’”); only show result types that have hits.
