'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { isUserAdmin } from '@/utils/supabase/admin'

export function UserMenu() {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    // Get initial user
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      
      // Check if user is admin
      if (user?.id) {
        const adminStatus = await isUserAdmin(user.id)
        setIsAdmin(adminStatus)
      }
      
      setLoading(false)
    }
    getUser()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user?.id) {
        isUserAdmin(session.user.id).then(setIsAdmin)
      }
    })

    return () => subscription.unsubscribe()
  }, [supabase.auth])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/auth')
    router.refresh()
  }

  if (loading) {
    return (
      <div className="w-10 h-10 bg-slate-200 rounded-full animate-pulse"></div>
    )
  }

  if (!user) {
    return (
      <Link 
        href="/auth"
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"
      >
        Sign In
      </Link>
    )
  }

  // Get user initials
  const email = user.email || ''
  const name = user.user_metadata?.full_name || email
  const initials = name
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || email.slice(0, 2).toUpperCase()

  return (
    <div className="relative">
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors"
        onBlur={() => setTimeout(() => setDropdownOpen(false), 200)}
      >
        <div className="flex items-center justify-center w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full text-white font-semibold text-sm shadow-lg">
          {initials}
        </div>
        <div className="hidden md:block text-left">
          <div className="text-sm font-medium text-slate-900 truncate max-w-[150px]">
            {name}
          </div>
          <div className="text-xs text-slate-500 truncate max-w-[150px]">
            {email}
          </div>
        </div>
        <svg 
          className={`w-4 h-4 text-slate-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {dropdownOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-2xl border border-slate-200 py-2 z-50">
          <div className="px-4 py-3 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium text-slate-900 truncate">{name}</div>
              {isAdmin && (
                <span className="text-xs font-bold px-2 py-1 bg-yellow-100 text-yellow-800 rounded whitespace-nowrap">
                  👑 ADMIN
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500 truncate">{email}</div>
          </div>
          
          <div className="py-2">
            <Link
              href="/setup"
              className="flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Setup
            </Link>
            
            <Link
              href="/"
              className="flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
              Gallery
            </Link>
          </div>

          <div className="border-t border-slate-200 pt-2">
            <button
              onClick={handleSignOut}
              className="flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors w-full"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
