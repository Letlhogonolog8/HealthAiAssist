-- In-app notifications, and a real "mark as read" for chat.
--
-- Additive and idempotent. No DROP, no destructive ALTER.
--
-- Apply with:  npm run db:migrate-notifications

-- Notifications previously lived in a module-scoped array in server/routes.ts,
-- behind a comment reading "replace with database in production". They were lost
-- on every restart, were not shared between instances behind a load balancer,
-- and were capped at 50 rows globally, so one busy conversation evicted
-- everyone else's.
CREATE TABLE IF NOT EXISTS "notifications" (
  "id"           serial PRIMARY KEY,
  "recipient_id" integer NOT NULL,
  "actor_id"     integer,
  "type"         text NOT NULL,
  "title"        text NOT NULL,
  "body"         text NOT NULL DEFAULT '',
  "link"         text,
  "read_at"      timestamp,
  "created_at"   timestamp NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'notifications_recipient_id_users_id_fk'
  ) THEN
    ALTER TABLE "notifications"
      ADD CONSTRAINT "notifications_recipient_id_users_id_fk"
      FOREIGN KEY ("recipient_id") REFERENCES "users"("id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'notifications_actor_id_users_id_fk'
  ) THEN
    ALTER TABLE "notifications"
      ADD CONSTRAINT "notifications_actor_id_users_id_fk"
      FOREIGN KEY ("actor_id") REFERENCES "users"("id");
  END IF;
END $$;

-- The two access patterns: "newest for this reader" and "unread for this
-- reader". Both are on the request path of every authenticated page.
CREATE INDEX IF NOT EXISTS "idx_notifications_recipient"
  ON "notifications" ("recipient_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_notifications_unread"
  ON "notifications" ("recipient_id", "read_at");

-- chat_messages.read_at exists in the schema but nothing ever wrote to it:
-- storage.markMessagesAsRead() was an empty method body and POST
-- /api/chat/mark-read returned {success: true} without touching the database.
-- The column is declared in shared/schema.ts already; this guard is here for
-- databases created before it.
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "read_at" timestamp;

-- Marking a conversation read is "every message from them to me that is still
-- unread", which is this index.
CREATE INDEX IF NOT EXISTS "idx_chat_unread"
  ON "chat_messages" ("receiver_id", "sender_id", "read_at");
