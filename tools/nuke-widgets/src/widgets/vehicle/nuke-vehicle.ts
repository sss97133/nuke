import { NukeWidgetBase, type PopupRow } from '../../core/NukeWidgetBase';
import type { VehicleData, CompSale } from '../../core/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyData = Record<string, any>;

const CSS = `
.vc {
  background: var(--nw-surface);
  border: 2px solid var(--nw-border);
  overflow: hidden;
  transition: border-color var(--nw-transition);
}
.vc:hover { border-color: var(--nw-border-focus); }

/* Hero image */
.vc-img-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 16/10;
  background: var(--nw-bg);
  overflow: hidden;
}
.vc-img {
  width: 100%; height: 100%;
  object-fit: cover; display: block;
  opacity: 0; transition: opacity 300ms ease;
}
.vc-img--loaded { opacity: 1; }
.vc-img-skel {
  position: absolute; inset: 0;
  background: var(--nw-bg);
  animation: nw-pulse 1.5s ease-in-out infinite;
}
.vc-img-count {
  position: absolute; bottom: 6px; right: 8px;
  font-family: var(--nw-font-mono);
  font-size: 8px; font-weight: 700;
  background: rgba(0,0,0,0.7); color: #fff;
  padding: 2px 6px; letter-spacing: 0.04em;
}
.vc-no-img {
  width: 100%; aspect-ratio: 16/10;
  display: flex; align-items: center; justify-content: center;
  background: var(--nw-bg); color: var(--nw-text-disabled);
  font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em;
}

/* Body */
.vc-body { padding: var(--nw-space-4); }
.vc-title {
  font-size: 13px; font-weight: 700;
  color: var(--nw-text); margin: 0 0 var(--nw-space-1) 0; line-height: 1.3;
}
.vc-vin {
  font-family: var(--nw-font-mono);
  font-size: 9px; color: var(--nw-text-disabled);
  letter-spacing: 0.02em; margin-bottom: var(--nw-space-3);
}

/* Section labels */
.vc-section {
  font-size: 7px; text-transform: uppercase;
  letter-spacing: 0.1em; color: var(--nw-text-disabled);
  margin-bottom: var(--nw-space-1); margin-top: var(--nw-space-3);
  padding-top: var(--nw-space-3); border-top: 1px solid var(--nw-border);
}
.vc-section:first-child { margin-top: 0; padding-top: 0; border-top: none; }

/* Data grid */
.vc-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
}
.vc-cell {
  padding: var(--nw-space-2) 0;
  border-bottom: 1px solid var(--nw-border);
}
.vc-cell:nth-child(odd) {
  padding-right: var(--nw-space-3);
  border-right: 1px solid var(--nw-border);
}
.vc-cell:nth-child(even) { padding-left: var(--nw-space-3); }
.vc-cell--full {
  grid-column: 1 / -1;
  padding-right: 0; border-right: none;
}
.vc-lbl {
  font-size: 7px; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--nw-text-disabled); font-weight: 600;
}
.vc-val {
  font-family: var(--nw-font-mono);
  font-size: 11px; font-weight: 700;
  color: var(--nw-text); margin-top: 1px;
}
.vc-val--lg { font-size: 16px; letter-spacing: -0.02em; }
.vc-val--sm { font-size: 9px; font-weight: 600; }
.vc-ctx {
  font-size: 7px; color: var(--nw-text-disabled); margin-top: 1px;
}

/* Signal weights bar */
.vc-signals { margin-top: var(--nw-space-2); }
.vc-sig-row {
  display: flex; align-items: center; gap: 4px;
  margin-bottom: 2px;
}
.vc-sig-label {
  font-size: 7px; width: 60px;
  text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--nw-text-disabled); text-align: right;
}
.vc-sig-bar {
  flex: 1; height: 3px;
  background: var(--nw-bg); border: 1px solid var(--nw-border);
  overflow: hidden;
}
.vc-sig-fill { height: 100%; background: var(--nw-accent); }
.vc-sig-count {
  font-family: var(--nw-font-mono);
  font-size: 7px; color: var(--nw-text-disabled);
  width: 24px; text-align: right;
}

/* Condition per-system */
.vc-cond-row {
  display: flex; justify-content: space-between;
  align-items: baseline; padding: 2px 0;
  border-bottom: 1px solid var(--nw-border);
}
.vc-cond-row:last-child { border-bottom: none; }
.vc-cond-sys { font-size: 8px; color: var(--nw-text-secondary); }
.vc-cond-val { font-size: 8px; color: var(--nw-text); font-weight: 600; }

/* Build phases */
.vc-phase {
  display: flex; align-items: baseline; gap: var(--nw-space-2);
  padding: 2px 0; border-bottom: 1px solid var(--nw-border);
}
.vc-phase:last-child { border-bottom: none; }
.vc-phase-num {
  font-family: var(--nw-font-mono);
  font-size: 7px; color: var(--nw-text-disabled);
  width: 14px; text-align: right; flex-shrink: 0;
}
.vc-phase-name {
  font-size: 8px; font-weight: 700;
  color: var(--nw-text); text-transform: uppercase;
  letter-spacing: 0.04em;
}
.vc-phase-desc {
  font-size: 8px; color: var(--nw-text-secondary);
  flex: 1; text-align: right;
}

/* Mods list */
.vc-mods {
  display: flex; flex-wrap: wrap; gap: 4px; margin-top: var(--nw-space-1);
}
.vc-mod {
  font-size: 7px; text-transform: uppercase; letter-spacing: 0.04em;
  padding: 2px 6px; border: 1px solid var(--nw-border);
  color: var(--nw-text-secondary);
}

/* Community */
.vc-quote {
  font-size: 8px; font-style: italic;
  color: var(--nw-text-secondary); line-height: 1.5;
  padding: var(--nw-space-2) 0;
  border-bottom: 1px solid var(--nw-border);
}
.vc-quote:last-child { border-bottom: none; }
.vc-concern {
  font-size: 8px; color: var(--nw-warning);
  padding: 2px 0;
}
.vc-expert {
  font-size: 8px; color: var(--nw-text-secondary);
  padding: 2px 0; line-height: 1.5;
  border-bottom: 1px solid var(--nw-border);
}
.vc-expert:last-child { border-bottom: none; }

/* Comps */
.vc-comp {
  display: flex; gap: var(--nw-space-2);
  padding: 4px 0; border-bottom: 1px solid var(--nw-border);
  align-items: center;
}
.vc-comp:last-child { border-bottom: none; }
.vc-comp-img {
  width: 48px; height: 32px; object-fit: cover;
  background: var(--nw-bg); flex-shrink: 0;
}
.vc-comp-info { flex: 1; min-width: 0; }
.vc-comp-title { font-size: 8px; color: var(--nw-text); font-weight: 600; }
.vc-comp-meta { font-size: 7px; color: var(--nw-text-disabled); }
.vc-comp-price {
  font-family: var(--nw-font-mono);
  font-size: 10px; font-weight: 700;
  color: var(--nw-text); flex-shrink: 0;
}

/* Signals */
.vc-hot { color: var(--nw-error); }
.vc-warm { color: var(--nw-warning); }
.vc-cool { color: var(--nw-text-secondary); }
.vc-good { color: var(--nw-success); }

/* Data depth bar */
.vc-depth {
  display: flex; gap: var(--nw-space-2);
  margin-top: var(--nw-space-3);
  padding-top: var(--nw-space-3);
  border-top: 1px solid var(--nw-border);
}
.vc-depth-item {
  flex: 1; text-align: center;
}
.vc-depth-item + .vc-depth-item { border-left: 1px solid var(--nw-border); }
.vc-depth-num {
  font-family: var(--nw-font-mono);
  font-size: 14px; font-weight: 700; color: var(--nw-text);
}
.vc-depth-lbl {
  font-size: 7px; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--nw-text-disabled);
}
`;

