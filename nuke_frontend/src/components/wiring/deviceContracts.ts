// deviceContracts.ts — Per-device electrical signal contracts for the K5 build.
//
// A DeviceContract describes what signals a device expects (inputs) and
// produces (outputs), with traited values that receipts can cite as evidence.
// Every entry traces to a research packet in docs/wiring/research/ or to a
// reference doc in WIRING_SYSTEM_KNOWLEDGE.md. No trait is invented.
//
// Unlike objectTraits.ts (which describes PHYSICAL LOCATIONS in the K5 model),
// this file describes ELECTRICAL INTERFACES of devices that can live anywhere
// in the vehicle. A wiring receipt that touches a device MUST cite the entry
// here for any signal-type / pinout / power claim it makes.
//
// Source citations live in `research_source` fields. Agents should read the
// research file before making any claim beyond what's encoded here.

export type SignalType =
  | "digital_in"          // 0/12V logic input (e.g. ground-activated)
  | "digital_out"         // 0/12V output
  | "analog_voltage"      // 0-5V or 0-12V analog input
  | "analog_temperature"  // thermistor / RTD
  | "analog_pressure"     // 3-wire pressure sensor (5V ref, signal, gnd)
  | "pwm_low_side"        // PWM low-side drive
  | "pwm_high_side"       // PWM high-side drive
  | "half_bridge"         // Half-bridge driver (either polarity, PWM capable)
  | "can_high"            // CAN-H, typically part of a pair
  | "can_low"             // CAN-L
  | "shielded_signal"     // shielded low-level signal (crank, cam, knock, wideband O2)
  | "square_wave"         // square wave tach / VSS
  | "resistive"           // resistor-to-ground sender (0-90Ω fuel, etc.)
  | "power_12v_sw"        // switched 12V
  | "power_12v_perm"      // permanent 12V
  | "ground";

export type PinDef = {
  pin: string | number;
  function: string;
  signal: SignalType;
  fuse_a?: number;
  gauge_awg?: number;
  required?: boolean;
  notes?: string;
};

export type DeviceContract = {
  device_id: string;          // slug matching vehicle_build_manifest.device_id
  display_name: string;
  family:
    | "ecu"
    | "pdm"
    | "gauge_cluster"
    | "brake_booster"
    | "fuel_pump"
    | "actuator"
    | "audio"
    | "lighting"
    | "sensor"
    | "power_step"
    | "power_window"
    | "door_lock"
    | "head_unit"
    | "headlight"
    | "tail_light";
  pins: PinDef[];
  power_budget_amps: { peak: number; continuous: number };
  comms?: { protocol: "can" | "lin" | "k-line" | "none"; bitrate_kbps?: number; notes?: string };
  gen2_warnings?: string[];   // e.g. "pin 17 inert on Gen-2" (legacy — prefer gen1_requirements for Gen-1 units)
  gen1_requirements?: string[]; // Gen-1-specific wiring requirements (e.g. "pin 17 MUST be wired 12V perm 5A")
  research_source: string;    // path to the research packet
  hard_facts?: string[];      // facts receipts MUST cite when touching this device
};

// ──────────────────────────────────────────────────────────────────────
// 1. Dakota Digital VHX-73C-PU
// ──────────────────────────────────────────────────────────────────────
export const DAKOTA_VHX_73C_PU: DeviceContract = {
  device_id: "dakota_digital_vhx_73c_pu",
  display_name: "Dakota Digital VHX-73C-PU (Squarebody cluster)",
  family: "gauge_cluster",
  pins: [
    { pin: "ACC. POWER", function: "Switched 12V to VHX + internal voltmeter read", signal: "power_12v_sw", fuse_a: 3, gauge_awg: 18, required: true },
    { pin: "ACC. GND",   function: "VHX ground",                                     signal: "ground",       gauge_awg: 18, required: true },
    { pin: "TACH",       function: "Engine RPM input",                               signal: "square_wave",  gauge_awg: 20, required: true, notes: "5V LOW or 12V HIGH selectable; 4.7kΩ pull-up to +12V required if set to 12V HIGH" },
    { pin: "SPD SND",    function: "Speedometer pulse input",                        signal: "square_wave",  gauge_awg: 20, required: true, notes: "4,000-128,000 pulses/mile, auto-calibrated by drive-a-mile" },
    { pin: "SPD +",      function: "+5V out for SEN-01-5 hall sensor only",          signal: "power_12v_sw", gauge_awg: 20, required: false, notes: "DO NOT inject power here from Motec" },
    { pin: "SPD -",      function: "Speed input ground",                             signal: "ground",       gauge_awg: 20, required: true },
    { pin: "FUEL SND",   function: "Resistive fuel sender",                          signal: "resistive",    gauge_awg: 20, required: true, notes: "Factory K5 sender = GM 90 (0-90Ω). Twisted pair to FUEL -. No Motec involved." },
    { pin: "FUEL -",     function: "Fuel sender return — to SENDER BODY only",       signal: "ground",       gauge_awg: 20, required: true, notes: "NOT chassis ground. Sender flange mounting stud." },
    { pin: "WTR SND",    function: "Coolant temp (Dakota SEN-04-5 ONLY)",            signal: "resistive",    gauge_awg: 20, required: true, notes: "Proprietary Dakota curve; substitution DAMAGES control box" },
    { pin: "OIL SND",    function: "Oil pressure (Dakota SEN-03-8 ONLY, 3-wire)",    signal: "analog_pressure", gauge_awg: 20, required: true, notes: "Proprietary Dakota 0-100 PSI. Substitution DAMAGES control box." },
    { pin: "CHECK ENG",  function: "MIL input, ground-activated",                    signal: "digital_in",   gauge_awg: 20, required: false },
    { pin: "BRAKE",      function: "Brake warning, ground-activated",                signal: "digital_in",   gauge_awg: 20, required: false },
    { pin: "LEFT",       function: "Left turn indicator, +12V active",               signal: "digital_in",   gauge_awg: 20, required: false },
    { pin: "RIGHT",      function: "Right turn indicator, +12V active",              signal: "digital_in",   gauge_awg: 20, required: false },
    { pin: "HIGH",       function: "High-beam indicator, +12V active",               signal: "digital_in",   gauge_awg: 20, required: false },
    { pin: "WARN",       function: "Shift light / warning output, low-side",         signal: "digital_out",  gauge_awg: 20, required: false, notes: "Max 4W load" },
  ],
  power_budget_amps: { peak: 3, continuous: 1.5 },
  comms: { protocol: "none", notes: "BIM-01-2 speaks OBD-II J1979, NOT Motec CAN. Custom M1 Build package would be required to bridge." },
  research_source: "docs/wiring/research/dakota-digital-vhx-motec-integration.md",
  hard_facts: [
    "V8 with Motec tacho output must set VHX cylinder count to 4 (Motec emits 2 pulses/rev, same as LS ECUs)",
    "Fuel sender ground (FUEL -) must go to sender body, NOT chassis ground",
    "Coolant + oil pressure require parallel Motec sensors for ECU fueling/ignition",
    "Control box placement must avoid engine bay EMI (no ignition coils / HEI nearby)",
  ],
};

