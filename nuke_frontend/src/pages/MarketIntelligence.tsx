import { useState, useRef, useEffect } from 'react';

interface AnalysisResult {
  success: boolean;
  query: string;
  analysis: any;
  parsed_context: any;
  data_quality: {
    sample_size: number;
    sources: string[];
    indexes_referenced: number;
    methodology: string;
  };
  disclaimer: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  analysis?: any;
  timestamp: Date;
}

export default function MarketIntelligence() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  async function sendQuery() {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/market-intelligence-agent`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ query: input })
        }
      );

      const result: AnalysisResult = await response.json();

      const assistantMessage: Message = {
        role: 'assistant',
        content: result.analysis?.summary || 'Analysis complete',
        analysis: result,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (e: any) {
      const errorMessage: Message = {
        role: 'assistant',
        content: `Error: ${e.message}`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    }

    setLoading(false);
  }

  function toggleSection(id: string) {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  }

  function renderAnalysis(analysis: AnalysisResult, messageId: string) {
    const data = analysis.analysis;
    if (!data) return null;

    return (
      <div className="mt-4 space-y-4">
        {/* Fair Market Value */}
        {data.fair_market_value && (
          <div className="bg-gray-800 rounded-lg p-4">
            <button
              onClick={() => toggleSection(`${messageId}-fmv`)}
              className="w-full text-left flex justify-between items-center"
            >
              <div>
                <div className="text-gray-400 text-sm">Fair Market Value Estimate</div>
                <div className="text-2xl font-mono text-green-400">
                  {formatCurrency(data.fair_market_value.estimate)}
                </div>
              </div>
              <span className="text-gray-500">
                {expandedSections.has(`${messageId}-fmv`) ? '▼' : '▶'}
              </span>
            </button>
            {expandedSections.has(`${messageId}-fmv`) && (
              <div className="mt-4 space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-gray-400">IQR Range (25th-75th pct)</div>
                    <div className="font-mono">
                      {formatCurrency(data.fair_market_value.range.low)} - {formatCurrency(data.fair_market_value.range.high)}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-400">Full Observed Range</div>
                    <div className="font-mono">
                      {formatCurrency(data.fair_market_value.extended_range.low)} - {formatCurrency(data.fair_market_value.extended_range.high)}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Statistics */}
        {data.statistics && (
          <div className="bg-gray-800 rounded-lg p-4">
            <button
              onClick={() => toggleSection(`${messageId}-stats`)}
              className="w-full text-left flex justify-between items-center"
            >
              <div className="text-gray-400 text-sm">
                Statistical Analysis • n={data.statistics.sample_size}
              </div>
              <span className="text-gray-500">
                {expandedSections.has(`${messageId}-stats`) ? '▼' : '▶'}
              </span>
            </button>
            {expandedSections.has(`${messageId}-stats`) && (
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-gray-400">Mean</div>
                  <div className="font-mono">{formatCurrency(data.statistics.mean)}</div>
                </div>
                <div>
                  <div className="text-gray-400">Median</div>
                  <div className="font-mono">{formatCurrency(data.statistics.median)}</div>
                </div>
                <div>
                  <div className="text-gray-400">Std Dev</div>
                  <div className="font-mono">{formatCurrency(data.statistics.standard_deviation)}</div>
                </div>
                <div>
                  <div className="text-gray-400">CV</div>
                  <div className="font-mono">{data.statistics.coefficient_of_variation}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Comparable Sales */}
        {data.comparable_sales && data.comparable_sales.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-4">
            <button
              onClick={() => toggleSection(`${messageId}-comps`)}
              className="w-full text-left flex justify-between items-center"
            >
              <div className="text-gray-400 text-sm">
                Comparable Sales • {data.comparable_sales.length} vehicles
              </div>
              <span className="text-gray-500">
                {expandedSections.has(`${messageId}-comps`) ? '▼' : '▶'}
              </span>
            </button>
            {expandedSections.has(`${messageId}-comps`) && (
              <div className="mt-4 space-y-2">
                {data.comparable_sales.map((comp: any) => (
                  <div key={comp.ref} className="flex justify-between items-center text-sm bg-gray-900 rounded p-2">
                    <div>
                      <span className="text-gray-400 mr-2">#{comp.ref}</span>
                      <span>{comp.vehicle}</span>
                      {comp.url && (
                        <a
                          href={comp.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 text-blue-400 hover:underline"
                        >
                          Source →
                        </a>
                      )}
                    </div>
                    <div className="font-mono">{formatCurrency(comp.sale_price)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Methodology */}
        {data.methodology && (
          <div className="bg-gray-800 rounded-lg p-4">
            <button
              onClick={() => toggleSection(`${messageId}-method`)}
              className="w-full text-left flex justify-between items-center"
            >
              <div className="text-gray-400 text-sm">Methodology & Audit Trail</div>
              <span className="text-gray-500">
                {expandedSections.has(`${messageId}-method`) ? '▼' : '▶'}
              </span>
            </button>
            {expandedSections.has(`${messageId}-method`) && (
              <div className="mt-4 text-sm text-gray-400 space-y-2">
                <p>{data.methodology}</p>
                {analysis.data_quality && (
                  <div className="bg-gray-900 rounded p-3 mt-2">
                    <div className="font-bold text-gray-300 mb-2">Data Quality Report</div>
                    <div>Sample Size: {analysis.data_quality.sample_size}</div>
                    <div>Sources: {analysis.data_quality.sources.join(', ')}</div>
                    <div>Indexes Referenced: {analysis.data_quality.indexes_referenced}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Disclaimer */}
        <div className="text-xs text-gray-500 italic">
          {analysis.disclaimer}
        </div>
      </div>
    );
  }

  const exampleQueries = [
    "What is a 1979 K5 Blazer worth?",
    "Is a 1985 C10 at $15k a good deal?",
    "How is the squarebody market doing?",
    "What indexes are available?"
  ];

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-950">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold">Market Intelligence Agent</h1>
          <p className="text-gray-400 text-sm mt-1">
            Institutional-grade valuation and investment analysis
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto px-4 py-6">
          {messages.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-gray-400 mb-6">
                Ask about valuations, trends, or investments
              </div>
              <div className="flex flex-wrap gap-2 justify-center">
                {exampleQueries.map((query, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(query)}
                    className="px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm"
                  >
                    {query}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((msg, i) => (
                <div key={i} className={msg.role === 'user' ? 'ml-12' : 'mr-12'}>
                  <div className={`rounded-lg p-4 ${msg.role === 'user' ? 'bg-blue-900/50' : 'bg-gray-800'}`}>
                    <div className="text-sm text-gray-400 mb-1">
                      {msg.role === 'user' ? 'You' : 'Market Intelligence Agent'}
                    </div>
                    <div className="text-white">{msg.content}</div>
                    {msg.analysis && renderAnalysis(msg.analysis, `msg-${i}`)}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="mr-12">
                  <div className="bg-gray-800 rounded-lg p-4">
                    <div className="text-sm text-gray-400">Market Intelligence Agent</div>
                    <div className="animate-pulse">Analyzing market data...</div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-gray-800 bg-gray-950">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendQuery()}
              placeholder="Ask about valuations, trends, or investment opportunities..."
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500"
              disabled={loading}
            />
            <button
              onClick={sendQuery}
              disabled={loading || !input.trim()}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
