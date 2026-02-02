#!/usr/bin/env python3
"""
Generate stats chart for README and JSON for admin dashboard.
Runs daily via GitHub Action or manually.
"""

import os
import json
from datetime import datetime
import psycopg2
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

DATABASE_URL = os.environ.get('DATABASE_URL')

def get_stats():
    """Query current stats from database."""
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    stats = {}

    # Core counts
    queries = {
        'vehicles': "SELECT COUNT(*) FROM vehicles",
        'images': "SELECT COUNT(*) FROM vehicle_images",
        'observations': "SELECT COUNT(*) FROM vehicle_observations",
        'bat_identities': "SELECT COUNT(*) FROM bat_user_profiles",
        'active_users': "SELECT COUNT(*) FROM profiles WHERE email IS NOT NULL",
        'organizations': "SELECT COUNT(*) FROM organizations",
        'forum_posts': "SELECT COUNT(*) FROM build_posts",
    }

    for key, query in queries.items():
        try:
            cur.execute(query)
            stats[key] = cur.fetchone()[0]
        except:
            stats[key] = 0

    # Comments count (may timeout, use estimate if needed)
    try:
        cur.execute("SET statement_timeout = '10s'; SELECT COUNT(*) FROM auction_comments")
        stats['comments'] = cur.fetchone()[0]
    except:
        # Use pg_stat estimate
        cur.execute("""
            SELECT reltuples::bigint FROM pg_class WHERE relname = 'auction_comments'
        """)
        stats['comments'] = cur.fetchone()[0]

    # Weekly growth data
    cur.execute("""
        SELECT week, added, SUM(added) OVER (ORDER BY week) as cumulative FROM (
            SELECT date_trunc('week', created_at)::date as week, COUNT(*) as added
            FROM vehicles WHERE created_at IS NOT NULL GROUP BY 1
        ) v ORDER BY 1
    """)
    stats['vehicle_growth'] = [{'week': str(r[0]), 'added': r[1], 'cumulative': r[2]} for r in cur.fetchall()]

    cur.execute("""
        SELECT week, added, SUM(added) OVER (ORDER BY week) as cumulative FROM (
            SELECT date_trunc('week', created_at)::date as week, COUNT(*) as added
            FROM vehicle_images WHERE created_at IS NOT NULL GROUP BY 1
        ) v ORDER BY 1
    """)
    stats['image_growth'] = [{'week': str(r[0]), 'added': r[1], 'cumulative': r[2]} for r in cur.fetchall()]

    conn.close()

    stats['generated_at'] = datetime.utcnow().isoformat() + 'Z'
    return stats


def generate_chart(stats):
    """Generate growth chart PNG."""

    # Parse growth data
    vehicle_data = [(datetime.strptime(d['week'], '%Y-%m-%d'), d['cumulative'])
                    for d in stats['vehicle_growth']]
    image_data = [(datetime.strptime(d['week'], '%Y-%m-%d'), d['cumulative'])
                  for d in stats['image_growth']]

    # Create figure
    fig, ax1 = plt.subplots(figsize=(12, 6))
    fig.patch.set_facecolor('#1a1a2e')
    ax1.set_facecolor('#1a1a2e')

    # Images (primary axis)
    dates, values = zip(*image_data)
    ax1.plot(dates, values, 'o-', color='#00d4ff', linewidth=2, markersize=3, label='Images')
    ax1.fill_between(dates, values, alpha=0.2, color='#00d4ff')
    ax1.set_ylabel('Images', color='#00d4ff', fontsize=11)
    ax1.tick_params(axis='y', colors='#00d4ff')

    # Vehicles (secondary axis)
    ax2 = ax1.twinx()
    dates, values = zip(*vehicle_data)
    ax2.plot(dates, values, 's-', color='#ff6b6b', linewidth=2, markersize=3, label='Vehicles')
    ax2.set_ylabel('Vehicles', color='#ff6b6b', fontsize=11)
    ax2.tick_params(axis='y', colors='#ff6b6b')

    # Formatting
    ax1.tick_params(axis='x', colors='white')
    ax1.xaxis.set_major_formatter(mdates.DateFormatter('%b %Y'))
    ax1.xaxis.set_major_locator(mdates.MonthLocator())
    plt.xticks(rotation=45)

    # Title with current stats
    title = f"NUKE Data Growth\n{stats['vehicles']:,} vehicles · {stats['images']:,} images · {stats['bat_identities']:,} identity seeds"
    plt.title(title, color='white', fontsize=13, fontweight='bold', pad=15)

    # Legend
    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc='upper left',
               facecolor='#2a2a4e', edgecolor='white', labelcolor='white')

    plt.tight_layout()
    plt.savefig('data/growth-chart.png', dpi=120, facecolor='#1a1a2e', edgecolor='none')
    print(f"Chart saved: data/growth-chart.png")


def main():
    print("Fetching stats...")
    stats = get_stats()

    # Save JSON for admin dashboard
    os.makedirs('data', exist_ok=True)
    with open('data/stats.json', 'w') as f:
        json.dump(stats, f, indent=2)
    print(f"Stats saved: data/stats.json")

    # Generate chart
    generate_chart(stats)

    # Print summary
    print(f"\n{'='*40}")
    print(f"NUKE Stats - {stats['generated_at'][:10]}")
    print(f"{'='*40}")
    print(f"Vehicles:       {stats['vehicles']:>12,}")
    print(f"Images:         {stats['images']:>12,}")
    print(f"Comments:       {stats['comments']:>12,}")
    print(f"Observations:   {stats['observations']:>12,}")
    print(f"Identity Seeds: {stats['bat_identities']:>12,}")
    print(f"Active Users:   {stats['active_users']:>12,}")


if __name__ == '__main__':
    main()
