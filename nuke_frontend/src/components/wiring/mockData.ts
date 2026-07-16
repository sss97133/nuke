// mockData.ts — Offline mock data for wiring workspace when Supabase is unavailable.
// Generated from live DB snapshots. Remove when Supabase is restored.

import type { ManifestDevice } from './overlayCompute';

// Vehicle info
export const MOCK_VEHICLE = { year: 1977, make: 'Chevrolet', model: 'Blazer' };

// 138 devices from vehicle_build_manifest snapshot
// Source: live psql query on 2026-04-14
export const MOCK_MANIFEST: ManifestDevice[] = [
  // ── ENGINE MANAGEMENT (11) ─────────────────────────────
  { id: 'dev-m130', device_name: 'M130 ECU', device_category: 'engine_mgmt', manufacturer: 'Motec', model_number: 'M130', part_number: 'M130', pin_count: 60, power_draw_amps: 5, signal_type: 'ecu', connector_type: 'superseal_34pin+26pin', wire_gauge_recommended: 16, location_zone: 'engine_bay', price: 3500, purchased: true, product_image_url: 'https://racespeconline.com/cdn/shop/products/motec-m130-ecu.jpg', pct_complete: 90, pdm_controlled: false },
  { id: 'dev-pdm30', device_name: 'Power Distribution Module (PDM30)', device_category: 'engine_mgmt', manufacturer: 'Motec', model_number: 'PDM30', part_number: 'PDM30', pin_count: 60, power_draw_amps: 0, signal_type: 'pdm', connector_type: 'superseal_34pin+26pin', wire_gauge_recommended: 8, location_zone: 'dash', price: 3140, purchased: true, product_image_url: 'https://racespeconline.com/cdn/shop/products/motec-pdm30.jpg', pct_complete: 85, pdm_controlled: false },
  { id: 'dev-alt', device_name: 'Alternator', device_category: 'engine_mgmt', manufacturer: 'Powermaster', model_number: '37293', part_number: 'PWM-37293', pin_count: 5, power_draw_amps: 220, signal_type: 'alternator', connector_type: 'gm_4pin_rect+bat_stud', wire_gauge_recommended: 8, location_zone: 'engine_bay', price: 191.99, purchased: false, product_image_url: 'https://www.partsforspeed.com/pub/media/catalog/product/pmm37293.jpg', pct_complete: 80 },
  { id: 'dev-starter', device_name: 'Starter Motor', device_category: 'engine_mgmt', manufacturer: 'Denso', model_number: 'DFSR-8715', part_number: 'DFSR-8715', pin_count: 2, power_draw_amps: 150, signal_type: 'high_current', connector_type: 'ring_terminal_stud', wire_gauge_recommended: 4, location_zone: 'engine_bay', price: 250, purchased: true, product_image_url: 'https://m.media-amazon.com/images/I/61abc.jpg', pct_complete: 70 },
  { id: 'dev-bat', device_name: 'Battery', device_category: 'engine_mgmt', manufacturer: 'Optima', model_number: '8004-003', part_number: '8004-003', pin_count: 4, power_draw_amps: 0, signal_type: 'power_source', connector_type: 'dual_post_sae+gm', wire_gauge_recommended: 4, location_zone: 'engine_bay', price: 240, purchased: true, product_image_url: 'https://m.media-amazon.com/images/I/optima8004.jpg', pct_complete: 85 },
  { id: 'dev-batdisc', device_name: 'Battery Disconnect', device_category: 'engine_mgmt', manufacturer: 'Blue Sea', model_number: 'RBD-190', part_number: 'RBD-190', pin_count: 4, power_draw_amps: 190, signal_type: 'high_current', connector_type: 'ring_terminal_stud', wire_gauge_recommended: 4, location_zone: 'engine_bay', price: 300, purchased: true, product_image_url: null, pct_complete: 85 },
  { id: 'dev-bodygrnd', device_name: 'Body Ground Point', device_category: 'engine_mgmt', manufacturer: null, model_number: 'GRND-BODY', part_number: 'GRND-BODY', pin_count: 10, power_draw_amps: 0, signal_type: 'ground', connector_type: 'ring_terminal_m8', wire_gauge_recommended: 10, location_zone: 'dash', price: 15, purchased: false, pct_complete: 60 },
  { id: 'dev-stargrnd', device_name: 'Star Ground Point', device_category: 'engine_mgmt', manufacturer: null, model_number: 'GRND-STAR', part_number: 'GRND-STAR', pin_count: 10, power_draw_amps: 0, signal_type: 'ground', connector_type: 'ring_terminal_m8', wire_gauge_recommended: 8, location_zone: 'engine_bay', price: 15, purchased: false, pct_complete: 50 },
  { id: 'dev-canbus', device_name: 'CAN Bus Network', device_category: 'engine_mgmt', manufacturer: null, model_number: 'CAN-PAIR', part_number: 'CAN-PAIR', pin_count: 22, power_draw_amps: 0.05, signal_type: 'can_bus', connector_type: 'twisted_pair', wire_gauge_recommended: 22, location_zone: 'dash', price: 5, purchased: false, pct_complete: 40 },
  { id: 'dev-bulkhead', device_name: 'Bulkhead Disconnect', device_category: 'engine_mgmt', manufacturer: null, model_number: 'D38999', part_number: 'D38999-J61', pin_count: 61, power_draw_amps: 0, signal_type: 'passthrough', connector_type: 'mil_spec_D38999_26WA98SN', wire_gauge_recommended: 16, location_zone: 'firewall', price: 350, purchased: true, pct_complete: 75 },
  { id: 'dev-pdm15', device_name: 'Power Distribution Module (Secondary)', device_category: 'engine_mgmt', manufacturer: 'Motec', model_number: 'PDM15', part_number: 'PDM15', pin_count: 30, power_draw_amps: 0, signal_type: 'pdm', connector_type: 'superseal_26pin', wire_gauge_recommended: 10, location_zone: 'rear', price: 2200, purchased: false, pct_complete: 40 },

  // ── SENSORS (18) ───────────────────────────────────────
  ...generateSensors(),

  // ── FUEL INJECTORS (8) ─────────────────────────────────
  ...Array.from({ length: 8 }, (_, i) => ({
    id: `dev-inj${i + 1}`, device_name: `Fuel Injector ${i + 1}`, device_category: 'engine_mgmt',
    manufacturer: 'Bosch', model_number: '0280158821', part_number: '0280158821', pin_count: 2,
    power_draw_amps: 1.5, signal_type: 'injector', connector_type: 'ev6_uscar_2pin',
    wire_gauge_recommended: 18, location_zone: 'engine_bay', price: 45, purchased: true,
    product_image_url: 'https://m.media-amazon.com/images/I/bosch-inj.jpg', pct_complete: 90,
  })),

  // ── IGNITION COILS (8) ─────────────────────────────────
  ...Array.from({ length: 8 }, (_, i) => ({
    id: `dev-coil${i + 1}`, device_name: `Ignition Coil ${i + 1}`, device_category: 'engine_mgmt',
    manufacturer: 'ACDelco', model_number: 'D510C', part_number: '12611424', pin_count: 4,
    power_draw_amps: 6, signal_type: 'ignition_coil', connector_type: 'gm_coil_4pin',
    wire_gauge_recommended: 20, location_zone: 'engine_bay', price: 24, purchased: true,
    product_image_url: 'https://m.media-amazon.com/images/I/d510c.jpg', pct_complete: 85,
  })),

  // ── LIGHTING (22) ──────────────────────────────────────
  ...generateLighting(),

  // ── ACTUATORS (22) ─────────────────────────────────────
  ...generateActuators(),

  // ── BODY (19) ──────────────────────────────────────────
  ...generateBody(),

  // ── AUDIO (8) ──────────────────────────────────────────
  ...generateAudio(),

  // ── RELAY (7) ──────────────────────────────────────────
  ...generateRelays(),

  // ── REMAINING (brakes, drivetrain, accessories, etc) ───
  ...generateRemaining(),
];

