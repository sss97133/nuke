import React, { useState, useCallback, memo } from 'react';
import { supabase } from '../../lib/supabase';
import { receiptExtractionService } from '../../services/receiptExtractionService';
import type { ParsedReceipt } from '../../services/receiptExtractionService';
import { receiptPersistService } from '../../services/receiptPersistService';
import { receiptValidationService } from '../../services/receiptValidationService';
import {
  FileText,
  Upload,
  DollarSign,
  Receipt,
  FileCheck,
  AlertCircle,
  X,
  Plus,
  Calendar,
  Building,
  Tag
} from 'lucide-react';
import VehicleErrorBoundary from '../vehicle/VehicleErrorBoundary';

interface DocumentUploadProps {
  vehicleId: string;
  onClose: () => void;
  onSuccess?: (documents: any[]) => void;
  defaultDocumentType?: string; // Default document type (e.g. 'receipt' for Import Tool Receipt button)
}

interface DocumentFile {
  file: File;
  id: string;
  preview?: string;
  category?: string;
  type?: string;
  description?: string;
  expectedAmount?: number;
  vendor?: string;
  documentDate?: string;
}

interface UploadState {
  status: 'idle' | 'uploading' | 'processing' | 'success' | 'error';
  message?: string;
  progress?: number;
}

