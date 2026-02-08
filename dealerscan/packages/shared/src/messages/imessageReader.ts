import path from 'path'

export interface IMessageConversation {
  chatId: string
  participants: string[]
  displayName: string | null
  messages: IMessage[]
}

export interface IMessage {
  id: number
  text: string | null
  sender: string
  isFromMe: boolean
  date: Date
  hasAttachment: boolean
}

// Decode NSKeyedArchiver attributedBody blob to extract text
// 98% of iMessages have NULL text column - content is in attributedBody
function decodeAttributedBody(blob: Buffer): string | null {
  if (!blob || blob.length === 0) return null

  try {
    // The attributedBody is an NSKeyedArchiver format (binary plist)
    // The actual text is typically stored as a UTF-8 string within the plist
    // Look for the string content between known markers

    // Method 1: Try to find raw UTF-8 string in the blob
    // NSKeyedArchiver stores strings with a length prefix
    const str = blob.toString('utf-8')

    // Look for streamtyped data pattern
    const streamMarker = 'streamtyped'
    const idx = str.indexOf(streamMarker)
    if (idx !== -1) {
      // Text follows after the NSAttributedString header
      // Find the actual content by looking for the text segment
      const afterMarker = str.substring(idx + streamMarker.length)
      // The text content appears after "NSString" or "NSMutableString" marker
      const nsStringIdx = afterMarker.indexOf('NSString')
      if (nsStringIdx !== -1) {
        const textStart = afterMarker.indexOf('\x00', nsStringIdx + 10) + 1
        const textEnd = afterMarker.indexOf('\x00', textStart)
        if (textStart > 0 && textEnd > textStart) {
          return afterMarker.substring(textStart, textEnd).trim()
        }
      }
    }

    // Method 2: Use bplist-parser for proper decoding
    // This is the more reliable method but requires the dependency
    try {
      const bplistParser = require('bplist-parser')
      const parsed = bplistParser.parseBuffer(blob)
      if (parsed && parsed[0]) {
        // Navigate the NSKeyedArchiver structure
        const root = parsed[0]
        if (root.$objects) {
          // Find the NSString object containing the text
          for (const obj of root.$objects) {
            if (typeof obj === 'string' && obj.length > 0 && obj !== '$null') {
              return obj
            }
          }
        }
      }
    } catch {
      // bplist-parser not available, continue with raw extraction
    }

    // Method 3: Simple heuristic - extract longest readable string segment
    const readable = str.replace(/[^\x20-\x7E\u00A0-\uFFFF]/g, '\x00')
    const segments = readable.split(/\x00+/).filter(s => s.length > 2)
    if (segments.length > 0) {
      // Return the longest segment that looks like message content
      return segments.sort((a, b) => b.length - a.length)[0].trim() || null
    }
  } catch {
    // Failed to decode
  }

  return null
}

export interface ReadMessagesOptions {
  startDate?: Date
  endDate?: Date
  phoneNumber?: string
  keyword?: string
  limit?: number
}

// Read messages from macOS chat.db
// Requires Full Disk Access permission
export async function readIMessages(options: ReadMessagesOptions = {}): Promise<IMessageConversation[]> {
  const Database = require('better-sqlite3')
  const chatDbPath = path.join(process.env.HOME || '', 'Library/Messages/chat.db')

  const db = new Database(chatDbPath, { readonly: true })

  try {
    // Build query with optional filters
    let whereClause = 'WHERE 1=1'
    const params: any[] = []

    if (options.startDate) {
      // iMessage dates are in nanoseconds since 2001-01-01
      const epoch2001 = new Date('2001-01-01T00:00:00Z').getTime()
      const nsDate = (options.startDate.getTime() - epoch2001) * 1e6
      whereClause += ' AND m.date >= ?'
      params.push(nsDate)
    }

    if (options.endDate) {
      const epoch2001 = new Date('2001-01-01T00:00:00Z').getTime()
      const nsDate = (options.endDate.getTime() - epoch2001) * 1e6
      whereClause += ' AND m.date <= ?'
      params.push(nsDate)
    }

    if (options.phoneNumber) {
      whereClause += ' AND h.id LIKE ?'
      params.push(`%${options.phoneNumber.replace(/\D/g, '')}%`)
    }

    const limit = options.limit || 1000

    // Query messages with chat and handle info
    const rows = db.prepare(`
      SELECT
        m.ROWID as message_id,
        m.text,
        m.attributedBody,
        m.is_from_me,
        m.date as message_date,
        m.cache_has_attachments,
        h.id as handle_id,
        c.ROWID as chat_id,
        c.display_name as chat_display_name
      FROM message m
      LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      LEFT JOIN chat c ON cmj.chat_id = c.ROWID
      LEFT JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
      LEFT JOIN handle h ON chj.handle_id = h.ROWID
      ${whereClause}
      ORDER BY m.date DESC
      LIMIT ?
    `).all(...params, limit)

    // Group by chat
    const chatMap = new Map<number, IMessageConversation>()
    const epoch2001 = new Date('2001-01-01T00:00:00Z').getTime()

    for (const row of rows as any[]) {
      const chatId = row.chat_id || 0

      if (!chatMap.has(chatId)) {
        chatMap.set(chatId, {
          chatId: String(chatId),
          participants: [],
          displayName: row.chat_display_name || null,
          messages: [],
        })
      }

      const conv = chatMap.get(chatId)!

      // Add participant if not already present
      if (row.handle_id && !conv.participants.includes(row.handle_id)) {
        conv.participants.push(row.handle_id)
      }

      // Extract text - try text column first, then attributedBody
      let text = row.text
      if (!text && row.attributedBody) {
        text = decodeAttributedBody(row.attributedBody)
      }

      // Apply keyword filter
      if (options.keyword && text && !text.toLowerCase().includes(options.keyword.toLowerCase())) {
        continue
      }

      // Convert date from nanoseconds since 2001-01-01
      const dateMs = epoch2001 + (row.message_date / 1e6)

      conv.messages.push({
        id: row.message_id,
        text,
        sender: row.is_from_me ? 'me' : (row.handle_id || 'unknown'),
        isFromMe: !!row.is_from_me,
        date: new Date(dateMs),
        hasAttachment: !!row.cache_has_attachments,
      })
    }

    return Array.from(chatMap.values())
  } finally {
    db.close()
  }
}
