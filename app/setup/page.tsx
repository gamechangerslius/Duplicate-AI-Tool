'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'

interface Competitor {
  id: string
  fb_page_url: string
  page_name: string
  niche_group: string
  is_active: boolean
}

export default function SetupPage() {
  const [user, setUser] = useState<any>(null)
  const [businessName, setBusinessName] = useState('')
  const [competitors, setCompetitors] = useState<Competitor[]>([])
  const [newCompetitor, setNewCompetitor] = useState({ url: '', niche: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [tablesExist, setTablesExist] = useState(true)
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    checkUser()
  }, [])

  async function checkUser() {
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      router.push('/auth')
      return
    }

    setUser(user)
    await loadClientData(user.id)
    setLoading(false)
  }

  async function loadClientData(userId: string) {
    try {
      // Load business info
      const { data: business, error } = await supabase
        .from('businesses')
        .select('*')
        .eq('owner_id', userId)
        .single()

      if (error) {
        // If table doesn't exist, show warning
        if (error.message?.includes('relation') || error.code === '42P01') {
          setTablesExist(false)
          return
        }
        throw error
      }

      if (business) {
        setBusinessName(business.name || '')
        
        // Load competitors
        const { data: comps } = await supabase
          .from('competitors')
          .select('*')
          .eq('business_id', business.id)
          .order('created_at', { ascending: false })
        
        if (comps) setCompetitors(comps)
      }
    } catch (err) {
      console.error('Error loading business data:', err)
      setTablesExist(false)
    }
  }

  async function handleSaveClient() {
    if (!user) return
    setSaving(true)

    try {
      // Upsert business
      const { data: business, error } = await supabase
        .from('businesses')
        .upsert({
          owner_id: user.id,
          name: businessName,
          slug: businessName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
        }, { onConflict: 'owner_id' })
        .select()
        .single()

      if (error) throw error
      alert('✅ Business info saved!')
    } catch (err: any) {
      alert('❌ Error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleAddCompetitor() {
    if (!user || !newCompetitor.url.trim()) return
    setSaving(true)

    try {
      // Get business_id
      const { data: business } = await supabase
        .from('businesses')
        .select('id')
        .eq('owner_id', user.id)
        .single()

      if (!business) {
        alert('Please save business info first')
        return
      }

      const { data, error } = await supabase
        .from('competitors')
        .insert({
          business_id: business.id,
          fb_page_url: newCompetitor.url.trim(),
          niche_group: newCompetitor.niche.trim() || 'Default',
          is_active: true
        })
        .select()
        .single()

      if (error) throw error

      setCompetitors([data, ...competitors])
      setNewCompetitor({ url: '', niche: '' })
      alert('✅ Competitor added!')
    } catch (err: any) {
      alert('❌ Error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteCompetitor(id: string) {
    if (!confirm('Delete this competitor?')) return
    
    const { error } = await supabase
      .from('competitors')
      .delete()
      .eq('id', id)

    if (error) {
      alert('Error: ' + error.message)
    } else {
      setCompetitors(competitors.filter(c => c.id !== id))
    }
  }

  async function handleToggleActive(id: string, currentState: boolean) {
    const { error } = await supabase
      .from('competitors')
      .update({ is_active: !currentState })
      .eq('id', id)

    if (error) {
      alert('Error: ' + error.message)
    } else {
      setCompetitors(competitors.map(c => 
        c.id === id ? { ...c, is_active: !currentState } : c
      ))
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container mx-auto px-6 py-12 max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Setup</h1>
            <p className="text-slate-600 mt-1">Configure your business and competitors</p>
          </div>
          <button
            onClick={() => router.push('/')}
            className="px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg transition"
          >
            ← Back to Gallery
          </button>
        </div>

        {/* Warning if tables don't exist */}
        {!tablesExist && (
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-6 mb-6 rounded-lg">
            <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h3 className="text-lg font-semibold text-yellow-900 mb-2">Database Setup Required</h3>
                <p className="text-yellow-800 mb-3">
                  The client management tables have not been created yet. Please run the SQL migration first:
                </p>
                <ol className="list-decimal list-inside text-yellow-800 space-y-1 mb-4">
                  <li>Open Supabase Dashboard → SQL Editor</li>
                  <li>Run the file: <code className="bg-yellow-100 px-2 py-0.5 rounded">supabase/setup_client_system.sql</code></li>
                  <li>Refresh this page</li>
                </ol>
                <a 
                  href="/DEPLOYMENT.md" 
                  target="_blank"
                  className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium"
                >
                  📄 View Deployment Guide
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Business Info Section */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-xl font-semibold text-slate-900 mb-4">Business Information</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Email
              </label>
              <input
                type="email"
                value={user?.email || ''}
                disabled
                className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-slate-50 text-slate-600"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Business Name
              </label>
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="My Company"
                disabled={!tablesExist}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none disabled:bg-slate-50 disabled:text-slate-400"
              />
            </div>
            <button
              onClick={handleSaveClient}
              disabled={saving || !tablesExist}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save Business Info'}
            </button>
          </div>
        </div>

        {/* Competitors Section */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-xl font-semibold text-slate-900 mb-4">Competitors</h2>
          
          {/* Add New Competitor */}
          <div className="mb-6 p-4 bg-slate-50 rounded-lg">
            <h3 className="text-sm font-medium text-slate-700 mb-3">Add New Competitor</h3>
            <div className="flex gap-3">
              <input
                type="text"
                value={newCompetitor.url}
                onChange={(e) => setNewCompetitor({ ...newCompetitor, url: e.target.value })}
                placeholder="Facebook Page URL or Ads Library link"
                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <input
                type="text"
                value={newCompetitor.niche}
                onChange={(e) => setNewCompetitor({ ...newCompetitor, niche: e.target.value })}
                placeholder="Niche (optional)"
                className="w-40 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <button
                onClick={handleAddCompetitor}
                disabled={saving || !newCompetitor.url.trim()}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50 whitespace-nowrap"
              >
                + Add
              </button>
            </div>
          </div>

          {/* Competitors List */}
          <div className="space-y-3">
            {competitors.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                No competitors added yet. Add your first competitor above.
              </div>
            ) : (
              competitors.map((comp) => (
                <div
                  key={comp.id}
                  className={`flex items-center gap-4 p-4 border rounded-lg transition ${
                    comp.is_active ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-60'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <a
                        href={comp.fb_page_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline font-medium truncate"
                      >
                        {comp.page_name || comp.fb_page_url}
                      </a>
                      {comp.niche_group && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-purple-100 text-purple-700">
                          {comp.niche_group}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 truncate">{comp.fb_page_url}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleActive(comp.id, comp.is_active)}
                      className={`px-3 py-1 rounded text-xs font-medium transition ${
                        comp.is_active
                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                          : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                      }`}
                    >
                      {comp.is_active ? 'Active' : 'Inactive'}
                    </button>
                    <button
                      onClick={() => handleDeleteCompetitor(comp.id)}
                      className="px-3 py-1 rounded text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 transition"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Summary */}
          {competitors.length > 0 && (
            <div className="mt-6 pt-6 border-t border-slate-200">
              <div className="flex gap-6 text-sm">
                <div>
                  <span className="text-slate-600">Total:</span>
                  <span className="ml-2 font-semibold text-slate-900">{competitors.length}</span>
                </div>
                <div>
                  <span className="text-slate-600">Active:</span>
                  <span className="ml-2 font-semibold text-green-600">
                    {competitors.filter(c => c.is_active).length}
                  </span>
                </div>
                <div>
                  <span className="text-slate-600">Niches:</span>
                  <span className="ml-2 font-semibold text-purple-600">
                    {new Set(competitors.map(c => c.niche_group)).size}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
