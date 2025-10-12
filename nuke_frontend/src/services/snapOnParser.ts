import type { ParsedTool } from './professionalToolsService';

export class SnapOnParser {
  static parse(text: string): ParsedTool[] {
    const tools: ParsedTool[] = [];
    const seen = new Set<string>();
    const rowSeen = new Set<string>();
    
    console.log('Starting Snap-on receipt parsing...');
    console.log('Text length:', text.length);
    
    // Split into lines to better handle the columnar format
    let lines = text.split('\n');
    console.log('Total lines:', lines.length);

    // Heuristic: If pdf.js collapsed lines (very few newlines but long text),
    // re-split by date tokens typical of "Trans Date" column (MM/DD/YYYY or M/D/YY)
    const dateToken = /(\b\d{1,2}\/\d{1,2}\/\d{2,4}\b)/g;
    if (lines.length < 30 && text.length > 5000) {
      const segments: string[] = [];
      let lastIndex = 0;
      for (const match of text.matchAll(dateToken)) {
        const idx = match.index ?? 0;
        if (idx > lastIndex) {
          // push previous segment
          const prev = text.slice(lastIndex, idx).trim();
          if (prev) segments.push(prev);
          lastIndex = idx;
        }
      }
      // push remainder
      const tail = text.slice(lastIndex).trim();
      if (tail) segments.push(tail);
      if (segments.length > lines.length) {
        lines = segments;
        console.log('Reconstructed lines via date split:', lines.length);
      }
    }
    
    // Product code pattern - more flexible
    const productPattern = /\b([A-Z]{2,}[A-Z0-9\-]*\d+[A-Z0-9\-]*)\b/g;

    // Price token with thousands separator support
    const money = /\d{1,3}(?:,\d{3})*\.\d{2}/;

    // Full-row robust matcher: date ... product ... description ... qty ... list ... discount ... total ... Sale
    // We allow some noise between tokens due to PDF extraction quirks
    const rowRegex = new RegExp(
      String.raw`(?<date>\d{1,2}\/\d{1,2}\/\d{2,4}).{0,80}?\b(?<product>[A-Z]{2,}[A-Z0-9\-]*\d+[A-Z0-9\-]*)\b\s+(?<desc>.+?)\s+(?<qty>\d{1,3})\s+(?<list>${money.source})\s+(?<disc>${money.source})?\s+(?<total>${money.source}).{0,80}?\b(Sale)\b`,
      'gis'
    );
    
    // Look for lines that contain product information
    // Format: Date TransNum ProductCode Description Qty Price Discount Total
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip header lines and empty lines
      if (!line.trim() || line.includes('Trans Date') || line.includes('Transaction History')) {
        continue;
      }
      
      // Must contain a 'Sale' line type to be a tool row
      if (!/\bSale\b/i.test(line)) {
        continue;
      }

      // Try the robust whole-row regex first (can match multiple rows inside the segment)
      const rowMatches = [...line.matchAll(rowRegex)];
      if (rowMatches.length > 0) {
        for (const m of rowMatches) {
          if (!m.groups) continue;
          const productCode = (m.groups['product'] || '').trim();
          if (!productCode || seen.has(productCode)) continue;
          const desc = (m.groups['desc'] || '').replace(/\s{2,}/g, ' ').trim();
          const totalStr = (m.groups['total'] || '').replace(/,/g, '');
          const price = parseFloat(totalStr);
          const date = (m.groups['date'] || '').trim();
          const qty = parseInt(m.groups['qty'] || '1', 10) || 1;
          if (desc && price > 0) {
            const stem = desc.toLowerCase().split(/\s+/).slice(0, 3).join(' ');
            const rowKey = `${date}|${price.toFixed(2)}|${stem}`;
            if (rowSeen.has(rowKey)) continue;
            tools.push({
              name: desc,
              part_number: productCode,
              brand_name: 'Snap-on',
              purchase_date: date || undefined,
              purchase_price: price,
              quantity: qty,
              category: categorize(desc),
              metadata: { source: 'snap-on-receipt', raw_line: (m[0] || '').substring(0, 300) }
            });
            seen.add(productCode);
            rowSeen.add(rowKey);
          }
        }
        // Processed matches; move to next segment
        continue;
      }

      // Secondary method: locate first product code and try to backfill by scanning for last money as total
      const matches = [...line.matchAll(productPattern)];
      for (const match of matches) {
        const productCode = match[1];
        if (seen.has(productCode)) continue;
        if (productCode.length < 3 || productCode.length > 30) continue;

        const index = match.index || 0;
        const beforeCode = line.substring(0, index);
        const afterCode = line.substring(index + productCode.length);
        if (!/\bSale\b/i.test(line)) continue;

        // Description: from afterCode up to the token before the last 2-3 money tokens
        const moneyTokens = [...line.matchAll(new RegExp(money, 'g'))].map(t => t[0]);
        const totalStr = moneyTokens.length > 0 ? moneyTokens[moneyTokens.length - 1] : '';
        const total = totalStr ? parseFloat(totalStr.replace(/,/g, '')) : 0;

        // Try to extract a reasonable description chunk
        let description = afterCode
          .replace(totalStr, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
        // Trim trailing qty if left dangling
        description = description.replace(/\s+\d{1,3}\s*$/, '').trim();

        // Date detection
        let date = '';
        const dateMatch = beforeCode.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
        if (dateMatch) date = dateMatch[1];

        if (description && total > 0) {
          const stem = description.toLowerCase().split(/\s+/).slice(0, 3).join(' ');
          const rowKey = `${date}|${total.toFixed(2)}|${stem}`;
          if (rowSeen.has(rowKey)) { seen.add(productCode); continue; }
          tools.push({
            name: description,
            part_number: productCode,
            brand_name: 'Snap-on',
            purchase_date: date || undefined,
            purchase_price: total,
            quantity: 1,
            category: categorize(description),
            metadata: { source: 'snap-on-receipt', raw_line: line.substring(0, 300) }
          });
          seen.add(productCode);
          rowSeen.add(rowKey);
        } else {
          console.log(`Skipping ${productCode} - no valid description/price`);
        }
      }
    }
    
    console.log(`✅ Parsed ${tools.length} tools from Snap-on receipt`);
    return tools;
  }
}

function categorize(desc: string): string {
  const d = desc.toUpperCase();
  if (d.includes('WRENCH') || d.includes('RATCHET')) return 'Hand Tools';
  if (d.includes('IMPACT') || d.includes('DRILL')) return 'Power Tools';
  if (d.includes('SOCKET') || d.includes('SOEX')) return 'Sockets';
  if (d.includes('PLIER')) return 'Pliers';
  if (d.includes('METER') || d.includes('GAUGE')) return 'Measuring';
  return 'Tools';
}
