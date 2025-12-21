/**
 * Real-Time Market Service
 * Handles WebSocket connections, live price updates, and market notifications
 */

import { supabase } from '../lib/supabase';

export interface MarketUpdate {
  type: 'price_change' | 'trade_executed' | 'order_placed' | 'order_cancelled' | 'market_open' | 'market_close';
  data: any;
  timestamp: string;
}

export interface LivePriceData {
  offering_id: string;
  symbol: string;
  current_price: number;
  price_change: number;
  price_change_pct: number;
  volume_24h: number;
  bid: number | null;
  ask: number | null;
  last_trade_time: string | null;
}

export interface TradeNotification {
  id: string;
  type: 'trade_executed' | 'order_filled' | 'price_alert' | 'leaderboard_update';
  title: string;
  message: string;
  data: any;
  created_at: string;
  read: boolean;
}

export interface PriceAlert {
  id: string;
  user_id: string;
  offering_id: string;
  symbol: string;
  alert_type: 'price_above' | 'price_below' | 'price_change_pct';
  target_value: number;
  current_value: number;
  is_active: boolean;
  triggered_at?: string;
}

// =====================================================
// REAL-TIME MARKET SERVICE
// =====================================================

export class RealTimeMarketService {
  private static instance: RealTimeMarketService | null = null;
  private subscriptions: Map<string, any> = new Map();
  private priceData: Map<string, LivePriceData> = new Map();
  private notifications: TradeNotification[] = [];
  private priceAlerts: PriceAlert[] = [];
  private callbacks: Map<string, Function[]> = new Map();
  private isConnected: boolean = false;

  static getInstance(): RealTimeMarketService {
    if (!this.instance) {
      this.instance = new RealTimeMarketService();
    }
    return this.instance;
  }

  /**
   * Initialize real-time connections
   */
  async initialize(userId?: string) {
    try {
      await this.setupPriceSubscriptions();
      await this.setupTradeSubscriptions();
      
      if (userId) {
        await this.setupUserNotifications(userId);
        await this.loadPriceAlerts(userId);
      }

      this.isConnected = true;
      this.emit('connection', { status: 'connected' });
    } catch (error) {
      console.error('Failed to initialize real-time service:', error);
      this.emit('connection', { status: 'error', error });
    }
  }

