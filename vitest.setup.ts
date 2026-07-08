process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test_anon_key';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'test_service_role_key';
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
process.env.AUTH_SESSION_SECRET =
  process.env.AUTH_SESSION_SECRET || 'test-auth-session-secret';
process.env.OTP_SECRET = process.env.OTP_SECRET || 'test-otp-secret';
