'use client'
import { useEffect, useMemo, useState } from 'react'
import { FormControl, InputLabel, Select, MenuItem, Checkbox, ListItemText, OutlinedInput } from '@mui/material'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'

export default function AuthPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<'auth' | 'business'>('auth')
  const [userId, setUserId] = useState<string | null>(null)
  const [businesses, setBusinesses] = useState<{ id: string; name: string; slug: string }[]>([])
  const [selectedBusinessIds, setSelectedBusinessIds] = useState<string[]>([])
  const [newBusinessName, setNewBusinessName] = useState('')
  const [loadingBusinesses, setLoadingBusinesses] = useState(false)
  const [savingBusiness, setSavingBusiness] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  const slugify = (val: string) => {
    const base = val.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    if (base) return base
    return `biz-${Date.now()}`
  }

  const businessOptions = useMemo(() => businesses, [businesses])

  const loadBusinesses = async (uid: string) => {
    setLoadingBusinesses(true)
    try {
      const ownedPromise = supabase
        .from('businesses')
        .select('id, name, slug')
        .eq('owner_id', uid)

      const accessPromise = supabase
        .from('business_access')
        .select('businesses(id, name, slug)')
        .eq('user_id', uid)

      const [{ data: owned }, { data: access }] = await Promise.all([ownedPromise, accessPromise])

      const merged: { id: string; name: string; slug: string }[] = []
      for (const row of owned || []) merged.push(row as any)
      for (const row of access || []) {
        const biz = (row as any).businesses
        if (biz) merged.push(biz)
      }
      const uniq = new Map<string, { id: string; name: string; slug: string }>()
      merged.forEach((b) => uniq.set(b.id, b))
      const list = Array.from(uniq.values())
      setBusinesses(list)
      if (list.length > 0) {
        setSelectedBusinessIds([list[0].id])
      }
    } finally {
      setLoadingBusinesses(false)
    }
  }

  const handleAuth = async () => {
    setLoading(true)
    setError(null)

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({ 
          email, 
          password,
          options: {
            data: {
              full_name: name,
            }
          }
        })
        
        if (error) {
          setError(error.message)
        } else if (data?.user) {
          setError('Check your email to confirm your account!')
          setTimeout(() => {
            setIsSignUp(false)
            setError(null)
          }, 3000)
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        
        if (error) {
          setError(error.message)
        } else {
          const uid = data?.user?.id || (await supabase.auth.getUser()).data.user?.id
          if (!uid) {
            setError('Cannot load user session. Please try again.')
            return
          }
          setUserId(uid)
          await loadBusinesses(uid)
          setStep('business')
        }
      }
    } catch (err) {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      handleAuth()
    }
  }

  const handleBusinessContinue = async () => {
    if (!userId) {
      setError('User session missing. Please sign in again.')
      setStep('auth')
      return
    }

    const trimmed = newBusinessName.trim()
    const selectedList = selectedBusinessIds.filter(Boolean)
    const businessIdToUse = selectedList[0] || businesses[0]?.id || ''

    // If user typed a new business, create it
    if (trimmed) {
      setSavingBusiness(true)
      try {
        const slug = slugify(trimmed)
        const { data, error } = await supabase
          .from('businesses')
          .insert({ owner_id: userId, name: trimmed, slug })
          .select('id')
          .single()

        if (error || !data) {
          setError(error?.message || 'Could not create business')
          return
        }
        router.push(`/?businessId=${data.id}`)
        return
      } finally {
        setSavingBusiness(false)
      }
    }

    if (!businessIdToUse) {
      setError('Select or create a business to continue')
      return
    }

    // Pass multiple business ids as comma-separated for downstream use
    const idsParam = selectedList.length ? selectedList.join(',') : businessIdToUse
    router.push(`/?businessId=${idsParam}`)
  }

  if (step === 'business') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4 shadow-lg">
              <span className="text-3xl">🏢</span>
            </div>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Choose your business</h1>
            <p className="text-slate-600">Pick an existing business or create a new one</p>
          </div>

          <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-200 space-y-4">
            {error && (
              <div className="p-3 rounded-xl bg-red-50 text-red-800 border border-red-200 text-sm">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Existing businesses (select one or more)</label>
              <FormControl fullWidth disabled={loadingBusinesses || businessOptions.length === 0}>
                <InputLabel id="business-multi-label">Businesses</InputLabel>
                <Select
                  labelId="business-multi-label"
                  multiple
                  value={selectedBusinessIds}
                  onChange={(e) => setSelectedBusinessIds(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
                  input={<OutlinedInput label="Businesses" />}
                  renderValue={(selected) => businessOptions
                    .filter((b) => (selected as string[]).includes(b.id))
                    .map((b) => b.name)
                    .join(', ') || 'None selected'}
                >
                  {businessOptions.map((b) => (
                    <MenuItem key={b.id} value={b.id}>
                      <Checkbox checked={selectedBusinessIds.indexOf(b.id) > -1} />
                      <ListItemText primary={b.name} />
                    </MenuItem>
                  ))}
                  {businessOptions.length === 0 && (
                    <MenuItem disabled value="">
                      <ListItemText primary="No businesses found" />
                    </MenuItem>
                  )}
                </Select>
              </FormControl>
              <p className="text-xs text-slate-500">Use Ctrl/Cmd or Shift to select multiple.</p>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Or create new</label>
              <input
                type="text"
                value={newBusinessName}
                onChange={(e) => setNewBusinessName(e.target.value)}
                placeholder="My New Business"
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 outline-none"
              />
              <p className="text-xs text-slate-500">If you enter a name, we will create it for you.</p>
            </div>

            <button
              onClick={handleBusinessContinue}
              disabled={savingBusiness || loadingBusinesses}
              className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingBusiness ? 'Saving...' : 'Continue'}
            </button>

            <button
              onClick={() => { setStep('auth'); setError(null); }}
              className="w-full text-sm text-slate-500 hover:text-slate-700"
            >
              ← Back to login
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4 shadow-lg">
            <span className="text-3xl">📚</span>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            {isSignUp ? 'Create Account' : 'Welcome Back'}
          </h1>
          <p className="text-slate-600">
            {isSignUp ? 'Sign up to access the ad library' : 'Sign in to your account'}
          </p>
        </div>

        {/* Auth Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-200">
          <div className="space-y-5">
            {/* Name field (only for sign up) */}
            {isSignUp && (
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-2">
                  Full Name
                </label>
                <input
                  id="name"
                  type="text"
                  placeholder="John Doe"
                  className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 outline-none transition placeholder-slate-400"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyPress={handleKeyPress}
                />
              </div>
            )}

            {/* Email field */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-2">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                placeholder="you@example.com"
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 outline-none transition placeholder-slate-400"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyPress={handleKeyPress}
              />
            </div>

            {/* Password field */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                placeholder="••••••••"
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 outline-none transition placeholder-slate-400"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyPress={handleKeyPress}
              />
              {!isSignUp && (
                <div className="mt-2 text-right">
                  <button className="text-sm text-blue-600 hover:text-blue-700 hover:underline">
                    Forgot password?
                  </button>
                </div>
              )}
            </div>

            {/* Error message */}
            {error && (
              <div className={`p-4 rounded-xl text-sm ${
                error.includes('Check your email') 
                  ? 'bg-green-50 text-green-800 border border-green-200' 
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}>
                {error}
              </div>
            )}

            {/* Submit button */}
            <button 
              onClick={handleAuth}
              disabled={loading}
              className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Processing...
                </span>
              ) : (
                isSignUp ? 'Create Account' : 'Sign In'
              )}
            </button>

            {/* Toggle between sign in/sign up */}
            <div className="text-center pt-4 border-t border-slate-200">
              <p className="text-slate-600 text-sm">
                {isSignUp ? 'Already have an account?' : "Don't have an account?"}
                {' '}
                <button 
                  onClick={() => {
                    setIsSignUp(!isSignUp)
                    setError(null)
                    setName('')
                  }}
                  className="text-blue-600 font-semibold hover:text-blue-700 hover:underline"
                >
                  {isSignUp ? 'Sign In' : 'Sign Up'}
                </button>
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-slate-500">
          <p>By continuing, you agree to our Terms of Service and Privacy Policy</p>
        </div>
      </div>
    </div>
  )
}