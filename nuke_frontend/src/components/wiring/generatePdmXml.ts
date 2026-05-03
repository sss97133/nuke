// generatePdmXml.ts — emit a valid PDM Manager `.pdm` XML file from a PdmConfig.
//
// PDM Manager's `.pdm` files are plain XML (verified against the shipped
// Samples/*.pdm files in the v1.9 install). This emitter produces a file that:
//   1. Loads in PDM Manager without error
//   2. Shows every K5 input pin, output pin, condition, counter, CAN input,
//      CAN output, and keypad binding in the correct GUI panel
//   3. Encodes the 6 operator codes we have decoded (AND, OR, NOT, FLASH,
//      HYSTERESIS, bitmask). Operators we haven't decoded yet (PULSE,
//      SET_RESET, TOGGLE, COUNTER source, comparators) are emitted as
//      passthrough (op=0) with the first channel reference attached, plus
//      a CDATA Comment marking the condition as TODO. PDM Manager loads
//      these and Dave fixes the operator dropdown on each by hand —
//      finite, bounded work, ~30 conditions out of 96.
//
// Schema reference: wiring/pdm_emitter/samples/{Indicators,Sample_PDM15,
// PDM_V2_Wiper_Example}.pdm
//
// Receipt: docs/wiring/receipts/2026-04-25_pdm-xml-emitter.md

import type { PdmConfig, PdmCondition, PdmOutputPin, PdmCanInput } from './generatePdmConfig';
import { rename, renameExpression } from './channelRenames';

// ──────────────────────────────────────────────────────────────────────
// Operator codes — decoded from MoTeC sample files
// ──────────────────────────────────────────────────────────────────────
const OP = {
  PASSTHROUGH: 0,    // just reference LeftInput
  NOT:         1,    // invert LeftInput
  GREATER:     3,    // LeftInput > Constant — confirmed via Sample_PDM15 LVD on accessory output (Battery Voltage > 7.5V)
  AND:         8,    // group operator (combines Operations in an OperationGroup)
  OR:          9,    // group operator (combines OperationGroups in a ConditionArray)
  FLASH:       13,   // uses TimeOn + TimeOff
  HYSTERESIS:  14,   // uses Constant (high) + Constant2 (low) — input-pin trigger
  BITMASK:     17,   // CAN-input bit extraction; uses Mask field
  // ── below: not yet decoded; emitted as PASSTHROUGH with TODO comment ──
  // To decode: generate a probe .pdm in PDM Manager with one of each operator,
  // save it, then parse to extract the codes (samples don't exercise these).
  PULSE:       0,    // TODO decode (probe needed)
  SET_RESET:   0,    // TODO decode (probe needed)
  TOGGLE:      0,    // TODO decode (probe needed)
  EQUAL:       0,    // TODO decode (probe needed)
  LESS:        0,    // TODO decode (probe needed)
};

// ──────────────────────────────────────────────────────────────────────
// XML helpers
// ──────────────────────────────────────────────────────────────────────
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function indent(level: number): string {
  return '  '.repeat(level);
}

