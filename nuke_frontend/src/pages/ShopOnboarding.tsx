import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import AppLayout from '../components/layout/AppLayout';
import '../design-system.css';
import { secureDocumentService } from '../services/secureDocumentService';

// Local enums aligned to DB enums
const ORG_TYPES = [
  'shop','dealer','garage','workshop','builder','detailer','transporter','photographer','appraiser','media','club','team','operation','custom'
] as const;

type OrgType = typeof ORG_TYPES[number];

const BUSINESS_ENTITY_TYPES = [
  'sole_proprietorship','llc','corporation','s_corporation','partnership','nonprofit','other'
] as const;

type BusinessEntityType = typeof BUSINESS_ENTITY_TYPES[number];

const LICENSE_TYPES = [
  'dealer_license','garage_license','repair_facility_license','body_shop_license','salvage_dealer_license','smog_check_license','wholesale_license','auction_license','transport_license','tow_license','rental_license','other'
] as const;

type LicenseType = typeof LICENSE_TYPES[number];

type LicenseForm = {
  license_type: LicenseType;
  license_number: string;
  issuing_authority?: string;
  issuing_state?: string;
  issue_date?: string; // yyyy-mm-dd
  expiration_date?: string; // yyyy-mm-dd
  // New: capture supporting files and collaborator context
  license_doc?: File | null;
  collaborator_with_license_holder?: boolean;
  contract_file?: File | null;
  collaboration_reason?: string;
  extracted_business_name?: string;
};

type InviteForm = { email: string; role: 'owner' | 'admin' | 'staff' | 'contractor' };

