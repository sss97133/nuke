// Shared vehicle data for all wireframes
// 12 vehicles with novel Nuke data fields

const VEHICLES = [
  {
    id: 1,
    year: 1989, make: 'PORSCHE', model: '911 CARRERA 4', series: 'COUPE BY SINGER',
    img: 'https://bringatrailer.com/wp-content/uploads/2024/08/1989_porsche_911_carrera_4_dsc_0024-scaled.jpg',
    source: 'BAT', status: 'LIVE', timeLabel: 'ENDS 1D',
    bid: 901000, bidLabel: '$901,000',
    estimateLow: 780000, estimateHigh: 1100000, estimateMid: 940000,
    estimateLabel: '$780K–$1.1M',
    delta: -4, deltaLabel: '4% BELOW', deltaDir: 'below',
    dealScore: 52, dealLabel: 'GOOD',
    heatScore: 47, heatMax: 55,
    dataCompleteness: 89,
    bidCount: 47, imageCount: 92,
    location: 'MONTEREY, CA',
    body: 'COUPE', trans: 'MANUAL', miles: '62,000',
  },
  {
    id: 2,
    year: 2003, make: 'BMW', model: 'M3', series: 'COUPE 6-SPEED',
    img: 'https://bringatrailer.com/wp-content/uploads/2024/03/2003_bmw_m3_dsc06698-scaled.jpg',
    source: 'BAT', status: 'LIVE', timeLabel: 'ENDS 1D',
    bid: 5000, bidLabel: '$5,000',
    estimateLow: 6000, estimateHigh: 11000, estimateMid: 8500,
    estimateLabel: '$6K–$11K',
    delta: -41, deltaLabel: '41% BELOW', deltaDir: 'below',
    dealScore: 82, dealLabel: 'STEAL',
    heatScore: 38, heatMax: 55,
    dataCompleteness: 72,
    bidCount: 31, imageCount: 64,
    location: 'DALLAS, TX',
    body: 'COUPE', trans: 'MANUAL', miles: '134,000',
  },
  {
    id: 3,
    year: 1997, make: 'TOYOTA', model: 'LAND CRUISER', series: 'HZJ75 TROOPY 5-SPEED',
    img: 'https://bringatrailer.com/wp-content/uploads/2024/06/1997_toyota_land-cruiser_img_3893-2-scaled.jpg',
    source: 'BAT', status: 'LIVE', timeLabel: 'ENDS 1D',
    bid: 16000, bidLabel: '$16,000',
    estimateLow: 11000, estimateHigh: 18000, estimateMid: 14500,
    estimateLabel: '$11K–$18K',
    delta: 10, deltaLabel: '10% ABOVE', deltaDir: 'above',
    dealScore: 35, dealLabel: 'FAIR',
    heatScore: 52, heatMax: 55,
    dataCompleteness: 65,
    bidCount: 22, imageCount: 78,
    location: 'PORTLAND, OR',
    body: 'SUV', trans: 'MANUAL', miles: '185,000',
  },
  {
    id: 4,
    year: 2026, make: 'MERCEDES-AMG', model: 'G63', series: 'ARMORED',
    img: 'https://bringatrailer.com/wp-content/uploads/2024/09/2024_mercedes-benz_g-class_amg-g-63_img_0529-scaled.jpg',
    source: 'BAT', status: 'LIVE', timeLabel: 'ENDS 10H',
    bid: 125000, bidLabel: '$125,000',
    estimateLow: 220000, estimateHigh: 310000, estimateMid: 265000,
    estimateLabel: '$220K–$310K',
    delta: -53, deltaLabel: '53% BELOW', deltaDir: 'below',
    dealScore: 91, dealLabel: 'STEAL',
    heatScore: 44, heatMax: 55,
    dataCompleteness: 58,
    bidCount: 38, imageCount: 45,
    location: 'MIAMI, FL',
    body: 'SUV', trans: 'AUTO', miles: '1,200',
  },
  {
    id: 5,
    year: 2007, make: 'BENTLEY', model: 'CONTINENTAL GTC', series: '',
    img: 'https://bringatrailer.com/wp-content/uploads/2023/09/2007_bentley_continental-gtc_img_6841-scaled.jpg',
    source: 'BAT', status: 'LIVE', timeLabel: 'ENDS 1D',
    bid: 1200, bidLabel: '$1,200',
    estimateLow: 18000, estimateHigh: 32000, estimateMid: 25000,
    estimateLabel: '$18K–$32K',
    delta: -95, deltaLabel: '95% BELOW', deltaDir: 'below',
    dealScore: 97, dealLabel: 'STEAL',
    heatScore: 51, heatMax: 55,
    dataCompleteness: 44,
    bidCount: 8, imageCount: 52,
    location: 'HOUSTON, TX',
    body: 'CONVERTIBLE', trans: 'AUTO', miles: '72,000',
  },
  {
    id: 6,
    year: 2014, make: 'BMW', model: 'M6', series: 'COMPETITION PACKAGE',
    img: 'https://bringatrailer.com/wp-content/uploads/2023/10/2014_bmw_m6_competition-package_img_7182-1-scaled.jpg',
    source: 'BAT', status: 'LIVE', timeLabel: 'ENDS 1D',
    bid: 10250, bidLabel: '$10,250',
    estimateLow: 22000, estimateHigh: 35000, estimateMid: 28500,
    estimateLabel: '$22K–$35K',
    delta: -64, deltaLabel: '64% BELOW', deltaDir: 'below',
    dealScore: 88, dealLabel: 'STEAL',
    heatScore: 33, heatMax: 55,
    dataCompleteness: 77,
    bidCount: 19, imageCount: 88,
    location: 'SCOTTSDALE, AZ',
    body: 'COUPE', trans: 'AUTO', miles: '48,000',
  },
  {
    id: 7,
    year: 1960, make: 'CHEVROLET', model: 'CORVETTE', series: '',
    img: 'https://bringatrailer.com/wp-content/uploads/2023/08/1960_chevrolet_corvette_dsc_0218-scaled.jpg',
    source: 'BAT', status: 'LIVE', timeLabel: 'ENDS 8H',
    bid: 41000, bidLabel: '$41,000',
    estimateLow: 55000, estimateHigh: 85000, estimateMid: 70000,
    estimateLabel: '$55K–$85K',
    delta: -41, deltaLabel: '41% BELOW', deltaDir: 'below',
    dealScore: 79, dealLabel: 'GREAT',
    heatScore: 49, heatMax: 55,
    dataCompleteness: 82,
    bidCount: 33, imageCount: 71,
    location: 'GREENWICH, CT',
    body: 'CONVERTIBLE', trans: 'MANUAL', miles: '78,000',
  },
  {
    id: 8,
    year: 1998, make: 'JAGUAR', model: 'XJR', series: '',
    img: 'https://bringatrailer.com/wp-content/uploads/2023/11/1998_jaguar_xjr_img_3012-scaled.jpg',
    source: 'BAT', status: 'LIVE', timeLabel: 'ENDS 1D',
    bid: 2500, bidLabel: '$2,500',
    estimateLow: 4000, estimateHigh: 8000, estimateMid: 6000,
    estimateLabel: '$4K–$8K',
    delta: -58, deltaLabel: '58% BELOW', deltaDir: 'below',
    dealScore: 84, dealLabel: 'STEAL',
    heatScore: 21, heatMax: 55,
    dataCompleteness: 61,
    bidCount: 14, imageCount: 55,
    location: 'CHICAGO, IL',
    body: 'SEDAN', trans: 'AUTO', miles: '91,000',
  },
  {
    id: 9,
    year: 1996, make: 'GMC', model: 'SIERRA', series: 'K1500 SLE 4X4',
    img: 'https://bringatrailer.com/wp-content/uploads/2024/01/1996_gmc_sierra-1500_dsc_0014-scaled.jpg',
    source: 'BAT', status: 'LIVE', timeLabel: 'ENDS 9H',
    bid: 8000, bidLabel: '$8,000',
    estimateLow: 7000, estimateHigh: 14000, estimateMid: 10500,
    estimateLabel: '$7K–$14K',
    delta: -24, deltaLabel: '24% BELOW', deltaDir: 'below',
    dealScore: 67, dealLabel: 'GREAT',
    heatScore: 29, heatMax: 55,
    dataCompleteness: 55,
    bidCount: 16, imageCount: 62,
    location: 'BOZEMAN, MT',
    body: 'PICKUP', trans: 'AUTO', miles: '142,000',
  },
  {
    id: 10,
    year: 2009, make: 'MERCEDES-BENZ', model: 'SL550', series: '',
    img: 'https://bringatrailer.com/wp-content/uploads/2023/06/2009_mercedes-benz_sl550_img_0019-scaled.jpg',
    source: 'BAT', status: 'LIVE', timeLabel: 'ENDS 2D',
    bid: 600, bidLabel: '$600',
    estimateLow: 12000, estimateHigh: 22000, estimateMid: 17000,
    estimateLabel: '$12K–$22K',
    delta: -96, deltaLabel: '96% BELOW', deltaDir: 'below',
    dealScore: 98, dealLabel: 'STEAL',
    heatScore: 42, heatMax: 55,
    dataCompleteness: 68,
    bidCount: 6, imageCount: 44,
    location: 'NAPLES, FL',
    body: 'CONVERTIBLE', trans: 'AUTO', miles: '65,000',
  },
  {
    id: 11,
    year: 1965, make: 'ALFA ROMEO', model: '2600 SPRINT', series: '',
    img: 'https://bringatrailer.com/wp-content/uploads/2024/02/1965_alfa-romeo_2600-sprint_img_4516-scaled.jpg',
    source: 'BAT', status: 'LIVE', timeLabel: 'ENDS 1D',
    bid: 2600, bidLabel: '$2,600',
    estimateLow: 25000, estimateHigh: 45000, estimateMid: 35000,
    estimateLabel: '$25K–$45K',
    delta: -93, deltaLabel: '93% BELOW', deltaDir: 'below',
    dealScore: 96, dealLabel: 'STEAL',
    heatScore: 36, heatMax: 55,
    dataCompleteness: 51,
    bidCount: 11, imageCount: 67,
    location: 'SAVANNAH, GA',
    body: 'COUPE', trans: 'MANUAL', miles: 'N/A',
  },
  {
    id: 12,
    year: 2019, make: 'MINI', model: 'COOPER S', series: 'SIGNATURE HARDTOP 4-DOOR',
    img: 'https://bringatrailer.com/wp-content/uploads/2024/04/2019_mini_cooper-s_img_5432-scaled.jpg',
    source: 'BAT', status: 'LIVE', timeLabel: 'ENDS 1D',
    bid: 8000, bidLabel: '$8,000',
    estimateLow: 14000, estimateHigh: 20000, estimateMid: 17000,
    estimateLabel: '$14K–$20K',
    delta: -53, deltaLabel: '53% BELOW', deltaDir: 'below',
    dealScore: 83, dealLabel: 'STEAL',
    heatScore: 18, heatMax: 55,
    dataCompleteness: 81,
    bidCount: 21, imageCount: 54,
    location: 'DENVER, CO',
    body: 'HATCHBACK', trans: 'AUTO', miles: '32,000',
  },
];

