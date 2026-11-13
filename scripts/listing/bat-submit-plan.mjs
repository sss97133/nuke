// bat-submit-plan.mjs: pure planning for the BaT browser submit worker.
// No browser, no network: given the labels read from the live form (in DOM
// order) and a browser_submit job's field_map, decide what to fill, in which
// order, and what is left to the owner. Tested in bat-submit-plan.test.mjs.

/** Lowercase, strip punctuation and BaT's required-asterisk, collapse spaces. */
export function normLabel(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\*|\(required\)/g, '')
    .replace(/[^a-z0-9"/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Match a field-map label to a DOM label. Exact normalized match first; then
 * the DOM label containing the map label (BaT appends helper text); then the
 * input name hint. Returns the DOM entry or null.
 */
export function matchDom(label, field, dom) {
  const n = normLabel(label);
  return (
    dom.find((d) => normLabel(d.label) === n) ??
    dom.find((d) => n.length >= 4 && normLabel(d.label).startsWith(n)) ??
    (field?.nameHint ? dom.find((d) => d.name === field.nameHint) : undefined) ??
    null
  );
}

/**
 * Build the fill plan.
 * @param {Array<{label:string,name?:string|null,step?:string}>} dom labels in DOM order
 * @param {Record<string, {value:any,tier:string,order:number,control:string,nameHint?:string|null}>} fieldMap
 * @returns {{fill:Array, ownerTaps:string[], unmatched:string[], notOnForm:string[]}}
 */
export function planFill(dom, fieldMap) {
  const fill = [];
  const ownerTaps = [];
  const unmatched = [];
  const used = new Set();
  for (const [label, field] of Object.entries(fieldMap ?? {})) {
    if (field.tier === 'sign') { ownerTaps.push(label); continue; } // never auto-filled
    if (field.value == null || field.value === '') continue;
    const d = matchDom(label, field, dom.filter((x) => !used.has(x)));
    if (!d) { unmatched.push(label); continue; }
    used.add(d);
    fill.push({
      label,
      domLabel: d.label,
      domIndex: dom.indexOf(d),
      name: d.name ?? null,
      control: field.control,
      value: field.value,
      tier: field.tier,
    });
  }
  fill.sort((a, b) => a.domIndex - b.domIndex);
  // Form questions the map does not cover at all (a new BaT question or a relabel).
  const mapped = new Set(Object.keys(fieldMap ?? {}).map(normLabel));
  const notOnForm = dom.filter((d) => !used.has(d) && !mapped.has(normLabel(d.label))).map((d) => d.label);
  return { fill, ownerTaps, unmatched, notOnForm };
}

/** Pick the select option for a value: exact, then code prefix ("75 - Buccaneer Red"), then contains, then number token. */
export function pickOption(options, value) {
  const v = normLabel(value);
  if (!v) return null;
  const opts = options.map((o) => ({ o, n: normLabel(o) }));
  return (
    opts.find((x) => x.n === v)?.o ??
    opts.find((x) => x.n.startsWith(v + ' ') || x.n.startsWith(v + '-'))?.o ??
    opts.find((x) => x.n.includes(v))?.o ??
    (() => {
      const num = v.match(/\d{3}/)?.[0];
      return num ? opts.find((x) => x.n.includes(num))?.o ?? null : null;
    })()
  );
}

/** A button the worker must never press. */
export const FORBIDDEN_BUTTON = /^(finish|submit|submit listing|complete|pay|agree and submit)$/i;
