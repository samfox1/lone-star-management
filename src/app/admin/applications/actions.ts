'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export const APPLICATION_STATUSES = ['new', 'contacted', 'approved', 'declined'] as const
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]

/**
 * Move an application through its review status. RLS (`applications_admin_all`) is
 * the real guard — a non-admin's update matches no rows — but we validate the
 * status against the allowlist so a bad value never reaches the CHECK constraint.
 */
export async function setApplicationStatus(id: string, status: string) {
  if (!(APPLICATION_STATUSES as readonly string[]).includes(status)) {
    throw new Error('Invalid status.')
  }
  const supabase = await createClient()
  const { error } = await supabase.from('applications').update({ status }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/admin/applications')
}
