'use client'
import { useEffect, useState, useCallback } from 'react'
import { usePlaidLink } from 'react-plaid-link'

interface SubAccount {
  id: string
  name: string
  type: string
  subtype: string | null
  mask: string | null
  currentBalance: number
  availableBalance: number
}

interface BankAccount {
  id: string
  institutionName: string
  lastSync: string | null
  company: { id: string; name: string } | null
  accounts: SubAccount[]
  _count: { transactions: number }
}

interface Transaction {
  id: string
  date: string
  name: string
  merchantName: string | null
  amount: number
  direction: 'INFLOW' | 'OUTFLOW' | 'TRANSFER' | null
  category: string | null
  pending: boolean
  bankAccount: { institutionName: string }
  subAccount: { name: string; mask: string | null } | null
}

interface Summary {
  income: number
  expenses: number
  net: number
}

function PlaidConnectButton({ onSuccess }: { onSuccess: () => void }) {
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/plaid/create-link-token', { method: 'POST' })
      .then(r => r.json())
      .then(d => setLinkToken(d.link_token))
      .catch(e => console.error('Link token error:', e))
  }, [])

  const onPlaidSuccess = useCallback(async (public_token: string) => {
    setLoading(true)
    try {
      await fetch('/api/plaid/exchange-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_token }),
      })
      onSuccess()
    } catch (e) {
      console.error('Exchange error:', e)
    } finally {
      setLoading(false)
    }
  }, [onSuccess])

  const { open, ready } = usePlaidLink({
    token: linkToken || '',
    onSuccess: onPlaidSuccess,
  })

  return (
    <button
      onClick={() => open()}
      disabled={!ready || loading}
      className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition-colors"
    >
      {loading ? '⏳ Connecting...' : '🏦 Connect Bank Account'}
    </button>
  )
}

