/**
 * Nuke Widgets Loader
 *
 * Importing this file registers all Nuke web components.
 * Use this for the all-in-one bundle.
 *
 * For individual widgets, import them directly:
 *   import '@nuke1/widgets/vehicle'
 *   import '@nuke1/widgets/vision'
 *   import '@nuke1/widgets/valuation'
 */

// Core exports
export { NukeWidgetBase } from '../core/NukeWidgetBase';
export { nukeEventBus } from '../core/event-bus';
export { getSupabaseClient } from '../core/supabase-client';
export type * from '../core/types';

// Widget imports (each self-registers its custom element)
import '../widgets/vehicle/nuke-vehicle';
import '../widgets/vision/nuke-vision';
import '../widgets/valuation/nuke-valuation';

// Re-export widget classes for programmatic use
export { NukeVehicleElement } from '../widgets/vehicle/nuke-vehicle';
export { NukeVisionElement } from '../widgets/vision/nuke-vision';
export { NukeValuationElement } from '../widgets/valuation/nuke-valuation';

// Log registration
if (typeof window !== 'undefined') {
  console.log('[nuke-widgets] v0.2.0 — 3 widgets registered');
}
