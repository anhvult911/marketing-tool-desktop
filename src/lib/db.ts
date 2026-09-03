import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;

// Global PostgreSQL connection for shared DB mode
declare global {
  var globalPostgresSql: postgres.Sql | undefined;
}

export const sql = databaseUrl
  ? globalThis.globalPostgresSql || postgres(databaseUrl, {
      max: process.env.NODE_ENV === 'production' ? 20 : 5,
      idle_timeout: 30,
      connect_timeout: 10,
      keep_alive: 30,
    })
  : null;

if (databaseUrl && process.env.NODE_ENV !== 'production') {
  globalThis.globalPostgresSql = sql!;
  console.log(`[Database] 🐘 Connected to Shared PostgreSQL Database: ${databaseUrl.split('@')[1] || 'configured'}`);
}

import { DB_PATH } from './paths';

const dbPath = DB_PATH;
if (!databaseUrl) {
  console.log(`[Database] 📁 SQLite Local Database active: ${dbPath}`);
}

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 15000');
db.pragma('cache_size = -64000'); // 64MB In-Memory Cache
db.pragma('temp_store = MEMORY');
db.pragma('mmap_size = 268435456'); // 256MB Memory-Mapped I/O

// Khởi tạo bảng dữ liệu
export function initDatabaseSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS proxies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER DEFAULT 1,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT,
      password TEXT,
      protocol TEXT DEFAULT 'http',
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS social_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER DEFAULT 1,
      platform TEXT NOT NULL,
      username TEXT NOT NULL,
      password TEXT,
      email TEXT,
      proxy_id INTEGER REFERENCES proxies(id),
      auth_token TEXT,
      user_data_dir TEXT,
      status TEXT DEFAULT 'unknown',
      last_checked DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS post_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER DEFAULT 1,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      media_paths TEXT,
      platform TEXT DEFAULT 'x',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS spam_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER DEFAULT 1,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scrape_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER DEFAULT 1,
      platform TEXT DEFAULT 'x',
      target_type TEXT NOT NULL, -- 'user' hoặc 'hashtag'
      target_value TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      last_scraped_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scraped_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER DEFAULT 1,
      target_id INTEGER REFERENCES scrape_targets(id),
      platform TEXT DEFAULT 'x',
      post_id TEXT UNIQUE,
      post_url TEXT NOT NULL,
      author TEXT,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER DEFAULT 1,
      account_id INTEGER REFERENCES social_accounts(id),
      type TEXT NOT NULL, -- 'check_status', 'post', 'comment', 'zalo_message', etc.
      post_content TEXT,
      media_paths TEXT,
      target_url TEXT,
      status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
      scheduled_at DATETIME,
      run_at DATETIME,
      post_url TEXT,
      error_log TEXT,
      campaign_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS crawler_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER DEFAULT 1,
      target_value TEXT,
      action_type TEXT,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS spam_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER DEFAULT 1,
      platform TEXT NOT NULL,
      lead_type TEXT NOT NULL DEFAULT 'uid',
      value TEXT NOT NULL UNIQUE,
      display_name TEXT,
      avatar_url TEXT,
      status TEXT DEFAULT 'pending',
      source TEXT,
      last_attempt DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scrape_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER DEFAULT 1,
      platform TEXT DEFAULT 'facebook',
      target_group TEXT,
      status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed', 'stopped'
      total_count INTEGER DEFAULT 0,
      scraped_count INTEGER DEFAULT 0,
      auto_import INTEGER DEFAULT 1,
      target_campaign_id TEXT,
      scrape_type TEXT DEFAULT 'multi_tier',
      max_limit INTEGER DEFAULT 5000,
      custom_tag TEXT,
      account_id INTEGER,
      account_ids TEXT,
      error_msg TEXT,
      last_cursor TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scraped_job_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES scrape_jobs(id) ON DELETE CASCADE,
      workspace_id INTEGER DEFAULT 1,
      platform TEXT NOT NULL,
      uid TEXT NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      profile_url TEXT,
      interaction_type TEXT, -- 'reaction_like', 'reaction_love', 'comment', 'reply', 'group_member', etc.
      post_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(job_id, uid)
    );

    -- Tạo Workspace mặc định nếu chưa có
    INSERT OR IGNORE INTO workspaces (id, name, description) 
    VALUES (1, 'Workspace Mặc định', 'Không gian làm việc chính trên máy tính');

    -- High-Performance Indexes for 60+ FPS instantaneous lookups
    CREATE INDEX IF NOT EXISTS idx_jobs_ws_status ON jobs(workspace_id, status);
    CREATE INDEX IF NOT EXISTS idx_jobs_campaign ON jobs(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_spam_leads_source ON spam_leads(source);
    CREATE INDEX IF NOT EXISTS idx_spam_leads_ws_status ON spam_leads(workspace_id, status);
    CREATE INDEX IF NOT EXISTS idx_scraped_job_leads_job ON scraped_job_leads(job_id);
    CREATE INDEX IF NOT EXISTS idx_social_accounts_ws_status ON social_accounts(workspace_id, status);
    CREATE INDEX IF NOT EXISTS idx_scrape_jobs_ws_status ON scrape_jobs(workspace_id, status);
  `);

  // Migrate existing tables if columns are missing
  try {
    const tableInfo = db.prepare(`PRAGMA table_info(scrape_jobs)`).all() as any[];
    const colNames = tableInfo.map(c => c.name);
    if (!colNames.includes('scraped_count')) {
      db.exec(`ALTER TABLE scrape_jobs ADD COLUMN scraped_count INTEGER DEFAULT 0`);
    }
    if (!colNames.includes('error_msg')) {
      db.exec(`ALTER TABLE scrape_jobs ADD COLUMN error_msg TEXT`);
    }
    if (!colNames.includes('last_cursor')) {
      db.exec(`ALTER TABLE scrape_jobs ADD COLUMN last_cursor TEXT`);
    }
    if (!colNames.includes('account_id')) {
      db.exec(`ALTER TABLE scrape_jobs ADD COLUMN account_id INTEGER`);
    }
    if (!colNames.includes('account_ids')) {
      db.exec(`ALTER TABLE scrape_jobs ADD COLUMN account_ids TEXT`);
    }

    const jobsInfo = db.prepare(`PRAGMA table_info(jobs)`).all() as any[];
    const jobsColNames = jobsInfo.map(c => c.name);
    if (!jobsColNames.includes('campaign_id')) {
      db.exec(`ALTER TABLE jobs ADD COLUMN campaign_id TEXT`);
    }

    const spamLeadsInfo = db.prepare(`PRAGMA table_info(spam_leads)`).all() as any[];
    const spamColNames = spamLeadsInfo.map(c => c.name);
    if (!spamColNames.includes('display_name')) {
      db.exec(`ALTER TABLE spam_leads ADD COLUMN display_name TEXT`);
    }
    if (!spamColNames.includes('avatar_url')) {
      db.exec(`ALTER TABLE spam_leads ADD COLUMN avatar_url TEXT`);
    }

    // Clean up any group paths in value to extract pure UID
    const uncleanedLeads = db.prepare(`SELECT id, value, display_name FROM spam_leads WHERE value LIKE '%/user/%'`).all() as any[];
    if (uncleanedLeads.length > 0) {
      const updateLeadStmt = db.prepare(`UPDATE spam_leads SET value = ?, display_name = ? WHERE id = ?`);
      const cleanTx = db.transaction(() => {
        for (const l of uncleanedLeads) {
          const match = l.value.match(/\/user\/(\d+)/);
          if (match && match[1]) {
            const cleanUid = match[1];
            const cleanName = (l.display_name && !l.display_name.startsWith('/groups/')) ? l.display_name : `Facebook User (${cleanUid})`;
            try {
              updateLeadStmt.run(cleanUid, cleanName, l.id);
            } catch {}
          }
        }
      });
      cleanTx();
    }
  } catch (err) {
    // table might not exist yet or already altered
  }
}

// Chạy khởi tạo schema
initDatabaseSchema();

export function getSetting(key: string, defaultValue: string = ''): string {
  try {
    const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as any;
    return row && row.value !== null && row.value !== undefined ? String(row.value) : defaultValue;
  } catch {
    return defaultValue;
  }
}

export function setSetting(key: string, value: string): void {
  try {
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(key, value);
  } catch (err: any) {
    console.error(`[Database] Lỗi khi lưu setting ${key}:`, err.message);
  }
}

export default db;