// Empty <Operation> placeholder used when we don't know the operator yet.
// LeftInput should be set to the most relevant channel by the caller; the
// rest stays at neutral defaults so PDM Manager opens it without errors.
function emitOperation(level: number, opts: {
  leftInput?: string;
  rightInput?: string;
  operator?: number;
  constant?: number;
  constant2?: number;
  timeOn?: number;
  timeOff?: number;
  output?: string;
  invert?: boolean;
  withId?: boolean;       // InputPin's child Operation has ID="Operation" — sample p.79 etc.
  voltScale?: boolean;    // InputPin uses ADC volts/step calibration (0.197861 V step, 1 decimal)
}): string {
  const i = indent(level);
  const i2 = indent(level + 1);
  const openTag = opts.withId ? '<Operation ID="Operation">' : '<Operation>';
  // InputPin Constants are calibrated voltages; other Operations use raw integers
  const cStep = opts.voltScale ? '0.197861' : '1';
  const cUnits = opts.voltScale ? 'V' : '';
  const cDec = opts.voltScale ? '1' : '0';
  return `${i}${openTag}
${i2}<ChannelReference ID="Output" Value="${esc(opts.output ?? '')}"/>
${i2}<ChannelReference ID="LeftInput" Value="${esc(opts.leftInput ?? '')}"/>
${i2}<Operator ID="Operator" Value="${opts.operator ?? OP.PASSTHROUGH}"/>
${i2}<ChannelReference ID="RightInput" Value="${esc(opts.rightInput ?? '')}"/>
${i2}<SteppedValue ID="Constant" Value="${opts.constant ?? 0}" StepSize="${cStep}" Units="${cUnits}" ReservedBits="0" DecimalPlaces="${cDec}"/>
${i2}<SteppedValue ID="Constant2" Value="${opts.constant2 ?? 0}" StepSize="${cStep}" Units="${cUnits}" ReservedBits="0" DecimalPlaces="${cDec}"/>
${i2}<SteppedValue ID="TimeOn" Value="${opts.timeOn ?? 0}" StepSize="0.02" Units="s" ReservedBits="0" DecimalPlaces="2"/>
${i2}<SteppedValue ID="TimeOff" Value="${opts.timeOff ?? 0}" StepSize="0.02" Units="s" ReservedBits="0" DecimalPlaces="2"/>
${i2}<Polarity ID="Polarity" Value="0"/>
${i2}<Bool ID="InvertOutput" Value="${opts.invert ? 1 : 0}"/>
${i2}<Edge ID="Edge" Value="0"/>
${i}</Operation>`;
}

// ──────────────────────────────────────────────────────────────────────
// Condition expression → first channel reference (for stub passthrough).
// Used when we don't know the operator code yet — at minimum get a real
// channel name into LeftInput so Dave sees what input the condition
// should depend on, and can pick the operator from the GUI dropdown.
// ──────────────────────────────────────────────────────────────────────
function firstChannelRef(expression: string): string {
  // Identifier-ish words: skip reserved ops + numerics
  const re = /[a-zA-Z_][a-zA-Z0-9_.]*/g;
  const reserved = new Set([
    'NOT','AND','OR','TRUE','FALSE',
    'PULSE','FLASH','SET_RESET','HYSTERESIS','TOGGLE','COUNTER','PACK','CAN_RELAY','CAN_LINK_OK','AND_BITMASK',
    'Equal_to','Greater_than','Less_than','Not_equal_to',
    'input','set','reset','width','on_time','off_time','rise_delay','fall_delay','overflow_at',
    'ms','expired','rising_edge','falling_edge','Status','Voltage','Active','Current','Error',
  ]);
  let m: RegExpExecArray | null;
  while ((m = re.exec(expression)) !== null) {
    const tok = m[0];
    if (reserved.has(tok)) continue;
    if (/^\d/.test(tok)) continue;
    if (/^[A-Z][a-z]+$/.test(tok)) continue;
    return tok;
  }
  return '';
}

// Detect FLASH(input=X, on_time=Yms, off_time=Zms) — one of the operators we know.
function tryEmitFlash(expression: string): { input: string; onMs: number; offMs: number } | null {
  const flashMatch = expression.match(/FLASH\(input=([^,]+),\s*on_time=(\d+)ms,\s*off_time=(\d+)ms\)/);
  if (!flashMatch) return null;
  return {
    input: flashMatch[1].trim().split(/\s+OR\s+|\s+AND\s+/)[0], // first input only — multi-input flash gets lost in stub mode
    onMs: parseInt(flashMatch[2], 10),
    offMs: parseInt(flashMatch[3], 10),
  };
}