const VehicleDocumentUploader: React.FC<DocumentUploadProps> = memo(({
  vehicleId,
  onClose,
  onSuccess,
  defaultDocumentType = 'receipt'
}) => {
  const [documents, setDocuments] = useState<DocumentFile[]>([]);
  const [uploadState, setUploadState] = useState<UploadState>({ status: 'idle' });
  const [dragOver, setDragOver] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [preparedMeta, setPreparedMeta] = useState<Record<string, { filePath: string; publicUrl: string; mappedType: ReturnType<typeof mapDocTypeToEnum> }>>({});
  const [parsedById, setParsedById] = useState<Record<string, ParsedReceipt | undefined>>({});
  const [scanState, setScanState] = useState<Record<string, 'idle' | 'scanning' | 'done' | 'error'>>({});

  const documentTypes = [
    { id: 'receipt', name: 'Receipt', icon: Receipt, description: 'Purchase receipts for parts/services' },
    { id: 'invoice', name: 'Invoice', icon: FileText, description: 'Service invoices and bills' },
    { id: 'bill_of_sale', name: 'Bill of Sale', icon: DollarSign, description: 'Vehicle purchase documents' },
    { id: 'warranty', name: 'Warranty', icon: FileCheck, description: 'Warranty certificates and docs' },
    { id: 'manual', name: 'Manual/Guide', icon: FileText, description: 'Owner manuals, service guides' },
    { id: 'insurance', name: 'Insurance', icon: FileCheck, description: 'Insurance documents' },
    { id: 'registration', name: 'Registration', icon: FileText, description: 'Registration and title docs' }
  ];

  const documentCategories = [
    'Parts & Components',
    'Labor & Service',
    'Maintenance & Repairs',
    'Insurance & Legal',
    'Tools & Equipment',
    'Fluids & Consumables',
    'Upgrades & Modifications',
    'Other'
  ];

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    addFiles(files);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(Array.from(e.target.files));
    }
  }, []);

  const addFiles = (files: File[]) => {
    const validFiles = files.filter(file => {
      const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
      const maxSize = 10 * 1024 * 1024; // 10MB
      return validTypes.includes(file.type) && file.size <= maxSize;
    });

    const newDocuments: DocumentFile[] = validFiles.map(file => ({
      file,
      id: Math.random().toString(36).substr(2, 9),
      type: detectDocumentType(file.name),
      category: 'Parts & Components'
    }));

    setDocuments(prev => [...prev, ...newDocuments]);
  };

  // Merge two parsed results with simple precedence (prefer a's fields, fallback to b)
  const aggregateParsed = (a?: ParsedReceipt, b?: ParsedReceipt): ParsedReceipt => {
    const brandFrom = (s?: string) => {
      if (!s) return null;
      const t = s.toLowerCase();
      if (t.includes('autozone')) return 'AutoZone';
      if (t.includes("o'reilly") || t.includes('oreilly')) return "O'Reilly Auto Parts";
      if (t.includes('advance auto')) return 'Advance Auto Parts';
      if (t.includes('napa')) return 'NAPA Auto Parts';
      if (t.includes('toms offroad')) return 'TOMS OFFROAD';
      return null;
    };
    const isPoorVendor = (s?: string) => {
      if (!s) return true;
      if (brandFrom(s)) return false;
      const alpha = (s.match(/[A-Za-z]/g) || []).length;
      const digits = (s.match(/[0-9]/g) || []).length;
      return alpha < 4 || digits > alpha; // likely garbage like "i 0 MS ok 495041"
    };
    const chooseVendor = (v1?: string, v2?: string) => {
      const b1 = brandFrom(v1);
      const b2 = brandFrom(v2);
      if (b2 && !b1) return v2;
      if (isPoorVendor(v1) && !isPoorVendor(v2)) return v2;
      return (v1 && !isPoorVendor(v1)) ? v1 : (v2 || v1);
    };
    const chooseNum = (x: any, y: any) => (typeof x === 'number' ? x : (typeof y === 'number' ? y : undefined));
    const first = <T,>(x?: T, y?: T) => (x !== undefined && x !== null && x !== '' ? x : y);
    const items = (a?.items && a.items.length ? a.items : (b?.items && b.items.length ? b.items : []));
    return {
      vendor_name: chooseVendor(a?.vendor_name, b?.vendor_name),
      receipt_date: first(a?.receipt_date, b?.receipt_date),
      currency: first(a?.currency, b?.currency) || 'USD',
      subtotal: chooseNum(a?.subtotal, b?.subtotal),
      tax: chooseNum(a?.tax, b?.tax),
      total: chooseNum(a?.total, b?.total),
      payment_method: first(a?.payment_method, b?.payment_method),
      card_last4: first(a?.card_last4, b?.card_last4),
      card_holder: first(a?.card_holder, b?.card_holder),
      invoice_number: first(a?.invoice_number, b?.invoice_number),
      purchase_order: first(a?.purchase_order, b?.purchase_order),
      items,
      raw_json: { cloud: a?.raw_json ?? a, ocr: b?.raw_json ?? b }
    } as any;
  };

  // Prepare image for OCR: if very small, up-scale via canvas; otherwise return original URL
  const prepareOcrImage = async (src: string): Promise<string> => {
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.crossOrigin = 'anonymous';
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = src;
      });
      const minWidth = 600;
      if (img.width >= minWidth) return src;
      const scale = Math.ceil(minWidth / Math.max(1, img.width));
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return src;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high' as any;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.92);
    } catch {
      return src;
    }
  };

  // Execute OCR and return parsed result (no UI updates here)
  const runQuickScan = async (docId: string, publicUrlOverride?: string): Promise<ParsedReceipt | undefined> => {
    const doc = documents.find(d => d.id === docId);
    const meta = preparedMeta[docId];
    const publicUrl = publicUrlOverride || meta?.publicUrl;
    if (!doc || !publicUrl) return;
    try {
      setScanState(prev => ({ ...prev, [docId]: 'scanning' }));
      const Tesseract = (await import('tesseract.js')).default as any;
      try { if (Tesseract.setLogging) Tesseract.setLogging(false); } catch {}
      const ocrSrc = await prepareOcrImage(publicUrl);
      const result = await Tesseract.recognize(ocrSrc, 'eng', { logger: () => {}, tessedit_pageseg_mode: 6 });
      const text: string = String(result?.data?.text || '');
      const norm = (s: string) => s
        .toLowerCase()
        .replace(/[0]/g, 'o')
        .replace(/[1\|]/g, 'i')
        .replace(/[5]/g, 's')
        .replace(/[3]/g, 'e')
        .replace(/[4]/g, 'a')
        .replace(/[7]/g, 't')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s{2,}/g, ' ');

      // Pre-split lines and keep a normalized copy
      const lines = text.split(/\r?\n/).map(l => l.replace(/[\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()).filter(Boolean);

      const getDate = () => {
        const m = text.match(/(\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b)/);
        if (m) return m[1];
        const m2 = text.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s*\d{2,4}\b/i);
        if (m2) return m2[0];
        const m3 = text.match(/date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
        if (m3) return m3[1];
        return undefined;
      };
      const getVendor = () => {
        const first20 = lines.slice(0, 20).join(' ').toLowerCase();
        const ntext = norm(text);
        if (/autozone/.test(first20) || /autozone/.test(ntext)) return 'AutoZone';
        if (/o\'?reilly/.test(first20) || /oreilly/.test(ntext)) return "O'Reilly Auto Parts";
        if (/advance auto/.test(first20) || /advanceauto/.test(ntext)) return 'Advance Auto Parts';
        if (/napa/.test(first20) || /napa/.test(ntext)) return 'NAPA Auto Parts';
        if (/toms\s*offroad/i.test(text) || /tomsoffroad/.test(ntext)) return 'TOMS OFFROAD';
        // fallback: first strong non-generic line
        for (let i = 0; i < Math.min(10, lines.length); i++) {
          const l = lines[i];
          if (/invoice|receipt|date|deliver to|order information|bill to|ship to/i.test(l)) continue;
          const clean = l.replace(/[^A-Za-z0-9 &']/g, '').trim();
          if (clean.length >= 3 && /[A-Za-z]/.test(clean)) return clean;
        }
        return undefined;
      };
      const getInvoiceNumber = () => {
        for (const l of lines) {
          const m = l.match(/invoice\s*number\s*[:#]?\s*([A-Za-z0-9-]+)/i);
          if (m) return m[1];
        }
        return undefined;
      };
      const getPayment = () => {
        const join = lines.join(' ');
        const pm = join.match(/(visa|mastercard|amex|discover)/i)?.[1];
        const last4 = join.match(/\*{2,}\s*([0-9]{4})\b/)?.[1];
        return { method: pm ? pm.toUpperCase() : undefined, last4 };
      };
      const getTotals = () => {
        let subtotal: number | undefined;
        let tax: number | undefined;
        let total: number | undefined;
        let shipping: number | undefined;
        for (const l of lines.slice(-30)) {
          const mm = (label: string) => l.toLowerCase().includes(label);
          const money = (str: string) => {
            const m = str.match(/\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+\.[0-9]{2})/);
            return m ? Number(m[1].replace(/,/g, '')) : undefined;
          };
          if (mm('subtotal')) subtotal = money(l) ?? subtotal;
          if (mm('shipping')) shipping = money(l) ?? shipping;
          if (mm('tax')) tax = money(l) ?? tax;
          if (mm('total due') || mm('total paid') || mm('amount due') || mm('total')) total = money(l) ?? total;
        }
        // As a fallback, take last currency in whole doc
        if (total === undefined) {
          const all = text.match(/\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+\.[0-9]{2})/g);
          if (all && all.length) total = Number(all[all.length - 1].replace(/[^0-9.]/g, ''));
        }
        return { subtotal, tax, total, shipping };
      };

      // Items: lines that begin with a part code then qty and a price at end
      const items: any[] = [];
      const isTotalLike = (l: string) => /\b(subtotal|shipping|tax|total due|total paid|amount due|payment methods|store credit balance)\b/i.test(l);
      // pattern A: PART DESC QTY UNIT TOTAL  (allow missing UNIT; then TOTAL at end)
      const itemReA = /^([A-Z0-9-]{2,})\s+(.*?)(?:\s+(\d+(?:\.[0-9]+)?))\s+\$?([0-9]+\.[0-9]{2})(?:\s+\$?([0-9]+\.[0-9]{2}))?$/i;
      for (const l of lines) {
        if (isTotalLike(l)) continue;
        if (/no vehicle given/i.test(l)) continue;
        const m = l.match(itemReA);
        if (m) {
          const [_, part, desc, qtyStr, p1, p2] = m;
          items.push({
            line_number: items.length + 1,
            part_number: part,
            description: desc.trim(),
            quantity: Number(qtyStr),
            unit_price: p2 ? Number(p1) : undefined,
            total_price: Number(p2 || p1)
          });
        }
      }
      // Fallback: capture lines with a trailing price
      if (items.length === 0) {
        lines.forEach((l) => {
          if (isTotalLike(l)) return;
          const m = l.match(/(.+?)\s+\$?([0-9]+\.[0-9]{2})\s*$/);
          // Require presence of a quantity before the price to reduce false positives
          if (m && /(\s|^)\d+(?:\.\d+)?(\s|$)/.test(l)) {
            items.push({ line_number: items.length + 1, description: m[1].trim(), total_price: Number(m[2]) });
          }
        });
      }

      const { subtotal, tax, total } = getTotals();
      const pay = getPayment();

      const parsed: ParsedReceipt = {
        vendor_name: getVendor(),
        receipt_date: getDate(),
        subtotal,
        tax,
        total,
        payment_method: pay.method,
        card_last4: pay.last4,
        invoice_number: getInvoiceNumber(),
        items,
        raw_json: { ocr: 'tesseract', text }
      } as any;

      setScanState(prev => ({ ...prev, [docId]: 'done' }));
      return parsed;
    } catch (e) {
      console.warn('Quick scan failed', e);
      setScanState(prev => ({ ...prev, [docId]: 'error' }));
      return undefined;
    }
  };

  // Quick Scan wrapper that also updates UI state
  const quickScanDocument = async (docId: string) => {
    const prior = parsedById[docId];
    const qs = await runQuickScan(docId);
    const merged = aggregateParsed(prior, qs);
    const doc = documents.find(d => d.id === docId);
    if (doc) {
      setParsedById(prev => ({ ...prev, [docId]: merged }));
      updateDocument(docId, {
        vendor: merged.vendor_name || doc.vendor,
        expectedAmount: (typeof merged.total === 'number' ? merged.total : doc.expectedAmount),
        documentDate: merged.receipt_date || doc.documentDate,
        description: doc.description || doc.file.name
      });
    }
  };

  const detectDocumentType = (filename: string): string => {
    const lower = filename.toLowerCase();
    if (lower.includes('receipt') || lower.includes('purchase')) return 'receipt';
    if (lower.includes('invoice') || lower.includes('bill')) return 'invoice';
    if (lower.includes('warranty')) return 'warranty';
    if (lower.includes('manual') || lower.includes('guide')) return 'manual';
    return defaultDocumentType;
  };

  // Map UI types to DB enum document_category
  const mapDocTypeToEnum = (t?: string):
    'receipt' | 'invoice' | 'title' | 'registration' | 'insurance' | 'service_record' | 'parts_order' | 'shipping_document' | 'legal_document' | 'other' => {
    switch ((t || '').toLowerCase()) {
      case 'receipt': return 'receipt';
      case 'invoice': return 'invoice';
      case 'registration': return 'registration';
      case 'insurance': return 'insurance';
      case 'parts_order': return 'parts_order';
      case 'service_record': return 'service_record';
      case 'title': return 'title';
      case 'shipping_document': return 'shipping_document';
      case 'bill_of_sale': return 'legal_document';
      case 'warranty': return 'legal_document';
      case 'manual': return 'other';
      default: return 'other';
    }
  };

  const updateDocument = (id: string, updates: Partial<DocumentFile>) => {
    setDocuments(prev =>
      prev.map(doc => doc.id === id ? { ...doc, ...updates } : doc)
    );
  };

  const removeDocument = (id: string) => {
    setDocuments(prev => prev.filter(doc => doc.id !== id));
  };

  const handleUpload = async () => {
    if (documents.length === 0) return;

    // Step 1: Upload to storage and parse to build a preview (no DB writes yet)
    setUploadState({ status: 'uploading', progress: 0 });

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('User not authenticated');
      }
      for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];
        setUploadState({
          status: 'uploading',
          progress: Math.round((i / documents.length) * 100),
          message: `Uploading ${doc.file.name}...`
        });

        // Upload file to Supabase Storage
        const safeName = doc.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const fileName = `${Date.now()}_${safeName}`;
        const filePath = `vehicles/${vehicleId}/documents/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('vehicle-data')
          .upload(filePath, doc.file, { contentType: doc.file.type, upsert: false });

        if (uploadError) throw uploadError;

        // Get public URL
        const { data: urlData } = supabase.storage
          .from('vehicle-data')
          .getPublicUrl(filePath);

        const mappedType = mapDocTypeToEnum(doc.type);
        setPreparedMeta(prev => ({ ...prev, [doc.id]: { filePath, publicUrl: urlData?.publicUrl, mappedType } }));

        // If receipt/invoice, parse both cloud and Quick Scan in parallel and aggregate
        if (mappedType === 'receipt' || mappedType === 'invoice') {
          setUploadState({ status: 'processing', message: `Parsing ${doc.file.name}...` });
          const cloudPromise = receiptExtractionService.extract({ url: urlData?.publicUrl, mimeType: doc.file.type });
          const quickPromise = runQuickScan(doc.id, urlData?.publicUrl); // always run OCR automatically with explicit URL
          const [cRes, qRes] = await Promise.allSettled([cloudPromise, quickPromise]);
          const cloud = cRes.status === 'fulfilled' ? cRes.value : undefined;
          const quick = qRes.status === 'fulfilled' ? qRes.value : undefined;
          let merged = aggregateParsed(cloud, quick);
          // If still weak vendor/date after merge, prefer OCR brand/date if available
          const poorVendor = !merged?.vendor_name || ((merged.vendor_name!.match(/[A-Za-z]/g) || []).length < 4);
          if (poorVendor && quick?.vendor_name) merged.vendor_name = quick.vendor_name;
          if (!merged.receipt_date && quick?.receipt_date) merged.receipt_date = quick.receipt_date;

          // LLM validation pass (Claude) to correct/normalize fields
          try {
            const ocrText = (quick && typeof quick.raw_json === 'object' && (quick as any).raw_json?.text) ? (quick as any).raw_json.text : '';
            const validated = await receiptValidationService.validate({ parsed: merged, ocrText });
            merged = aggregateParsed(validated, merged);
          } catch {}

          setParsedById(prev => ({ ...prev, [doc.id]: merged }));
          updateDocument(doc.id, {
            vendor: merged.vendor_name || doc.vendor,
            expectedAmount: (typeof merged.total === 'number' ? merged.total : doc.expectedAmount),
            documentDate: merged.receipt_date || doc.documentDate,
            description: doc.description || doc.file.name
          });
        }
      }

      // Switch to preview mode to show what will be saved
      setUploadState({ status: 'idle' });
      setPreviewMode(true);

    } catch (error: any) {
      console.error('Upload failed:', error);
      setUploadState({
        status: 'error',
        message: `Upload failed: ${error.message}`
      });
    }
  };

  // Step 2: Confirm & Save to DB based on preview payloads
  const handleConfirmSave = async () => {
    if (!previewMode || documents.length === 0) return;
    setUploadState({ status: 'uploading', progress: 0, message: 'Saving documents...' });
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const savedDocs: any[] = [];
      for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];
        const meta = preparedMeta[doc.id];
        if (!meta) throw new Error('Missing prepared metadata for file');

        setUploadState({ status: 'uploading', progress: Math.round((i / documents.length) * 100), message: `Saving ${doc.file.name}...` });

        const payload: any = {
          vehicle_id: vehicleId,
          uploaded_by: user.id,
          document_type: meta.mappedType,
          title: doc.description || doc.file.name,
          description: doc.description,
          document_date: doc.documentDate || null,
          file_url: meta.publicUrl,
          file_name: doc.file.name,
          file_type: doc.file.type,
          file_size: doc.file.size,
          privacy_level: 'owner_only',
          contains_pii: true,
          vendor_name: doc.vendor || null,
          amount: typeof doc.expectedAmount === 'number' ? doc.expectedAmount : null,
          currency: 'USD'
        };

        const { data: docData, error: dbError } = await supabase
          .from('vehicle_documents')
          .insert(payload)
          .select()
          .single();
        if (dbError) throw dbError;
        savedDocs.push(docData);

        if (meta.mappedType === 'receipt' || meta.mappedType === 'invoice') {
          try {
            const parsed = parsedById[doc.id] || await receiptExtractionService.extract({ url: meta.publicUrl, mimeType: doc.file.type });
            await receiptPersistService.saveForVehicleDoc({ vehicleId, documentId: docData.id, parsed });
          } catch (ex) {
            console.warn('Receipt persist failed for', doc.file.name, ex);
          }
        }
      }

      setUploadState({ status: 'success', message: `Ready: ${documents.length} document(s) saved.` });
      // Notify valuation widgets to refresh
      try {
        window.dispatchEvent(new CustomEvent('valuation_updated', { detail: { vehicleId } } as any));
      } catch {}
      onSuccess?.(savedDocs);
      setTimeout(() => onClose(), 1500);
    } catch (error: any) {
      console.error('Save failed:', error);
      setUploadState({ status: 'error', message: `Save failed: ${error.message}` });
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <VehicleErrorBoundary
      vehicleId={vehicleId}
      componentName="Document Uploader"
    >
      <div className="fixed inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999 }}>
      <div className="modal" style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        backgroundColor: 'var(--white)',
        border: '2px solid var(--border-dark)',
        maxWidth: '800px',
        width: '90%',
        maxHeight: '90vh',
        overflow: 'auto'
      }}>
        {/* Header */}
        <div className="modal-header" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-3)',
          borderBottom: '1px solid var(--border-light)',
          backgroundColor: 'var(--grey-200)'
        }}>
          <div className="text font-bold" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Upload style={{ width: '12px', height: '12px' }} />
            Upload Vehicle Documents
          </div>
          <button
            onClick={onClose}
            style={{
              border: '1px solid var(--border-medium)',
              backgroundColor: 'var(--grey-100)',
              padding: 'var(--space-1)',
              cursor: 'pointer',
              fontSize: 'var(--font-size-small)'
            }}
          >
            <X style={{ width: '10px', height: '10px' }} />
          </button>
        </div>

        {/* Content */}
        <div className="modal-content" style={{ padding: 'var(--space-4)' }}>
          {/* Status Messages */}
          {uploadState.status === 'error' && (
            <div className="status-message" style={{
              backgroundColor: 'var(--upload-red-light)',
              border: '1px solid var(--upload-red)',
              padding: 'var(--space-3)',
              marginBottom: 'var(--space-4)'
            }}>
              <div className="text" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <AlertCircle style={{ width: '12px', height: '12px' }} />
                {uploadState.message}
              </div>
            </div>
          )}

          {uploadState.status === 'success' && (
            <div className="status-message" style={{
              backgroundColor: 'var(--upload-green-light)',
              border: '1px solid var(--upload-green)',
              padding: 'var(--space-3)',
              marginBottom: 'var(--space-4)'
            }}>
              <div className="text" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <FileCheck style={{ width: '12px', height: '12px' }} />
                {uploadState.message}
              </div>
            </div>
          )}

          {uploadState.status === 'uploading' && (
            <div className="status-message" style={{
              backgroundColor: 'var(--upload-blue-light)',
              border: '1px solid var(--upload-blue)',
              padding: 'var(--space-3)',
              marginBottom: 'var(--space-4)'
            }}>
              <div className="text-small font-bold">Uploading... {uploadState.progress}%</div>
              <div className="text-small">{uploadState.message}</div>
              <div style={{
                backgroundColor: 'var(--grey-200)',
                height: '4px',
                marginTop: 'var(--space-2)',
                position: 'relative'
              }}>
                <div style={{
                  backgroundColor: 'var(--upload-blue)',
                  height: '100%',
                  width: `${uploadState.progress}%`,
                  transition: 'width 0.3s ease'
                }} />
              </div>
            </div>
          )}

          {/* Upload Zone */}
          {uploadState.status === 'idle' && !previewMode && (
            <>
              <div
                className="upload-zone"
                style={{
                  border: `2px dashed ${dragOver ? 'var(--upload-blue)' : 'var(--border-medium)'}`,
                  backgroundColor: dragOver ? 'var(--upload-blue-light)' : 'var(--grey-50)',
                  padding: 'var(--space-6)',
                  textAlign: 'center',
                  marginBottom: 'var(--space-4)'
                }}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <div style={{ marginBottom: 'var(--space-3)' }}>
                  <Upload style={{ width: '24px', height: '24px', margin: '0 auto', display: 'block' }} />
                  <div className="text" style={{ marginTop: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                    Drag & drop receipts, invoices, and paperwork here
                  </div>
                  <div className="text-small" style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
                    or click to select files
                  </div>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                    id="file-upload"
                  />
                  <button
                    onClick={() => document.getElementById('file-upload')?.click()}
                    style={{
                      border: '1px solid var(--border-medium)',
                      backgroundColor: 'var(--grey-100)',
                      padding: 'var(--space-2) var(--space-3)',
                      cursor: 'pointer',
                      fontSize: 'var(--font-size-small)'
                    }}
                  >
                    Select Files
                  </button>
                </div>
                <div className="text-small" style={{ color: 'var(--text-muted)' }}>
                  Supports: PDF, JPG, PNG, WebP (max 10MB each)
                </div>
              </div>

              {/* Document Type Guide */}
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <div className="text font-bold" style={{ marginBottom: 'var(--space-2)' }}>
                  Document Types
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-2)' }}>
                  {documentTypes.map(type => (
                    <div key={type.id} className="doc-type" style={{
                      border: '1px solid var(--border-light)',
                      padding: 'var(--space-2)',
                      backgroundColor: 'var(--grey-100)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
                        <type.icon style={{ width: '10px', height: '10px' }} />
                        <span className="text-small font-bold">{type.name}</span>
                      </div>
                      <div className="text-small">{type.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Document List */}
          {documents.length > 0 && uploadState.status === 'idle' && !previewMode && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <div className="text font-bold" style={{ marginBottom: 'var(--space-3)' }}>
                Documents to Upload ({documents.length})
              </div>

              {documents.map(doc => (
                <div key={doc.id} className="document-item" style={{
                  border: '1px solid var(--border-light)',
                  backgroundColor: 'var(--white)',
                  padding: 'var(--space-3)',
                  marginBottom: 'var(--space-2)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-2)' }}>
                    <div style={{ flex: 1 }}>
                      <div className="text font-bold">{doc.file.name}</div>
                      <div className="text-small" style={{ color: 'var(--text-muted)' }}>
                        {formatFileSize(doc.file.size)} • {doc.file.type}
                      </div>
                    </div>
                    <button
                      onClick={() => removeDocument(doc.id)}
                      style={{
                        border: '1px solid var(--border-medium)',
                        backgroundColor: 'var(--grey-200)',
                        padding: 'var(--space-1)',
                        cursor: 'pointer',
                        fontSize: 'var(--font-size-small)'
                      }}
                    >
                      <X style={{ width: '8px', height: '8px' }} />
                    </button>
                  </div>

                  {/* Document Details Form */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                    <div>
                      <div className="text-small font-bold" style={{ marginBottom: 'var(--space-1)' }}>
                        Document Type
                      </div>
                      <select
                        value={doc.type}
                        onChange={(e) => updateDocument(doc.id, { type: e.target.value })}
                        style={{
                          width: '100%',
                          border: '1px solid var(--border-medium)',
                          padding: 'var(--space-1)',
                          fontSize: 'var(--font-size-small)',
                          fontFamily: 'var(--font-family)'
                        }}
                      >
                        {documentTypes.map(type => (
                          <option key={type.id} value={type.id}>{type.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div className="text-small font-bold" style={{ marginBottom: 'var(--space-1)' }}>
                        Category
                      </div>
                      <select
                        value={doc.category}
                        onChange={(e) => updateDocument(doc.id, { category: e.target.value })}
                        style={{
                          width: '100%',
                          border: '1px solid var(--border-medium)',
                          padding: 'var(--space-1)',
                          fontSize: 'var(--font-size-small)',
                          fontFamily: 'var(--font-family)'
                        }}
                      >
                        {documentCategories.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
                    <div>
                      <div className="text-small font-bold" style={{ marginBottom: 'var(--space-1)' }}>
                        <Building style={{ width: '8px', height: '8px', display: 'inline', marginRight: 'var(--space-1)' }} />
                        Vendor/Store
                      </div>
                      <input
                        type="text"
                        value={doc.vendor || ''}
                        onChange={(e) => updateDocument(doc.id, { vendor: e.target.value })}
                        placeholder="AutoZone, O'Reilly, etc."
                        style={{
                          width: '100%',
                          border: '1px solid var(--border-medium)',
                          padding: 'var(--space-1)',
                          fontSize: 'var(--font-size-small)',
                          fontFamily: 'var(--font-family)'
                        }}
                      />
                    </div>

                    <div>
                      <div className="text-small font-bold" style={{ marginBottom: 'var(--space-1)' }}>
                        <DollarSign style={{ width: '8px', height: '8px', display: 'inline', marginRight: 'var(--space-1)' }} />
                        Amount
                      </div>
                      <input
                        type="number"
                        value={doc.expectedAmount || ''}
                        onChange={(e) => updateDocument(doc.id, { expectedAmount: parseFloat(e.target.value) || undefined })}
                        placeholder="0.00"
                        step="0.01"
                        style={{
                          width: '100%',
                          border: '1px solid var(--border-medium)',
                          padding: 'var(--space-1)',
                          fontSize: 'var(--font-size-small)',
                          fontFamily: 'var(--font-family)'
                        }}
                      />
                    </div>

                    <div>
                      <div className="text-small font-bold" style={{ marginBottom: 'var(--space-1)' }}>
                        <Calendar style={{ width: '8px', height: '8px', display: 'inline', marginRight: 'var(--space-1)' }} />
                        Date
                      </div>
                      <input
                        type="date"
                        value={doc.documentDate || ''}
                        onChange={(e) => updateDocument(doc.id, { documentDate: e.target.value })}
                        style={{
                          width: '100%',
                          border: '1px solid var(--border-medium)',
                          padding: 'var(--space-1)',
                          fontSize: 'var(--font-size-small)',
                          fontFamily: 'var(--font-family)'
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ marginTop: 'var(--space-2)' }}>
                    <div className="text-small font-bold" style={{ marginBottom: 'var(--space-1)' }}>
                      <Tag style={{ width: '8px', height: '8px', display: 'inline', marginRight: 'var(--space-1)' }} />
                      Description/Notes
                    </div>
                    <textarea
                      value={doc.description || ''}
                      onChange={(e) => updateDocument(doc.id, { description: e.target.value })}
                      placeholder="Brief description of purchase, work performed, etc."
                      rows={2}
                      style={{
                        width: '100%',
                        border: '1px solid var(--border-medium)',
                        padding: 'var(--space-1)',
                        fontSize: 'var(--font-size-small)',
                        fontFamily: 'var(--font-family)',
                        resize: 'vertical'
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Preview Section */}
          {previewMode && uploadState.status === 'idle' && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <div className="text font-bold" style={{ marginBottom: 'var(--space-3)' }}>Preview Submission</div>
              {documents.map(doc => {
                const meta = preparedMeta[doc.id];
                const parsed = parsedById[doc.id];
                return (
                  <div key={doc.id} className="document-item" style={{ border: '1px solid var(--border-light)', backgroundColor: 'var(--white)', padding: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
                    <div className="text font-bold" style={{ marginBottom: 'var(--space-2)' }}>{doc.file.name}</div>
                    <div className="text-small" style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
                      Will save as type: <strong>{meta?.mappedType}</strong> • Vendor: <strong>{doc.vendor || parsed?.vendor_name || '—'}</strong> • Amount: <strong>{typeof doc.expectedAmount === 'number' ? `$${doc.expectedAmount.toFixed(2)}` : (parsed?.total ? `$${parsed.total.toFixed(2)}` : '—')}</strong> • Date: <strong>{doc.documentDate || parsed?.receipt_date || '—'}</strong>
                    </div>
                    {parsed && (
                      <div className="text-small" style={{ border: '1px solid var(--border-light)', padding: 'var(--space-2)', borderRadius: 4, background: 'var(--grey-50)', marginBottom: 'var(--space-2)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0,1fr))', gap: 'var(--space-2)' }}>
                          <div><span className="font-bold">Invoice #</span><div>{parsed.invoice_number || '—'}</div></div>
                          <div><span className="font-bold">Payment</span><div>{parsed.payment_method || '—'}</div></div>
                          <div><span className="font-bold">Card</span><div>{parsed.card_last4 ? `•••• ${parsed.card_last4}` : '—'}</div></div>
                          <div><span className="font-bold">Subtotal</span><div>{typeof parsed.subtotal === 'number' ? `$${parsed.subtotal.toFixed(2)}` : '—'}</div></div>
                          <div><span className="font-bold">Shipping</span><div>{typeof (parsed as any).shipping === 'number' ? `$${(parsed as any).shipping.toFixed(2)}` : '—'}</div></div>
                          <div><span className="font-bold">Tax</span><div>{typeof parsed.tax === 'number' ? `$${parsed.tax.toFixed(2)}` : '—'}</div></div>
                        </div>
                      </div>
                    )}
                    {/* Quick Scan runs automatically; no extra buttons shown */}
                    {(meta?.mappedType === 'receipt' || meta?.mappedType === 'invoice') && parsed?.items && parsed.items.length > 0 && (
                      <div style={{ marginTop: 'var(--space-2)' }}>
                        <div className="text-small font-bold" style={{ marginBottom: 'var(--space-1)' }}>Line Items ({parsed.items.length})</div>
                        <div className="text-small" style={{ maxHeight: 180, overflow: 'auto', border: '1px solid var(--border-light)', padding: 'var(--space-2)' }}>
                          {parsed.items.map((it, idx) => (
                            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 'var(--space-2)', borderBottom: '1px solid var(--border-light)', padding: '4px 0' }}>
                              <div>{it.description || '—'}</div>
                              <div>{it.part_number || it.vendor_sku || '—'}</div>
                              <div>{typeof it.quantity === 'number' ? it.quantity : '—'}</div>
                              <div>{typeof it.total_price === 'number' ? `$${it.total_price.toFixed(2)}` : '—'}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Action Buttons */}
          {uploadState.status === 'idle' && (
            <div style={{ display: 'flex', gap: 'var(--space-3)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border-light)' }}>
              {!previewMode ? (
                <>
                  <button
                    onClick={onClose}
                    style={{ flex: 1, border: '1px solid var(--border-medium)', backgroundColor: 'var(--grey-100)', padding: 'var(--space-2) var(--space-3)', cursor: 'pointer', fontSize: 'var(--font-size-small)' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpload}
                    disabled={documents.length === 0}
                    style={{ flex: 1, border: '1px solid var(--upload-blue)', backgroundColor: documents.length === 0 ? 'var(--grey-200)' : 'var(--upload-blue-light)', padding: 'var(--space-2) var(--space-3)', cursor: documents.length === 0 ? 'not-allowed' : 'pointer', fontSize: 'var(--font-size-small)', fontWeight: 'bold' }}
                  >
                    Preview {documents.length > 0 ? `${documents.length} Document${documents.length > 1 ? 's' : ''}` : 'Documents'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setPreviewMode(false)}
                    style={{ flex: 1, border: '1px solid var(--border-medium)', backgroundColor: 'var(--grey-100)', padding: 'var(--space-2) var(--space-3)', cursor: 'pointer', fontSize: 'var(--font-size-small)' }}
                  >
                    Back
                  </button>
                  <button
                    onClick={handleConfirmSave}
                    style={{ flex: 1, border: '1px solid var(--upload-blue)', backgroundColor: 'var(--upload-blue-light)', padding: 'var(--space-2) var(--space-3)', cursor: 'pointer', fontSize: 'var(--font-size-small)', fontWeight: 'bold' }}
                  >
                    Confirm & Save
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        </div>
      </div>
    </VehicleErrorBoundary>
  );
});

VehicleDocumentUploader.displayName = 'VehicleDocumentUploader';

export default VehicleDocumentUploader;