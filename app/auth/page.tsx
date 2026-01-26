'use client'
import { useEffect, useState, Suspense } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'

function AuthPageContent() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newBusinessName, setNewBusinessName] = useState('')
  const [creatingBusiness, setCreatingBusiness] = useState(false)
  const [showCreateBusiness, setShowCreateBusiness] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()

  const slugify = (val: string) => {
    const base = val.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    if (base) return base
    return `biz-${Date.now()}`
  }

  // Check if we should show create business form
  useEffect(() => {
    if (searchParams.get('action') === 'create-business') {
      setShowCreateBusiness(true)
    }
  }, [searchParams])

  const handleCreateBusiness = async () => {
    if (!newBusinessName.trim()) {
      setError('Business name is required')
      return
    }

    setCreatingBusiness(true)
    setError(null)

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError('You must be logged in to create a business')
        return
      }

      const slug = slugify(newBusinessName)

      // Create new business
      const { data: newBiz, error: bizError } = await supabase
        .from('businesses')
        .insert({
          name: newBusinessName.trim(),
          slug,
          owner_id: user.id,
        })
        .select()
        .single()

      if (bizError) {
        setError(bizError.message)
        return
      }

      // Redirect to returnTo URL or home with new business selected
      const returnTo = searchParams.get('returnTo')
      if (returnTo) {
        router.push(returnTo)
      } else {
        router.push(`/?businessId=${newBiz.id}`)
      }
    } finally {
      setCreatingBusiness(false)
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
          // Automatically switch to login form after successful signup
          setIsSignUp(false)
          setError(null)
          setEmail('')
          setPassword('')
          setName('')
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        
        if (error) {
          setError(error.message)
        } else {
          // Redirect to business chooser after successful login
          const returnTo = searchParams.get('returnTo')
          router.push(returnTo || '/choose-business')
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Show create business form if requested */}
        {showCreateBusiness && (
          <>
            {/* Logo/Header */}
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4 shadow-lg">
                <span className="text-3xl">🏢</span>
              </div>
              <h1 className="text-3xl font-bold text-slate-900 mb-2">Create New Business</h1>
              <p className="text-slate-600">Add a new business to your account</p>
            </div>

            {/* Create Business Card */}
            <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-200">
              <div className="space-y-5">
                {error && (
                  <div className="p-3 rounded-xl bg-red-50 text-red-800 border border-red-200 text-sm">
                    {error}
                  </div>
                )}

                <div>
                  <label htmlFor="business-name" className="block text-sm font-medium text-slate-700 mb-2">
                    Business Name
                  </label>
                  <input
                    id="business-name"
                    type="text"
                    placeholder="My Business Name"
                    className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 outline-none transition placeholder-slate-400"
                    value={newBusinessName}
                    onChange={(e) => setNewBusinessName(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && !creatingBusiness) {
                        handleCreateBusiness()
                      }
                    }}
                  />
                </div>

                <button
                  onClick={handleCreateBusiness}
                  disabled={creatingBusiness}
                  className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creatingBusiness ? 'Creating...' : 'Create Business'}
                </button>

                <button
                  onClick={() => {
                    setShowCreateBusiness(false);
                    setNewBusinessName('');
                    setError(null);
                  }}
                  className="w-full text-sm text-slate-500 hover:text-slate-700"
                >
                  ← Back to Home
                </button>
              </div>
            </div>
          </>
        )}

        {/* Show login/signup form if not creating business */}
        {!showCreateBusiness && (
          <>
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
        </>
        )}
      </div>
    </div>
  )
}

export default function AuthPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    }>
      <AuthPageContent />
    </Suspense>
  )
}