// ──────────────────────────────────────────────────────────────────────
// 2. Bosch iBooster Gen-1 (Tesla Model S pre-refresh salvage via Tulay Gen-1 kit)
//    Unit identified 2026-04-16: Tesla PN 1037123-00-B, Bosch 0 204 N 00 015,
//    date code 031015 (2015 pre-refresh Model S), confidence 0.95.
//    See docs/wiring/research/ibooster-pn-identification.md.
// ──────────────────────────────────────────────────────────────────────
export const BOSCH_IBOOSTER_GEN1: DeviceContract = {
  device_id: "bosch_ibooster_gen1",
  display_name: "Bosch iBooster Gen-1 (Tesla Model S pre-refresh salvage + Tulay Gen-1 harness)",
  family: "brake_booster",
  pins: [
    { pin: 1,  function: "B+ permanent battery feed (primary)", signal: "power_12v_perm", fuse_a: 40, gauge_awg: 12, required: true, notes: "2.5-4 mm² Tesla OE. Direct to battery, NOT through PDM. Large MCP 2.8 terminal." },
    { pin: 2,  function: "Pedal travel sensor 2",    signal: "analog_voltage", gauge_awg: 20, required: true, notes: "Pre-wired by Tulay Gen-1 harness to pedal connector" },
    { pin: 8,  function: "Pedal travel sensor 4",    signal: "analog_voltage", gauge_awg: 20, required: true, notes: "Pre-wired by Tulay Gen-1 harness" },
    { pin: 9,  function: "Chassis ground",            signal: "ground",         gauge_awg: 12, required: true, notes: "Bolted to chassis within 12\" of booster; NOT daisy-chained through PDM or engine. 2.5-4 mm²." },
    { pin: 10, function: "YAW CAN-L",                 signal: "can_low",        gauge_awg: 22, required: false, notes: "Pre-refresh Model S EV-CAN 500 kbps. NOT same dialect as M3/Y OVCS DBC." },
    { pin: 16, function: "Vehicle CAN-L",             signal: "can_low",        gauge_awg: 22, required: false },
    { pin: 17, function: "B+ permanent secondary (Gen-1 requirement)", signal: "power_12v_perm", fuse_a: 5, gauge_awg: 20, required: true, notes: "GEN-1 MUST be wired. 1.5-2.5 mm² from battery B+ distribution, 5A fuse, medium 2.8 mm spade terminal. EVcreate canonical Gen-1 pinout." },
    { pin: 18, function: "YAW CAN-H",                 signal: "can_high",       gauge_awg: 22, required: false, notes: "Pre-refresh Model S EV-CAN 500 kbps. NOT same dialect as M3/Y OVCS DBC." },
    { pin: 20, function: "Switched 12V ignition",     signal: "power_12v_sw",   fuse_a: 5, gauge_awg: 20, required: true, notes: "0.35-0.5 mm², small terminal." },
    { pin: 22, function: "Pedal travel sensor 1",    signal: "analog_voltage", gauge_awg: 20, required: true, notes: "Pre-wired by Tulay Gen-1 harness" },
    { pin: 23, function: "Pedal travel sensor 3",    signal: "analog_voltage", gauge_awg: 20, required: true, notes: "Pre-wired by Tulay Gen-1 harness" },
    { pin: 25, function: "Vehicle CAN-H",             signal: "can_high",       gauge_awg: 22, required: false },
  ],
  power_budget_amps: { peak: 40, continuous: 5 },
  comms: {
    protocol: "can",
    bitrate_kbps: 500,
    notes: "Tesla pre-refresh Model S EV-CAN dialect. Gen-1 runs in failsafe/standalone mode without CAN — press pedal, get boost. RetroPilot Ocelot ibst/main.c firmware is already Gen-1 and is the direct reference (Kevin Roscom). OVCS Model 3 RHD DBC is Gen-2 and does NOT apply to this pre-refresh Model S unit. If CAN integration is added later, the pre-refresh Model S EV-CAN dialect is a separate reverse-engineering task.",
  },
  gen1_requirements: [
    "PIN 17 MUST BE WIRED — 12V permanent, 5A fused, 1.5-2.5 mm², medium 2.8 mm spade. Gen-1 requires this secondary B+ supply in addition to Pin 1. Leaving it unpowered starves the ECU.",
    "NO BRAKE LIGHT OUTPUT — iBooster has no brake-light wire; Tesla publishes brake signal only on CAN. Mechanical pedal switch is mandatory.",
    "B+ must bypass PDM — PDM30 channels max ~25A, iBooster peak is 40A",
    "Use Tulay Gen-1 / EVcreate Gen-1 / fastandquiet Gen-1 connector kit — Gen-2 kits DO NOT FIT (different pedal-travel sensor connector)",
    "Mounting bolt pattern: 72 mm M8 flange (Gen-1) — NOT the Gen-2 integrated pattern. Verify K5 firewall bracket before drilling.",
  ],
  research_source: "docs/wiring/research/ibooster-pn-identification.md",
  hard_facts: [
    "Unit identified: Tesla PN 1037123-00-B, Bosch 0 204 N 00 015, 2015 pre-refresh Model S (confidence 0.95)",
    "Master cylinder bore must be 1-1/8\" (Wilwood 260-15542 + adapter); smaller bore binds and destroys both",
    "Brake ports are M12×1.0 — need M12×1.0 → M10×1.0 reducer fittings for K5 3/16\" lines",
    "Fallback mode: mechanical hydraulic only, pedal effort ~3-4× normal",
    "Brake light requires separate mechanical pedal switch (Wilwood 340-3930 or OE GM) → PDM input",
    "Connector housing: 25-pin Bosch/TE MCP 2.8 hybrid (Gen-1 family; Gen-2 is 26-pin)",
    "Pin 17 is Gen-1's secondary permanent hot — independent 5A fuse from Pin 1's 40A",
  ],
};

/**
 * Backward-compatibility alias. The constant was originally named
 * BOSCH_IBOOSTER_GEN2 because the build plan assumed Gen-2. Unit identification
 * on 2026-04-16 resolved it as Gen-1. The alias preserves existing receipt
 * references while new work uses BOSCH_IBOOSTER_GEN1. The device_id in the
 * exported contract is `bosch_ibooster_gen1`.
 */
export const BOSCH_IBOOSTER_GEN2: DeviceContract = BOSCH_IBOOSTER_GEN1;

// Also expose CAN message decode (for Motec CAN RX config)
export const IBOOSTER_CAN_MESSAGES = {
  "0x39D": {
    name: "iBooster status (RX-safe)",
    bytes: {
      rod_position_mm: { byte_start: 0, byte_count: 2, scale: 0.015625, offset: 0, unit: "mm" },
      driver_brake_apply: { byte: 2, bit: 0, type: "bool" },
      internal_state: { byte: 2, bits: "1-4", type: "enum" },
    },
    source_dbc: "open-vehicle-control-system/dbc/ibooster/ibooster_gen_2_tesla_model_3_right_hand_drive.dbc",
  },
  "0x38E": { name: "_unknown1 (Gen-2)", status: "not_publicly_decoded" },
  "0x38F": { name: "_unknown2 (Gen-2)", status: "not_publicly_decoded" },
  "0x38B": { name: "Activation pre-power (cyclic 10ms)", status: "partial", notes: "Required before power-up per OVCS DBC" },
  "0x38C": { name: "Activation pre-power (cyclic 10ms)", status: "partial" },
  "0x38D": { name: "Activation pre-power (cyclic 10ms)", status: "partial" },
} as const;

