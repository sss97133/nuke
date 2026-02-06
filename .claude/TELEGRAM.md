# Telegram System

## Bots

| Bot | Purpose | Users | Token Env Var |
|-----|---------|-------|---------------|
| `@Approval_Nuke_bot` | Claude Code approvals | Owner only | `TELEGRAM_APPROVAL_BOT_TOKEN` |
| `@Nukeproof_bot` | Technician submissions & verification | Technicians | `NUKEPROOF_BOT_TOKEN` |
| `@Sss97133_bot` | Legacy/alerts | Owner | `TELEGRAM_BOT_TOKEN` |

## Approval Bot (@Approval_Nuke_bot)

**What it does:**
- Receives Claude Code permission requests with approve/deny buttons
- Only responds to owner (chat ID 7587296683)
- No expiration - waits until you respond

**Buttons:**
- ✅ Approve - Approve this single request
- ❌ Deny - Deny this request
- ✅ Allow All - Auto-approve ALL requests for this Claude session (24h)

**Commands:**
- `/start` - Welcome
- `pending` - Show pending approvals
- `sessions` or `allowed` - Show auto-approve sessions
- `revoke` - Disable all auto-approve sessions
- `ABC12345 yes` - Approve by text
- `ABC12345 no` - Deny by text

**How it works:**
1. Claude needs permission → hook sends message to this bot
2. You tap ✅ Approve, ❌ Deny, or ✅ Allow All
3. Claude continues (or stops)
4. If you tap "Allow All", future requests from that Claude session auto-approve

## Nukeproof Bot (@Nukeproof_bot) - SHARE THIS ONE

**Simple flow:**
1. Tech sends VIN (text or photo of VIN plate)
2. Bot decodes VIN via NHTSA, creates vehicle if needed
3. Tech profile auto-created from Telegram ID
4. All subsequent photos attach to that vehicle
5. Send new VIN to switch vehicles

**Commands:**
- `/start` or `/help` - Show command guide
- `/status` - Show current vehicle & counts
- `/newvehicle` - Set active vehicle (VIN)
- `/job` - Start work session
- `/done` - Complete work session
- `/note` - Add note to vehicle
- `/photo` - Add photo to vehicle
- `/complaint` - Log a complaint (notifies owner)
- `/client` - Add client info
- `/url` - Extract vehicle from link

**Flow:**
1. Tech sends phone number → links to existing profile
2. Send VIN → decodes via NHTSA, creates vehicle if needed
3. Photos/notes/jobs attach to active vehicle

**Onboarding:**
```
Share: t.me/Nukeproof_bot
Tell them: "Send your phone number, then a VIN to start"
```

**Database:**
- `technician_phone_links` - Existing tech profiles (links via metadata.telegram_id)
- `vehicles` - Created from VIN decode
- `vehicle_images` - Photos linked to vehicles
- `vehicle_notes` - Notes/complaints/client info
- `vehicle_jobs` - Work sessions

## Files

| File | Purpose |
|------|---------|
| `~/.claude/hooks/telegram-approval.py` | Hook script (sends to approval bot) |
| `~/.claude/settings.local.json` | Hook config (24h timeout) |
| `supabase/functions/telegram-approval-webhook/` | Approval bot handler |
| `supabase/functions/nuke-data-bot/` | Data bot handler |

## Database

| Table | Purpose |
|-------|---------|
| `claude_approval_requests` | Pending/completed approvals |
| `telegram_users` | Registered submitters |
| `telegram_submissions` | Photo submissions |

## Onboarding a Tech

```
Share: t.me/Sss97133_bot
Tell them: "Send /start, then just send photos with captions"
```
