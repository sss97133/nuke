// k5Subsystems.ts — K5 subsystem registry (typed data, no logic)
//
// PROVENANCE: faithful port of docs/wiring/calc-data/subsystems.json
// (generated from /Users/skylar/k5-harness-pull/devices.json 141 devices +
// docs/wiring/output/K5_cut_list_v3.txt 123 wires + 22 companions = 145).
// Wire IDs are cut-list IDs. Suffixes: g = ground return, r = 5V ref,
// s = shield drain. INJ_PWR / COIL_PWR / COIL_GND are addendum bus rails.
// total_amps = sum of device nameplate amps (worst-case simultaneous peak;
// coils/injectors are pulsed peak, not continuous).
//
// The 17 cut-list v4 addendum wires (#114-#126, #85a/b, #86a/b) postdate
// subsystems.json and are assigned in V4_WIRE_SUBSYSTEMS below.

export interface K5Subsystem {
  toggleable: boolean;
  devices: string[];
  wireIds: string[];
  totalAmps: number;
  pdmChannels: string[];
  zones: string[];
  ampsNote?: string;
  note?: string;
  crossDependency?: string;
}

// Key order matters: derivation emits wires in this order (matches the
// python engine scripts/k5_harness_calc.py iterating subsystems.json).
export const K5_SUBSYSTEMS: Record<string, K5Subsystem> = {
  CORE_ENGINE: {
    toggleable: false,
    devices: [
      'ECU', 'Power Distribution Module', 'CAN Bus Network', 'MoTeC 8-Button Keypad',
      'Display/Dash', 'Accelerator Pedal Sensor (APS)', 'Electronic Throttle Body',
      'Throttle Position Sensor 1', 'Throttle Position Sensor 2',
      'Ignition Coil 1', 'Ignition Coil 2', 'Ignition Coil 3', 'Ignition Coil 4',
      'Ignition Coil 5', 'Ignition Coil 6', 'Ignition Coil 7', 'Ignition Coil 8',
      'Fuel Injector 1', 'Fuel Injector 2', 'Fuel Injector 3', 'Fuel Injector 4',
      'Fuel Injector 5', 'Fuel Injector 6', 'Fuel Injector 7', 'Fuel Injector 8',
      'Crank Position Sensor', 'Cam Position Sensor', 'MAP Sensor',
      'Intake Air Temp Sensor', 'Coolant Temp Sensor (ECU)', 'Oil Pressure Sensor (ECU)',
      'Oil Temperature Sensor', 'Knock Sensor Bank 1', 'Knock Sensor Bank 2',
      'Fuel Pressure Sensor', 'Wideband Lambda Controller', 'Wideband O2 Sensor 1',
      'Wideband O2 Sensor 2', 'Vehicle Speed Sensor',
    ],
    wireIds: [
      '4a', '4b', '4c', '4d', '4e', '4f', '5', '7', '8', '9', '10', '11', '12', '24',
      '13', '14', '15', '16', '17', '18', '19', '20', '60', '61', '62', '64', '65',
      '99', '100', '101', '102', '103', '104', '106', '107', '108', '109', '110',
      '112', '113',
      '99g', '99r', '99s', '101g', '101r', '101s', '102g', '102r', '103g', '103s',
      '104g', '104s', '108g', '108r', '109g', '110g', '112g', '112r', '113g',
      'INJ_PWR', 'COIL_PWR', 'COIL_GND',
    ],
    totalAmps: 76.9,
    ampsNote: 'Peak; coils 32A + injectors 32A are pulsed, continuous draw far lower. ETB 5A, WB controller 3A, ECU 2A.',
    pdmChannels: ['OUT24 (WB controller)', 'OUT29 (Display/Dash)', 'OUT_TBD (INJ_PWR)', 'OUT_TBD (COIL_PWR)'],
    zones: ['dash', 'engine_bay', 'underbody', 'firewall'],
  },
  FUEL: {
    toggleable: true,
    devices: ['Fuel Pump Relay', 'Fuel Pressure Regulator', 'Fuel Level Sender'],
    wireIds: ['66', '94', '98'],
    totalAmps: 35.2,
    ampsNote: '35A is the Fuel Pressure Regulator (PWM pump controller) feed — pump draws through it.',
    pdmChannels: ['PDM30:unspecified (#94 fuel pump relay)'],
    zones: ['rear', 'engine_bay'],
  },
  COOLING: {
    toggleable: true,
    devices: ['Radiator Fan 1', 'Radiator Fan 2', 'Electric Water Pump'],
    wireIds: ['21', '22', '25'],
    totalAmps: 46.0,
    pdmChannels: ['OUT1', 'OUT2', 'OUT5'],
    zones: ['engine_bay'],
  },
  CHARGING_STARTING: {
    toggleable: false,
    devices: ['Alternator', 'Battery', 'Battery Disconnect', 'Starter Motor', 'Ignition Switch'],
    wireIds: ['6', '40', '59', '63'],
    totalAmps: 200.0,
    ampsNote: '200A = starter cranking peak. Alternator is 220A SOURCE, not load. 0 AWG direct battery runs — no PDM channels.',
    pdmChannels: [],
    zones: ['engine_bay', 'dash'],
  },
  BRAKES_IBOOSTER: {
    toggleable: true,
    devices: ['Bosch V4 Electric Brake Booster', 'Bosch iBooster Relay', 'Brake Light Switch'],
    wireIds: ['52', '53', '95'],
    totalAmps: 40.2,
    pdmChannels: ['PDM30:unspecified (#95 iBooster relay)'],
    zones: ['engine_bay', 'firewall', 'dash'],
    crossDependency: 'Brake Light Switch (#53) also feeds LIGHTING_EXTERIOR brake lamps and TRANS_6L80E TC unlock — keep #53 if either is on.',
  },
  EPARKING_BRAKE: {
    toggleable: true,
    devices: ['E-Stopp Dash Switch', 'E-Stopp Controller Box', 'E-Stopp Actuator'],
    wireIds: ['54'],
    totalAmps: 10.1,
    ampsNote: 'Actuator (10A) draws through controller — not double-counted.',
    pdmChannels: ['OUT7'],
    zones: ['dash', 'rear', 'underbody'],
  },
  TRANS_6L80E: {
    toggleable: true,
    devices: ['Transmission Controller', 'Neutral Safety Switch', 'Reverse Light Switch', 'Transfer Case Indicator'],
    wireIds: ['55', '56', '57', '58'],
    totalAmps: 3.0,
    pdmChannels: ['OUT23 (controller)', 'PDM30:unspecified (#55, #56, #57 inputs)'],
    zones: ['dash', 'underbody'],
    crossDependency: 'Reverse Light Switch (#57) feeds LIGHTING_EXTERIOR backup lights and CAMERA_REAR trigger.',
  },
  LIGHTING_EXTERIOR: {
    toggleable: true,
    devices: [
      'Headlight Switch', 'Turn Signal Switch', 'Hazard Flasher', 'Floor Dimmer Switch (Beam Selector)',
      'LED Headlight Left', 'LED Headlight Right', 'Parking Light Left Front', 'Parking Light Right Front',
      'Turn Signal Left Front', 'Turn Signal Right Front', 'Side Marker Front Left', 'Side Marker Front Right',
      'Side Marker Rear Left', 'Side Marker Rear Right', 'Tail Light Left', 'Tail Light Right',
      'Backup Light Left', 'Backup Light Right', 'License Plate Light', 'Third Brake Light',
      'Cab Clearance Light Center', 'Cab Clearance Light Left', 'Cab Clearance Light Right',
    ],
    wireIds: ['33', '39', '41', '75', '76', '77', '78', '79', '80', '81', '82', '83', '84', '85', '86', '87', '88', '89', '90', '91', '92', '93'],
    totalAmps: 24.9,
    pdmChannels: ['OUT13', 'OUT15', 'OUT17', 'OUT18', 'OUT19', 'OUT27', 'OUT28'],
    zones: ['dash', 'engine_bay', 'rear', 'underbody'],
  },
  LIGHTING_INTERIOR: {
    toggleable: true,
    devices: ['Footwell Lights', 'Under-Dash LED Lights', 'Underhood Light', 'Cargo/Bed Light'],
    wireIds: ['68', '69', '73', '74'],
    totalAmps: 2.0,
    pdmChannels: ['OUT25 (shared with DOME_COURTESY)'],
    zones: ['dash', 'engine_bay', 'rear'],
  },
  DOME_COURTESY: {
    toggleable: true,
    devices: ['Dome Light', 'Door Switch Left', 'Door Switch Right', 'Door Puddle Light Left', 'Door Puddle Light Right'],
    wireIds: ['42', '43', '67'],
    totalAmps: 1.1,
    pdmChannels: ['OUT25 (shared with LIGHTING_INTERIOR)'],
    zones: ['dash', 'doors'],
  },
  POWER_WINDOWS: {
    toggleable: true,
    devices: ['Power Window Motor Left', 'Power Window Motor Right', 'Window Switch Master (Driver)', 'Window Switch Passenger'],
    wireIds: ['34', '35', '36', '37'],
    totalAmps: 30.0,
    pdmChannels: ['OUT3', 'OUT4'],
    zones: ['doors', 'dash'],
    note: 'Wires 34/35 carry door_crossing flag (+6in boot flex).',
  },
  POWER_LOCKS: {
    toggleable: true,
    devices: ['Power Lock Actuator Left', 'Power Lock Actuator Right', 'Lock Switch'],
    wireIds: ['38', '44', '47'],
    totalAmps: 6.0,
    pdmChannels: ['OUT21', 'OUT22'],
    zones: ['doors'],
  },
  AUDIO: {
    toggleable: true,
    devices: [
      'AM/FM Antenna', 'Radio/Head Unit', 'Amplifier', 'Amplifier Relay',
      'Speaker Front Left', 'Speaker Front Right', 'Speaker Rear Left', 'Speaker Rear Right', 'Subwoofer',
    ],
    wireIds: ['26a', '26b', '27a', '27b', '28a', '28b', '29a', '29b', '30a', '30b', '31', '32', '96'],
    totalAmps: 33.3,
    ampsNote: 'Amp 30A (8 AWG feed #32), head unit 3A, relay coil 0.2A. Speaker wires carry no battery amps.',
    pdmChannels: ['OUT20 (head unit)'],
    zones: ['dash', 'doors', 'rear'],
  },
  HVAC_AC: {
    toggleable: true,
    devices: ['Blower Speed Switch/Control', 'Heater Blower Motor', 'A/C Compressor Clutch', 'A/C Pressure Switch High', 'A/C Pressure Switch Low'],
    wireIds: ['23', '45', '51', '105', '111'],
    totalAmps: 16.0,
    pdmChannels: ['OUT6 (blower, 10 AWG)', 'OUT16 (A/C clutch)'],
    zones: ['dash', 'engine_bay'],
  },
  WIPERS_WASHER: {
    toggleable: true,
    devices: ['Wiper/Washer Switch', 'Windshield Wiper Motor', 'Washer Pump'],
    wireIds: ['46', '49', '50'],
    totalAmps: 10.0,
    pdmChannels: ['OUT12 (wiper motor)', 'OUT26 (washer pump)'],
    zones: ['dash', 'engine_bay'],
  },
  AMP_STEPS: {
    toggleable: true,
    devices: ['AMP Research Controller', 'AMP Research Step Left', 'AMP Research Step Right'],
    wireIds: ['1', '2', '3'],
    totalAmps: 24.0,
    ampsNote: '8A x 3 nameplate; steps typically run sequentially — realistic peak ~16A.',
    pdmChannels: ['OUT9', 'OUT10', 'OUT11'],
    zones: ['underbody'],
  },
  CAMERA_REAR: {
    toggleable: true,
    devices: ['Rear Backup Camera'],
    wireIds: ['97'],
    totalAmps: 0.2,
    pdmChannels: ['OUT15 (SHARED with backup lights — camera off does NOT free OUT15 if LIGHTING_EXTERIOR is on)'],
    zones: ['rear', 'dash'],
    crossDependency: 'Video display lands on Radio/Head Unit (AUDIO) or Display/Dash.',
  },
  DASH_CLUSTER_DAKOTA: {
    toggleable: true,
    devices: ['Dakota Digital Gauge Cluster', 'SGI-100BT Signal Bridge', 'GPS Antenna'],
    wireIds: ['71'],
    totalAmps: 2.6,
    pdmChannels: ['PDM30:unspecified (#71)'],
    zones: ['dash'],
    note: 'Cluster data arrives over CAN via SGI-100BT bridge — no analog sender wires in the CAN configuration. The v4 dual-sender wires (#114-#124) are this subsystem too.',
  },
  ACCESSORY_12V: {
    toggleable: true,
    devices: ['Cigarette Lighter / 12V Outlet', 'USB Charging Port', 'Horn'],
    wireIds: ['48', '70', '72'],
    totalAmps: 16.0,
    pdmChannels: ['OUT8 (12V outlet)', 'OUT14 (horn)', 'OUT30 (USB)'],
    zones: ['dash', 'engine_bay'],
    note: 'Horn parked here — discretionary accessory load.',
  },
  EXHAUST_CUTOUTS_QTP: {
    toggleable: true,
    devices: [
      'QTP Electric Exhaust Cutout Left', 'QTP Electric Exhaust Cutout Right',
      'Polarity Reversing Relay 1', 'Polarity Reversing Relay 2', 'Polarity Reversing Relay 3', 'Polarity Reversing Relay 4',
    ],
    wireIds: [],
    totalAmps: 16.4,
    pdmChannels: [],
    zones: ['underbody', 'engine_bay'],
    note: 'ZERO cut-list wires for this subsystem — cut-list work item.',
  },
  HARNESS_INFRA: {
    toggleable: false,
    devices: [
      'Body Ground Point', 'Star Ground Point', 'Firewall Bulkhead Connector',
      'Door Jamb Boot Left', 'Door Jamb Boot Right', 'Rear Harness Junction',
      'Power Distribution Module (Secondary)',
    ],
    wireIds: [],
    totalAmps: 0,
    pdmChannels: [],
    zones: ['dash', 'engine_bay', 'firewall', 'doors', 'rear'],
    note: 'Always built; scales with whatever subsystems are selected. Not a toggle — a substrate.',
  },
};

