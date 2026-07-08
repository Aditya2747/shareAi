-- OTP codes used for email-based login verification.
CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  attempts_left INT NOT NULL DEFAULT 5,
  consumed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_codes_email_created_at
  ON otp_codes(email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_otp_codes_expires_at
  ON otp_codes(expires_at);