function generateSensors(): ManifestDevice[] {
  const sensors = [
    { name: 'Crank Position Sensor', model: '12591720', amps: 0.05, sig: 'digital', pins: 3, price: 35, bought: true },
    { name: 'Cam Position Sensor', model: '12591720', amps: 0.05, sig: 'digital', pins: 3, price: 35, bought: true },
    { name: 'Coolant Temp Sensor (ECU)', model: '19236568', amps: 0.01, sig: 'analog_temp', pins: 2, price: 13, bought: false },
    { name: 'Oil Pressure Sensor (ECU)', model: '12616646', amps: 0.01, sig: 'analog_5v', pins: 3, price: 28, bought: false },
    { name: 'MAP Sensor', model: '12592525', amps: 0.01, sig: 'analog_5v', pins: 3, price: 40, bought: false },
    { name: 'Oil Temperature Sensor', model: '12146312', amps: 0.01, sig: 'analog_temp', pins: 2, price: 18, bought: false },
    // 12605109 = GM LS3 DBW throttle body assembly (6-pin, includes TPS1+TPS2+motor).
    // A standalone 3-wire TPS doesn't exist on LS3 — the ETB covers it (see generateActuators).
    // Keeping as a sensor entry is misleading. Pin count = 3 (single TPS channel) until this is reconciled.
    { name: 'Throttle Position Sensor', model: 'TPS-3WIRE-TBD', amps: 0.01, sig: 'analog_5v', pins: 3, price: 0, bought: false },
    { name: 'Knock Sensor Bank 1', model: '12589867', amps: 0.01, sig: 'piezoelectric', pins: 1, price: 25, bought: false },
    { name: 'Knock Sensor Bank 2', model: '12589867', amps: 0.01, sig: 'piezoelectric', pins: 1, price: 25, bought: false },
    { name: 'Wideband O2 Sensor', model: 'LSU4.9', amps: 2, sig: 'wideband_lambda', pins: 6, price: 85, bought: false },
    { name: 'Vehicle Speed Sensor', model: 'VSS-GM', amps: 0.01, sig: 'digital', pins: 2, price: 30, bought: false },
    { name: 'A/C Pressure Switch High', model: '36680', amps: 0.01, sig: 'switch', pins: 2, price: 25, bought: false },
    { name: 'A/C Pressure Switch Low', model: '36680', amps: 0.01, sig: 'switch', pins: 2, price: 25, bought: false },
    { name: 'Fuel Pressure Sensor', model: '12614969', amps: 0.01, sig: 'analog_5v', pins: 3, price: 35, bought: false },
    { name: 'Fuel Level Sender', model: 'FLS-K5', amps: 0.01, sig: 'analog_5v', pins: 2, price: 45, bought: false },
    { name: 'Crankshaft Position Sensor', model: '12615626', amps: 0.05, sig: 'digital', pins: 3, price: 20, bought: false },
    { name: 'Exhaust Gas Temperature', model: 'EGT-K', amps: 0.01, sig: 'analog_temp', pins: 2, price: 60, bought: false },
    { name: 'Intake Air Temperature', model: 'IAT-LS', amps: 0.01, sig: 'analog_temp', pins: 2, price: 15, bought: false },
  ];
  return sensors.map((s, i) => ({
    id: `dev-sen${i}`, device_name: s.name, device_category: 'sensors',
    manufacturer: 'ACDelco', model_number: s.model, part_number: s.model,
    pin_count: s.pins, power_draw_amps: s.amps, signal_type: s.sig,
    connector_type: s.pins <= 2 ? 'metri_pack_2pin' : 'metri_pack_3pin',
    wire_gauge_recommended: 22, location_zone: 'engine_bay', price: s.price,
    purchased: s.bought, product_image_url: `https://m.media-amazon.com/images/I/sensor-${s.model}.jpg`,
    pct_complete: s.bought ? 75 : 45,
  }));
}

