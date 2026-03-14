import { NukeWidgetBase, type PopupRow } from '../../core/NukeWidgetBase';
import type { CompSale } from '../../core/types';

const CSS = `
.vl-card {
  background: var(--nw-surface);
  border: 2px solid var(--nw-border);
  padding: var(--nw-space-4);
}

/* Input */
.vl-heading {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--nw-text);
  padding-bottom: var(--nw-space-3);
  border-bottom: 1px solid var(--nw-border);
  margin-bottom: var(--nw-space-3);
}
.vl-row {
  display: flex;
  gap: var(--nw-space-2);
}
.vl-input {
  flex: 1;
  padding: var(--nw-space-2) var(--nw-space-3);
  font-family: var(--nw-font-mono);
  font-size: 10px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  background: var(--nw-bg);
  border: 2px solid var(--nw-border);
  color: var(--nw-text);
  outline: none;
  transition: border-color var(--nw-transition);
}
.vl-input:focus { border-color: var(--nw-border-focus); }
.vl-input::placeholder { color: var(--nw-text-disabled); text-transform: none; }
.vl-select {
  flex: 1;
  padding: var(--nw-space-2);
  font-size: 9px;
  background: var(--nw-bg);
  border: 2px solid var(--nw-border);
  color: var(--nw-text);
  font-family: Arial, sans-serif;
  outline: none;
  cursor: pointer;
}
.vl-select:focus { border-color: var(--nw-border-focus); }
.vl-btn {
  padding: var(--nw-space-2) var(--nw-space-4);
  background: var(--nw-bg);
  border: 2px solid var(--nw-border);
  color: var(--nw-text);
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  cursor: pointer;
  font-family: Arial, sans-serif;
  transition: all var(--nw-transition);
}
.vl-btn:hover { border-color: var(--nw-border-focus); color: var(--nw-accent); }
.vl-btn:disabled { opacity: 0.4; cursor: default; }
.vl-hint {
  font-size: 8px;
  color: var(--nw-text-disabled);
  margin-top: var(--nw-space-1);
}
.vl-ymm { margin-bottom: var(--nw-space-2); }

/* Vehicle header */
.vl-vehicle {
  padding-bottom: var(--nw-space-3);
  border-bottom: 1px solid var(--nw-border);
  margin-bottom: var(--nw-space-3);
}
.vl-vehicle-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--nw-text);
  line-height: 1.3;
}
.vl-vehicle-vin {
  font-family: var(--nw-font-mono);
  font-size: 9px;
  color: var(--nw-text-disabled);
  margin-top: 2px;
}

/* Intelligence grid */
.vl-section {
  font-size: 7px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--nw-text-disabled);
  margin-bottom: var(--nw-space-1);
}
.vl-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  margin-bottom: var(--nw-space-3);
}
.vl-cell {
  padding: var(--nw-space-2) 0;
  border-bottom: 1px solid var(--nw-border);
}
.vl-cell:nth-child(odd) {
  padding-right: var(--nw-space-3);
  border-right: 1px solid var(--nw-border);
}
.vl-cell:nth-child(even) {
  padding-left: var(--nw-space-3);
}
.vl-cell--full {
  grid-column: 1 / -1;
  padding-right: 0;
  border-right: none;
}
.vl-cell-label {
  font-size: 7px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--nw-text-disabled);
  font-weight: 600;
}
.vl-cell-value {
  font-family: var(--nw-font-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--nw-text);
  margin-top: 1px;
}
.vl-cell-value--lg {
  font-size: 16px;
  letter-spacing: -0.02em;
}
.vl-cell-value--sm {
  font-size: 9px;
  font-weight: 600;
}
.vl-cell-context {
  font-size: 7px;
  color: var(--nw-text-disabled);
  margin-top: 1px;
}

/* Signals */
.vl-signal--hot { color: var(--nw-error); }
.vl-signal--warm { color: var(--nw-warning); }
.vl-signal--cool { color: var(--nw-text-secondary); }
.vl-signal--good { color: var(--nw-success); }

/* Comps */
.vl-comps {
  padding-top: var(--nw-space-3);
  border-top: 1px solid var(--nw-border);
}
.vl-comp {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 4px 0;
  border-bottom: 1px solid var(--nw-border);
}
.vl-comp:last-child { border-bottom: none; }
.vl-comp-info { font-size: 9px; color: var(--nw-text); }
.vl-comp-meta { font-size: 7px; color: var(--nw-text-disabled); }
.vl-comp-price {
  font-family: var(--nw-font-mono);
  font-size: 10px;
  font-weight: 700;
  color: var(--nw-text);
  flex-shrink: 0;
}

/* Reset */
.vl-reset-btn {
  width: 100%;
  margin-top: var(--nw-space-3);
  background: none;
  border: 2px dashed var(--nw-border);
  color: var(--nw-text-disabled);
  font-size: 8px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  cursor: pointer;
  padding: var(--nw-space-2);
  font-family: Arial, sans-serif;
  transition: all var(--nw-transition);
}
.vl-reset-btn:hover { border-color: var(--nw-accent); color: var(--nw-text); }
`;

