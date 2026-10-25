const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// On Azure App Service, /home is persistent storage that survives restarts and redeploys.
const dataDir = process.env.DATA_DIR || (process.env.WEBSITE_SITE_NAME ? '/home/data' : path.join(__dirname, 'data'));
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'fitfriends.db'));

db.exec(`
  PRAGMA journal_mode = DELETE;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    avatar        TEXT NOT NULL DEFAULT '🏃',
    color         TEXT NOT NULL DEFAULT '#6366f1',
    calorie_goal  INTEGER NOT NULL DEFAULT 2000,
    weight_kg     REAL NOT NULL DEFAULT 70,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS workouts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date         TEXT NOT NULL,
    type         TEXT NOT NULL,
    duration_min INTEGER NOT NULL,
    intensity    TEXT NOT NULL,
    distance_km  REAL,
    notes        TEXT,
    calories     INTEGER NOT NULL,
    points       INTEGER NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_workouts_user_date ON workouts(user_id, date);

  CREATE TABLE IF NOT EXISTS foods (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    meal       TEXT NOT NULL,
    name       TEXT NOT NULL,
    calories   INTEGER NOT NULL,
    protein_g  REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_foods_user_date ON foods(user_id, date);
`);

module.exports = db;
