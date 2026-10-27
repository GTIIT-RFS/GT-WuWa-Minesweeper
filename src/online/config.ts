/** Recognize only frontend-safe Supabase keys. Never include the rejected value in errors. */
export function isPublicKey(value: string | undefined): boolean {
  if (!value) return false;
  if (value.startsWith('sb_publishable_')) return true;
  try {
    return JSON.parse(atob(value.split('.')[1])).role === 'anon';
  } catch {
    return false;
  }
}