// ──────────────────────────────────────────────────────────────────────
// 3. Motec M130 output capability (referenced by above)
// ──────────────────────────────────────────────────────────────────────
export const MOTEC_M130_OUTPUTS = {
  device_id: "motec_m130",
  display_name: "MoTeC M130 ECU",
  family: "ecu" as const,
  half_bridges: {
    pins: ["A01", "A18", "A31", "A32", "A33", "A34"] as const,
    capability: "low_side | high_side | PWM 1Hz-20kHz",
    notes: "All 6 pins support switched or PWM modes in M1 Tune",
  },
  tacho_output: {
    pulses_per_rev: 2,
    compatible_with: "aftermarket_tach_cyl_count_set_to_4",
    notes: "Same as LS ECUs. Dakota VHX, Autometer, Speedhut all require '4 cyl' setting on V8.",
  },
  fuel_pump_driver: {
    pin: 101,
    type: "low_side",
    typical_use: "Triggers ground for a dedicated fuel pump relay coil (pin 85). Coil pin 86 fed via ignition +12V.",
    notes: "ECU drops this at RPM=0 for crash safety.",
  },
  research_source: "docs/wiring/research/dakota-digital-vhx-motec-integration.md",
} as const;

// ──────────────────────────────────────────────────────────────────────
// 4. Aeromotive A1000 fuel pump (with 16301 wiring kit)
// ──────────────────────────────────────────────────────────────────────
export const AEROMOTIVE_A1000: DeviceContract = {
  device_id: "aeromotive_a1000",
  display_name: "Aeromotive A1000 fuel pump (PN 11101) + 16301 wiring kit",
  family: "fuel_pump",
  pins: [
    { pin: "RED +",   function: "Battery positive via relay output (pin 87)", signal: "power_12v_sw", fuse_a: 30, gauge_awg: 10, required: true },
    { pin: "BLACK -", function: "Chassis ground, short run",                   signal: "ground",       gauge_awg: 10, required: true },
  ],
  power_budget_amps: { peak: 30, continuous: 12 },
  comms: { protocol: "none", notes: "Dumb brushed DC pump — no signal wires, no feedback" },
  research_source: "docs/wiring/research/k5-accessories-aeromotive-estopp-tulay.md",
  hard_facts: [
    "Return-style only — using on a carb returnless setup cooks the pump",
    "Dedicated 30A Bosch relay required; NOT through PDM (in-rush ~30A, PDM channel rating ~20-25A)",
    "MoTeC M130 pin 101 (low-side fuel pump driver) triggers relay coil pin 85 to ground",
    "Relay coil pin 86 fed via ignition +12V through small fuse (~2A)",
    "ECU drops pin 101 at RPM=0 for crash safety — do not bypass",
    "16301 kit contains: 30A Bosch relay, 30A breaker, 25 ft 10 AWG, standard terminals",
  ],
};

// ──────────────────────────────────────────────────────────────────────
// 5. E-Stopp ESK001 electric parking brake
// ──────────────────────────────────────────────────────────────────────
export const ESTOPP_ESK001: DeviceContract = {
  device_id: "estopp_esk001",
  display_name: "E-Stopp ESK001 electric parking brake actuator",
  family: "actuator",
  pins: [
    { pin: "BAT +",    function: "Direct battery feed",   signal: "power_12v_perm", fuse_a: 30, gauge_awg: 10, required: true },
    { pin: "BAT -",    function: "Chassis ground",         signal: "ground",         gauge_awg: 10, required: true },
    { pin: "IGN SENSE",function: "Ignition-on sense",     signal: "power_12v_sw",   fuse_a: 2,  gauge_awg: 18, required: true, notes: "Safety interlock — won't auto-release without ignition on" },
    { pin: "SW GRAY",  function: "Switch common",          signal: "digital_in",     gauge_awg: 18, required: true },
    { pin: "SW PURPLE",function: "Switch NO (momentary)",  signal: "digital_in",     gauge_awg: 18, required: true, notes: "Momentary press — control box latches internally" },
    { pin: "SW BLACK", function: "Switch NC",              signal: "digital_in",     gauge_awg: 18, required: false },
  ],
  power_budget_amps: { peak: 25, continuous: 0.001 },
  comms: { protocol: "none", notes: "Self-contained H-bridge control box, no external commands" },
  research_source: "docs/wiring/research/k5-accessories-aeromotive-estopp-tulay.md",
  hard_facts: [
    "Gear train self-locks when powered off — power loss while parked = brake stays set (anti-theft feature)",
    "Wire direct from battery through 30A fuse; NOT through PDM (peak 15-25A for 1-2s activation)",
    "Hold current is sub-milliamp (\"many years\" on battery per E-Stopp)",
    "No Motec integration needed — only ties to vehicle via ignition sense for safety interlock",
  ],
};

// ──────────────────────────────────────────────────────────────────────
// 6. AMP Research PowerStep (squarebody kit — Far From Stock P300,
//    Engineered Vintage, or K5 Squared brackets; all reuse AMP controller)
// ──────────────────────────────────────────────────────────────────────
export const AMP_RESEARCH_POWERSTEP: DeviceContract = {
  device_id: "amp_research_powerstep",
  display_name: "AMP Research PowerStep (75104-01A controller + L/R step motors)",
  family: "power_step",
  pins: [
    { pin: "B+ MAIN",      function: "+12V main feed to controller (kit-supplied 30A in-line fuse)", signal: "power_12v_perm", fuse_a: 30, gauge_awg: 10, required: true, notes: "Kit ships its own 30A in-line fuse in the B+ lead. AMP warranty assumes this fuse — do not omit even if PDM channel is protected." },
    { pin: "GND",          function: "Chassis ground",                                signal: "ground",          gauge_awg: 10, required: true },
    { pin: "PURPLE (DRV)", function: "Driver door trigger — ground-activated input",  signal: "digital_in",      gauge_awg: 18, required: true, notes: "Taps driver door-pin switch ground wire (same circuit as courtesy lights). NOT a +12V feed." },
    { pin: "PURPLE/BLK",   function: "Passenger door trigger — ground-activated",     signal: "digital_in",      gauge_awg: 18, required: true, notes: "Taps passenger door-pin switch ground wire." },
    { pin: "MOTOR L ORG",  function: "Left step motor lead A (orange)",               signal: "half_bridge",     gauge_awg: 14, required: true, notes: "Polarity reverses between deploy and retract. L/R sides are mirrored — orange/white swap meaning." },
    { pin: "MOTOR L WHT",  function: "Left step motor lead B (white)",                signal: "half_bridge",     gauge_awg: 14, required: true },
    { pin: "MOTOR R ORG",  function: "Right step motor lead A (orange)",              signal: "half_bridge",     gauge_awg: 14, required: true },
    { pin: "MOTOR R WHT",  function: "Right step motor lead B (white)",               signal: "half_bridge",     gauge_awg: 14, required: true },
    { pin: "OVERRIDE",     function: "Optional override switch (3 wires into open receptacles)", signal: "digital_in", gauge_awg: 20, required: false, notes: "Pre-terminated pins push into open positions on 8-pin controller." },
  ],
  power_budget_amps: { peak: 15, continuous: 0 },
  comms: { protocol: "none", notes: "Proprietary ground-trigger logic inside controller. No CAN, no PWM, no external commands." },
  research_source: "docs/wiring/research/k5-convenience-powerstep-windows-locks.md",
  hard_facts: [
    "PowerStep is a self-contained appliance — PDM just delivers +12V; purple triggers are ground-activated from door pin switches, NOT from PDM outputs",
    "Kit-supplied 30A in-line fuse is non-negotiable — AMP warranty assumes it; do not replace with PDM channel protection alone",
    "Purple trigger wires tap door-pin-switch GROUND leads (same circuit as courtesy lights), not +12V leads",
    "Deploy current is transient 10-15A per side for ~1s; static holding draw near zero (linkage self-locks, motors not back-driven)",
    "Retract delay is 3 seconds after door closes (controller-internal, not externally adjustable)",
    "Anti-pinch is motor-current-monitored internally — no separate sensor wire",
    "No ignition interlock — steps operate with ignition off (convenience feature)",
    "Three kit options (Far From Stock P300 $2264, Engineered Vintage $848, K5 Squared $500) are bracket differences only — all reuse the same AMP controller and behave identically electrically",
  ],
};

