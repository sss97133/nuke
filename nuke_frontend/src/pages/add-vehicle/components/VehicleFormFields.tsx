import React, { memo } from 'react';
import type { VehicleFormData, DetailLevel } from '../types';
import VehicleMakeModelInput from '../../../components/forms/VehicleMakeModelInput';

interface VehicleFormFieldsProps {
  formData: VehicleFormData;
  detailLevel: DetailLevel;
  onFieldChange: (name: keyof VehicleFormData, value: any) => void;
  className?: string;
}

const VehicleFormFields: React.FC<VehicleFormFieldsProps> = memo(({
  formData,
  detailLevel,
  onFieldChange,
  className = ''
}) => {
  const renderField = (
    name: keyof VehicleFormData,
    label: string,
    type: string = 'text',
    placeholder?: string,
    required: boolean = false
  ) => {
    const isUrlField = name === 'import_url';
    const rawValue = formData[name];
    const fieldValue = rawValue === undefined || rawValue === null ? '' : String(rawValue);

    return (
      <div className="form-group">
        <label htmlFor={name} className="form-label">
          {label} {required && <span className="text-danger">*</span>}
        </label>
        <div className={isUrlField ? "input-with-button" : ""}>
          <input
            id={name}
            name={name}
            type={type}
            value={fieldValue}
            onChange={(e) => onFieldChange(name, e.target.value)}
            placeholder={placeholder}
            className="form-input"
            required={required}
            autoComplete={isUrlField ? "off" : undefined}
            autoCorrect={isUrlField ? "off" : undefined}
            spellCheck={isUrlField ? "false" : undefined}
          />
          {isUrlField && fieldValue && (
            <button
              type="button"
              onClick={() => {
                onFieldChange(name, '');
                // Also clear from localStorage if it exists
                const AUTOSAVE_KEY = 'addVehicleFormData';
                const stored = localStorage.getItem(AUTOSAVE_KEY);
                if (stored) {
                  try {
                    const data = JSON.parse(stored);
                    delete data.import_url;
                    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
                  } catch (e) {
                    console.warn('Could not update localStorage:', e);
                  }
                }
              }}
              className="btn-clear-input"
              title="Clear URL"
              aria-label="Clear URL"
            >
              ×
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderSelectField = (
    name: keyof VehicleFormData,
    label: string,
    options: { value: string; label: string }[],
    required: boolean = false
  ) => (
    <div className="form-group">
      <label htmlFor={name} className="form-label">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      <select
        id={name}
        name={name}
        value={formData[name] === undefined || formData[name] === null ? '' : String(formData[name])}
        onChange={(e) => onFieldChange(name, e.target.value)}
        className="form-input"
        required={required}
      >
        <option value="">Select {label}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );

  const renderNumberField = (
    name: keyof VehicleFormData,
    label: string,
    placeholder?: string,
    min?: number,
    max?: number
  ) => (
    <div className="form-group">
      <label htmlFor={name} className="form-label">{label}</label>
      <input
        id={name}
        name={name}
        type="number"
        value={typeof formData[name] === 'number' || typeof formData[name] === 'string' ? formData[name] : ''}
        onChange={(e) => {
          const { value } = e.target;
          if (value === '') {
            onFieldChange(name, '');
            return;
          }
          const numeric = Number(value);
          onFieldChange(name, Number.isNaN(numeric) ? value : numeric);
        }}
        placeholder={placeholder}
        min={min}
        max={max}
        className="form-input"
      />
    </div>
  );

  return (
    <div className={`vehicle-form-fields ${className}`}>
      {/* Quick Import from URL */}
      <div className="form-section">
        <div className="form-grid grid-1">
          {renderField('import_url', 'Import from URL', 'url', 'Paste vehicle listing URL (BAT, Facebook Marketplace, Craigslist, AutoTrader, etc.)')}
        </div>
      </div>

      {/* Core Vehicle Information - Always visible */}
      <div className="form-section">
        <h3 className="section-title">Essential Information</h3>
        <div className="form-grid grid-1">
          <div className="form-group">
            <VehicleMakeModelInput
              make={formData.make}
              model={formData.model}
              onMakeChange={(make) => onFieldChange('make', make)}
              onModelChange={(model) => onFieldChange('model', model)}
            />
          </div>
        </div>

        <div className="form-grid grid-3">
          {renderNumberField('year', 'Year', 'e.g., 1972', 1900, new Date().getFullYear() + 1)}
          {renderField('vin', 'VIN', 'text', 'VIN or chassis ID (4-17 characters)')}
          {renderField('license_plate', 'License Plate')}
        </div>

        <div className="form-grid grid-2">
          {renderField('location', 'Listing Location / Region', 'text', 'Auto-filled from listing when available')}
          {renderField('listing_url', 'Original Listing URL', 'url', 'Import URL or external listing link')}
        </div>

        <div className="form-grid grid-1">
          <div className="form-group">
            <label htmlFor="relationship_type" className="form-label">
              Role <span className="text-danger">*</span>
            </label>
            <select
              id="relationship_type"
              name="relationship_type"
              value={formData.relationship_type || ''}
              onChange={(e) => onFieldChange('relationship_type', e.target.value)}
              className="form-input"
              required
            >
              <option value="">Select your role</option>
              <option value="owned">Owner</option>
              <option value="previously_owned">Previous Owner</option>
              <option value="discovered">Discoverer</option>
              <option value="interested">Interested Buyer</option>
              <option value="mechanic">Mechanic</option>
              <option value="painter">Painter</option>
              <option value="appraiser">Appraiser</option>
              <option value="dealer">Dealer</option>
              <option value="broker">Broker</option>
              <option value="curated">Curator</option>
            </select>
            {formData.relationship_type === 'owned' && formData.scanned_fields && formData.scanned_fields.length > 0 && (
              <div className="text-small text-muted" style={{ marginTop: 'var(--space-1)', fontSize: '8pt' }}>
                ✓ Ownership pre-certified via title document scan
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Physical Specifications - Basic level and above */}
      {detailLevel !== 'basic' && (
        <div className="form-section">
          <h3 className="section-title">Physical Specifications</h3>
          <div className="form-grid grid-3">
            {renderField('color', 'Exterior Color')}
            {renderField('interior_color', 'Interior Color')}
            {renderSelectField('body_style', 'Body Style', [
              { value: 'sedan', label: 'Sedan' },
              { value: 'coupe', label: 'Coupe' },
              { value: 'suv', label: 'SUV' },
              { value: 'truck', label: 'Truck' },
              { value: 'convertible', label: 'Convertible' },
              { value: 'wagon', label: 'Wagon' },
              { value: 'hatchback', label: 'Hatchback' }
            ])}
          </div>
          <div className="form-grid grid-2">
            {renderNumberField('doors', 'Number of Doors', undefined, 2, 5)}
            {renderNumberField('seats', 'Number of Seats', undefined, 2, 8)}
          </div>
        </div>
      )}

      {/* Engine & Performance - Detailed level and above */}
      {(detailLevel === 'detailed' || detailLevel === 'professional' || detailLevel === 'expert') && (
        <div className="form-section">
          <h3 className="section-title">Engine & Performance</h3>
          <div className="form-grid grid-3">
            {renderSelectField('fuel_type', 'Fuel Type', [
              { value: 'gasoline', label: 'Gasoline' },
              { value: 'diesel', label: 'Diesel' },
              { value: 'electric', label: 'Electric' },
              { value: 'hybrid', label: 'Hybrid' },
              { value: 'plugin_hybrid', label: 'Plug-in Hybrid' }
            ])}
            {renderSelectField('transmission', 'Transmission', [
              { value: 'manual', label: 'Manual' },
              { value: 'automatic', label: 'Automatic' },
              { value: 'cvt', label: 'CVT' },
              { value: 'dual_clutch', label: 'Dual Clutch' }
            ])}
            {renderField('transmission_model', 'Transmission Model', 'text', 'e.g., 6L90, 4L60E, TH350')}
            {renderField('engine_size', 'Engine Size', 'text', 'e.g., 2.0L, V6')}
          </div>
          <div className="form-grid grid-3">
            {renderField('displacement', 'Displacement', 'text', 'e.g., 2000cc')}
            {renderNumberField('horsepower', 'Horsepower', 'HP')}
            {renderNumberField('torque', 'Torque', 'lb-ft')}
          </div>
        </div>
      )}

      {/* Financial Information - Professional level and above */}
      {(detailLevel === 'professional' || detailLevel === 'expert') && (
        <div className="form-section">
          <h3 className="section-title">Financial Information</h3>
          <div className="form-grid grid-3">
            {renderNumberField('purchase_price', 'Purchase Price', '$')}
            {renderNumberField('current_value', 'Current Value', '$')}
            {renderNumberField('msrp', 'Original MSRP', '$')}
          </div>
          <div className="form-grid grid-2">
            {renderNumberField('asking_price', 'Asking Price', '$')}
            {renderNumberField('sale_price', 'Sale Price', '$')}
          </div>
          <div className="form-grid grid-2">
            {renderField('purchase_date', 'Actual Purchase Date', 'date')}
            {renderField('purchase_location', 'Purchase Location')}
          </div>
          <div className="text-small text-muted" style={{ marginTop: 'var(--space-1)', fontSize: '8pt' }}>
            Note: Purchase Date is when you actually bought the vehicle. Confirm with bill of sale or receipt. Photos can document timeline but don't confirm purchase date.
          </div>
        </div>
      )}

      {/* Expert Fields - Expert level only */}
      {detailLevel === 'expert' && (
        <>
          <div className="form-section">
            <h3 className="section-title">Detailed Specifications</h3>
            <div className="form-grid grid-4">
              {renderNumberField('weight_lbs', 'Weight', 'lbs')}
              {renderNumberField('length_inches', 'Length', 'inches')}
              {renderNumberField('width_inches', 'Width', 'inches')}
              {renderNumberField('height_inches', 'Height', 'inches')}
            </div>
            <div className="form-grid grid-4">
              {renderNumberField('fuel_capacity_gallons', 'Fuel Capacity', 'gallons')}
              {renderNumberField('mpg_city', 'City MPG')}
              {renderNumberField('mpg_highway', 'Highway MPG')}
              {renderNumberField('mpg_combined', 'Combined MPG')}
            </div>
          </div>

          <div className="form-section">
            <h3 className="section-title">Legal & Insurance</h3>
            <div className="form-grid grid-2">
              {renderField('title_transfer_date', 'Title Transfer Date', 'date')}
              {renderField('insurance_company', 'Insurance Company')}
              {renderField('insurance_policy_number', 'Policy Number')}
              {renderField('registration_state', 'Registration State')}
              {renderField('registration_expiry', 'Registration Expiry', 'date')}
              {renderField('inspection_expiry', 'Inspection Expiry', 'date')}
            </div>
            <div className="text-small text-muted" style={{ marginTop: 'var(--space-1)', fontSize: '8pt' }}>
              Note: Title Transfer Date is extracted from title scan. This is when ownership officially changed, not necessarily the purchase date.
            </div>
          </div>
        </>
      )}

      {/* Discovery Context */}
      <div className="form-section">
        <h3 className="section-title">Discovery Context</h3>
        <div className="form-grid grid-1">
          <div className="form-group">
            <label htmlFor="discoverer_opinion" className="form-label">
              Your Notes / Opinion
            </label>
            <textarea
              id="discoverer_opinion"
              name="discoverer_opinion"
              value={formData.discoverer_opinion || ''}
              onChange={(e) => onFieldChange('discoverer_opinion', e.target.value)}
              placeholder="Drop your analysis, negotiation posture, or context you want the team to see first. This posts as your top comment once the vehicle is created."
              rows={5}
              className="form-input"
            />
            <div className="text-small text-muted" style={{ marginTop: 'var(--space-1)' }}>
              We’ll send this as the first comment on the vehicle so everyone sees your take immediately.
            </div>
          </div>
        </div>

        <div className="form-grid grid-3">
          {renderField('listing_source', 'Listing Source', 'text', 'Craigslist, Bring a Trailer, Facebook Marketplace, etc.')}
          {renderField('listing_posted_at', 'Listing Posted (auto)', 'datetime-local')}
          {renderField('listing_updated_at', 'Listing Updated (auto)', 'datetime-local')}
        </div>
      </div>

      {/* Common Fields for all levels */}
      <div className="form-section">
        <h3 className="section-title">Additional Information</h3>
        <div className="form-grid grid-2">
          {renderNumberField('mileage', 'Current Mileage', 'miles')}
          {renderNumberField('condition_rating', 'Condition Rating', '1-10 scale', 1, 10)}
        </div>

        <div className="form-group">
          <label className="form-label">
            <input
              type="checkbox"
              checked={formData.is_modified || false}
              onChange={(e) => onFieldChange('is_modified', e.target.checked)}
              className="form-checkbox"
            />
            This vehicle has modifications
          </label>
        </div>

        {formData.is_modified && (
          <div className="form-group">
            <label htmlFor="modification_details" className="form-label">
              Modification Details
            </label>
            <textarea
              id="modification_details"
              name="modification_details"
              value={formData.modification_details || ''}
              onChange={(e) => onFieldChange('modification_details', e.target.value)}
              rows={3}
              className="form-textarea"
              placeholder="Describe the modifications..."
            />
          </div>
        )}

        <div className="form-group">
          <label htmlFor="notes" className="form-label">Notes</label>
          <textarea
            id="notes"
            name="notes"
            value={formData.notes || ''}
            onChange={(e) => onFieldChange('notes', e.target.value)}
            rows={3}
            className="form-textarea"
            placeholder="Any additional notes about this vehicle..."
          />
        </div>

        <div className="form-group">
          <label className="form-label">
            <input
              type="checkbox"
              checked={formData.is_public || false}
              onChange={(e) => onFieldChange('is_public', e.target.checked)}
              className="form-checkbox"
            />
            Make this vehicle publicly visible
          </label>
        </div>
      </div>

      <style>{`
        .form-section {
          margin-bottom: 2rem;
          padding-bottom: 1.5rem;
          border-bottom: 1px solid var(--border, #e2e8f0);
        }

        .form-section:last-child {
          border-bottom: none;
          margin-bottom: 0;
        }

        .section-title {
          font-size: 1.1rem;
          font-weight: 600;
          margin-bottom: 1rem;
          color: var(--foreground, #1f2937);
        }

        .form-grid {
          display: grid;
          gap: 1rem;
          margin-bottom: 1rem;
        }

        .grid-1 { grid-template-columns: 1fr; }
        .grid-2 { grid-template-columns: repeat(2, 1fr); }
        .grid-3 { grid-template-columns: repeat(3, 1fr); }
        .grid-4 { grid-template-columns: repeat(4, 1fr); }

      `}</style>
    </div>
  );
});

VehicleFormFields.displayName = 'VehicleFormFields';

export default VehicleFormFields;