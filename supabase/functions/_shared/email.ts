/**
 * Shared Email Utility
 *
 * Send transactional emails via Resend API.
 * Requires RESEND_API_KEY environment variable.
 */

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM_EMAIL = "Nuke <noreply@nuke.dev>";

export interface EmailParams {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}

export async function sendEmail(params: EmailParams): Promise<{ success: boolean; id?: string; error?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("RESEND_API_KEY not set — email not sent:", params.subject);
    return { success: false, error: "Email service not configured" };
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: Array.isArray(params.to) ? params.to : [params.to],
        subject: params.subject,
        html: params.html,
        reply_to: params.replyTo,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("Resend API error:", data);
      return { success: false, error: data.message || "Email send failed" };
    }

    return { success: true, id: data.id };
  } catch (err) {
    console.error("Email send error:", err);
    return { success: false, error: String(err) };
  }
}
