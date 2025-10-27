/**
 * Generate Transaction Documents (Purchase Agreement & Bill of Sale)
 * Call after fee payment is confirmed
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  })
}

// Simple HTML-to-styled document generator
function generatePurchaseAgreement(data: any): string {
  const { transaction, vehicle, buyer, seller, salePrice, currentDate } = data
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Vehicle Purchase Agreement</title>
  <style>
    @page { margin: 1in; }
    body { font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 1.6; color: #000; }
    .header { text-align: center; font-size: 16pt; font-weight: bold; margin-bottom: 30px; border-bottom: 3px solid #000; padding-bottom: 10px; }
    .section { margin-bottom: 25px; }
    .section-title { font-weight: bold; font-size: 13pt; margin-bottom: 10px; text-decoration: underline; }
    .field { margin: 5px 0; }
    .field-label { font-weight: bold; }
    .signature-line { border-bottom: 2px solid #000; width: 300px; display: inline-block; margin-top: 40px; }
    .signature-section { margin-top: 50px; page-break-inside: avoid; }
    .signature-box { display: inline-block; width: 45%; vertical-align: top; }
    .terms { margin-left: 20px; }
    .terms li { margin: 8px 0; }
  </style>
</head>
<body>
  <div class="header">VEHICLE PURCHASE AGREEMENT</div>
  
  <div class="section">
    <div class="section-title">PARTIES TO THIS AGREEMENT</div>
    <div class="field"><span class="field-label">BUYER:</span> ${buyer.name}</div>
    <div class="field"><span class="field-label">Address:</span> ${buyer.address || '_______________________'}</div>
    <div class="field"><span class="field-label">Phone:</span> ${buyer.phone || '_______________________'}</div>
    <div class="field"><span class="field-label">Email:</span> ${buyer.email}</div>
  </div>
  
  <div class="section">
    <div class="field"><span class="field-label">SELLER:</span> ${seller.name}</div>
    <div class="field"><span class="field-label">Address:</span> ${seller.address || '_______________________'}</div>
    <div class="field"><span class="field-label">Phone:</span> ${seller.phone || '_______________________'}</div>
    <div class="field"><span class="field-label">Email:</span> ${seller.email}</div>
  </div>
  
  <div class="section">
    <div class="section-title">VEHICLE DESCRIPTION</div>
    <div class="field"><span class="field-label">Year:</span> ${vehicle.year}</div>
    <div class="field"><span class="field-label">Make:</span> ${vehicle.make}</div>
    <div class="field"><span class="field-label">Model:</span> ${vehicle.model}</div>
    <div class="field"><span class="field-label">VIN:</span> ${vehicle.vin || 'Not provided'}</div>
    <div class="field"><span class="field-label">Odometer:</span> ${vehicle.mileage ? vehicle.mileage.toLocaleString() + ' miles' : 'Not disclosed'}</div>
    <div class="field"><span class="field-label">Color:</span> ${vehicle.color || 'Not specified'}</div>
  </div>
  
  <div class="section">
    <div class="section-title">PURCHASE PRICE</div>
    <div class="field"><span class="field-label">Total Purchase Price:</span> <strong>$${salePrice.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong></div>
  </div>
  
  <div class="section">
    <div class="section-title">TERMS AND CONDITIONS</div>
    <ol class="terms">
      <li><strong>AS-IS Sale:</strong> Buyer agrees to purchase the vehicle in its current condition ("AS-IS, WHERE-IS"). Seller makes no warranties, express or implied, regarding the condition, quality, or fitness for any particular purpose.</li>
      
      <li><strong>Payment Terms:</strong> Buyer agrees to remit payment of $${salePrice.toLocaleString()} to Seller via wire transfer, cashier's check, or other mutually agreed method within 5 business days of signing this agreement.</li>
      
      <li><strong>Title Transfer:</strong> Seller agrees to transfer clear title to Buyer upon receipt of full payment. Seller warrants that the vehicle is free of liens and encumbrances.</li>
      
      <li><strong>Delivery:</strong> Vehicle will be delivered to Buyer at the address specified below, or Buyer will arrange pickup, within 7 days of payment receipt.</li>
      
      <li><strong>Odometer Disclosure:</strong> ${vehicle.mileage ? `Seller declares the odometer reading is ${vehicle.mileage.toLocaleString()} miles and, to the best of Seller's knowledge, reflects actual mileage.` : 'Odometer reading not disclosed - mileage unknown.'}</li>
      
      <li><strong>Inspection Period:</strong> Buyer acknowledges having had the opportunity to inspect the vehicle or waives the right to inspection.</li>
      
      <li><strong>Risk of Loss:</strong> Risk of loss passes to Buyer upon full payment and signing of this agreement.</li>
      
      <li><strong>Entire Agreement:</strong> This agreement constitutes the entire agreement between the parties and supersedes all prior negotiations, representations, or agreements.</li>
      
      <li><strong>Governing Law:</strong> This agreement shall be governed by the laws of the state where the vehicle is located.</li>
    </ol>
  </div>
  
  <div class="signature-section">
    <div class="signature-box">
      <div><strong>BUYER</strong></div>
      <div class="signature-line" id="buyer-signature"></div>
      <div style="margin-top: 5px;">${buyer.name}</div>
      <div style="margin-top: 20px;">Date: ${currentDate}</div>
    </div>
    
    <div class="signature-box" style="float: right;">
      <div><strong>SELLER</strong></div>
      <div class="signature-line" id="seller-signature"></div>
      <div style="margin-top: 5px;">${seller.name}</div>
      <div style="margin-top: 20px;">Date: ${currentDate}</div>
    </div>
  </div>
  
  <div style="clear: both; margin-top: 60px; font-size: 10pt; text-align: center; color: #666;">
    Document facilitated by n-zero.dev | Transaction ID: ${transaction.id}
  </div>
</body>
</html>
  `.trim()
}

function generateBillOfSale(data: any): string {
  const { transaction, vehicle, buyer, seller, salePrice, currentDate } = data
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Bill of Sale</title>
  <style>
    @page { margin: 1in; }
    body { font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 1.6; color: #000; }
    .header { text-align: center; font-size: 18pt; font-weight: bold; margin-bottom: 30px; border-bottom: 3px solid #000; padding-bottom: 10px; }
    .section { margin-bottom: 20px; }
    .field { margin: 8px 0; }
    .field-label { font-weight: bold; display: inline-block; width: 150px; }
    .signature-line { border-bottom: 2px solid #000; width: 300px; display: inline-block; margin-top: 50px; }
    .signature-section { margin-top: 60px; }
    .box { border: 2px solid #000; padding: 15px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="header">BILL OF SALE</div>
  
  <div class="section">
    <p>Know all by these presents that <strong>${seller.name}</strong> ("Seller"), in consideration of the sum of <strong>$${salePrice.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} USD</strong>, the receipt and sufficiency of which is hereby acknowledged, does hereby sell, transfer, and convey to <strong>${buyer.name}</strong> ("Buyer"), the following motor vehicle:</p>
  </div>
  
  <div class="box">
    <div class="field"><span class="field-label">Year:</span> ${vehicle.year}</div>
    <div class="field"><span class="field-label">Make:</span> ${vehicle.make}</div>
    <div class="field"><span class="field-label">Model:</span> ${vehicle.model}</div>
    <div class="field"><span class="field-label">VIN:</span> ${vehicle.vin || 'Not provided'}</div>
    <div class="field"><span class="field-label">Odometer Reading:</span> ${vehicle.mileage ? vehicle.mileage.toLocaleString() + ' miles' : 'Not disclosed'}</div>
    <div class="field"><span class="field-label">Color:</span> ${vehicle.color || 'Not specified'}</div>
  </div>
  
  <div class="section">
    <p>The Seller hereby covenants that they are the lawful owner of said vehicle, that the vehicle is free from all liens and encumbrances, and that Seller has full right and authority to sell said vehicle.</p>
  </div>
  
  <div class="section">
    <p><strong>SALE TERMS:</strong> This vehicle is sold "AS-IS, WHERE-IS" without any warranty, express or implied. Buyer acknowledges having inspected the vehicle or waiving the right to inspection.</p>
  </div>
  
  <div class="section">
    <div class="field"><span class="field-label">Sale Price:</span> $${salePrice.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} USD</div>
    <div class="field"><span class="field-label">Date of Sale:</span> ${currentDate}</div>
  </div>
  
  <div class="signature-section">
    <div style="margin-bottom: 60px;">
      <div><strong>SELLER'S SIGNATURE</strong></div>
      <div class="signature-line" id="seller-signature"></div>
      <div style="margin-top: 10px;">Printed Name: ${seller.name}</div>
      <div style="margin-top: 5px;">Address: ${seller.address || '_______________________'}</div>
      <div style="margin-top: 5px;">Date: ${currentDate}</div>
    </div>
    
    <div>
      <div><strong>BUYER'S SIGNATURE</strong></div>
      <div class="signature-line" id="buyer-signature"></div>
      <div style="margin-top: 10px;">Printed Name: ${buyer.name}</div>
      <div style="margin-top: 5px;">Address: ${buyer.address || '_______________________'}</div>
      <div style="margin-top: 5px;">Date: ${currentDate}</div>
    </div>
  </div>
  
  <div style="margin-top: 60px; font-size: 10pt; text-align: center; color: #666;">
    Document facilitated by n-zero.dev | Transaction ID: ${transaction.id}
  </div>
</body>
</html>
  `.trim()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // This endpoint is called by the webhook, so we use service role
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY')
    if (!serviceKey) throw new Error('SERVICE_ROLE_KEY not configured')

    const { transaction_id } = await req.json()
    if (!transaction_id) return json({ error: 'transaction_id required' }, 400)

    const { createClient } = await import('jsr:@supabase/supabase-js@2')
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL')
    const supabase = createClient(supabaseUrl!, serviceKey)

    // Get transaction details
    const { data: transaction, error: txError } = await supabase
      .from('vehicle_transactions')
      .select(`
        *,
        buyer:buyer_id(id, email, raw_user_meta_data),
        seller:seller_id(id, email, raw_user_meta_data),
        vehicle:vehicles(*)
      `)
      .eq('id', transaction_id)
      .single()

    if (txError || !transaction) {
      return json({ error: 'Transaction not found' }, 404)
    }

    // Prepare data for document generation
    const currentDate = new Date().toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    })

    const buyer = {
      name: transaction.buyer?.raw_user_meta_data?.full_name || 'Buyer Name',
      email: transaction.buyer_email || transaction.buyer?.email,
      phone: transaction.buyer_phone,
      address: transaction.buyer?.raw_user_meta_data?.address || ''
    }

    const seller = {
      name: transaction.seller?.raw_user_meta_data?.full_name || 'Seller Name',
      email: transaction.seller?.email,
      phone: transaction.seller_phone,
      address: transaction.seller?.raw_user_meta_data?.address || ''
    }

    const vehicle = {
      year: transaction.vehicle?.year,
      make: transaction.vehicle?.make,
      model: transaction.vehicle?.model,
      vin: transaction.vehicle?.vin,
      mileage: transaction.vehicle?.mileage,
      color: transaction.vehicle?.exterior_color
    }

    const documentData = {
      transaction: { id: transaction.id },
      vehicle,
      buyer,
      seller,
      salePrice: transaction.sale_price,
      currentDate
    }

    // Generate HTML documents
    const purchaseAgreement = generatePurchaseAgreement(documentData)
    const billOfSale = generateBillOfSale(documentData)

    // Store documents (in a real system, you'd convert to PDF and upload to storage)
    // For now, we'll store the HTML and let frontend render/print
    await supabase
      .from('vehicle_transactions')
      .update({
        purchase_agreement_url: `data:text/html;base64,${btoa(purchaseAgreement)}`,
        bill_of_sale_url: `data:text/html;base64,${btoa(billOfSale)}`,
        status: 'pending_signatures'
      })
      .eq('id', transaction_id)

    return json({
      success: true,
      transaction_id,
      documents_generated: true
    })
  } catch (error) {
    console.error('Document generation error:', error)
    return json({ error: error.message }, 500)
  }
})

