import { NukeWidgetBase, type PopupRow } from '../../core/NukeWidgetBase';
import type { VisionAnalysisResult, CompSale } from '../../core/types';

const CSS = `
.vi-card {
  background: var(--nw-surface);
  border: 2px solid var(--nw-border);
}

/* Dropzone */
.vi-drop {
  border: 2px dashed var(--nw-border);
  padding: var(--nw-space-6);
  text-align: center;
  cursor: pointer;
  transition: all var(--nw-transition);
  background: var(--nw-bg);
  margin: var(--nw-space-4);
}
.vi-drop:hover, .vi-drop--active {
  border-color: var(--nw-accent);
  background: var(--nw-accent-dim);
}
.vi-drop-icon {
  font-size: 24px;
  color: var(--nw-text-disabled);
  margin-bottom: var(--nw-space-2);
  line-height: 1;
  transition: color var(--nw-transition);
}
.vi-drop:hover .vi-drop-icon { color: var(--nw-accent); }
.vi-drop-text {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--nw-text-secondary);
}
.vi-drop-sub {
  font-size: 8px;
  color: var(--nw-text-disabled);
  margin-top: var(--nw-space-1);
}

/* Analyzing state */
.vi-analyzing {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--nw-space-2);
  padding: var(--nw-space-6);
}
.vi-analyzing::before {
  content: '';
  width: 24px;
  height: 2px;
  background: var(--nw-border);
  animation: nw-pulse 1.2s ease-in-out infinite;
}
.vi-analyzing-text {
  font-size: 8px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--nw-text-disabled);
}

/* Preview */
.vi-preview {
  width: 100%;
  max-height: 200px;
  object-fit: contain;
  background: var(--nw-bg);
  display: block;
}

/* Intelligence readout */
.vi-intel {
  padding: var(--nw-space-4);
}
.vi-id {
  padding-bottom: var(--nw-space-3);
  border-bottom: 1px solid var(--nw-border);
  margin-bottom: var(--nw-space-3);
}
.vi-id-make {
  font-size: 13px;
  font-weight: 700;
  color: var(--nw-text);
  line-height: 1.2;
}
.vi-id-conf {
  display: flex;
  align-items: center;
  gap: var(--nw-space-2);
  margin-top: 4px;
}
.vi-id-conf-bar {
  flex: 1;
  height: 3px;
  background: var(--nw-bg);
  border: 1px solid var(--nw-border);
  overflow: hidden;
}
.vi-id-conf-fill {
  height: 100%;
  background: var(--nw-accent);
}
.vi-id-conf-pct {
  font-family: var(--nw-font-mono);
  font-size: 9px;
  color: var(--nw-text-secondary);
}
.vi-id-not-vehicle {
  font-size: 9px;
  color: var(--nw-text-disabled);
  margin-top: 4px;
}

/* Data grid — the intelligence */
.vi-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
}
.vi-cell {
  padding: var(--nw-space-2) 0;
  border-bottom: 1px solid var(--nw-border);
}
.vi-cell:nth-child(odd) {
  padding-right: var(--nw-space-3);
  border-right: 1px solid var(--nw-border);
}
.vi-cell:nth-child(even) {
  padding-left: var(--nw-space-3);
}
.vi-cell-label {
  font-size: 7px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--nw-text-disabled);
  font-weight: 600;
}
.vi-cell-value {
  font-family: var(--nw-font-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--nw-text);
  margin-top: 1px;
}
.vi-cell-value--sm {
  font-size: 9px;
  font-weight: 600;
}
.vi-cell-context {
  font-size: 7px;
  color: var(--nw-text-disabled);
  margin-top: 1px;
}
.vi-cell--full {
  grid-column: 1 / -1;
  padding-right: 0;
  border-right: none;
}

/* Signal indicators */
.vi-signal { display: inline-block; }
.vi-signal--hot { color: var(--nw-error); }
.vi-signal--warm { color: var(--nw-warning); }
.vi-signal--cool { color: var(--nw-text-secondary); }
.vi-signal--good { color: var(--nw-success); }

/* Alternates */
.vi-alts {
  padding-top: var(--nw-space-2);
}
.vi-alt {
  display: flex;
  justify-content: space-between;
  padding: 2px 0;
  font-size: 9px;
}
.vi-alt-label { color: var(--nw-text-secondary); }
.vi-alt-pct {
  font-family: var(--nw-font-mono);
  color: var(--nw-text-disabled);
  font-size: 8px;
}

/* Condition */
.vi-condition {
  padding-top: var(--nw-space-3);
  border-top: 1px solid var(--nw-border);
}
.vi-flags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: var(--nw-space-1);
}
.vi-flag {
  font-size: 7px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 6px;
  border: 1px solid;
}
.vi-flag--damage { color: var(--nw-warning); border-color: var(--nw-warning); background: var(--nw-warning-dim); }
.vi-flag--mod { color: var(--nw-info); border-color: var(--nw-info); background: rgba(14,165,233,0.1); }

/* Comps */
.vi-comps {
  padding-top: var(--nw-space-3);
  border-top: 1px solid var(--nw-border);
}
.vi-comp {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 3px 0;
  border-bottom: 1px solid var(--nw-border);
}
.vi-comp:last-child { border-bottom: none; }
.vi-comp-label { font-size: 8px; color: var(--nw-text-secondary); }
.vi-comp-price {
  font-family: var(--nw-font-mono);
  font-size: 9px;
  font-weight: 600;
  color: var(--nw-text);
}
.vi-comp-meta { font-size: 7px; color: var(--nw-text-disabled); }

/* Section labels */
.vi-section {
  font-size: 7px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--nw-text-disabled);
  margin-bottom: var(--nw-space-1);
}

/* Reset */
.vi-reset {
  padding: var(--nw-space-3) var(--nw-space-4);
  border-top: 1px solid var(--nw-border);
}
.vi-reset-btn {
  width: 100%;
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
.vi-reset-btn:hover {
  border-color: var(--nw-accent);
  color: var(--nw-text);
}

input[type="file"] { display: none; }
`;

