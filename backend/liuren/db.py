"""
数据库模块 — SQLite 用户、会话、配额管理（同步）
"""
import sqlite3
import uuid
from pathlib import Path
from datetime import datetime

DB_DIR = Path(__file__).parent.parent / "data"
DB_DIR.mkdir(exist_ok=True)
DB_PATH = str(DB_DIR / "users.db")


def _connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """初始化数据库表"""
    conn = _connect()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE,
                email TEXT UNIQUE,
                password_hash TEXT,
                wechat_openid TEXT UNIQUE,
                wechat_unionid TEXT,
                nickname TEXT DEFAULT '',
                avatar_url TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now','localtime')),
                quota_total INTEGER DEFAULT 30,
                quota_used INTEGER DEFAULT 0,
                quota_month TEXT DEFAULT '',
                is_admin INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            -- 默认管理员 admin / admin123
            INSERT OR IGNORE INTO users (id, username, email, password_hash, nickname, is_admin, quota_total)
            VALUES ('admin-root', 'admin', 'admin@liuren.local',
                '$2b$12$TzJpbGu70Ebi3gQioauBieGLxlSe2bIY0sh1Ps76ui4H6kQJM3YcO',
                '系统管理员', 1, 9999);
        """)
        # 迁移：为旧表添加 email 列（如果不存在）
        try:
            conn.execute("ALTER TABLE users ADD COLUMN email TEXT UNIQUE")
        except:
            pass  # 列已存在
        conn.commit()
    finally:
        conn.close()