// Utility functions
function deltaColor(dir) {
  if (dir === 'below') return 'var(--success)';
  if (dir === 'above') return 'var(--error)';
  return 'var(--text-secondary)';
}

function deltaBg(dir) {
  if (dir === 'below') return 'var(--success-dim)';
  if (dir === 'above') return 'var(--error-dim)';
  return 'transparent';
}

function dealColor(label) {
  if (label === 'STEAL') return 'var(--success)';
  if (label === 'GREAT') return 'var(--success)';
  if (label === 'GOOD') return 'var(--text-secondary)';
  if (label === 'FAIR') return 'var(--text-disabled)';
  if (label === 'ABOVE') return 'var(--warning)';
  if (label === 'OVER') return 'var(--error)';
  return 'var(--text-secondary)';
}

function heatBar(score, max) {
  const pct = Math.round((score / max) * 100);
  return pct;
}

function formatTitle(v) {
  const parts = [v.year, v.make, v.model];
  if (v.series) parts.push(v.series);
  return parts.join(' ');
}

function shortTitle(v) {
  return `${v.year} ${v.make} ${v.model}`;
}

// Theme toggle
function toggleTheme() {
  const html = document.documentElement;
  const btn = document.querySelector('.theme-toggle');
  if (html.getAttribute('data-theme') === 'dark') {
    html.removeAttribute('data-theme');
    btn.textContent = 'DARK';
  } else {
    html.setAttribute('data-theme', 'dark');
    btn.textContent = 'LIGHT';
  }
}