// ──────────────────────────────────────────────────────────────────────
// 7. Nu-Relics NR17380201 power window kit (1973-87 GM C/K)
// ──────────────────────────────────────────────────────────────────────
export const NU_RELICS_NR17380201: DeviceContract = {
  device_id: "nu_relics_nr17380201",
  display_name: "Nu-Relics NR17380201 power window kit (door-mounted chrome switches)",
  family: "power_window",
  pins: [
    { pin: "B+ IN",          function: "+12V feed to kit harness (kit-supplied 30A in-line fuse)",  signal: "power_12v_sw", fuse_a: 30, gauge_awg: 10, required: true, notes: "One PDM channel, ignition- or accessory-switched. Do NOT share with other large loads — window startup is spiky." },
    { pin: "GND",            function: "Harness ground (NOT motor case)",                             signal: "ground",       gauge_awg: 10, required: true, notes: "ACI motors are reverse-polarity — ground path is IN THE HARNESS, not on motor case. Do not substitute standard DC motors." },
    { pin: "DRV SW COM",     function: "Driver switch common — master/slave control",                 signal: "power_12v_sw", gauge_awg: 14, required: true },
    { pin: "PASS SW FEED",   function: "Passenger switch feed (cut by driver-master override)",       signal: "power_12v_sw", gauge_awg: 14, required: true, notes: "5-pole master/slave wiring: driver-master switch cuts passenger 12V when driver operates own switch." },
    { pin: "DRV MOTOR A",    function: "Driver motor lead A (polarity reverses at switch)",           signal: "half_bridge",  gauge_awg: 14, required: true },
    { pin: "DRV MOTOR B",    function: "Driver motor lead B (polarity reverses at switch)",           signal: "half_bridge",  gauge_awg: 14, required: true },
    { pin: "PASS MOTOR A",   function: "Passenger motor lead A",                                      signal: "half_bridge",  gauge_awg: 14, required: true },
    { pin: "PASS MOTOR B",   function: "Passenger motor lead B",                                      signal: "half_bridge",  gauge_awg: 14, required: true },
  ],
  power_budget_amps: { peak: 25, continuous: 0 },
  comms: { protocol: "none", notes: "No relays, no control module — 5-terminal rocker switches ARE the H-bridge." },
  research_source: "docs/wiring/research/k5-convenience-powerstep-windows-locks.md",
  hard_facts: [
    "Switch IS the H-bridge — no relays needed, no auto-reverse on obstruction",
    "ACI reverse-polarity motors: ground is IN THE HARNESS, not on motor case — do NOT substitute standard DC motors",
    "Kit-supplied 30A in-line fuse sized for ~25A simultaneous peak (both windows + master)",
    "Peak per window 10-15A at stall/startup; running draw 4-7A; static/idle zero",
    "No factory auto-reverse on obstruction — driver must release switch to stop motion (NOT safety windows)",
    "No courtesy-on timer — window power cuts with ignition-off unless wired to constant source",
    "Driver-master switch cuts passenger 12V feed when driver operates own switch (5-pole master/slave wiring)",
    "Exception to no-relay rule: if reusing old 3-pole switches, a polarity-reversing relay IS required. Kit-supplied 5-terminal switches do not need one.",
    "Door card modification required — factory K5 doors have no switch cutouts for door-mounted chrome variant",
  ],
};

// ──────────────────────────────────────────────────────────────────────
// 8. Dorman 746-014 door lock actuator (2-wire, polarity-reversing)
// ──────────────────────────────────────────────────────────────────────
export const DORMAN_746_014: DeviceContract = {
  device_id: "dorman_746_014",
  display_name: "Dorman 746-014 door lock actuator (2-wire, GM cross-ref)",
  family: "door_lock",
  pins: [
    { pin: 1, function: "Motor lead A (switched polarity — +12V to lock)",   signal: "half_bridge", gauge_awg: 18, required: true, notes: "Blade terminal, male connector. Polarity convention: A = '+12V when lock'; reverse for unlock. Document per door — L/R sides mirror." },
    { pin: 2, function: "Motor lead B (switched polarity — ground to lock)", signal: "half_bridge", gauge_awg: 18, required: true },
  ],
  power_budget_amps: { peak: 3, continuous: 0 },
  comms: { protocol: "none", notes: "Dumb DC motor with integrated rod mechanism. No built-in logic, no switch-sense, no feedback. 2-wire only." },
  research_source: "docs/wiring/research/k5-convenience-powerstep-windows-locks.md",
  hard_facts: [
    "2-wire polarity-reversing; use aftermarket keyless module (AVS/Directed/Omega) NOT direct PDM drive (would burn 8 channels — 2 outputs per door × 4 doors)",
    "Requires EXTERNAL H-bridge — actuator has no built-in logic. Options: two SPDT relays, PDM dual-output with mutually-exclusive programming, or keyless-entry module with on-board relays",
    "Actuation current <3A per actuator briefly (~500ms); static zero; all 4 doors simultaneously <12A peak — single 15A circuit covers all four",
    "Pulse duration 500-700ms typical; NEVER hold energized >2s — no internal thermal cutoff, long duty cycle burns the armature",
    "GM factory fit for 1977-2005 K5 door rod geometry — clips onto existing lock linkage rod, bracket mounts to existing sheet metal holes inside door",
    "GM cross-reference numbers: 11P3, 16603085, 1719362, 1719363, 20021912, 20021913",
    "746-014 is 2-wire ONLY — if master-slave switch-sense is needed, this is the wrong part; use 746-147 or similar 5-wire Dorman variant",
    "No squarebody-specific keyless module exists — generic aftermarket kits (AVS, Directed, Omega) all output the ±12V pulses a 2-wire actuator needs",
  ],
};

