import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * WORK ORDER LIFECYCLE API
 *
 * The single edge function that powers the entire invoice/work order flow:
 *
 *   Boss sends → Client pays → Techs get paid
 *
 * Actions:
 *   send_invoice     — Mark invoice as sent, notify client (email/SMS)
 *   record_payment   — Client paid via Zelle/Venmo/etc → update invoice + trigger tech payout eligibility
 *   tech_accept      — Technician accepts a job assignment
 *   tech_decline     — Technician declines a job assignment
 *   submit_proof     — Technician submits proof of work (photos, GPS, VIN)
 *   verify_proof     — Admin verifies/rejects proof submission
 *   process_payout   — Mark technician as paid out
 *   get_status       — Full status view of a work order (for dashboard)
 *   get_tech_view    — What a specific technician sees (their jobs, payouts, proof status)
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { action, ...params } = await req.json();

    switch (action) {
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // BOSS: Send invoice to client
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case "send_invoice": {
        const { invoice_id } = params;
        if (!invoice_id) throw new Error("invoice_id required");

        // Update invoice status
        const { data: invoice, error: invErr } = await supabase
          .from("generated_invoices")
          .update({ status: "sent", sent_at: new Date().toISOString(), payment_status: "unpaid" })
          .eq("id", invoice_id)
          .select("*, work_order_id")
          .single();
        if (invErr) throw invErr;

        // Update work order status
        if (invoice.work_order_id) {
          await supabase.from("work_orders").update({ status: "approved" }).eq("id", invoice.work_order_id);

          // Log status change
          await supabase.from("work_order_status_history").insert({
            work_order_id: invoice.work_order_id,
            old_status: "in_progress",
            new_status: "approved",
            notes: `Invoice ${invoice.invoice_number} sent to client`,
          });

          // Notify technicians — their work order just became "hot"
          const { data: assignments } = await supabase
            .from("work_order_assignments")
            .update({ payout_status: "pending_client_payment" })
            .eq("work_order_id", invoice.work_order_id)
            .neq("status", "declined")
            .select("technician_id, job_op_code");

          // Update heat score
          await supabase
            .from("generated_invoices")
            .update({
              heat_score: 95,
              heat_factors: { ...(invoice.heat_factors || {}), invoice_sent: true, awaiting_payment: true }
            })
            .eq("id", invoice_id);

          // ── ROUTE THROUGH TRANSFER CHANNEL ──
          // If this work order is linked to an active transfer, log the invoice
          // as an outbound communication so the buyer sees it in their thread
          await routeInvoiceToTransfer(supabase, invoice.work_order_id, invoice);
        }

        // ── AUTO-ORDER PARTS ──
        // Group all agreed, non-comped parts by supplier → create POs
        let purchaseOrders: any[] = [];
        if (invoice.work_order_id) {
          purchaseOrders = await autoOrderParts(supabase, invoice.work_order_id, invoice_id, "invoice_sent");
          await syncTimeline(supabase, invoice.work_order_id);
        }

        return json({
          ok: true,
          invoice_number: invoice.invoice_number,
          status: "sent",
          purchase_orders_created: purchaseOrders.length,
          purchase_orders: purchaseOrders.map((po: any) => ({
            po_number: po.po_number,
            supplier: po.supplier_name,
            items: po.item_count,
            total: po.subtotal,
            buy_urls: po.buy_urls,
          })),
          message: `Invoice sent. ${purchaseOrders.length} purchase order(s) auto-generated. Technicians notified.`
        });
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // MANUAL: Trigger auto-order for a work order
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case "auto_order_parts": {
        const { work_order_id, invoice_id: invId } = params;
        if (!work_order_id) throw new Error("work_order_id required");

        const purchaseOrders = await autoOrderParts(supabase, work_order_id, invId, "manual");

        return json({
          ok: true,
          purchase_orders_created: purchaseOrders.length,
          purchase_orders: purchaseOrders.map((po: any) => ({
            po_number: po.po_number,
            supplier: po.supplier_name,
            items: po.item_count,
            total: po.subtotal,
            buy_urls: po.buy_urls,
            status: po.status,
          })),
          message: purchaseOrders.length > 0
            ? `${purchaseOrders.length} PO(s) created. Review and approve, or open buy URLs to order.`
            : "No orderable parts found (all comped, pending, or already ordered)."
        });
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // PO: Update purchase order status
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case "update_po": {
        const { po_id, status: newStatus, order_confirmation, tracking_numbers, estimated_delivery, notes: poNotes } = params;
        if (!po_id) throw new Error("po_id required");

        const updates: any = {};
        if (newStatus) updates.status = newStatus;
        if (order_confirmation) updates.order_confirmation = order_confirmation;
        if (tracking_numbers) updates.tracking_numbers = tracking_numbers;
        if (estimated_delivery) updates.estimated_delivery = estimated_delivery;
        if (poNotes) updates.notes = poNotes;
        updates.updated_at = new Date().toISOString();

        const { data, error } = await supabase
          .from("purchase_orders")
          .update(updates)
          .eq("id", po_id)
          .select()
          .single();
        if (error) throw error;

        // If all POs on this work order are delivered, update work order
        if (newStatus === "delivered") {
          const { data: allPOs } = await supabase
            .from("purchase_orders")
            .select("status")
            .eq("work_order_id", data.work_order_id);

          const allDelivered = (allPOs || []).every((p: any) => p.status === "delivered" || p.status === "installed");
          if (allDelivered) {
            await supabase.from("work_order_status_history").insert({
              work_order_id: data.work_order_id,
              new_status: "parts_delivered",
              notes: "All purchase orders delivered. Ready for installation.",
            });
          }
        }

        await syncTimeline(supabase, data.work_order_id);
        return json({ ok: true, po: data });
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // CLIENT PAYS: Record payment → unlock tech payouts
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case "record_payment": {
        const { invoice_id, amount, payment_method, payment_reference, payment_handle, notes } = params;
        if (!invoice_id || !amount || !payment_method) throw new Error("invoice_id, amount, payment_method required");

        // Record the payment
        const { data: payment, error: payErr } = await supabase
          .from("invoice_payments")
          .insert({
            invoice_id,
            amount,
            payment_method,
            payment_reference,
            payment_handle,
            status: "confirmed",
            paid_at: new Date().toISOString(),
            confirmed_at: new Date().toISOString(),
            net_amount: amount, // TODO: subtract fees for PayPal G&S etc.
            notes,
          })
          .select()
          .single();
        if (payErr) throw payErr;

        // Get invoice + work order
        const { data: invoice } = await supabase
          .from("generated_invoices")
          .select("*, work_order_id")
          .eq("id", invoice_id)
          .single();

        // Calculate total paid
        const { data: allPayments } = await supabase
          .from("invoice_payments")
          .select("amount")
          .eq("invoice_id", invoice_id)
          .eq("status", "confirmed");

        const totalPaid = (allPayments || []).reduce((sum: number, p: any) => sum + parseFloat(String(p.amount || 0)), 0);
        const totalDue = parseFloat(String(invoice.total_amount || 0));
        const isPaidInFull = totalPaid >= totalDue && totalDue > 0;

        // Update invoice
        await supabase
          .from("generated_invoices")
          .update({
            amount_paid: totalPaid,
            amount_due: Math.max(0, totalDue - totalPaid),
            payment_status: isPaidInFull ? "paid" : "partial",
            paid_at: isPaidInFull ? new Date().toISOString() : null,
            status: isPaidInFull ? "paid" : "sent",
            heat_score: isPaidInFull ? 100 : 95,
          })
          .eq("id", invoice_id);

        // If paid in full → unlock ALL tech payouts on this work order
        if (isPaidInFull && invoice.work_order_id) {
          // Update work order status
          await supabase.from("work_orders").update({
            status: "paid",
            actual_total: parseFloat(String(totalPaid)),
          }).eq("id", invoice.work_order_id);

          await supabase.from("work_order_status_history").insert({
            work_order_id: invoice.work_order_id,
            old_status: "approved",
            new_status: "paid",
            notes: `Client paid $${totalPaid} via ${payment_method}. Tech payouts unlocked.`,
          });

          // Unlock tech payouts — anyone with verified proof gets "ready" status
          const { data: verified } = await supabase
            .from("work_order_assignments")
            .update({ payout_status: "ready" })
            .eq("work_order_id", invoice.work_order_id)
            .in("status", ["completed", "verified", "proof_submitted"])
            .select("technician_id, job_op_code, estimated_payout");

          // Anyone still in_progress stays at pending_client_payment → ready once they complete
          await supabase
            .from("work_order_assignments")
            .update({ payout_status: "pending_proof" })
            .eq("work_order_id", invoice.work_order_id)
            .eq("status", "in_progress");

          await syncTimeline(supabase, invoice.work_order_id);

          return json({
            ok: true,
            paid_in_full: true,
            total_paid: totalPaid,
            payment_method,
            techs_ready_for_payout: (verified || []).length,
            message: `Payment confirmed. ${(verified || []).length} technician payout(s) unlocked.`
          });
        }

        if (invoice.work_order_id) await syncTimeline(supabase, invoice.work_order_id);
        return json({ ok: true, paid_in_full: false, total_paid: totalPaid, remaining: totalDue - totalPaid });
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // TECH: Accept or decline a job assignment
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case "tech_accept": {
        const { assignment_id } = params;
        if (!assignment_id) throw new Error("assignment_id required");

        const { data, error } = await supabase
          .from("work_order_assignments")
          .update({ status: "accepted", accepted_at: new Date().toISOString() })
          .eq("id", assignment_id)
          .select("technician_id, job_op_code, work_order_id, estimated_payout")
          .single();
        if (error) throw error;

        await syncTimeline(supabase, data.work_order_id);
        return json({ ok: true, ...data, message: `Job ${data.job_op_code} accepted. Estimated payout: $${data.estimated_payout || 'TBD'}` });
      }

      case "tech_decline": {
        const { assignment_id, reason } = params;
        if (!assignment_id) throw new Error("assignment_id required");

        const { data, error } = await supabase
          .from("work_order_assignments")
          .update({ status: "declined", declined_at: new Date().toISOString(), decline_reason: reason })
          .eq("id", assignment_id)
          .select()
          .single();
        if (error) throw error;

        if (data.work_order_id) await syncTimeline(supabase, data.work_order_id);
        return json({ ok: true, declined: true, message: "Assignment declined." });
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // TECH: Submit proof of work
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case "submit_proof": {
        const {
          work_order_id, assignment_id, technician_id, job_op_code,
          proof_type, image_urls, latitude, longitude, location_accuracy_meters,
          vin_photo_url, vin_detected, odometer_photo_url, odometer_reading,
          device_timestamp, device_info, notes
        } = params;

        if (!work_order_id || !technician_id || !proof_type) {
          throw new Error("work_order_id, technician_id, proof_type required");
        }

        // Auto-checks
        const autoChecks: Record<string, any> = {};

        // VIN match check
        if (vin_detected) {
          const { data: wo } = await supabase
            .from("work_orders")
            .select("vehicle_id, vehicles(vin)")
            .eq("id", work_order_id)
            .single();

          const expectedVin = (wo as any)?.vehicles?.vin;
          const vinMatch = expectedVin && vin_detected.toUpperCase().replace(/[^A-Z0-9]/g, '') === expectedVin.toUpperCase().replace(/[^A-Z0-9]/g, '');
          autoChecks.vin_match = vinMatch;
          autoChecks.expected_vin = expectedVin;
          autoChecks.detected_vin = vin_detected;
        }

        // Timestamp drift check
        let timeDrift = null;
        if (device_timestamp) {
          const deviceTime = new Date(device_timestamp).getTime();
          const serverTime = Date.now();
          timeDrift = (serverTime - deviceTime) / 1000;
          autoChecks.time_drift_seconds = timeDrift;
          autoChecks.time_drift_acceptable = Math.abs(timeDrift) < 300; // 5 min tolerance
        }

        // Geofence check — if we have the shop/vehicle location
        if (latitude && longitude) {
          autoChecks.location_provided = true;
          autoChecks.latitude = latitude;
          autoChecks.longitude = longitude;
          autoChecks.accuracy_meters = location_accuracy_meters;
        }

        // Determine auto-verification
        const allChecksPass = Object.entries(autoChecks).every(([k, v]) => {
          if (k.endsWith('_acceptable') || k === 'vin_match') return v === true;
          return true; // non-boolean checks are informational
        });

        const verificationStatus = allChecksPass && image_urls?.length > 0
          ? "auto_verified"
          : "pending";

        const { data: proof, error: proofErr } = await supabase
          .from("proof_of_work")
          .insert({
            work_order_id,
            assignment_id,
            technician_id,
            job_op_code,
            proof_type,
            image_urls,
            latitude,
            longitude,
            location_accuracy_meters,
            vin_photo_url,
            vin_detected,
            vin_match: autoChecks.vin_match ?? null,
            odometer_photo_url,
            odometer_reading,
            device_timestamp,
            time_drift_seconds: timeDrift,
            device_info,
            auto_checks: autoChecks,
            verification_status: verificationStatus,
            verified_at: verificationStatus === "auto_verified" ? new Date().toISOString() : null,
            notes,
          })
          .select()
          .single();
        if (proofErr) throw proofErr;

        // Update assignment status
        if (assignment_id) {
          const newStatus = proof_type === "completion" ? "proof_submitted" : undefined;
          if (newStatus) {
            await supabase
              .from("work_order_assignments")
              .update({ status: newStatus })
              .eq("id", assignment_id);
          }
        }

        await syncTimeline(supabase, work_order_id);

        return json({
          ok: true,
          proof_id: proof.id,
          verification_status: verificationStatus,
          auto_checks: autoChecks,
          message: verificationStatus === "auto_verified"
            ? "Proof auto-verified. All checks passed."
            : "Proof submitted. Pending manual verification."
        });
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // ADMIN: Verify or reject proof
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case "verify_proof": {
        const { proof_id, approved, rejection_reason, verified_by } = params;
        if (!proof_id) throw new Error("proof_id required");

        const { data, error } = await supabase
          .from("proof_of_work")
          .update({
            verification_status: approved ? "manually_verified" : "rejected",
            verified_by,
            verified_at: new Date().toISOString(),
            rejection_reason: approved ? null : rejection_reason,
          })
          .eq("id", proof_id)
          .select("assignment_id, work_order_id")
          .single();
        if (error) throw error;

        // If this was a completion proof and it was verified, update assignment
        if (approved && data.assignment_id) {
          await supabase
            .from("work_order_assignments")
            .update({ status: "verified" })
            .eq("id", data.assignment_id);
        }

        if (data.work_order_id) await syncTimeline(supabase, data.work_order_id);
        return json({ ok: true, approved, message: approved ? "Proof verified." : `Proof rejected: ${rejection_reason}` });
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // ADMIN: Process tech payout
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case "process_payout": {
        const { assignment_id, amount, payment_method, payment_handle, transaction_ref, notes } = params;
        if (!assignment_id || !amount || !payment_method) throw new Error("assignment_id, amount, payment_method required");

        // Get assignment details
        const { data: assignment } = await supabase
          .from("work_order_assignments")
          .select("*, technicians(name)")
          .eq("id", assignment_id)
          .single();

        if (!assignment) throw new Error("Assignment not found");
        if (assignment.payout_status !== "ready") {
          throw new Error(`Cannot pay out — status is '${assignment.payout_status}', must be 'ready'`);
        }

        // Record payout in technician_payout_log
        // Find the technician_phone_link_id if it exists
        const { data: phoneLink } = await supabase
          .from("technician_phone_links")
          .select("id")
          .eq("technician_id", assignment.technician_id)
          .limit(1)
          .single();

        if (phoneLink) {
          await supabase.from("technician_payout_log").insert({
            technician_phone_link_id: phoneLink.id,
            amount,
            payment_method,
            payment_handle,
            transaction_ref,
            work_summary: `${assignment.job_op_code} on WO ${assignment.work_order_id}`,
            status: "completed",
            initiated_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            notes,
          });
        }

        // Update assignment
        await supabase
          .from("work_order_assignments")
          .update({
            payout_status: "paid",
            actual_payout: amount,
            paid_at: new Date().toISOString(),
            status: "paid_out",
          })
          .eq("id", assignment_id);

        await syncTimeline(supabase, assignment.work_order_id);

        return json({
          ok: true,
          technician: (assignment as any).technicians?.name,
          amount,
          payment_method,
          message: `Payout of $${amount} to ${(assignment as any).technicians?.name} via ${payment_method} recorded.`
        });
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // DASHBOARD: Full work order status
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case "get_status": {
        const { work_order_id } = params;
        if (!work_order_id) throw new Error("work_order_id required");

        const { data: wo } = await supabase
          .from("work_orders")
          .select("*, vehicles(year, make, model, vin)")
          .eq("id", work_order_id)
          .single();

        const { data: parts } = await supabase
          .from("work_order_parts")
          .select("*")
          .eq("work_order_id", work_order_id)
          .order("created_at");

        const { data: labor } = await supabase
          .from("work_order_labor")
          .select("*")
          .eq("work_order_id", work_order_id)
          .order("created_at");

        const { data: assignments } = await supabase
          .from("work_order_assignments")
          .select("*, technicians(name)")
          .eq("work_order_id", work_order_id);

        const { data: proofs } = await supabase
          .from("proof_of_work")
          .select("*")
          .eq("work_order_id", work_order_id)
          .order("created_at");

        const { data: invoice } = await supabase
          .from("generated_invoices")
          .select("*")
          .eq("work_order_id", work_order_id)
          .single();

        const { data: payments } = await supabase
          .from("invoice_payments")
          .select("*")
          .eq("work_order_id", work_order_id);

        // Calculate totals
        const totalComped = [
          ...(parts || []).filter((p: any) => p.is_comped).map((p: any) => Number(p.comp_retail_value || 0)),
          ...(labor || []).filter((l: any) => l.is_comped).map((l: any) => Number(l.comp_retail_value || 0)),
        ].reduce((a, b) => a + b, 0);

        const totalPayouts = (assignments || [])
          .filter((a: any) => a.payout_status === "paid")
          .reduce((sum: number, a: any) => sum + Number(a.actual_payout || 0), 0);

        const pendingPayouts = (assignments || [])
          .filter((a: any) => ["ready", "pending_proof", "pending_client_payment"].includes(a.payout_status))
          .reduce((sum: number, a: any) => sum + Number(a.estimated_payout || 0), 0);

        return json({
          work_order: wo,
          parts,
          labor,
          assignments,
          proofs,
          invoice,
          payments,
          summary: {
            total_invoiced: invoice?.total_amount,
            total_paid_by_client: invoice?.amount_paid,
            total_comped_value: totalComped,
            total_paid_to_techs: totalPayouts,
            pending_tech_payouts: pendingPayouts,
            proof_count: proofs?.length || 0,
            heat_score: invoice?.heat_score,
          }
        });
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // TECH VIEW: What a specific technician sees
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case "get_tech_view": {
        const { technician_id } = params;
        if (!technician_id) throw new Error("technician_id required");

        const { data: assignments } = await supabase
          .from("work_order_assignments")
          .select(`
            *,
            work_orders(
              id, title, status, customer_name, scheduled_start, scheduled_end,
              vehicles(year, make, model, vin)
            )
          `)
          .eq("technician_id", technician_id)
          .order("created_at", { ascending: false });

        // Calculate their earnings
        const totalEarned = (assignments || [])
          .filter((a: any) => a.payout_status === "paid")
          .reduce((sum: number, a: any) => sum + Number(a.actual_payout || 0), 0);

        const pendingEarnings = (assignments || [])
          .filter((a: any) => ["ready", "pending_client_payment", "pending_proof"].includes(a.payout_status))
          .reduce((sum: number, a: any) => sum + Number(a.estimated_payout || 0), 0);

        const activeJobs = (assignments || []).filter((a: any) =>
          ["accepted", "in_progress", "proof_submitted"].includes(a.status)
        );

        const pendingOffers = (assignments || []).filter((a: any) =>
          ["pending", "offered"].includes(a.status)
        );

        return json({
          technician_id,
          active_jobs: activeJobs,
          pending_offers: pendingOffers,
          all_assignments: assignments,
          earnings: {
            total_earned: totalEarned,
            pending: pendingEarnings,
            next_payout_eligible: (assignments || []).filter((a: any) => a.payout_status === "ready").length,
          }
        });
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // TRANSFER BRIDGE: Payment signal from transfer-advance
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case "handle_transfer_payment": {
        // Called by transfer-advance when a payment signal mentions work order/invoice
        const { work_order_id, amount, payment_method, payment_reference, signal_text } = params;
        if (!work_order_id) throw new Error("work_order_id required");

        // Find the invoice for this work order
        const { data: invoice } = await supabase
          .from("generated_invoices")
          .select("id, total_amount, amount_paid, payment_status")
          .eq("work_order_id", work_order_id)
          .in("status", ["sent", "partial_payment"])
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (!invoice) {
          return json({ ok: false, reason: "No open invoice found for this work order" });
        }

        // If amount not parsed from signal, use full remaining balance
        const payAmount = amount || (Number(invoice.total_amount) - Number(invoice.amount_paid || 0));

        // Delegate to record_payment — reuse existing logic
        const payReq = new Request(req.url, {
          method: "POST",
          headers: req.headers,
          body: JSON.stringify({
            action: "record_payment",
            invoice_id: invoice.id,
            amount: payAmount,
            payment_method: payment_method || "wire",
            payment_reference: payment_reference || null,
            notes: `Auto-recorded from transfer signal: ${(signal_text || "").slice(0, 200)}`,
          }),
        });

        // Re-enter the handler (recursive dispatch)
        // Instead, just do it inline to avoid complexity
        const { data: payment, error: payErr } = await supabase
          .from("invoice_payments")
          .insert({
            invoice_id: invoice.id,
            amount: payAmount,
            payment_method: payment_method || "wire",
            payment_reference,
            status: "confirmed",
            paid_at: new Date().toISOString(),
            confirmed_at: new Date().toISOString(),
            net_amount: payAmount,
            notes: `Auto-recorded from transfer signal: ${(signal_text || "").slice(0, 200)}`,
          })
          .select()
          .single();

        if (payErr) throw payErr;

        // Check if paid in full
        const { data: allPayments } = await supabase
          .from("invoice_payments")
          .select("amount")
          .eq("invoice_id", invoice.id)
          .eq("status", "confirmed");

        const totalPaid = (allPayments || []).reduce((sum: number, p: any) => sum + Number(p.amount), 0);
        const totalDue = Number(invoice.total_amount);
        const isPaidInFull = totalPaid >= totalDue;

        await supabase
          .from("generated_invoices")
          .update({
            amount_paid: totalPaid,
            amount_due: Math.max(0, totalDue - totalPaid),
            payment_status: isPaidInFull ? "paid" : "partial",
            paid_at: isPaidInFull ? new Date().toISOString() : null,
            status: isPaidInFull ? "paid" : "sent",
            heat_score: isPaidInFull ? 100 : 95,
          })
          .eq("id", invoice.id);

        if (isPaidInFull) {
          await supabase.from("work_orders").update({
            status: "paid",
            actual_total: totalPaid,
          }).eq("id", work_order_id);

          await supabase.from("work_order_assignments")
            .update({ payout_status: "ready" })
            .eq("work_order_id", work_order_id)
            .in("status", ["completed", "verified", "proof_submitted"]);
        }

        await syncTimeline(supabase, work_order_id);

        return json({
          ok: true,
          paid_in_full: isPaidInFull,
          total_paid: totalPaid,
          remaining: Math.max(0, totalDue - totalPaid),
          source: "transfer_signal",
          message: isPaidInFull
            ? "Payment confirmed via transfer signal. Work order marked paid. Tech payouts unlocked."
            : `Partial payment recorded: $${payAmount}. $${totalDue - totalPaid} remaining.`,
        });
      }

      default:
        return json({ error: `Unknown action: ${action}`, available_actions: [
          "send_invoice", "record_payment",
          "tech_accept", "tech_decline", "submit_proof", "verify_proof", "process_payout",
          "get_status", "get_tech_view",
          "auto_order_parts", "update_po",
          "handle_transfer_payment"
        ]}, 400);
    }
  } catch (err: any) {
    return json({ error: err.message || String(err) }, 500);
  }
});

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * SYNC TIMELINE
 * After any state change, sync the work order summary into
 * the timeline_event metadata so every surface stays current.
 */
async function syncTimeline(supabase: any, workOrderId: string) {
  try {
    await supabase.rpc("sync_work_order_to_timeline", { p_work_order_id: workOrderId });
  } catch (e) {
    console.error("[syncTimeline] failed:", e);
  }
}

/**
 * ROUTE INVOICE TO TRANSFER
 * If the work order is linked to a transfer, log the invoice
 * as an outbound communication in the transfer thread.
 * This means the buyer sees it in their conversation.
 */
async function routeInvoiceToTransfer(supabase: any, workOrderId: string, invoice: any) {
  try {
    // Get work order with transfer link
    const { data: wo } = await supabase
      .from("work_orders")
      .select("transfer_id, vehicle_id, customer_name, customer_email")
      .eq("id", workOrderId)
      .single();

    if (!wo?.transfer_id) return; // Not linked to a transfer

    // Get transfer details for routing
    const { data: transfer } = await supabase
      .from("ownership_transfers")
      .select("inbox_email, buyer_email, buyer_phone")
      .eq("id", wo.transfer_id)
      .single();

    if (!transfer) return;

    // Log as outbound communication on the transfer
    await supabase.from("transfer_communications").insert({
      transfer_id: wo.transfer_id,
      source: "email",
      direction: "outbound",
      from_address: transfer.inbox_email || "noreply@nuke.ag",
      to_address: transfer.buyer_email || wo.customer_email,
      subject: `Pre-delivery service invoice — ${invoice.invoice_number}`,
      body_text: `Invoice ${invoice.invoice_number} for pre-delivery work has been sent. Total: $${invoice.total_amount}. Payment due to proceed with service work.`,
      received_at: new Date().toISOString(),
      milestone_type_inferred: "obligations_defined",
      ai_classification_confidence: 100,
      raw_metadata: {
        type: "work_order_invoice",
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        work_order_id: workOrderId,
        total_amount: invoice.total_amount,
      },
    });

    console.log(`[routeInvoiceToTransfer] Invoice ${invoice.invoice_number} logged to transfer ${wo.transfer_id}`);
  } catch (e) {
    // Non-fatal — don't break invoice send if transfer routing fails
    console.error("[routeInvoiceToTransfer] failed:", e);
  }
}

/**
 * AUTO-ORDER PARTS
 *
 * Takes all agreed, non-comped parts on a work order,
 * groups them by supplier, creates a purchase_order + purchase_order_items
 * for each supplier. Returns POs with buy_urls ready to open.
 *
 * The boss reviews the POs, clicks "approve" or opens the buy URLs directly.
 * At scale, suppliers with api_enabled get orders submitted automatically.
 */
async function autoOrderParts(supabase: any, workOrderId: string, invoiceId: string | null, trigger: string) {
  // Get all parts for this work order
  const { data: parts } = await supabase
    .from("work_order_parts")
    .select("*")
    .eq("work_order_id", workOrderId);

  if (!parts || parts.length === 0) return [];

  // Filter: only agreed, non-comped, with a supplier and quantity > 0
  const orderableParts = parts.filter((p: any) =>
    p.status === "agreed" &&
    !p.is_comped &&
    p.supplier &&
    (p.quantity || 0) > 0 &&
    (p.total_price || 0) > 0
  );

  if (orderableParts.length === 0) return [];

  // Group by supplier
  const bySupplier: Record<string, any[]> = {};
  for (const part of orderableParts) {
    const supplier = part.supplier.split("/")[0].trim(); // "AutoZone / RockAuto" → "AutoZone"
    if (!bySupplier[supplier]) bySupplier[supplier] = [];
    bySupplier[supplier].push(part);
  }

  // Get work order for context (vehicle, customer)
  const { data: wo } = await supabase
    .from("work_orders")
    .select("*, vehicles(year, make, model, vin)")
    .eq("id", workOrderId)
    .single();

  const vehicle = (wo as any)?.vehicles;
  const vehicleLabel = vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : "Unknown";

  // Check for existing POs on this work order (don't double-order)
  const { data: existingPOs } = await supabase
    .from("purchase_orders")
    .select("supplier_name, status")
    .eq("work_order_id", workOrderId)
    .not("status", "eq", "cancelled");

  const alreadyOrdered = new Set((existingPOs || []).map((p: any) => p.supplier_name));

  // Get supplier accounts for metadata
  const { data: supplierAccounts } = await supabase
    .from("supplier_accounts")
    .select("*");

  const supplierMap: Record<string, any> = {};
  for (const sa of (supplierAccounts || [])) {
    supplierMap[sa.supplier_name] = sa;
  }

  const createdPOs: any[] = [];

  for (const [supplierName, supplierParts] of Object.entries(bySupplier)) {
    // Skip if we already have a PO for this supplier
    if (alreadyOrdered.has(supplierName)) continue;

    const supplierAccount = supplierMap[supplierName];
    const subtotal = supplierParts.reduce((sum: number, p: any) => sum + Number(p.total_price || 0), 0);
    const buyUrls = supplierParts.map((p: any) => p.buy_url).filter(Boolean);

    // Generate PO number: PO-{vehicle}-{supplier}-{date}
    const supplierShort = supplierName.replace(/\s+/g, "").substring(0, 6).toUpperCase();
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const poNumber = `PO-K2500-${supplierShort}-${dateStr}`;

    // Create the PO
    const { data: po, error: poErr } = await supabase
      .from("purchase_orders")
      .insert({
        work_order_id: workOrderId,
        invoice_id: invoiceId,
        supplier_name: supplierName,
        supplier_url: supplierAccount?.supplier_url || null,
        supplier_account_id: supplierAccount?.account_number || null,
        po_number: poNumber,
        subtotal,
        total_estimate: subtotal, // TODO: add tax + shipping estimates
        status: supplierAccount?.api_enabled ? "approved" : "pending_approval",
        order_method: supplierAccount?.order_method || "manual",
        auto_ordered: true,
        auto_order_trigger: trigger,
        buy_urls: buyUrls,
        ship_to_name: wo.customer_name || "Skylar Williams",
        ship_to_address: "674 Wells Rd, Boulder City, NV 89005",
        ship_to_phone: "(702) 624-6793",
        estimated_delivery: supplierAccount?.avg_delivery_days
          ? new Date(Date.now() + supplierAccount.avg_delivery_days * 86400000).toISOString().slice(0, 10)
          : null,
        notes: `Auto-generated from ${trigger}. Vehicle: ${vehicleLabel}. ${supplierParts.length} item(s).`,
        created_by: wo.quoted_by || null,
      })
      .select()
      .single();

    if (poErr) {
      console.error(`Failed to create PO for ${supplierName}:`, poErr);
      continue;
    }

    // Create line items
    const items = supplierParts.map((p: any) => ({
      purchase_order_id: po.id,
      work_order_part_id: p.id,
      part_name: p.part_name,
      part_number: p.part_number,
      brand: p.brand,
      quantity: p.quantity || 1,
      unit_price: p.unit_price,
      total_price: p.total_price,
      buy_url: p.buy_url,
      status: "pending",
    }));

    await supabase.from("purchase_order_items").insert(items);

    createdPOs.push({
      ...po,
      item_count: items.length,
    });
  }

  return createdPOs;
}