// Detect "X Greater_than Y" or "X Less_than Y" — comparison operators.
// Returns { input, threshold, op } where op is GREATER (3) or LESS (when decoded).
// Decoded via Sample_PDM15.pdm: GREATER_THAN = code 3.
function tryEmitCompare(expression: string): { input: string; threshold: number; opCode: number } | null {
  // Bail on anything with parens or boolean ops — only handle bare "X Greater_than N"
  if (/[()]|OR|AND|NOT/.test(expression)) return null;
  const gt = expression.match(/^(\S+)\s+Greater_than\s+([\d.]+)$/);
  if (gt && OP.GREATER !== 0) {
    return { input: gt[1].trim(), threshold: parseFloat(gt[2]), opCode: OP.GREATER };
  }
  const lt = expression.match(/^(\S+)\s+Less_than\s+([\d.]+)$/);
  if (lt && OP.LESS !== 0) {
    return { input: lt[1].trim(), threshold: parseFloat(lt[2]), opCode: OP.LESS };
  }
  const eq = expression.match(/^(\S+)\s+Equal_to\s+([\d.]+)$/);
  if (eq && OP.EQUAL !== 0) {
    return { input: eq[1].trim(), threshold: parseFloat(eq[2]), opCode: OP.EQUAL };
  }
  return null;
}

// Try to parse a simple boolean tree: A | A OR B | A AND B | NOT A | combinations.
// Returns the OR-of-AND structure that PDM Manager wants:
//   { ors: [ { ands: [ { ref, invert } ] } ] }
// PDM Manager's ConditionArray maps directly to this: each top-level array
// element = OperationGroup (AND'd internally), the array as a whole is OR'd.
type BoolTerm = { ref: string; invert: boolean };
type BoolTree = { ors: { ands: BoolTerm[] }[] };

function tryParseBool(expression: string): BoolTree | null {
  const expr = expression.trim();
  // Reject anything that uses operators we don't know yet — let those remain stubs
  if (/PULSE|SET_RESET|HYSTERESIS|TOGGLE|COUNTER|PACK|CAN_RELAY|CAN_LINK_OK|AND_BITMASK|FLASH/.test(expr)) return null;
  if (/Equal_to|Greater_than|Less_than|Not_equal_to/.test(expr)) return null;
  // Reject pure literals — PDM Manager wants a channel reference
  if (/^(TRUE|FALSE)$/.test(expr)) return null;
  // No parens supported in this naive parser — bail (those become stubs)
  if (/[()]/.test(expr)) return null;

  // Split on OR (top level) — naive but works for flat A OR B AND C
  const orParts = expr.split(/\s+OR\s+/);
  const ors: { ands: BoolTerm[] }[] = [];
  for (const part of orParts) {
    const ands: BoolTerm[] = [];
    const andParts = part.split(/\s+AND\s+/);
    for (const ap of andParts) {
      let term = ap.trim();
      let invert = false;
      const m = term.match(/^NOT\s+(.+)$/);
      if (m) { invert = true; term = m[1].trim(); }
      // Strip accessor for the underlying channel reference
      const baseRef = term;
      // Sanity: must look like an identifier path
      if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(baseRef)) return null;
      ands.push({ ref: baseRef, invert });
    }
    if (ands.length === 0) return null;
    ors.push({ ands });
  }
  if (ors.length === 0) return null;
  return { ors };
}

