import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { FiDollarSign, FiTrendingUp, FiTrendingDown, FiCalendar, FiUser } from 'react-icons/fi';

interface TransactionHistoryProps {
  vehicleId: string;
}

interface Transaction {
  id: string;
  transaction_type: string;
  transaction_date?: string;
  amount: number;
  currency?: string;
  from_party?: string;
  to_party?: string;
  notes?: string;
  logged_by?: string;
  inserted_at: string;
}

const TRANSACTION_TYPES: Record<string, { label: string; icon: React.ComponentType; color: string }> = {
  purchase: { label: 'Purchase', icon: FiDollarSign, color: 'blue' },
  sale: { label: 'Sale', icon: FiDollarSign, color: 'green' },
  appraisal: { label: 'Appraisal', icon: FiTrendingUp, color: 'purple' },
  market_value_update: { label: 'Market Value', icon: FiTrendingUp, color: 'indigo' },
  insurance_valuation: { label: 'Insurance', icon: FiDollarSign, color: 'yellow' },
  trade: { label: 'Trade', icon: FiDollarSign, color: 'orange' },
  auction: { label: 'Auction', icon: FiDollarSign, color: 'red' }
};

const TransactionHistory: React.FC<TransactionHistoryProps> = ({ vehicleId }) => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTransactions();
  }, [vehicleId]);

  const loadTransactions = async () => {
    try {
      const { data, error } = await supabase
        .from('vehicle_financial_transactions')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('transaction_date', { ascending: false });

      if (error) throw error;
      setTransactions(data || []);
    } catch (error) {
      console.error('Failed to load transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-header">
          <h3 className="text-lg font-semibold">Transaction History</h3>
        </div>
        <div className="card-body">
          <div className="text-center text-gray-500">Loading history...</div>
        </div>
      </div>
    );
  }

  if (transactions.length === 0) {
    return null; // Don't show if no transactions
  }

  // Calculate value change
  const firstTransaction = transactions[transactions.length - 1];
  const lastTransaction = transactions[0];
  const valueChange = lastTransaction.amount - firstTransaction.amount;
  const percentChange = firstTransaction.amount !== 0
    ? ((valueChange / firstTransaction.amount) * 100).toFixed(1)
    : '0.0';

  return (
    <div className="card">
      <div className="card-header">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Transaction History</h3>
            <p className="text-sm text-gray-600 mt-1">
              {transactions.length} recorded transaction{transactions.length !== 1 ? 's' : ''}
            </p>
          </div>
          {transactions.length >= 2 && (
            <div className="text-right">
              <div className="flex items-center gap-2">
                {valueChange >= 0 ? (
                  <FiTrendingUp className="w-5 h-5 text-green-600" />
                ) : (
                  <FiTrendingDown className="w-5 h-5 text-red-600" />
                )}
                <div>
                  <div className={`text-lg font-bold ${valueChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {valueChange >= 0 ? '+' : ''}{percentChange}%
                  </div>
                  <div className="text-xs text-gray-500">Value change</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card-body">
        {/* Timeline */}
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-200" />

          {/* Transactions */}
          <div className="space-y-4">
            {transactions.map((transaction, index) => {
              const config = TRANSACTION_TYPES[transaction.transaction_type] || TRANSACTION_TYPES.purchase;
              const Icon = config.icon;
              const isFirst = index === 0;
              const isLast = index === transactions.length - 1;

              return (
                <div key={transaction.id} className="relative pl-16">
                  {/* Timeline dot */}
                  <div className={`absolute left-3 w-6 h-6 rounded-full flex items-center justify-center ${
                    isFirst ? 'bg-green-100 border-2 border-green-500' :
                    isLast ? 'bg-gray-100 border-2 border-gray-300' :
                    'bg-blue-100 border-2 border-blue-400'
                  }`}>
                    <Icon className={`w-3 h-3 ${
                      isFirst ? 'text-green-600' :
                      isLast ? 'text-gray-500' :
                      'text-blue-600'
                    }`} />
                  </div>

                  {/* Transaction card */}
                  <div className={`p-4 rounded-lg border ${
                    isFirst ? 'border-green-200 bg-green-50' :
                    isLast ? 'border-gray-200 bg-gray-50' :
                    'border-gray-200 bg-white'
                  }`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-1 rounded text-xs font-medium bg-${config.color}-100 text-${config.color}-800`}>
                            {config.label}
                          </span>
                          {isFirst && (
                            <span className="px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-800">
                              Most Recent
                            </span>
                          )}
                        </div>

                        <div className="mt-2 space-y-1">
                          {(transaction.from_party || transaction.to_party) && (
                            <div className="text-sm text-gray-700">
                              {transaction.from_party && (
                                <span>From: <span className="font-medium">{transaction.from_party}</span></span>
                              )}
                              {transaction.from_party && transaction.to_party && <span className="mx-2">→</span>}
                              {transaction.to_party && (
                                <span>To: <span className="font-medium">{transaction.to_party}</span></span>
                              )}
                            </div>
                          )}

                          <div className="flex items-center gap-3 text-xs text-gray-600">
                            <span className="flex items-center gap-1">
                              <FiCalendar className="w-3 h-3" />
                              {new Date(transaction.transaction_date || transaction.inserted_at).toLocaleDateString()}
                            </span>
                            {transaction.logged_by && (
                              <span className="flex items-center gap-1">
                                <FiUser className="w-3 h-3" />
                                Logged by user
                              </span>
                            )}
                          </div>

                          {transaction.notes && (
                            <div className="mt-2 text-sm text-gray-600 italic">
                              "{transaction.notes}"
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="ml-4 text-right">
                        <div className="text-2xl font-bold text-gray-900">
                          {new Intl.NumberFormat('en-US', {
                            style: 'currency',
                            currency: transaction.currency || 'USD'
                          }).format(transaction.amount)}
                        </div>
                        {index > 0 && (
                          <div className="mt-1 text-xs">
                            {(() => {
                              const prevAmount = transactions[index - 1].amount;
                              const diff = transaction.amount - prevAmount;
                              const pct = prevAmount !== 0 ? ((diff / prevAmount) * 100).toFixed(1) : '0.0';
                              return (
                                <span className={diff >= 0 ? 'text-green-600' : 'text-red-600'}>
                                  {diff >= 0 ? '+' : ''}{pct}%
                                </span>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Summary */}
        {transactions.length >= 2 && (
          <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-gray-900">
                  ${firstTransaction.amount_usd.toLocaleString()}
                </div>
                <div className="text-xs text-gray-600 mt-1">Initial Value</div>
              </div>
              <div>
                <div className={`text-2xl font-bold ${valueChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {valueChange >= 0 ? '+' : ''}${Math.abs(valueChange).toLocaleString()}
                </div>
                <div className="text-xs text-gray-600 mt-1">Change</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900">
                  ${lastTransaction.amount_usd.toLocaleString()}
                </div>
                <div className="text-xs text-gray-600 mt-1">Current Value</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TransactionHistory;