/**
 * <nuke-vision> — Vehicle intelligence from any photo.
 *
 * Not just identification — full market intelligence. Photo in → identification,
 * condition assessment, market value, comparable sales, demand signals out.
 * Powered by YONO (33M images, $0/inference, 4ms classify).
 *
 * @example
 * <nuke-vision api-key="nk_pub_..."></nuke-vision>
 * <nuke-vision api-key="nk_pub_..." image-url="https://..." mode="full"></nuke-vision>
 */
export class NukeVisionElement extends NukeWidgetBase {
  private fileInput: HTMLInputElement | null = null;
  private _lastResult: VisionAnalysisResult | null = null;
  private _lastComps: CompSale[] = [];
  private _lastMarket: Record<string, unknown> | null = null;

  static get observedAttributes(): string[] {
    return [...super.observedAttributes, 'mode', 'show-top5', 'image-url'];
  }

  protected widgetCSS(): string { return CSS; }

  protected async init(): Promise<void> {
    const imageUrl = this.getAttribute('image-url');
    if (imageUrl) {
      this.analyze(imageUrl, null);
    } else {
      this.renderDropzone();
    }
  }

  private renderDropzone(): void {
    this.container.innerHTML = `
      <div class="vi-card">
        <div class="vi-drop" role="button" tabindex="0" aria-label="Upload image for vehicle identification">
          <div class="vi-drop-icon">+</div>
          <div class="vi-drop-text">Identify a Vehicle</div>
          <div class="vi-drop-sub">Drop a photo — get full market intelligence</div>
        </div>
        <input type="file" accept="image/jpeg,image/png,image/webp" />
        ${this.poweredBy()}
      </div>
    `;

    const dz = this.container.querySelector('.vi-drop') as HTMLElement;
    this.fileInput = this.container.querySelector('input[type="file"]') as HTMLInputElement;

    dz?.addEventListener('click', () => this.fileInput?.click());
    dz?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') this.fileInput?.click(); });
    dz?.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('vi-drop--active'); });
    dz?.addEventListener('dragleave', () => dz.classList.remove('vi-drop--active'));
    dz?.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('vi-drop--active');
      const file = e.dataTransfer?.files[0];
      if (file) this.handleFile(file);
    });
    this.fileInput?.addEventListener('change', () => {
      const file = this.fileInput?.files?.[0];
      if (file) this.handleFile(file);
    });
  }

  private async handleFile(file: File): Promise<void> {
    this.emit('nuke-vision:upload-start', { fileName: file.name, size: file.size });
    const dataUrl = await this.readFileAsDataUrl(file);
    const base64 = dataUrl.split(',')[1] || dataUrl;
    this.analyze(null, base64, dataUrl);
  }

  private async analyze(imageUrl: string | null, base64: string | null, previewSrc?: string): Promise<void> {
    this.container.innerHTML = `
      <div class="vi-card">
        ${previewSrc || imageUrl ? `<img class="vi-preview" src="${this.escapeHtml(previewSrc || imageUrl!)}" alt="" />` : ''}
        <div class="vi-analyzing"><span class="vi-analyzing-text">Analyzing</span></div>
      </div>
    `;

    try {
      const mode = this.getAttribute('mode') === 'full' ? 'analyze' : 'classify';
      const body: Record<string, unknown> = { action: mode };
      if (imageUrl) body.image_url = imageUrl;
      if (base64) body.image = base64;

      // Step 1: YONO classification/analysis
      const result = await this.callFunction<VisionAnalysisResult>('api-v1-vision', body);

      // Step 2: If vehicle identified, get market intelligence
      let comps: CompSale[] = [];
      let marketData: Record<string, unknown> | null = null;

      if (result.make && result.is_vehicle !== false) {
        // Fetch comps — API returns { data: CompSale[], summary: { avg_price, median_price, min_price, max_price } }
        try {
          const compsRes = await this.callApi<{
            data: CompSale[];
            summary: { count: number; avg_price: number; median_price: number; min_price: number; max_price: number };
          }>('api-v1-comps', {
            method: 'POST',
            body: { make: result.make, limit: 5 },
          });
          comps = compsRes.data || [];
          // Build market data from comps summary
          if (compsRes.summary) {
            marketData = {
              estimated_value: compsRes.summary.median_price ?? compsRes.summary.avg_price,
              value_low: compsRes.summary.min_price,
              value_high: compsRes.summary.max_price,
              confidence_score: comps.length >= 5 ? 0.8 : comps.length >= 2 ? 0.5 : null,
            };
          }
        } catch { /* non-critical */ }
      }

      this.renderIntelligence(result, comps, marketData, previewSrc || imageUrl);
      this.emit('nuke-vision:result', { ...result, comps, market: marketData });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Analysis failed';
      this.showError(msg);
      this.emit('nuke-vision:error', { error: msg });
    }
  }

  private renderIntelligence(
    r: VisionAnalysisResult,
    comps: CompSale[],
    market: Record<string, unknown> | null,
    previewSrc: string | null,
  ): void {
    this._lastResult = r;
    this._lastComps = comps;
    this._lastMarket = market;
    const showTop5 = this.getAttribute('show-top5') !== 'false';
    const alts = showTop5 ? (r.top5 || []).slice(1, 5) : [];
    const prices = comps.map(c => c.sale_price).filter((p): p is number => p != null && p > 0);
    const priceLow = prices.length >= 2 ? Math.min(...prices) : null;
    const priceHigh = prices.length >= 2 ? Math.max(...prices) : null;
    const priceMid = priceLow != null && priceHigh != null ? Math.round((priceLow + priceHigh) / 2) : null;

    // Market intelligence from comps summary
    const estValue = (market?.estimated_value as number) ?? priceMid;
    const confidence = market?.confidence_score as number | undefined;

    const isVehicle = r.is_vehicle !== false;
    const hasFull = r.condition_score != null;
    const hasMarket = estValue != null || comps.length > 0;

    this.container.innerHTML = `
      <div class="vi-card">
        ${previewSrc ? `<img class="vi-preview" src="${this.escapeHtml(previewSrc)}" alt="" />` : ''}
        <div class="vi-intel">
          <!-- Identification -->
          <div class="vi-id nw-inf" data-inf="identification">
            <div class="vi-id-make">${this.escapeHtml(r.make || 'Unknown')}</div>
            ${isVehicle ? `
              <div class="vi-id-conf">
                <div class="vi-id-conf-bar"><div class="vi-id-conf-fill" style="width:${(r.confidence * 100).toFixed(0)}%"></div></div>
                <span class="vi-id-conf-pct">${(r.confidence * 100).toFixed(1)}%</span>
              </div>
            ` : '<div class="vi-id-not-vehicle">Not identified as a vehicle</div>'}
          </div>

          ${isVehicle && hasMarket ? `
            <!-- Market Intelligence Grid -->
            <div class="vi-section">Market Intelligence</div>
            <div class="vi-grid">
              ${estValue != null ? `
                <div class="vi-cell nw-inf" data-inf="est_value">
                  <div class="vi-cell-label">Est. Value</div>
                  <div class="vi-cell-value">${this.formatCurrency(estValue)}</div>
                  ${priceLow != null && priceHigh != null ? `<div class="vi-cell-context">${this.formatCurrency(priceLow)} – ${this.formatCurrency(priceHigh)}</div>` : ''}
                </div>
              ` : ''}
              <div class="vi-cell nw-inf" data-inf="comps_count">
                <div class="vi-cell-label">Data Points</div>
                <div class="vi-cell-value">${comps.length}</div>
                <div class="vi-cell-context">comparable sales</div>
              </div>
              ${r.elapsed_ms != null ? `
                <div class="vi-cell nw-inf" data-inf="inference_speed">
                  <div class="vi-cell-label">Inference</div>
                  <div class="vi-cell-value vi-cell-value--sm">${r.elapsed_ms}ms</div>
                  <div class="vi-cell-context">$0.00 cost</div>
                </div>
              ` : ''}
            </div>
          ` : ''}

          ${hasFull && r.condition_score != null ? `
            <!-- Condition -->
            <div class="vi-condition">
              <div class="vi-section">Condition Assessment</div>
              <div class="vi-grid">
                <div class="vi-cell nw-inf" data-inf="condition">
                  <div class="vi-cell-label">Score</div>
                  <div class="vi-cell-value">${r.condition_score}<span style="font-size:8px;color:var(--nw-text-disabled)">/100</span></div>
                </div>
                ${r.vehicle_zone ? `
                  <div class="vi-cell nw-inf" data-inf="zone">
                    <div class="vi-cell-label">Photo Zone</div>
                    <div class="vi-cell-value vi-cell-value--sm">${this.escapeHtml(r.vehicle_zone.replace(/_/g, ' '))}</div>
                    ${r.zone_confidence ? `<div class="vi-cell-context">${(r.zone_confidence * 100).toFixed(0)}% conf</div>` : ''}
                  </div>
                ` : ''}
              </div>
              ${this.renderFlags(r.damage_flags, r.modification_flags)}
            </div>
          ` : ''}

          ${alts.length > 0 ? `
            <div class="vi-alts">
              <div class="vi-section">Also Possible</div>
              ${alts.map((a, i) => `
                <div class="vi-alt nw-inf" data-inf="alt_${i}">
                  <span class="vi-alt-label">${this.escapeHtml(a.label)}</span>
                  <span class="vi-alt-pct">${(a.confidence * 100).toFixed(1)}%</span>
                </div>
              `).join('')}
            </div>
          ` : ''}

          ${comps.length > 0 ? `
            <div class="vi-comps">
              <div class="vi-section">Comparable Sales</div>
              ${comps.slice(0, 5).map((c, i) => `
                <div class="vi-comp nw-inf" data-inf="comp_${i}">
                  <div>
                    <div class="vi-comp-label">${this.escapeHtml([c.year, c.make, c.model].filter(Boolean).join(' '))}</div>
                    ${c.platform ? `<div class="vi-comp-meta">${this.escapeHtml(c.platform.replace(/_/g, ' '))}${c.sold_date ? ' · ' + new Date(c.sold_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : ''}</div>` : ''}
                  </div>
                  <span class="vi-comp-price">${this.formatCurrency(c.sale_price)}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>

        <div class="vi-reset">
          <button class="vi-reset-btn">Identify Another</button>
        </div>
        <input type="file" accept="image/jpeg,image/png,image/webp" />
        ${this.poweredBy()}
      </div>
    `;

    // Re-attach
    const btn = this.container.querySelector('.vi-reset-btn') as HTMLElement;
    this.fileInput = this.container.querySelector('input[type="file"]') as HTMLInputElement;
    btn?.addEventListener('click', () => this.renderDropzone());
    this.fileInput?.addEventListener('change', () => {
      const file = this.fileInput?.files?.[0];
      if (file) this.handleFile(file);
    });

    // Attach inference handlers
    const intel = this.container.querySelector('.vi-intel') as HTMLElement;
    if (intel) {
      this.attachInferenceHandlers(intel, intel, (key, el) => {
        const result = this.computeInference(key);
        if (result) this.showPopup(intel, el, result.title, result.lines, result.note);
      });
    }
  }

  private renderFlags(damage?: string[], mods?: string[]): string {
    const flags: string[] = [];
    if (damage?.length) flags.push(...damage.map(d => `<span class="vi-flag vi-flag--damage">${this.escapeHtml(d.replace(/_/g, ' '))}</span>`));
    if (mods?.length) flags.push(...mods.map(m => `<span class="vi-flag vi-flag--mod">${this.escapeHtml(m.replace(/_/g, ' '))}</span>`));
    if (!flags.length) return '';
    return `<div class="vi-flags">${flags.join('')}</div>`;
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // ─── Inference Engine ──────────────────────────────────────────

  private computeInference(key: string): { title: string; lines: PopupRow[]; note?: string } | null {
    const r = this._lastResult;
    const comps = this._lastComps;
    const market = this._lastMarket;
    if (!r) return null;

    const prices = comps.map(c => c.sale_price).filter((p): p is number => p != null && p > 0);
    const sorted = [...prices].sort((a, b) => a - b);

    if (key === 'identification') {
      const lines: PopupRow[] = [];
      lines.push({ label: 'Match', value: r.make || 'Unknown' });
      lines.push({ label: 'Confidence', value: `${(r.confidence * 100).toFixed(1)}%`, type: 'bar', pct: r.confidence * 100 });
      if (r.family) lines.push({ label: 'Family', value: r.family });
      if (r.family_confidence) lines.push({ label: 'Family conf.', value: `${(r.family_confidence * 100).toFixed(1)}%`, type: 'bar', pct: r.family_confidence * 100 });
      if (r.source) lines.push({ label: 'Model', value: r.source });
      if (r.ms != null) lines.push({ label: 'Classify time', value: `${r.ms}ms` });
      if (r.cost_usd != null) lines.push({ label: 'Cost', value: `$${r.cost_usd.toFixed(4)}` });
      const altCount = r.top5?.length || 0;
      if (altCount > 1) lines.push({ label: 'Alternatives', value: `${altCount - 1} other matches` });
      return { title: 'Vehicle Identification', lines, note: 'Powered by YONO — 33M images, local inference, $0/classify, 4ms average.' };
    }

    if (key === 'est_value') {
      const est = market?.estimated_value as number | undefined;
      const lines: PopupRow[] = [];
      if (est) lines.push({ label: 'Estimate', value: this.formatCurrency(est) });
      if (sorted.length >= 2) {
        lines.push({ label: 'Range', value: `${this.formatCurrency(sorted[0])} – ${this.formatCurrency(sorted[sorted.length - 1])}` });
        lines.push({ label: 'Median', value: this.formatCurrency(sorted[Math.floor(sorted.length / 2)]) });
        lines.push({ label: 'Spread', value: this.formatCurrency(sorted[sorted.length - 1] - sorted[0]) });
      }
      lines.push({ label: 'Based on', value: `${prices.length} comparable sales` });
      return { title: 'Market Value', lines, note: 'Value estimated from comparable sales. Condition, mileage, and provenance affect final value.' };
    }

    if (key === 'comps_count') {
      const lines: PopupRow[] = [{ label: 'Found', value: `${prices.length} sales` }];
      if (sorted.length >= 2) {
        lines.push({ label: 'Low', value: this.formatCurrency(sorted[0]) });
        lines.push({ label: 'High', value: this.formatCurrency(sorted[sorted.length - 1]) });
        const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
        lines.push({ label: 'Average', value: this.formatCurrency(avg) });
      }
      return { title: 'Comparable Sales', lines };
    }

    if (key === 'inference_speed') {
      const lines: PopupRow[] = [];
      if (r.elapsed_ms != null) lines.push({ label: 'Total', value: `${r.elapsed_ms}ms` });
      if (r.classify_ms != null) lines.push({ label: 'Classify', value: `${r.classify_ms}ms` });
      if (r.analyze_ms != null) lines.push({ label: 'Analyze', value: `${r.analyze_ms}ms` });
      if (r.cost_usd != null) lines.push({ label: 'Cost', value: `$${r.cost_usd.toFixed(4)}` });
      else lines.push({ label: 'Cost', value: '$0.00' });
      return { title: 'Inference Performance', lines, note: 'YONO runs locally — zero cloud API cost, sub-5ms classification.' };
    }

    if (key === 'condition') {
      const lines: PopupRow[] = [];
      if (r.condition_score != null) lines.push({ label: 'Score', value: `${r.condition_score}/100`, type: 'bar', pct: r.condition_score });
      if (r.interior_quality) lines.push({ label: 'Interior', value: r.interior_quality.replace(/_/g, ' ') });
      if (r.photo_quality) lines.push({ label: 'Photo quality', value: r.photo_quality.replace(/_/g, ' ') });
      if (r.photo_type) lines.push({ label: 'Photo type', value: r.photo_type.replace(/_/g, ' ') });
      return { title: 'Condition Assessment', lines, note: 'AI-assessed from photo. Professional inspection recommended for purchase decisions.' };
    }

    if (key === 'zone') {
      const lines: PopupRow[] = [];
      if (r.vehicle_zone) lines.push({ label: 'Zone', value: r.vehicle_zone.replace(/_/g, ' ') });
      if (r.zone_confidence) lines.push({ label: 'Confidence', value: `${(r.zone_confidence * 100).toFixed(0)}%`, type: 'bar', pct: r.zone_confidence * 100 });
      return { title: 'Photo Zone', lines, note: 'Identifies which part of the vehicle is shown — exterior, interior, engine bay, undercarriage, detail, etc.' };
    }

    if (key.startsWith('alt_')) {
      const idx = parseInt(key.slice(4));
      const alts = (r.top5 || []).slice(1);
      const alt = alts[idx];
      if (!alt) return null;
      const lines: PopupRow[] = [];
      lines.push({ label: 'Match', value: alt.label });
      lines.push({ label: 'Confidence', value: `${(alt.confidence * 100).toFixed(1)}%`, type: 'bar', pct: alt.confidence * 100 });
      const gap = r.confidence - alt.confidence;
      lines.push({ label: 'Gap from top', value: `${(gap * 100).toFixed(1)}%`, cls: gap > 0.3 ? 'good' : gap < 0.1 ? 'warm' : undefined });
      return { title: 'Alternative Match', lines, note: gap < 0.1 ? 'Very close to top match — visual similarity is high.' : 'Lower confidence than primary identification.' };
    }

    if (key.startsWith('comp_')) {
      const idx = parseInt(key.slice(5));
      const c = comps[idx];
      if (!c) return null;
      const lines: PopupRow[] = [];
      lines.push({ label: 'Vehicle', value: [c.year, c.make, c.model].filter(Boolean).join(' ') });
      if (c.sale_price) lines.push({ label: 'Price', value: this.formatCurrency(c.sale_price) });
      if (c.platform) lines.push({ label: 'Platform', value: c.platform.replace(/_/g, ' ') });
      if (c.sold_date) lines.push({ label: 'Sold', value: new Date(c.sold_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) });
      if (c.mileage) lines.push({ label: 'Mileage', value: `${this.formatNumber(c.mileage)} mi` });
      if (c.color) lines.push({ label: 'Color', value: c.color });
      if (c.location) lines.push({ label: 'Location', value: c.location });
      return { title: 'Comparable Sale', lines };
    }

    return null;
  }

  protected cleanup(): void {}

  protected onAttributeChanged(name: string): void {
    if (name === 'image-url') {
      const url = this.getAttribute('image-url');
      if (url) this.analyze(url, null);
    }
  }
}

if (!customElements.get('nuke-vision')) {
  customElements.define('nuke-vision', NukeVisionElement);
}