// ──────────────────────────────────────────────────────────────────────
// StaticChannels — PDM-builtin channel registry
// PDM30 has 24 InputADC channels + 32 CANInput byte channels (4×8).
// PDM15 has 23 InputADC channels (per shipped Sample_PDM15.pdm) + 32 CAN.
// ──────────────────────────────────────────────────────────────────────
function emitStaticChannels(pdmType: 'PDM30' | 'PDM15'): string {
  const adcCount = pdmType === 'PDM30' ? 24 : 23;
  const adcLines: string[] = [];
  for (let i = 1; i <= adcCount; i++) {
    adcLines.push(`      <ChannelReference Name="Input Voltages.Pin ${i}" Value="PDM.Input Voltages.Pin ${i}"/>`);
  }
  const canLines: string[] = [];
  for (let msg = 0; msg <= 3; msg++) {
    for (let byte = 0; byte <= 7; byte++) {
      canLines.push(`      <ChannelReference Name="CAN Inputs.Message ${msg}.Byte ${byte}" Value="PDM.CAN Inputs.Message ${msg}.Byte ${byte}"/>`);
    }
  }

  return `  <StaticChannels ID="StaticChannels">
    <StaticChannelsArray ID="InputADCArray">
${adcLines.join('\n')}
    </StaticChannelsArray>
    <StaticChannelsArray ID="CANInputArray">
${canLines.join('\n')}
    </StaticChannelsArray>
    <ChannelReference ID="9V5" Value="PDM.Internal 9V5"/>
    <ChannelReference ID="BatVolts" Value="PDM.Battery Voltage"/>
    <ChannelReference ID="Temperature" Value="PDM.Temperature"/>
    <ChannelReference ID="True" Value="PDM.Constants.True"/>
    <ChannelReference ID="False" Value="PDM.Constants.False"/>
    <ChannelReference ID="TotalCurrent" Value="PDM.Total Current"/>
    <ChannelReference ID="GlobalError" Value="PDM.Global Error"/>
    <ChannelReference ID="CanTimeout" Value="PDM.CAN Timeout"/>
    <ChannelReference ID="CanTimeoutMessage0" Value="PDM.CAN Timeout.Message 0"/>
    <ChannelReference ID="CanTimeoutMessage1" Value="PDM.CAN Timeout.Message 1"/>
    <ChannelReference ID="CanTimeoutMessage2" Value="PDM.CAN Timeout.Message 2"/>
    <ChannelReference ID="CanTimeoutMessage3" Value="PDM.CAN Timeout.Message 3"/>
  </StaticChannels>`;
}

// ──────────────────────────────────────────────────────────────────────
// InputPins block — each input pin uses HYSTERESIS (op=14) with high/low
// trigger thresholds. The K5 spec uses 4.2V high / 3.5V low.
// ──────────────────────────────────────────────────────────────────────
function emitInputPins(cfg: PdmConfig): string {
  const lines: string[] = ['  <InputPins ID="InputPins">', '    <InputPinsArray ID="Array">'];
  for (let idx = 0; idx < cfg.input_pins.length; idx++) {
    const p = cfg.input_pins[idx];
    const channel = rename(p.channel_name);
    lines.push(`      <InputPin PinIndex="${idx}">`);
    lines.push(emitOperation(4, {
      leftInput: `PDM.Input Voltages.Pin ${idx + 1}`,
      operator: OP.HYSTERESIS,
      constant: p.trigger_high_v,
      constant2: p.trigger_low_v,
      timeOn: p.debounce_ms / 1000,
      timeOff: p.debounce_ms / 1000,
      withId: true,
      voltScale: true,    // ADC volts/step calibration for hysteresis thresholds
    }));
    lines.push(`        <ChannelReference ID="Output" Value="${esc(channel)}"/>`);
    lines.push(`        <ChannelReference ID="Voltage" Value="${esc(channel)}.Voltage"/>`);
    lines.push(`      </InputPin>`);
  }
  lines.push('    </InputPinsArray>', '  </InputPins>');
  return lines.join('\n');
}

