/**
 * Price Carousel - Windows 95 Style
 * Swipeable carousel showing: Share Price / Total Value / Bets / Auction Vote
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { BettingService } from '../../services/bettingService';
import { AuctionVotingService } from '../../services/auctionVotingService';
import { BuyCreditsButton } from '../credits/BuyCreditsButton';

interface PriceCarouselProps {
  vehicle: any;
  stats: any;
  session?: any;
}

export const PriceCarousel: React.FC<PriceCarouselProps> = ({ vehicle, stats, session }) => {
  const [currentScreen, setCurrentScreen] = useState(0);
  const [touchStart, setTouchStart] = useState(0);

  const screens = 4; // AuctionVoteScreen now properly handles session
  
  // Calculate market data
  const baseValue = vehicle.current_value || vehicle.purchase_price || 25000;
  const sharePrice = baseValue / 1000;
  const purchasePrice = vehicle.purchase_price || baseValue * 0.85;
  const gain = baseValue - purchasePrice;
  const gainPercent = purchasePrice > 0 ? (gain / purchasePrice) * 100 : 0;

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.touches[0].clientX);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const touchEnd = e.changedTouches[0].clientX;
    const distance = touchStart - touchEnd;
    const minSwipe = 50;

    if (Math.abs(distance) < minSwipe) return;

    if (distance > 0 && currentScreen < screens - 1) {
      // Swipe left - next screen
      setCurrentScreen(currentScreen + 1);
    } else if (distance < 0 && currentScreen > 0) {
      // Swipe right - previous screen
      setCurrentScreen(currentScreen - 1);
    }
  };

  return (
    <div style={styles.container}>
      <div 
        style={styles.card}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Screen Content */}
        <div style={styles.screenContainer}>
          {currentScreen === 0 && <SharePriceScreen sharePrice={sharePrice} gainPercent={gainPercent} />}
          {currentScreen === 1 && <TotalValueScreen baseValue={baseValue} purchasePrice={purchasePrice} gain={gain} gainPercent={gainPercent} />}
          {currentScreen === 2 && <BettingScreen vehicleId={vehicle.id} baseValue={baseValue} />}
          {currentScreen === 3 && <AuctionVoteScreen vehicle={vehicle} session={session} />}
        </div>

        {/* Dots Indicator */}
        <div style={styles.dots}>
          {[...Array(screens)].map((_, idx) => (
            <div
              key={idx}
              style={{
                ...styles.dot,
                background: idx === currentScreen ? '#000080' : '#808080'
              }}
              onClick={() => setCurrentScreen(idx)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

// Screen 1: Share Price
const SharePriceScreen: React.FC<{ sharePrice: number; gainPercent: number }> = ({ sharePrice, gainPercent }) => (
  <div style={styles.screen}>
    <div style={styles.mainMetric}>
      <div style={styles.label}>Share Price</div>
      <div style={styles.bigValue}>
        ${sharePrice.toFixed(2)}
        <span style={{
          ...styles.changeIndicator,
          color: gainPercent >= 0 ? '#008000' : '#ff0000'
        }}>
          {gainPercent >= 0 ? ' ↑ ' : ' ↓ '}
          {Math.abs(gainPercent).toFixed(1)}%
        </span>
      </div>
    </div>
    <div style={styles.divider} />
    <div style={styles.subMetrics}>
      <div style={styles.subMetric}>
        <span style={styles.subLabel}>Volatility:</span>
        <span style={styles.subValue}>●●○○○ Med</span>
      </div>
      <div style={styles.subMetric}>
        <span style={styles.subLabel}>Trading:</span>
        <span style={styles.subValue}>🟢 Active</span>
      </div>
    </div>
    <div style={styles.buySection}>
      <BuyCreditsButton presetAmounts={[3, 10, 25]} />
    </div>
  </div>
);

// Screen 2: Total Value
const TotalValueScreen: React.FC<{ baseValue: number; purchasePrice: number; gain: number; gainPercent: number }> = ({ baseValue, purchasePrice, gain, gainPercent }) => (
  <div style={styles.screen}>
    <div style={styles.mainMetric}>
      <div style={styles.label}>Market Cap</div>
      <div style={styles.bigValue}>${baseValue.toLocaleString()}</div>
    </div>
    <div style={styles.divider} />
    <div style={styles.subMetrics}>
      <div style={styles.subMetric}>
        <span style={styles.subLabel}>Purchase:</span>
        <span style={styles.subValue}>${purchasePrice.toLocaleString()}</span>
      </div>
      <div style={styles.subMetric}>
        <span style={styles.subLabel}>Gain:</span>
        <span style={{
          ...styles.subValue,
          color: gain >= 0 ? '#008000' : '#ff0000',
          fontWeight: 'bold'
        }}>
          {gain >= 0 ? '+' : ''}${Math.abs(gain).toLocaleString()} ({gainPercent.toFixed(1)}%)
        </span>
      </div>
    </div>
  </div>
);

// Screen 3: Bets
const BettingScreen: React.FC<{ vehicleId: string; baseValue: number }> = ({ vehicleId, baseValue }) => {
  const [betStats, setBetStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBetStats();
  }, [vehicleId]);

  const loadBetStats = async () => {
    try {
      const stats = await BettingService.getBetStatistics(vehicleId);
      setBetStats(stats);
    } catch (error) {
      console.error('Failed to load bet stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.screen}>
        <div style={styles.mainMetric}>
          <div style={styles.label}>🎲 Market Bets</div>
        </div>
        <div style={styles.divider} />
        <div style={styles.loadingText}>Loading predictions...</div>
      </div>
    );
  }

  const valueMilestone = betStats?.value_milestone || { avg_prediction: 50000, confidence: 67, count: 0 };
  const nextMod = betStats?.next_mod_value || { avg_prediction: 2000, count: 0 };

  return (
    <div style={styles.screen}>
      <div style={styles.mainMetric}>
        <div style={styles.label}>🎲 Market Bets</div>
        <div style={styles.metricSubtext}>{betStats?.total_bets || 0} active predictions</div>
      </div>
      <div style={styles.divider} />
      <div style={styles.betsList}>
        <div style={styles.bet}>
          <span style={styles.betText}>Will reach ${Math.round(valueMilestone.avg_prediction / 1000)}k:</span>
          <span style={styles.betOdds}>{Math.round(valueMilestone.confidence)}%</span>
        </div>
        <div style={styles.bet}>
          <span style={styles.betText}>Next mod value:</span>
          <span style={styles.betOdds}>+${(nextMod.avg_prediction / 1000).toFixed(1)}k</span>
        </div>
        <div style={styles.bet}>
          <span style={styles.betText}>Total bettors:</span>
          <span style={styles.betOdds}>{betStats?.total_bets || 0}</span>
        </div>
      </div>
    </div>
  );
};

// Screen 4: Auction Vote
const AuctionVoteScreen: React.FC<{ vehicle: any; session?: any }> = ({ vehicle, session }) => {
  const [voteSummary, setVoteSummary] = useState<any>(null);
  const [userVote, setUserVote] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (session?.user?.id) {
      loadVoteData();
    } else {
      setLoading(false);
    }
  }, [vehicle.id, session?.user?.id]);

  const loadVoteData = async () => {
    if (!session?.user?.id) return; // Early return guard
    
    try {
      const [summary, vote] = await Promise.all([
        AuctionVotingService.getVoteSummary(vehicle.id),
        AuctionVotingService.getUserVote(vehicle.id, session.user.id)
      ]);
      
      setVoteSummary(summary);
      setUserVote(vote);
    } catch (error) {
      console.error('Failed to load vote data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleVote = async (vote: 'yes' | 'no') => {
    if (!session?.user) {
      alert('Please log in to vote');
      return;
    }

    try {
      await AuctionVotingService.castVote({
        vehicle_id: vehicle.id,
        user_id: session.user.id,
        vote
      });
      
      await loadVoteData();
    } catch (error) {
      console.error('Failed to cast vote:', error);
      alert('Failed to submit vote');
    }
  };

  if (loading) {
    return (
      <div style={styles.screen}>
        <div style={styles.mainMetric}>
          <div style={styles.label}>🏛️ Send to Auction?</div>
        </div>
        <div style={styles.divider} />
        <div style={styles.loadingText}>Loading votes...</div>
      </div>
    );
  }

  return (
    <div style={styles.screen}>
      <div style={styles.mainMetric}>
        <div style={styles.label}>🏛️ Send to Auction?</div>
      </div>
      <div style={styles.divider} />
      {!session?.user?.id ? (
        <div style={styles.loginPrompt}>
          <div style={styles.loginText}>Login to vote on auctions</div>
          <button style={styles.loginButton} onClick={() => window.location.href = '/login'}>
            Login
          </button>
        </div>
      ) : !userVote ? (
        <div style={styles.voteButtons}>
          <button style={styles.voteButtonYes} onClick={() => handleVote('yes')}>
            Vote Yes
          </button>
          <button style={styles.voteButtonNo} onClick={() => handleVote('no')}>
            Vote No
          </button>
        </div>
      ) : (
        <div style={styles.voteResult}>
          ✅ You voted {userVote.vote.toUpperCase()}
        </div>
      )}
      <div style={styles.voteStats}>
        {voteSummary && voteSummary.total_votes > 0 ? (
          <>
            {voteSummary.yes_votes} yes, {voteSummary.no_votes} no ({voteSummary.yes_percent.toFixed(0)}% yes)
          </>
        ) : (
          'No votes yet'
        )}
      </div>
    </div>
  );
};

const styles = {
  container: {
    marginBottom: '16px'
  },
  card: {
    background: '#c0c0c0',
    border: '2px outset #ffffff',
    borderRadius: '4px',
    padding: '16px',
    boxShadow: 'inset -1px -1px 0 #000000, inset 1px 1px 0 #ffffff'
  },
  screenContainer: {
    minHeight: '120px'
  },
  screen: {
    // No additional styling needed
  },
  mainMetric: {
    textAlign: 'center' as const,
    marginBottom: '8px'
  },
  label: {
    fontSize: '11px',
    color: '#000080',
    fontWeight: 'bold' as const,
    fontFamily: '"MS Sans Serif", sans-serif',
    marginBottom: '4px'
  },
  bigValue: {
    fontSize: '28px',
    fontWeight: 'bold' as const,
    color: '#000000',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  changeIndicator: {
    fontSize: '16px',
    marginLeft: '8px'
  },
  divider: {
    height: '2px',
    background: '#808080',
    margin: '12px 0',
    boxShadow: '0 1px 0 #ffffff'
  },
  subMetrics: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px'
  },
  buySection: {
    marginTop: '12px',
    display: 'flex',
    justifyContent: 'center' as const
  },
  subMetric: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px'
  },
  subLabel: {
    color: '#000000',
    fontWeight: 'bold' as const,
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  subValue: {
    color: '#000000',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  betsList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px'
  },
  bet: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    padding: '6px',
    background: '#ffffff',
    border: '1px inset #808080'
  },
  betText: {
    color: '#000000',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  betOdds: {
    color: '#000080',
    fontWeight: 'bold' as const,
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  voteButtons: {
    display: 'flex',
    gap: '8px',
    marginBottom: '12px'
  },
  voteButtonYes: {
    flex: 1,
    background: '#008000',
    color: '#ffffff',
    border: '2px outset #ffffff',
    padding: '12px',
    fontSize: '13px',
    fontWeight: 'bold' as const,
    cursor: 'pointer',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  voteButtonNo: {
    flex: 1,
    background: '#ff0000',
    color: '#ffffff',
    border: '2px outset #ffffff',
    padding: '12px',
    fontSize: '13px',
    fontWeight: 'bold' as const,
    cursor: 'pointer',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  loginPrompt: {
    textAlign: 'center' as const,
    marginBottom: '12px'
  },
  loginText: {
    fontSize: '12px',
    color: '#000080',
    marginBottom: '8px',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  loginButton: {
    background: '#c0c0c0',
    color: '#000000',
    border: '2px outset #ffffff',
    padding: '8px 16px',
    fontSize: '12px',
    fontWeight: 'bold' as const,
    cursor: 'pointer',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  voteResult: {
    textAlign: 'center' as const,
    fontSize: '14px',
    color: '#008000',
    fontWeight: 'bold' as const,
    padding: '12px',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  voteStats: {
    fontSize: '10px',
    color: '#808080',
    textAlign: 'center' as const,
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  loadingText: {
    textAlign: 'center' as const,
    padding: '20px',
    color: '#808080',
    fontSize: '12px',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  metricSubtext: {
    fontSize: '10px',
    color: '#808080',
    textAlign: 'center' as const,
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  dots: {
    display: 'flex',
    justifyContent: 'center',
    gap: '8px',
    marginTop: '12px'
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    cursor: 'pointer',
    border: '1px solid #000000',
    transition: 'background 0.2s'
  }
};

