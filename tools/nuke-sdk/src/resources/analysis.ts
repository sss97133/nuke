/**
 * Analysis Resource — nuke.analysis.*
 *
 * Proactive deal health signals: pricing risk, market timing, presentation
 * gaps, and deal health — surfaced before they become problems.
 *
 * @example
 * ```typescript
 * const nuke = new Nuke('nk_live_...');
 *
 * // Get all signals for a vehicle
 * const report = await nuke.analysis.get('vehicle-uuid');
 * console.log(report.health);          // { score: 45, label: 'warning', worst_signal: 'sell-through-cliff' }
 * console.log(report.signals[0]);      // { widget: 'sell-through-cliff', score: 30, severity: 'warning', ... }
 *
 * // Get a specific widget signal
 * const signal = await nuke.analysis.signal('vehicle-uuid', 'time-kills-deals');
 *
 * // Trigger recompute
 * await nuke.analysis.refresh('vehicle-uuid');
 *
 * // View signal history
 * const history = await nuke.analysis.history('vehicle-uuid', 'sell-through-cliff');
 *
 * // Acknowledge a signal
 * await nuke.analysis.acknowledge('signal-uuid');
 *
 * // Dismiss for 48 hours
 * await nuke.analysis.dismiss('signal-uuid', 48);
 * ```
 */

import type Nuke from '../index';
import type { RequestOptions } from '../types';

export interface AnalysisSignal {
  id: string;
  vehicle_id: string;
  widget: string;
  widget_name?: string;
  category?: string;
  score: number;
  severity: 'info' | 'ok' | 'warning' | 'critical';
  headline: string;
  details: Record<string, any> | null;
  reasons: string[] | null;
  confidence: number | null;
  recommendations: Array<{
    action: string;
    priority: number;
    rationale: string;
  }> | null;
  previous_score: number | null;
  change_direction: 'improved' | 'degraded' | 'unchanged' | 'new' | null;
  acknowledged_at: string | null;
  dismissed_until: string | null;
  computed_at: string | null;
  stale_at: string | null;
  updated_at: string | null;
}

export interface AnalysisHealth {
  score: number;
  label: string;
  worst_signal: string | null;
}

export interface AnalysisReport {
  vehicle_id: string;
  health: AnalysisHealth;
  signal_count: number;
  signals: AnalysisSignal[];
}

export interface AnalysisHistoryEntry {
  id: string;
  widget_slug: string;
  score: number;
  severity: string;
  headline: string;
  confidence: number | null;
  change_direction: string | null;
  created_at: string;
}

export interface AnalysisHistoryResponse {
  vehicle_id: string;
  widget: string;
  history: AnalysisHistoryEntry[];
  count: number;
}

export class Analysis {
  private client: Nuke;

  constructor(client: Nuke) {
    this.client = client;
  }

  /**
   * Get all analysis signals for a vehicle.
   *
   * Returns a health summary and all active widget signals sorted by
   * score (worst first).
   */
  async get(
    vehicleId: string,
    options?: RequestOptions
  ): Promise<AnalysisReport> {
    const response = await this.client.request<{ data: AnalysisReport }>(
      'GET',
      `api-v1-analysis?vehicle_id=${encodeURIComponent(vehicleId)}`,
      undefined,
      options
    );
    return response.data;
  }

  /**
   * Get a single widget signal for a vehicle.
   */
  async signal(
    vehicleId: string,
    widgetSlug: string,
    options?: RequestOptions
  ): Promise<AnalysisSignal> {
    const response = await this.client.request<{ data: AnalysisSignal }>(
      'GET',
      `api-v1-analysis?vehicle_id=${encodeURIComponent(vehicleId)}&widget=${encodeURIComponent(widgetSlug)}`,
      undefined,
      options
    );
    return response.data;
  }

  /**
   * Trigger immediate recompute of all analysis signals for a vehicle.
   */
  async refresh(
    vehicleId: string,
    options?: RequestOptions
  ): Promise<Record<string, any>> {
    const response = await this.client.request<{ data: Record<string, any> }>(
      'POST',
      'api-v1-analysis',
      { action: 'refresh', vehicle_id: vehicleId },
      options
    );
    return response.data;
  }

  /**
   * Get signal change history for a specific widget on a vehicle.
   */
  async history(
    vehicleId: string,
    widgetSlug: string,
    options?: RequestOptions
  ): Promise<AnalysisHistoryResponse> {
    const response = await this.client.request<{ data: AnalysisHistoryResponse }>(
      'GET',
      `api-v1-analysis/history?vehicle_id=${encodeURIComponent(vehicleId)}&widget=${encodeURIComponent(widgetSlug)}`,
      undefined,
      options
    );
    return response.data;
  }

  /**
   * Acknowledge a signal (mark as seen).
   */
  async acknowledge(
    signalId: string,
    options?: RequestOptions
  ): Promise<{ acknowledged: boolean }> {
    const response = await this.client.request<{ data: { acknowledged: boolean } }>(
      'POST',
      'api-v1-analysis',
      { action: 'acknowledge', signal_id: signalId },
      options
    );
    return response.data;
  }

  /**
   * Dismiss a signal for a specified number of hours.
   */
  async dismiss(
    signalId: string,
    hours: number = 24,
    options?: RequestOptions
  ): Promise<{ dismissed_until: string }> {
    const response = await this.client.request<{ data: { dismissed_until: string } }>(
      'POST',
      'api-v1-analysis',
      { action: 'dismiss', signal_id: signalId, hours },
      options
    );
    return response.data;
  }
}
