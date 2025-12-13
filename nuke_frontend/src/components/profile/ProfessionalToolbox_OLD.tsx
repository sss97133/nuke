import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import type { ToolInventoryService } from '../../services/toolInventoryService';

interface UserTool {
  id: string;
  catalog_id: string;
  transaction_number?: string;
  transaction_date?: string;
  purchase_price: number;
  serial_number?: string;
  condition: string;
  verified_by_operator: boolean;
  tool_catalog?: {
    part_number: string;
    description: string;
    category?: string;
    product_url?: string;
    list_price?: number;
    tool_brands?: {
      name: string;
    };
  };
}

interface ProfessionalToolboxProps {
  userId: string;
  isOwnProfile: boolean;
}

const ProfessionalToolbox: React.FC<ProfessionalToolboxProps> = ({ userId, isOwnProfile }) => {
  const [tools, setTools] = useState<UserTool[]>([]);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [dragActive, setDragActive] = useState(false);

  const loadProfessionalData = async () => {
    try {
      setLoading(true);

      // Load tools from the actual tables we created
      const { data: toolsData, error } = await supabase
        .from('user_tools')
        .select(`
          *,
          tool_catalog (
            part_number,
            description,
            category,
            product_url,
            list_price,
            tool_brands (
              name
            )
          )
        `)
        .eq('user_id', userId);

      if (error) {
        console.error('Error loading tools:', error);
        setTools([]);
      } else {
        setTools(toolsData || []);
      }

      // Calculate stats
      const totalValue = toolsData?.reduce((sum, tool) => sum + (tool.purchase_price || 0), 0) || 0;
      const verifiedCount = toolsData?.filter(t => t.verified_by_operator).length || 0;
      
      setStats({
        totalValue,
        toolCount: toolsData?.length || 0,
        verifiedCount
      });

    } catch (error) {
      console.error('Error loading professional data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfessionalData();
  }, [userId]);

  const formatPrice = (cents?: number) => {
    if (!cents) return 'N/A';
    return `$${(cents / 100).toLocaleString()}`;
  };

  const getCredibilityBadge = (rating: string) => {
    const badges = {
      'master': { text: 'Master Professional', color: '#8b5cf6', icon: '👑' },
      'expert': { text: 'Expert', color: '#3b82f6', icon: '⭐' },
      'verified': { text: 'Verified Professional', color: '#059669', icon: '✓' },
      'basic': { text: 'Basic Verified', color: '#d97706', icon: '○' },
      'unverified': { text: 'Unverified', color: '#6b7280', icon: '?' }
    };
    
    const badge = badges[rating as keyof typeof badges] || badges.unverified;
    
    return (
      <span 
        className="badge"
        style={{ 
          backgroundColor: badge.color, 
          color: 'white',
          padding: '4px 8px',
          borderRadius: '12px',
          fontSize: '12px',
          fontWeight: '600'
        }}
      >
        {badge.icon} {badge.text}
      </span>
    );
  };

  const getProficiencyText = (level: number) => {
    const levels = ['', 'Beginner', 'Intermediate', 'Advanced', 'Expert', 'Master'];
    return levels[level] || 'Unknown';
  };

  const handleImportSnapOnReceipt = async () => {
    if (!importFile && !importText.trim()) return;
    
    setImporting(true);
    try {
      let receiptText = importText;
      
      // If we have a PDF file, extract text from it
      if (importFile) {
        // Use Supabase Edge Function to extract PDF text
        const formData = new FormData();
        formData.append('file', importFile);
        
        try {
          // Try to call the edge function
          const { data, error } = await supabase.functions.invoke('extract-pdf-text', {
            body: formData,
          });
          
          if (error) throw error;
          if (data?.text) {
            receiptText = data.text;
          } else {
            throw new Error('No text extracted from PDF');
          }
        } catch (pdfError) {
          // Fallback: Ask user to copy/paste
          alert('PDF processing failed. Please:\n1. Open the PDF\n2. Select all text (Cmd+A)\n3. Copy (Cmd+C)\n4. Use the "paste text directly" option');
          setImporting(false);
          return;
        }
      }
      
      // Parse the receipt text
      const parsedLines = ToolInventoryService.parseSnapOnReceipt(receiptText);
      
      if (parsedLines.length === 0) {
        alert('No valid tools found in the receipt. Please check the format.');
        return;
      }
      
      // Import the tools
      await ToolInventoryService.importToolsFromReceipt(userId, parsedLines);
      
      // Reload the tools list
      await loadProfessionalData();
      
      // Close the modal
      setShowImportModal(false);
      setImportText('');
      setImportFile(null);
      
      alert(`Successfully imported ${parsedLines.length} tools!`);
    } catch (error) {
      console.error('Import failed:', error);
      alert('Failed to import tools. Please try again.');
    } finally {
      setImporting(false);
    }
  };
  if (loading) {
    return (
      <div className="card">
        <div className="card-body text-center">
          <div className="loading-spinner"></div>
          <p>Loading professional profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-body">
        {/* Professional Score Header */}
        {professionalScore && (
          <div style={{ 
            marginBottom: '24px', 
            padding: '16px', 
            backgroundColor: '#f8f9fa', 
            borderRadius: '8px',
            border: '1px solid #e5e5e5'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 className="text font-bold">Professional Credibility</h3>
              {getCredibilityBadge(professionalScore.credibility_rating)}
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px' }}>
              <div>
                <div className="text-small" style={{ color: '#6b7280' }}>Total Score</div>
                <div className="text font-bold">{professionalScore.total_professional_score}/600</div>
              </div>
              <div>
                <div className="text-small" style={{ color: '#6b7280' }}>Tool Investment</div>
                <div className="text font-bold">{formatPrice(professionalScore.verified_tool_value_cents)}</div>
              </div>
              <div>
                <div className="text-small" style={{ color: '#6b7280' }}>Verified Tools</div>
                <div className="text font-bold">{tools.filter(t => t.verification_status === 'verified').length}</div>
              </div>
              <div>
                <div className="text-small" style={{ color: '#6b7280' }}>Verified Skills</div>
                <div className="text font-bold">{skills.filter(s => s.is_verified).length}</div>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '16px', borderBottom: '1px solid #e5e5e5', marginBottom: '16px' }}>
          {[
            { key: 'tools', label: `Tools (${tools.length})` },
            { key: 'skills', label: `Skills (${skills.length})` },
            { key: 'certifications', label: `Certifications (${certifications.length})` }
          ].map(tab => (
            <button
              key={tab.key}
              className={`text-small ${activeTab === tab.key ? 'font-bold' : ''}`}
              style={{
                padding: '8px 0',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === tab.key ? '2px solid #3b82f6' : '2px solid transparent',
                color: activeTab === tab.key ? '#3b82f6' : '#666',
                cursor: 'pointer'
              }}
              onClick={() => setActiveTab(tab.key as any)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'tools' && (
          <div>
            {tools.length === 0 ? (
              <div className="text-center" style={{ padding: '32px' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔧</div>
                <h3 className="text font-bold">No Tools Listed</h3>
                <p className="text-small text-muted">
                  {isOwnProfile ? 'Add your professional tools to build credibility' : 'No tools have been added yet'}
                </p>
                {isOwnProfile && (
                  <>
                    <button 
                      className="button button-primary" 
                      style={{ marginTop: '16px' }}
                      onClick={() => setShowImportModal(true)}
                    >
                      Add Tools
                    </button>
                    <button 
                      className="button button-secondary" 
                      style={{ marginTop: '8px', marginLeft: '8px' }}
                      onClick={() => setShowImportModal(true)}
                    >
                      Import Snap-on Receipt
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {tools.map(tool => (
                  <div key={tool.id} style={{ 
                    padding: '12px', 
                    border: '1px solid #e5e5e5', 
                    borderRadius: '6px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <div>
                      <div className="text font-bold">{tool.name}</div>
                      <div className="text-small text-muted">
                        {tool.supplier_name} • {tool.category_name}
                        {tool.model_number && ` • Model: ${tool.model_number}`}
                      </div>
                      {tool.purchase_date && (
                        <div className="text-small text-muted">
                          Purchased: {new Date(tool.purchase_date).toLocaleDateString()}
                          {tool.purchase_price_cents && ` • ${formatPrice(tool.purchase_price_cents)}`}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {tool.condition && (
                        <span className="text-small" style={{ 
                          padding: '2px 6px', 
                          backgroundColor: '#f3f4f6', 
                          borderRadius: '4px' 
                        }}>
                          {tool.condition}
                        </span>
                      )}
                      <span className={`text-small ${
                        tool.verification_status === 'verified' ? 'text-success' : 
                        tool.verification_status === 'pending' ? 'text-warning' : 'text-muted'
                      }`}>
                        {tool.verification_status === 'verified' ? '✓ Verified' :
                         tool.verification_status === 'pending' ? 'Pending' : 'Unverified'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'skills' && (
          <div>
            {skills.length === 0 ? (
              <div className="text-center" style={{ padding: '32px' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎯</div>
                <h3 className="text font-bold">No Skills Listed</h3>
                <p className="text-small text-muted">
                  {isOwnProfile ? 'Add your professional skills and experience' : 'No skills have been added yet'}
                </p>
                {isOwnProfile && (
                  <button className="button button-primary" style={{ marginTop: '16px' }}>
                    Add Skills
                  </button>
                )}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {skills.map(skill => (
                  <div key={skill.id} style={{ 
                    padding: '12px', 
                    border: '1px solid #e5e5e5', 
                    borderRadius: '6px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <div>
                      <div className="text font-bold">{skill.skill_name}</div>
                      <div className="text-small text-muted">
                        {skill.category_name} • {getProficiencyText(skill.proficiency_level)}
                        {skill.years_experience && ` • ${skill.years_experience} years`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ display: 'flex', gap: '2px' }}>
                        {[1, 2, 3, 4, 5].map(level => (
                          <div
                            key={level}
                            style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              backgroundColor: level <= skill.proficiency_level ? '#3b82f6' : '#e5e5e5'
                            }}
                          />
                        ))}
                      </div>
                      <span className={`text-small ${skill.is_verified ? 'text-success' : 'text-muted'}`}>
                        {skill.is_verified ? '✓ Verified' : '○ Self-reported'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'certifications' && (
          <div>
            {certifications.length === 0 ? (
              <div className="text-center" style={{ padding: '32px' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏆</div>
                <h3 className="text font-bold">No Certifications Listed</h3>
                <p className="text-small text-muted">
                  {isOwnProfile ? 'Add your professional certifications' : 'No certifications have been added yet'}
                </p>
                {isOwnProfile && (
                  <button className="button button-primary" style={{ marginTop: '16px' }}>
                    Add Certifications
                  </button>
                )}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {certifications.map(cert => (
                  <div key={cert.id} style={{ 
                    padding: '12px', 
                    border: '1px solid #e5e5e5', 
                    borderRadius: '6px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <div>
                      <div className="text font-bold">{cert.certification_name}</div>
                      <div className="text-small text-muted">
                        {cert.issuing_organization}
                        {cert.certification_number && ` • #${cert.certification_number}`}
                      </div>
                      {cert.issue_date && (
                        <div className="text-small text-muted">
                          Issued: {new Date(cert.issue_date).toLocaleDateString()}
                          {cert.expiration_date && ` • Expires: ${new Date(cert.expiration_date).toLocaleDateString()}`}
                        </div>
                      )}
                    </div>
                    <span className={`text-small ${cert.is_verified ? 'text-success' : 'text-muted'}`}>
                      {cert.is_verified ? '✓ Verified' : '○ Unverified'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Integration CTA for own profile */}
        {isOwnProfile && (
          <div style={{ 
            marginTop: '24px', 
            padding: '16px', 
            backgroundColor: '#fef3c7', 
            borderRadius: '8px',
            border: '1px solid #f59e0b'
          }}>
            <h4 className="text font-bold" style={{ marginBottom: '8px' }}>🔗 Connect Your Tool Suppliers</h4>
            <p className="text-small" style={{ marginBottom: '12px' }}>
              Connect directly to your Snap-on, Mac Tools, or other supplier accounts to automatically verify your tool ownership and boost your professional credibility.
            </p>
            <button className="button button-primary" onClick={() => setShowImportModal(true)}>
              Import Snap-on Receipt
            </button>
          </div>
        )}
      </div>

      {/* Import Modal */}
      {showImportModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            padding: '24px',
            maxWidth: '800px',
            width: '90%',
            maxHeight: '90vh',
            overflow: 'auto'
          }}>
            <h2 style={{ marginBottom: '16px' }}>Import Snap-on Receipt</h2>
            
            <div style={{ marginBottom: '24px' }}>
              <p style={{ marginBottom: '8px', color: '#666' }}>
                Upload your Snap-on receipt PDF or drag & drop it below.
                The system will automatically extract and catalog your tools.
              </p>
            </div>

            {/* PDF Upload Area */}
            <div
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragActive(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragActive(false);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragActive(false);
                
                const files = Array.from(e.dataTransfer.files);
                const pdfFile = files.find(f => f.type === 'application/pdf');
                if (pdfFile) {
                  setImportFile(pdfFile);
                }
              }}
              style={{
                border: `2px dashed ${dragActive ? '#3b82f6' : '#cbd5e1'}`,
                borderRadius: '8px',
                padding: '48px',
                textAlign: 'center',
                backgroundColor: dragActive ? '#eff6ff' : '#f8fafc',
                cursor: 'pointer',
                marginBottom: '24px',
                transition: 'all 0.2s'
              }}
              onClick={() => document.getElementById('pdf-upload')?.click()}
            >
              <input
                id="pdf-upload"
                type="file"
                accept="application/pdf"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file && file.type === 'application/pdf') {
                    setImportFile(file);
                  }
                }}
              />
              
              {importFile ? (
                <div>
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>📄</div>
                  <p style={{ fontWeight: 'bold', marginBottom: '8px' }}>{importFile.name}</p>
                  <p style={{ fontSize: '14px', color: '#666' }}>
                    {(importFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  <button
                    className="button button-secondary"
                    style={{ marginTop: '16px' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setImportFile(null);
                    }}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>📤</div>
                  <p style={{ fontWeight: 'bold', marginBottom: '8px' }}>
                    Drop your Snap-on receipt PDF here
                  </p>
                  <p style={{ fontSize: '14px', color: '#666' }}>
                    or click to browse
                  </p>
                </div>
              )}
            </div>

            {/* Alternative: Text Input */}
            <details style={{ marginBottom: '16px' }}>
              <summary style={{ cursor: 'pointer', color: '#666', marginBottom: '8px' }}>
                Or paste text directly (if you have it)
              </summary>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="Paste your Snap-on receipt text here..."
                style={{
                  width: '100%',
                  height: '200px',
                  padding: '12px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  marginTop: '8px'
                }}
              />
            </details>

            <div style={{ 
              display: 'flex', 
              justifyContent: 'flex-end', 
              gap: '8px',
              marginTop: '16px' 
            }}>
              <button
                className="button button-secondary"
                onClick={() => {
                  setShowImportModal(false);
                  setImportText('');
                  setImportFile(null);
                }}
                disabled={importing}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                onClick={handleImportSnapOnReceipt}
                disabled={importing || (!importFile && !importText.trim())}
              >
                {importing ? 'Processing...' : 'Import Tools'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProfessionalToolbox;