// ── V4 addendum wire → subsystem assignments ────────────────────────
// PROVENANCE: K5_cut_list_v4.txt 2026-06-09 addendum + receipts
// 2026-05-14_addendum-dakota-dual-sender-wires.md (Dakota #114-#124),
// 2026-05-14_acceptance-three-decisions.md (#125 T43 CAN stub, #126 E-Stopp),
// 2026-05-14_decision-high-beam-floor-dimmer.md (#85a/b, #86a/b dimmer legs).
// subsystems.json predates v4 — these 17 IDs extend it.
export const V4_WIRE_SUBSYSTEMS: Record<string, string> = {
  '114': 'DASH_CLUSTER_DAKOTA', '115': 'DASH_CLUSTER_DAKOTA', '116': 'DASH_CLUSTER_DAKOTA',
  '117': 'DASH_CLUSTER_DAKOTA', '118': 'DASH_CLUSTER_DAKOTA', '119': 'DASH_CLUSTER_DAKOTA',
  '120': 'DASH_CLUSTER_DAKOTA', '121': 'DASH_CLUSTER_DAKOTA', '122': 'DASH_CLUSTER_DAKOTA',
  '123': 'DASH_CLUSTER_DAKOTA', '124': 'DASH_CLUSTER_DAKOTA',
  '125': 'TRANS_6L80E',
  '126': 'EPARKING_BRAKE',
  '85a': 'LIGHTING_EXTERIOR', '85b': 'LIGHTING_EXTERIOR',
  '86a': 'LIGHTING_EXTERIOR', '86b': 'LIGHTING_EXTERIOR',
};

// MECHANICAL_GAUGES alternate (subsystems.json MECHANICAL_GAUGES_ALTERNATE):
// ECU-side sensors NEVER come out — they are engine-protection inputs to the
// M130. Mechanical gauges need their OWN senders/ports (oil galley tee,
// second coolant port). Capillary option = zero new wires.
export const MECHANICAL_GAUGES_NOTE =
  'MECHANICAL_GAUGES alternate ON — ECU sensors stay (engine protection); mechanical gauges need own senders/ports. ' +
  'Oil pressure: capillary (0 wires) or 1x 22 AWG dash-to-block. Water temp: capillary bulb (0 wires) or 1x 22 AWG. ' +
  'If instead of Dakota: drop #71 + cluster/SGI/GPS devices, delta -2.6A.';