function generateLighting(): ManifestDevice[] {
  const lights = [
    'LED Headlight Left', 'LED Headlight Right', 'Parking Light Left Front', 'Parking Light Right Front',
    'Turn Signal Left Front', 'Turn Signal Right Front', 'Side Marker Front Left', 'Side Marker Front Right',
    'Tail Light Left', 'Tail Light Right', 'Backup Light Left', 'Backup Light Right',
    'Third Brake Light', 'License Plate Light', 'Cab Clearance Light Left', 'Cab Clearance Light Center',
    'Cab Clearance Light Right', 'Side Marker Rear Left', 'Side Marker Rear Right',
    'Door Puddle Light Left', 'Door Puddle Light Right', 'Cargo/Bed Light',
  ];
  return lights.map((name, i) => {
    const isRear = /tail|backup|third|license|cargo|rear/i.test(name);
    const isDoor = /door|puddle/i.test(name);
    return {
      id: `dev-lt${i}`, device_name: name, device_category: 'lighting',
      manufacturer: i < 2 ? 'JW Speaker' : 'Diode Dynamics', model_number: i < 2 ? 'JW-8700' : '36469',
      part_number: i < 2 ? 'JW-8700' : '36469', pin_count: i < 2 ? 3 : 2,
      power_draw_amps: i < 2 ? 4.5 : /cab|marker|puddle/i.test(name) ? 0.3 : 1.5,
      signal_type: 'led_lighting', connector_type: i < 2 ? 'h4_3blade' : 'weatherpack_2pin',
      wire_gauge_recommended: 18, location_zone: isRear ? 'rear' : isDoor ? 'doors' : 'engine_bay',
      price: i < 2 ? 350 : /cab|marker/i.test(name) ? 15 : 12, purchased: i < 14,
      product_image_url: `https://m.media-amazon.com/images/I/light-${i}.jpg`,
      pct_complete: i < 14 ? 60 : 50,
    };
  });
}

