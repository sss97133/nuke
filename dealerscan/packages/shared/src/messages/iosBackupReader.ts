import path from 'path'
import fs from 'fs'

export interface IOSBackupMessage {
  id: number
  text: string | null
  sender: string
  isFromMe: boolean
  date: Date
  chatId: string
}

export interface IOSBackupConversation {
  chatId: string
  participants: string[]
  messages: IOSBackupMessage[]
}

// Find available iOS backups on this machine
export function findIOSBackups(): { path: string; deviceName: string; date: string }[] {
  const backupDir = path.join(
    process.env.HOME || '',
    'Library/Application Support/MobileSync/Backup'
  )

  if (!fs.existsSync(backupDir)) return []

  const entries = fs.readdirSync(backupDir, { withFileTypes: true })
  return entries
    .filter(e => e.isDirectory())
    .map(e => {
      const backupPath = path.join(backupDir, e.name)
      const infoPath = path.join(backupPath, 'Info.plist')
      let deviceName = e.name.substring(0, 8) + '...'
      let date = ''

      // Try to read device info from Info.plist
      try {
        const content = fs.readFileSync(infoPath, 'utf-8')
        const nameMatch = content.match(/<key>Device Name<\/key>\s*<string>([^<]+)<\/string>/)
        if (nameMatch) deviceName = nameMatch[1]
        const dateMatch = content.match(/<key>Last Backup Date<\/key>\s*<date>([^<]+)<\/date>/)
        if (dateMatch) date = dateMatch[1]
      } catch {
        // Info.plist not readable or doesn't exist
      }

      return { path: backupPath, deviceName, date }
    })
    .filter(b => {
      // Verify Manifest.db exists (indicates a valid backup)
      return fs.existsSync(path.join(b.path, 'Manifest.db'))
    })
}

// Read messages from an iOS backup
// No special permissions needed (backups are in user-accessible directory)
export async function readIOSBackupMessages(backupPath: string): Promise<IOSBackupConversation[]> {
  const Database = require('better-sqlite3')

  // Step 1: Read Manifest.db to find the sms.db file hash
  const manifestDb = new Database(path.join(backupPath, 'Manifest.db'), { readonly: true })

  let smsDbHash: string
  try {
    const row = manifestDb.prepare(
      `SELECT fileID FROM Files WHERE relativePath = 'Library/SMS/sms.db' AND domain = 'HomeDomain'`
    ).get() as any

    if (!row) throw new Error('SMS database not found in backup')
    smsDbHash = row.fileID
  } finally {
    manifestDb.close()
  }

  // Step 2: Find the actual file in the backup directory structure
  // Backups store files as hash[0:2]/hash
  const smsDbPath = path.join(backupPath, smsDbHash.substring(0, 2), smsDbHash)

  if (!fs.existsSync(smsDbPath)) {
    throw new Error('SMS database file not found in backup')
  }

  // Step 3: Read sms.db (same schema as chat.db)
  const smsDb = new Database(smsDbPath, { readonly: true })

  try {
    const rows = smsDb.prepare(`
      SELECT
        m.ROWID as message_id,
        m.text,
        m.attributedBody,
        m.is_from_me,
        m.date as message_date,
        h.id as handle_id,
        c.ROWID as chat_id
      FROM message m
      LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      LEFT JOIN chat c ON cmj.chat_id = c.ROWID
      LEFT JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
      LEFT JOIN handle h ON chj.handle_id = h.ROWID
      ORDER BY m.date DESC
      LIMIT 5000
    `).all()

    const epoch2001 = new Date('2001-01-01T00:00:00Z').getTime()
    const chatMap = new Map<string, IOSBackupConversation>()

    for (const row of rows as any[]) {
      const chatId = String(row.chat_id || 0)

      if (!chatMap.has(chatId)) {
        chatMap.set(chatId, {
          chatId,
          participants: [],
          messages: [],
        })
      }

      const conv = chatMap.get(chatId)!

      if (row.handle_id && !conv.participants.includes(row.handle_id)) {
        conv.participants.push(row.handle_id)
      }

      // Try text column first, then attributedBody
      let text = row.text
      if (!text && row.attributedBody) {
        // Same decoding logic as imessageReader
        try {
          const bplistParser = require('bplist-parser')
          const parsed = bplistParser.parseBuffer(row.attributedBody)
          if (parsed?.[0]?.$objects) {
            for (const obj of parsed[0].$objects) {
              if (typeof obj === 'string' && obj.length > 0 && obj !== '$null') {
                text = obj
                break
              }
            }
          }
        } catch {
          // Fallback: extract readable text from blob
          const str = row.attributedBody.toString('utf-8')
          const segments = str.replace(/[^\x20-\x7E\u00A0-\uFFFF]/g, '\x00')
            .split(/\x00+/)
            .filter((s: string) => s.length > 2)
          if (segments.length > 0) {
            text = segments.sort((a: string, b: string) => b.length - a.length)[0].trim()
          }
        }
      }

      const dateMs = epoch2001 + (row.message_date / 1e6)

      conv.messages.push({
        id: row.message_id,
        text,
        sender: row.is_from_me ? 'me' : (row.handle_id || 'unknown'),
        isFromMe: !!row.is_from_me,
        date: new Date(dateMs),
        chatId,
      })
    }

    return Array.from(chatMap.values())
  } finally {
    smsDb.close()
  }
}
