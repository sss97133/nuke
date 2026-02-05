#!/usr/bin/env node
// Generate static HTML map with embedded data

import fs from 'fs';
import path from 'path';

const stateData = JSON.parse(fs.readFileSync('/tmp/state_clean.json', 'utf8'));
const countyData = JSON.parse(fs.readFileSync('/tmp/county_clean.json', 'utf8'));

const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nuke Vehicle Map</title>
    <script src="https://d3js.org/d3.v7.min.js"></script>
    <script src="https://d3js.org/topojson.v3.min.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0a0a0a; color: #fff; }
        #header { padding: 20px; display: flex; justify-content: space-between; align-items: center; }
        h1 { font-size: 24px; font-weight: 600; }
        .stats { font-size: 14px; color: #888; }
        .stats span { color: #10b981; font-weight: 600; }
        #controls { padding: 0 20px 20px; display: flex; gap: 20px; align-items: center; }
        .btn-group { display: flex; gap: 5px; }
        .btn { padding: 8px 16px; border: 1px solid #333; background: #1a1a1a; color: #fff; border-radius: 6px; cursor: pointer; font-size: 13px; }
        .btn.active { background: #10b981; border-color: #10b981; }
        .btn:hover { background: #252525; }
        .btn.active:hover { background: #059669; }
        #map { width: 100%; height: calc(100vh - 140px); }
        .county, .state { fill: #1a1a1a; stroke: #333; stroke-width: 0.5px; transition: fill 0.15s; }
        .county:hover, .state:hover { stroke: #fff; stroke-width: 1px; }
        .tooltip { position: absolute; background: #1f1f1f; border: 1px solid #333; padding: 12px; border-radius: 8px; font-size: 13px; pointer-events: none; opacity: 0; transition: opacity 0.15s; z-index: 1000; }
        .tooltip h3 { margin-bottom: 8px; font-size: 15px; }
        .tooltip .value { color: #10b981; font-weight: 600; }
        #legend { position: absolute; bottom: 30px; right: 30px; background: #1a1a1a; border: 1px solid #333; padding: 15px; border-radius: 8px; }
        #legend h4 { margin-bottom: 10px; font-size: 12px; color: #888; }
        .legend-scale { display: flex; height: 15px; border-radius: 3px; overflow: hidden; }
        .legend-scale div { flex: 1; }
        .legend-labels { display: flex; justify-content: space-between; margin-top: 5px; font-size: 11px; color: #888; }
    </style>
</head>
<body>
    <div id="header">
        <h1>🚗 Nuke Vehicle Distribution</h1>
        <div class="stats">
            <span id="totalVehicles">0</span> vehicles ·
            <span id="totalValue">$0</span> total value ·
            <span id="regionCount">0</span> regions
        </div>
    </div>
    <div id="controls">
        <div class="btn-group">
            <button class="btn active" data-level="state">States</button>
            <button class="btn" data-level="county">Counties</button>
        </div>
        <div class="btn-group">
            <button class="btn active" data-metric="value">Total Value</button>
            <button class="btn" data-metric="count">Vehicle Count</button>
            <button class="btn" data-metric="avg">Average Price</button>
        </div>
    </div>
    <svg id="map"></svg>
    <div class="tooltip" id="tooltip"></div>
    <div id="legend">
        <h4 id="legendTitle">Total Value</h4>
        <div class="legend-scale" id="legendScale"></div>
        <div class="legend-labels"><span id="legendMin">$0</span><span id="legendMax">$0</span></div>
    </div>

    <script>
        // Embedded data
        const STATE_DATA = ${JSON.stringify(stateData)};
        const COUNTY_DATA = ${JSON.stringify(countyData)};

        // State FIPS codes
        const STATE_FIPS = {
            'AL':'01','AK':'02','AZ':'04','AR':'05','CA':'06','CO':'08','CT':'09','DE':'10',
            'FL':'12','GA':'13','HI':'15','ID':'16','IL':'17','IN':'18','IA':'19','KS':'20',
            'KY':'21','LA':'22','ME':'23','MD':'24','MA':'25','MI':'26','MN':'27','MS':'28',
            'MO':'29','MT':'30','NE':'31','NV':'32','NH':'33','NJ':'34','NM':'35','NY':'36',
            'NC':'37','ND':'38','OH':'39','OK':'40','OR':'41','PA':'42','RI':'44','SC':'45',
            'SD':'46','TN':'47','TX':'48','UT':'49','VT':'50','VA':'51','WA':'53','WV':'54',
            'WI':'55','WY':'56'
        };

        let currentLevel = 'state';
        let currentMetric = 'value';
        let usTopoJson = null;

        const svg = d3.select('#map');
        const tooltip = d3.select('#tooltip');
        const width = window.innerWidth;
        const height = window.innerHeight - 140;

        svg.attr('width', width).attr('height', height);

        const projection = d3.geoAlbersUsa().scale(1300).translate([width/2, height/2]);
        const path = d3.geoPath().projection(projection);

        const colors = ['#064e3b', '#065f46', '#047857', '#059669', '#10b981', '#34d399', '#6ee7b7'];

        function formatValue(v) {
            if (v >= 1e9) return '$' + (v/1e9).toFixed(1) + 'B';
            if (v >= 1e6) return '$' + (v/1e6).toFixed(1) + 'M';
            if (v >= 1e3) return '$' + (v/1e3).toFixed(0) + 'K';
            return '$' + v.toFixed(0);
        }

        function formatNumber(n) {
            return n.toLocaleString();
        }

        async function loadTopoJson() {
            usTopoJson = await d3.json('https://cdn.jsdelivr.net/npm/us-atlas@3/counties-albers-10m.json');
            render();
        }

        function getData() {
            if (currentLevel === 'state') {
                const stateMap = {};
                STATE_DATA.states.forEach(s => {
                    const fips = STATE_FIPS[s.code];
                    if (fips) stateMap[fips] = s;
                });
                return { map: stateMap, stats: STATE_DATA.stats };
            } else {
                const countyMap = {};
                COUNTY_DATA.counties.forEach(c => {
                    countyMap[c.fips] = c;
                });
                return { map: countyMap, stats: COUNTY_DATA.stats };
            }
        }

        function render() {
            if (!usTopoJson) return;

            const { map: dataMap, stats } = getData();

            // Update stats
            document.getElementById('totalVehicles').textContent = formatNumber(stats.totalCount);
            document.getElementById('totalValue').textContent = formatValue(stats.totalValue);
            document.getElementById('regionCount').textContent = currentLevel === 'state'
                ? STATE_DATA.states.length + ' states'
                : (stats.countyCount || COUNTY_DATA.counties.length) + ' counties';

            // Get values for color scale
            const values = Object.values(dataMap).map(d => d[currentMetric]).filter(v => v > 0);
            const maxVal = d3.quantile(values.sort((a,b) => a-b), 0.95) || 1;
            const colorScale = d3.scaleQuantize().domain([0, maxVal]).range(colors);

            // Update legend
            const legendTitle = currentMetric === 'value' ? 'Total Value' : currentMetric === 'count' ? 'Vehicle Count' : 'Avg Price';
            document.getElementById('legendTitle').textContent = legendTitle;
            document.getElementById('legendMin').textContent = currentMetric === 'count' ? '0' : '$0';
            document.getElementById('legendMax').textContent = currentMetric === 'count' ? formatNumber(maxVal) : formatValue(maxVal);

            const legendScale = document.getElementById('legendScale');
            legendScale.innerHTML = colors.map(c => '<div style="background:' + c + '"></div>').join('');

            // Clear and redraw
            svg.selectAll('*').remove();
            const g = svg.append('g');

            // Draw features
            const features = currentLevel === 'state'
                ? topojson.feature(usTopoJson, usTopoJson.objects.states).features
                : topojson.feature(usTopoJson, usTopoJson.objects.counties).features;

            g.selectAll('path')
                .data(features)
                .enter()
                .append('path')
                .attr('class', currentLevel)
                .attr('d', path)
                .attr('fill', d => {
                    const id = String(d.id).padStart(currentLevel === 'state' ? 2 : 5, '0');
                    const data = dataMap[id];
                    if (!data) return '#1a1a1a';
                    return colorScale(data[currentMetric]);
                })
                .on('mouseover', function(event, d) {
                    const id = String(d.id).padStart(currentLevel === 'state' ? 2 : 5, '0');
                    const data = dataMap[id];
                    if (!data) return;

                    d3.select(this).raise();

                    const name = d.properties?.name || (currentLevel === 'state'
                        ? Object.keys(STATE_FIPS).find(k => STATE_FIPS[k] === id) || id
                        : 'County ' + id);

                    tooltip.html(
                        '<h3>' + name + '</h3>' +
                        '<div>Vehicles: <span class="value">' + formatNumber(data.count) + '</span></div>' +
                        '<div>Value: <span class="value">' + formatValue(data.value) + '</span></div>' +
                        '<div>Avg: <span class="value">' + formatValue(data.avg) + '</span></div>'
                    )
                    .style('opacity', 1)
                    .style('left', (event.pageX + 15) + 'px')
                    .style('top', (event.pageY - 10) + 'px');
                })
                .on('mouseout', function() {
                    tooltip.style('opacity', 0);
                });

            // Draw state boundaries on county view
            if (currentLevel === 'county') {
                g.append('path')
                    .datum(topojson.mesh(usTopoJson, usTopoJson.objects.states, (a, b) => a !== b))
                    .attr('fill', 'none')
                    .attr('stroke', '#444')
                    .attr('stroke-width', 1)
                    .attr('d', path);
            }
        }

        // Event listeners
        document.querySelectorAll('[data-level]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-level]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentLevel = btn.dataset.level;
                render();
            });
        });

        document.querySelectorAll('[data-metric]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-metric]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentMetric = btn.dataset.metric;
                render();
            });
        });

        // Initialize
        loadTopoJson();
    </script>
</body>
</html>`;

fs.writeFileSync('/Users/skylar/nuke/public/vehicle-map-static.html', html);
console.log('Generated vehicle-map-static.html');
console.log('State data:', stateData.stats);
console.log('County data:', countyData.stats);
