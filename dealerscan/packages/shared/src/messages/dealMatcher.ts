import type { Deal } from '../types'

export interface MatchResult {
  dealId: string
  matchedFields: string[]
  confidence: number
  matchedMessages: { text: string; matchType: string }[]
}

// Match messages to deals by VIN, customer name, year/make/model, price amounts
export function matchMessagesToDeal(
  messages: { text: string; date: Date }[],
  deals: Deal[],
): MatchResult[] {
  const results: MatchResult[] = []

  for (const deal of deals) {
    const matchedFields: string[] = []
    const matchedMessages: { text: string; matchType: string }[] = []

    for (const msg of messages) {
      if (!msg.text) continue
      const text = msg.text.toLowerCase()

      // VIN match (17 chars, alphanumeric)
      if (deal.vin) {
        const vinLower = deal.vin.toLowerCase()
        if (text.includes(vinLower) || text.includes(vinLower.slice(-8))) {
          if (!matchedFields.includes('vin')) matchedFields.push('vin')
          matchedMessages.push({ text: msg.text, matchType: 'vin' })
        }
      }

      // Customer name match
      if (deal.owner_name) {
        const nameParts = deal.owner_name.toLowerCase().split(/\s+/)
        const lastNameMatch = nameParts.length > 1 && text.includes(nameParts[nameParts.length - 1])
        const fullNameMatch = text.includes(deal.owner_name.toLowerCase())
        if (fullNameMatch || lastNameMatch) {
          if (!matchedFields.includes('owner_name')) matchedFields.push('owner_name')
          matchedMessages.push({ text: msg.text, matchType: 'owner_name' })
        }
      }

      // Year/Make/Model match
      const ymm = [deal.year, deal.make, deal.model].filter(Boolean).join(' ').toLowerCase()
      if (ymm.length > 5 && text.includes(ymm)) {
        if (!matchedFields.includes('vehicle')) matchedFields.push('vehicle')
        matchedMessages.push({ text: msg.text, matchType: 'vehicle' })
      } else {
        // Try partial: make + model
        if (deal.make && deal.model) {
          const mm = `${deal.make} ${deal.model}`.toLowerCase()
          if (text.includes(mm)) {
            if (!matchedFields.includes('vehicle')) matchedFields.push('vehicle')
            matchedMessages.push({ text: msg.text, matchType: 'vehicle' })
          }
        }
      }

      // Sale price match (look for dollar amounts)
      if (deal.sale_price && deal.sale_price > 0) {
        const priceStr = deal.sale_price.toString()
        const priceWithCommas = deal.sale_price.toLocaleString()
        if (text.includes(priceStr) || text.includes(priceWithCommas) || text.includes(`$${priceStr}`) || text.includes(`$${priceWithCommas}`)) {
          if (!matchedFields.includes('sale_price')) matchedFields.push('sale_price')
          matchedMessages.push({ text: msg.text, matchType: 'sale_price' })
        }
      }
    }

    if (matchedFields.length > 0) {
      // Confidence based on number and type of matches
      let confidence = 0
      if (matchedFields.includes('vin')) confidence += 50
      if (matchedFields.includes('owner_name')) confidence += 25
      if (matchedFields.includes('vehicle')) confidence += 15
      if (matchedFields.includes('sale_price')) confidence += 10
      confidence = Math.min(confidence, 100)

      results.push({
        dealId: deal.id,
        matchedFields,
        confidence,
        matchedMessages,
      })
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence)
}
