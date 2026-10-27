import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { isPublicKey } from './src/online/config';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (env.VITE_SUPABASE_PUBLISHABLE_KEY && !isPublicKey(env.VITE_SUPABASE_PUBLISHABLE_KEY.trim()))
    throw new Error(
      'VITE_SUPABASE_PUBLISHABLE_KEY must be a publishable or legacy anon key. Secret keys must stay on the server.',
    );
  return {
    plugins: [react()],
    base: './',
    test: { include: ['src/**/*.test.ts'] },
  };
});
