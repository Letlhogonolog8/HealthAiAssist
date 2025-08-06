-- Connect to the correct database
\c healthai_db;

-- Drop table if it exists and recreate with proper structure
DROP TABLE IF EXISTS chat_messages;

CREATE TABLE chat_messages (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  receiver_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  message_type TEXT DEFAULT 'text',
  status TEXT DEFAULT 'sent',
  created_at TIMESTAMP DEFAULT NOW(),
  read_at TIMESTAMP
);

CREATE INDEX idx_chat_sender ON chat_messages(sender_id);
CREATE INDEX idx_chat_receiver ON chat_messages(receiver_id);
CREATE INDEX idx_chat_created ON chat_messages(created_at);

-- Verify table was created
\dt chat_messages;