// ──────────────────────────────────────────────────────────────────────
// OutputPins block — each output references its driven_by channel.
// PDM30 PinIndex maps: OUT1→0 ... OUT30→29.
// ──────────────────────────────────────────────────────────────────────
function emitOutputPins(cfg: PdmConfig): string {
  const lines: string[] = ['  <OutputPins ID="OutputPins">', '    <OutputPinsArray ID="Array">'];
  for (const o of cfg.output_pins) {
    const pinIndex = o.out - 1;
    const baseChan = rename(o.driven_by.replace(/\.(Status|Voltage|rising_edge|falling_edge|expired)$/, ''));
    // Output channel name follows JBS convention: PDM.Output.{Category}.{Subsystem}
    // Route through rename() so daveify() classifies it like every other channel.
    // Source the seed name from the device (TitleCase with spaces stripped to camelCase
    // for the rename map lookup, then daveify catches it via subsystem rules).
    const deviceSlug = o.device
      .replace(/[^a-zA-Z0-9 ]/g, ' ')
      .split(/\s+/).filter(Boolean)
      .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('');
    // Daveify categorizes by content — pass the device slug, get back JBS-style hierarchy.
    const outputChan = rename(`pdm.outputs.${deviceSlug}`);
    lines.push(`      <OutputPin PinIndex="${pinIndex}">`);
    lines.push(`        <Polarity ID="Polarity" Value="0"/>`);
    lines.push(`        <ChannelReference ID="Input" Value=""/>`);
    lines.push(`        <Condition ID="Output">`);
    lines.push(`          <ChannelReference ID="Output" Value="${esc(outputChan)}"/>`);
    lines.push(`          <ConditionArray ID="Array">`);
    lines.push(`            <OperationGroup>`);
    lines.push(`              <OperationGroupArray ID="Array">`);
    lines.push(emitOperation(8, { leftInput: baseChan, operator: OP.PASSTHROUGH }));
    lines.push(`              </OperationGroupArray>`);
    lines.push(`              <Operator ID="Operator" Value="${OP.AND}"/>`);
    lines.push(`            </OperationGroup>`);
    lines.push(`          </ConditionArray>`);
    lines.push(`          <Operator ID="Operator" Value="${OP.OR}"/>`);
    lines.push(`          <Text ID="Comment"/>`);
    lines.push(`        </Condition>`);
    // Status sub-channel references — order matches Sample_PDM15.pdm exactly.
    // "Over Current" and "Retries Done" have a SPACE in the .Value path
    // because PDM Manager's auto-generated channel labels use that.
    lines.push(`        <ChannelReference ID="Active" Value="${esc(outputChan)}.Status.Active"/>`);
    lines.push(`        <ChannelReference ID="Current" Value="${esc(outputChan)}.Current"/>`);
    lines.push(`        <ChannelReference ID="Voltage" Value="${esc(outputChan)}.Voltage"/>`);
    lines.push(`        <ChannelReference ID="Load" Value="${esc(outputChan)}.Load"/>`);
    lines.push(`        <ChannelReference ID="Status" Value="${esc(outputChan)}.Status"/>`);
    lines.push(`        <ChannelReference ID="OverCurrent" Value="${esc(outputChan)}.Status.Over Current"/>`);
    lines.push(`        <ChannelReference ID="Fault" Value="${esc(outputChan)}.Status.Fault"/>`);
    lines.push(`        <ChannelReference ID="RetriesDone" Value="${esc(outputChan)}.Status.Retries Done"/>`);
    lines.push(`        <SteppedValue ID="MaxCurrent" Value="${o.max_amps}" StepSize="1" Units="A" ReservedBits="0" DecimalPlaces="0"/>`);
    lines.push(`        <SteppedValue ID="RetryDelay" Value="${o.retry_delay_s}" StepSize="0.1" Units="s" ReservedBits="0" DecimalPlaces="1"/>`);
    lines.push(`        <SteppedValue ID="NumRetries" Value="${o.retries}" StepSize="1" Units="" ReservedBits="0" DecimalPlaces="0"/>`);
    lines.push(`        <Bool ID="AlwaysRetry" Value="${(o as any).always_retry ? 1 : 0}"/>`);
    lines.push(`        <Text ID="Comment"/>`);  // sample requires this trailing element on every OutputPin
    lines.push(`      </OutputPin>`);
  }
  lines.push('    </OutputPinsArray>');
  // Master Retry binding (Manual p.18) — points at the keypad master_retry action.
  lines.push(`    <ChannelReference ID="MasterRetry" Value="${rename('keypad_button_master_retry')}"/>`);
  lines.push('  </OutputPins>');
  return lines.join('\n');
}