/**
 * <nuke-valuation> — Vehicle market intelligence from VIN or Y/M/M.
 *
 * Not just a price — full market context: valuation range, comparable sales,
 * demand heat, deal scoring, price tier, observation depth.
 * Every lookup feeds demand signals back to Nuke.
 *
 * @example
 * <nuke-valuation api-key="nk_pub_..." mode="vin"></nuke-valuation>
 * <nuke-valuation api-key="nk_pub_..." vin="1GCEK14L9EJ147915"></nuke-valuation>
 */
export class NukeValuationElement extends NukeWidgetBase {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _resultData: Record<string, any> | null = null;
  private _resultComps: CompSale[] = [];

  static get observedAttributes(): string[] {
    return [...super.observedAttributes, 'mode', 'vin'];
  }

  protected widgetCSS(): string { return CSS; }

  protected async init(): Promise<void> {
    const presetVin = this.getAttribute('vin');
    if (presetVin) {
      this.lookupVin(presetVin);
    } else {
      this.renderInput();
    }
  }

  private renderInput(): void {
    const mode = this.getAttribute('mode') || 'vin';
    const currentYear = new Date().getFullYear() + 1;
    const years = Array.from({ length: currentYear - 1919 }, (_, i) => currentYear - i);

    this.container.innerHTML = `
      <div class="vl-card">
        <div class="vl-heading">What's It Worth?</div>
        ${mode === 'search' ? `
          <div class="vl-row vl-ymm">
            <select class="vl-select" data-field="year">
              <option value="">Year</option>
              ${years.map(y => `<option value="${y}">${y}</option>`).join('')}
            </select>
            <input class="vl-input" type="text" placeholder="Make" data-field="make" />
            <input class="vl-input" type="text" placeholder="Model" data-field="model" />
          </div>
          <button class="vl-btn" data-action="lookup" disabled style="width:100%">Look Up</button>
        ` : `
          <div class="vl-row">
            <input class="vl-input" type="text" maxlength="17" placeholder="Enter VIN" data-field="vin" autocomplete="off" spellcheck="false" />
            <button class="vl-btn" data-action="lookup" disabled>Look Up</button>
          </div>
          <div class="vl-hint">17-character Vehicle Identification Number</div>
        `}
        ${this.poweredBy()}
      </div>
    `;

    this.attachHandlers(mode);
  }

