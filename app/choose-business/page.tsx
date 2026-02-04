'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'

interface Business {
  id: string
  name?: string
  slug: string
  owner_id?: string
}

export default function ChooseBusinessPage() {
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [ownedBusinessIds, setOwnedBusinessIds] = useState<string[]>([])
  const [selectedBusinessIds, setSelectedBusinessIds] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [newBusinessName, setNewBusinessName] = useState('')
  const [loading, setLoading] = useState(true)
  const [creatingBusiness, setCreatingBusiness] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [showOwnedBusinesses, setShowOwnedBusinesses] = useState(true)
  const [showAllBusinesses, setShowAllBusinesses] = useState(true)
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    const loadData = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        
        if (!user) {
          router.push('/auth')
          return
        }

        setUserId(user.id)

        // Load all businesses
        const { data: biz, error: bizError } = await supabase
          .from('businesses')
          .select('*')
          .order('created_at', { ascending: false })

        if (bizError) {
          setError(bizError.message)
        } else {
          setBusinesses(biz || [])
          // Track which businesses user owns
          const owned = (biz || [])
            .filter(b => b.owner_id === user.id)
            .map(b => b.id)
          setOwnedBusinessIds(owned)
          // Preselect from localStorage if available
          try {
            const raw = localStorage.getItem('selectedBusinessIds')
            if (raw) {
              const parsed = JSON.parse(raw)
              if (Array.isArray(parsed)) {
                const valid = parsed.filter((id: any) => (biz || []).some(b => b.id === id))
                if (valid.length) setSelectedBusinessIds(valid)
              }
            }
          } catch {}
        }
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [supabase, router])

  const handleSelectBusiness = (bizId: string) => {
    setSelectedBusinessIds(prev => {
      if (prev.includes(bizId)) {
        return prev.filter(id => id !== bizId)
      } else {
        return [...prev, bizId]
      }
    })
  }

  const handleGoToBusinesses = () => {
    if (selectedBusinessIds.length === 0) {
      setError('Please select at least one business')
      return
    }
    // Persist selection locally
    try {
      localStorage.setItem('selectedBusinessIds', JSON.stringify(selectedBusinessIds))
    } catch {}
    // Redirect to home with first selected business
    router.push(`/?businessId=${selectedBusinessIds[0]}`)
  }

  const handleCreateBusiness = async () => {
    if (!newBusinessName.trim()) {
      setError('Business name is required')
      return
    }

    if (!userId) {
      setError('User not authenticated')
      return
    }

    setCreatingBusiness(true)
    setError(null)

    try {
      const slug = newBusinessName
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '') || `biz-${Date.now()}`

      const { data: newBiz, error: bizError } = await supabase
        .from('businesses')
        .insert({
          name: newBusinessName.trim(),
          slug,
          owner_id: userId,
        })
        .select()
        .single()

      if (bizError) {
        setError(bizError.message)
        return
      }

      // Redirect to home with new business
      router.push(`/?businessId=${newBiz.id}`)
    } finally {
      setCreatingBusiness(false)
    }
  }

  // Filter businesses based on search query
  const filteredBusinesses = businesses.filter(b => {
    const query = searchQuery.toLowerCase()
    return (b.name?.toLowerCase().includes(query) || b.slug?.toLowerCase().includes(query))
  })

  // Separate owned and other businesses
  const ownedBusinesses = filteredBusinesses.filter(b => ownedBusinessIds.includes(b.id))
  const otherBusinesses = filteredBusinesses.filter(b => !ownedBusinessIds.includes(b.id))

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-600 to-purple-600 rounded-2xl mb-6 shadow-lg">
            <span className="text-3xl">🏢</span>
          </div>
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Choose Your Business</h1>
          <p className="text-slate-600">Select a business to manage or create a new one</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 text-sm">
            {error}
          </div>
        )}

        {/* Search Bar */}
        <div className="mb-8">
          <input
            type="text"
            placeholder="Search businesses by name or slug..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all text-slate-900 placeholder-slate-400"
          />
        </div>

        {/* Selected Businesses Info & Action Button */}
        {selectedBusinessIds.length > 0 && (
          <div className="mb-8 p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-blue-900">
                  {selectedBusinessIds.length} business{selectedBusinessIds.length !== 1 ? 'es' : ''} selected
                </p>
                <p className="text-xs text-blue-700 mt-1">
                  {businesses.filter(b => selectedBusinessIds.includes(b.id)).map(b => b.name || b.slug).join(', ')}
                </p>
              </div>
              <button
                onClick={handleGoToBusinesses}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg font-bold text-sm hover:bg-blue-700 transition-all whitespace-nowrap ml-4"
              >
                ➜ Go to Selected
              </button>
            </div>
          </div>
        )}

        {/* Create New Business - Moved Higher */}
        <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-2xl shadow-lg p-8 border-2 border-dashed border-blue-200 mb-12">
          <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
            <span>✨</span> Create New Business
          </h2>
          <p className="text-sm text-slate-600 mb-4">
            Create a new business to start organizing your ad campaigns
          </p>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Business Name
              </label>
              <input
                type="text"
                value={newBusinessName}
                onChange={e => setNewBusinessName(e.target.value)}
                placeholder="e.g., My E-commerce Store"
                className="w-full px-4 py-3 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all text-slate-900"
              />
            </div>
            
            <button
              onClick={handleCreateBusiness}
              disabled={creatingBusiness || !newBusinessName.trim()}
              className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl font-bold hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:-translate-y-1 active:translate-y-0"
            >
              {creatingBusiness ? '🔄 Creating...' : '➕ Create Business'}
            </button>
          </div>
        </div>

        {/* Your Businesses */}
        {ownedBusinesses.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900">Your Businesses</h2>
              <button
                onClick={() => setShowOwnedBusinesses(!showOwnedBusinesses)}
                className="px-3 py-1 text-xs font-bold text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-all"
              >
                {showOwnedBusinesses ? '▼ Hide' : '▶ Show'}
              </button>
            </div>
            {showOwnedBusinesses && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {ownedBusinesses.map(biz => {
                  const isSelected = selectedBusinessIds.includes(biz.id)
                  return (
                    <div
                      key={biz.id}
                      onClick={() => handleSelectBusiness(biz.id)}
                      className={`p-6 rounded-2xl border-2 cursor-pointer transition-all transform ${
                        isSelected
                          ? 'bg-blue-50 border-blue-400 shadow-lg -translate-y-1'
                          : 'bg-white border-slate-200 shadow-sm hover:border-blue-400 hover:shadow-lg hover:-translate-y-1'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <h3 className="text-lg font-bold text-slate-900">{biz.name || biz.slug}</h3>
                          <p className="text-xs text-slate-500 mt-1">Slug: {biz.slug}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xl">📊</span>
                          {isSelected && (
                            <span className="inline-flex items-center justify-center w-6 h-6 bg-blue-600 text-white text-sm font-bold rounded-full">
                              ✓
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <span className="inline-block px-3 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-lg">
                          Owner
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Other Businesses */}
        {otherBusinesses.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">All Businesses</h2>
                <p className="text-sm text-slate-600 mt-1">You can view these businesses but cannot edit them</p>
              </div>
              <button
                onClick={() => setShowAllBusinesses(!showAllBusinesses)}
                className="px-3 py-1 text-xs font-bold text-purple-700 bg-purple-50 rounded-lg hover:bg-purple-100 transition-all whitespace-nowrap ml-4"
              >
                {showAllBusinesses ? '▼ Hide' : '▶ Show'}
              </button>
            </div>
            {showAllBusinesses && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {otherBusinesses.map(biz => {
                  const isSelected = selectedBusinessIds.includes(biz.id)
                  return (
                    <div
                      key={biz.id}
                      onClick={() => handleSelectBusiness(biz.id)}
                      className={`p-6 rounded-2xl border-2 cursor-pointer transition-all transform ${
                        isSelected
                          ? 'bg-purple-50 border-purple-400 shadow-lg -translate-y-1'
                          : 'bg-white border-slate-200 shadow-sm hover:border-purple-400 hover:shadow-lg hover:-translate-y-1'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <h3 className="text-lg font-bold text-slate-900">{biz.name || biz.slug}</h3>
                          <p className="text-xs text-slate-500 mt-1">Slug: {biz.slug}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xl">📈</span>
                          {isSelected && (
                            <span className="inline-flex items-center justify-center w-6 h-6 bg-purple-600 text-white text-sm font-bold rounded-full">
                              ✓
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <span className="inline-block px-3 py-1 bg-purple-50 text-purple-700 text-xs font-bold rounded-lg">
                          Viewable
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* No Results */}
        {searchQuery && filteredBusinesses.length === 0 && (
          <div className="mb-8 p-6 bg-slate-50 rounded-2xl border border-slate-200 text-center">
            <p className="text-slate-600">No businesses found matching &quot;{searchQuery}&quot;</p>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center">
          <button
            onClick={() => router.push('/auth?action=logout')}
            className="text-sm text-slate-600 hover:text-slate-900 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
