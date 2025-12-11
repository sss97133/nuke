# Continuous Vehicle Import System

## Overview

Production-grade system that runs 24/7, continuously importing vehicles from all sources using best practices from the codebase.

## Features

✅ **Runs Non-Stop**: Continuous operation with automatic error recovery  
✅ **Intelligent Rate Limiting**: Per-domain rate limits based on site requirements  
✅ **Exponential Backoff**: Automatic retry with intelligent backoff  
✅ **User Agent Rotation**: Random user agents to avoid detection  
✅ **Priority-Based**: Sources sorted by priority for optimal results  
✅ **Health Monitoring**: Statistics tracking and performance metrics  
✅ **Graceful Shutdown**: Clean shutdown with statistics summary  

## Best Practices Implemented

Based on research from:
- Intelligent Crawler System documentation
- Scraping options comparison
- Rate limit handling strategies
- Error recovery patterns

### Rate Limiting
- **Craigslist**: 2 seconds between requests
- **KSL**: 3 seconds (bot protection)
- **Facebook**: 5 seconds (aggressive protection)
- **BaT**: 2 seconds
- **Hemmings**: 1.5 seconds
- **AutoTrader/Cars.com**: 3 seconds
- **Default**: 2 seconds

### Retry Logic
- **Max Retries**: 3 attempts
- **Exponential Backoff**: 5s, 10s, 15s delays
- **Timeout**: 30 seconds per request
- **Human-like Delays**: Random 500-1500ms delays

### Sources Covered

**Classifieds:**
- Craigslist (multiple regions)
- KSL Cars (multiple categories)
- SearchTempest

**Marketplaces:**
- Facebook Marketplace
- Hemmings
- Classic.com
- AutoTrader Classics
- ClassicCars.com

**Auctions:**
- Bring a Trailer
- Cars & Bids

## Usage

### Start the System

```bash
./scripts/start-continuous-import.sh
```

This will:
- Start the import system in the background
- Log to `logs/continuous-import.log`
- Create a PID file for management

### Stop the System

```bash
./scripts/stop-continuous-import.sh
```

### View Logs

```bash
tail -f logs/continuous-import.log
```

### Manual Run (Foreground)

```bash
node scripts/continuous-vehicle-import-production.js
```

Press `Ctrl+C` for graceful shutdown with statistics.

## How It Works

1. **Cycle Loop**: Runs continuously, processing all sources every 5 minutes
2. **Source Scraping**: Scrapes each source with intelligent rate limiting
3. **Queue Management**: Adds new listings to `import_queue` table
4. **Deduplication**: Checks for existing listings before adding
5. **Queue Processing**: Triggers `process-import-queue` function after each cycle
6. **Statistics**: Tracks performance and success rates

## Cycle Flow

```
┌─────────────────────────────────────┐
│  Start Cycle                        │
├─────────────────────────────────────┤
│  1. Sort sources by priority        │
│  2. Scrape each source:             │
│     - Rate limit per domain         │
│     - Extract listing URLs          │
│     - Add to import_queue           │
│  3. Process import queue            │
│  4. Print statistics (every 5 cycles)│
│  5. Wait 5 minutes                  │
└─────────────────────────────────────┘
```

## Statistics

The system tracks:
- Total cycles completed
- Total listings scraped
- Total listings added to queue
- Total errors encountered
- Per-source performance metrics
- Success rates per source
- Uptime tracking

## Error Handling

- **Network Errors**: Automatic retry with exponential backoff
- **Rate Limits**: Respects per-domain rate limits
- **Duplicate Listings**: Skips already-queued or existing listings
- **Source Failures**: Continues with other sources
- **Queue Errors**: Logs and continues

## Monitoring

### Check if Running

```bash
ps aux | grep continuous-vehicle-import-production
```

### Check Logs

```bash
tail -f logs/continuous-import.log
```

### Check Statistics

The system prints statistics every 5 cycles, showing:
- Total cycles
- Uptime
- Total scraped/added
- Per-source success rates

## Configuration

Edit `scripts/continuous-vehicle-import-production.js` to:
- Add/remove sources
- Adjust rate limits
- Change cycle wait time
- Modify retry logic
- Update priorities

## Best Practices

1. **Monitor Logs**: Check logs regularly for errors
2. **Adjust Rates**: Reduce rate limits if getting blocked
3. **Source Priority**: Higher priority sources run first
4. **Error Recovery**: System automatically recovers from errors
5. **Queue Processing**: Import queue is processed after each cycle

## Troubleshooting

### Process Not Starting

- Check `SUPABASE_SERVICE_ROLE_KEY` is set
- Verify Node.js is installed
- Check log file for errors

### High Error Rate

- Reduce rate limits for affected sources
- Check network connectivity
- Verify source URLs are still valid

### Queue Not Processing

- Check `process-import-queue` function is deployed
- Verify Supabase function permissions
- Check function logs in Supabase dashboard

## Performance

- **Cycle Time**: ~5-10 minutes (depends on sources)
- **Wait Between Cycles**: 5 minutes
- **Concurrent Requests**: Sequential (respects rate limits)
- **Memory Usage**: Low (single process)
- **CPU Usage**: Low (mostly I/O bound)

## Next Steps

1. **Start the system**: `./scripts/start-continuous-import.sh`
2. **Monitor logs**: `tail -f logs/continuous-import.log`
3. **Check results**: View vehicles in database
4. **Adjust as needed**: Modify configuration based on results

---

**Status**: ✅ Production Ready  
**Last Updated**: 2025-01-XX