  private attachHandlers(mode: string): void {
    const btn = this.container.querySelector('[data-action="lookup"]') as HTMLButtonElement;

    if (mode === 'search') {
      const y = this.container.querySelector('[data-field="year"]') as HTMLSelectElement;
      const mk = this.container.querySelector('[data-field="make"]') as HTMLInputElement;
      const md = this.container.querySelector('[data-field="model"]') as HTMLInputElement;
      const check = () => { btn.disabled = !y.value || !mk.value.trim() || !md.value.trim(); };
      y?.addEventListener('change', check);
      mk?.addEventListener('input', check);
      md?.addEventListener('input', check);
      btn?.addEventListener('click', () => {
        if (!btn.disabled) this.lookupYmm(parseInt(y.value), mk.value.trim(), md.value.trim());
      });
      [mk, md].forEach(el => el?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !btn.disabled) btn.click(); }));
    } else {
      const vin = this.container.querySelector('[data-field="vin"]') as HTMLInputElement;
      vin?.addEventListener('input', () => {
        vin.value = vin.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        btn.disabled = vin.value.length !== 17;
      });
      vin?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !btn.disabled) btn.click(); });
      btn?.addEventListener('click', () => { if (!btn.disabled) this.lookupVin(vin.value); });
    }
  }

  private showLoading(): void {
    this.container.innerHTML = `<div class="vl-card"><div class="nw-loading"><span class="nw-loading-text">Analyzing Market</span></div></div>`;
  }

  private async lookupVin(vin: string): Promise<void> {
    this.showLoading();
    try {
      // VIN lookup returns: { data: { ...vehicleFields, valuation, counts, images } }
      const raw = await this.callApi<{ data: Record<string, unknown> | null }>('api-v1-vin-lookup', {
        method: 'GET',
        path: vin.toUpperCase(),
      });

      const d = raw.data;
      if (!d) { this.showError('Vehicle not found'); return; }

      // Fetch comps — API returns { data: CompSale[], summary: {...} }
      let comps: CompSale[] = [];
      try {
        const r = await this.callApi<{ data: CompSale[]; summary: Record<string, unknown> }>('api-v1-comps', {
          method: 'POST',
          body: { year: d.year, make: d.make, model: d.model, limit: 5 },
        });
        comps = r.data || [];
      } catch { /* non-critical */ }

      this.renderResult(d as Record<string, unknown>, comps, vin);
      this.emit('nuke-valuation:result', { data: d, comps });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Vehicle not found';
      this.showError(msg);
      this.emit('nuke-valuation:error', { vin, error: msg });
    }
  }

  private async lookupYmm(year: number, make: string, model: string): Promise<void> {
    this.showLoading();
    try {
      // Comps API returns: { data: CompSale[], summary: { count, avg_price, median_price, min_price, max_price } }
      const compsRes = await this.callApi<{
        data: CompSale[];
        summary: { count: number; avg_price: number; median_price: number; min_price: number; max_price: number };
      }>('api-v1-comps', {
        method: 'POST',
        body: { year, make, model, limit: 10 },
      });

      const comps = compsRes.data || [];
      const summary = compsRes.summary;

      // Build synthetic data from comps summary
      const syntheticData = {
        year, make, model, trim: null,
        valuation: summary ? {
          estimated_value: summary.median_price ?? summary.avg_price ?? null,
          value_low: summary.min_price ?? null,
          value_high: summary.max_price ?? null,
          confidence_score: comps.length >= 5 ? 80 : comps.length >= 2 ? 50 : 20,
        } : null,
        counts: { observations: summary?.count ?? 0 },
      };

      this.renderResult(syntheticData, comps.slice(0, 5), null);
      this.emit('nuke-valuation:result', { ...syntheticData, comps });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Valuation not available';
      this.showError(msg);
      this.emit('nuke-valuation:error', { year, make, model, error: msg });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private renderResult(d: Record<string, any>, comps: CompSale[], vin: string | null): void {
    this._resultData = d;
    this._resultComps = comps;
    const title = [d.year, d.make, d.model, d.trim].filter(Boolean).join(' ') || 'Vehicle';
    const val = d.valuation as Record<string, any> | null;
    const counts = d.counts as Record<string, number> | null;

    const prices = comps.map(c => c.sale_price).filter((p): p is number => p != null && p > 0);
    const estValue = val?.estimated_value ?? (prices.length >= 2 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null);
    const low = val?.value_low ?? (prices.length >= 2 ? Math.min(...prices) : null);
    const high = val?.value_high ?? (prices.length >= 2 ? Math.max(...prices) : null);

    const heatSig = this.heatSignal(val?.heat_score_label);
    const dealSig = this.dealSignal(val?.deal_score_label);

    // Signal weights
    let sigHtml = '';
    if (val?.signal_weights) {
      const sw = val.signal_weights as Record<string, { weight: number; sourceCount: number }>;
      const maxW = Math.max(...Object.values(sw).map(s => s.weight || 0));
      sigHtml = '<div class="vl-section" style="margin-top:var(--nw-space-2)">Signal Weights</div>';
      for (const [key, sig] of Object.entries(sw)) {
        const pct = maxW > 0 ? ((sig.weight / maxW) * 100).toFixed(0) : '0';
        sigHtml += `<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px">
          <span style="font-size:7px;width:56px;text-align:right;text-transform:uppercase;letter-spacing:0.04em;color:var(--nw-text-disabled)">${this.escapeHtml(key)}</span>
          <div style="flex:1;height:3px;background:var(--nw-bg);border:1px solid var(--nw-border);overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--nw-accent)"></div></div>
          <span style="font-family:var(--nw-font-mono);font-size:7px;color:var(--nw-text-disabled);width:22px;text-align:right">${sig.sourceCount || 0}</span>
        </div>`;
      }
    }

    this.container.innerHTML = `
      <div class="vl-card">
        <div class="vl-vehicle">
          <div class="vl-vehicle-title">${this.escapeHtml(title)}</div>
          ${vin ? `<div class="vl-vehicle-vin">VIN ${this.escapeHtml(vin)}</div>` : ''}
        </div>

        <div class="vl-section">Valuation</div>
        <div class="vl-grid">
          ${estValue != null ? `
            <div class="vl-cell nw-inf" data-inf="est_value">
              <div class="vl-cell-label">Est. Value</div>
              <div class="vl-cell-value vl-cell-value--lg">${this.formatCurrency(estValue)}</div>
              ${low != null && high != null ? `<div class="vl-cell-context">${this.formatCurrency(low)} – ${this.formatCurrency(high)}</div>` : ''}
            </div>
          ` : `
            <div class="vl-cell">
              <div class="vl-cell-label">Est. Value</div>
              <div class="vl-cell-value vl-cell-value--sm" style="color:var(--nw-text-disabled)">Insufficient data</div>
            </div>
          `}
          ${val?.heat_score_label ? `
            <div class="vl-cell nw-inf" data-inf="heat">
              <div class="vl-cell-label">Market Heat</div>
              <div class="vl-cell-value vl-signal--${heatSig.cls}">${heatSig.label}</div>
            </div>
          ` : `
            <div class="vl-cell nw-inf" data-inf="comps_count">
              <div class="vl-cell-label">Comps Found</div>
              <div class="vl-cell-value">${prices.length}</div>
              <div class="vl-cell-context">comparable sales</div>
            </div>
          `}
          ${val?.deal_score_label ? `
            <div class="vl-cell nw-inf" data-inf="deal">
              <div class="vl-cell-label">Deal Score</div>
              <div class="vl-cell-value vl-signal--${dealSig.cls}">${dealSig.label}</div>
            </div>
          ` : ''}
          ${val?.price_tier ? `
            <div class="vl-cell nw-inf" data-inf="tier">
              <div class="vl-cell-label">Price Tier</div>
              <div class="vl-cell-value vl-cell-value--sm">${this.escapeHtml(val.price_tier.replace(/_/g, ' '))}</div>
            </div>
          ` : ''}
          ${val?.confidence_score != null ? `
            <div class="vl-cell nw-inf" data-inf="confidence">
              <div class="vl-cell-label">Confidence</div>
              <div class="vl-cell-value">${Math.round(val.confidence_score)}%</div>
              ${val.confidence_interval_pct ? `<div class="vl-cell-context">±${val.confidence_interval_pct}%</div>` : ''}
            </div>
          ` : ''}
          ${(counts?.observations ?? 0) > 0 ? `
            <div class="vl-cell nw-inf" data-inf="data_points">
              <div class="vl-cell-label">Data Points</div>
              <div class="vl-cell-value">${this.formatNumber(counts!.observations)}</div>
              <div class="vl-cell-context">in Nuke</div>
            </div>
          ` : ''}
        </div>

        ${sigHtml}

        ${comps.length > 0 ? `
          <div class="vl-comps">
            <div class="vl-section">Comparable Sales</div>
            ${comps.slice(0, 5).map((c, i) => {
              const meta = [c.color, c.location, c.mileage ? `${this.formatNumber(c.mileage)} mi` : null].filter(Boolean).join(' · ');
              return `<div class="vl-comp nw-inf" data-inf="comp_${i}">
                <div>
                  <div class="vl-comp-info">${this.escapeHtml([c.year, c.make, c.model].filter(Boolean).join(' '))}</div>
                  ${meta ? `<div class="vl-comp-meta">${this.escapeHtml(meta)}</div>` : ''}
                </div>
                <span class="vl-comp-price">${this.formatCurrency(c.sale_price)}</span>
              </div>`;
            }).join('')}
          </div>
        ` : ''}

        <button class="vl-reset-btn">Check Another</button>
        ${this.poweredBy()}
      </div>
    `;

    this.container.querySelector('.vl-reset-btn')?.addEventListener('click', () => this.renderInput());

    // Attach inference handlers
    const card = this.container.querySelector('.vl-card') as HTMLElement;
    if (card) {
      this.attachInferenceHandlers(card, card, (key, el) => {
        const result = this.computeInference(key);
        if (result) this.showPopup(card, el, result.title, result.lines, result.note);
      });
    }
  }

  private heatSignal(label: string | null | undefined): { label: string; cls: string } {
    if (!label) return { label: '—', cls: 'cool' };
    const map: Record<string, { label: string; cls: string }> = {
      hot: { label: 'Hot', cls: 'hot' },
      very_hot: { label: 'Very Hot', cls: 'hot' },
      warm: { label: 'Warm', cls: 'warm' },
      cool: { label: 'Cool', cls: 'cool' },
      cold: { label: 'Cold', cls: 'cool' },
    };
    return map[label] ?? { label: label.replace(/_/g, ' '), cls: 'cool' };
  }

  private dealSignal(label: string | null | undefined): { label: string; cls: string } {
    if (!label) return { label: '—', cls: 'cool' };
    if (label.includes('great') || label.includes('plus')) return { label: 'Great Deal', cls: 'good' };
    if (label.includes('good') || label === 'fair') return { label: 'Fair Value', cls: 'warm' };
    if (label.includes('minus')) return { label: 'Above Market', cls: 'cool' };
    return { label: label.replace(/_/g, ' '), cls: 'cool' };
  }

  // ─── Inference Engine ──────────────────────────────────────────

  private computeInference(key: string): { title: string; lines: PopupRow[]; note?: string } | null {
    const d = this._resultData;
    const comps = this._resultComps;
    if (!d) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val = d.valuation as Record<string, any> | null;
    const prices = comps.map(c => c.sale_price).filter((p): p is number => p != null && p > 0);
    const sorted = [...prices].sort((a, b) => a - b);

    if (key === 'est_value') {
      if (!val?.estimated_value && sorted.length < 2) return null;
      const est = val?.estimated_value ?? (sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : null);
      const lines: PopupRow[] = [];
      if (sorted.length > 0) {
        const median = sorted[Math.floor(sorted.length / 2)];
        lines.push({ label: 'Comp median', value: this.formatCurrency(median) });
        lines.push({ label: 'Spread', value: this.formatCurrency(sorted[sorted.length - 1] - sorted[0]) });
        if (est) {
          const below = sorted.filter(p => p < est).length;
          lines.push({ label: 'Percentile', value: `${Math.round((below / sorted.length) * 100)}th of ${sorted.length}`, type: 'bar', pct: Math.round((below / sorted.length) * 100) });
        }
      }
      if (val?.confidence_interval_pct) lines.push({ label: 'Confidence ±', value: `${val.confidence_interval_pct}%` });
      if (val?.signal_weights) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sw = val.signal_weights as Record<string, any>;
        const top = Object.entries(sw).sort((a, b) => ((b[1]).weight || 0) - ((a[1]).weight || 0))[0];
        if (top) lines.push({ label: 'Top signal', value: `${top[0]} (${top[1].sourceCount || 0} sources)` });
      }
      return { title: 'Valuation Breakdown', lines, note: `Based on ${sorted.length} comparable sales.` };
    }

    if (key === 'heat') {
      const lines: PopupRow[] = [];
      lines.push({ label: 'Heat', value: (val?.heat_score_label || '—').replace(/_/g, ' ') });
      const dated = comps.filter(c => c.sold_date && c.sale_price).sort((a, b) => new Date(b.sold_date!).getTime() - new Date(a.sold_date!).getTime());
      if (dated.length >= 4) {
        const half = Math.ceil(dated.length / 2);
        const avgR = dated.slice(0, half).reduce((a, c) => a + (c.sale_price || 0), 0) / half;
        const avgO = dated.slice(half).reduce((a, c) => a + (c.sale_price || 0), 0) / (dated.length - half);
        const trend = ((avgR - avgO) / avgO * 100).toFixed(1);
        lines.push({ label: 'Price trend', value: `${Number(trend) >= 0 ? '+' : ''}${trend}%`, cls: Number(trend) > 0 ? 'good' : Number(trend) < -5 ? 'warm' : undefined });
      }
      lines.push({ label: 'Comps', value: `${comps.length} sales found` });
      return { title: 'Market Heat', lines, note: 'Heat reflects market activity and price trends.' };
    }

    if (key === 'deal') {
      const lines: PopupRow[] = [];
      lines.push({ label: 'Score', value: (val?.deal_score_label || '—').replace(/_/g, ' ') });
      if (val?.deal_score != null) lines.push({ label: 'Raw', value: `${val.deal_score.toFixed(1)}` });
      return { title: 'Deal Analysis', lines };
    }

    if (key === 'confidence') {
      if (val?.confidence_score == null) return null;
      const lines: PopupRow[] = [];
      lines.push({ label: 'Score', value: `${Math.round(val.confidence_score)}%`, type: 'bar', pct: val.confidence_score });
      if (val.signal_weights) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sw = val.signal_weights as Record<string, any>;
        const entries = Object.entries(sw).sort((a, b) => ((b[1]).weight || 0) - ((a[1]).weight || 0));
        const topW = entries[0]?.[1]?.weight || 1;
        for (const [k, s] of entries.slice(0, 4)) {
          lines.push({ label: k, value: `${s.sourceCount || 0} src`, type: 'bar', pct: Math.round(((s.weight || 0) / topW) * 100) });
        }
      }
      return { title: 'Confidence Analysis', lines, note: `Higher confidence = more data signals. ${sorted.length} comps contribute.` };
    }

    if (key === 'tier') {
      return { title: 'Price Tier', lines: [{ label: 'Tier', value: (val?.price_tier || '—').replace(/_/g, ' ') }], note: 'Classifies the vehicle within its market segment.' };
    }

    if (key === 'comps_count') {
      const lines: PopupRow[] = [{ label: 'Found', value: `${prices.length} sales` }];
      if (sorted.length >= 2) {
        lines.push({ label: 'Range', value: `${this.formatCurrency(sorted[0])} – ${this.formatCurrency(sorted[sorted.length - 1])}` });
        lines.push({ label: 'Median', value: this.formatCurrency(sorted[Math.floor(sorted.length / 2)]) });
      }
      return { title: 'Comparable Sales', lines };
    }

    if (key === 'data_points') {
      return { title: 'Data Points', lines: [{ label: 'Observations', value: `${d.counts?.observations || 0} in Nuke` }], note: 'Observations include auction results, community sentiment, condition reports, and provenance data.' };
    }

    if (key.startsWith('comp_')) {
      const idx = parseInt(key.slice(5));
      const c = comps[idx];
      if (!c) return null;
      const lines: PopupRow[] = [];
      lines.push({ label: 'Vehicle', value: [c.year, c.make, c.model, c.trim].filter(Boolean).join(' ') });
      if (c.sale_price) lines.push({ label: 'Price', value: this.formatCurrency(c.sale_price) });
      if (c.platform) lines.push({ label: 'Platform', value: c.platform.replace(/_/g, ' ') });
      if (c.sold_date) lines.push({ label: 'Sold', value: new Date(c.sold_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) });
      if (c.mileage) lines.push({ label: 'Mileage', value: `${this.formatNumber(c.mileage)} mi` });
      if (c.color) lines.push({ label: 'Color', value: c.color });
      if (c.location) lines.push({ label: 'Location', value: c.location });
      // vs estimated value
      const est = val?.estimated_value;
      if (c.sale_price && est) {
        const pct = (((c.sale_price - est) / est) * 100).toFixed(1);
        lines.push({ label: 'vs estimate', value: `${Number(pct) >= 0 ? '+' : ''}${pct}%`, cls: Number(pct) > 5 ? 'good' : Number(pct) < -5 ? 'warm' : undefined });
      }
      return { title: 'Comparable Sale', lines };
    }

    return null;
  }

  protected cleanup(): void {}

  protected onAttributeChanged(name: string): void {
    if (name === 'vin') {
      const vin = this.getAttribute('vin');
      if (vin) this.lookupVin(vin);
    }
    if (name === 'mode') this.renderInput();
  }
}

if (!customElements.get('nuke-valuation')) {
  customElements.define('nuke-valuation', NukeValuationElement);
}
