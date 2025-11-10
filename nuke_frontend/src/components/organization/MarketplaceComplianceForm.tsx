import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

type MarketplaceProfile = {
  support_email?: string;
  support_phone?: string;
  support_hours?: string;
  support_url?: string;
  return_policy?: string;
  shipping_policy?: string;
  refund_policy?: string;
  privacy_policy_url?: string;
  terms_url?: string;
  commerce_contact_name?: string;
  commerce_contact_email?: string;
  commerce_contact_phone?: string;
  business_manager_id?: string;
  commerce_account_id?: string;
  facebook_page_id?: string;
  catalog_id?: string;
  docs?: {
    ein_assignment_notice?: boolean;
    state_business_license?: boolean;
    insurance_policy?: boolean;
    privacy_policy?: boolean;
  };
  notes?: string;
  last_updated?: string;
};

interface MarketplaceComplianceFormProps {
  organizationId: string;
  canEdit: boolean;
}

type BusinessRecord = {
  legal_name: string | null;
  business_name: string | null;
  business_type: string | null;
  tax_id: string | null;
  registration_state: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  metadata: Record<string, any> | null;
};

const BUSINESS_TYPES = [
  'sole_proprietorship',
  'partnership',
  'llc',
  'corporation',
  'garage',
  'dealership',
  'restoration_shop',
  'performance_shop',
  'body_shop',
  'detailing',
  'mobile_service',
  'specialty_shop',
  'parts_supplier',
  'fabrication',
  'racing_team',
  'other'
] as const;

