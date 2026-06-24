'use server'

/**
 * Auth server actions for the manager dashboard. These run on the server, so
 * the session cookie is written through the @supabase/ssr server client.
 */
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function login(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!email || !password) {
    redirect('/login?error=' + encodeURIComponent('Enter your email and password.'))
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    // Deliberately vague — never reveal whether the email exists.
    redirect('/login?error=' + encodeURIComponent('Invalid email or password.'))
  }

  // Confirm the session cookie actually took before sending the user in, so a
  // silent cookie-write failure surfaces instead of bouncing back in a loop.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect(
      '/login?error=' +
        encodeURIComponent('Could not start your session. Please try again.'),
    )
  }

  revalidatePath('/', 'layout')
  redirect('/')
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
