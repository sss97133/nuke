import React, { useState, useEffect, useRef } from 'react';
import { ProfessionalToolsService } from '../../services/professionalToolsService';
import { ToolProductEnrichmentService } from '../../services/toolProductEnrichmentService';
import { ToolImageService } from '../../services/toolImageService';
import { UniversalReceiptParser, parseReceiptText, parseAnyReceiptLocal } from '../../services/universalReceiptParser';
import { ReceiptService } from '../../services/receiptService';
import ImportProgressModal from './ImportProgressModal';
import ReceiptManager from './ReceiptManager';
import './ProfessionalToolbox.css';

// Interface aligned with user_tools table structure
interface UserTool {
  id: string;
  user_id: string;
  part_number?: string;
  description: string;
  brand?: string;
  category?: string;
  total_quantity?: number;
  first_purchase_date?: string;
  last_purchase_date?: string;
  total_spent?: number;
  receipt_ids?: string[];
  serial_numbers?: string[];
  image_url?: string;
  condition?: string;
  location?: string;
  notes?: string;
  metadata?: any;
  created_at?: string;
  updated_at?: string;
}

interface ProfessionalToolboxProps {
  userId: string;
  isOwnProfile: boolean;
}

const ProfessionalToolbox: React.FC<ProfessionalToolboxProps> = ({ userId, isOwnProfile }) => {
  const [tools, setTools] = useState<any[]>([]);
  const [hoveredBrand, setHoveredBrand] = useState<string | null>(null);
  const [hoverTimer, setHoverTimer] = useState<NodeJS.Timeout | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [dragActive, setDragActive] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [progressStatus, setProgressStatus] = useState({
    step: '',
    message: '',
    progress: 0,
    details: '',
    error: ''
  });
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [fetchingImages, setFetchingImages] = useState(false);
  const [showReceiptManager, setShowReceiptManager] = useState(false);
  
  // File upload ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadTools = async () => {
    try {
      setLoading(true);

      // ALWAYS load fresh from database - no caching
      console.log('Loading tools from database for user:', userId);
      const toolsData = await ProfessionalToolsService.getUserTools(userId);
      
      console.log(`Database returned ${toolsData?.length || 0} tools`);
      
      // Force clear and set fresh data
      setTools([]); // Clear first
      setTimeout(() => {
        setTools(toolsData || []);
      }, 10);

      // Get stats
      const toolStats = await ProfessionalToolsService.getToolStats(userId);
      setStats(toolStats);

    } catch (error) {
      console.error('Error loading tools:', error);
      setTools([]); // Clear on error too
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTools();
  }, [userId]);

  useEffect(() => {
    // Cleanup timer on unmount
    return () => {
      if (hoverTimer) {
        clearTimeout(hoverTimer);
      }
    };
  }, [hoverTimer]);

  const handleBrandHover = (brandName: string, toolId: string) => {
    // Clear any existing timer
    if (hoverTimer) {
      clearTimeout(hoverTimer);
    }
    
    // Set a new timer for 3 seconds
    const timer = setTimeout(() => {
      setHoveredBrand(toolId);
    }, 3000);
    
    setHoverTimer(timer);
  };

  const handleBrandLeave = () => {
    // Clear timer and hide tooltip
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      setHoverTimer(null);
    }
    setHoveredBrand(null);
  };

  const handleFetchToolImages = async () => {
    if (fetchingImages) return;
    
    setFetchingImages(true);
    try {
      const updatedCount = await ToolImageService.findMissingToolImages(userId);
      
      if (updatedCount > 0) {
        // Reload tools to show new images
        await loadTools();
        alert(`Successfully fetched ${updatedCount} tool images`);
      } else {
        alert('No new images found or all tools already have images');
      }
    } catch (error) {
      console.error('Error fetching tool images:', error);
      alert('Failed to fetch tool images');
    } finally {
      setFetchingImages(false);
    }
  };

  const getBrandLogoUrl = (brandName: string | undefined) => {
    if (!brandName) return null;
    
    const brand = brandName.toLowerCase();
    if (brand.includes('snap')) return 'https://logos-world.net/wp-content/uploads/2022/11/Snap-on-Logo.png';
    if (brand.includes('mac')) return 'https://www.mactools.com/content/dam/global/logos/mac-tools-logo.svg';
    if (brand.includes('matco')) return 'https://www.matcotools.com/content/dam/matco/common/logos/matco-logo.svg';
    if (brand.includes('cornwell')) return 'https://www.cornwelltools.com/media/wysiwyg/cornwell-logo.svg';
    if (brand.includes('craftsman')) return 'https://www.craftsman.com/NA/craftsman/img/craftsman-logo.svg';
    return null;
  };

  const updateProgress = (step: string, message: string, progress: number, details?: string, error?: string) => {
    setProgressStatus({ step, message, progress, details: details || '', error: error || '' });
  };

  // File upload handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (validateFile(file)) {
        setImportFile(file);
        // If it's a text file, read it immediately
        if (file.type === 'text/plain') {
          readTextFile(file);
        }
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (validateFile(file)) {
        setImportFile(file);
        // If it's a text file, read it immediately
        if (file.type === 'text/plain') {
          readTextFile(file);
        }
      }
    }
  };

  const validateFile = (file: File): boolean => {
    const validTypes = ['application/pdf', 'text/plain', 'image/png', 'image/jpeg', 'image/jpg'];
    
    if (!validTypes.includes(file.type)) {
      setImportErrors(['Invalid file type. Please upload a PDF, image, or text file.']);
      return false;
    }
    
    // Check file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setImportErrors(['File is too large. Maximum size is 10MB.']);
      return false;
    }
    
    setImportErrors([]);
    return true;
  };

  const readTextFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setImportText(text);
    };
    reader.readAsText(file);
  };

  const handleImportSnapOnReceipt = async () => {
    if (!importFile && !importText.trim()) return;

    setImporting(true);
    setImportErrors([]);
    setShowProgressModal(true);
    
    try {
      updateProgress('Processing', 'Preparing receipt for analysis...', 10);
      
      let parseResult;
      let fileUrl: string | null = null;
      
      // Use the universal parser based on input type
      if (importFile) {
        // Upload file to storage first
        updateProgress('Uploading', 'Uploading receipt to cloud...', 20);
        fileUrl = await ReceiptService.uploadReceiptFile(userId, importFile);
        
        if (!fileUrl) {
          throw new Error('Failed to upload receipt file');
        }
        
        // Parse the uploaded file
        updateProgress('Analyzing', 'Using Claude AI to analyze receipt...', 40, 
          importFile.type.startsWith('image/') ? 'Processing receipt image with vision AI' : 'Extracting text from document');
        
        parseResult = await UniversalReceiptParser.parseReceipt(importFile);

        // Force a local parse fallback if backend failed (503/500) and returned no items
        if (!parseResult.success || (parseResult.line_items?.length || 0) === 0) {
          const errText = (parseResult.errors || []).join(' ');
          const isServiceDown = /503|Server error|Claude API error/i.test(errText);
          if (isServiceDown) {
            updateProgress('Analyzing', 'Backend unavailable. Falling back to local parsing...', 50, 'Trying Claude client + local parsers');
            try {
              parseResult = await parseAnyReceiptLocal(importFile);
            } catch (e) {
              console.warn('Local parse fallback failed:', e);
            }
          }
        }
        
      } else if (importText) {
        // Create a text file for storage
        const textFile = new File([importText], `receipt_${Date.now()}.txt`, { type: 'text/plain' });
        fileUrl = await ReceiptService.uploadReceiptFile(userId, textFile);
        
        // Parse the text
        updateProgress('Analyzing', 'Using Claude AI to analyze receipt text...', 40, 'Extracting items and payment information');
        parseResult = await parseReceiptText(importText);
      } else {
        throw new Error('No receipt data provided');
      }
      
      console.log('Parse result:', parseResult);
      
      // Check if parsing was successful
      if (!parseResult.success || parseResult.line_items.length === 0) {
        let errorMessage = parseResult.errors.length > 0 
          ? parseResult.errors.join(' • ') 
          : 'No items could be extracted from the receipt';

        // Check for specific external service error
        const isServiceUnavailable = parseResult.errors.some(e => e.includes('503') || e.includes('Request failed'));
        if (isServiceUnavailable) {
          errorMessage = 'The AI parsing service is temporarily unavailable. This is usually a temporary issue. Please try again in a few minutes.';
        }

        
        updateProgress('Error', 'Failed to parse receipt', 0, 
          `Found ${parseResult.line_items.length} items, confidence: ${(parseResult.confidence_score * 100).toFixed(0)}%`, 
          errorMessage
        );
        setImportErrors(parseResult.errors);
        
        // Log detailed info
        console.error('Receipt parsing failed:', {
          errors: parseResult.errors,
          itemsFound: parseResult.line_items.length,
          confidence: parseResult.confidence_score,
          metadata: parseResult.receipt_metadata
        });
        
        setImporting(false);
        return;
      }
      
      // Display what was found
      const toolItems = parseResult.line_items.filter(item => item.line_type === 'sale');
      const paymentRecords = parseResult.payment_records;
      
      updateProgress('Saving', 'Saving receipt data to database...', 60, 
        `Processing ${toolItems.length} tools, ${paymentRecords.length} payments`);
      
      // Save to database using the new receipt service
      const saveResult = await ReceiptService.saveReceiptToSupabase(
        userId,
        importFile || new File([importText], 'receipt.txt', { type: 'text/plain' }),
        fileUrl || '',
        parseResult
      );
      
      if (!saveResult.success) {
        throw new Error(saveResult.error || 'Failed to save receipt');
      }
      
      // Show success with details
      const vendor = parseResult.receipt_metadata.vendor_name || 'Unknown vendor';
      const total = parseResult.receipt_metadata.total_amount 
        ? `$${parseResult.receipt_metadata.total_amount.toFixed(2)}` 
        : 'amount unknown';
      
      updateProgress('Complete', 'Import completed successfully!', 100, 
        `Imported from ${vendor}: ${toolItems.length} items, total ${total}`,
        `Confidence: ${(parseResult.confidence_score * 100).toFixed(0)}%`
      );
      
      // Reload tools to show new inventory
      await loadTools();
      
      // Get updated stats
      const stats = await ReceiptService.getReceiptStats(userId);
      console.log('Updated inventory stats:', stats);
      
      // Clear form
      setImportText('');
      setImportFile(null);
      setImportErrors([]);
      
      // Close modal after delay  
      setTimeout(() => {
        setShowImportModal(false);
        setShowProgressModal(false);
        setImporting(false);
      }, 3000);
      
    } catch (error) {
      console.error('Import error:', error);
      updateProgress('Error', 'Import failed', 0, '', error instanceof Error ? error.message : 'Unknown error');
      setImportErrors([error instanceof Error ? error.message : 'Failed to import receipt']);
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-body text-center">
          <p>Loading tools...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <h3 className="text font-bold">Professional Toolbox</h3>
      </div>
      
      {/* Receipt Manager Section */}
      {isOwnProfile && (
        <div style={{ 
          padding: '8px',
          background: 'var(--grey-200)',
          borderBottom: '1px solid var(--border-dark)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <button
            className="text-small"
            style={{
              padding: '4px 12px',
              background: 'var(--white)',
              border: '1px outset var(--border-medium)',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 'bold'
            }}
            onClick={() => setShowReceiptManager(!showReceiptManager)}
          >
            {showReceiptManager ? '▼' : '▶'} Receipt Sources
          </button>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Original files control what tools are visible
          </span>
        </div>
      )}
      
      {/* Receipt Manager Table */}
      {showReceiptManager && isOwnProfile && (
        <ReceiptManager 
          userId={userId} 
          onReceiptsChanged={loadTools}
        />
      )}
      
      {/* Excel-style Stats Bar */}
      {stats && stats.toolCount > 0 && (
        <div style={{ 
          padding: '4px 8px',
          background: 'var(--grey-200)',
          borderBottom: '1px solid var(--border-dark)',
          display: 'flex',
          gap: 'var(--space-4)',
          fontSize: '11px',
          fontFamily: 'var(--font-mono)'
        }}>
          <span><strong>Tools:</strong> {stats.toolCount}</span>
          <span><strong>Total Items:</strong> {stats.totalQuantity}</span>
          <span><strong>Value:</strong> ${stats.totalValue.toLocaleString()}</span>
          {isOwnProfile && (
            <>
              <button 
                className="text-small"
                style={{
                  marginLeft: 'auto',
                  padding: '0 8px',
                  background: 'var(--white)',
                  border: '1px outset var(--border-medium)',
                  cursor: 'pointer',
                  fontSize: '11px'
                }}
                onClick={() => setShowImportModal(true)}
              >
                Import Receipt
              </button>
              <button 
                className="text-small"
                style={{
                  marginLeft: '8px',
                  padding: '0 8px',
                  background: 'var(--white)',
                  border: '1px outset var(--border-medium)',
                  cursor: 'pointer',
                  fontSize: '11px',
                  opacity: fetchingImages ? 0.5 : 1
                }}
                onClick={handleFetchToolImages}
                disabled={fetchingImages}
              >
                {fetchingImages ? 'Fetching...' : 'Fetch Images'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Excel-style table */}
      <div style={{ overflowX: 'auto' }}>
        {tools.length === 0 ? (
          <div style={{ padding: 'var(--space-4)', textAlign: 'center' }}>
            <p className="text-small text-muted">
              {isOwnProfile ? 'Import your tool receipts to track inventory' : 'No tools listed'}
            </p>
            {isOwnProfile && !stats?.toolCount && (
              <button 
                className="button button-primary" 
                style={{ marginTop: 'var(--space-3)' }}
                onClick={() => setShowImportModal(true)}
              >
                Import Tool Receipt
              </button>
            )}
          </div>
        ) : (
          <table style={{ 
              width: '100%', 
              borderCollapse: 'collapse',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)'
          }}>
            <thead style={{ 
              background: 'var(--grey-300)',
              borderBottom: '2px solid var(--border-dark)',
              position: 'sticky',
              top: 0,
              zIndex: 10
            }}>
              <tr>
                <th style={{ 
                  padding: '6px 8px',
                  textAlign: 'center',
                  fontWeight: 'bold',
                  borderRight: '1px solid var(--border-medium)',
                  width: '60px'
                }}>IMAGE</th>
                <th style={{ 
                  padding: '6px 8px',
                  textAlign: 'left',
                  fontWeight: 'bold',
                  borderRight: '1px solid var(--border-medium)',
                  width: '60px'
                }}>DATE</th>
                <th style={{ 
                  padding: '6px 8px',
                  textAlign: 'left',
                  fontWeight: 'bold',
                  borderRight: '1px solid var(--border-medium)',
                  width: '80px'
                }}>BRAND</th>
                <th style={{ 
                  padding: '6px 8px',
                  textAlign: 'left',
                  fontWeight: 'bold',
                  borderRight: '1px solid var(--border-medium)'
                }}>DESCRIPTION</th>
                <th style={{ 
                  padding: '6px 8px',
                  textAlign: 'left',
                  fontWeight: 'bold',
                  borderRight: '1px solid var(--border-medium)',
                  width: '100px'
                }}>PART #</th>
                <th style={{ 
                  padding: '6px 8px',
                  textAlign: 'right',
                  fontWeight: 'bold',
                  width: '80px'
                }}>PRICE</th>
              </tr>
            </thead>
            <tbody>
                {tools.map(tool => (
                  <tr key={tool.id} 
                    style={{ 
                      borderBottom: '1px solid var(--border-light)',
                      background: 'var(--white)',
                      cursor: 'pointer'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e3f2fd'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--white)'}
                  >
                    <td style={{ 
                      padding: '4px',
                      borderRight: '1px solid var(--border-light)',
                      textAlign: 'center'
                    }}>
                      <div style={{
                        width: '40px',
                        height: '40px',
                        border: '1px inset var(--border-medium)',
                        background: 'var(--white)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '9px',
                        color: 'var(--text-muted)',
                        padding: '2px'
                      }}>
                        {tool.image_url ? (
                          <img 
                            src={tool.image_url} 
                            alt={tool.description || 'Tool'}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover'
                            }}
                          />
                        ) : (
                          <span style={{ fontSize: '8px', textAlign: 'center', color: 'var(--text-muted)' }}>
                            NO IMG
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ 
                      padding: '4px 8px',
                      borderRight: '1px solid var(--border-light)'
                    }}>
                      {tool.last_purchase_date ? new Date(tool.last_purchase_date).toLocaleDateString('en-US', {month: 'numeric', day: 'numeric', year: '2-digit'}) : '-'}
                    </td>
                    <td style={{ 
                      padding: '4px 8px',
                      borderRight: '1px solid var(--border-light)',
                      position: 'relative'
                    }}
                      onMouseEnter={() => handleBrandHover(tool.brand, tool.id)}
                      onMouseLeave={handleBrandLeave}
                    >
                      {getBrandLogoUrl(tool.brand) ? (
                        <img 
                          src={getBrandLogoUrl(tool.brand)!}
                          alt={tool.brand}
                          style={{
                            height: '20px',
                            width: 'auto',
                            objectFit: 'contain',
                            display: 'block',
                            margin: '0 auto'
                          }}
                        />
                      ) : (
                        <span style={{ fontSize: '11px', fontWeight: 'bold' }}>
                          {tool.brand || 'Unknown'}
                        </span>
                      )}
                      {hoveredBrand === tool.id && (
                        <div style={{
                          position: 'absolute',
                          bottom: '100%',
                          left: '50%',
                          transform: 'translateX(-50%)',
                          padding: '4px 8px',
                          background: 'var(--black)',
                          color: 'var(--white)',
                          fontSize: '11px',
                          whiteSpace: 'nowrap',
                          zIndex: 1000,
                          marginBottom: '4px',
                          border: '1px solid var(--border-dark)'
                        }}>
                          {tool.brand_name}
                        </div>
                      )}
                    </td>
                    <td style={{ 
                      padding: '4px 8px',
                      borderRight: '1px solid var(--border-light)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '300px'
                    }}>
                      {tool.description || 'Unknown Tool'}
                      {tool.serial_numbers && tool.serial_numbers.length > 0 && ` [S/N: ${tool.serial_numbers[0]}]`}
                    </td>
                    <td style={{ 
                      padding: '4px 8px',
                      borderRight: '1px solid var(--border-light)',
                      fontFamily: 'monospace'
                    }}>
                      {tool.part_number || '-'}
                    </td>
                    <td style={{ 
                      padding: '4px 8px',
                      textAlign: 'right',
                      fontWeight: 'bold'
                    }}>
                      ${tool.total_spent?.toFixed(2) || '0.00'}
                    </td>
                  </tr>
                ))}
              </tbody>
          </table>
        )}
      </div>

      {/* Import Modal */}
      {showImportModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '800px' }}>
            <div className="modal-header">
              <h3 className="modal-title">Import Professional Tools Receipt</h3>
            </div>
            
            <div className="modal-body">
              <div className="info-box" style={{ marginBottom: '16px' }}>
                <strong>🤖 AI-Powered Receipt Import</strong>
                <p style={{ margin: '8px 0 0 0', fontSize: '13px' }}>
                  Claude AI will intelligently parse your receipt to extract all tool information.
                  Supports Snap-on, Mac Tools, Matco, and other professional tool suppliers.
                </p>
              </div>
              
              {importErrors.length > 0 && (
                <div className="error-box" style={{ marginBottom: '16px' }}>
                  <strong>Import Errors:</strong>
                  <ul style={{ margin: '8px 0 0 20px', padding: 0 }}>
                    {importErrors.map((error, idx) => (
                      <li key={idx}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* File Upload Section */}
              <div className="form-group" style={{ marginBottom: '20px' }}>
                <label className="form-label" style={{ fontWeight: 'bold', marginBottom: '8px' }}>
                  📎 Option 1: Upload Receipt File
                </label>
                <div 
                  style={{
                    border: dragActive ? '2px dashed var(--primary)' : '2px dashed var(--border-medium)',
                    borderRadius: '0px',
                    padding: '20px',
                    textAlign: 'center',
                    backgroundColor: dragActive ? 'var(--grey-100)' : 'var(--white)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.txt"
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                  />
                  
                  {importFile ? (
                    <div>
                      <p style={{ margin: '0', fontSize: '14px', fontWeight: 'bold' }}>
                        📄 {importFile.name}
                      </p>
                      <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                        {(importFile.size / 1024).toFixed(1)} KB - Click to change file
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p style={{ margin: '0', fontSize: '14px' }}>
                        Drop receipt file here or click to browse
                      </p>
                      <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                        Supports: PDF, PNG, JPG, TXT
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ 
                textAlign: 'center', 
                margin: '20px 0',
                fontSize: '14px',
                color: 'var(--text-muted)'
              }}>
                — OR —
              </div>

              {/* Text Paste Section */}
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 'bold', marginBottom: '8px' }}>
                  Option 2: Paste Receipt Text
                </label>
                <textarea
                  className="form-control"
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="Copy and paste your receipt text here..."
                  style={{
                    height: '200px',
                    fontFamily: 'monospace',
                    fontSize: '12px'
                  }}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setShowImportModal(false);
                  setImportText('');
                  setImportFile(null);
                  setImportErrors([]);
                }}
                disabled={importing}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleImportSnapOnReceipt}
                disabled={importing || (!importFile && !importText.trim())}
              >
                {importing ? 'Processing...' : 'Import Tools'}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Progress Modal */}
      <ImportProgressModal
        isOpen={showProgressModal}
        status={progressStatus}
        onClose={() => {
          setShowProgressModal(false);
          setImporting(false);
        }}
        canClose={!importing || progressStatus.progress === 100 || progressStatus.error !== ''}
      />
    </div>
  );
};

export default ProfessionalToolbox;
