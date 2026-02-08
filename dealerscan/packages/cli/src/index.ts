#!/usr/bin/env node
import { Command } from 'commander'
import { loginCommand } from './commands/login'
import { extractCommand } from './commands/extract'
import { messagesCommand } from './commands/messages'
import { statusCommand } from './commands/status'

const program = new Command()

program
  .name('dealerscan')
  .description('DealerScan CLI - Extract dealer jacket data from the command line')
  .version('0.1.0')

program.addCommand(loginCommand)
program.addCommand(extractCommand)
program.addCommand(messagesCommand)
program.addCommand(statusCommand)

program.parse()