export default function FinancePage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [summary, setSummary] = useState<Summary>({ income: 0, expenses: 0, net: 0 })
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [days, setDays] = useState(30)
  const [selectedBank, setSelectedBank] = useState<string>('')
  const [activeTab, setActiveTab] = useState<'all' | 'income' | 'expenses'>('all')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [accRes, txRes] = await Promise.all([
        fetch('/api/plaid/accounts'),
        fetch(`/api/plaid/transactions?days=${days}${selectedBank ? `&bankAccountId=${selectedBank}` : ''}`),
      ])
      const accData = await accRes.json()
      const txData = await txRes.json()
      setAccounts(Array.isArray(accData) ? accData : [])
      setTransactions(txData.transactions || [])
      setSummary(txData.summary || { income: 0, expenses: 0, net: 0 })
    } catch (e) {
      console.error('Load error:', e)
    } finally {
      setLoading(false)
    }
  }, [days, selectedBank])

  useEffect(() => { loadData() }, [loadData])

  const syncAccount = async (id: string) => {
    setSyncing(id)
    try {
      await fetch('/api/plaid/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankAccountId: id }),
      })
      await loadData()
    } finally {
      setSyncing(null)
    }
  }

  const removeAccount = async (id: string) => {
    if (!confirm('Remove this bank connection?')) return
    await fetch('/api/plaid/accounts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    loadData()
  }

  const totalBalance = accounts.flatMap(a => a.accounts).reduce((s, a) => s + (a.currentBalance || 0), 0)

  const filteredTx = transactions.filter(tx => {
    if (activeTab === 'income') return tx.direction === 'INFLOW'
    if (activeTab === 'expenses') return tx.direction === 'OUTFLOW'
    return true
  })

  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(n))

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">💳 Finance</h1>
          <p className="text-gray-400 text-sm mt-1">All companies · All banks · One view</p>
        </div>
        <PlaidConnectButton onSuccess={loadData} />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">Total Balance</p>
          <p className="text-2xl font-bold text-white">{fmt(totalBalance)}</p>
          <p className="text-gray-500 text-xs mt-1">{accounts.flatMap(a => a.accounts).length} accounts</p>
        </div>
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">Income ({days}d)</p>
          <p className="text-2xl font-bold text-green-400">{fmt(summary.income)}</p>
        </div>
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">Expenses ({days}d)</p>
          <p className="text-2xl font-bold text-red-400">{fmt(summary.expenses)}</p>
        </div>
        <div className={`bg-gray-800 rounded-xl p-4 border ${summary.net >= 0 ? 'border-green-700' : 'border-red-700'}`}>
          <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">Net ({days}d)</p>
          <p className={`text-2xl font-bold ${summary.net >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmt(summary.net)}</p>
        </div>
      </div>

      {/* Connected banks */}
      {accounts.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-3">Connected Banks</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {accounts.map(acc => (
              <div key={acc.id} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-white">{acc.institutionName}</p>
                    {acc.company && <p className="text-xs text-blue-400">{acc.company.name}</p>}
                    <p className="text-xs text-gray-500 mt-1">
                      {acc._count.transactions} transactions ·{' '}
                      {acc.lastSync ? `Synced ${new Date(acc.lastSync).toLocaleDateString()}` : 'Never synced'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => syncAccount(acc.id)}
                      disabled={syncing === acc.id}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      {syncing === acc.id ? '⏳' : '🔄'}
                    </button>
                    <button onClick={() => removeAccount(acc.id)} className="text-xs text-red-400 hover:text-red-300">✕</button>
                  </div>
                </div>
                <div className="space-y-2">
                  {acc.accounts.map(sub => (
                    <div key={sub.id} className="flex justify-between items-center text-sm">
                      <span className="text-gray-400">
                        {sub.name} {sub.mask ? `••${sub.mask}` : ''}
                      </span>
                      <span className="text-white font-medium">{fmt(sub.currentBalance)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No accounts state */}
      {accounts.length === 0 && !loading && (
        <div className="bg-gray-800 rounded-xl p-12 border border-dashed border-gray-600 text-center">
          <p className="text-4xl mb-4">🏦</p>
          <p className="text-white font-semibold text-lg">No bank accounts connected</p>
          <p className="text-gray-400 text-sm mt-2 mb-6">Connect your Bank of America, KeyBank, and Chase accounts to see your full financial picture</p>
          <PlaidConnectButton onSuccess={loadData} />
        </div>
      )}

      {/* Transactions */}
      {accounts.length > 0 && (
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-semibold text-white">Transactions</h2>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Filter by bank */}
              <select
                value={selectedBank}
                onChange={e => setSelectedBank(e.target.value)}
                className="bg-gray-700 text-white text-sm rounded-lg px-3 py-1.5 border border-gray-600"
              >
                <option value="">All Banks</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.institutionName}</option>
                ))}
              </select>
              {/* Days filter */}
              <select
                value={days}
                onChange={e => setDays(Number(e.target.value))}
                className="bg-gray-700 text-white text-sm rounded-lg px-3 py-1.5 border border-gray-600"
              >
                <option value={7}>Last 7 days</option>
                <option value={14}>Last 14 days</option>
                <option value={30}>Last 30 days</option>
                <option value={60}>Last 60 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mb-4 bg-gray-800 p-1 rounded-lg w-fit">
            {(['all', 'income', 'expenses'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${
                  activeTab === tab ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="text-center py-12 text-gray-400">Loading transactions...</div>
          ) : (
            <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
              {filteredTx.length === 0 ? (
                <div className="text-center py-12 text-gray-400">No transactions found</div>
              ) : (
                <div className="divide-y divide-gray-700">
                  {filteredTx.map(tx => (
                    <div key={tx.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-750">
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">{tx.merchantName || tx.name}</p>
                        <p className="text-gray-500 text-xs mt-0.5">
                          {new Date(tx.date).toLocaleDateString()} ·{' '}
                          {tx.bankAccount.institutionName}
                          {tx.subAccount ? ` ••${tx.subAccount.mask || tx.subAccount.name}` : ''} ·{' '}
                          {tx.category || 'Uncategorized'}
                          {tx.pending && ' · Pending'}
                        </p>
                      </div>
                      <p className={`text-sm font-semibold ml-4 shrink-0 ${tx.direction === 'INFLOW' ? 'text-green-400' : tx.direction === 'OUTFLOW' ? 'text-red-400' : 'text-gray-300'}`}>
                        {tx.direction === 'INFLOW' ? '+' : tx.direction === 'OUTFLOW' ? '-' : ''}{fmt(tx.amount)} · {tx.direction === 'INFLOW' ? 'MONEY IN' : tx.direction === 'OUTFLOW' ? 'MONEY OUT' : 'NEUTRAL'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
