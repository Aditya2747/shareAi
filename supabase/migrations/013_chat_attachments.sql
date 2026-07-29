-- Chat message attachments (images/files stored encrypted at rest).

CREATE TABLE IF NOT EXISTS chat_attachments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  message_id TEXT REFERENCES chat_messages(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  encrypted_content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_attachments_user
  ON chat_attachments(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_attachments_message
  ON chat_attachments(message_id);
