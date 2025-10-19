import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import '../../design-system.css';

interface AIGuardrailsSettingsProps {
  onSave?: () => void;
}

export const AIGuardrailsSettings: React.FC<AIGuardrailsSettingsProps> = ({ onSave }) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<any>({
    personal: {
      profession: 'enthusiast',
      expertise_areas: [],
      typical_work_scenarios: ['personal_project'],
      preferred_filing_structure: 'by_vehicle',
      privacy_settings: {
        blur_license_plates: false,
        encrypt_vins: false,
        redact_customer_info: false
      }
    },
    domain: {
      part_identification: {
        level: 'basic',
        include_part_numbers: false,
        cross_reference_catalogs: false,
        estimate_condition: false
      },
      work_stage_detection: true,
      problem_diagnosis: false,
      progress_tracking: true,
      make_cost_estimates: false,
      suggest_next_steps: false,
      identify_safety_concerns: true
    },
    organizational: {
      filing_triggers: {
        detect_vin_in_image: true,
        match_recent_context: true,
        use_gps_location: false,
        analyze_visible_vehicles: true
      },
      auto_categorization: {
        by_work_type: true,
        by_component: true,
        by_angle: false,
        by_quality: false
      },
      timeline_creation: {
        auto_create_events: true,
        batch_similar_photos: true,
        extract_work_narrative: false
      }
    }
  });

  useEffect(() => {
    loadSettings();
  }, [user]);

  const loadSettings = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('ai_settings')
        .eq('user_id', user.id)
        .single();

      if (error) throw error;

      if (data?.ai_settings) {
        setSettings(data.ai_settings);
      }
    } catch (error) {
      console.error('Error loading AI settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!user) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ ai_settings: settings })
        .eq('user_id', user.id);

      if (error) throw error;

      // Clear AI service cache
      localStorage.setItem('ai_settings_updated', Date.now().toString());
      
      if (onSave) onSave();
      
      alert('AI settings saved successfully!');
    } catch (error) {
      console.error('Error saving AI settings:', error);
      alert('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const updateSetting = (path: string[], value: any) => {
    setSettings((prev: any) => {
      const newSettings = { ...prev };
      let current = newSettings;
      
      for (let i = 0; i < path.length - 1; i++) {
        if (!current[path[i]]) current[path[i]] = {};
        current = current[path[i]];
      }
      
      current[path[path.length - 1]] = value;
      return newSettings;
    });
  };

  if (loading) {
    return <div>Loading AI settings...</div>;
  }

  return (
    <div className="window" style={{ maxWidth: '800px', margin: '0 auto' }}>
      <div className="title-bar">
        <div className="title-bar-text">🤖 AI Photo Organization Settings</div>
      </div>
      
      <div className="window-body" style={{ padding: '16px' }}>
        {/* Personal Context */}
        <fieldset style={{ marginBottom: '16px' }}>
          <legend>Personal Context</legend>
          
          <div className="field-row" style={{ marginBottom: '8px' }}>
            <label htmlFor="profession">Your Role:</label>
            <select
              id="profession"
              value={settings.personal.profession}
              onChange={(e) => updateSetting(['personal', 'profession'], e.target.value)}
            >
              <option value="enthusiast">Enthusiast</option>
              <option value="mechanic">Professional Mechanic</option>
              <option value="dealer">Dealer/Seller</option>
              <option value="collector">Collector</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="field-row" style={{ marginBottom: '8px' }}>
            <label htmlFor="filing">Preferred Organization:</label>
            <select
              id="filing"
              value={settings.personal.preferred_filing_structure}
              onChange={(e) => updateSetting(['personal', 'preferred_filing_structure'], e.target.value)}
            >
              <option value="by_vehicle">By Vehicle</option>
              <option value="by_date">By Date</option>
              <option value="by_type">By Type</option>
              <option value="by_project">By Project</option>
            </select>
          </div>

          <div style={{ marginTop: '12px' }}>
            <label>Privacy Settings:</label>
            <div style={{ marginLeft: '20px', marginTop: '8px' }}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.personal.privacy_settings.blur_license_plates}
                  onChange={(e) => updateSetting(['personal', 'privacy_settings', 'blur_license_plates'], e.target.checked)}
                />
                Blur license plates in photos
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.personal.privacy_settings.encrypt_vins}
                  onChange={(e) => updateSetting(['personal', 'privacy_settings', 'encrypt_vins'], e.target.checked)}
                />
                Encrypt VIN numbers
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.personal.privacy_settings.redact_customer_info}
                  onChange={(e) => updateSetting(['personal', 'privacy_settings', 'redact_customer_info'], e.target.checked)}
                />
                Redact customer information
              </label>
            </div>
          </div>
        </fieldset>

        {/* Domain Intelligence */}
        <fieldset style={{ marginBottom: '16px' }}>
          <legend>AI Intelligence Level</legend>
          
          <div className="field-row" style={{ marginBottom: '8px' }}>
            <label htmlFor="part-id-level">Part Identification:</label>
            <select
              id="part-id-level"
              value={settings.domain.part_identification.level}
              onChange={(e) => updateSetting(['domain', 'part_identification', 'level'], e.target.value)}
            >
              <option value="none">None</option>
              <option value="basic">Basic</option>
              <option value="intermediate">Intermediate</option>
              <option value="expert">Expert</option>
            </select>
          </div>

          <div style={{ marginLeft: '20px', marginTop: '8px' }}>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={settings.domain.part_identification.include_part_numbers}
                onChange={(e) => updateSetting(['domain', 'part_identification', 'include_part_numbers'], e.target.checked)}
              />
              Extract part numbers
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={settings.domain.work_stage_detection}
                onChange={(e) => updateSetting(['domain', 'work_stage_detection'], e.target.checked)}
              />
              Detect work stages (disassembly, repair, etc.)
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={settings.domain.problem_diagnosis}
                onChange={(e) => updateSetting(['domain', 'problem_diagnosis'], e.target.checked)}
              />
              Identify potential problems
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={settings.domain.suggest_next_steps}
                onChange={(e) => updateSetting(['domain', 'suggest_next_steps'], e.target.checked)}
              />
              Suggest next steps
            </label>
          </div>
        </fieldset>

        {/* Auto-Filing Rules */}
        <fieldset style={{ marginBottom: '16px' }}>
          <legend>Automatic Filing Rules</legend>
          
          <div style={{ marginBottom: '12px' }}>
            <label>Auto-detect and file by:</label>
            <div style={{ marginLeft: '20px', marginTop: '8px' }}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.organizational.filing_triggers.detect_vin_in_image}
                  onChange={(e) => updateSetting(['organizational', 'filing_triggers', 'detect_vin_in_image'], e.target.checked)}
                />
                VIN detection in photos
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.organizational.filing_triggers.match_recent_context}
                  onChange={(e) => updateSetting(['organizational', 'filing_triggers', 'match_recent_context'], e.target.checked)}
                />
                Recent vehicle context
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.organizational.filing_triggers.use_gps_location}
                  onChange={(e) => updateSetting(['organizational', 'filing_triggers', 'use_gps_location'], e.target.checked)}
                />
                GPS location matching
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.organizational.filing_triggers.analyze_visible_vehicles}
                  onChange={(e) => updateSetting(['organizational', 'filing_triggers', 'analyze_visible_vehicles'], e.target.checked)}
                />
                Visual vehicle recognition
              </label>
            </div>
          </div>

          <div>
            <label>Auto-categorize photos by:</label>
            <div style={{ marginLeft: '20px', marginTop: '8px' }}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.organizational.auto_categorization.by_work_type}
                  onChange={(e) => updateSetting(['organizational', 'auto_categorization', 'by_work_type'], e.target.checked)}
                />
                Work type (repair, maintenance, etc.)
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.organizational.auto_categorization.by_component}
                  onChange={(e) => updateSetting(['organizational', 'auto_categorization', 'by_component'], e.target.checked)}
                />
                Component (engine, body, interior)
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.organizational.auto_categorization.by_angle}
                  onChange={(e) => updateSetting(['organizational', 'auto_categorization', 'by_angle'], e.target.checked)}
                />
                Photo angle/perspective
              </label>
            </div>
          </div>
        </fieldset>

        {/* Timeline Integration */}
        <fieldset style={{ marginBottom: '16px' }}>
          <legend>Timeline & Events</legend>
          
          <div style={{ marginLeft: '20px' }}>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={settings.organizational.timeline_creation.auto_create_events}
                onChange={(e) => updateSetting(['organizational', 'timeline_creation', 'auto_create_events'], e.target.checked)}
              />
              Automatically create timeline events from photos
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={settings.organizational.timeline_creation.batch_similar_photos}
                onChange={(e) => updateSetting(['organizational', 'timeline_creation', 'batch_similar_photos'], e.target.checked)}
              />
              Group similar photos taken together
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={settings.organizational.timeline_creation.extract_work_narrative}
                onChange={(e) => updateSetting(['organizational', 'timeline_creation', 'extract_work_narrative'], e.target.checked)}
              />
              Extract work narrative from photo sequences
            </label>
          </div>
        </fieldset>

        {/* Save Button */}
        <div style={{ marginTop: '24px', textAlign: 'center' }}>
          <button 
            onClick={saveSettings}
            disabled={saving}
            style={{ minWidth: '120px' }}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          
          <p style={{ 
            fontSize: '10pt', 
            color: '#666', 
            marginTop: '12px' 
          }}>
            These settings control how AI processes and organizes your photos.
            The more specific your settings, the better the AI can help you.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AIGuardrailsSettings;