function generateActuators(): ManifestDevice[] {
  const actuators = [
    { name: 'Electronic Throttle Body', amps: 5, sig: 'h_bridge_motor', pins: 6, conn: 'gm_dbw_6pin', zone: 'engine_bay', price: 180, bought: true },
    { name: 'Radiator Fan 1', amps: 18, sig: 'motor', pins: 2, conn: 'weatherpack_2pin', zone: 'engine_bay', price: 85, bought: false },
    { name: 'Radiator Fan 2', amps: 18, sig: 'motor', pins: 2, conn: 'weatherpack_2pin', zone: 'engine_bay', price: 85, bought: false },
    { name: 'Electric Water Pump', amps: 10, sig: 'motor', pins: 2, conn: 'deutsch_dt_2pin', zone: 'engine_bay', price: 260, bought: false },
    { name: 'A/C Compressor Clutch', amps: 4, sig: 'motor', pins: 1, conn: 'weatherpack_2pin', zone: 'engine_bay', price: 45, bought: false },
    { name: 'Windshield Wiper Motor', amps: 6, sig: 'motor', pins: 5, conn: 'gm_column_multipin', zone: 'dash', price: 85, bought: false },
    { name: 'Washer Pump', amps: 3, sig: 'motor', pins: 2, conn: 'weatherpack_2pin', zone: 'engine_bay', price: 20, bought: false },
    { name: 'Power Window Motor Left', amps: 8, sig: 'motor', pins: 2, conn: 'gm_window_switch', zone: 'doors', price: 65, bought: false },
    { name: 'Power Window Motor Right', amps: 8, sig: 'motor', pins: 2, conn: 'gm_window_switch', zone: 'doors', price: 65, bought: false },
    { name: 'Lock/Unlock Actuator Left', amps: 3, sig: 'motor', pins: 5, conn: 'gm_lock_switch_5pin', zone: 'doors', price: 40, bought: false },
    { name: 'Lock/Unlock Actuator Right', amps: 3, sig: 'motor', pins: 5, conn: 'gm_lock_switch_5pin', zone: 'doors', price: 40, bought: false },
    { name: 'Heater Blower Motor', amps: 15, sig: 'motor', pins: 2, conn: 'gm_blower_5pin', zone: 'dash', price: 55, bought: false },
    { name: 'Horn', amps: 4, sig: 'motor', pins: 2, conn: 'blade_terminal', zone: 'engine_bay', price: 25, bought: false },
    { name: 'Fuel Pump', amps: 8, sig: 'motor', pins: 2, conn: 'weatherpack_2pin', zone: 'rear', price: 120, bought: true },
    { name: 'E-Stopp Actuator', amps: 2, sig: 'motor', pins: 2, conn: 'deutsch_dt_2pin', zone: 'rear', price: 450, bought: false },
    { name: 'AMP Research Step Left', amps: 8, sig: 'motor', pins: 14, conn: 'direct_harness', zone: 'underbody', price: 900, bought: true },
    { name: 'AMP Research Step Right', amps: 8, sig: 'motor', pins: 14, conn: 'direct_harness', zone: 'underbody', price: 900, bought: true },
    { name: 'QTP Electric Exhaust Cutout Left', amps: 10, sig: 'motor', pins: 2, conn: 'weatherpack_2pin', zone: 'underbody', price: 250, bought: false },
    { name: 'QTP Electric Exhaust Cutout Right', amps: 10, sig: 'motor', pins: 2, conn: 'weatherpack_2pin', zone: 'underbody', price: 250, bought: false },
    { name: 'Starter Solenoid', amps: 30, sig: 'high_current', pins: 3, conn: 'ring_terminal_stud', zone: 'engine_bay', price: 35, bought: false },
    { name: 'Power Seat Motor', amps: 5, sig: 'motor', pins: 4, conn: 'gm_4pin_rect', zone: 'dash', price: 45, bought: false },
    { name: 'Underhood Light', amps: 1, sig: 'led_lighting', pins: 2, conn: 'weatherpack_2pin', zone: 'engine_bay', price: 15, bought: false },
  ];
  return actuators.map((a, i) => ({
    id: `dev-act${i}`, device_name: a.name, device_category: 'actuators',
    manufacturer: 'OEM', model_number: a.name.replace(/\s+/g, '-'), part_number: a.name.replace(/\s+/g, '-'),
    pin_count: a.pins, power_draw_amps: a.amps, signal_type: a.sig,
    connector_type: a.conn, wire_gauge_recommended: a.amps > 10 ? 12 : a.amps > 5 ? 14 : 18,
    location_zone: a.zone, price: a.price, purchased: a.bought,
    product_image_url: `https://m.media-amazon.com/images/I/act-${i}.jpg`,
    pct_complete: a.bought ? 70 : 40,
  }));
}

