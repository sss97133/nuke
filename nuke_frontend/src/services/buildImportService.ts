import { supabase } from '../lib/supabase';
import Papa from 'papaparse';

// Types for build data
export interface BuildLineItemImport {
  time: string; // Days to install
  category: string; // Part category (wheels, engine, etc.)
  name: string; // Part name
  supplier: string; // Supplier name
  investment?: number; // Initial cost
  done?: number; // Phase 2 cost
  invoice3?: number; // Phase 3 cost
  invoice4?: number; // Phase 4 cost
  total?: number; // Total cost
  quantity?: number;
  condition?: 'new' | 'used' | 'rebuilt' | 'refurbished';
  notes?: string;
}

export interface SupplierData {
  name: string;
  type: 'vendor' | 'marketplace' | 'shop' | 'labor' | 'individual';
  website?: string;
}

export class BuildImportService {
  /**
   * Parse CSV/text data into structured build items
   */
  static parseCSV(csvText: string): Promise<BuildLineItemImport[]> {
    return new Promise((resolve, reject) => {
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => {
          // Normalize headers
          return header.toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9_]/g, '');
        },
        transform: (value, field) => {
          // Clean currency values
          if (field && typeof field === 'string' && (field.includes('invoice') || field === 'investment' || field === 'done' || field === 'total')) {
            const cleaned = value.replace(/[$,]/g, '').trim();
            return cleaned ? parseFloat(cleaned) : null;
          }
          return value;
        },
        complete: (results) => {
          const items = results.data as any[];
          const parsed: BuildLineItemImport[] = items
            .filter(item => item.name || item.part) // Must have a name
            .map(item => ({
              time: item.time || '0',
              category: item.part || item.category || 'Uncategorized',
              name: item.name || item.part || 'Unknown',
              supplier: item.supplier || 'Unknown',
              investment: item.investment || 0,
              done: item.done || 0,
              invoice3: item.invoice_3 || 0,
              invoice4: item.invoice_4 || 0,
              total: item.total || 0,
              quantity: parseInt(item.quantity) || 1,
              condition: item.condition || 'new',
              notes: item.notes || ''
            }));
          resolve(parsed);
        },
        error: (error: any) => {
          reject(error);
        }
      });
    });
  }

  /**
   * Import parsed data into database
   */
  static async importBuildData(
    vehicleId: string,
    buildName: string,
    items: BuildLineItemImport[]
  ) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // Create or get build project
    const { data: build, error: buildError } = await supabase
      .from('vehicle_builds')
      .insert({
        vehicle_id: vehicleId,
        name: buildName,
        description: 'Imported from CSV',
        status: 'in_progress',
        total_budget: 0,
        total_spent: 0
      })
      .select()
      .single();

    if (buildError) throw buildError;

    // Extract unique suppliers
    const suppliers = Array.from(new Set(items.map(item => item.supplier)));
    const supplierMap: Record<string, string> = {};

    // Create suppliers
    for (const supplierName of suppliers) {
      if (!supplierName || supplierName === 'Unknown') continue;

      // Determine supplier type based on name
      let type: SupplierData['type'] = 'vendor';
      if (supplierName.toLowerCase().includes('labor')) type = 'labor';
      else if (supplierName.toLowerCase().includes('marketplace') || 
               supplierName.toLowerCase().includes('ebay') ||
               supplierName.toLowerCase().includes('amazon')) type = 'marketplace';
      else if (supplierName.toLowerCase().includes('shop')) type = 'shop';

      const { data: supplier } = await supabase
        .from('suppliers')
        .upsert({
          name: supplierName,
          type,
          user_id: user.id
        }, {
          onConflict: 'name,user_id'
        })
        .select()
        .single();

      if (supplier) {
        supplierMap[supplierName] = supplier.id;
      }
    }

    // Get part categories
    const { data: categories } = await supabase
      .from('part_categories')
      .select('id, name');

    const categoryMap = categories?.reduce((acc, cat) => {
      acc[cat.name.toLowerCase()] = cat.id;
      return acc;
    }, {} as Record<string, string>) || {};

    // Create phases based on invoice columns
    const phaseIds: Record<string, string> = {};

    if (items.some(i => i.investment && i.investment > 0)) {
      const { data: phase } = await supabase
        .from('build_phases')
        .insert({
          build_id: build.id,
          phase_number: 1,
          name: 'Initial Investment',
          total: items.reduce((sum, i) => sum + (i.investment || 0), 0),
          status: 'paid'
        })
        .select()
        .single();
      if (phase) phaseIds['investment'] = phase.id;
    }

    if (items.some(i => i.done && i.done > 0)) {
      const { data: phase } = await supabase
        .from('build_phases')
        .insert({
          build_id: build.id,
          phase_number: 2,
          name: 'Phase 2 - Completed',
          total: items.reduce((sum, i) => sum + (i.done || 0), 0),
          status: 'paid'
        })
        .select()
        .single();
      if (phase) phaseIds['done'] = phase.id;
    }

    if (items.some(i => i.invoice3 && i.invoice3 > 0)) {
      const { data: phase } = await supabase
        .from('build_phases')
        .insert({
          build_id: build.id,
          phase_number: 3,
          name: 'Invoice 3',
          total: items.reduce((sum, i) => sum + (i.invoice3 || 0), 0),
          status: 'pending'
        })
        .select()
        .single();
      if (phase) phaseIds['invoice3'] = phase.id;
    }

    if (items.some(i => i.invoice4 && i.invoice4 > 0)) {
      const { data: phase } = await supabase
        .from('build_phases')
        .insert({
          build_id: build.id,
          phase_number: 4,
          name: 'Invoice 4',
          total: items.reduce((sum, i) => sum + (i.invoice4 || 0), 0),
          status: 'pending'
        })
        .select()
        .single();
      if (phase) phaseIds['invoice4'] = phase.id;
    }

    // Create line items
    const lineItems = [];
    for (const item of items) {
      // Determine which phase this item belongs to
      let phaseId = null;
      let totalPrice = 0;
      let status = 'planning';

      if (item.investment && item.investment > 0) {
        phaseId = phaseIds['investment'];
        totalPrice = item.investment;
        status = 'completed';
      } else if (item.done && item.done > 0) {
        phaseId = phaseIds['done'];
        totalPrice = item.done;
        status = 'completed';
      } else if (item.invoice3 && item.invoice3 > 0) {
        phaseId = phaseIds['invoice3'];
        totalPrice = item.invoice3;
        status = 'ordered';
      } else if (item.invoice4 && item.invoice4 > 0) {
        phaseId = phaseIds['invoice4'];
        totalPrice = item.invoice4;
        status = 'planning';
      }

      // Find matching category
      let categoryId = null;
      const categoryLower = item.category.toLowerCase();
      for (const [catName, catId] of Object.entries(categoryMap)) {
        if (categoryLower.includes(catName) || catName.includes(categoryLower)) {
          categoryId = catId;
          break;
        }
      }

      const lineItem = {
        build_id: build.id,
        phase_id: phaseId,
        category_id: categoryId,
        supplier_id: supplierMap[item.supplier] || null,
        name: item.name,
        description: item.notes,
        quantity: item.quantity || 1,
        unit_price: totalPrice / (item.quantity || 1),
        total_price: totalPrice,
        days_to_install: parseInt(item.time) || 0,
        status,
        condition: item.condition as any || 'new',
        is_labor: item.supplier?.toLowerCase().includes('labor') || false
      };

      lineItems.push(lineItem);
    }

    // Batch insert line items
    const { error: itemsError } = await supabase
      .from('build_line_items')
      .insert(lineItems);

    if (itemsError) throw itemsError;

    // Update build totals
    const totalSpent = items.reduce((sum, item) => {
      return sum + (item.investment || 0) + (item.done || 0) + 
             (item.invoice3 || 0) + (item.invoice4 || 0);
    }, 0);

    await supabase
      .from('vehicle_builds')
      .update({
        total_spent: totalSpent,
        total_budget: totalSpent * 1.1 // Add 10% buffer
      })
      .eq('id', build.id);

    return build;
  }

  /**
   * Parse receipt/invoice image using OCR
   */
  static async parseReceipt(imageUrl: string): Promise<any> {
    // This would integrate with an OCR service like:
    // - Google Cloud Vision API
    // - AWS Textract
    // - Azure Form Recognizer
    // For now, return placeholder
    return {
      vendor: 'Detected Vendor',
      date: new Date(),
      total: 0,
      items: []
    };
  }

  /**
   * Import benchmark vehicles for comparison
   */
  static async importBenchmarks(
    buildId: string,
    benchmarks: Array<{
      url: string;
      price: number;
      year: number;
      engine: string;
      transmission: string;
    }>
  ) {
    const benchmarkData = benchmarks.map(b => ({
      build_id: buildId,
      listing_url: b.url,
      sale_price: b.price,
      year: b.year,
      engine: b.engine,
      transmission: b.transmission,
      source: b.url.includes('barrett') ? 'Barrett-Jackson' : 
              b.url.includes('bringatrailer') ? 'Bring a Trailer' : 'Other'
    }));

    const { error } = await supabase
      .from('build_benchmarks')
      .insert(benchmarkData);

    if (error) throw error;
  }
}