// ──────────────────────────────────────────────────────────────────────
// Conditions block — emit each user-defined Condition.
//   - FLASH detected → emit op=13 with TimeOn/TimeOff
//   - All others → stub: passthrough op=0 with first-channel as LeftInput
//     and a CDATA Comment marking it TODO so Dave knows to revisit.
// ──────────────────────────────────────────────────────────────────────
function emitCondition(c: PdmCondition): string {
  // Priority 1: FLASH — fully decoded operator, direct emission
  const flash = tryEmitFlash(c.expression);
  // Priority 2: comparison (Greater_than, Less_than, Equal_to) — Greater decoded as op=3
  const compare = !flash ? tryEmitCompare(c.expression) : null;
  // Priority 3: bool tree (AND/OR/NOT) — also fully decoded
  const bool = !flash && !compare ? tryParseBool(c.expression) : null;
  // Priority 4: stub — emit passthrough with first channel + TODO comment
  const isStub = !flash && !compare && !bool;

  const renamedOutput = rename(c.name);
  const opGroups: string[] = [];
  if (flash) {
    opGroups.push(`          <OperationGroup>
            <OperationGroupArray ID="Array">
${emitOperation(7, { leftInput: rename(flash.input), operator: OP.FLASH, timeOn: flash.onMs / 1000, timeOff: flash.offMs / 1000 })}
            </OperationGroupArray>
            <Operator ID="Operator" Value="${OP.AND}"/>
          </OperationGroup>`);
  } else if (compare) {
    opGroups.push(`          <OperationGroup>
            <OperationGroupArray ID="Array">
${emitOperation(7, { leftInput: rename(compare.input), operator: compare.opCode, constant: compare.threshold })}
            </OperationGroupArray>
            <Operator ID="Operator" Value="${OP.AND}"/>
          </OperationGroup>`);
  } else if (bool) {
    for (const orPart of bool.ors) {
      const ops = orPart.ands.map(t => emitOperation(7, {
        leftInput: rename(t.ref),
        operator: t.invert ? OP.NOT : OP.PASSTHROUGH,
        invert: false,
      })).join('\n');
      opGroups.push(`          <OperationGroup>
            <OperationGroupArray ID="Array">
${ops}
            </OperationGroupArray>
            <Operator ID="Operator" Value="${OP.AND}"/>
          </OperationGroup>`);
    }
  } else {
    const leftInput = rename(firstChannelRef(c.expression));
    opGroups.push(`          <OperationGroup>
            <OperationGroupArray ID="Array">
${emitOperation(7, { leftInput, operator: OP.PASSTHROUGH })}
            </OperationGroupArray>
            <Operator ID="Operator" Value="${OP.AND}"/>
          </OperationGroup>`);
  }

  const renamedExpr = renameExpression(c.expression);
  const todoComment = isStub
    ? `        <Text ID="Comment">\n<![CDATA[TODO operator not yet decoded — pick from PDM Manager dropdown:\n${renamedExpr}\n${c.note ? '(' + c.note + ')' : ''}]]>\n        </Text>`
    : (c.note ? `        <Text ID="Comment">\n<![CDATA[${c.note}]]>\n        </Text>` : '        <Text ID="Comment"/>');

  return `      <Condition>
        <ChannelReference ID="Output" Value="${esc(renamedOutput)}"/>
        <ConditionArray ID="Array">
${opGroups.join('\n')}
        </ConditionArray>
        <Operator ID="Operator" Value="${OP.OR}"/>
${todoComment}
      </Condition>`;
}

function emitConditions(cfg: PdmConfig): string {
  const lines: string[] = ['  <Conditions ID="Conditions">', '    <ConditionsArray ID="Array">'];
  for (const c of cfg.conditions) lines.push(emitCondition(c));
  lines.push('    </ConditionsArray>', '  </Conditions>');
  return lines.join('\n');
}