function generateBody(): ManifestDevice[] {
  const body = [
    { name: 'Headlight Switch', zone: 'dash', pins: 8 },
    { name: 'Turn Signal Switch', zone: 'dash', pins: 9 },
    { name: 'Hazard Flasher', zone: 'dash', pins: 3 },
    { name: 'Floor Dimmer Switch (Beam Selector)', zone: 'dash', pins: 3 },
    { name: 'Wiper/Washer Switch', zone: 'dash', pins: 5 },
    { name: 'Window Switch Master (Driver)', zone: 'doors', pins: 10 },
    { name: 'Window Switch Passenger', zone: 'doors', pins: 4 },
    { name: 'Door Switch Left', zone: 'doors', pins: 2 },
    { name: 'Door Switch Right', zone: 'doors', pins: 2 },
    { name: 'Blower Speed Switch/Control', zone: 'dash', pins: 14 },
    { name: 'Cigarette Lighter / 12V Outlet', zone: 'dash', pins: 14 },
    { name: 'USB Charge Port', zone: 'dash', pins: 4 },
    { name: 'Ignition Switch', zone: 'dash', pins: 7 },
    { name: 'Neutral Safety Switch', zone: 'underbody', pins: 4 },
    { name: 'Reverse Light Switch', zone: 'underbody', pins: 2 },
    { name: 'Brake Light Switch', zone: 'dash', pins: 4 },
    { name: 'Transfer Case Indicator', zone: 'underbody', pins: 3 },
    { name: 'Footwell Light', zone: 'dash', pins: 2 },
    { name: 'Under-Dash LED Light', zone: 'dash', pins: 2 },
  ];
  return body.map((b, i) => ({
    id: `dev-body${i}`, device_name: b.name, device_category: 'body',
    manufacturer: 'GM', model_number: b.name.replace(/\s+/g, '-'), part_number: `BODY-${i}`,
    pin_count: b.pins, power_draw_amps: 0.01, signal_type: 'switch',
    connector_type: b.pins <= 2 ? 'blade_terminal' : b.pins <= 4 ? 'metri_pack_3pin' : 'gm_column_multipin',
    wire_gauge_recommended: 18, location_zone: b.zone, price: 20, purchased: false,
    product_image_url: `https://m.media-amazon.com/images/I/body-${i}.jpg`,
    pct_complete: 65,
  }));
}

function generateAudio(): ManifestDevice[] {
  const audio = [
    { name: 'Hermosa Head Unit', amps: 2, pins: 12, price: 800, zone: 'dash' },
    { name: 'Amplifier', amps: 30, pins: 8, price: 230, zone: 'rear' },
    { name: 'Speaker Front Left', amps: 2, pins: 2, price: 60, zone: 'doors' },
    { name: 'Speaker Front Right', amps: 2, pins: 2, price: 60, zone: 'doors' },
    { name: 'Speaker Rear Left', amps: 2, pins: 2, price: 60, zone: 'rear' },
    { name: 'Speaker Rear Right', amps: 2, pins: 2, price: 60, zone: 'rear' },
    { name: 'Subwoofer', amps: 10, pins: 2, price: 150, zone: 'rear' },
    { name: 'AM/FM Antenna', amps: 0.1, pins: 2, price: 25, zone: 'dash' },
  ];
  return audio.map((a, i) => ({
    id: `dev-aud${i}`, device_name: a.name, device_category: 'audio',
    manufacturer: i === 0 ? 'Hermosa' : i === 1 ? 'Kicker' : 'JBL',
    model_number: a.name.replace(/\s+/g, '-'), part_number: `AUD-${i}`,
    pin_count: a.pins, power_draw_amps: a.amps, signal_type: 'audio',
    connector_type: a.pins <= 2 ? 'speaker_quick_connect' : 'iso_din_plug_a_b',
    wire_gauge_recommended: a.amps > 5 ? 12 : 18, location_zone: a.zone,
    price: a.price, purchased: i < 1, product_image_url: `https://m.media-amazon.com/images/I/audio-${i}.jpg`,
    pct_complete: 63,
  }));
}