// ──────────────────────────────────────────────────────────────────────
// 9. RetroSound Hermosa head unit (built-in 4ch amp + dual 2V RCA pre-outs)
// ──────────────────────────────────────────────────────────────────────
export const RETROSOUND_HERMOSA: DeviceContract = {
  device_id: "retrosound_hermosa",
  display_name: "RetroSound Hermosa head unit (Model M2A — 45W×4 peak, 25W×4 RMS)",
  family: "head_unit",
  pins: [
    { pin: "YELLOW",       function: "Constant +12V (memory)",                              signal: "power_12v_perm", fuse_a: 15, gauge_awg: 18, required: true, notes: "Fused directly at battery feed. Never switched. Internal fuse typically 10-15A inline on yellow/red feed." },
    { pin: "RED",          function: "Switched +12V (ignition RUN/ACC)",                    signal: "power_12v_sw",   fuse_a: 10, gauge_awg: 18, required: true, notes: "Main harness Red → Power harness Blue per Hermosa wiring scheme. Only hot in RUN/ACC. Drives radio on/off." },
    { pin: "BLACK",        function: "Chassis ground (single-point near HU, <24\" run)",    signal: "ground",         gauge_awg: 18, required: true, notes: "Clean metal, short run. NOT shared with amp ground. Each unit grounds separately to prevent loop hum." },
    { pin: "ORANGE",       function: "Illumination / dash-dimmer reference",                signal: "analog_voltage", gauge_awg: 20, required: false, notes: "Ties to instrument-cluster dimmer wire — LCD dims with dash." },
    { pin: "BLUE",         function: "Remote amp turn-on (+12V switched out)",              signal: "digital_out",    gauge_awg: 18, required: true, notes: "Activates when radio powers on. Drives Kicker REM input." },
    { pin: "BLUE/WHITE",   function: "Power antenna trigger (+12V switched out)",           signal: "digital_out",    gauge_awg: 20, required: false, notes: "Triggered when tuner is on FM/AM. Unused on K5 — cap." },
    { pin: "MUTE",         function: "External mute input (ground-activated)",              signal: "digital_in",     gauge_awg: 20, required: false, notes: "Unused on K5 — leave open." },
    { pin: "GREY",         function: "Front Right speaker +",                               signal: "half_bridge",    gauge_awg: 18, required: false, notes: "BTL balanced output. 4Ω nominal. NOT common-ground." },
    { pin: "GREY/BLK",     function: "Front Right speaker -",                               signal: "half_bridge",    gauge_awg: 18, required: false, notes: "BTL balanced output — NOT chassis ground. Cap if unused." },
    { pin: "WHITE",        function: "Front Left speaker +",                                signal: "half_bridge",    gauge_awg: 18, required: false },
    { pin: "WHITE/BLK",    function: "Front Left speaker -",                                signal: "half_bridge",    gauge_awg: 18, required: false, notes: "BTL balanced output — NOT chassis ground. Cap if unused." },
    { pin: "PURPLE",       function: "Rear Right speaker +",                                signal: "half_bridge",    gauge_awg: 18, required: false },
    { pin: "PURPLE/BLK",   function: "Rear Right speaker -",                                signal: "half_bridge",    gauge_awg: 18, required: false, notes: "BTL balanced output — NOT chassis ground. Cap if unused." },
    { pin: "GREEN",        function: "Rear Left speaker +",                                 signal: "half_bridge",    gauge_awg: 18, required: false },
    { pin: "GREEN/BLK",    function: "Rear Left speaker -",                                 signal: "half_bridge",    gauge_awg: 18, required: false, notes: "BTL balanced output — NOT chassis ground. Cap if unused." },
    { pin: "RCA FRONT",    function: "Pre-out RCA pair (2V line-level)",                    signal: "shielded_signal", required: false, notes: "2V line-level. Dual pre-outs total — front + rear/sub typical config." },
    { pin: "RCA REAR/SUB", function: "Pre-out RCA pair (2V line-level) — drive Kicker sub", signal: "shielded_signal", required: false, notes: "2V line-level. Route on opposite side of cabin from power wire." },
    { pin: "AUX",          function: "3.5mm front-panel aux input",                         signal: "shielded_signal", required: false, notes: "Line-level, built into face." },
    { pin: "USB",          function: "Front-panel USB (data + 5V)",                         signal: "shielded_signal", required: false, notes: "Built into face." },
    { pin: "ANT",          function: "Rear-panel Motorola jack, 75Ω FM antenna",            signal: "shielded_signal", required: false, notes: "Standard factory antenna plug. Bluetooth uses internal antenna — no external BT antenna needed." },
  ],
  power_budget_amps: { peak: 15, continuous: 3 },
  comms: { protocol: "none", notes: "Bluetooth A2DP + HFP internal. No external data bus." },
  research_source: "docs/wiring/research/k5-audio-lighting.md",
  hard_facts: [
    "Hermosa speaker outputs are BALANCED (BTL) / not common-ground — never chassis-ground speaker negatives, never bridge speaker wires, cap unused speaker wires individually",
    "Never run HU ground through amp ground — single-point ground EACH component separately, short, clean (loop hum otherwise)",
    "HU ground run <24\" to clean chassis metal; NOT shared with amp ground",
    "Dual 2V RCA pre-outs enable sub-only external amplification — factory speakers driven by built-in amp (45W×4 peak, 25W×4 RMS)",
    "RCA cables routed on OPPOSITE side of cabin from power wire (non-negotiable for EMI-free audio)",
    "RCA cables never pass through firewall next to ignition/alternator wires",
    "Power antenna (Blue/White) unused on K5 — cap",
    "Mute input unused on K5 — leave open",
  ],
};

// ──────────────────────────────────────────────────────────────────────
// 10. Truck-Lite 27270C LED headlight (7\" round, H4 connector)
// ──────────────────────────────────────────────────────────────────────
export const TRUCK_LITE_27270C: DeviceContract = {
  device_id: "truck_lite_27270c",
  display_name: "Truck-Lite 27270C 7\" round LED headlight (H4 3-blade, multi-voltage)",
  family: "headlight",
  pins: [
    { pin: 1, function: "Ground (return for both beams)", signal: "ground",       gauge_awg: 16, required: true, notes: "Black wire typical. Factory K5 sealed-beam 3-prong connector matches H4 directly — no adapter needed." },
    { pin: 2, function: "Low beam +12V",                    signal: "power_12v_sw", fuse_a: 10, gauge_awg: 16, required: true, notes: "White or Yellow wire typical. 1.45A @ 12.8V." },
    { pin: 3, function: "High beam +12V",                   signal: "power_12v_sw", fuse_a: 10, gauge_awg: 16, required: true, notes: "Blue or Green wire typical. 2.95A @ 12.8V." },
  ],
  power_budget_amps: { peak: 2.95, continuous: 2.95 },
  comms: { protocol: "none", notes: "Plug-and-play. No CAN, no bulb-out detection on 1977 K5. Multi-voltage 9-32V (12V and 24V systems)." },
  research_source: "docs/wiring/research/k5-audio-lighting.md",
  hard_facts: [
    "No load resistor needed (headlights aren't flasher-driven), polarity-sensitive",
    "Reverse polarity won't damage the 27270C (internal bridge) but won't light — if nothing lights, swap ground and +12V",
    "Factory K5 sealed-beam 3-prong connector matches H4 directly — no adapter needed for the 27270C's H4 version",
    "Current draw 1.45A low / 2.95A high @ 12.8V (well above the ~200mA floor for GM's HL relay pull-in)",
    "Voltage range 9-32V multi-voltage (12V and 24V systems compatible)",
    "Heat-sink clearance: rear of 27270C protrudes ~1.5\" further than sealed beam — OK in K5 grille shell, but check before fender reinstall",
    "Headlight relay upgrade strongly recommended on 1977 K5 — factory dimmer switch drops 1-2V, LEDs will be ~80% brightness without relays feeding battery direct (Painless 30810 or similar)",
    "Stock 1977 dimmer rated ~15A — relays offload current to preserve full lumens",
  ],
};

