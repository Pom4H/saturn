PRAGMA foreign_keys=ON;
PRAGMA trusted_schema=OFF;

CREATE TABLE IF NOT EXISTS meta(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts(
  hash TEXT PRIMARY KEY,
  document TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkpoints(
  run_id TEXT PRIMARY KEY,
  artifact_hash TEXT NOT NULL REFERENCES artifacts(hash),
  state TEXT NOT NULL,
  alarms TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS samples(
  run_id TEXT NOT NULL,
  signal TEXT NOT NULL,
  time INTEGER NOT NULL,
  value REAL,
  quality TEXT NOT NULL,
  PRIMARY KEY(run_id,signal,time)
);
CREATE INDEX IF NOT EXISTS samples_time ON samples(run_id,time);

CREATE TABLE IF NOT EXISTS events(
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  time INTEGER NOT NULL,
  type TEXT NOT NULL,
  subject TEXT NOT NULL,
  actor TEXT,
  detail TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports(
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  trigger TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  task TEXT NOT NULL,
  artifact TEXT,
  error TEXT
);
CREATE TABLE IF NOT EXISTS schedule_slots(id TEXT PRIMARY KEY,time INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,time INTEGER NOT NULL,kind TEXT NOT NULL,subject TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending');
CREATE TABLE IF NOT EXISTS commands(id TEXT PRIMARY KEY,payload TEXT NOT NULL,receipt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS subscriptions(endpoint TEXT PRIMARY KEY,user_id TEXT NOT NULL,session_id TEXT NOT NULL,subscription TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS deliveries(event_id TEXT NOT NULL,endpoint TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(event_id,endpoint));

CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  csrf TEXT NOT NULL,
  expires INTEGER NOT NULL
);

PRAGMA user_version=1;
