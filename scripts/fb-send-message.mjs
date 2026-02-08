#!/usr/bin/env node
/**
 * Facebook Marketplace Seller Messaging via Playwright
 *
 * Usage: node fb-send-message.mjs <listing_url> <message_text> <profile_dir>
 *
 * Uses a persistent browser profile so Facebook session stays logged in.
 * First run: manually log in to Facebook in the launched browser,
 * then subsequent runs will reuse the session.
 */

import { chromium } from "playwright";

const [listingUrl, messageText, profileDir] = process.argv.slice(2);

if (!listingUrl || !messageText) {
  console.error("Usage: node fb-send-message.mjs <url> <message> [profile_dir]");
  process.exit(1);
}

const userDataDir = profileDir || `${process.env.HOME}/.fb-playwright-profile`;

async function sendMessage() {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });

  const page = context.pages()[0] || (await context.newPage());

  try {
    // Navigate to the listing
    await page.goto(listingUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    // Check if we're logged in
    const loginForm = await page.$('input[name="email"]');
    if (loginForm) {
      console.error("Not logged in to Facebook. Please log in manually first.");
      // Keep browser open for manual login on first run
      await page.waitForTimeout(120000);
      await context.close();
      console.log(JSON.stringify({ success: false, error: "Not logged in. Session created - please log in manually and retry." }));
      return;
    }

    // Look for the "Message Seller" or "Send Message" or "Message" button
    const messageButton = await page.$(
      [
        'div[aria-label="Message Seller"]',
        'div[aria-label="Send seller a message"]',
        'div[aria-label="Message"]',
        'a[aria-label="Message Seller"]',
        'div[role="button"]:has-text("Message")',
        'span:text("Message Seller")',
        'span:text("Send Message")',
      ].join(", ")
    );

    if (!messageButton) {
      // Try scrolling down to find it
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(1000);

      const retryButton = await page.$(
        'div[role="button"]:has-text("Message"), span:has-text("Message Seller")'
      );

      if (!retryButton) {
        await context.close();
        console.log(JSON.stringify({ success: false, error: "Could not find Message button on page" }));
        return;
      }
      await retryButton.click();
    } else {
      await messageButton.click();
    }

    await page.waitForTimeout(2000);

    // Find the message input area (could be a textarea, contenteditable div, or textbox)
    const messageInput = await page.$(
      [
        'textarea[aria-label*="message" i]',
        'div[contenteditable="true"][aria-label*="message" i]',
        'div[role="textbox"]',
        'textarea',
      ].join(", ")
    );

    if (!messageInput) {
      await context.close();
      console.log(JSON.stringify({ success: false, error: "Could not find message input field" }));
      return;
    }

    // Type the message
    await messageInput.click();
    await page.waitForTimeout(500);
    await messageInput.fill(messageText);
    await page.waitForTimeout(500);

    // Press Enter or click Send
    const sendButton = await page.$(
      'div[aria-label="Send"]:not([aria-disabled="true"]), div[aria-label="Send Message"], button:has-text("Send")'
    );

    if (sendButton) {
      await sendButton.click();
    } else {
      await page.keyboard.press("Enter");
    }

    await page.waitForTimeout(3000);

    await context.close();
    console.log(
      JSON.stringify({
        success: true,
        details: `Message sent to listing: ${listingUrl}`,
      })
    );
  } catch (err) {
    await context.close();
    console.log(
      JSON.stringify({ success: false, error: err.message })
    );
  }
}

sendMessage();