/**
 * <nuke-vehicle> — Full vehicle intelligence dossier.
 *
 * One VIN → everything Nuke knows: valuation with signal weights,
 * condition assessment, build records, community intelligence,
 * expert insights, comparable sales with images, data depth metrics.
 *
 * @example
 * <nuke-vehicle api-key="nk_pub_..." vin="1GCEK14L9EJ147915"></nuke-vehicle>
 */
export class NukeVehicleElement extends NukeWidgetBase {
  private data: AnyData | null = null;
  private comps: CompSale[] = [];

  static get observedAttributes(): string[] {
    return [...super.observedAttributes, 'vehicle-id', 'vin', 'compact'];
  }

  protected widgetCSS(): string { return CSS; }

  protected async init(): Promise<void> {
    const vin = this.getAttribute('vin');
    const vehicleId = this.getAttribute('vehicle-id');

    if (vin) {
      await this.loadByVin(vin);
    } else if (vehicleId) {
      await this.loadByVehicleId(vehicleId);
    } else {
      this.showError('Missing vin or vehicle-id attribute');
    }
  }

  private async loadByVin(vin: string): Promise<void> {
    const raw = await this.callApi<{ data: AnyData | null }>('api-v1-vin-lookup', {
      method: 'GET',
      path: vin.toUpperCase(),
    });

    if (!raw.data) { this.showError('Vehicle not found'); return; }
    this.data = raw.data;

    try {
      const r = await this.callApi<{ data: CompSale[]; summary: AnyData }>('api-v1-comps', {
        method: 'POST',
        body: { year: this.data.year, make: this.data.make, model: this.data.model, limit: 10 },
      });
      this.comps = r.data || [];
    } catch { /* non-critical */ }

    this.render();
    this.emit('nuke-vehicle:loaded', { data: this.data, comps: this.comps });
  }

  private async loadByVehicleId(vehicleId: string): Promise<void> {
    const response = await this.callApi<{ data: VehicleData }>('api-v1-vehicles', {
      method: 'GET',
      path: vehicleId,
    });

    const vehicle = response.data;
    if (!vehicle) { this.showError('Vehicle not found'); return; }

    // Try VIN lookup for full intelligence, fall back to basic
    if (vehicle.vin) {
      try {
        const raw = await this.callApi<{ data: AnyData | null }>('api-v1-vin-lookup', {
          method: 'GET', path: vehicle.vin,
        });
        if (raw.data) { this.data = raw.data; }
      } catch { /* fall through */ }
    }

    if (!this.data) {
      this.data = vehicle as unknown as AnyData;
    }

    try {
      const r = await this.callApi<{ data: CompSale[] }>('api-v1-comps', {
        method: 'POST',
        body: { year: vehicle.year, make: vehicle.make, model: vehicle.model, limit: 10 },
      });
      this.comps = r.data || [];
    } catch { /* non-critical */ }

    this.render();
    this.emit('nuke-vehicle:loaded', { data: this.data, comps: this.comps });
  }

