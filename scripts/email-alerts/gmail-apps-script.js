/**
 * NUKE EMAIL ALERT PROCESSOR - Google Apps Script
 *
 * Paste this into script.google.com (logged into your nuke alerts Gmail).
 * It reads unread alert emails, forwards them to the Supabase edge function,
 * and marks them as read. Runs every 5 minutes via a time-based trigger.
 *
 * Setup:
 * 1. Go to https://script.google.com
 * 2. Create a new project, name it "Nuke Alert Processor"
 * 3. Paste this entire file
 * 4. Update WEBHOOK_URL and WEBHOOK_SECRET below
 * 5. Click Run > processAlertEmails (grant permissions when prompted)
 * 6. Click Triggers (clock icon) > Add Trigger:
 *    - Function: processAlertEmails
 *    - Event source: Time-driven
 *    - Type: Minutes timer
 *    - Interval: Every 5 minutes
 * 7. Done. It runs forever for free.
 */

// ─── CONFIG ────────────────────────────────────────────────────────
const WEBHOOK_URL = "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-alert-email";
// Optional: add a secret header so random people can't POST to your function
const WEBHOOK_SECRET = ""; // Set this to a random string, then check it in the edge function if you want
const MAX_EMAILS_PER_RUN = 20; // Don't process too many at once
const LABEL_PROCESSED = "nuke-processed"; // Gmail label for processed emails
// ────────────────────────────────────────────────────────────────────

function processAlertEmails() {
  // Get unread threads from inbox
  const threads = GmailApp.search("is:unread -label:" + LABEL_PROCESSED, 0, MAX_EMAILS_PER_RUN);

  if (threads.length === 0) {
    Logger.log("No new alert emails to process.");
    return;
  }

  Logger.log("Processing " + threads.length + " email thread(s)...");

  // Ensure label exists
  let label = GmailApp.getUserLabelByName(LABEL_PROCESSED);
  if (!label) {
    label = GmailApp.createLabel(LABEL_PROCESSED);
  }

  let processed = 0;
  let errors = 0;

  for (const thread of threads) {
    const messages = thread.getMessages();

    for (const message of messages) {
      if (!message.isUnread()) continue;

      try {
        const payload = {
          from: message.getFrom(),
          to: message.getTo(),
          subject: message.getSubject(),
          html: message.getBody(),        // HTML body
          text: message.getPlainBody(),    // Plain text body
          messageId: message.getId(),
          date: message.getDate().toISOString(),
        };

        const options = {
          method: "post",
          contentType: "application/json",
          payload: JSON.stringify(payload),
          muteHttpExceptions: true,
          headers: {},
        };

        if (WEBHOOK_SECRET) {
          options.headers["x-webhook-secret"] = WEBHOOK_SECRET;
        }

        const response = UrlFetchApp.fetch(WEBHOOK_URL, options);
        const status = response.getResponseCode();
        const result = JSON.parse(response.getContentText());

        Logger.log(
          "Email from " + message.getFrom() +
          " | Subject: " + message.getSubject().substring(0, 60) +
          " | Status: " + status +
          " | URLs found: " + (result.urls_found || 0) +
          " | Queued: " + (result.queued || 0)
        );

        processed++;
      } catch (e) {
        Logger.log("Error processing email: " + e.message);
        errors++;
      }

      // Mark as read regardless
      message.markRead();
    }

    // Label the thread so we don't re-process
    thread.addLabel(label);
  }

  Logger.log("Done. Processed: " + processed + ", Errors: " + errors);
}

/**
 * Manual test function - processes one email and logs the result.
 * Run this first to verify everything works.
 */
function testProcessOneEmail() {
  const threads = GmailApp.search("is:unread", 0, 1);
  if (threads.length === 0) {
    Logger.log("No unread emails to test with.");
    return;
  }

  const message = threads[0].getMessages()[0];
  Logger.log("Testing with email from: " + message.getFrom());
  Logger.log("Subject: " + message.getSubject());

  const payload = {
    from: message.getFrom(),
    to: message.getTo(),
    subject: message.getSubject(),
    html: message.getBody(),
    text: message.getPlainBody(),
    messageId: message.getId(),
    date: message.getDate().toISOString(),
  };

  Logger.log("Payload size: " + JSON.stringify(payload).length + " bytes");

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(WEBHOOK_URL, options);
  Logger.log("Response status: " + response.getResponseCode());
  Logger.log("Response body: " + response.getContentText());
}

/**
 * Reprocess all emails with a specific label (for backfilling).
 * Change SEARCH_QUERY to target specific emails.
 */
function reprocessEmails() {
  const SEARCH_QUERY = "label:" + LABEL_PROCESSED; // Change this to target specific emails
  const threads = GmailApp.search(SEARCH_QUERY, 0, 50);

  Logger.log("Reprocessing " + threads.length + " threads...");

  for (const thread of threads) {
    for (const message of thread.getMessages()) {
      try {
        const payload = {
          from: message.getFrom(),
          to: message.getTo(),
          subject: message.getSubject(),
          html: message.getBody(),
          text: message.getPlainBody(),
          messageId: message.getId(),
          date: message.getDate().toISOString(),
        };

        UrlFetchApp.fetch(WEBHOOK_URL, {
          method: "post",
          contentType: "application/json",
          payload: JSON.stringify(payload),
          muteHttpExceptions: true,
        });
      } catch (e) {
        Logger.log("Error: " + e.message);
      }
    }
  }

  Logger.log("Reprocessing complete.");
}
