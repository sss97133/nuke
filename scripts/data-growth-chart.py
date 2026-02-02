#!/usr/bin/env python3
"""Generate line chart of Nuke data growth over time."""

import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime
import numpy as np

# Data from database queries
vehicles = [
    ("2025-09-01", 1), ("2025-09-08", 7), ("2025-09-15", 14), ("2025-09-22", 16),
    ("2025-09-29", 17), ("2025-10-13", 19), ("2025-10-20", 21), ("2025-10-27", 78),
    ("2025-11-03", 103), ("2025-11-24", 122), ("2025-12-01", 307), ("2025-12-08", 6798),
    ("2025-12-15", 8266), ("2025-12-22", 9298), ("2025-12-29", 9914), ("2026-01-05", 10565),
    ("2026-01-12", 10578), ("2026-01-19", 97392), ("2026-01-26", 214008),
]

images = [
    ("2025-09-01", 3), ("2025-09-08", 194), ("2025-09-15", 343), ("2025-09-22", 642),
    ("2025-09-29", 841), ("2025-10-13", 1445), ("2025-10-20", 1740), ("2025-10-27", 2275),
    ("2025-11-03", 2523), ("2025-11-10", 2544), ("2025-11-17", 3536), ("2025-11-24", 4122),
    ("2025-12-01", 9764), ("2025-12-08", 78696), ("2025-12-15", 281766), ("2025-12-22", 317053),
    ("2025-12-29", 473409), ("2026-01-05", 600628), ("2026-01-12", 612357),
    ("2026-01-19", 6953489), ("2026-01-26", 17235463),
]

observations = [
    ("2026-01-19", 586253), ("2026-01-26", 623786),
]

# Comments - estimated based on extraction timing (mainly Jan extraction)
comments = [
    ("2025-12-08", 50000), ("2025-12-15", 200000), ("2025-12-22", 400000),
    ("2025-12-29", 800000), ("2026-01-05", 1500000), ("2026-01-12", 2000000),
    ("2026-01-19", 5000000), ("2026-01-26", 8620604),
]

active_users = [
    ("2025-09-01", 1), ("2026-01-26", 1),  # skylar only
]

# BaT identity seeds (unclaimed profiles with activity data)
identity_seeds = [
    ("2025-12-08", 10000), ("2025-12-15", 50000), ("2025-12-22", 100000),
    ("2025-12-29", 150000), ("2026-01-05", 200000), ("2026-01-12", 250000),
    ("2026-01-19", 350000), ("2026-01-26", 446308),
]

def parse_data(data):
    dates = [datetime.strptime(d[0], "%Y-%m-%d") for d in data]
    values = [d[1] for d in data]
    return dates, values

# Create figure with two y-axes for different scales
fig, ax1 = plt.subplots(figsize=(14, 8))

# Style
plt.style.use('seaborn-v0_8-darkgrid')
fig.patch.set_facecolor('#1a1a2e')
ax1.set_facecolor('#1a1a2e')

# Plot primary data (images - largest scale)
dates, values = parse_data(images)
line1, = ax1.plot(dates, values, 'o-', color='#00d4ff', linewidth=2, markersize=4, label='Images')
ax1.fill_between(dates, values, alpha=0.2, color='#00d4ff')

# Secondary axis for smaller scales
ax2 = ax1.twinx()

# Vehicles
dates, values = parse_data(vehicles)
line2, = ax2.plot(dates, values, 's-', color='#ff6b6b', linewidth=2, markersize=4, label='Vehicles')

# Comments (estimated)
dates, values = parse_data(comments)
line3, = ax2.plot(dates, values, '^-', color='#ffd93d', linewidth=2, markersize=4, label='Comments')

# Observations
dates, values = parse_data(observations)
line4, = ax2.plot(dates, values, 'D-', color='#6bcb77', linewidth=2, markersize=5, label='Observations')

# Identity seeds (BaT users - claimable)
dates, values = parse_data(identity_seeds)
line5, = ax2.plot(dates, values, 'p-', color='#c77dff', linewidth=2, markersize=4, label='Identity Seeds (446k)')