// ──────────────────────────────────────────────────────────────────────
// 11. United Pacific CTL7387LED tail light (sequential, 1157+1156 sockets)
// ──────────────────────────────────────────────────────────────────────
export const UNITED_PACIFIC_CTL7387LED: DeviceContract = {
  device_id: "united_pacific_ctl7387led",
  display_name: "United Pacific CTL7387LED sequential LED tail light (1973-87 K5)",
  family: "tail_light",
  pins: [
    { pin: "1157 RUN",   function: "Running light (tail) — +12V when parking/headlights on", signal: "power_12v_sw", fuse_a: 10, gauge_awg: 16, required: true, notes: "Brown wire typical. Dual-filament 1157 socket pin — combined internally with brake+turn into sequential circuit." },
    { pin: "1157 BRK",   function: "Brake + turn signal — +12V when brake or turn active",   signal: "power_12v_sw", fuse_a: 10, gauge_awg: 16, required: true, notes: "White wire typical. Dual-filament 1157 socket pin — triggers sequential sweep unless selector switch is disabled." },
    { pin: "1157 GND",   function: "1157 socket ground",                                      signal: "ground",       gauge_awg: 16, required: true, notes: "Black wire typical." },
    { pin: "1156 BKUP",  function: "Backup light — +12V when reverse engaged",                signal: "power_12v_sw", fuse_a: 10, gauge_awg: 16, required: true, notes: "Green wire typical. Single-filament 1156 socket — separate circuit from tail/brake/turn." },
    { pin: "1156 GND",   function: "1156 socket ground",                                      signal: "ground",       gauge_awg: 16, required: true, notes: "Black wire typical." },
    { pin: "SEQ SELECT", function: "Sequential on/off selector slide switch (housing)",       signal: "digital_in",   required: false, notes: "Tiny slide switch on the housing. Lets user disable sequential sweep, revert to solid brake. Easy to bump during install — test both modes before buttoning up the bed." },
  ],
  power_budget_amps: { peak: 2, continuous: 1 },
  comms: { protocol: "none", notes: "Operating voltage 7.7-14.0 VDC. Epoxy-potted electronics, IP-rated for off-road K5 use." },
  research_source: "docs/wiring/research/k5-audio-lighting.md",
  hard_facts: [
    "Requires electronic flasher (UP 90652/90649 or EP27) — factory thermal flasher hyperflashes on LED load",
    "Factory 1977 K5 thermal flasher (bi-metallic strip heats with current, bends, breaks contact) FAILS on LED current — too low = no flash or hyperflash",
    "Factory flasher location: behind dash, clipped to fuse block on 1977 K5. 2-pin for turn signals, 3-pin for hazard — swap BOTH",
    "Generic EP27 electronic flasher (Diode Dynamics, iJDMTOY) is an acceptable cheaper alternative to UP 90652/90649",
    "LED flasher swap MUST happen BEFORE first turn-signal test — running LEDs through a thermal flasher overheats the flasher and either sticks-on or stuck-off (won't damage LEDs, but annoying to debug)",
    "Polarity-sensitive: LED reverse polarity won't damage but won't light. Factory K5 1157/1156 sockets are standard polarity — plug-and-play assuming harness isn't modified",
    "1157 has two contacts offset-indexed — plug only goes in one way. 1156 is keyed. If tails don't light, check for bent socket tabs from previous bulb removal",
    "Sequential selector is a slide switch on the housing — test both modes before final install",
    "Operating voltage 7.7-14.0 VDC, epoxy-potted, IP-rated for off-road K5 use",
  ],
};

