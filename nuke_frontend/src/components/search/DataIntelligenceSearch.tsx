import { useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface BuildAnalysisResult {
  vehicle_id: string;
  year: number;
  make: string;
  model: string;
  last_activity?: string;
  days_since_activity?: number;
  total_events: number;
  stagnation_risk: number;
  build_health_score: number;
  detected_issues: string[];
  events_last_30_days?: number;
  activity_trend?: string;
  current_build_stage?: string;
  photos_uploaded?: number;
  receipts_uploaded?: number;
  money_spent_documented?: number;
}

interface DataIntelligenceSearchProps {
  onResults: (results: BuildAnalysisResult[], query: string, analysis: string) => void;
}

const DataIntelligenceSearch = ({ onResults }: DataIntelligenceSearchProps) => {
  const [query, setQuery] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const analyzeQuery = (searchQuery: string) => {
    const lowerQuery = searchQuery.toLowerCase();

    return {
      model: extractModel(lowerQuery),
      timeframe: extractTimeframe(lowerQuery),
      activityType: extractActivityType(lowerQuery),
      buildStage: extractBuildStage(lowerQuery),
      documentationType: extractDocumentationType(lowerQuery),
      healthFilter: extractHealthFilter(lowerQuery)
    };
  };

  const extractModel = (query: string): string | null => {
    const modelPatterns = [
      /c10|c-10/i,
      /mustang/i,
      /camaro/i,
      /chevelle/i,
      /nova/i,
      /gto/i,
      /challenger/i,
      /charger/i,
      /impala/i,
      /el camino/i
    ];

    for (const pattern of modelPatterns) {
      const match = query.match(pattern);
      if (match) return match[0].toLowerCase();
    }
    return null;
  };

  const extractTimeframe = (query: string): number => {
    if (/last week|past week|7 days/i.test(query)) return 7;
    if (/last month|past month|30 days/i.test(query)) return 30;
    if (/last 60 days|60 days/i.test(query)) return 60;
    if (/last 90 days|90 days|3 months/i.test(query)) return 90;
    if (/6 months/i.test(query)) return 180;
    if (/year/i.test(query)) return 365;

    // Default based on activity type
    if (/stagnant|stagnating|abandoned/i.test(query)) return 60;
    if (/active|building|progress/i.test(query)) return 30;

    return 60; // Default to 60 days
  };

  const extractActivityType = (query: string): 'stagnant' | 'active' | 'both' => {
    if (/stagnant|stagnating|abandoned|stuck|no activity|inactive/i.test(query)) {
      return 'stagnant';
    }
    if (/active|building|progress|frequent|updates|working on/i.test(query)) {
      return 'active';
    }
    return 'both';
  };

  const extractBuildStage = (query: string): string | null => {
    if (/planning|plans|design/i.test(query)) return 'planning';
    if (/disassembly|teardown|taking apart/i.test(query)) return 'disassembly';
    if (/sourcing|shopping|buying parts|looking for parts/i.test(query)) return 'sourcing';
    if (/assembly|building|putting together/i.test(query)) return 'assembly';
    if (/tuning|dyno|testing/i.test(query)) return 'tuning';
    if (/complete|finished|done/i.test(query)) return 'complete';
    return null;
  };

  const extractDocumentationType = (query: string) => {
    return {
      photos: /photos|pictures|images|documentation/i.test(query),
      receipts: /receipts|spending|costs|money|purchases/i.test(query),
      parts: /parts|components|hardware/i.test(query),
      tools: /tools|equipment/i.test(query)
    };
  };

  const extractHealthFilter = (query: string): 'high' | 'medium' | 'low' | 'all' => {
    if (/well documented|high quality|detailed|thorough/i.test(query)) return 'high';
    if (/poor documentation|low quality|incomplete/i.test(query)) return 'low';
    return 'all';
  };

  const executeDataAnalysis = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) return;

    setIsAnalyzing(true);
    try {
      const analysis = analyzeQuery(searchQuery);
      console.log('Query analysis:', analysis);

      let results: BuildAnalysisResult[] = [];
      let analysisText = '';

      if (analysis.activityType === 'stagnant' || analysis.activityType === 'both') {
        // Find stagnant builds based on actual data patterns
        const { data: stagnantData, error: stagnantError } = await supabase
          .rpc('find_stagnant_builds', {
            model_filter: analysis.model,
            days_inactive: analysis.timeframe,
            min_events_required: 1
          });

        if (!stagnantError && stagnantData) {
          results.push(...stagnantData);
        }
      }

      if (analysis.activityType === 'active' || analysis.activityType === 'both') {
        // Find active builds with frequent updates
        const { data: activeData, error: activeError } = await supabase
          .rpc('find_active_builds', {
            model_filter: analysis.model,
            min_health_score: analysis.healthFilter === 'high' ? 80 :
                            analysis.healthFilter === 'medium' ? 50 : 20
          });

        if (!activeError && activeData) {
          results.push(...activeData);
        }
      }

      // If no specific function matches, do general build pattern analysis
      if (results.length === 0) {
        const { data: vehicleData, error: vehicleError } = await supabase
          .from('vehicles')
          .select(`
            id,
            year,
            make,
            model,
            build_activity_patterns(
              total_events,
              events_last_30_days,
              photos_uploaded,
              receipts_uploaded,
              money_spent_documented,
              activity_classification,
              last_meaningful_activity,
              stagnation_risk,
              build_health_score,
              current_build_stage,
              activity_trend,
              detected_issues
            )
          `)
          .eq(analysis.model ? 'model' : 'id', analysis.model ? analysis.model : '00000000-0000-0000-0000-000000000000')
          .order('created_at', { ascending: false })
          .limit(20);

        if (!vehicleError && vehicleData) {
          results = vehicleData.map((vehicle: any) => {
            const pattern = vehicle.build_activity_patterns?.[0];
            return {
              vehicle_id: vehicle.id,
              year: vehicle.year,
              make: vehicle.make,
              model: vehicle.model,
              total_events: pattern?.total_events || 0,
              events_last_30_days: pattern?.events_last_30_days || 0,
              photos_uploaded: pattern?.photos_uploaded || 0,
              receipts_uploaded: pattern?.receipts_uploaded || 0,
              money_spent_documented: pattern?.money_spent_documented || 0,
              stagnation_risk: pattern?.stagnation_risk || 0,
              build_health_score: pattern?.build_health_score || 0,
              last_activity: pattern?.last_meaningful_activity,
              current_build_stage: pattern?.current_build_stage || 'unknown',
              activity_trend: pattern?.activity_trend || 'unknown',
              detected_issues: pattern?.detected_issues || []
            };
          });
        }
      }

      // Generate analysis text based on actual data findings
      analysisText = generateDataAnalysis(searchQuery, results, analysis);

      onResults(results, searchQuery, analysisText);

    } catch (error) {
      console.error('Data analysis error:', error);
      onResults([], searchQuery, 'Error analyzing build data. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  }, [onResults]);

  const generateDataAnalysis = (
    query: string,
    results: BuildAnalysisResult[],
    analysis: any
  ): string => {
    if (results.length === 0) {
      return `No builds found matching "${query}". This could mean no ${analysis.model || 'vehicles'} meet the specified activity criteria.`;
    }

    const stagnantBuilds = results.filter(r => r.stagnation_risk > 0.6);
    const activeBuilds = results.filter(r => r.build_health_score > 60 && r.events_last_30_days > 0);
    const totalEvents = results.reduce((sum, r) => sum + r.total_events, 0);
    const avgHealthScore = results.reduce((sum, r) => sum + r.build_health_score, 0) / results.length;
    const totalSpent = results.reduce((sum, r) => sum + (r.money_spent_documented || 0), 0);

    let analysisText = `Found ${results.length} ${analysis.model?.toUpperCase() || 'vehicle'} builds. `;

    if (stagnantBuilds.length > 0) {
      analysisText += `${stagnantBuilds.length} builds show stagnation patterns (no meaningful activity in ${analysis.timeframe}+ days). `;
    }

    if (activeBuilds.length > 0) {
      analysisText += `${activeBuilds.length} builds show active development with regular updates. `;
    }

    analysisText += `Collective data: ${totalEvents} total timeline events, `;
    analysisText += `${Math.round(avgHealthScore)}% average build health score`;

    if (totalSpent > 0) {
      analysisText += `, $${totalSpent.toLocaleString()} documented spending`;
    }

    // Add insights based on patterns
    const highRiskBuilds = results.filter(r => r.stagnation_risk > 0.8);
    if (highRiskBuilds.length > 0) {
      analysisText += `. WARNING: ${highRiskBuilds.length} builds at high risk of abandonment.`;
    }

    const wellDocumented = results.filter(r => r.photos_uploaded > 10 && r.receipts_uploaded > 2);
    if (wellDocumented.length > 0) {
      analysisText += ` ${wellDocumented.length} builds have thorough documentation.`;
    }

    return analysisText;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      executeDataAnalysis(query);
    }
  };

  const exampleQueries = [
    "Find C10s that have had no activity in the last 90 days",
    "Show me C10s with frequent logging and updates",
    "Which C10s have receipts uploaded but no recent progress",
    "Find stagnating builds with good photo documentation",
    "Show active Mustang builds with parts purchases this month",
    "Which builds have the most timeline events but lowest progress"
  ];

  return (
    <div className="data-intelligence-search">
      <form onSubmit={handleSubmit}>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            className="input"
            placeholder="Analyze build patterns with data... 'Find C10s with no activity in 90 days'"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              fontSize: '16px',
              padding: '12px 60px 12px 16px',
              background: 'white',
              border: '2px solid #3b82f6',
              borderRadius: '12px',
              boxShadow: isAnalyzing ? '0 0 20px rgba(59, 130, 246, 0.3)' : '0 2px 8px rgba(0,0,0,0.1)',
              transition: 'all 0.2s ease'
            }}
          />

          <button
            type="submit"
            disabled={isAnalyzing || !query.trim()}
            className="button button-primary"
            style={{
              position: 'absolute',
              right: '8px',
              top: '50%',
              transform: 'translateY(-50%)',
              padding: '8px 12px',
              fontSize: '14px',
              minWidth: '50px'
            }}
          >
            {isAnalyzing ? 'ANALYZING' : 'SEARCH'}
          </button>
        </div>
      </form>

      {/* Example Queries */}
      <div style={{ marginTop: '12px' }}>
        <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
          Example data intelligence queries:
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {exampleQueries.slice(0, 3).map((example, index) => (
            <button
              key={index}
              onClick={() => {
                setQuery(example);
                executeDataAnalysis(example);
              }}
              className="button button-secondary"
              style={{
                fontSize: '11px',
                padding: '4px 8px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '200px'
              }}
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      {/* Status Indicator */}
      {isAnalyzing && (
        <div style={{
          marginTop: '16px',
          padding: '12px',
          background: '#f0f9ff',
          border: '1px solid #bae6fd',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <div className="spinner" style={{ width: '16px', height: '16px' }}></div>
          <span style={{ fontSize: '14px', color: '#0369a1' }}>
            Analyzing build activity patterns, documentation completeness, and user contribution frequency...
          </span>
        </div>
      )}
    </div>
  );
};

export default DataIntelligenceSearch;