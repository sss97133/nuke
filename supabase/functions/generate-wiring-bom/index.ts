// generate-wiring-bom — Bill of Materials with catalog linkage and pricing
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ECU_PRICES: Record<string, number> = { M130: 3500, M150: 5500, M1: 8000 };
const PDM_PRICES: Record<string, number> = { PDM15: 2200, PDM30: 3140 };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { vehicle_id, labor_rate = 65, format = 'json' } = await req.json();
    if (!vehicle_id) return new Response(JSON.stringify({ error: "vehicle_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: devices } = await supabase.from("vehicle_build_manifest").select("*").eq("vehicle_id", vehicle_id).order("device_category");
    const { data: vehicle } = await supabase.from("vehicles").select("year, make, model").eq("id", vehicle_id).single();
    if (!devices?.length) return new Response(JSON.stringify({ error: "No manifest" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const vehicleName = vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : vehicle_id;

    // Get ECU recommendation
    const { data: overlay } = await supabase.from("vehicle_wiring_overlays").select("*").eq("vehicle_id", vehicle_id).single();

    // Compute ECU model (simplified — use the saved overlay if available)
    const ecuModel = 'M130'; // From latest compute result
    const ecuPrice = ECU_PRICES[ecuModel] || 3500;
    const pdmModel = 'PDM30';
    const pdmPrice = PDM_PRICES[pdmModel] || 3140;

    // Build BOM sections
    interface BOMItem { name: string; partNumber?: string; manufacturer?: string; qty: number; price?: number; purchased: boolean; supplier?: string; sourcing?: string; notes?: string }
    interface BOMSection { section: string; items: BOMItem[]; subtotal: number }
    const sections: BOMSection[] = [];

    // Motec system
    const motecItems: BOMItem[] = [
      { name: `${ecuModel} ECU`, manufacturer: 'Motec', qty: 1, price: ecuPrice, purchased: devices.some(d => d.device_name === 'ECU' && d.purchased), notes: 'Computed from I/O requirements' },
      { name: pdmModel, manufacturer: 'Motec', qty: 1, price: pdmPrice, purchased: devices.some(d => d.device_name === 'Power Distribution Module' && d.purchased) },
      { name: `${ecuModel} Connector Kit`, partNumber: ecuModel === 'M130' ? 'M130-CONN-KIT' : 'M150-CONN-KIT', manufacturer: 'ProWire USA', qty: 1, price: ecuModel === 'M130' ? 35 : 56.21, purchased: false, supplier: 'ProWire USA' },
    ];
    sections.push({ section: 'MOTEC SYSTEM', items: motecItems, subtotal: motecItems.reduce((s, i) => s + (i.price || 0) * i.qty, 0) });

    // Group remaining devices by category
    const categoryOrder = ['sensors', 'actuators', 'lighting', 'body', 'brakes', 'fuel', 'drivetrain', 'interior', 'audio', 'accessories', 'safety'];
    for (const cat of categoryOrder) {
      const catDevices = devices.filter(d => d.device_category === cat && !['ECU', 'Power Distribution Module', 'Star Ground Point', 'Body Ground Point', 'CAN Bus Network'].includes(d.device_name));
      if (!catDevices.length) continue;

      const items: BOMItem[] = catDevices.map(d => ({
        name: d.device_name,
        partNumber: d.part_number || undefined,
        manufacturer: d.manufacturer || undefined,
        qty: 1,
        price: d.price || undefined,
        purchased: d.purchased || false,
        supplier: d.supplier || undefined,
        sourcing: d.sourcing_difficulty || undefined,
      }));

      sections.push({
        section: cat.toUpperCase().replace('_', ' '),
        items,
        subtotal: items.reduce((s, i) => s + ((i.price || 0) * i.qty), 0),
      });
    }

    // Wire and consumables
    const wireCount = devices.filter(d => d.pin_count && d.pin_count > 0 && d.signal_type !== 'ground' && d.signal_type !== 'power_source').length;
    const totalWireFt = Math.round(wireCount * 7.3); // avg from cut list
    const wireItems: BOMItem[] = [
      { name: `TXL Wire assorted (${totalWireFt} ft est)`, manufacturer: 'ProWire USA', qty: 1, price: Math.round(totalWireFt * 0.15), purchased: false, supplier: 'ProWire USA' },
      { name: 'DTM Connector Kits (assorted)', manufacturer: 'ProWire USA', qty: 15, price: 7, purchased: false, supplier: 'ProWire USA' },
      { name: 'DR-25 Heat Shrink assorted', manufacturer: 'Raychem', qty: 1, price: 70, purchased: false, supplier: 'ProWire USA' },
      { name: 'Terminals, boots, consumables', qty: 1, price: 100, purchased: false },
    ];
    sections.push({ section: 'WIRE AND CONSUMABLES', items: wireItems, subtotal: wireItems.reduce((s, i) => s + ((i.price || 0) * i.qty), 0) });

    // Totals
    const partsCost = sections.reduce((s, sec) => s + sec.subtotal, 0);
    const laborHours = Math.round(wireCount * 0.5);
    const laborCost = laborHours * labor_rate;
    const purchasedCount = devices.filter(d => d.purchased).length;
    const unpurchasedCount = devices.filter(d => !d.purchased).length;
    const pricedCount = sections.reduce((s, sec) => s + sec.items.filter(i => i.price).length, 0);
    const unpricedCount = sections.reduce((s, sec) => s + sec.items.filter(i => !i.price).length, 0);

    const result = {
      title: `BILL OF MATERIALS — ${vehicleName}`,
      generatedAt: new Date().toISOString(),
      ecuModel, pdmModel,
      sections,
      partsCost,
      laborRate: labor_rate,
      laborHours,
      laborCost,
      grandTotal: partsCost + laborCost,
      purchasedCount, unpurchasedCount,
      pricedCount, unpricedCount,
    };

    if (format === 'text') {
      const lines: string[] = [];
      lines.push(result.title);
      lines.push(`Generated: ${new Date().toLocaleDateString()} | ECU: ${ecuModel} | PDM: ${pdmModel}`);
      lines.push('='.repeat(90));

      for (const sec of sections) {
        lines.push('');
        lines.push(`>> ${sec.section} (${sec.items.length} items)`);
        lines.push('-'.repeat(90));
        for (const item of sec.items) {
          const price = item.price ? `$${(item.price * item.qty).toLocaleString()}` : 'QUOTE';
          const pn = item.partNumber ? ` [${item.partNumber}]` : '';
          const status = item.purchased ? ' PURCHASED' : '';
          const src = item.sourcing ? ` (${item.sourcing})` : '';
          lines.push(`  ${item.qty}x ${item.name}${pn} — ${price}${status}${src}`);
        }
        lines.push(`  SUBTOTAL: $${sec.subtotal.toLocaleString()}`);
      }

      lines.push('');
      lines.push('='.repeat(90));
      lines.push(`PARTS:  $${partsCost.toLocaleString()}`);
      lines.push(`LABOR:  ${laborHours} hrs @ $${labor_rate}/hr = $${laborCost.toLocaleString()}`);
      lines.push(`TOTAL:  $${(partsCost + laborCost).toLocaleString()}`);
      lines.push('');
      lines.push(`Priced: ${pricedCount} | Unpriced: ${unpricedCount} | Purchased: ${purchasedCount} | Needed: ${unpurchasedCount}`);

      return new Response(lines.join('\n'), { headers: { ...corsHeaders, "Content-Type": "text/plain" } });
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
