/**
 * SMS Verification Intake - Handle verification submissions via text
 *
 * Users text:
 * - Photo of ID → identity verification
 * - Photo of title → ownership verification
 * - "claim [platform] [username]" → platform identity claim
 * - "verify" → get instructions
 *
 * POST /functions/v1/sms-verification-intake
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Parse Twilio form data
async function parseFormData(req: Request): Promise<Record<string, string>> {
  const formData = await req.formData();
  const data: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    data[key] = value.toString();
  }
  return data;
}

// TwiML response
function twiml(message: string): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>${message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</Message></Response>`;
  return new Response(xml, { headers: { "Content-Type": "text/xml" } });
}

// Get or create user by phone
async function getUserByPhone(phone: string): Promise<{ id: string } | null> {
  const normalized = phone.replace(/^\+/, "");

  // Check profiles for phone match
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("phone_number", normalized)
    .single();

  return profile;
}

// Detect verification type from message/media
function detectVerificationType(body: string, hasMedia: boolean): string {
  const lower = body.toLowerCase();

  if (lower.startsWith("claim ") || lower.includes("bat ") || lower.includes("my username")) {
    return "platform_claim";
  }
  if (lower.includes("title") || lower.includes("registration")) {
    return "title";
  }
  if (lower.includes("id") || lower.includes("license") || lower.includes("selfie")) {
    return "identity";
  }
  if (hasMedia) {
    // Default: photo with no context is likely ID or title
    return "identity";
  }
  return "unknown";
}

// Parse platform claim from message
function parsePlatformClaim(body: string): { platform: string; handle: string } | null {
  const lower = body.toLowerCase();

  // "claim bat username123" or "my bat username is xyz"
  const claimMatch = body.match(/claim\s+(bat|cars?\s*(?:and|&)\s*bids?|pcarmarket|hagerty)\s+(\S+)/i);
  if (claimMatch) {
    const platformMap: Record<string, string> = {
      bat: "bat",
      "carsandbids": "cars_and_bids",
      "cars and bids": "cars_and_bids",
      "cars&bids": "cars_and_bids",
      pcarmarket: "pcarmarket",
      hagerty: "hagerty",
    };
    const rawPlatform = claimMatch[1].toLowerCase().replace(/\s+/g, "");
    return {
      platform: platformMap[rawPlatform] || "bat",
      handle: claimMatch[2],
    };
  }

  // "I'm xyz on bat" or "my bat handle is xyz"
  const handleMatch = body.match(/(?:i'?m|my\s+(?:username|handle)\s+(?:is|on))\s+(\S+)\s+(?:on\s+)?(bat|bringatrailer)/i);
  if (handleMatch) {
    return { platform: "bat", handle: handleMatch[1] };
  }

  return null;
}

// Try local verification server first, AI as fallback
async function analyzeVerificationPhoto(
  mediaUrls: string[],
  messageBody: string,
  verificationType: string
): Promise<{
  documentType: string;
  extractedName: string | null;
  extractedAddress: string | null;
  extractedVin: string | null;
  confidence: number;
  isValid: boolean;
  issues: string[];
}> {
  // Try local server first (free, fast, no API dependency)
  const localServerUrl = Deno.env.get("LOCAL_VERIFICATION_URL") || "http://localhost:8765";

  try {
    console.log("[Verification] Trying local server...");

    // Download image and send to local server
    const imageResponse = await fetch(mediaUrls[0]);
    const imageBlob = await imageResponse.blob();

    const formData = new FormData();
    formData.append("file", imageBlob, "document.jpg");

    const localResponse = await fetch(`${localServerUrl}/verify`, {
      method: "POST",
      body: formData,
    });

    if (localResponse.ok) {
      const result = await localResponse.json();
      console.log("[Verification] Local server success:", result);

      // If local confidence is good enough, use it
      if (result.confidence >= 0.6) {
        return {
          documentType: result.document_type,
          extractedName: result.extracted?.name || null,
          extractedAddress: result.extracted?.address || null,
          extractedVin: result.extracted?.vin || null,
          confidence: result.confidence,
          isValid: result.confidence >= 0.7,
          issues: result.issues || [],
        };
      }
      console.log("[Verification] Local confidence low, trying AI fallback...");
    }
  } catch (e) {
    console.log("[Verification] Local server unavailable, using AI fallback");
  }

  // AI fallback (costs money, but more accurate)
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    return {
      documentType: "unknown",
      extractedName: null,
      extractedAddress: null,
      extractedVin: null,
      confidence: 0,
      isValid: false,
      issues: ["No verification service available"],
    };
  }

  const prompts: Record<string, string> = {
    identity: `Analyze this document photo for identity verification.
Extract:
1. Document type (drivers_license, passport, state_id, other)
2. Full name as shown
3. Address if visible
4. Is the document clear and readable?

Return JSON:
{
  "documentType": "drivers_license",
  "extractedName": "John Smith",
  "extractedAddress": "123 Main St, City, ST 12345",
  "confidence": 0.95,
  "isValid": true,
  "issues": []
}`,
    title: `Analyze this vehicle title document.
Extract:
1. Owner name(s)
2. VIN (17 characters)
3. Vehicle year/make/model if visible
4. Is the title clear and complete?

Return JSON:
{
  "documentType": "title",
  "extractedName": "John Smith",
  "extractedVin": "1G1YY22G965109876",
  "confidence": 0.90,
  "isValid": true,
  "issues": []
}`,
  };

  const prompt = prompts[verificationType] || prompts.identity;

  try {
    console.log("[Verification] Using AI fallback...");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "url", url: mediaUrls[0] } },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });

    const result = await response.json();
    const text = result.content?.[0]?.text || "{}";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("AI analysis failed:", e);
  }

  return {
    documentType: "unknown",
    extractedName: null,
    extractedAddress: null,
    extractedVin: null,
    confidence: 0.3,
    isValid: false,
    issues: ["Could not analyze document"],
  };
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const data = await parseFormData(req);
    const fromPhone = data.From;
    const messageBody = data.Body || "";
    const messageSid = data.MessageSid;
    const numMedia = parseInt(data.NumMedia || "0", 10);

    // Extract media URLs
    const mediaUrls: string[] = [];
    for (let i = 0; i < numMedia; i++) {
      const url = data[`MediaUrl${i}`];
      if (url) mediaUrls.push(url);
    }

    console.log(`Verification SMS from ${fromPhone}: "${messageBody}" with ${numMedia} media`);

    // Get user
    const user = await getUserByPhone(fromPhone);

    // Handle "verify" command - send instructions
    if (messageBody.toLowerCase().trim() === "verify") {
      return twiml(
        `To verify your identity:\n` +
        `- Text a photo of your ID\n` +
        `- Text a photo of your vehicle title\n` +
        `- Text "claim bat [username]" to claim your BaT account\n\n` +
        `We'll verify and you're in.`
      );
    }

    // Detect type
    const verificationType = detectVerificationType(messageBody, numMedia > 0);

    if (verificationType === "unknown" && numMedia === 0) {
      return twiml(
        `Send a photo or text "verify" for instructions.`
      );
    }

    // Handle platform claim (text-only)
    if (verificationType === "platform_claim") {
      const claim = parsePlatformClaim(messageBody);
      if (!claim) {
        return twiml(
          `To claim your account, text:\n"claim bat yourusername"\n\nReplace 'bat' with your platform and 'yourusername' with your handle.`
        );
      }

      // Create submission
      const { data: submission, error } = await supabase
        .from("sms_verification_submissions")
        .insert({
          from_phone: fromPhone.replace(/^\+/, ""),
          user_id: user?.id,
          message_sid: messageSid,
          verification_type: "platform_claim",
          message_body: messageBody,
          extracted_platform: claim.platform,
          extracted_handle: claim.handle,
          status: "processing",
        })
        .select()
        .single();

      if (error) throw error;

      // Process immediately (low confidence since no proof)
      await supabase
        .from("sms_verification_submissions")
        .update({
          ai_processed_at: new Date().toISOString(),
          ai_confidence: 0.2,
          ai_result: { detected_proof_method: "self_claim" },
        })
        .eq("id", submission.id);

      await supabase.rpc("process_verification_submission", {
        p_submission_id: submission.id,
      });

      return twiml(
        `Claim started for ${claim.handle} on ${claim.platform.toUpperCase()}.\n\n` +
        `To boost confidence:\n` +
        `- Add "NZERO-${submission.id.slice(0, 8).toUpperCase()}" to your profile bio\n` +
        `- Or text a screenshot of your logged-in profile`
      );
    }

    // Handle photo submissions
    if (numMedia > 0) {
      // Create submission
      const { data: submission, error } = await supabase
        .from("sms_verification_submissions")
        .insert({
          from_phone: fromPhone.replace(/^\+/, ""),
          user_id: user?.id,
          message_sid: messageSid,
          verification_type: verificationType,
          media_urls: mediaUrls,
          message_body: messageBody,
          status: "processing",
        })
        .select()
        .single();

      if (error) throw error;

      // Analyze with AI
      const analysis = await analyzeVerificationPhoto(mediaUrls, messageBody, verificationType);

      // Update with analysis
      await supabase
        .from("sms_verification_submissions")
        .update({
          ai_processed_at: new Date().toISOString(),
          ai_result: analysis,
          ai_confidence: analysis.confidence,
          extracted_name: analysis.extractedName,
          extracted_address: analysis.extractedAddress,
          extracted_vin: analysis.extractedVin,
          status: analysis.isValid ? "processing" : "needs_more",
        })
        .eq("id", submission.id);

      // If valid, route to appropriate table
      if (analysis.isValid && analysis.confidence >= 0.7) {
        await supabase.rpc("process_verification_submission", {
          p_submission_id: submission.id,
        });

        if (verificationType === "identity") {
          return twiml(
            `Got it! ID verified for ${analysis.extractedName || "you"}.\n` +
            `Confidence: ${Math.round(analysis.confidence * 100)}%`
          );
        } else if (verificationType === "title") {
          return twiml(
            `Title received! VIN: ${analysis.extractedVin || "detected"}\n` +
            `Owner: ${analysis.extractedName || "detected"}\n` +
            `We'll link this to your account.`
          );
        }
      }

      // Need better photo or more info
      if (analysis.issues.length > 0) {
        return twiml(
          `I couldn't read that clearly. ${analysis.issues[0]}\n\nCan you try again with better lighting?`
        );
      }

      return twiml(
        `Photo received. We'll review and get back to you shortly.`
      );
    }

    // Fallback
    return twiml(`Text "verify" for verification options.`);

  } catch (error) {
    console.error("Verification intake error:", error);
    return twiml("Something went wrong. Try again?");
  }
});
