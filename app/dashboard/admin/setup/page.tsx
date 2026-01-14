'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { isUserAdmin } from '@/utils/supabase/admin';
import Link from 'next/link';

interface Business {
  id: string;
  slug: string;
  name?: string;
}

interface SetupResult {
  businessId: string;
  businessName: string;
  status: 'idle' | 'running' | 'success' | 'error';
  message?: string;
  timestamp?: string;
}

export default function AdminSetupPage() {
  const router = useRouter();
  const supabase = createClient();
  
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [results, setResults] = useState<Map<string, SetupResult>>(new Map());
  const [isRunning, setIsRunning] = useState(false);

  const loadBusinesses = useCallback(async () => {
    const { data, error } = await supabase
      .from('businesses')
      .select('id, slug, name')
      .order('name', { ascending: true });

    if (!error && data) {
      setBusinesses(data);
      // Initialize results map
      const newResults = new Map<string, SetupResult>();
      data.forEach(biz => {
        newResults.set(biz.id, {
          businessId: biz.id,
          businessName: biz.name || biz.slug,
          status: 'idle',
        });
      });
      setResults(newResults);
    }
  }, [supabase]);

  // Check admin access
  useEffect(() => {
    const checkAdmin = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        router.push('/auth');
        return;
      }

      const adminStatus = await isUserAdmin(user.id);
      if (!adminStatus) {
        router.push('/');
        return;
      }

      setIsAdmin(true);
      loadBusinesses();
      setLoading(false);
    };

    checkAdmin();
  }, [supabase.auth, router, loadBusinesses]);

  const runSetupForBusiness = async (businessId: string, businessName: string) => {
    const newResults = new Map(results);
    newResults.set(businessId, {
      businessId,
      businessName,
      status: 'running',
      message: 'Initializing...',
      timestamp: new Date().toLocaleString(),
    });
    setResults(newResults);

    try {
      // Call the setup endpoint with businessId
      const response = await fetch('/api/admin/setup-business', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(error.message || 'Setup failed');
      }

      const data = await response.json();

      newResults.set(businessId, {
        businessId,
        businessName,
        status: 'success',
        message: data.message || 'Setup completed successfully',
        timestamp: new Date().toLocaleString(),
      });
    } catch (err: any) {
      newResults.set(businessId, {
        businessId,
        businessName,
        status: 'error',
        message: err.message || 'Setup failed',
        timestamp: new Date().toLocaleString(),
      });
    }

    setResults(newResults);
  };

  const runSetupForAllBusinesses = async () => {
    setIsRunning(true);

    // Run all setups in parallel
    const promises = businesses.map(biz =>
      runSetupForBusiness(biz.id, biz.name || biz.slug)
    );

    await Promise.all(promises);
    setIsRunning(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-lg p-8 text-center max-w-md">
          <p className="text-slate-600 mb-4">Access denied. Admin only.</p>
          <Link href="/" className="text-blue-600 hover:text-blue-700 font-medium">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="container mx-auto px-6">
        <div className="mb-8">
          <Link href="/" className="text-blue-600 hover:text-blue-700 font-medium mb-4 inline-block">
            ← Back to Gallery
          </Link>
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Admin: Setup Management</h1>
          <p className="text-slate-600">Run setup processes for all businesses</p>
        </div>

        {/* Control panel */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-slate-600 mb-1">
                {businesses.length} businesses available
              </p>
              <p className="text-2xl font-bold text-slate-900">{businesses.length}</p>
            </div>
            <button
              onClick={runSetupForAllBusinesses}
              disabled={isRunning}
              className={`px-6 py-3 rounded-lg font-semibold text-white transition-all ${
                isRunning
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700 shadow-lg'
              }`}
            >
              {isRunning ? '⏳ Running...' : '▶️ Run Setup for All'}
            </button>
          </div>
        </div>

        {/* Businesses grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {businesses.map(biz => {
            const result = results.get(biz.id);
            const statusColor = !result
              ? 'bg-slate-50 border-slate-200'
              : result.status === 'idle'
              ? 'bg-slate-50 border-slate-200'
              : result.status === 'running'
              ? 'bg-blue-50 border-blue-200'
              : result.status === 'success'
              ? 'bg-green-50 border-green-200'
              : 'bg-red-50 border-red-200';

            const statusIcon = !result
              ? '⚪'
              : result.status === 'idle'
              ? '⚪'
              : result.status === 'running'
              ? '🔵'
              : result.status === 'success'
              ? '✅'
              : '❌';

            return (
              <div
                key={biz.id}
                className={`border-2 rounded-lg p-4 transition-all ${statusColor}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="font-semibold text-slate-900">{biz.name || biz.slug}</h3>
                    <p className="text-xs text-slate-500 mt-1">{biz.id}</p>
                  </div>
                  <span className="text-2xl">{statusIcon}</span>
                </div>

                {result?.message && (
                  <p className="text-sm text-slate-600 mb-2">{result.message}</p>
                )}

                {result?.timestamp && (
                  <p className="text-xs text-slate-500 mb-3">{result.timestamp}</p>
                )}

                <button
                  onClick={() => runSetupForBusiness(biz.id, biz.name || biz.slug)}
                  disabled={isRunning || result?.status === 'running'}
                  className={`w-full px-4 py-2 rounded font-medium text-sm transition-all ${
                    isRunning || result?.status === 'running'
                      ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                      : 'bg-blue-600 text-white hover:bg-blue-700 shadow'
                  }`}
                >
                  {result?.status === 'running' ? '⏳ Running...' : '▶️ Run Setup'}
                </button>
              </div>
            );
          })}
        </div>

        {businesses.length === 0 && (
          <div className="text-center py-12">
            <p className="text-slate-600">No businesses found</p>
          </div>
        )}
      </div>
    </div>
  );
}
