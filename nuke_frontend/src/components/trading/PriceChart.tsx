/**
 * Price Chart Component
 *
 * Professional candlestick chart with:
 * - OHLC candlesticks
 * - Volume bars
 * - Moving averages (optional)
 * - RSI indicator (optional)
 *
 * Uses lightweight-charts library
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, HistogramData, LineData } from 'lightweight-charts';
import { supabase } from '../../lib/supabase';

interface PriceChartProps {
  offeringId: string;
  height?: number;
  showVolume?: boolean;
  showMA?: boolean;
  maPeriods?: number[];
  showRSI?: boolean;
  rsiPeriod?: number;
  theme?: 'light' | 'dark';
}

interface CandleData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const PriceChart: React.FC<PriceChartProps> = ({
  offeringId,
  height = 400,
  showVolume = true,
  showMA = true,
  maPeriods = [20, 50],
  showRSI = false,
  rsiPeriod = 14,
  theme = 'light',
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const maSeriesRefs = useRef<ISeriesApi<'Line'>[]>([]);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  const [data, setData] = useState<CandleData[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<{ value: number; percent: number } | null>(null);

  const chartColors = {
    light: {
      background: '#ffffff',
      text: '#333333',
      grid: '#f0f0f0',
      upColor: '#10b981',
      downColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
      volumeUp: 'rgba(16, 185, 129, 0.5)',
      volumeDown: 'rgba(239, 68, 68, 0.5)',
      ma1: '#2563eb',
      ma2: '#f59e0b',
      rsi: '#8b5cf6',
    },
    dark: {
      background: '#1a1a1a',
      text: '#d1d5db',
      grid: '#333333',
      upColor: '#22c55e',
      downColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      volumeUp: 'rgba(34, 197, 94, 0.5)',
      volumeDown: 'rgba(239, 68, 68, 0.5)',
      ma1: '#3b82f6',
      ma2: '#fbbf24',
      rsi: '#a78bfa',
    },
  };

  const colors = chartColors[theme];

  // Calculate Simple Moving Average
  const calculateSMA = useCallback((data: CandleData[], period: number): LineData[] => {
    const result: LineData[] = [];
    for (let i = period - 1; i < data.length; i++) {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += data[i - j].close;
      }
      result.push({
        time: data[i].time,
        value: sum / period,
      });
    }
    return result;
  }, []);

  // Calculate RSI
  const calculateRSI = useCallback((data: CandleData[], period: number): LineData[] => {
    const result: LineData[] = [];
    const gains: number[] = [];
    const losses: number[] = [];

    for (let i = 1; i < data.length; i++) {
      const change = data[i].close - data[i - 1].close;
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }

    for (let i = period; i < gains.length; i++) {
      const avgGain = gains.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
      const avgLoss = losses.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      const rsi = 100 - (100 / (1 + rs));

      result.push({
        time: data[i + 1].time, // +1 because we started gains from index 1
        value: rsi,
      });
    }

    return result;
  }, []);

  // Fetch historical data
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      // Fetch from market_snapshots (hourly OHLC)
      const { data: snapshots, error } = await supabase
        .from('market_snapshots')
        .select('*')
        .eq('offering_id', offeringId)
        .order('snapshot_hour', { ascending: true })
        .limit(500);

      if (error) throw error;

      if (snapshots && snapshots.length > 0) {
        const candles: CandleData[] = snapshots.map(s => ({
          time: s.snapshot_hour.split('T')[0], // Date only for daily candles
          open: s.open_price || s.close_price,
          high: s.high_price || s.close_price,
          low: s.low_price || s.close_price,
          close: s.close_price,
          volume: s.volume_shares || 0,
        }));

        // Aggregate by day if needed
        const dailyCandles = aggregateDaily(candles);
        setData(dailyCandles);

        // Calculate price change
        if (dailyCandles.length >= 2) {
          const current = dailyCandles[dailyCandles.length - 1].close;
          const previous = dailyCandles[dailyCandles.length - 2].close;
          setLastPrice(current);
          setPriceChange({
            value: current - previous,
            percent: ((current - previous) / previous) * 100,
          });
        } else if (dailyCandles.length === 1) {
          setLastPrice(dailyCandles[0].close);
        }
      } else {
        // No snapshot data - try to get from trades
        const { data: trades } = await supabase
          .from('market_trades')
          .select('price_per_share, shares_traded, executed_at')
          .eq('offering_id', offeringId)
          .order('executed_at', { ascending: true });

        if (trades && trades.length > 0) {
          // Build candles from trades
          const tradeCandles = buildCandlesFromTrades(trades);
          setData(tradeCandles);
          setLastPrice(trades[trades.length - 1].price_per_share);
        }
      }
    } catch (err) {
      console.error('Failed to fetch chart data:', err);
    } finally {
      setLoading(false);
    }
  }, [offeringId]);

  // Aggregate candles to daily
  const aggregateDaily = (candles: CandleData[]): CandleData[] => {
    const dailyMap = new Map<string, CandleData>();

    candles.forEach(c => {
      const date = c.time;
      const existing = dailyMap.get(date);
      if (!existing) {
        dailyMap.set(date, { ...c });
      } else {
        existing.high = Math.max(existing.high, c.high);
        existing.low = Math.min(existing.low, c.low);
        existing.close = c.close;
        existing.volume += c.volume;
      }
    });

    return Array.from(dailyMap.values()).sort((a, b) => a.time.localeCompare(b.time));
  };

  // Build candles from trades
  const buildCandlesFromTrades = (trades: any[]): CandleData[] => {
    const dailyMap = new Map<string, CandleData>();

    trades.forEach(t => {
      const date = t.executed_at.split('T')[0];
      const price = t.price_per_share;
      const volume = t.shares_traded;
      const existing = dailyMap.get(date);

      if (!existing) {
        dailyMap.set(date, {
          time: date,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: volume,
        });
      } else {
        existing.high = Math.max(existing.high, price);
        existing.low = Math.min(existing.low, price);
        existing.close = price;
        existing.volume += volume;
      }
    });

    return Array.from(dailyMap.values()).sort((a, b) => a.time.localeCompare(b.time));
  };

  // Initialize chart
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Create/update chart
  useEffect(() => {
    if (!chartContainerRef.current || data.length === 0) return;

    // Calculate RSI chart height
    const rsiHeight = showRSI ? 100 : 0;
    const mainChartHeight = height - rsiHeight - (showRSI ? 10 : 0);

    // Create main chart
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: mainChartHeight,
      layout: {
        background: { color: colors.background },
        textColor: colors.text,
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: colors.grid,
      },
      timeScale: {
        borderColor: colors.grid,
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    // Add candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: colors.upColor,
      downColor: colors.downColor,
      wickUpColor: colors.wickUpColor,
      wickDownColor: colors.wickDownColor,
      borderVisible: false,
    });

    candleSeries.setData(
      data.map(d => ({
        time: d.time,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      } as CandlestickData))
    );
    candleSeriesRef.current = candleSeries;

    // Add volume series
    if (showVolume) {
      const volumeSeries = chart.addHistogramSeries({
        color: colors.volumeUp,
        priceFormat: {
          type: 'volume',
        },
        priceScaleId: 'volume',
      });

      chart.priceScale('volume').applyOptions({
        scaleMargins: {
          top: 0.8,
          bottom: 0,
        },
      });

      volumeSeries.setData(
        data.map(d => ({
          time: d.time,
          value: d.volume,
          color: d.close >= d.open ? colors.volumeUp : colors.volumeDown,
        } as HistogramData))
      );
      volumeSeriesRef.current = volumeSeries;
    }

    // Add moving averages
    if (showMA && data.length >= Math.max(...maPeriods)) {
      const maColors = [colors.ma1, colors.ma2];
      maPeriods.forEach((period, index) => {
        const maSeries = chart.addLineSeries({
          color: maColors[index] || colors.ma1,
          lineWidth: 1,
          priceLineVisible: false,
        });
        maSeries.setData(calculateSMA(data, period));
        maSeriesRefs.current.push(maSeries);
      });
    }

    // Fit content
    chart.timeScale().fitContent();

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      maSeriesRefs.current = [];
    };
  }, [data, height, showVolume, showMA, maPeriods, showRSI, colors, calculateSMA]);

  return (
    <div
      style={{
        background: colors.background,
        border: '2px solid #bdbdbd',
        borderRadius: '4px',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          borderBottom: '1px solid #e5e7eb',
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: '10pt', fontWeight: 'bold', color: colors.text }}>
            Price Chart
          </h3>
          {lastPrice !== null && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '4px' }}>
              <span style={{ fontSize: '16pt', fontWeight: 'bold', color: colors.text }}>
                ${lastPrice.toFixed(2)}
              </span>
              {priceChange && (
                <span
                  style={{
                    fontSize: '10pt',
                    fontWeight: 600,
                    color: priceChange.value >= 0 ? colors.upColor : colors.downColor,
                  }}
                >
                  {priceChange.value >= 0 ? '+' : ''}${priceChange.value.toFixed(2)}
                  ({priceChange.percent >= 0 ? '+' : ''}{priceChange.percent.toFixed(2)}%)
                </span>
              )}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {showMA && maPeriods.map((period, index) => (
            <span
              key={period}
              style={{
                fontSize: '8pt',
                padding: '2px 6px',
                borderRadius: '4px',
                background: [colors.ma1, colors.ma2][index] || colors.ma1,
                color: 'white',
              }}
            >
              MA{period}
            </span>
          ))}
        </div>
      </div>

      {/* Chart Container */}
      {loading ? (
        <div
          style={{
            height: height,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: colors.text,
          }}
        >
          Loading chart data...
        </div>
      ) : data.length === 0 ? (
        <div
          style={{
            height: height,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: colors.text,
          }}
        >
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📈</div>
          <div>No trading data available</div>
          <div style={{ fontSize: '9pt', color: '#6b7280', marginTop: '4px' }}>
            Chart will populate once trades occur
          </div>
        </div>
      ) : (
        <div ref={chartContainerRef} />
      )}
    </div>
  );
};

export default PriceChart;