  /**
   * Subscribe to live price updates for all offerings
   */
  private async setupPriceSubscriptions() {
    // Subscribe to vehicle offerings changes
    const offeringsSubscription = supabase
      .channel('vehicle_offerings_live')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'vehicle_offerings' },
        (payload) => {
          this.handleOfferingUpdate(payload);
        }
      )
      .subscribe();

    this.subscriptions.set('offerings', offeringsSubscription);

    // Subscribe to market trades for price updates
    const tradesSubscription = supabase
      .channel('market_trades_live')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'market_trades' },
        (payload) => {
          this.handleTradeUpdate(payload);
        }
      )
      .subscribe();

    this.subscriptions.set('trades', tradesSubscription);

    // Load initial price data
    await this.loadInitialPriceData();
  }

  /**
   * Subscribe to trade notifications
   */
  private async setupTradeSubscriptions() {
    const ordersSubscription = supabase
      .channel('market_orders_live')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'market_orders' },
        (payload) => {
          this.handleOrderUpdate(payload);
        }
      )
      .subscribe();

    this.subscriptions.set('orders', ordersSubscription);
  }

  /**
   * Subscribe to user-specific notifications
   */
  private async setupUserNotifications(userId: string) {
    const notificationsSubscription = supabase
      .channel('market_notifications_user')
      .on('postgres_changes',
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'market_notifications',
          filter: `user_id=eq.${userId}`
        },
        (payload) => {
          this.handleNotification(payload);
        }
      )
      .subscribe();

    this.subscriptions.set('notifications', notificationsSubscription);

    // Load initial notifications
    await this.loadUserNotifications(userId);
  }

  /**
   * Handle offering updates (price changes)
   */
  private handleOfferingUpdate(payload: any) {
    const offering = payload.new || payload.old;
    if (!offering) return;

    const existingData = this.priceData.get(offering.id);
    const oldPrice = existingData?.current_price || offering.current_share_price;
    const newPrice = offering.current_share_price;
    
    const priceChange = newPrice - oldPrice;
    const priceChangePct = oldPrice > 0 ? (priceChange / oldPrice) * 100 : 0;

    const liveData: LivePriceData = {
      offering_id: offering.id,
      symbol: offering.vehicle_id, // TODO: Get actual symbol
      current_price: newPrice,
      price_change: priceChange,
      price_change_pct: priceChangePct,
      volume_24h: offering.total_volume_usd || 0,
      bid: offering.highest_bid,
      ask: offering.lowest_ask,
      last_trade_time: new Date().toISOString()
    };

    this.priceData.set(offering.id, liveData);
    this.emit('price_update', liveData);

    // Check price alerts
    this.checkPriceAlerts(liveData);
  }

  /**
   * Handle trade updates
   */
  private handleTradeUpdate(payload: any) {
    const trade = payload.new;
    if (!trade) return;

    this.emit('trade_executed', {
      offering_id: trade.offering_id,
      price: trade.price_per_share,
      shares: trade.shares_traded,
      total_value: trade.total_value,
      executed_at: trade.executed_at
    });

    // Update price data from trade
    const existingData = this.priceData.get(trade.offering_id);
    if (existingData) {
      const updatedData = {
        ...existingData,
        current_price: trade.price_per_share,
        last_trade_time: trade.executed_at
      };
      this.priceData.set(trade.offering_id, updatedData);
      this.emit('price_update', updatedData);
    }
  }

  /**
   * Handle order updates
   */
  private handleOrderUpdate(payload: any) {
    const order = payload.new || payload.old;
    if (!order) return;

    this.emit('order_update', {
      order_id: order.id,
      offering_id: order.offering_id,
      status: order.status,
      event_type: payload.eventType
    });
  }

  /**
   * Handle notifications
   */
  private handleNotification(payload: any) {
    const notification = payload.new;
    if (!notification) return;

    const tradeNotification: TradeNotification = {
      id: notification.id,
      type: notification.notification_type,
      title: notification.title,
      message: notification.message,
      data: notification.metadata || {},
      created_at: notification.created_at,
      read: false
    };

    this.notifications.unshift(tradeNotification);
    this.emit('notification', tradeNotification);

    // Show browser notification if permitted
    this.showBrowserNotification(tradeNotification);
  }

  /**
   * Load initial price data
   */
  private async loadInitialPriceData() {
    try {
      const { data: offerings, error } = await supabase
        .from('vehicle_offerings')
        .select(`
          id,
          vehicle_id,
          current_share_price,
          highest_bid,
          lowest_ask,
          total_volume_usd,
          opening_price,
          vehicles!inner(
            make,
            model,
            year
          )
        `)
        .eq('status', 'trading');

      if (error) throw error;

      for (const offering of offerings || []) {
        const symbol = `${offering.vehicles.year} ${offering.vehicles.make} ${offering.vehicles.model}`;
        const priceChange = (offering.current_share_price || 0) - (offering.opening_price || 0);
        const priceChangePct = offering.opening_price > 0 
          ? (priceChange / offering.opening_price) * 100 
          : 0;

        const liveData: LivePriceData = {
          offering_id: offering.id,
          symbol,
          current_price: offering.current_share_price || 0,
          price_change: priceChange,
          price_change_pct: priceChangePct,
          volume_24h: offering.total_volume_usd || 0,
          bid: offering.highest_bid,
          ask: offering.lowest_ask,
          last_trade_time: null
        };

        this.priceData.set(offering.id, liveData);
      }

      this.emit('initial_data_loaded', Array.from(this.priceData.values()));
    } catch (error) {
      console.error('Failed to load initial price data:', error);
    }
  }

  /**
   * Load user notifications
   */
  private async loadUserNotifications(userId: string) {
    try {
      const { data, error } = await supabase
        .from('market_notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      this.notifications = (data || []).map((n: any) => ({
        id: n.id,
        type: n.notification_type,
        title: n.title,
        message: n.message,
        data: n.metadata || {},
        created_at: n.created_at,
        read: n.read_at !== null
      }));

      this.emit('notifications_loaded', this.notifications);
    } catch (error) {
      console.error('Failed to load notifications:', error);
    }
  }

  /**
   * Load user price alerts
   */
  private async loadPriceAlerts(userId: string) {
    try {
      const { data, error } = await supabase
        .from('price_alerts')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true);

      if (error) throw error;

      this.priceAlerts = data || [];
    } catch (error) {
      console.error('Failed to load price alerts:', error);
    }
  }

  /**
   * Check price alerts against current prices
   */
  private checkPriceAlerts(priceData: LivePriceData) {
    const alerts = this.priceAlerts.filter(alert => 
      alert.offering_id === priceData.offering_id && alert.is_active
    );

    for (const alert of alerts) {
      let triggered = false;

      switch (alert.alert_type) {
        case 'price_above':
          triggered = priceData.current_price > alert.target_value;
          break;
        case 'price_below':
          triggered = priceData.current_price < alert.target_value;
          break;
        case 'price_change_pct':
          triggered = Math.abs(priceData.price_change_pct) >= alert.target_value;
          break;
      }

      if (triggered) {
        this.triggerPriceAlert(alert, priceData);
      }
    }
  }

  /**
   * Trigger price alert
   */
  private async triggerPriceAlert(alert: PriceAlert, priceData: LivePriceData) {
    try {
      // Mark alert as triggered
      await supabase
        .from('price_alerts')
        .update({ 
          is_active: false, 
          triggered_at: new Date().toISOString(),
          current_value: priceData.current_price
        })
        .eq('id', alert.id);

      // Create notification
      const notification: TradeNotification = {
        id: `alert_${alert.id}`,
        type: 'price_alert',
        title: 'Price Alert Triggered',
        message: `${priceData.symbol} ${alert.alert_type.replace('_', ' ')} $${alert.target_value}. Current price: $${priceData.current_price}`,
        data: { alert, priceData },
        created_at: new Date().toISOString(),
        read: false
      };

      this.notifications.unshift(notification);
      this.emit('notification', notification);
      this.showBrowserNotification(notification);

      // Remove from active alerts
      this.priceAlerts = this.priceAlerts.filter(a => a.id !== alert.id);
    } catch (error) {
      console.error('Failed to trigger price alert:', error);
    }
  }

  /**
   * Show browser notification
   */
  private showBrowserNotification(notification: TradeNotification) {
    if (!('Notification' in window)) return;

    if (Notification.permission === 'granted') {
      new Notification(notification.title, {
        body: notification.message,
        icon: '/favicon.ico'
      });
    } else if (Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          new Notification(notification.title, {
            body: notification.message,
            icon: '/favicon.ico'
          });
        }
      });
    }
  }

  /**
   * Create price alert
   */
  async createPriceAlert(
    userId: string,
    offeringId: string,
    symbol: string,
    alertType: 'price_above' | 'price_below' | 'price_change_pct',
    targetValue: number
  ) {
    try {
      const currentPrice = this.priceData.get(offeringId)?.current_price || 0;

      const { data, error } = await supabase
        .from('price_alerts')
        .insert({
          user_id: userId,
          offering_id: offeringId,
          symbol,
          alert_type: alertType,
          target_value: targetValue,
          current_value: currentPrice,
          is_active: true
        })
        .select()
        .single();

      if (error) throw error;

      const alert: PriceAlert = {
        id: data.id,
        user_id: userId,
        offering_id: offeringId,
        symbol,
        alert_type: alertType,
        target_value: targetValue,
        current_value: currentPrice,
        is_active: true
      };

      this.priceAlerts.push(alert);
      this.emit('alert_created', alert);

      return alert;
    } catch (error) {
      console.error('Failed to create price alert:', error);
      throw error;
    }
  }

  /**
   * Get live price data
   */
  getLivePriceData(offeringId?: string): LivePriceData | LivePriceData[] {
    if (offeringId) {
      return this.priceData.get(offeringId) || null;
    }
    return Array.from(this.priceData.values());
  }

  /**
   * Get notifications
   */
  getNotifications(): TradeNotification[] {
    return this.notifications;
  }

  /**
   * Get price alerts
   */
  getPriceAlerts(): PriceAlert[] {
    return this.priceAlerts;
  }

  /**
   * Mark notification as read
   */
  async markNotificationRead(notificationId: string) {
    try {
      await supabase
        .from('market_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', notificationId);

      const notification = this.notifications.find(n => n.id === notificationId);
      if (notification) {
        notification.read = true;
        this.emit('notification_read', notification);
      }
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  }

  /**
   * Subscribe to events
   */
  on(event: string, callback: Function) {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, []);
    }
    this.callbacks.get(event)!.push(callback);
  }

  /**
   * Unsubscribe from events
   */
  off(event: string, callback: Function) {
    const callbacks = this.callbacks.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Emit event
   */
  private emit(event: string, data: any) {
    const callbacks = this.callbacks.get(event);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in ${event} callback:`, error);
        }
      });
    }
  }

  /**
   * Disconnect all subscriptions
   */
  disconnect() {
    this.subscriptions.forEach((subscription) => {
      supabase.removeChannel(subscription);
    });
    this.subscriptions.clear();
    this.callbacks.clear();
    this.isConnected = false;
    this.emit('connection', { status: 'disconnected' });
  }

  /**
   * Check connection status
   */
  isConnectedToMarket(): boolean {
    return this.isConnected;
  }
}
