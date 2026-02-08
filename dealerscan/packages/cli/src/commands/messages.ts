import { Command } from 'commander'

export const messagesCommand = new Command('messages')
  .description('Extract text messages related to deals')
  .option('--source <source>', 'Message source: imessage, ios-backup, android', 'imessage')
  .option('--phone <number>', 'Filter by phone number')
  .option('--keyword <keyword>', 'Filter by keyword')
  .option('--days <days>', 'Limit to last N days', '30')
  .action(async (opts) => {
    const source = opts.source

    if (source === 'imessage') {
      if (process.platform !== 'darwin') {
        console.error('iMessage reading is only available on macOS')
        process.exit(1)
      }

      console.log('Reading iMessages...')
      try {
        const { readIMessages } = await import('@dealerscan/shared/messages/imessageReader')

        const daysAgo = parseInt(opts.days) || 30
        const startDate = new Date()
        startDate.setDate(startDate.getDate() - daysAgo)

        const conversations = await readIMessages({
          startDate,
          phoneNumber: opts.phone,
          keyword: opts.keyword,
          limit: 500,
        })

        console.log(`Found ${conversations.length} conversations`)
        for (const conv of conversations) {
          const msgCount = conv.messages.filter(m => m.text).length
          if (msgCount === 0) continue
          console.log(`\n--- ${conv.participants.join(', ')} (${msgCount} messages) ---`)
          for (const msg of conv.messages.slice(0, 10)) {
            if (!msg.text) continue
            const direction = msg.isFromMe ? 'ME' : msg.sender
            const date = msg.date.toLocaleDateString()
            console.log(`  [${date}] ${direction}: ${msg.text.substring(0, 100)}`)
          }
          if (conv.messages.length > 10) {
            console.log(`  ... and ${conv.messages.length - 10} more messages`)
          }
        }
      } catch (err: any) {
        if (err.message.includes('SQLITE_CANTOPEN') || err.message.includes('permission')) {
          console.error('Cannot read iMessages. Grant Full Disk Access:')
          console.error('  System Settings > Privacy & Security > Full Disk Access > add Terminal')
        } else {
          console.error(`Error: ${err.message}`)
        }
        process.exit(1)
      }
    } else if (source === 'android') {
      console.log('Android SMS import requires an XML file from "SMS Backup & Restore" app.')
      console.log('Usage: dealerscan messages --source android <xml-file>')
    } else {
      console.error(`Unknown source: ${source}. Use: imessage, ios-backup, android`)
      process.exit(1)
    }
  })