  private render(): void {
    const d = this.data;
    if (!d) return;

    const showTrim = d.trim && !(d.model || '').toLowerCase().includes((d.trim || '').toLowerCase());
    const title = [d.year, d.make, d.model, showTrim ? d.trim : null].filter(Boolean).join(' ');
    const val: AnyData | null = d.valuation;
    const intel: AnyData | null = d.intelligence;
    const obs: AnyData = intel?.observations || {};
    const community: AnyData | null = intel?.community;
    const counts: AnyData = d.counts || {};
    const condition: AnyData | null = obs.condition?.structured_data;
    const workRecord: AnyData | null = obs.work_record?.structured_data;
    const spec: AnyData | null = obs.specification?.structured_data;
    const provenance: AnyData | null = obs.provenance?.structured_data;

    // Valuation
    const compPrices = this.comps.map(c => c.sale_price).filter((p): p is number => p != null && p > 0);
    const estValue = val?.estimated_value ?? (compPrices.length >= 2 ? Math.round(compPrices.reduce((a, b) => a + b, 0) / compPrices.length) : null);
    const low = val?.value_low ?? (compPrices.length >= 2 ? Math.min(...compPrices) : null);
    const high = val?.value_high ?? (compPrices.length >= 2 ? Math.max(...compPrices) : null);

    const sections: string[] = [];

    // 1. Specs grid
    const specs = [
      this.cell('Mileage', d.mileage ? `${this.formatNumber(d.mileage)} mi` : null, null, false, false, 'mileage'),
      this.cell('Engine', d.engine_type || spec?.engine, null, false, false, 'engine'),
      this.cell('Trans', d.transmission, null, false, false, 'transmission'),
      this.cell('Drive', d.drivetrain, null, false, false, 'drivetrain'),
      this.cell('Color', d.color, null, false, false, 'color'),
      this.cell('Body', d.body_style, null, false, false, 'body'),
    ].filter(Boolean).join('');
    if (specs) sections.push(`<div class="vc-grid">${specs}</div>`);

    // 2. Valuation + Signal Weights
    if (estValue != null || val) {
      let valHtml = '<div class="vc-section">Valuation</div><div class="vc-grid">';
      valHtml += this.cell('Est. Value', estValue != null ? this.formatCurrency(estValue) : null,
        low != null && high != null ? `${this.formatCurrency(low)} – ${this.formatCurrency(high)}` : null, true, false, 'est_value');
      if (val?.confidence_score != null) {
        valHtml += this.cell('Confidence', `${Math.round(val.confidence_score)}%`,
          val.confidence_interval_pct ? `±${val.confidence_interval_pct}%` : null, false, false, 'confidence');
      }
      if (val?.heat_score_label) {
        const cls = val.heat_score_label === 'hot' || val.heat_score_label === 'very_hot' ? 'hot' :
                    val.heat_score_label === 'warm' ? 'warm' : 'cool';
        valHtml += this.cell('Heat', `<span class="vc-${cls}">${this.escapeHtml(val.heat_score_label.replace(/_/g, ' '))}</span>`, null, false, false, 'heat');
      }
      if (val?.deal_score_label) {
        const dealLabel = val.deal_score_label.includes('minus') ? 'Above Market' :
                          val.deal_score_label.includes('plus') || val.deal_score_label.includes('great') ? 'Below Market' : 'Fair';
        const cls = dealLabel === 'Below Market' ? 'good' : dealLabel === 'Fair' ? 'warm' : 'cool';
        valHtml += this.cell('Deal', `<span class="vc-${cls}">${dealLabel}</span>`, null, false, false, 'deal');
      }
      if (val?.price_tier) {
        valHtml += this.cell('Tier', val.price_tier.replace(/_/g, ' '), null, false, false, 'tier');
      }
      valHtml += '</div>';

      // Signal weights breakdown
      if (val?.signal_weights) {
        valHtml += '<div class="vc-signals">';
        const sw = val.signal_weights as AnyData;
        const maxWeight = Math.max(...Object.values(sw).map((s: AnyData) => s.weight || 0));
        for (const [key, sig] of Object.entries(sw) as [string, AnyData][]) {
          const pct = maxWeight > 0 ? ((sig.weight / maxWeight) * 100).toFixed(0) : '0';
          valHtml += `<div class="vc-sig-row nw-inf" data-inf="sig_${key}">
            <span class="vc-sig-label">${this.escapeHtml(key)}</span>
            <div class="vc-sig-bar"><div class="vc-sig-fill" style="width:${pct}%"></div></div>
            <span class="vc-sig-count">${sig.sourceCount || 0}</span>
          </div>`;
        }
        valHtml += '</div>';
      }
      sections.push(valHtml);
    }

    // 3. Condition Assessment
    if (condition) {
      let condHtml = '<div class="vc-section">Condition</div>';
      if (condition.condition_rating != null) {
        condHtml += `<div class="vc-grid">`;
        condHtml += this.cell('Rating', `${condition.condition_rating}/${condition.condition_scale || 10}`, condition.overall_condition, true, false, 'condition_rating');
        condHtml += '</div>';
      }
      const systems = ['body', 'frame', 'paint', 'engine', 'interior', 'electrical'].filter(
        s => condition[`${s}_condition`]
      );
      if (systems.length > 0) {
        condHtml += systems.map(s =>
          `<div class="vc-cond-row nw-inf" data-inf="cond_${s}">
            <span class="vc-cond-sys">${s}</span>
            <span class="vc-cond-val">${this.escapeHtml(condition[`${s}_condition`])}</span>
          </div>`
        ).join('');
      }
      sections.push(condHtml);
    }

    // 4. Build Record
    if (workRecord) {
      let buildHtml = '<div class="vc-section">Build Record</div><div class="vc-grid">';
      if (workRecord.total_investment) {
        buildHtml += this.cell('Investment', this.formatCurrency(workRecord.total_investment), null, true, false, 'investment');
      }
      if (workRecord.labor_hours) {
        buildHtml += this.cell('Labor', `${this.formatNumber(workRecord.labor_hours)} hrs`, null, false, false, 'labor');
      }
      if (workRecord.parts_cost_estimate && workRecord.labor_cost_estimate) {
        buildHtml += this.cell('Parts', this.formatCurrency(workRecord.parts_cost_estimate), null, false, false, 'parts_cost');
        buildHtml += this.cell('Labor $', this.formatCurrency(workRecord.labor_cost_estimate), null, false, false, 'labor_cost');
      }
      buildHtml += '</div>';

      if (workRecord.phases?.length) {
        buildHtml += workRecord.phases.slice(0, 8).map((p: AnyData, i: number) =>
          `<div class="vc-phase">
            <span class="vc-phase-num">${String(i + 1).padStart(2, '0')}</span>
            <span class="vc-phase-name">${this.escapeHtml(p.name)}</span>
            <span class="vc-phase-desc">${this.escapeHtml(p.description)}</span>
          </div>`
        ).join('');
      }
      sections.push(buildHtml);
    }

    // 5. Modifications
    if (spec?.modifications?.length) {
      let modsHtml = '<div class="vc-section">Modifications</div><div class="vc-mods">';
      modsHtml += spec.modifications.map((m: string) =>
        `<span class="vc-mod nw-inf" data-inf="mod_${m}">${this.escapeHtml(m)}</span>`
      ).join('');
      modsHtml += '</div>';
      sections.push(modsHtml);
    }

    // 6. Provenance
    if (provenance) {
      let provHtml = '<div class="vc-section">Provenance</div><div class="vc-grid">';
      if (provenance.title_status) provHtml += this.cell('Title', provenance.title_status, null, false, false, 'title_status');
      if (provenance.documentation_level) provHtml += this.cell('Docs', provenance.documentation_level, null, false, true, 'docs');
      if (provenance.ownership_duration) provHtml += this.cell('Ownership', provenance.ownership_duration, null, false, false, 'ownership');
      provHtml += '</div>';
      sections.push(provHtml);
    }

    // 7. Community Intelligence
    if (community) {
      let commHtml = '<div class="vc-section">Community Intelligence</div><div class="vc-grid">';
      if (community.sentiment) {
        const sCls = community.sentiment === 'positive' ? 'good' : community.sentiment === 'negative' ? 'hot' : 'warm';
        commHtml += this.cell('Sentiment', `<span class="vc-${sCls}">${community.sentiment}</span>`,
          community.sentiment_score ? `${(community.sentiment_score * 100).toFixed(0)}% score` : null, false, false, 'sentiment');
      }
      if (community.comment_count) {
        commHtml += this.cell('Comments', `${community.comment_count}`, null, false, false, 'comments');
      }
      if (community.data_quality != null) {
        commHtml += this.cell('Data Quality', `${(community.data_quality * 100).toFixed(0)}%`, null, false, false, 'data_quality');
      }
      commHtml += '</div>';

      const insights = community.insights;
      if (insights) {
        // Expert insights
        if (insights.expert_insights?.length) {
          commHtml += '<div class="vc-section">Expert Insights</div>';
          commHtml += insights.expert_insights.slice(0, 4).map((e: string) =>
            `<div class="vc-expert">${this.escapeHtml(e)}</div>`
          ).join('');
        }

        // Authenticity
        if (insights.authenticity_discussion?.key_concerns?.length) {
          commHtml += '<div class="vc-section">Authenticity Concerns</div>';
          commHtml += insights.authenticity_discussion.key_concerns.map((c: string) =>
            `<div class="vc-concern">${this.escapeHtml(c)}</div>`
          ).join('');
          if (insights.authenticity_discussion.community_confidence) {
            commHtml += `<div class="vc-ctx" style="margin-top:4px">Community confidence: ${this.escapeHtml(insights.authenticity_discussion.community_confidence)}</div>`;
          }
        }

        // Key quotes
        if (insights.key_quotes?.length) {
          commHtml += '<div class="vc-section">Notable Quotes</div>';
          commHtml += insights.key_quotes.slice(0, 2).map((q: string) =>
            `<div class="vc-quote">${this.escapeHtml(q.replace(/^"|"$/g, ''))}</div>`
          ).join('');
        }
      }
      sections.push(commHtml);
    }

    // 8. Comparable Sales (with images)
    if (this.comps.length > 0) {
      let compsHtml = '<div class="vc-section">Comparable Sales</div>';
      compsHtml += this.comps.slice(0, 6).map((c, i) => {
        const cTitle = [c.year, c.make, c.model].filter(Boolean).join(' ');
        const meta = [c.color, c.location, c.mileage ? `${this.formatNumber(c.mileage)} mi` : null].filter(Boolean).join(' · ');
        return `<div class="vc-comp nw-inf" data-inf="comp_${i}">
          ${c.image_url ? `<img class="vc-comp-img" src="${this.escapeHtml(c.image_url)}" alt="" loading="lazy" />` : ''}
          <div class="vc-comp-info">
            <div class="vc-comp-title">${this.escapeHtml(cTitle)}</div>
            ${meta ? `<div class="vc-comp-meta">${this.escapeHtml(meta)}</div>` : ''}
          </div>
          <span class="vc-comp-price">${this.formatCurrency(c.sale_price)}</span>
        </div>`;
      }).join('');
      sections.push(compsHtml);
    }

    // Data depth bar
    const depthItems = [
      counts.images > 0 ? { num: counts.images, label: 'Photos' } : null,
      counts.observations > 0 ? { num: counts.observations, label: 'Observations' } : null,
      counts.comments > 0 ? { num: counts.comments, label: 'Comments' } : null,
      this.comps.length > 0 ? { num: this.comps.length, label: 'Comps' } : null,
    ].filter(Boolean) as Array<{ num: number; label: string }>;

    this.container.innerHTML = `
      <div class="vc" role="article" aria-label="${this.escapeHtml(title)}">
        ${d.primary_image_url
          ? `<div class="vc-img-wrap">
              <div class="vc-img-skel"></div>
              <img class="vc-img" src="${this.escapeHtml(d.primary_image_url)}" alt="${this.escapeHtml(title)}" loading="lazy" />
              ${counts.images > 1 ? `<span class="vc-img-count">${counts.images} photos</span>` : ''}
            </div>`
          : `<div class="vc-no-img">No Image</div>`
        }
        <div class="vc-body">
          <h3 class="vc-title">${this.escapeHtml(title || 'Unknown Vehicle')}</h3>
          ${d.vin ? `<div class="vc-vin">VIN ${this.escapeHtml(d.vin)}</div>` : ''}
          ${sections.join('')}
          ${depthItems.length > 0 ? `
            <div class="vc-depth">
              ${depthItems.map(di => `
                <div class="vc-depth-item">
                  <div class="vc-depth-num">${this.formatNumber(di.num)}</div>
                  <div class="vc-depth-lbl">${di.label}</div>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
        ${this.poweredBy()}
      </div>
    `;

    // Fade in image
    const img = this.container.querySelector('.vc-img') as HTMLImageElement;
    if (img) {
      const onLoad = () => {
        img.classList.add('vc-img--loaded');
        this.container.querySelector('.vc-img-skel')?.remove();
      };
      if (img.complete) onLoad();
      else img.addEventListener('load', onLoad);
    }

    // Attach inference handlers
    const body = this.container.querySelector('.vc-body') as HTMLElement;
    if (body) {
      this.attachInferenceHandlers(body, body, (key, el) => {
        const result = this.computeInference(key);
        if (result) this.showPopup(body, el, result.title, result.lines, result.note);
      });
    }

    this.container.querySelector('.vc')?.addEventListener('click', () =>
      this.emit('nuke-vehicle:click', { data: this.data })
    );
  }

  private cell(label: string, value: string | null | undefined, context?: string | null, large?: boolean, small?: boolean, infKey?: string): string {
    if (!value) return '';
    const inf = infKey ? ` nw-inf" data-inf="${infKey}` : '';
    return `<div class="vc-cell${inf}">
      <div class="vc-lbl">${label}</div>
      <div class="vc-val${large ? ' vc-val--lg' : ''}${small ? ' vc-val--sm' : ''}">${value}</div>
      ${context ? `<div class="vc-ctx">${context}</div>` : ''}
    </div>`;
  }

  // ─── Inference Engine ──────────────────────────────────────────

  private computeInference(key: string): { title: string; lines: PopupRow[]; note?: string } | null {
    const d = this.data;
    if (!d) return null;
    const comps = this.comps;
    const val: AnyData | null = d.valuation;
    const intel: AnyData | null = d.intelligence;
    const obs: AnyData = intel?.observations || {};

    // Comp price helpers
    const compPrices = comps.map(c => c.sale_price).filter((p): p is number => p != null && p > 0);
    const avgCompPrice = compPrices.length > 0 ? Math.round(compPrices.reduce((a, b) => a + b, 0) / compPrices.length) : null;

    // ── Specs fields ────────────────────────────────────────────

    if (key === 'mileage') {
      const mi = d.mileage;
      if (mi == null) return null;
      const compMi = comps.map(c => c.mileage).filter((m): m is number => m != null);
      const lines: PopupRow[] = [];
      if (compMi.length > 0) {
        const avg = Math.round(compMi.reduce((a, b) => a + b, 0) / compMi.length);
        const below = compMi.filter(m => m > mi).length;
        const pctl = Math.round((below / compMi.length) * 100);
        lines.push({ label: 'Percentile', value: `${pctl}th`, type: 'bar', pct: pctl, cls: pctl > 70 ? 'good' : pctl < 30 ? 'warm' : undefined });
        lines.push({ label: 'Comp average', value: `${this.formatNumber(avg)} mi` });
        const diff = mi - avg;
        lines.push({ label: 'vs average', value: `${diff < 0 ? '' : '+'}${this.formatNumber(diff)} mi`, cls: diff < 0 ? 'good' : 'warm' });
        // Price correlation
        const lowMi = comps.filter(c => (c.mileage ?? Infinity) <= mi && c.sale_price);
        const highMi = comps.filter(c => (c.mileage ?? 0) > mi && c.sale_price);
        if (lowMi.length > 0 && highMi.length > 0) {
          const avgLow = Math.round(lowMi.reduce((a, c) => a + (c.sale_price || 0), 0) / lowMi.length);
          const avgHigh = Math.round(highMi.reduce((a, c) => a + (c.sale_price || 0), 0) / highMi.length);
          if (avgLow !== avgHigh) {
            lines.push({ label: 'Low-mi premium', value: this.formatCurrency(avgLow - avgHigh), cls: avgLow > avgHigh ? 'good' : 'warm' });
          }
        }
      }
      lines.push({ label: 'Sample size', value: `${compMi.length} comps w/ mileage` });
      return { title: 'Mileage Analysis', lines, note: compMi.length < 3 ? 'Limited comp data — inference confidence is low.' : 'Lower mileage typically commands a premium in the collector market.' };
    }

    if (key === 'engine') {
      const engine = d.engine_type || obs.specification?.structured_data?.engine;
      const lines: PopupRow[] = [];
      if (engine) lines.push({ label: 'Configuration', value: engine });
      if (d.engine_displacement) lines.push({ label: 'Displacement', value: d.engine_displacement });
      lines.push({ label: 'Market comps', value: `${comps.length} for ${d.year} ${d.make} ${d.model}` });
      if (compPrices.length >= 2) {
        lines.push({ label: 'Price range', value: `${this.formatCurrency(Math.min(...compPrices))} – ${this.formatCurrency(Math.max(...compPrices))}` });
      }
      if (avgCompPrice) lines.push({ label: 'Avg comp price', value: this.formatCurrency(avgCompPrice) });
      return { title: 'Engine Intelligence', lines, note: 'Matching-numbers original engines command the highest premiums. Engine swaps and rebuilds affect value differently by era and marque.' };
    }

    if (key === 'transmission') {
      const trans = d.transmission;
      if (!trans) return null;
      const lines: PopupRow[] = [];
      lines.push({ label: 'Type', value: trans });
      const isManual = /manual|speed|stick/i.test(trans);
      if (isManual) lines.push({ label: 'Signal', value: 'Manual Premium', cls: 'good' });
      if (compPrices.length >= 2) {
        lines.push({ label: 'Comp range', value: `${this.formatCurrency(Math.min(...compPrices))} – ${this.formatCurrency(Math.max(...compPrices))}` });
      }
      return { title: 'Transmission Analysis', lines, note: isManual ? 'Manual transmissions command 10-30% premium in the collector market.' : 'Automatic models are more common, generally valued lower for collectors.' };
    }

    if (key === 'color') {
      const color = d.color;
      if (!color) return null;
      const lines: PopupRow[] = [];
      const compColors = comps.map(c => c.color).filter(Boolean) as string[];
      const same = compColors.filter(c => c.toLowerCase() === color.toLowerCase()).length;
      lines.push({ label: 'Color', value: color });
      if (compColors.length > 0) {
        const rarity = Math.round((1 - same / compColors.length) * 100);
        lines.push({ label: 'Among comps', value: `${same} of ${compColors.length}` });
        lines.push({ label: 'Rarity', value: `${rarity}%`, type: 'bar', pct: rarity, cls: rarity > 70 ? 'good' : undefined });
        // Color price premium
        const sameComps = comps.filter(c => c.color?.toLowerCase() === color.toLowerCase() && c.sale_price);
        const otherComps = comps.filter(c => c.color?.toLowerCase() !== color.toLowerCase() && c.sale_price);
        if (sameComps.length > 0 && otherComps.length > 0) {
          const avgS = Math.round(sameComps.reduce((a, c) => a + (c.sale_price || 0), 0) / sameComps.length);
          const avgO = Math.round(otherComps.reduce((a, c) => a + (c.sale_price || 0), 0) / otherComps.length);
          lines.push({ label: 'Color premium', value: `${avgS >= avgO ? '+' : ''}${this.formatCurrency(avgS - avgO)}`, cls: avgS > avgO ? 'good' : avgS < avgO ? 'warm' : undefined });
        }
      }
      return { title: 'Color Analysis', lines, note: 'Original factory colors, especially rare production colors, significantly impact collector value.' };
    }

    if (key === 'drivetrain') {
      const dt = d.drivetrain;
      if (!dt) return null;
      const is4x4 = /4wd|4x4|awd/i.test(dt);
      const lines: PopupRow[] = [{ label: 'Drivetrain', value: dt }];
      if (is4x4) lines.push({ label: 'Signal', value: '4x4 Premium', cls: 'good' });
      if (compPrices.length >= 2) {
        lines.push({ label: 'Comp range', value: `${this.formatCurrency(Math.min(...compPrices))} – ${this.formatCurrency(Math.max(...compPrices))}` });
      }
      return { title: 'Drivetrain Analysis', lines, note: is4x4 ? '4WD models command significant premiums, especially trucks and SUVs.' : undefined };
    }

    if (key === 'body') {
      return { title: 'Body Style', lines: [{ label: 'Style', value: d.body_style || '—' }, { label: 'Comps', value: `${comps.length}` }] };
    }

    // ── Valuation fields ────────────────────────────────────────

    if (key === 'est_value') {
      if (!val?.estimated_value) return null;
      const lines: PopupRow[] = [];
      const sorted = [...compPrices].sort((a, b) => a - b);
      if (sorted.length > 0) {
        const median = sorted[Math.floor(sorted.length / 2)];
        const below = sorted.filter(p => p < val.estimated_value).length;
        const pctl = Math.round((below / sorted.length) * 100);
        lines.push({ label: 'Comp median', value: this.formatCurrency(median) });
        lines.push({ label: 'Percentile', value: `${pctl}th of ${sorted.length}`, type: 'bar', pct: pctl });
        lines.push({ label: 'Spread', value: this.formatCurrency(sorted[sorted.length - 1] - sorted[0]) });
      }
      if (val.confidence_interval_pct) lines.push({ label: 'Confidence ±', value: `${val.confidence_interval_pct}%` });
      if (val.signal_weights) {
        const sw = val.signal_weights as AnyData;
        const top = Object.entries(sw).sort((a, b) => ((b[1] as AnyData).weight || 0) - ((a[1] as AnyData).weight || 0))[0];
        if (top) lines.push({ label: 'Top signal', value: `${top[0]} (${(top[1] as AnyData).sourceCount || 0} sources)` });
      }
      return { title: 'Valuation Breakdown', lines, note: `Based on ${val.input_count || compPrices.length} inputs across ${Object.keys(val.signal_weights || {}).length} signal categories.` };
    }

    if (key === 'confidence') {
      if (val?.confidence_score == null) return null;
      const lines: PopupRow[] = [];
      lines.push({ label: 'Score', value: `${Math.round(val.confidence_score)}%`, type: 'bar', pct: val.confidence_score });
      if (val.signal_weights) {
        const sw = val.signal_weights as AnyData;
        const sorted = Object.entries(sw).sort((a, b) => ((b[1] as AnyData).weight || 0) - ((a[1] as AnyData).weight || 0));
        const topW = (sorted[0]?.[1] as AnyData)?.weight || 1;
        for (const [k, s] of sorted.slice(0, 5) as [string, AnyData][]) {
          lines.push({ label: k, value: `${s.sourceCount || 0} src`, type: 'bar', pct: Math.round(((s.weight || 0) / topW) * 100) });
        }
      }
      const missing: string[] = [];
      const sw = (val.signal_weights || {}) as AnyData;
      for (const s of ['comps', 'condition', 'sentiment', 'provenance']) {
        if (!sw[s]?.sourceCount) missing.push(s);
      }
      return { title: 'Confidence Analysis', lines, note: missing.length > 0 ? `Missing signals: ${missing.join(', ')}. Adding these would increase confidence.` : 'All major signals present.' };
    }

    if (key === 'heat') {
      const lines: PopupRow[] = [];
      lines.push({ label: 'Heat', value: (val?.heat_score_label || '—').replace(/_/g, ' ') });
      // Price trend from dated comps
      const dated = comps.filter(c => c.sold_date && c.sale_price).sort((a, b) => new Date(b.sold_date!).getTime() - new Date(a.sold_date!).getTime());
      if (dated.length >= 4) {
        const half = Math.ceil(dated.length / 2);
        const recent = dated.slice(0, half);
        const older = dated.slice(half);
        const avgR = recent.reduce((a, c) => a + (c.sale_price || 0), 0) / recent.length;
        const avgO = older.reduce((a, c) => a + (c.sale_price || 0), 0) / older.length;
        const trend = ((avgR - avgO) / avgO * 100).toFixed(1);
        lines.push({ label: 'Price trend', value: `${Number(trend) >= 0 ? '+' : ''}${trend}%`, cls: Number(trend) > 0 ? 'good' : Number(trend) < -5 ? 'warm' : undefined });
      }
      lines.push({ label: 'Recent sales', value: `${comps.length} comps` });
      return { title: 'Market Heat', lines, note: 'Heat reflects recent market activity and price trends.' };
    }

    if (key === 'deal') {
      if (!val?.deal_score_label) return null;
      const lines: PopupRow[] = [];
      lines.push({ label: 'Score', value: val.deal_score_label.replace(/_/g, ' ') });
      if (val.deal_score != null) lines.push({ label: 'Raw', value: `${val.deal_score.toFixed(1)}` });
      if (val.estimated_value && avgCompPrice) {
        const diff = val.estimated_value - avgCompPrice;
        lines.push({ label: 'vs comp avg', value: `${diff >= 0 ? '+' : ''}${this.formatCurrency(diff)}`, cls: diff > 0 ? 'good' : 'warm' });
      }
      return { title: 'Deal Analysis', lines };
    }

    if (key === 'tier') {
      return { title: 'Price Tier', lines: [{ label: 'Tier', value: (val?.price_tier || '—').replace(/_/g, ' ') }], note: 'Price tier classifies the vehicle within its market segment.' };
    }

    // ── Signal weight rows ──────────────────────────────────────

    if (key.startsWith('sig_')) {
      const sigName = key.slice(4);
      const sw = val?.signal_weights as AnyData | undefined;
      const sig = sw?.[sigName] as AnyData | undefined;
      if (!sig) return null;
      const lines: PopupRow[] = [];
      lines.push({ label: 'Weight', value: `${sig.weight?.toFixed(2) || 0}`, type: 'bar', pct: Math.min(100, (sig.weight || 0) * 100) });
      lines.push({ label: 'Sources', value: `${sig.sourceCount || 0} data points` });
      const descriptions: Record<string, string> = {
        comps: 'Comparable sales data — recent auction results for similar vehicles.',
        rarity: 'Production rarity — how uncommon this vehicle configuration is.',
        survival: 'Survival rate — estimated percentage still in existence.',
        bid_curve: 'Bid curve analysis — auction bidding patterns and momentum.',
        condition: 'Condition assessment — documented state of the vehicle.',
        sentiment: 'Market sentiment — community opinion and expert commentary.',
        originality: 'Originality score — how close to factory specification.',
        market_trend: 'Market trend — price trajectory over time for this segment.',
      };
      return { title: `Signal: ${sigName}`, lines, note: descriptions[sigName] || `${sigName} signal contributes to the overall valuation model.` };
    }

    // ── Condition fields ────────────────────────────────────────

    if (key === 'condition_rating') {
      const cond = obs.condition?.structured_data;
      if (!cond) return null;
      const lines: PopupRow[] = [];
      const rating = cond.condition_rating;
      const scale = cond.condition_scale || 10;
      lines.push({ label: 'Rating', value: `${rating}/${scale}`, type: 'bar', pct: (rating / scale) * 100 });
      if (cond.overall_condition) lines.push({ label: 'Summary', value: cond.overall_condition });
      // Impact on value
      if (val?.estimated_value && avgCompPrice) {
        const prem = val.estimated_value - avgCompPrice;
        lines.push({ label: 'Value impact', value: `${prem >= 0 ? '+' : ''}${this.formatCurrency(prem)}`, cls: prem >= 0 ? 'good' : 'warm' });
      }
      return { title: 'Condition Assessment', lines, note: 'Condition is the single largest value driver in the collector market.' };
    }

    if (key.startsWith('cond_')) {
      const system = key.slice(5);
      const cond = obs.condition?.structured_data;
      if (!cond) return null;
      const value = cond[`${system}_condition`];
      const lines: PopupRow[] = [{ label: system, value: value || '—' }];
      const valueMap: Record<string, string> = {
        excellent: 'Top condition — no visible defects, minimal wear.',
        good: 'Above average — minor wear consistent with age, no major issues.',
        fair: 'Average condition — expected wear, some issues that may need attention.',
        poor: 'Below average — significant wear or damage requiring restoration.',
      };
      const normalized = (value || '').toLowerCase();
      for (const [k, v] of Object.entries(valueMap)) {
        if (normalized.includes(k)) {
          lines.push({ label: 'Assessment', value: v });
          break;
        }
      }
      return { title: `${system.charAt(0).toUpperCase() + system.slice(1)} Condition`, lines };
    }

    // ── Build record fields ─────────────────────────────────────

    if (key === 'investment') {
      const wr = obs.work_record?.structured_data;
      if (!wr?.total_investment) return null;
      const lines: PopupRow[] = [];
      lines.push({ label: 'Total invested', value: this.formatCurrency(wr.total_investment) });
      if (val?.estimated_value) {
        const roi = ((val.estimated_value - wr.total_investment) / wr.total_investment * 100).toFixed(0);
        lines.push({ label: 'ROI', value: `${Number(roi) >= 0 ? '+' : ''}${roi}%`, cls: Number(roi) >= 0 ? 'good' : 'warm' });
        lines.push({ label: 'Value gap', value: this.formatCurrency(val.estimated_value - wr.total_investment), cls: val.estimated_value >= wr.total_investment ? 'good' : 'warm' });
      }
      if (wr.parts_cost_estimate && wr.labor_cost_estimate) {
        const total = wr.parts_cost_estimate + wr.labor_cost_estimate;
        lines.push({ label: 'Parts ratio', value: `${Math.round((wr.parts_cost_estimate / total) * 100)}%`, type: 'bar', pct: (wr.parts_cost_estimate / total) * 100 });
      }
      return { title: 'Build Investment', lines, note: 'Restoration costs often exceed market value. The gap is the "passion premium."' };
    }

    if (key === 'labor') {
      const wr = obs.work_record?.structured_data;
      if (!wr?.labor_hours) return null;
      const lines: PopupRow[] = [];
      lines.push({ label: 'Hours', value: this.formatNumber(wr.labor_hours) });
      if (wr.labor_cost_estimate) {
        const rate = Math.round(wr.labor_cost_estimate / wr.labor_hours);
        lines.push({ label: 'Effective rate', value: `${this.formatCurrency(rate)}/hr` });
        lines.push({ label: 'Total labor $', value: this.formatCurrency(wr.labor_cost_estimate) });
      }
      if (wr.phases?.length) lines.push({ label: 'Build phases', value: `${wr.phases.length}` });
      return { title: 'Labor Analysis', lines };
    }

    if (key === 'parts_cost' || key === 'labor_cost') {
      const wr = obs.work_record?.structured_data;
      if (!wr) return null;
      const lines: PopupRow[] = [];
      if (wr.parts_cost_estimate) lines.push({ label: 'Parts', value: this.formatCurrency(wr.parts_cost_estimate) });
      if (wr.labor_cost_estimate) lines.push({ label: 'Labor', value: this.formatCurrency(wr.labor_cost_estimate) });
      if (wr.total_investment) lines.push({ label: 'Total', value: this.formatCurrency(wr.total_investment) });
      return { title: 'Cost Breakdown', lines };
    }

    // ── Modifications ───────────────────────────────────────────

    if (key.startsWith('mod_')) {
      const modName = key.slice(4);
      const lines: PopupRow[] = [{ label: 'Modification', value: modName }];
      lines.push({ label: 'Market comps', value: `${comps.length} comparable vehicles` });
      if (avgCompPrice) lines.push({ label: 'Avg comp price', value: this.formatCurrency(avgCompPrice) });
      return { title: 'Modification', lines, note: 'Modifications can increase or decrease collector value depending on reversibility, quality, and era-appropriateness.' };
    }

    // ── Provenance ──────────────────────────────────────────────

    if (key === 'title_status') {
      const prov = obs.provenance?.structured_data;
      const lines: PopupRow[] = [{ label: 'Status', value: prov?.title_status || '—' }];
      if (prov?.title_status?.toLowerCase() === 'clean') {
        lines.push({ label: 'Impact', value: 'Positive — clean title maximizes value', cls: 'good' });
      } else if (prov?.title_status?.toLowerCase()?.includes('salvage')) {
        lines.push({ label: 'Impact', value: 'Negative — salvage title reduces value 20-40%', cls: 'warm' });
      }
      return { title: 'Title Status', lines, note: 'Title status is a critical provenance factor. Branded titles can reduce value by 20-60%.' };
    }

    if (key === 'docs') {
      const prov = obs.provenance?.structured_data;
      return { title: 'Documentation', lines: [{ label: 'Level', value: prov?.documentation_level || '—' }], note: 'Complete documentation (build sheets, window stickers, service records) significantly increases collector value and authenticates provenance.' };
    }

    if (key === 'ownership') {
      const prov = obs.provenance?.structured_data;
      return { title: 'Ownership History', lines: [{ label: 'Duration', value: prov?.ownership_duration || '—' }], note: 'Long-term single-owner vehicles typically command premiums. Frequent ownership changes can signal issues.' };
    }

    // ── Community ───────────────────────────────────────────────

    if (key === 'sentiment') {
      const comm = intel?.community;
      if (!comm) return null;
      const lines: PopupRow[] = [];
      if (comm.sentiment) lines.push({ label: 'Overall', value: comm.sentiment, cls: comm.sentiment === 'positive' ? 'good' : comm.sentiment === 'negative' ? 'hot' : 'warm' });
      if (comm.sentiment_score != null) lines.push({ label: 'Score', value: `${(comm.sentiment_score * 100).toFixed(0)}%`, type: 'bar', pct: comm.sentiment_score * 100 });
      if (comm.insights?.discussion_themes?.length) {
        for (const theme of comm.insights.discussion_themes.slice(0, 3)) {
          lines.push({ label: 'Theme', value: theme });
        }
      }
      return { title: 'Sentiment Analysis', lines, note: 'Derived from AI analysis of auction comments and community discussions.' };
    }

    if (key === 'comments') {
      const comm = intel?.community;
      if (!comm) return null;
      const lines: PopupRow[] = [];
      lines.push({ label: 'Analyzed', value: `${comm.comment_count || 0} comments` });
      if (comm.data_quality != null) lines.push({ label: 'Data quality', value: `${(comm.data_quality * 100).toFixed(0)}%`, type: 'bar', pct: comm.data_quality * 100 });
      if (comm.insights?.expert_insights?.length) {
        lines.push({ label: 'Expert insights', value: `${comm.insights.expert_insights.length} found` });
      }
      if (comm.insights?.key_quotes?.length) {
        lines.push({ label: 'Key quotes', value: `${comm.insights.key_quotes.length} extracted` });
      }
      return { title: 'Comment Intelligence', lines };
    }

    if (key === 'data_quality') {
      const comm = intel?.community;
      if (!comm) return null;
      const lines: PopupRow[] = [];
      const dq = comm.data_quality ?? 0;
      lines.push({ label: 'Quality', value: `${(dq * 100).toFixed(0)}%`, type: 'bar', pct: dq * 100, cls: dq > 0.7 ? 'good' : dq < 0.4 ? 'warm' : undefined });
      lines.push({ label: 'Comments', value: `${comm.comment_count || 0}` });
      return { title: 'Data Quality', lines, note: dq > 0.7 ? 'High quality — rich discussion with substantive content.' : 'Quality could be improved with more detailed community engagement data.' };
    }

    // ── Individual comps ────────────────────────────────────────

    if (key.startsWith('comp_')) {
      const idx = parseInt(key.slice(5));
      const c = comps[idx];
      if (!c) return null;
      const lines: PopupRow[] = [];
      lines.push({ label: 'Vehicle', value: [c.year, c.make, c.model, c.trim].filter(Boolean).join(' ') });
      if (c.sale_price) lines.push({ label: 'Sold for', value: this.formatCurrency(c.sale_price) });
      if (c.platform) lines.push({ label: 'Platform', value: c.platform.replace(/_/g, ' ') });
      if (c.sold_date) lines.push({ label: 'Sold', value: new Date(c.sold_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) });
      if (c.mileage) lines.push({ label: 'Mileage', value: `${this.formatNumber(c.mileage)} mi` });
      if (c.color) lines.push({ label: 'Color', value: c.color });
      if (c.location) lines.push({ label: 'Location', value: c.location });
      // How this comp compares to valuation
      if (c.sale_price && val?.estimated_value) {
        const diff = c.sale_price - val.estimated_value;
        const pct = ((diff / val.estimated_value) * 100).toFixed(1);
        lines.push({ label: 'vs estimate', value: `${Number(pct) >= 0 ? '+' : ''}${pct}%`, cls: Number(pct) > 5 ? 'good' : Number(pct) < -5 ? 'warm' : undefined });
      }
      return { title: 'Comparable Sale', lines };
    }

    return null;
  }

  protected cleanup(): void {}

  protected onAttributeChanged(name: string): void {
    if (name === 'vehicle-id' || name === 'vin') this.reload();
  }
}

if (!customElements.get('nuke-vehicle')) {
  customElements.define('nuke-vehicle', NukeVehicleElement);
}