const MarketplaceComplianceForm: React.FC<MarketplaceComplianceFormProps> = ({ organizationId, canEdit }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [legalName, setLegalName] = useState('');
  const [businessType, setBusinessType] = useState<string>('');
  const [taxId, setTaxId] = useState('');
  const [registrationState, setRegistrationState] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [stateRegion, setStateRegion] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [country, setCountry] = useState('US');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');

  const [supportEmail, setSupportEmail] = useState('');
  const [supportPhone, setSupportPhone] = useState('');
  const [supportHours, setSupportHours] = useState('Mon–Fri 9:00 AM – 6:00 PM PT');
  const [supportUrl, setSupportUrl] = useState('');
  const [returnPolicy, setReturnPolicy] = useState('');
  const [shippingPolicy, setShippingPolicy] = useState('');
  const [refundPolicy, setRefundPolicy] = useState('');
  const [privacyPolicyUrl, setPrivacyPolicyUrl] = useState('');
  const [termsUrl, setTermsUrl] = useState('');
  const [commerceContactName, setCommerceContactName] = useState('');
  const [commerceContactEmail, setCommerceContactEmail] = useState('');
  const [commerceContactPhone, setCommerceContactPhone] = useState('');
  const [businessManagerId, setBusinessManagerId] = useState('');
  const [commerceAccountId, setCommerceAccountId] = useState('');
  const [facebookPageId, setFacebookPageId] = useState('');
  const [catalogId, setCatalogId] = useState('');
  const [notes, setNotes] = useState('');
  const [docs, setDocs] = useState({
    ein_assignment_notice: false,
    state_business_license: false,
    insurance_policy: false,
    privacy_policy: false
  });

  const [metadataSnapshot, setMetadataSnapshot] = useState<Record<string, any>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const { data, error } = await supabase
        .from('businesses')
        .select('legal_name, business_name, business_type, tax_id, registration_state, address, city, state, zip_code, country, phone, email, website, metadata')
        .eq('id', organizationId)
        .single<BusinessRecord>();

      if (error) throw error;
      if (!data) throw new Error('Organization not found');

      setLegalName(data.legal_name || data.business_name || '');
      setBusinessType(data.business_type || '');
      setTaxId(data.tax_id || '');
      setRegistrationState(data.registration_state || '');
      setAddress(data.address || '');
      setCity(data.city || '');
      setStateRegion(data.state || '');
      setZipCode(data.zip_code || '');
      setCountry(data.country || 'US');
      setPhone(data.phone || '');
      setEmail(data.email || '');
      setWebsite(data.website || '');

      const metadata = data.metadata || {};
      setMetadataSnapshot(metadata);
      const marketplaceProfile: MarketplaceProfile = metadata.marketplace_profile || {};

      setSupportEmail(marketplaceProfile.support_email || data.email || '');
      setSupportPhone(marketplaceProfile.support_phone || data.phone || '');
      setSupportHours(marketplaceProfile.support_hours || 'Mon–Fri 9:00 AM – 6:00 PM PT');
      setSupportUrl(marketplaceProfile.support_url || '');
      setReturnPolicy(marketplaceProfile.return_policy || '');
      setShippingPolicy(marketplaceProfile.shipping_policy || '');
      setRefundPolicy(marketplaceProfile.refund_policy || '');
      setPrivacyPolicyUrl(marketplaceProfile.privacy_policy_url || '');
      setTermsUrl(marketplaceProfile.terms_url || '');
      setCommerceContactName(marketplaceProfile.commerce_contact_name || '');
      setCommerceContactEmail(marketplaceProfile.commerce_contact_email || '');
      setCommerceContactPhone(marketplaceProfile.commerce_contact_phone || '');
      setBusinessManagerId(marketplaceProfile.business_manager_id || '');
      setCommerceAccountId(marketplaceProfile.commerce_account_id || '');
      setFacebookPageId(marketplaceProfile.facebook_page_id || '');
      setCatalogId(marketplaceProfile.catalog_id || '');
      setNotes(marketplaceProfile.notes || '');
      setDocs({
        ein_assignment_notice: marketplaceProfile.docs?.ein_assignment_notice || false,
        state_business_license: marketplaceProfile.docs?.state_business_license || false,
        insurance_policy: marketplaceProfile.docs?.insurance_policy || false,
        privacy_policy: marketplaceProfile.docs?.privacy_policy || false
      });
    } catch (err: any) {
      console.error('Failed to load marketplace profile', err);
      setError(err?.message || 'Failed to load marketplace profile');
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    load();
  }, [load]);

  const disableInputs = useMemo(() => !canEdit || saving, [canEdit, saving]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canEdit) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const marketplaceProfile: MarketplaceProfile = {
        support_email: supportEmail.trim(),
        support_phone: supportPhone.trim(),
        support_hours: supportHours.trim(),
        support_url: supportUrl.trim(),
        return_policy: returnPolicy.trim(),
        shipping_policy: shippingPolicy.trim(),
        refund_policy: refundPolicy.trim(),
        privacy_policy_url: privacyPolicyUrl.trim(),
        terms_url: termsUrl.trim(),
        commerce_contact_name: commerceContactName.trim(),
        commerce_contact_email: commerceContactEmail.trim(),
        commerce_contact_phone: commerceContactPhone.trim(),
        business_manager_id: businessManagerId.trim(),
        commerce_account_id: commerceAccountId.trim(),
        facebook_page_id: facebookPageId.trim(),
        catalog_id: catalogId.trim(),
        notes: notes.trim(),
        docs,
        last_updated: new Date().toISOString()
      };

      const updatedMetadata = {
        ...metadataSnapshot,
        marketplace_profile: marketplaceProfile
      };

      const updatePayload: Record<string, any> = {
        legal_name: legalName.trim() || null,
        business_type: businessType || null,
        tax_id: taxId.trim() || null,
        registration_state: registrationState.trim() || null,
        address: address.trim() || null,
        city: city.trim() || null,
        state: stateRegion.trim() || null,
        zip_code: zipCode.trim() || null,
        country: country.trim() || 'US',
        phone: phone.trim() || null,
        email: email.trim() || null,
        website: website.trim() || null,
        metadata: updatedMetadata,
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('businesses')
        .update(updatePayload)
        .eq('id', organizationId);

      if (error) throw error;

      setMetadataSnapshot(updatedMetadata);
      setSuccess('Marketplace compliance profile saved.');
    } catch (err: any) {
      console.error('Failed to save marketplace profile', err);
      setError(err?.message || 'Failed to save marketplace profile');
    } finally {
      setSaving(false);
    }
  };

  const renderInput = (
    label: string,
    value: string,
    setter: (v: string) => void,
    props: React.InputHTMLAttributes<HTMLInputElement> = {}
  ) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label className="text-small" style={{ fontWeight: 600 }}>{label}</label>
      <input
        className="form-input"
        value={value}
        onChange={(e) => setter(e.target.value)}
        disabled={disableInputs}
        {...props}
      />
    </div>
  );

  const renderTextArea = (
    label: string,
    value: string,
    setter: (v: string) => void,
    placeholder?: string
  ) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label className="text-small" style={{ fontWeight: 600 }}>{label}</label>
      <textarea
        className="form-input"
        style={{ minHeight: 72, fontSize: '9pt' }}
        value={value}
        onChange={(e) => setter(e.target.value)}
        placeholder={placeholder}
        disabled={disableInputs}
      />
    </div>
  );

  return (
    <div className="card">
      <div className="card-header" style={{ fontSize: '11pt', fontWeight: 700 }}>
        Marketplace Compliance Profile
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {loading ? (
          <div className="text text-small text-muted">Loading marketplace configuration…</div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {error && (
              <div className="alert alert-error" style={{ fontSize: '9pt' }}>{error}</div>
            )}
            {success && (
              <div className="alert alert-success" style={{ fontSize: '9pt' }}>{success}</div>
            )}

            <section className="card" style={{ border: '1px solid var(--border)', padding: 12 }}>
              <div className="card-header" style={{ marginBottom: 8 }}>Business Profile</div>
              <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                {renderInput('Legal Business Name', legalName, setLegalName)}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label className="text-small" style={{ fontWeight: 600 }}>Business Type</label>
                  <select
                    className="form-input"
                    value={businessType}
                    onChange={(e) => setBusinessType(e.target.value)}
                    disabled={disableInputs}
                  >
                    <option value="">Select type…</option>
                    {BUSINESS_TYPES.map(type => (
                      <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
                {renderInput('Tax ID / EIN', taxId, setTaxId)}
                {renderInput('Registration State', registrationState, setRegistrationState)}
                {renderInput('Phone', phone, setPhone, { placeholder: '(555) 123-4567' })}
                {renderInput('Email', email, setEmail, { type: 'email' })}
                {renderInput('Website', website, setWebsite, { placeholder: 'https://yourshop.com' })}
              </div>
              <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                {renderInput('Address', address, setAddress)}
                {renderInput('City', city, setCity)}
                {renderInput('State / Region', stateRegion, setStateRegion)}
                {renderInput('ZIP / Postal Code', zipCode, setZipCode)}
                {renderInput('Country', country, setCountry)}
              </div>
            </section>

            <section className="card" style={{ border: '1px solid var(--border)', padding: 12 }}>
              <div className="card-header" style={{ marginBottom: 8 }}>Support & Policies</div>
              <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                {renderInput('Support Email', supportEmail, setSupportEmail, { type: 'email' })}
                {renderInput('Support Phone', supportPhone, setSupportPhone)}
                {renderInput('Support URL', supportUrl, setSupportUrl, { placeholder: 'https://yourshop.com/support' })}
                {renderInput('Support Hours', supportHours, setSupportHours)}
              </div>
              <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                {renderTextArea('Return Policy', returnPolicy, setReturnPolicy, 'Describe your return policy or paste URL.')}
                {renderTextArea('Shipping Policy', shippingPolicy, setShippingPolicy, 'Include carrier details, lead-times, exclusions.')}
                {renderTextArea('Refund Policy', refundPolicy, setRefundPolicy, 'Explain refund turnaround and communication process.')}
              </div>
              <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                {renderInput('Privacy Policy URL', privacyPolicyUrl, setPrivacyPolicyUrl)}
                {renderInput('Terms of Service URL', termsUrl, setTermsUrl)}
              </div>
            </section>

            <section className="card" style={{ border: '1px solid var(--border)', padding: 12 }}>
              <div className="card-header" style={{ marginBottom: 8 }}>Commerce Contacts</div>
              <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                {renderInput('Primary Commerce Contact', commerceContactName, setCommerceContactName)}
                {renderInput('Commerce Contact Email', commerceContactEmail, setCommerceContactEmail, { type: 'email' })}
                {renderInput('Commerce Contact Phone', commerceContactPhone, setCommerceContactPhone)}
              </div>
              <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                {renderInput('Facebook Business Manager ID', businessManagerId, setBusinessManagerId)}
                {renderInput('Commerce Account ID', commerceAccountId, setCommerceAccountId)}
                {renderInput('Facebook Page ID', facebookPageId, setFacebookPageId)}
                {renderInput('Catalog ID', catalogId, setCatalogId)}
              </div>
            </section>

            <section className="card" style={{ border: '1px solid var(--border)', padding: 12 }}>
              <div className="card-header" style={{ marginBottom: 8 }}>Documentation Checklist</div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { key: 'ein_assignment_notice', label: 'EIN Assignment Notice (Form SS-4 confirmation)' },
                  { key: 'state_business_license', label: 'State/Local Business License' },
                  { key: 'insurance_policy', label: 'General Liability / Garage Keeper Insurance Certificate' },
                  { key: 'privacy_policy', label: 'Published Privacy Policy & Terms' }
                ].map(item => (
                  <label key={item.key} className="text-small" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={docs[item.key as keyof typeof docs]}
                      onChange={(e) => setDocs(prev => ({ ...prev, [item.key]: e.target.checked }))}
                      disabled={disableInputs}
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            </section>

            {renderTextArea('Internal Notes', notes, setNotes, 'Anything Facebook reviewers or our compliance team should know.')}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="button button-secondary"
                onClick={load}
                disabled={saving}
              >
                Refresh
              </button>
              <button
                type="submit"
                className="button button-primary"
                disabled={disableInputs}
              >
                {saving ? 'Saving…' : 'Save Compliance Profile'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default MarketplaceComplianceForm;