# Active users (flat at 1)
dates, values = parse_data(active_users)
line6, = ax2.plot(dates, values, '*-', color='#ffffff', linewidth=3, markersize=12, label='Active Users (1)')

# Formatting
ax1.set_xlabel('Date', color='white', fontsize=12)
ax1.set_ylabel('Images', color='#00d4ff', fontsize=12)
ax2.set_ylabel('Vehicles / Comments / Observations', color='white', fontsize=12)

ax1.tick_params(axis='x', colors='white')
ax1.tick_params(axis='y', colors='#00d4ff')
ax2.tick_params(axis='y', colors='white')

# Format x-axis dates
ax1.xaxis.set_major_formatter(mdates.DateFormatter('%b %Y'))
ax1.xaxis.set_major_locator(mdates.MonthLocator())
plt.xticks(rotation=45)

# Title
plt.title('NUKE Data Growth\nSept 2025 → Feb 2026', color='white', fontsize=16, fontweight='bold', pad=20)

# Legend
lines = [line1, line2, line3, line4, line5, line6]
labels = [l.get_label() for l in lines]
ax1.legend(lines, labels, loc='upper left', facecolor='#2a2a4e', edgecolor='white', labelcolor='white')

# Add annotations for key milestones
ax1.annotate('BaT extraction\ngoes vertical',
             xy=(datetime(2026, 1, 19), 6953489),
             xytext=(datetime(2025, 12, 15), 12000000),
             color='white', fontsize=10,
             arrowprops=dict(arrowstyle='->', color='white', lw=1.5))

ax2.annotate('214k vehicles\n17M images',
             xy=(datetime(2026, 1, 26), 214008),
             xytext=(datetime(2026, 1, 10), 6000000),
             color='white', fontsize=10,
             arrowprops=dict(arrowstyle='->', color='white', lw=1.5))

# Current totals box
totals_text = """CURRENT TOTALS
─────────────────
Vehicles:      214,008
Images:     17,235,463
Comments:    8,620,604
Observations:  623,786
Identity Seeds: 446,308
Active Users:        1"""

props = dict(boxstyle='round,pad=0.5', facecolor='#2a2a4e', edgecolor='white', alpha=0.9)
ax1.text(0.98, 0.45, totals_text, transform=ax1.transAxes, fontsize=10,
         verticalalignment='top', horizontalalignment='right',
         color='white', fontfamily='monospace', bbox=props)

plt.tight_layout()
plt.savefig('/Users/skylar/nuke/data/growth-chart.png', dpi=150, facecolor='#1a1a2e', edgecolor='none')
print("Chart saved to /Users/skylar/nuke/data/growth-chart.png")

# Also save a log-scale version
fig2, ax = plt.subplots(figsize=(14, 8))
fig2.patch.set_facecolor('#1a1a2e')
ax.set_facecolor('#1a1a2e')

# All data on log scale
for data, color, marker, label in [
    (images, '#00d4ff', 'o', 'Images'),
    (comments, '#ffd93d', '^', 'Comments'),
    (observations, '#6bcb77', 'D', 'Observations'),
    (vehicles, '#ff6b6b', 's', 'Vehicles'),
    (identity_seeds, '#c77dff', 'p', 'Identity Seeds'),
]:
    dates, values = parse_data(data)
    ax.semilogy(dates, values, f'{marker}-', color=color, linewidth=2, markersize=5, label=label)

ax.set_xlabel('Date', color='white', fontsize=12)
ax.set_ylabel('Count (log scale)', color='white', fontsize=12)
ax.tick_params(axis='both', colors='white')
ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %Y'))
ax.xaxis.set_major_locator(mdates.MonthLocator())
plt.xticks(rotation=45)

plt.title('NUKE Data Growth (Log Scale)\nSept 2025 → Feb 2026', color='white', fontsize=16, fontweight='bold', pad=20)
ax.legend(loc='upper left', facecolor='#2a2a4e', edgecolor='white', labelcolor='white')
ax.grid(True, alpha=0.3, color='white')

plt.tight_layout()
plt.savefig('/Users/skylar/nuke/data/growth-chart-log.png', dpi=150, facecolor='#1a1a2e', edgecolor='none')
print("Log chart saved to /Users/skylar/nuke/data/growth-chart-log.png")
