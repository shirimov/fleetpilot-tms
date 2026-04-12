'use client'
import { useEffect, useState, useCallback } from 'react'
import Sidebar from '@/components/Sidebar'

interface EmailAccount {
  id: string
  email: string
  label: string
  _count: { emails: number }
}

interface Email {
  id: string
  from: string
  subject: string
  date: string
  body: string
  priority: 'urgent' | 'important' | 'normal'
  category: string | null
  isHandled: boolean
  isRead: boolean
  account: { email: string; label: string }
}

const PRIORITY_CONFIG = {
  urgent: { label: 'Urgent', color: 'bg-red-500', text: 'text-red-400', badge: 'bg-red-900/50 text-red-300 border border-red-700' },
  important: { label: 'Important', color: 'bg-yellow-500', text: 'text-yellow-400', badge: 'bg-yellow-900/50 text-yellow-300 border border-yellow-700' },
  normal: { label: 'Normal', color: 'bg-blue-500', text: 'text-blue-400', badge: 'bg-blue-900/50 text-blue-300 border border-blue-700' },
}

export default function InboxPage() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [emails, setEmails] = useState<Email[]>([])
  const [selected, setSelected] = useState<Email | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'urgent' | 'important'>('all')
  const [showHandled, setShowHandled] = useState(false)
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [lastSync, setLastSync] = useState<Date | null>(new Date())
  const [newAccount, setNewAccount] = useState({ email: '', label: '', password: '' })
  const [stats, setStats] = useState<{ priority: string; _count: number }[]>([])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [accRes, emailRes] = await Promise.all([
        fetch('/api/inbox/accounts'),
        fetch(`/api/inbox?${filter !== 'all' ? `priority=${filter}` : ''}`),
      ])
      const accData = await accRes.json()
      const emailData = await emailRes.json()
      setAccounts(Array.isArray(accData) ? accData : [])
      setEmails(emailData.emails || [])
      setStats(emailData.stats || [])
    } finally {
      setLoading(false)
    }
  }, [filter, showHandled])

  useEffect(() => { loadData() }, [loadData])

  // Auto-sync all accounts every 5 minutes
  useEffect(() => {
    const autoSync = async () => {
      const accRes = await fetch('/api/inbox/accounts')
      const accounts = await accRes.json()
      if (!Array.isArray(accounts)) return
      for (const acc of accounts) {
        await fetch('/api/inbox/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: acc.id }),
        })
      }
      await loadData()
      setLastSync(new Date())
    }
    const interval = setInterval(autoSync, 5 * 60 * 1000) // every 5 minutes
    return () => clearInterval(interval)
  }, [loadData])

  const syncAccount = async (accountId: string) => {
    setSyncing(accountId)
    try {
      const res = await fetch('/api/inbox/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId }),
      })
      const data = await res.json()
      if (data.error) alert('Sync failed: ' + data.error)
      else { await loadData(); setLastSync(new Date()); }
    } finally {
      setSyncing(null)
    }
  }

  const addAccount = async () => {
    if (!newAccount.email || !newAccount.password) return
    await fetch('/api/inbox/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newAccount, label: newAccount.label || newAccount.email }),
    })
    setNewAccount({ email: '', label: '', password: '' })
    setShowAddAccount(false)
    await loadData()
  }

  const markAsRead = async (email: Email) => {
    if (email.isRead) return
    await fetch('/api/inbox', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: email.id, isRead: true }),
    })
    setEmails(prev => prev.map(e => e.id === email.id ? { ...e, isRead: true } : e))
  }

  const markHandled = async (id: string) => {
    await fetch('/api/inbox', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, isHandled: true, isRead: true }),
    })
    setEmails(prev => prev.filter(e => e.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  const urgentCount = stats.find(s => s.priority === 'urgent')?._count || 0
  const importantCount = stats.find(s => s.priority === 'important')?._count || 0

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950 text-white">
      <Sidebar />
      <div className="flex flex-1 overflow-hidden">
      {/* Left panel */}
      <div className="w-80 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-800">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-lg font-bold text-white">📬 Inbox</h1>
              {lastSync && <p className="text-gray-600 text-xs">Synced {lastSync.toLocaleTimeString()}</p>}
            </div>
            <button
              onClick={() => setShowAddAccount(true)}
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded"
            >
              + Account
            </button>
          </div>
          {/* Stats */}
          <div className="flex gap-2">
            {urgentCount > 0 && (
              <span className="text-xs bg-red-900/50 text-red-300 border border-red-700 px-2 py-0.5 rounded-full">
                🔴 {urgentCount} urgent
              </span>
            )}
            {importantCount > 0 && (
              <span className="text-xs bg-yellow-900/50 text-yellow-300 border border-yellow-700 px-2 py-0.5 rounded-full">
                🟡 {importantCount} important
              </span>
            )}
          </div>
        </div>

        {/* Accounts */}
        {accounts.length > 0 && (
          <div className="p-3 border-b border-gray-800 space-y-1">
            {accounts.map(acc => (
              <div key={acc.id} className="flex items-center justify-between text-sm">
                <div>
                  <p className="text-white font-medium">{acc.label}</p>
                  <p className="text-gray-500 text-xs">{acc.email}</p>
                </div>
                <button
                  onClick={() => syncAccount(acc.id)}
                  disabled={syncing === acc.id}
                  className="text-xs text-blue-400 hover:text-blue-300 ml-2"
                >
                  {syncing === acc.id ? '⏳' : '🔄'}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="p-3 border-b border-gray-800 space-y-1">
          {(['all', 'urgent', 'important'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`w-full text-left px-3 py-1.5 rounded text-sm capitalize transition-colors ${
                filter === f ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              {f === 'all' ? '📥 All' : f === 'urgent' ? '🔴 Urgent' : '🟡 Important'}
            </button>
          ))}
          <button
            onClick={() => setShowHandled(!showHandled)}
            className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
              showHandled ? 'bg-gray-700 text-white' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
            }`}
          >
            ✅ {showHandled ? 'Hide' : 'Show'} handled
          </button>
        </div>

        {/* Email list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-gray-500 text-sm">Loading...</div>
          ) : emails.length === 0 ? (
            <div className="p-4 text-center">
              <p className="text-gray-500 text-sm">No emails</p>
              {accounts.length === 0 && (
                <p className="text-gray-600 text-xs mt-2">Add an email account to get started</p>
              )}
            </div>
          ) : (
            emails.map(email => (
              <div
                key={email.id}
                onClick={() => { setSelected(email); markAsRead(email); }}
                className={`p-3 border-b border-gray-800 cursor-pointer hover:bg-gray-800 transition-colors ${
                  selected?.id === email.id ? 'bg-gray-800' : ''
                } ${email.isHandled ? 'opacity-50' : ''}`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${PRIORITY_CONFIG[email.priority].badge}`}>
                    {email.priority}
                  </span>
                  {email.category && (
                    <span className="text-xs text-gray-500">{email.category}</span>
                  )}
                </div>
                <p className={`text-sm truncate ${email.isRead ? 'text-gray-400 font-normal' : 'text-white font-bold'}`}>{email.subject}</p>
                <p className="text-gray-400 text-xs truncate mt-0.5">{email.from.split('<')[0].trim()}</p>
                <p className="text-gray-600 text-xs mt-0.5">{new Date(email.date).toLocaleDateString()}</p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right panel - email body */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selected ? (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="flex items-start justify-between p-6 pb-4 shrink-0">
              <div className="flex-1">
                <h2 className="text-xl font-bold text-white mb-1">{selected.subject}</h2>
                <p className="text-gray-400 text-sm">From: {selected.from}</p>
                <p className="text-gray-500 text-xs mt-0.5">
                  {new Date(selected.date).toLocaleString()} · {selected.account.label} · {selected.category}
                </p>
              </div>
              <div className="flex gap-2 ml-4">
                <span className={`text-xs px-2 py-1 rounded ${PRIORITY_CONFIG[selected.priority].badge}`}>
                  {selected.priority}
                </span>
                {!selected.isHandled && (
                  <button
                    onClick={() => markHandled(selected.id)}
                    className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1 rounded"
                  >
                    ✓ Mark Handled
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 mx-6 mb-6 bg-white rounded-xl border border-gray-700 overflow-hidden">
              {selected.body.trim().startsWith('<') ? (
                <iframe
                  srcDoc={selected.body}
                  className="w-full h-full border-0"
                  style={{ width: '100%', height: '100%' }}
                  referrerPolicy="no-referrer"
                  title="Email content"
                  onLoad={() => {}}
                />
              ) : (
                <div className="p-6 text-gray-800 text-sm whitespace-pre-wrap leading-relaxed font-sans">
                  {selected.body}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-600">
            <div className="text-center">
              <p className="text-4xl mb-3">📬</p>
              <p>Select an email to read</p>
            </div>
          </div>
        )}
      </div>

      {/* Add account modal */}
      {showAddAccount && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 rounded-xl p-6 w-96 border border-gray-700">
            <h3 className="text-lg font-bold text-white mb-4">Add Email Account</h3>
            <div className="space-y-3">
              <input
                type="email"
                placeholder="Email address"
                value={newAccount.email}
                onChange={e => setNewAccount(p => ({ ...p, email: e.target.value }))}
                className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm border border-gray-700"
              />
              <input
                type="text"
                placeholder="Label (e.g. Personal, Caribe)"
                value={newAccount.label}
                onChange={e => setNewAccount(p => ({ ...p, label: e.target.value }))}
                className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm border border-gray-700"
              />
              <input
                type="password"
                placeholder="App password"
                value={newAccount.password}
                onChange={e => setNewAccount(p => ({ ...p, password: e.target.value }))}
                className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm border border-gray-700"
              />
              <p className="text-gray-500 text-xs">Use a Gmail App Password, not your regular password</p>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={addAccount} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium">
                Add Account
              </button>
              <button onClick={() => setShowAddAccount(false)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg text-sm font-medium">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