function generateRelays(): ManifestDevice[] {
  const relays = [
    'Fuel Pump Relay', 'Amplifier Relay', 'Bosch iBooster Relay',
    'Polarity Reversing Relay 1', 'Polarity Reversing Relay 2',
    'Polarity Reversing Relay 3', 'Polarity Reversing Relay 4',
  ];
  return relays.map((name, i) => ({
    id: `dev-rel${i}`, device_name: name, device_category: 'relay',
    manufacturer: 'Bosch', model_number: '007794301', part_number: '007794301',
    pin_count: 5, power_draw_amps: 0.2, signal_type: 'switch',
    connector_type: 'iso_mini_relay_5pin', wire_gauge_recommended: 22,
    location_zone: i < 3 ? 'dash' : 'underbody', price: 25, purchased: false,
    product_image_url: `https://m.media-amazon.com/images/I/relay.jpg`, pct_complete: 0,
  }));
}

function generateRemaining(): ManifestDevice[] {
  // Per-item real manufacturer/part#/connector. Use undefined when genuinely unknown —
  // the panel renders "unknown connector / not on file" honestly instead of fabricating.
  const items: Array<{
    name: string; cat: string; amps: number; pins: number; zone: string;
    price: number; bought: boolean; mfr?: string; part?: string; conn?: string;
  }> = [
    { name: 'Bosch V4 Electric Brake Booster', cat: 'brakes', amps: 40, pins: 10, zone: 'engine_bay', price: 440, bought: true,
      mfr: 'Bosch', part: 'iBooster-V4' /* proprietary 10-pin plug */ },
    { name: 'SGI-100BT Signal Bridge', cat: 'brakes', amps: 0.5, pins: 6, zone: 'engine_bay', price: 200, bought: false,
      mfr: 'Dakota Digital', part: 'SGI-100BT' },
    { name: 'Dakota Digital Gauge Controller', cat: 'instrumentation', amps: 3, pins: 20, zone: 'dash', price: 800, bought: false,
      mfr: 'Dakota Digital', part: 'VHX-2000' /* VHX BIM controller: proprietary multi-pin harness */ },
    { name: 'AMP Research Controller', cat: 'accessories', amps: 8, pins: 14, zone: 'underbody', price: 2264, bought: true,
      mfr: 'AMP Research', part: '76404-01A-B' },
    { name: 'E-Stopp Controller Box', cat: 'controller', amps: 2, pins: 8, zone: 'dash', price: 200, bought: false,
      mfr: 'E-Stopp', part: 'ES-500' },
    { name: 'E-Stopp Dash Switch', cat: 'safety', amps: 0.1, pins: 3, zone: 'dash', price: 50, bought: false,
      mfr: 'E-Stopp', part: 'ES-SW-3', conn: 'metri_pack_3pin' },
    // Routing items — not electrical, no connector
    { name: 'Firewall Grommet', cat: 'routing', amps: 0, pins: 0, zone: 'firewall', price: 15, bought: false },
    { name: 'Door Boot Left', cat: 'routing', amps: 0, pins: 0, zone: 'doors', price: 20, bought: false },
    { name: 'Door Boot Right', cat: 'routing', amps: 0, pins: 0, zone: 'doors', price: 20, bought: false },
  ];
  return items.map((it, i) => ({
    id: `dev-misc${i}`, device_name: it.name, device_category: it.cat,
    manufacturer: it.mfr, model_number: it.part, part_number: it.part,
    pin_count: it.pins, power_draw_amps: it.amps,
    signal_type: it.pins === 0 ? 'passthrough' : (it.amps > 5 ? 'high_current' : 'switch'),
    connector_type: it.conn,  // undefined when proprietary/unknown — honest
    wire_gauge_recommended: it.amps > 10 ? 12 : 18,
    location_zone: it.zone, price: it.price, purchased: it.bought,
    pct_complete: it.bought ? 80 : 42,
  }));
}