// ──────────────────────────────────────────────────────────────────────
// CAN Inputs block — group extractions by message offset within a frame.
// Each <CANInput> represents one bit/byte extraction with mask + size.
// ──────────────────────────────────────────────────────────────────────
function emitCanInputs(cfg: PdmConfig): string {
  // Compute base address from the first CAN ID we see (assume all share a base).
  // The K5 uses 0x100 for M130; that decodes to 0x100 = 256 — but the
  // BaseAddress field in the sample is "280" decimal which is 0x118 —
  // it represents the lowest standard message slot. We'll output the
  // smallest CAN ID we see, decimal-formatted.
  let baseHex = 0x100;
  if (cfg.can_inputs.length > 0) {
    const ids = cfg.can_inputs.map(c => parseInt(c.can_id, 16)).filter(n => !isNaN(n));
    if (ids.length > 0) baseHex = Math.min(...ids);
  }

  const lines: string[] = ['  <CANInputs ID="CANInputs">', '    <CANInputsArray ID="Array">'];
  for (const c of cfg.can_inputs) {
    const maskNum = c.mask ? parseInt(c.mask, 16) : 0xFF;
    lines.push(`      <CANInput>`);
    lines.push(`        <ChannelReference ID="Output" Value="${esc(rename(c.name))}"/>`);
    lines.push(`        <SteppedValue ID="Offset" Value="${c.byte_offset}" StepSize="1" Units="" ReservedBits="0" DecimalPlaces="0"/>`);
    lines.push(`        <SteppedValue ID="Mask" Value="${maskNum}" StepSize="1" Units="" ReservedBits="0" DecimalPlaces="0"/>`);
    lines.push(emitOperation(4, { operator: OP.BITMASK, withId: true }));
    lines.push(`        <DataSize ID="DataSize" Value="${c.size_bits === 16 ? 1 : 0}"/>`);
    lines.push(`        <Bool ID="Timeout" Value="${c.fail_value !== undefined ? 1 : 0}"/>`);
    lines.push(`        <SteppedValue ID="TimeoutValue" Value="${c.fail_value ?? 0}" StepSize="1" Units="" ReservedBits="0" DecimalPlaces="0"/>`);
    lines.push(`      </CANInput>`);
  }
  lines.push('    </CANInputsArray>');
  lines.push(`    <SteppedValue ID="BaseAddress" Value="${baseHex}" StepSize="1" Units="" ReservedBits="3" DecimalPlaces="0"/>`);
  for (let i = 0; i <= 3; i++) {
    lines.push(`    <SteppedValue ID="Message ${i} Timeout" Value="1" StepSize="0.1" Units="s" ReservedBits="0" DecimalPlaces="1"/>`);
  }
  lines.push('  </CANInputs>');
  return lines.join('\n');
}

// ──────────────────────────────────────────────────────────────────────
// CAN Outputs block — Standard messages enabled + up to 4 user-defined.
// The K5 PDM30 uses 2 user-defined: 0x320 (K5_body_state) + 0x321 (K5_brake_status).
// ──────────────────────────────────────────────────────────────────────
function emitCanOutputs(cfg: PdmConfig): string {
  const baseAddr = parseInt(cfg.global.can_base_address, 16) || 0x300;
  const userMsgs = cfg.can_outputs.slice(0, 4);
  while (userMsgs.length < 4) {
    userMsgs.push({ slot: userMsgs.length + 1, can_id: `0x${(0x320 + userMsgs.length).toString(16)}`, rate_hz: 20, bytes: [], transmit_when: '' });
  }

  const lines: string[] = ['  <CANOutputs ID="CANOutputs">'];
  lines.push(`    <StandardMessages ID="StandardMessages">`);
  lines.push(`      <SteppedValue ID="BaseAddress" Value="${baseAddr}" StepSize="1" Units="" ReservedBits="7" DecimalPlaces="0"/>`);
  for (const flag of ['InputState','OutputCurrent','OutputLoad','OutputVoltage','OutputState','InputVoltage']) {
    lines.push(`      <Bool ID="${flag}" Value="1"/>`);
  }
  lines.push(`    </StandardMessages>`);
  for (let i = 0; i < 4; i++) {
    const msg = userMsgs[i];
    const addr = parseInt(msg.can_id, 16) || (0x320 + i);
    lines.push(`    <CANMessage ID="Message${i}">`);
    lines.push(`      <SteppedValue ID="Address" Value="${addr}" StepSize="1" Units="" ReservedBits="0" DecimalPlaces="0"/>`);
    for (let b = 0; b < 8; b++) {
      const byteEntry = msg.bytes.find(x => x.byte === b);
      lines.push(`      <ChannelReference ID="Channel${b}" Value="${esc(rename(byteEntry?.channel ?? ''))}"/>`);
    }
    lines.push(`    </CANMessage>`);
  }
  lines.push('  </CANOutputs>');
  return lines.join('\n');
}

