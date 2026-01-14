'use client'

import { useEffect, useState, useTransition, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { 
  Users, 
  UserPlus, 
  Mail, 
  Shield, 
  Trash2, 
  Crown,
  Loader2,
  ChevronDown
} from 'lucide-react'
import {
  getTeamMembers,
  inviteMember,
  removeMember,
  updateMemberRole,
  checkBusinessOwnership,
  type TeamMember
} from '@/app/actions/team'

// =====================================================
// Types & Schemas
// =====================================================

const inviteSchema = z.object({
  email: z.string().email('Invalid email address'),
  role: z.enum(['viewer', 'editor', 'admin']),
})

type InviteFormData = z.infer<typeof inviteSchema>

const roleColors = {
  owner: 'bg-purple-100 text-purple-800 border-purple-200',
  admin: 'bg-blue-100 text-blue-800 border-blue-200',
  editor: 'bg-green-100 text-green-800 border-green-200',
  viewer: 'bg-slate-100 text-slate-800 border-slate-200',
}

const roleLabels = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
}

// =====================================================
// Component
// =====================================================

export default function TeamSettingsPage({ params }: { params: { slug: string } }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [isOwner, setIsOwner] = useState(false)
  const [inviting, setInviting] = useState(false)
  
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteFormData>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: '',
      role: 'viewer',
    },
  })

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true)
    
    // Check ownership
    const ownershipResult = await checkBusinessOwnership(params.slug)
    if (ownershipResult.success) {
      setIsOwner(ownershipResult.data)
    }

    // Load members
    const membersResult = await getTeamMembers(params.slug)
    if (membersResult.success) {
      setMembers(membersResult.data)
    } else {
      toast.error(membersResult.error)
    }
    
    setLoading(false)
  }, [params.slug])

  // Load data on mount
  useEffect(() => {
    loadData()
  }, [loadData])

  // Invite member
  async function onSubmit(data: InviteFormData) {
    setInviting(true)
    
    const result = await inviteMember({
      businessSlug: params.slug,
      email: data.email,
      role: data.role,
    })

    if (result.success) {
      toast.success('Member invited successfully!')
      reset()
      loadData()
    } else {
      toast.error(result.error)
    }
    
    setInviting(false)
  }

  // Remove member
  async function handleRemove(accessId: string, email: string) {
    if (!confirm(`Remove ${email} from the team?`)) return

    startTransition(async () => {
      const result = await removeMember({
        businessSlug: params.slug,
        accessId,
      })

      if (result.success) {
        toast.success('Member removed')
        loadData()
      } else {
        toast.error(result.error)
      }
    })
  }

  // Update role
  async function handleRoleChange(accessId: string, newRole: 'viewer' | 'editor' | 'admin') {
    startTransition(async () => {
      const result = await updateMemberRole({
        businessSlug: params.slug,
        accessId,
        role: newRole,
      })

      if (result.success) {
        toast.success('Role updated')
        loadData()
      } else {
        toast.error(result.error)
      }
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header Skeleton */}
          <div className="h-8 w-64 bg-slate-200 rounded animate-pulse" />
          
          {/* Invite Form Skeleton */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
            <div className="h-6 w-48 bg-slate-200 rounded animate-pulse" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="h-10 bg-slate-100 rounded animate-pulse md:col-span-2" />
              <div className="h-10 bg-slate-100 rounded animate-pulse" />
            </div>
          </div>

          {/* Members List Skeleton */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-4 p-4 border border-slate-200 rounded-lg">
                <div className="h-10 w-10 bg-slate-200 rounded-full animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 bg-slate-200 rounded animate-pulse" />
                  <div className="h-3 w-24 bg-slate-100 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Users className="w-8 h-8 text-slate-900" />
          <h1 className="text-3xl font-bold text-slate-900">Team Management</h1>
        </div>

        {/* Invite Member Form - Only for Owner */}
        {isOwner && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-slate-700" />
                <h2 className="text-lg font-semibold text-slate-900">Invite Team Member</h2>
              </div>
              <p className="text-sm text-slate-600 mt-1">
                Add new members to collaborate on this business
              </p>
            </div>
            
            <form onSubmit={handleSubmit(onSubmit)} className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Email Input */}
                <div className="md:col-span-2">
                  <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-2">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      id="email"
                      type="email"
                      {...register('email')}
                      placeholder="colleague@example.com"
                      className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                    />
                  </div>
                  {errors.email && (
                    <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
                  )}
                </div>

                {/* Role Select */}
                <div>
                  <label htmlFor="role" className="block text-sm font-medium text-slate-700 mb-2">
                    Role
                  </label>
                  <div className="relative">
                    <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none z-10" />
                    <select
                      id="role"
                      {...register('role')}
                      className="w-full pl-10 pr-10 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none appearance-none bg-white transition cursor-pointer"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                      <option value="admin">Admin</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                  {errors.role && (
                    <p className="mt-1 text-sm text-red-600">{errors.role.message}</p>
                  )}
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={inviting}
                className="mt-4 w-full md:w-auto px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2 font-medium"
              >
                {inviting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Inviting...
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    Invite Member
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* Role Descriptions */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">Role Permissions:</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li><strong>Viewer:</strong> Can view ads and analytics</li>
            <li><strong>Editor:</strong> Can create, edit, and delete ads</li>
            <li><strong>Admin:</strong> Editor + can manage batches and settings</li>
            <li><strong>Owner:</strong> Full access + team management</li>
          </ul>
        </div>

        {/* Team Members List */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-200 bg-slate-50">
            <h2 className="text-lg font-semibold text-slate-900">
              Team Members ({members.length})
            </h2>
          </div>

          <div className="divide-y divide-slate-200">
            {members.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                No team members yet
              </div>
            ) : (
              members.map((member) => (
                <div
                  key={member.user_id}
                  className="p-4 hover:bg-slate-50 transition flex items-center gap-4"
                >
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
                    {member.email.charAt(0).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-900 truncate">
                        {member.email}
                      </span>
                      {member.is_owner && (
                        <Crown className="w-4 h-4 text-yellow-500" />
                      )}
                    </div>
                    <div className="text-xs text-slate-500">
                      Joined {new Date(member.created_at).toLocaleDateString()}
                    </div>
                  </div>

                  {/* Role Badge */}
                  {member.is_owner ? (
                    <span className={`px-3 py-1 rounded-full text-xs font-medium border ${roleColors.owner}`}>
                      {roleLabels.owner}
                    </span>
                  ) : isOwner ? (
                    <select
                      value={member.role}
                      onChange={(e) => member.id && handleRoleChange(member.id, e.target.value as any)}
                      disabled={isPending}
                      className={`px-3 py-1 rounded-full text-xs font-medium border ${roleColors[member.role as keyof typeof roleColors]} disabled:opacity-50 cursor-pointer`}
                    >
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                      <option value="admin">Admin</option>
                    </select>
                  ) : (
                    <span className={`px-3 py-1 rounded-full text-xs font-medium border ${roleColors[member.role as keyof typeof roleColors]}`}>
                      {roleLabels[member.role as keyof typeof roleLabels]}
                    </span>
                  )}

                  {/* Remove Button (Only for Owner, not for themselves) */}
                  {isOwner && !member.is_owner && member.id && (
                    <button
                      onClick={() => handleRemove(member.id!, member.email)}
                      disabled={isPending}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-50"
                      title="Remove member"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
