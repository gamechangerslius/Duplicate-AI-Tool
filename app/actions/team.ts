'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

// =====================================================
// Validation Schemas
// =====================================================

const inviteMemberSchema = z.object({
  businessSlug: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['viewer', 'editor', 'admin']),
})

const removeMemberSchema = z.object({
  businessSlug: z.string().min(1),
  accessId: z.string().uuid(),
})

const updateMemberRoleSchema = z.object({
  businessSlug: z.string().min(1),
  accessId: z.string().uuid(),
  role: z.enum(['viewer', 'editor', 'admin']),
})

// =====================================================
// Types
// =====================================================

export type TeamMember = {
  id: string | null
  user_id: string
  email: string
  role: 'owner' | 'viewer' | 'editor' | 'admin'
  is_owner: boolean
  created_at: string
}

export type ActionResult<T = void> = 
  | { success: true; data: T }
  | { success: false; error: string }

// =====================================================
// Helper Functions
// =====================================================

async function getBusinessBySlug(slug: string) {
  const supabase = await createClient()
  
  const { data: business, error } = await supabase
    .from('businesses')
    .select('id, name, slug, owner_id')
    .eq('slug', slug)
    .single()

  if (error || !business) {
    throw new Error('Business not found')
  }

  return business
}

async function checkIsOwner(businessId: string, userId: string) {
  const supabase = await createClient()
  
  const { data } = await supabase
    .from('businesses')
    .select('owner_id')
    .eq('id', businessId)
    .single()

  return data?.owner_id === userId
}

// =====================================================
// Actions
// =====================================================

/**
 * Get all team members for a business
 */
export async function getTeamMembers(
  businessSlug: string
): Promise<ActionResult<TeamMember[]>> {
  try {
    const supabase = await createClient()
    
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return { success: false, error: 'Not authenticated' }
    }

    // Get business
    const business = await getBusinessBySlug(businessSlug)

    // Call helper function to get members
    const { data: members, error } = await supabase
      .rpc('get_team_members', { p_business_id: business.id })

    if (error) {
      console.error('Error fetching team members:', error)
      return { success: false, error: 'Failed to fetch team members' }
    }

    return { success: true, data: members || [] }
  } catch (error) {
    console.error('Error in getTeamMembers:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}

/**
 * Invite a new member to the team
 */
export async function inviteMember(
  input: z.infer<typeof inviteMemberSchema>
): Promise<ActionResult> {
  try {
    // Validate input
    const validated = inviteMemberSchema.parse(input)
    
    const supabase = await createClient()
    
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return { success: false, error: 'Not authenticated' }
    }

    // Get business
    const business = await getBusinessBySlug(validated.businessSlug)

    // Check if current user is owner
    const isOwner = await checkIsOwner(business.id, user.id)
    if (!isOwner) {
      return { success: false, error: 'Only the owner can invite members' }
    }

    // Find user by email
    const { data: targetUsers, error: findError } = await supabase
      .rpc('find_user_by_email', { p_email: validated.email })

    if (findError || !targetUsers || targetUsers.length === 0) {
      return { 
        success: false, 
        error: 'User not found. They need to sign up first.' 
      }
    }

    const targetUser = targetUsers[0]

    // Check if user is the owner
    if (targetUser.id === business.owner_id) {
      return { success: false, error: 'User is already the owner' }
    }

    // Check if user already has access
    const { data: existing } = await supabase
      .from('business_access')
      .select('id')
      .eq('business_id', business.id)
      .eq('user_id', targetUser.id)
      .single()

    if (existing) {
      return { success: false, error: 'User already has access to this business' }
    }

    // Add user to business
    const { error: insertError } = await supabase
      .from('business_access')
      .insert({
        business_id: business.id,
        user_id: targetUser.id,
        role: validated.role,
      })

    if (insertError) {
      console.error('Error inviting member:', insertError)
      return { success: false, error: 'Failed to invite member' }
    }

    revalidatePath(`/dashboard/${validated.businessSlug}/settings/team`)
    return { success: true, data: undefined }
  } catch (error) {
    console.error('Error in inviteMember:', error)
    if (error instanceof z.ZodError) {
      return { success: false, error: 'Invalid input data' }
    }
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}

/**
 * Remove a member from the team
 */
export async function removeMember(
  input: z.infer<typeof removeMemberSchema>
): Promise<ActionResult> {
  try {
    const validated = removeMemberSchema.parse(input)
    
    const supabase = await createClient()
    
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return { success: false, error: 'Not authenticated' }
    }

    // Get business
    const business = await getBusinessBySlug(validated.businessSlug)

    // Check if current user is owner
    const isOwner = await checkIsOwner(business.id, user.id)
    if (!isOwner) {
      return { success: false, error: 'Only the owner can remove members' }
    }

    // Remove access
    const { error: deleteError } = await supabase
      .from('business_access')
      .delete()
      .eq('id', validated.accessId)
      .eq('business_id', business.id)

    if (deleteError) {
      console.error('Error removing member:', deleteError)
      return { success: false, error: 'Failed to remove member' }
    }

    revalidatePath(`/dashboard/${validated.businessSlug}/settings/team`)
    return { success: true, data: undefined }
  } catch (error) {
    console.error('Error in removeMember:', error)
    if (error instanceof z.ZodError) {
      return { success: false, error: 'Invalid input data' }
    }
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}

/**
 * Update a member's role
 */
export async function updateMemberRole(
  input: z.infer<typeof updateMemberRoleSchema>
): Promise<ActionResult> {
  try {
    const validated = updateMemberRoleSchema.parse(input)
    
    const supabase = await createClient()
    
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return { success: false, error: 'Not authenticated' }
    }

    // Get business
    const business = await getBusinessBySlug(validated.businessSlug)

    // Check if current user is owner
    const isOwner = await checkIsOwner(business.id, user.id)
    if (!isOwner) {
      return { success: false, error: 'Only the owner can change roles' }
    }

    // Update role
    const { error: updateError } = await supabase
      .from('business_access')
      .update({ role: validated.role })
      .eq('id', validated.accessId)
      .eq('business_id', business.id)

    if (updateError) {
      console.error('Error updating role:', updateError)
      return { success: false, error: 'Failed to update role' }
    }

    revalidatePath(`/dashboard/${validated.businessSlug}/settings/team`)
    return { success: true, data: undefined }
  } catch (error) {
    console.error('Error in updateMemberRole:', error)
    if (error instanceof z.ZodError) {
      return { success: false, error: 'Invalid input data' }
    }
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}

/**
 * Check if current user is the owner of a business
 */
export async function checkBusinessOwnership(
  businessSlug: string
): Promise<ActionResult<boolean>> {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return { success: false, error: 'Not authenticated' }
    }

    const business = await getBusinessBySlug(businessSlug)
    const isOwner = await checkIsOwner(business.id, user.id)

    return { success: true, data: isOwner }
  } catch (error) {
    console.error('Error in checkBusinessOwnership:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}
