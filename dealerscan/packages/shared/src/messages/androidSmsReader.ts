export interface AndroidMessage {
  address: string
  body: string
  date: Date
  type: 'received' | 'sent'
  contactName: string | null
}

export interface AndroidConversation {
  address: string
  contactName: string | null
  messages: AndroidMessage[]
}

// Parse SMS Backup & Restore XML format
export async function parseAndroidSmsXml(xmlContent: string): Promise<AndroidConversation[]> {
  const { XMLParser } = require('fast-xml-parser')

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  })

  const parsed = parser.parse(xmlContent)

  // SMS Backup & Restore XML structure:
  // <smses count="N">
  //   <sms protocol="0" address="+1..." date="1234567890" type="1" body="..." contact_name="..." />
  // </smses>
  const smses = parsed?.smses?.sms
  if (!smses) return []

  const messages: AndroidMessage[] = (Array.isArray(smses) ? smses : [smses]).map((sms: any) => ({
    address: sms['@_address'] || '',
    body: sms['@_body'] || '',
    date: new Date(parseInt(sms['@_date']) || 0),
    type: sms['@_type'] === '2' ? 'sent' : 'received',
    contactName: sms['@_contact_name'] || null,
  }))

  // Group by address (phone number)
  const convMap = new Map<string, AndroidConversation>()
  for (const msg of messages) {
    const key = msg.address.replace(/\D/g, '') // Normalize phone number
    if (!convMap.has(key)) {
      convMap.set(key, {
        address: msg.address,
        contactName: msg.contactName,
        messages: [],
      })
    }
    convMap.get(key)!.messages.push(msg)
  }

  // Sort messages within each conversation by date
  for (const conv of convMap.values()) {
    conv.messages.sort((a, b) => a.date.getTime() - b.date.getTime())
  }

  return Array.from(convMap.values())
}