// ──────────────────────────────────────────────────────────────────────
// 12. MoTeC M130 ECU — 60-pin Superseal (Connector A 34 + Connector B 26)
//     Source: docs/wiring/research/motec-pin-resource-map.json (authoritative)
// ──────────────────────────────────────────────────────────────────────
export const MOTEC_M130_ECU: DeviceContract = {
  device_id: "motec_m130_ecu",
  display_name: "MoTeC M130 ECU (60-pin, 34+26 Superseal)",
  family: "ecu",
  pins: [
    { pin: "A01", function: "OUT_HB2 · Half Bridge Output 2",        signal: "half_bridge",   gauge_awg: 16, required: true },
    { pin: "A02", function: "SEN_5V0_A · Sensor 5.0V A (regulated)", signal: "power_12v_sw",  gauge_awg: 20, required: true, notes: "5V sensor supply rail A" },
    { pin: "A03", function: "IGN_LS1 · Low Side Ignition 1",          signal: "pwm_low_side",  gauge_awg: 20, required: true },
    { pin: "A04", function: "IGN_LS2 · Low Side Ignition 2",          signal: "pwm_low_side",  gauge_awg: 20, required: true },
    { pin: "A05", function: "IGN_LS3 · Low Side Ignition 3",          signal: "pwm_low_side",  gauge_awg: 20, required: true },
    { pin: "A06", function: "IGN_LS4 · Low Side Ignition 4",          signal: "pwm_low_side",  gauge_awg: 20, required: true },
    { pin: "A07", function: "IGN_LS5 · Low Side Ignition 5",          signal: "pwm_low_side",  gauge_awg: 20, required: true },
    { pin: "A08", function: "IGN_LS6 · Low Side Ignition 6",          signal: "pwm_low_side",  gauge_awg: 20, required: true },
    { pin: "A09", function: "SEN_5V0_B · Sensor 5.0V B (regulated)", signal: "power_12v_sw",  gauge_awg: 20, required: true, notes: "5V sensor supply rail B" },
    { pin: "A10", function: "BAT_NEG1 · Battery Negative 1",          signal: "ground",        gauge_awg: 14, required: true, notes: "ECU power ground — paired with A11" },
    { pin: "A11", function: "BAT_NEG2 · Battery Negative 2",          signal: "ground",        gauge_awg: 14, required: true, notes: "ECU power ground — paired with A10" },
    { pin: "A12", function: "IGN_LS7 · Low Side Ignition 7",          signal: "pwm_low_side",  gauge_awg: 20, required: true },
    { pin: "A13", function: "IGN_LS8 · Low Side Ignition 8",          signal: "pwm_low_side",  gauge_awg: 20, required: true },
    { pin: "A14", function: "AV1 · Analogue Voltage Input 1",         signal: "analog_voltage",gauge_awg: 22 },
    { pin: "A15", function: "AV2 · Analogue Voltage Input 2",         signal: "analog_voltage",gauge_awg: 22 },
    { pin: "A16", function: "AV3 · Analogue Voltage Input 3",         signal: "analog_voltage",gauge_awg: 22 },
    { pin: "A17", function: "AV4 · Analogue Voltage Input 4",         signal: "analog_voltage",gauge_awg: 22 },
    { pin: "A18", function: "OUT_HB1 · Half Bridge Output 1",         signal: "half_bridge",   gauge_awg: 16 },
    { pin: "A19", function: "INJ_PH1 · Peak Hold Injector 1",         signal: "pwm_low_side",  gauge_awg: 18, required: true },
    { pin: "A20", function: "INJ_PH2 · Peak Hold Injector 2",         signal: "pwm_low_side",  gauge_awg: 18, required: true },
    { pin: "A21", function: "INJ_PH3 · Peak Hold Injector 3",         signal: "pwm_low_side",  gauge_awg: 18, required: true },
    { pin: "A22", function: "INJ_PH4 · Peak Hold Injector 4",         signal: "pwm_low_side",  gauge_awg: 18, required: true },
    { pin: "A23", function: "INJ_LS1 · Low Side Injector 1",          signal: "pwm_low_side",  gauge_awg: 18 },
    { pin: "A24", function: "INJ_LS2 · Low Side Injector 2",          signal: "pwm_low_side",  gauge_awg: 18 },
    { pin: "A25", function: "AV5 · Analogue Voltage Input 5",         signal: "analog_voltage",gauge_awg: 22 },
    { pin: "A26", function: "BAT_POS · Battery Positive (ECU +12V)",  signal: "power_12v_perm",fuse_a: 10, gauge_awg: 14, required: true, notes: "Constant 12V ECU feed, fused 10A" },
    { pin: "A27", function: "INJ_PH5 · Peak Hold Injector 5",         signal: "pwm_low_side",  gauge_awg: 18, required: true },
    { pin: "A28", function: "INJ_PH6 · Peak Hold Injector 6",         signal: "pwm_low_side",  gauge_awg: 18, required: true },
    { pin: "A29", function: "INJ_PH7 · Peak Hold Injector 7",         signal: "pwm_low_side",  gauge_awg: 18, required: true },
    { pin: "A30", function: "INJ_PH8 · Peak Hold Injector 8",         signal: "pwm_low_side",  gauge_awg: 18, required: true },
    { pin: "A31", function: "OUT_HB3 · Half Bridge Output 3",         signal: "half_bridge",   gauge_awg: 16 },
    { pin: "A32", function: "OUT_HB4 · Half Bridge Output 4",         signal: "half_bridge",   gauge_awg: 16 },
    { pin: "A33", function: "OUT_HB5 · Half Bridge Output 5",         signal: "half_bridge",   gauge_awg: 16 },
    { pin: "A34", function: "OUT_HB6 · Half Bridge Output 6",         signal: "half_bridge",   gauge_awg: 16 },
    { pin: "B01", function: "UDIG1 · Universal Digital Input 1",      signal: "digital_in",    gauge_awg: 22 },
    { pin: "B02", function: "UDIG2 · Universal Digital Input 2",      signal: "digital_in",    gauge_awg: 22 },
    { pin: "B03", function: "AT1 · Analogue Temperature Input 1",     signal: "analog_temperature", gauge_awg: 22, notes: "1k pull-up to SEN_5V_A" },
    { pin: "B04", function: "AT2 · Analogue Temperature Input 2",     signal: "analog_temperature", gauge_awg: 22, notes: "1k pull-up to SEN_5V_A" },
    { pin: "B05", function: "AV6 · Analogue Voltage Input 6",         signal: "analog_voltage",gauge_awg: 22 },
    { pin: "B06", function: "AV7 · Analogue Voltage Input 7",         signal: "analog_voltage",gauge_awg: 22 },
    { pin: "B07", function: "AV8 · Analogue Voltage Input 8",         signal: "analog_voltage",gauge_awg: 22 },
    { pin: "B08", function: "AT3 · Analogue Temperature Input 3",     signal: "analog_temperature", gauge_awg: 22, notes: "1k pull-up to SEN_5V_B" },
    { pin: "B09", function: "AT4 · Analogue Temperature Input 4",     signal: "analog_temperature", gauge_awg: 22, notes: "1k pull-up to SEN_5V_B" },
    { pin: "B10", function: "UDIG3 · Universal Digital Input 3",      signal: "digital_in",    gauge_awg: 22 },
    { pin: "B11", function: "UDIG4 · Universal Digital Input 4",      signal: "digital_in",    gauge_awg: 22 },
    { pin: "B12", function: "UDIG5 · Universal Digital Input 5",      signal: "digital_in",    gauge_awg: 22 },
    { pin: "B13", function: "UDIG6 · Universal Digital Input 6",      signal: "digital_in",    gauge_awg: 22 },
    { pin: "B14", function: "UDIG7 · Universal Digital Input 7",      signal: "digital_in",    gauge_awg: 22 },
    { pin: "B15", function: "SEN_GND_A · Sensor Ground A",            signal: "ground",        gauge_awg: 20, required: true },
    { pin: "B16", function: "SEN_GND_B · Sensor Ground B",            signal: "ground",        gauge_awg: 20, required: true },
    { pin: "B17", function: "CAN1_H · CAN Bus 1 High",                signal: "can_high",      gauge_awg: 22, required: true, notes: "Twisted pair with B18" },
    { pin: "B18", function: "CAN1_L · CAN Bus 1 Low",                 signal: "can_low",       gauge_awg: 22, required: true, notes: "Twisted pair with B17" },
    { pin: "B19", function: "KNK1 · Knock Sensor Input 1",            signal: "shielded_signal", gauge_awg: 22, notes: "Shielded, drain to B22 only" },
    { pin: "B20", function: "KNK2 · Knock Sensor Input 2",            signal: "shielded_signal", gauge_awg: 22, notes: "Shielded, drain to B22 only" },
    { pin: "B21", function: "KNK_GND · Knock Sensor Ground",          signal: "ground",        gauge_awg: 22 },
    { pin: "B22", function: "SHIELD · Shield / Drain",                signal: "ground",        gauge_awg: 22, notes: "Cable shield termination — single-point ground" },
    { pin: "B23", function: "USB_POS · USB Positive",                 signal: "shielded_signal", gauge_awg: 24, notes: "Tuning/diagnostics USB" },
    { pin: "B24", function: "USB_NEG · USB Negative",                 signal: "shielded_signal", gauge_awg: 24 },
    { pin: "B25", function: "ETH_TX · Ethernet TX",                   signal: "shielded_signal", gauge_awg: 24, notes: "CAT-rated twisted pair" },
    { pin: "B26", function: "ETH_RX · Ethernet RX",                   signal: "shielded_signal", gauge_awg: 24 },
  ],
  power_budget_amps: { peak: 5, continuous: 2 },
  comms: { protocol: "can", bitrate_kbps: 500, notes: "CAN Bus 1 @ 500 kbps default. 1 CAN bus. Also USB + Ethernet for tuning." },
  research_source: "docs/wiring/research/motec-pin-resource-map.json",
  hard_facts: [
    "60 pins total: Connector A 34-pin, Connector B 26-pin — both Tyco Superseal",
    "8 Peak & Hold injector outputs (A19-22, A27-30) + 2 low-side injector outputs (A23-A24)",
    "8 low-side ignition outputs (A03-A08, A12-A13)",
    "6 half-bridge outputs (A01, A18, A31-A34) — switchable low/high side, PWM 1Hz-20kHz",
    "8 analog voltage inputs, 4 temp inputs (1k pull-up to 5V rail), 7 universal digital inputs, 2 knock",
    "Dedicated sensor 5V rails A+B (A02, A09) + sensor grounds A+B (B15, B16) — keep loads balanced",
    "Battery +12V on A26 (fused 10A typical); paired negatives A10+A11 must BOTH be grounded",
    "CAN Bus 1 on B17/B18 — twisted pair, 120Ω termination at both bus ends only",
  ],
};

// ──────────────────────────────────────────────────────────────────────
// 13. Bosch 0280158821 EV6/EV14 fuel injector (high-Z, USCAR 2-pin)
// ──────────────────────────────────────────────────────────────────────
export const BOSCH_0280158821_INJECTOR: DeviceContract = {
  device_id: "bosch_0280158821_injector",
  display_name: "Bosch 0280158821 EV14/EV6 injector (42 lb/hr, high-Z, USCAR 2-pin)",
  family: "sensor",
  pins: [
    { pin: 1, function: "+12V (switched via ECU during injection)", signal: "power_12v_sw", fuse_a: 2, gauge_awg: 18, required: true, notes: "Daisy-chained from coil-on-rail +12V bus" },
    { pin: 2, function: "Low-side drive (ECU INJ_PH1-8)",             signal: "pwm_low_side", fuse_a: 2, gauge_awg: 18, required: true, notes: "ECU grounds this pin during injection pulse" },
  ],
  power_budget_amps: { peak: 2, continuous: 0.8 },
  comms: { protocol: "none", notes: "High-impedance (~12 Ω). Saturated (not peak-hold) drive preferred but ECU's Peak Hold outputs drive these fine." },
  research_source: "docs/wiring/research/k5-accessories-aeromotive-estopp-tulay.md",
  hard_facts: [
    "USCAR / EV6 2-pin connector (sometimes called EV14) — standard LS-era",
    "High-Z (~12 Ω), can be driven by either Peak & Hold or saturated injector drivers",
    "42 lb/hr flow rate at 43.5 psi — matched to LS3 crate engine needs",
    "Polarity does not matter (coil only) but convention is +12V to pin 1",
    "2A fuse per bank of 8 typical — individual injector peak ~1-2A during pulse, avg ~0.5A",
  ],
};