// ──────────────────────────────────────────────────────────────────────
// Top-level emitter
// ──────────────────────────────────────────────────────────────────────
export function pdmConfigToXml(cfg: PdmConfig): string {
  const pdmType = cfg.metadata.pdm_type === 'PDM15' ? 'PDM15' : 'PDM30';
  // PDMType integer code — confirmed via UTF-16 enum table extracted from
  // PDM Manager.exe at offset 0x77fa10. Declaration order: PDM15, PDM16, PDM30, PDM32.
  //   0 = PDM15
  //   1 = PDM16  (Autosport connector with lettered pins A_A..A_c — DO NOT USE for PDM30)
  //   2 = PDM30  (Connector A pins A_19, A_21, A_23, A_27, A_29..A_34 for DIG inputs)
  //   3 = PDM32  (PDM V2 hardware; also requires Container Version="2")
  const pdmTypeCode = pdmType === 'PDM15' ? 0 : 2;
  const flashCount = cfg.conditions.filter(c => tryEmitFlash(c.expression)).length;
  const stubCount = cfg.conditions.length - flashCount;

  const parts: string[] = [
    '<?xml version="1.0"?>',
    // Sample_PDM15 schema (no Version attribute, AU locale) — loads cleanly.
    // JBS uses Version="5" but that schema requires additional elements we don't yet emit.
    '<Container Locale="English_Australia.1252" DefaultLocale="C" ID="UserConfiguration">',
    `  <SteppedValue ID="SerialNumber" Value="0" StepSize="1" Units="" ReservedBits="0" DecimalPlaces="0"/>`,
    emitStaticChannels(pdmType),
    emitInputPins(cfg),
    emitOutputPins(cfg),
    emitConditions(cfg),
    emitCanInputs(cfg),
    emitCanOutputs(cfg),
    `  <PDMType ID="PDMType" Value="${pdmTypeCode}"/>`,
    `  <Text ID="Comment">\n<![CDATA[Generated by Nuke PDM emitter ${cfg.metadata.generated_at}.\nSpec: ${cfg.metadata.spec_source}\n${flashCount} conditions encoded with known operators (FLASH/AND/OR/NOT/HYSTERESIS/bitmask).\n${stubCount} conditions emitted as PASSTHROUGH stubs — open each in PDM Manager and pick the correct operator from the dropdown.]]>\n  </Text>`,
    `  <Text ID="ConfigName">\n<![CDATA[${cfg.metadata.vehicle} ${pdmType}]]>\n  </Text>`,
    '</Container>',
  ];
  return parts.join('\n');
}

// Diagnostic — count what's known vs stub for caller awareness.
export function pdmXmlStats(cfg: PdmConfig): { flash: number; bool: number; stub: number; total: number } {
  let flash = 0, bool = 0, stub = 0;
  for (const c of cfg.conditions) {
    if (tryEmitFlash(c.expression)) flash++;
    else if (tryParseBool(c.expression)) bool++;
    else stub++;
  }
  return { flash, bool, stub, total: cfg.conditions.length };
}
