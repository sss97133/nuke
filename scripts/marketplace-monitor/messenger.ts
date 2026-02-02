#!/usr/bin/env npx tsx

/**
 * Facebook Marketplace Auto-Messenger
 *
 * Takes listings from Supabase and messages sellers asking for VIN.
 * Uses Ollama (local LLM) to handle follow-up conversations.
 */

import { chromium, BrowserContext, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Ollama endpoint (local)
const OLLAMA_URL = 'http://localhost:11434/api/generate';

const INITIAL_MESSAGE = `Hey! Love this listing. Do you happen to have the VIN? I'm trying to pull the history report before coming to check it out. Thanks!`;

const SYSTEM_PROMPT = `You are a friendly car buyer. You're interested in classic cars and trucks. Your goal is to get the VIN number from the seller. Be casual, friendly, and brief. If they give you the VIN, say thanks and that you'll check the history and get back to them. If they ask questions, answer briefly and steer back to getting the VIN. Never be pushy. Max 2 sentences per response.`;

interface Conversation {
  listing_id: string;
  facebook_id: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  status: 'pending' | 'messaged' | 'replied' | 'got_vin' | 'dead';
  vin?: string;
}

class Messenger {
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async initialize(): Promise<void> {
    // Use same session as monitor - Brave browser
    this.context = await chromium.launchPersistentContext(
      './fb-session',
      {
        headless: false,
        slowMo: 150,
        viewport: { width: 1280, height: 800 },
        executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        args: [
          '--disable-blink-features=AutomationControlled',
        ],
      }
    );
    this.page = await this.context.newPage();
  }

  async sendInitialMessage(listingUrl: string): Promise<boolean> {
    if (!this.page) return false;

    try {
      await this.page.goto(listingUrl, { waitUntil: 'domcontentloaded' });
      await this.sleep(2000);

      // Click "Message" or "Send Message" button
      const messageBtn = await this.page.$('text=Message')
        || await this.page.$('text=Send Message')
        || await this.page.$('[aria-label*="Message"]');

      if (!messageBtn) {
        console.log('Could not find message button');
        return false;
      }

      await messageBtn.click();
      await this.sleep(2000);

      // Type the message
      const textbox = await this.page.$('[role="textbox"]')
        || await this.page.$('textarea');

      if (!textbox) {
        console.log('Could not find textbox');
        return false;
      }

      await textbox.fill(INITIAL_MESSAGE);
      await this.sleep(500);

      // Send
      await this.page.keyboard.press('Enter');
      await this.sleep(1000);

      console.log(`✅ Sent message for listing`);
      return true;

    } catch (error) {
      console.error('Error sending message:', error);
      return false;
    }
  }

  async askOllama(messages: Array<{ role: string; content: string }>): Promise<string> {
    try {
      const prompt = messages.map(m =>
        m.role === 'user' ? `Seller: ${m.content}` : `You: ${m.content}`
      ).join('\n');

      const response = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3.2',
          prompt: `${SYSTEM_PROMPT}\n\nConversation so far:\n${prompt}\n\nYour response (max 2 sentences):`,
          stream: false,
        }),
      });

      const data = await response.json();
      return data.response?.trim() || "Thanks for getting back to me! Any chance you have the VIN handy?";

    } catch (error) {
      console.error('Ollama error:', error);
      return "Thanks! Do you happen to have the VIN number?";
    }
  }

  extractVin(text: string): string | null {
    // VIN is 17 alphanumeric characters (no I, O, Q)
    const vinRegex = /\b[A-HJ-NPR-Z0-9]{17}\b/gi;
    const match = text.match(vinRegex);
    return match ? match[0].toUpperCase() : null;
  }

  async processUnmessaged(): Promise<void> {
    // Get listings we haven't messaged yet
    const { data: listings } = await supabase
      .from('marketplace_listings')
      .select('*')
      .is('messaged_at', null)
      .order('scraped_at', { ascending: false })
      .limit(10);

    if (!listings?.length) {
      console.log('No new listings to message');
      return;
    }

    for (const listing of listings) {
      console.log(`📤 Messaging seller for: ${listing.title}`);

      const success = await this.sendInitialMessage(listing.url);

      if (success) {
        await supabase
          .from('marketplace_listings')
          .update({ messaged_at: new Date().toISOString() })
          .eq('id', listing.id);
      }

      // Human-like delay between messages
      await this.sleep(30000 + Math.random() * 60000); // 30-90 seconds
    }
  }

  async close(): Promise<void> {
    if (this.context) await this.context.close();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run
const messenger = new Messenger();

async function main() {
  await messenger.initialize();
  await messenger.processUnmessaged();
  await messenger.close();
}

main().catch(console.error);