// ──────────────────────────────────────────────────────────────────────
// 14. ACDelco 12611424 LS3 ignition coil (D510C, 4-pin GM)
// ──────────────────────────────────────────────────────────────────────
export const ACDELCO_12611424_COIL: DeviceContract = {
  device_id: "acdelco_12611424_coil",
  display_name: "ACDelco 12611424 / D510C LS3 coil-on-plug (4-pin GM)",
  family: "sensor",
  pins: [
    { pin: "A", function: "Ground (coil primary return)",             signal: "ground",        gauge_awg: 18, required: true, notes: "Clean chassis ground near coil pack — avoid sharing with engine block" },
    { pin: "B", function: "+12V (switched ign, fused)",               signal: "power_12v_sw", fuse_a: 7.5, gauge_awg: 18, required: true, notes: "Fused 7.5A per coil or 30A shared for all 8" },
    { pin: "C", function: "ECU trigger (low-side pulse from IGN_LSn)", signal: "pwm_low_side", gauge_awg: 20, required: true, notes: "3-5V TTL pulse from M130 low-side ignition output" },
    { pin: "D", function: "Reference ground (signal return)",          signal: "ground",        gauge_awg: 20, required: true, notes: "Signal ground — tie to ECU BAT_NEG, NOT chassis" },
  ],
  power_budget_amps: { peak: 8, continuous: 6 },
  comms: { protocol: "none" },
  research_source: "docs/wiring/WIRING_SYSTEM_KNOWLEDGE.md",
  hard_facts: [
    "4-pin GM coil connector (AC Delco PN 12611424 / Bosch D510C — identical)",
    "Separate signal ground (D) from power ground (A) — crossing these causes noise",
    "Coils draw ~6A avg, ~8A peak per coil during dwell — size trunk feed accordingly",
    "Trigger pulse from M130 IGN_LSn pins (A03-A08, A12, A13) — 3-5V TTL",
    "Fire order LS3: 1-8-7-2-6-5-4-3 — ensure coil cylinder assignment matches firmware",
  ],
};

// ──────────────────────────────────────────────────────────────────────
// 15. Diode Dynamics 36469 / weatherpack-2 LED lamp assembly (generic)
//     Applies to: turn signals, markers, parking, tail, backup, brake,
//     license, puddle, cargo, cab clearance lamps on K5.
// ──────────────────────────────────────────────────────────────────────
export const DIODE_DYNAMICS_36469_LED: DeviceContract = {
  device_id: "diode_dynamics_36469_led",
  display_name: "Diode Dynamics 36469 LED module (weatherpack 2-pin)",
  family: "lighting",
  pins: [
    { pin: 1, function: "+12V switched (from PDM output)",  signal: "power_12v_sw", fuse_a: 5, gauge_awg: 18, required: true, notes: "Polarity-sensitive — reverse won't damage but won't light" },
    { pin: 2, function: "Ground (chassis return)",          signal: "ground",       gauge_awg: 18, required: true, notes: "Local chassis ground preferred — short return path reduces EMI" },
  ],
  power_budget_amps: { peak: 1.5, continuous: 0.3 },
  comms: { protocol: "none" },
  research_source: "docs/wiring/research/k5-audio-lighting.md",
  hard_facts: [
    "Weatherpack 2-pin connector — polarity keyed, won't plug in wrong way",
    "Electronic flasher required (same issue as Truck-Lite headlights) — factory thermal flasher hyperflashes",
    "Peak 1.5A during turn-signal flash, 0.3A continuous for marker/clearance use",
    "PDM channel assignment varies per circuit — see K5_PDM30_config_spec.md §5.1 (lighting)",
  ],
};

// ──────────────────────────────────────────────────────────────────────
// 16. Bosch 007794301 ISO mini relay (5-pin SPDT, 30/40A)
//     Used for: iBooster power, fuel pump, amp remote, polarity reversing.
// ──────────────────────────────────────────────────────────────────────
export const BOSCH_007794301_RELAY: DeviceContract = {
  device_id: "bosch_007794301_relay",
  display_name: "Bosch 007794301 ISO mini relay (5-pin SPDT, 30/40A)",
  family: "actuator",
  pins: [
    { pin: 85, function: "Coil ground (trigger side)",            signal: "ground",        gauge_awg: 20, required: true, notes: "Low-side drive from PDM, M130, or switch" },
    { pin: 86, function: "Coil +12V (trigger side)",              signal: "power_12v_sw", fuse_a: 1, gauge_awg: 20, required: true, notes: "Or reverse: 85=+12V, 86=ground — ISO style allows either polarity" },
    { pin: 30, function: "Common (battery feed)",                  signal: "power_12v_perm", fuse_a: 30, gauge_awg: 12, required: true, notes: "Switched side — sized for load" },
    { pin: 87, function: "Normally-Open output (energized = on)",  signal: "power_12v_sw", gauge_awg: 12, required: true, notes: "Switched to pin 30 when coil energized" },
    { pin: "87a", function: "Normally-Closed output (rest = on)", signal: "power_12v_sw", gauge_awg: 12, notes: "Only used in polarity-reversing / changeover configs" },
  ],
  power_budget_amps: { peak: 40, continuous: 30 },
  comms: { protocol: "none" },
  research_source: "docs/wiring/research/k5-accessories-aeromotive-estopp-tulay.md",
  hard_facts: [
    "ISO micro/mini relay — 5-pin version (87a) vs 4-pin (only 87) — check socket",
    "30A continuous / 40A peak — standard automotive relay ratings",
    "Coil draws ~160mA @ 12V — any PDM output or M130 low-side can drive it",
    "Polarity-reversing pair (two 5-pin relays cross-wired) drives bidirectional DC motors — used for K5 windows, locks, power steps, exhaust cutouts",
  ],
};

// ──────────────────────────────────────────────────────────────────────
// Device registry (lookup by device_id)
// ──────────────────────────────────────────────────────────────────────
export const DEVICE_CONTRACTS: Record<string, DeviceContract> = {
  dakota_digital_vhx_73c_pu: DAKOTA_VHX_73C_PU,
  bosch_ibooster_gen1:       BOSCH_IBOOSTER_GEN1,
  // Backward-compat: the Gen-2 key resolves to the same contract.
  // Existing receipts that reference `bosch_ibooster_gen2` continue to validate.
  bosch_ibooster_gen2:       BOSCH_IBOOSTER_GEN2,
  aeromotive_a1000:          AEROMOTIVE_A1000,
  estopp_esk001:             ESTOPP_ESK001,
  amp_research_powerstep:    AMP_RESEARCH_POWERSTEP,
  nu_relics_nr17380201:      NU_RELICS_NR17380201,
  dorman_746_014:            DORMAN_746_014,
  retrosound_hermosa:        RETROSOUND_HERMOSA,
  truck_lite_27270c:         TRUCK_LITE_27270C,
  united_pacific_ctl7387led: UNITED_PACIFIC_CTL7387LED,
  motec_m130_ecu:            MOTEC_M130_ECU,
  bosch_0280158821_injector: BOSCH_0280158821_INJECTOR,
  acdelco_12611424_coil:     ACDELCO_12611424_COIL,
  diode_dynamics_36469_led:  DIODE_DYNAMICS_36469_LED,
  bosch_007794301_relay:     BOSCH_007794301_RELAY,
};

export function getDeviceContract(device_id: string): DeviceContract | undefined {
  return DEVICE_CONTRACTS[device_id];
}

/** Returns the hard_facts that any receipt touching this device MUST cite. */
export function requiredCitations(device_id: string): string[] {
  const contract = getDeviceContract(device_id);
  if (!contract) return [];
  return [
    ...(contract.hard_facts || []),
    ...(contract.gen2_warnings || []),
    ...(contract.gen1_requirements || []),
  ];
}