export default function ShopOnboarding() {
  const nav = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const submissionRef = useRef(false); // Additional protection against double submission
  const [error, setError] = useState<string | null>(null);

  // Step 1: Basics + Legal
  const [displayName, setDisplayName] = useState('');
  const [name, setName] = useState('');
  const [orgType, setOrgType] = useState<OrgType>('shop');
  const [website, setWebsite] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [legalName, setLegalName] = useState('');
  const [entityType, setEntityType] = useState<BusinessEntityType>('llc');
  // Replace numeric/legal text inputs with document attachments captured now and uploaded after shop creation
  const [einDocument, setEinDocument] = useState<File | null>(null);
  const [stateBusinessLicenseDoc, setStateBusinessLicenseDoc] = useState<File | null>(null);

  // Step 2: HQ Location
  const [hqName, setHqName] = useState('Headquarters');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setStateVal] = useState('');
  const [postal, setPostal] = useState('');
  const [hqPhone, setHqPhone] = useState('');
  const [hqEmail, setHqEmail] = useState('');
  // Extracted info from EIN doc
  const [einExtract, setEinExtract] = useState<{ business_name?: string; ein?: string; ein_last4?: string } | null>(null);
  const [einScanCompleted, setEinScanCompleted] = useState(false);
  // Extracted info from top-level State Business License
  const [topLicExtract, setTopLicExtract] = useState<{ business_name?: string; license_number?: string; issuing_state?: string; expiration_date?: string } | null>(null);
  const [businessLicenseScanCompleted, setBusinessLicenseScanCompleted] = useState(false);

  // Step 3: Licenses
  const [licenses, setLicenses] = useState<LicenseForm[]>([]);

  // Step 4: Departments
  const [createDefaultDepartments, setCreateDefaultDepartments] = useState(true);
  const [recommendedPresets, setRecommendedPresets] = useState<any[]>([]);

  // Step 5: Staff (invites)
  const [invites, setInvites] = useState<InviteForm[]>([]);

  // Load department presets preview when orgType changes
  useEffect(() => {
    (async () => {
      try {
        setRecommendedPresets([]);
        const { data } = await supabase
          .from('department_presets')
          .select('*')
          .eq('business_type', orgType);
        setRecommendedPresets(data || []);
      } catch {
        setRecommendedPresets([]);
      }
    })();
  }, [orgType]);

  const canSubmit = useMemo(() => {
    return displayName.trim().length > 1 && legalName.trim().length > 1;
  }, [displayName, legalName]);

  const addLicense = () => setLicenses(prev => ([...prev, {
    license_type: 'dealer_license',
    license_number: ''
  }]));

  const updateLicense = (idx: number, patch: Partial<LicenseForm>) => {
    setLicenses(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  };

  // Scan top-level State Business License to autofill legal name/entity
  const scanTopLicenseDocument = async (fileParam?: File) => {
    try {
      const apiKey = (import.meta as any).env?.VITE_OPENAI_API_KEY as string | undefined;
      const proxyUrl = (import.meta as any).env?.VITE_OPENAI_PROXY_URL as string | undefined;
      if (!apiKey && !proxyUrl) {
        alert('Configure VITE_OPENAI_API_KEY or VITE_OPENAI_PROXY_URL to enable license scanning.');
        return;
      }
      const file = fileParam || stateBusinessLicenseDoc;
      if (!file) return;

      // Upload document securely for future reference
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { document: secureDoc, error: uploadErr } = await secureDocumentService.uploadSecureDocument(
          file,
          'business_license',
          { user_id: user.id }
        );
        if (!uploadErr && secureDoc) {
          console.log('Business license document securely uploaded:', secureDoc.id);
        }
      }
      const dataUrl = await fileToDataUrl(file);
      const prompt = `Extract the following from this BUSINESS LICENSE and respond as pure JSON with keys: \n{
  "license_number": string,
  "issuing_authority": string,
  "issuing_state": string,
  "expiration_date": string, // format YYYY-MM-DD if present, else empty
  "business_name": string
}`;
      const body = await callOpenAIVision(apiKey, prompt, dataUrl);
      const text = body?.choices?.[0]?.message?.content || '';
      let parsed: any = {};
      try { parsed = JSON.parse(text); } catch {
        parsed.license_number = parsed.license_number || (text.match(/license[^\w]?number[\s:]*([A-Z0-9-]+)/i)?.[1] || '');
        parsed.issuing_state = parsed.issuing_state || (text.match(/state[\s:]*([A-Z]{2})/i)?.[1] || '');
      }
      setTopLicExtract({
        business_name: parsed.business_name,
        license_number: parsed.license_number,
        issuing_state: parsed.issuing_state,
        expiration_date: parsed.expiration_date
      });
      setBusinessLicenseScanCompleted(true);
      if (parsed.business_name && parsed.business_name.trim()) setLegalName(parsed.business_name.trim());
      if (parsed.business_name && (!entityType || entityType === 'other')) setEntityType(inferEntityType(parsed.business_name));
    } catch (e: any) {
      console.error('Scan top license failed', e);
    }
  };

  const removeLicense = (idx: number) => setLicenses(prev => prev.filter((_, i) => i !== idx));

  const addInvite = () => setInvites(prev => ([...prev, { email: '', role: 'staff' }]));
  const updateInvite = (idx: number, patch: Partial<InviteForm>) => setInvites(prev => prev.map((i, n) => n === idx ? { ...i, ...patch } : i));
  const removeInvite = (idx: number) => setInvites(prev => prev.filter((_, i) => i !== idx));

  // Infer business entity type from a legal/business name
  const inferEntityType = (name?: string): BusinessEntityType => {
    const n = (name || '').toLowerCase();
    if (/(non\s*profit|501\(c\))/i.test(name || '')) return 'nonprofit';
    if (/\bllc\b/.test(n)) return 'llc';
    if (/(s[-\s]?corp|s corporation)/i.test(name || '')) return 's_corporation';
    if (/(inc\.?|corp\.?|corporation)/i.test(n)) return 'corporation';
    if (/(lp|llp|partnership)/i.test(n)) return 'partnership';
    return 'other';
  };

  // Helper: convert a File to data URL for vision API
  const fileToDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  // Helper: call OpenAI Chat Completions with image, with model fallback and optional proxy
  const callOpenAIVision = async (
    apiKey: string | undefined,
    prompt: string,
    dataUrl: string,
    models: string[] = ['gpt-4o', 'gpt-4o-mini']
  ): Promise<any> => {
    const proxyUrl = (import.meta as any).env?.VITE_OPENAI_PROXY_URL as string | undefined;
    const endpoint = proxyUrl || 'https://api.openai.com/v1/chat/completions';
    const org = (import.meta as any).env?.VITE_OPENAI_ORG as string | undefined;
    const project = (import.meta as any).env?.VITE_OPENAI_PROJECT as string | undefined;
    let lastErrText = '';
    const headerVariants: Array<Record<string, string>> = [];
    const usingProxy = !!proxyUrl;
    if (usingProxy) {
      // Proxy holds the secret; do not send Authorization from browser
      headerVariants.push({ 'Content-Type': 'application/json' });
    } else {
      // Direct to OpenAI: include Authorization
      const baseHeaders: Record<string, string> = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      };
      const withOrgProject = { ...baseHeaders } as Record<string, string>;
      if (org) withOrgProject['OpenAI-Organization'] = org;
      if (project) withOrgProject['OpenAI-Project'] = project;
      headerVariants.push(withOrgProject);
      // Variant 2: no org/project (some projects block model access)
      headerVariants.push(baseHeaders);
    }

    for (const headers of headerVariants) {
      for (const model of models) {
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: prompt },
                  { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
                ]
              }
            ],
            temperature: 0.1,
            max_tokens: 400
          })
        });
        if (resp.ok) {
          try { return await resp.json(); } catch { return null; }
        }
        // capture body for diagnostics and try next combo
        try { lastErrText = await resp.text(); } catch { lastErrText = `${resp.status}`; }
        console.error('OpenAI error:', resp.status, lastErrText);
      }
    }
    throw new Error(`OpenAI vision call failed. Last error: ${lastErrText || 'unknown'}`);
  };

  // Scan selected license document and autofill fields
  const scanLicense = async (idx: number, fileParam?: File) => {
    try {
      const apiKey = (import.meta as any).env?.VITE_OPENAI_API_KEY as string | undefined;
      const proxyUrl = (import.meta as any).env?.VITE_OPENAI_PROXY_URL as string | undefined;
      if (!apiKey && !proxyUrl) {
        alert('Configure VITE_OPENAI_API_KEY or VITE_OPENAI_PROXY_URL to enable license scanning.');
        return;
      }
      const lic = licenses[idx];
      const file = fileParam || lic?.license_doc;
      if (!file) {
        alert('Select a license document first.');
        return;
      }
      const dataUrl = await fileToDataUrl(file);
      const prompt = `Extract the following from this BUSINESS LICENSE and respond as pure JSON with keys: 
{
  "license_number": string,
  "issuing_authority": string,
  "issuing_state": string,
  "expiration_date": string, // format YYYY-MM-DD if present, else empty
  "business_name": string
}`;
      const body = await callOpenAIVision(apiKey, prompt, dataUrl);
      const text = body?.choices?.[0]?.message?.content || '';
      let parsed: any = {};
      try { parsed = JSON.parse(text); } catch {
        // Try to extract rudimentarily
        parsed.license_number = parsed.license_number || (text.match(/license[^\w]?number[\s:]*([A-Z0-9-]+)/i)?.[1] || '');
        parsed.issuing_state = parsed.issuing_state || (text.match(/state[\s:]*([A-Z]{2})/i)?.[1] || '');
      }
      setLicenses(prev => prev.map((l, i) => i === idx ? {
        ...l,
        license_number: parsed.license_number || l.license_number,
        issuing_authority: parsed.issuing_authority || l.issuing_authority,
        issuing_state: parsed.issuing_state || l.issuing_state,
        expiration_date: parsed.expiration_date || l.expiration_date,
        extracted_business_name: parsed.business_name || l.extracted_business_name,
        collaborator_with_license_holder: (parsed.business_name && parsed.business_name.trim() && (parsed.business_name.trim() !== (legalName || '').trim())) ? true : l.collaborator_with_license_holder
      } : l));

      // Autofill legal name/entity if empty
      if (!legalName && parsed.business_name) {
        setLegalName(parsed.business_name);
      }
      if (parsed.business_name && (!entityType || entityType === 'other')) {
        setEntityType(inferEntityType(parsed.business_name));
      }
    } catch (e: any) {
      console.error('Scan license failed', e);
      alert('Failed to scan license');
    }
  };

  // Scan EIN Assignment Notice and autofill legal name and entity
  const scanEinDocument = async (fileParam?: File) => {
    try {
      const apiKey = (import.meta as any).env?.VITE_OPENAI_API_KEY as string | undefined;
      const proxyUrl = (import.meta as any).env?.VITE_OPENAI_PROXY_URL as string | undefined;
      if (!apiKey && !proxyUrl) {
        alert('Configure VITE_OPENAI_API_KEY or VITE_OPENAI_PROXY_URL to enable EIN scanning.');
        return;
      }
      const file = fileParam || einDocument;
      if (!file) {
        alert('Select an EIN document first.');
        return;
      }

      // Upload document securely for future reference
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { document: secureDoc, error: uploadErr } = await secureDocumentService.uploadSecureDocument(
          file,
          'ein_assignment_notice',
          { user_id: user.id }
        );
        if (!uploadErr && secureDoc) {
          console.log('EIN document securely uploaded:', secureDoc.id);
        }
      }
      const dataUrl = await fileToDataUrl(file);
      const prompt = `Extract the following from this IRS EIN assignment notice and respond as pure JSON with keys:\n{
  "business_name": string,
  "ein": string,
  "ein_last4": string
}`;
      const body = await callOpenAIVision(apiKey, prompt, dataUrl);
      const text = body?.choices?.[0]?.message?.content || '';
      let parsed: any = {};
      try { parsed = JSON.parse(text); } catch {
        parsed.ein = parsed.ein || (text.match(/\b\d{2}-\d{7}\b/)?.[0] || '');
        parsed.ein_last4 = parsed.ein_last4 || (parsed.ein ? parsed.ein.slice(-4) : (text.match(/last\s*4[^\d]*(\d{4})/i)?.[1] || ''));
        parsed.business_name = parsed.business_name || (text.match(/(?:legal\s*name|business\s*name)[:\s]+(.+)/i)?.[1]?.trim() || '');
      }
      setEinExtract({ business_name: parsed.business_name, ein: parsed.ein, ein_last4: parsed.ein_last4 });
      setEinScanCompleted(true);
      if (!legalName && parsed.business_name) setLegalName(parsed.business_name);
      if (parsed.business_name && (!entityType || entityType === 'other')) setEntityType(inferEntityType(parsed.business_name));
    } catch (e: any) {
      console.error('Scan EIN failed', e);
      alert('Failed to scan EIN document');
    }
  };

  const handleSubmit = async () => {
    // Prevent double submission
    if (submitting || submissionRef.current) return;

    submissionRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const { data: userRes } = await supabase.auth.getUser();
      const user = userRes?.user;
      if (!user) {
        setError('You must be logged in.');
        setSubmitting(false);
        submissionRef.current = false;
        return;
      }

      // Helper: upload a shop document into storage and record it in shop_documents
      const uploadShopDocument = async (file: File, shopId: string, documentType: string, title: string) => {
        // Upload to secure user-documents bucket with shop prefix
        const path = `${user.id}/shops/${shopId}/${Date.now()}_${file.name}`;
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('user-documents')
          .upload(path, file, { cacheControl: '3600', upsert: false });
        if (uploadErr) throw uploadErr;
        // Create long-lived signed URL (1 year) to satisfy non-null file_url
        const { data: signed, error: signErr } = await supabase.storage
          .from('user-documents')
          .createSignedUrl(uploadData.path, 60 * 60 * 24 * 365);
        if (signErr) throw signErr;
        const fileUrl = signed.signedUrl;
        const { error: docErr } = await supabase
          .from('shop_documents')
          .insert({
            shop_id: shopId,
            document_type: documentType,
            title: title || file.name,
            storage_path: uploadData.path,
            file_url: fileUrl,
            mime_type: file.type,
            file_size: file.size,
            is_sensitive: true,
            visibility: 'admin_only'
          });
        if (docErr) throw docErr;
      };

      // 1) Create shop and HQ location atomically
      const { data: result, error: shopErr } = await supabase.rpc('create_shop_atomic', {
        p_name: name?.trim() || displayName.trim(),
        p_owner_user_id: user.id,
        p_business_type: orgType,
        p_website_url: website || null,
        p_description: description || null,
        p_phone: phone || null,
        p_email: email || null,
        p_tax_id: null, // TODO: Add EIN field to form
        p_hq_name: hqName?.trim() || 'Headquarters',
        p_street: street || null,
        p_city: city || null,
        p_state: state || null,
        p_postal: postal || null,
        p_hq_phone: hqPhone || null,
        p_hq_email: hqEmail || null
      });
      if (shopErr) throw shopErr;

      const shopId = result.shop_id;
      const locationId = result.location_id;

      // 2) Add licenses atomically (optional)
      for (const lic of licenses) {
        if (!lic.license_number?.trim()) continue;
        const { error: licErr } = await supabase.rpc('add_shop_license_atomic', {
          p_shop_id: shopId,
          p_location_id: locationId,
          p_license_type: lic.license_type,
          p_license_number: lic.license_number.trim(),
          p_issuing_authority: lic.issuing_authority || null,
          p_issuing_state: lic.issuing_state || null,
          p_issued_date: lic.issue_date || null,
          p_expiration_date: lic.expiration_date || null
        });
        if (licErr) throw licErr;
        // Upload supporting license document (if provided)
        if (lic.license_doc) {
          await uploadShopDocument(lic.license_doc, shopId, 'state_business_license', `${lic.license_type} document`);
        }
        // If collaborating with license holder, archive contract securely (user-documents -> secure_documents)
        if (lic.collaborator_with_license_holder && lic.contract_file) {
          await secureDocumentService.uploadSecureDocument(lic.contract_file, 'collaboration_contract', {
            shop_id: shopId,
            license_number: lic.license_number.trim(),
            license_type: lic.license_type
          });
        }
      }

      // 4) Create default departments from presets (optional)
      if (createDefaultDepartments) {
        const { error: deptErr } = await supabase.rpc('create_default_departments', {
          p_shop_id: shopId,
          p_location_id: locationId,
          p_business_type: orgType
        });
        if (deptErr) throw deptErr;
      }

      // 5) Owner membership (optional, queries often rely on shop_members)
      await supabase.from('shop_members').upsert({
        shop_id: shopId,
        user_id: user.id,
        role: 'owner',
        status: 'active'
      }, { onConflict: 'shop_id,user_id' } as any);

      // 6) Invites (optional)
      for (const inv of invites) {
        if (!inv.email.trim()) continue;
        const token = crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
        await supabase.from('shop_invitations').insert({
          shop_id: shopId,
          email: inv.email.trim(),
          role: inv.role,
          invited_by: user.id,
          token,
          status: 'pending'
        });
      }

      // 7) Upload legal docs captured in step 1 and open a verification request with legal_name only
      if (einDocument) {
        await uploadShopDocument(einDocument, shopId, 'ein_assignment_notice', 'EIN Assignment Notice');
      }
      if (stateBusinessLicenseDoc) {
        await uploadShopDocument(stateBusinessLicenseDoc, shopId, 'state_business_license', 'State Business License');
      }
      if (legalName.trim()) {
        await supabase.from('verification_requests').insert({
          user_id: user.id,
          verification_type: 'business_verification',
          status: 'pending',
          submission_data: {
            shop_id: shopId,
            legal_name: legalName.trim(),
            business_entity_type: entityType
          }
        });
      }

      nav('/shops');
    } catch (e: any) {
      console.error(e);
      setError(e?.message || 'Failed to create organization');
    } finally {
      setSubmitting(false);
      submissionRef.current = false;
    }
  };

  return (
    <AppLayout>
      <div className="layout compact">
        <div className="container compact">
          <div className="main">
            <div className="section">
              <h1 className="heading-1">New Organization</h1>
              <p className="text text-muted">Upload documents, review details, and create your business profile in one page.</p>
            </div>

            {error && (
              <div className="alert alert-error" style={{ marginBottom: 12 }}>
                <div className="text">{error}</div>
              </div>
            )}

            {/* Documents first */}
            <div className="card" style={{ marginBottom: 8 }}>
              <div className="card-header"><h3 className="heading-3">Documents: Upload & Scan</h3></div>
              <div className="card-body">
                <div className="form-group">
                  <label className="form-label">EIN Assignment Notice</label>
                  <div className="inline-field">
                    <input
                      className="form-input"
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={e => {
                        const f = e.target.files?.[0] || null;
                        setEinDocument(f);
                        setEinScanCompleted(false); // Reset scan status when new file is selected
                        if (f) scanEinDocument(f);
                      }}
                    />
                    <button type="button" className="button button-small" onClick={() => scanEinDocument()}>Scan</button>
                  </div>
                  <div className="text text-small text-muted">Upload and scan to auto-fill business details.</div>
                  {einDocument && (
                    <div className="text text-small" style={{ marginTop: 4 }}>
                      <span style={{ color: einScanCompleted ? '#22c55e' : '#6b7280' }}>
                        📄 {einDocument.name}
                      </span>
                      {einScanCompleted && <span style={{ color: '#22c55e', marginLeft: 8 }}>✓ Scanned</span>}
                    </div>
                  )}
                  {einExtract && (
                    <div className="text text-small" style={{ marginTop: 6 }}>
                      {einExtract.business_name && (
                        <div><span className="text-muted">Detected business:</span> <strong>{einExtract.business_name}</strong></div>
                      )}
                      {einExtract.ein && (
                        <div><span className="text-muted">EIN:</span> <strong>{einExtract.ein}</strong></div>
                      )}
                      {!einExtract.ein && einExtract.ein_last4 && (
                        <div><span className="text-muted">EIN last 4:</span> <strong>{einExtract.ein_last4}</strong></div>
                      )}
                    </div>
                  )}
                </div>
                <div className="form-group">
                  <label className="form-label">State Business License (for verification archive)</label>
                  <div className="inline-field">
                    <input
                      className="form-input"
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={async e => {
                        const f = e.target.files?.[0] || null;
                        setStateBusinessLicenseDoc(f);
                        setBusinessLicenseScanCompleted(false); // Reset scan status when new file is selected
                        if (f) {
                          await scanTopLicenseDocument(f);
                          if (einDocument) await scanEinDocument(einDocument);
                        }
                      }}
                    />
                    <button type="button" className="button button-small" onClick={() => scanTopLicenseDocument()}>Scan</button>
                  </div>
                  <div className="text text-small text-muted">You can add and scan individual licenses below to autofill license details.</div>
                  {stateBusinessLicenseDoc && (
                    <div className="text text-small" style={{ marginTop: 4 }}>
                      <span style={{ color: businessLicenseScanCompleted ? '#22c55e' : '#6b7280' }}>
                        📄 {stateBusinessLicenseDoc.name}
                      </span>
                      {businessLicenseScanCompleted && <span style={{ color: '#22c55e', marginLeft: 8 }}>✓ Scanned</span>}
                    </div>
                  )}
                  <div className="flex gap-2" style={{ marginTop: 6 }}>
                    <button type="button" className="button button-small" onClick={async () => {
                      await Promise.all([
                        scanEinDocument(),
                        scanTopLicenseDocument()
                      ]);
                    }}>Scan All</button>
                  </div>
                  {topLicExtract && (
                    <div className="text text-small" style={{ marginTop: 6 }}>
                      {topLicExtract.business_name && (
                        <div><span className="text-muted">Detected business:</span> <strong>{topLicExtract.business_name}</strong></div>
                      )}
                      {topLicExtract.license_number && (
                        <div><span className="text-muted">License #:</span> <strong>{topLicExtract.license_number}</strong></div>
                      )}
                      {topLicExtract.issuing_state && (
                        <div><span className="text-muted">Issuing state:</span> <strong>{topLicExtract.issuing_state}</strong></div>
                      )}
                      {topLicExtract.expiration_date && (
                        <div><span className="text-muted">Expires:</span> <strong>{topLicExtract.expiration_date}</strong></div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Business Info & Legal */}
            <div className="card" style={{ marginBottom: 8 }}>
              <div className="card-header"><h3 className="heading-3">Business Info</h3></div>
              <div className="card-body">
                  <div className="two-col">
                    <div className="form-group">
                      <label className="form-label">Public Display Name</label>
                      <input className="form-input" value={displayName} onChange={e => setDisplayName(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Organization Type</label>
                      <select className="form-input" value={orgType} onChange={e => setOrgType(e.target.value as OrgType)}>
                        {ORG_TYPES.map(t => (<option key={t} value={t}>{t}</option>))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Website</label>
                      <input className="form-input" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://example.com" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Contact Phone</label>
                      <input className="form-input" value={phone} onChange={e => setPhone(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Contact Email</label>
                      <input className="form-input" value={email} onChange={e => setEmail(e.target.value)} />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Description</label>
                    <textarea className="form-input" rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="What your business does..." />
                  </div>
                  <div className="section"><h3 className="heading-3">Legal</h3></div>
                  <div className="two-col">
                    <div className="form-group">
                      <label className="form-label">Legal Name</label>
                      <input className="form-input" value={legalName} onChange={e => setLegalName(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Business Entity Type</label>
                      <select className="form-input" value={entityType} onChange={e => setEntityType(e.target.value as BusinessEntityType)}>
                        {BUSINESS_ENTITY_TYPES.map(t => (<option key={t} value={t}>{t}</option>))}
                      </select>
                    </div>
                  </div>

                  <div className="card" style={{ marginTop: 8 }}>
                    <div className="card-body">
                      <div className="text text-small text-muted">
                        Services and Specialties are auto-derived from tagged jobs and collaborations after you claim work. No manual entry needed.
                      </div>
                    </div>
                  </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3 className="heading-3">Headquarters Location</h3></div>
              <div className="card-body">
                  <div className="form-group">
                    <label className="form-label">Location Name</label>
                    <input className="form-input" value={hqName} onChange={e => setHqName(e.target.value)} placeholder="707 Yucca St HQ" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Street</label>
                    <input className="form-input" value={street} onChange={e => setStreet(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-3 gap-2" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
                    <input className="form-input" placeholder="City" value={city} onChange={e => setCity(e.target.value)} />
                    <input className="form-input" placeholder="State" value={state} onChange={e => setStateVal(e.target.value)} />
                    <input className="form-input" placeholder="ZIP" value={postal} onChange={e => setPostal(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Location Phone (optional)</label>
                    <input className="form-input" value={hqPhone} onChange={e => setHqPhone(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Location Email (optional)</label>
                    <input className="form-input" value={hqEmail} onChange={e => setHqEmail(e.target.value)} />
                  </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3 className="heading-3">Licenses</h3></div>
              <div className="card-body">
                  <div className="text text-small text-muted" style={{ marginBottom: 8 }}>Add any licenses now or later.</div>
                  <div className="flex gap-2" style={{ marginBottom: 12 }}>
                    <button className="button button-small" onClick={addLicense}>+ Add License</button>
                  </div>
                  <div className="grid gap-2">
                    {licenses.map((lic, idx) => (
                      <div key={idx} className="card">
                        <div className="card-body">
                          <div className="grid gap-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <div>
                              <label className="form-label">Type</label>
                              <select className="form-input" value={lic.license_type} onChange={e => updateLicense(idx, { license_type: e.target.value as LicenseType })}>
                                {LICENSE_TYPES.map(t => (<option key={t} value={t}>{t}</option>))}
                              </select>
                            </div>
                            <div>
                              <label className="form-label">License #</label>
                              <input className="form-input" value={lic.license_number} onChange={e => updateLicense(idx, { license_number: e.target.value })} />
                            </div>
                            <div>
                              <label className="form-label">Issuing Authority</label>
                              <input className="form-input" value={lic.issuing_authority || ''} onChange={e => updateLicense(idx, { issuing_authority: e.target.value })} />
                            </div>
                            <div>
                              <label className="form-label">Issuing State</label>
                              <input className="form-input" value={lic.issuing_state || ''} onChange={e => updateLicense(idx, { issuing_state: e.target.value })} />
                            </div>
                            <div>
                              <label className="form-label">Issue Date</label>
                              <input type="date" className="form-input" value={lic.issue_date || ''} onChange={e => updateLicense(idx, { issue_date: e.target.value })} />
                            </div>
                            <div>
                              <label className="form-label">Expiration Date</label>
                              <input type="date" className="form-input" value={lic.expiration_date || ''} onChange={e => updateLicense(idx, { expiration_date: e.target.value })} />
                            </div>
                          </div>
                          <div className="form-group">
                            <label className="form-label">License Document</label>
                            <div className="inline-field">
                              <input
                                className="form-input"
                                type="file"
                                accept="image/*,application/pdf"
                                onChange={e => {
                                  const f = e.target.files?.[0] || null;
                                  updateLicense(idx, { license_doc: f });
                                  if (f) scanLicense(idx, f);
                                }}
                              />
                              <button type="button" className="button button-small" onClick={() => scanLicense(idx)}>Scan</button>
                            </div>
                            {licenses[idx]?.extracted_business_name && (
                              <div className="text text-small" style={{ marginTop: 6 }}>
                                <span className="text-muted">Detected business on license:</span>{' '}
                                <strong>{licenses[idx]?.extracted_business_name}</strong>
                                {legalName && licenses[idx]?.extracted_business_name?.trim() !== legalName.trim() && (
                                  <div className="text text-small" style={{ color: '#92400e', marginTop: 4 }}>
                                    Name mismatch with Legal Name "{legalName}". If this is a collaboration, check the box below and optionally attach the contract.
                                  </div>
                                )}
                              </div>
                            )}
                            <div className="flex gap-2" style={{ marginTop: 6 }}>
                              <button type="button" className="button button-secondary button-small" onClick={() => removeLicense(idx)}>Remove</button>
                            </div>
                          </div>
                          <div className="form-group" style={{ marginTop: 4 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <input
                                type="checkbox"
                                checked={!!licenses[idx]?.collaborator_with_license_holder}
                                onChange={e => updateLicense(idx, { collaborator_with_license_holder: e.target.checked })}
                              />
                              I collaborate with the license holder
                            </label>
                            {licenses[idx]?.collaborator_with_license_holder && (
                              <div style={{ marginTop: 8 }}>
                                <label className="form-label">Upload Collaboration Contract (optional)</label>
                                <input
                                  className="form-input"
                                  type="file"
                                  accept="application/pdf,image/*"
                                  onChange={e => updateLicense(idx, { contract_file: e.target.files?.[0] || null })}
                                />
                                <div style={{ marginTop: 8 }}>
                                  <label className="form-label">Collaboration Reason</label>
                                  <textarea
                                    className="form-input"
                                    rows={2}
                                    placeholder="Explain why license name differs (e.g., subcontracted work, shared license)."
                                    value={licenses[idx]?.collaboration_reason || ''}
                                    onChange={e => updateLicense(idx, { collaboration_reason: e.target.value })}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3 className="heading-3">Departments</h3></div>
              <div className="card-body">
                  <label className="form-label">Recommended for {orgType}</label>
                  <div className="text text-small" style={{ marginBottom: 8 }}>
                    {recommendedPresets.length > 0 ? recommendedPresets.map(p => p.preset_name).join(', ') : 'No presets'}
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={createDefaultDepartments} onChange={e => setCreateDefaultDepartments(e.target.checked)} />
                    Automatically create default departments now
                  </label>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3 className="heading-3">Staff Invitations (Optional)</h3></div>
              <div className="card-body">
                  <div className="flex gap-2" style={{ marginBottom: 12 }}>
                    <button className="button button-small" onClick={addInvite}>+ Add Invite</button>
                  </div>
                  <div className="grid gap-2">
                    {invites.map((inv, idx) => (
                      <div key={idx} className="card">
                        <div className="card-body">
                          <div className="grid gap-2" style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: 8 }}>
                            <input className="form-input" placeholder="email@example.com" value={inv.email} onChange={e => updateInvite(idx, { email: e.target.value })} />
                            <select className="form-input" value={inv.role} onChange={e => updateInvite(idx, { role: e.target.value as InviteForm['role'] })}>
                              <option value="admin">admin</option>
                              <option value="staff">staff</option>
                              <option value="contractor">contractor</option>
                            </select>
                          </div>
                          <div className="flex gap-2" style={{ marginTop: 8 }}>
                            <button className="button button-secondary button-small" onClick={() => removeInvite(idx)}>Remove</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
              </div>
            </div>

            {/* Final Submit */}
            <div className="flex gap-2" style={{ marginTop: 16 }}>
              <button className="button button-primary" onClick={handleSubmit} disabled={submitting || !canSubmit}>
                {submitting ? 'Creating…' : 'Create Organization'}
              </button>
            </div>

          </div>
        </div>
      </div>
    </AppLayout>
  );
}
