# Squarebody Market Dashboard - Public Market Intelligence

## 🎯 Purpose

A **public-facing market intelligence dashboard** that shows the "life force" of the squarebody market - real-time discovery volumes, trends, and market activity.

## 📍 Access

**URL:** https://n-zero.dev/market/squarebodies

**Public Access:** No login required - anyone can view market activity

## 🎨 What It Shows

### 1. **Market Pulse Cards** (Top Section)
Vibrant gradient cards showing:
- **Total Discovered**: All squarebodies tracked (1973-1991)
- **Discovered Today**: New listings found today
- **This Week**: Weekly discovery count + daily rate
- **Avg Price**: Average asking price + price range
- **Active Regions**: Number of markets being monitored

### 2. **Recent Discoveries Grid**
Visual grid of recently discovered squarebodies:
- Vehicle images (if available)
- Year, Make, Model
- Asking price
- Location (region)
- Discovery date
- Click to view original Craigslist listing

### 3. **7-Day Discovery Trend**
Bar chart showing:
- Daily discovery count
- Average price per day
- Visual trend of market activity

### 4. **Top Markets**
Ranked list of most active regions:
- Region name
- Discovery count
- Visual bars showing relative activity

### 5. **Market Health Indicators**
Health metrics showing:
- **Discovery Rate**: Active/Idle status + listings per day
- **Market Coverage**: Regions monitored + % of US markets
- **Data Quality**: Images available count
- **Price Visibility**: Average price visibility

## 🔄 Auto-Refresh

- Updates every **30 seconds** automatically
- Shows "Last updated" timestamp
- Real-time market activity

## 📊 Data Sources

All data comes from:
- `vehicles` table (discovery_source = 'craigslist_scrape')
- `craigslist_listing_queue` table (for processing stats)
- `vehicle_images` table (for image counts)

## 🎯 Market Intelligence Features

### Discovery Metrics
- Total vehicles discovered
- Daily/weekly/monthly trends
- Processing rate (listings per day)

### Price Intelligence
- Average asking price
- Price range (min/max)
- Daily price trends
- Price visibility percentage

### Geographic Intelligence
- Active regions count
- Top markets ranking
- Regional distribution

### Market Health
- Discovery rate (active/idle)
- Market coverage percentage
- Data quality metrics
- Price visibility

## 🎨 Design Philosophy

**Public-Facing**: Designed to show market vitality, not admin controls

**Visual**: Gradient cards, progress bars, image grids

**Informative**: Shows trends, volumes, and market activity

**Real-Time**: Auto-refreshes to show live market data

## 🔗 Integration

Can be linked from:
- Homepage
- Navigation menu
- Vehicle discovery pages
- Market intelligence sections

## 📈 Use Cases

1. **Market Research**: See squarebody market activity
2. **Price Discovery**: Understand pricing trends
3. **Market Coverage**: See which regions are active
4. **Trend Analysis**: 7-day discovery trends
5. **Market Health**: Overall market vitality indicators

## 🚀 Future Enhancements

Potential additions:
- Price history charts
- Regional heat maps
- Model breakdown (C10, K10, etc.)
- Year distribution
- Condition analysis
- Time-to-sale metrics

---

**Last Updated:** January 2025  
**Status:** Public market intelligence dashboard  
**Access:** https://n-zero.dev/market/squarebodies

