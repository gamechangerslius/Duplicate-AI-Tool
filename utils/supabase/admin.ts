import { supabase } from '../../lib/supabase';

/**
 * Check if a user is an admin
 */
export async function isUserAdmin(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .single();

    if (error) {
      console.warn('Failed to check admin status:', error.message);
      return false;
    }

    return data?.role === 'admin';
  } catch (err) {
    console.error('Error checking admin status:', err);
    return false;
  }
}

/**
 * Get all businesses accessible to a user
 * - If user is admin: returns ALL businesses
 * - If user is regular: returns only businesses they own
 */
export async function getUserBusinesses(userId: string): Promise<any[]> {
  try {
    const isAdmin = await isUserAdmin(userId);

    if (isAdmin) {
      // Admins see all businesses
      const { data, error } = await supabase
        .from('businesses')
        .select('id, name, slug, owner_id, created_at')
        .order('name', { ascending: true });

      if (error) {
        console.error('Failed to fetch all businesses:', error);
        return [];
      }

      return data || [];
    } else {
      // Regular users see only their own businesses
      const { data, error } = await supabase
        .from('businesses')
        .select('id, name, slug, owner_id, created_at')
        .eq('owner_id', userId)
        .order('name', { ascending: true });

      if (error) {
        console.error('Failed to fetch user businesses:', error);
        return [];
      }

      return data || [];
    }
  } catch (err) {
    console.error('Error getting user businesses:', err);
    return [];
  }
}

/**
 * Set admin status for a user (must be called by existing admin)
 */
export async function setUserAdmin(userId: string, isAdmin: boolean): Promise<boolean> {
  try {
    const role = isAdmin ? 'admin' : 'user';

    const { error } = await supabase
      .from('user_roles')
      .upsert(
        { user_id: userId, role },
        { onConflict: 'user_id' }
      );

    if (error) {
      console.error('Failed to set user role:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Error setting user role:', err);
    return false;
  }
}
