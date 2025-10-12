# 🔑 Get Your Claude API Key

## Quick Setup (2 minutes)

1. **Go to Anthropic Console**
   https://console.anthropic.com/

2. **Sign up or Log in**
   - Create a free account if you don't have one
   - Verify your email

3. **Get Your API Key**
   - Click on "API Keys" in the sidebar
   - Click "Create Key"
   - Name it something like "Nuke Receipt Parser"
   - Copy the key (starts with `sk-ant-api03-`)

4. **Update Your .env File**
   - Open `/Users/skylar/nuke/nuke_frontend/.env`
   - Find the line: `VITE_NUKE_CLAUDE_API=sk-ant-api03-REPLACE-WITH-YOUR-ACTUAL-CLAUDE-KEY`
   - Replace the placeholder with your actual key
   - Save the file

5. **Restart Your Dev Server**
   ```bash
   # Kill the current server (Ctrl+C)
   # Start it again
   npm run dev
   ```

## Current Status

✅ **The app works WITHOUT Claude** - I've added a fallback parser that:
- Extracts prices and items using pattern matching
- Works with pasted text receipts
- Shows lower confidence scores (30% vs 95% with Claude)

⚠️ **For full features you need Claude**:
- Image receipt parsing (photos)
- PDF receipt parsing
- Smart item categorization
- Accurate vendor detection
- High confidence parsing

## Pricing

Claude API is very affordable:
- ~$0.003 per receipt (Haiku model)
- First $5 free with new accounts
- That's ~1,600 receipts free!

## Test Without API Key

The system now works with the fallback parser. Try:
1. Paste receipt text
2. See it parse (with 30% confidence)
3. Items still get saved to database

Once you add your Claude key:
- Confidence jumps to 95%+
- Image uploads work
- Much better accuracy
