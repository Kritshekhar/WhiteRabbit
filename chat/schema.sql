-- The White Rabbit chat's question log (Cloudflare D1). Anonymous: no IP
-- address, cookie or account is stored, and email addresses and phone numbers
-- are removed from questions before they are saved. Rows older than a year
-- are deleted daily.
CREATE TABLE IF NOT EXISTS questions (
  id        INTEGER PRIMARY KEY,
  at        TEXT NOT NULL,                 -- UTC timestamp
  page      TEXT NOT NULL DEFAULT '',      -- the site path it was asked from
  question  TEXT NOT NULL,
  answer    TEXT NOT NULL DEFAULT '',
  matched   INTEGER NOT NULL DEFAULT 0,    -- records found for it (0 = a gap in the data)
  model     TEXT NOT NULL DEFAULT '',
  feedback  INTEGER                        -- 1 helpful, -1 not, NULL no answer
);
CREATE INDEX IF NOT EXISTS questions_at ON questions (at);
