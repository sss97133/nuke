/**
 * Send Inquiry Notification Email
 *
 * Called after a vehicle inquiry is submitted via the storefront.
 * Sends an email to the business owner with the inquiry details.
 *
 * Expects: { inquiry_id } or { vehicle_id, organization_id, name, email, phone, message }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { sendEmail } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { inquiry_id, vehicle_id, organization_id, name, email, phone, message } = body;

    let inquiryData = { vehicle_id, organization_id, name, email, phone, message };

    // If inquiry_id provided, fetch from DB
    if (inquiry_id) {
      const { data: inquiry } = await supabase
        .from("vehicle_interaction_requests")
        .select("*")
        .eq("id", inquiry_id)
        .maybeSingle();

      if (!inquiry) {
        return new Response(JSON.stringify({ error: "Inquiry not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      inquiryData = {
        vehicle_id: inquiry.vehicle_id,
        organization_id: inquiry.organization_id,
        name: inquiry.name || inquiry.contact_name,
        email: inquiry.email || inquiry.contact_email,
        phone: inquiry.phone || inquiry.contact_phone,
        message: inquiry.message || inquiry.notes,
      };
    }

    // Get vehicle info
    const { data: vehicle } = await supabase
      .from("vehicles")
      .select("year, make, model, trim, vin")
      .eq("id", inquiryData.vehicle_id)
      .maybeSingle();

    const vehicleName = vehicle
      ? [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ")
      : "Unknown Vehicle";

    // Get business owner email
    const { data: org } = await supabase
      .from("businesses")
      .select("business_name, email, owner_id")
      .eq("id", inquiryData.organization_id)
      .maybeSingle();

    if (!org) {
      return new Response(JSON.stringify({ error: "Organization not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find the owner's email
    let ownerEmail = org.email;
    if (!ownerEmail && org.owner_id) {
      const { data: { user } } = await supabase.auth.admin.getUserById(org.owner_id);
      ownerEmail = user?.email;
    }

    if (!ownerEmail) {
      return new Response(JSON.stringify({ error: "No owner email found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send email
    const result = await sendEmail({
      to: ownerEmail,
      subject: `New Inquiry: ${vehicleName}`,
      replyTo: inquiryData.email || undefined,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
          <h2 style="margin-bottom: 4px;">New Vehicle Inquiry</h2>
          <p style="color: #666; margin-top: 0;">Someone is interested in a vehicle on your storefront.</p>

          <div style="background: #f9f9f9; border: 1px solid #e5e5e5; padding: 16px; margin: 16px 0;">
            <strong style="font-size: 16px;">${vehicleName}</strong>
            ${vehicle?.vin ? `<br><span style="color: #888; font-size: 12px;">VIN: ${vehicle.vin}</span>` : ""}
          </div>

          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr><td style="padding: 6px 0; color: #888; width: 80px;">Name</td><td style="padding: 6px 0;">${inquiryData.name || "Not provided"}</td></tr>
            <tr><td style="padding: 6px 0; color: #888;">Email</td><td style="padding: 6px 0;"><a href="mailto:${inquiryData.email}">${inquiryData.email || "Not provided"}</a></td></tr>
            ${inquiryData.phone ? `<tr><td style="padding: 6px 0; color: #888;">Phone</td><td style="padding: 6px 0;"><a href="tel:${inquiryData.phone}">${inquiryData.phone}</a></td></tr>` : ""}
          </table>

          ${inquiryData.message ? `
          <div style="margin-top: 16px;">
            <strong>Message:</strong>
            <p style="background: #f9f9f9; padding: 12px; border-left: 3px solid #333; margin: 8px 0;">${inquiryData.message}</p>
          </div>
          ` : ""}

          <p style="color: #888; font-size: 12px; margin-top: 24px;">
            — Nuke Platform<br>
            <a href="https://nuke.dev">nuke.dev</a>
          </p>
        </div>
      `,
    });

    return new Response(JSON.stringify({ success: result.success, email_id: result.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Inquiry notification error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
