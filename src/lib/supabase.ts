import { createClient } from '@supabase/supabase-js';

const isBuildTime = process.env.NEXT_PHASE === 'phase-production-build';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  (isBuildTime ? 'https://placeholder.supabase.co' : '');
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  (isBuildTime ? 'placeholder-anon-key' : '');
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

export const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceRoleKey || supabaseAnonKey
);
