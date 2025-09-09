-- Supabase Database Schema for Soma Diet Tracker
-- Run this in your Supabase SQL editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE users (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    telegram_user_id BIGINT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
    cal_goal INTEGER NOT NULL DEFAULT 1800,
    protein_goal_g INTEGER NOT NULL DEFAULT 120,
    fiber_goal_g INTEGER NOT NULL DEFAULT 25,
    first_seen_utc TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_seen_utc TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    silent_mode BOOLEAN NOT NULL DEFAULT false,
    daily_digest_time TEXT NOT NULL DEFAULT '21:30',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Entries table (food log)
CREATE TABLE entries (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    timestamp_utc TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    day_local DATE NOT NULL,
    chat_id BIGINT NOT NULL,
    msg_id BIGINT NOT NULL,
    text TEXT,
    photo_file_id TEXT,
    photo_note TEXT,
    calories DECIMAL(8,2) NOT NULL DEFAULT 0,
    protein_g DECIMAL(6,2) NOT NULL DEFAULT 0,
    fat_g DECIMAL(6,2) NOT NULL DEFAULT 0,
    carbs_g DECIMAL(6,2) NOT NULL DEFAULT 0,
    fiber_g DECIMAL(6,2) NOT NULL DEFAULT 0,
    score_item DECIMAL(3,1) NOT NULL DEFAULT 0,
    confidence DECIMAL(3,2) NOT NULL DEFAULT 0,
    advice_short TEXT,
    raw_model_json JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Daily aggregates table
CREATE TABLE daily (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day_local DATE NOT NULL,
    calories_sum DECIMAL(8,2) NOT NULL DEFAULT 0,
    protein_sum DECIMAL(6,2) NOT NULL DEFAULT 0,
    fat_sum DECIMAL(6,2) NOT NULL DEFAULT 0,
    carbs_sum DECIMAL(6,2) NOT NULL DEFAULT 0,
    fiber_sum DECIMAL(6,2) NOT NULL DEFAULT 0,
    meals_count INTEGER NOT NULL DEFAULT 0,
    daily_score DECIMAL(3,1) NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id, day_local)
);

-- Indexes for better performance
CREATE INDEX idx_users_telegram_id ON users(telegram_user_id);
CREATE INDEX idx_entries_user_day ON entries(user_id, day_local);
CREATE INDEX idx_entries_user_timestamp ON entries(user_id, timestamp_utc);
CREATE INDEX idx_daily_user_day ON daily(user_id, day_local);
CREATE INDEX idx_daily_day_range ON daily(day_local);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_daily_updated_at 
    BEFORE UPDATE ON daily 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily ENABLE ROW LEVEL SECURITY;

-- Service role can access all data (for the bot)
CREATE POLICY "Service role can manage users" ON users
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role can manage entries" ON entries
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role can manage daily" ON daily
    FOR ALL USING (auth.role() = 'service_role');

-- Optional: Add some useful views for analytics
CREATE VIEW user_stats AS
SELECT 
    u.telegram_user_id,
    u.display_name,
    u.timezone,
    COUNT(DISTINCT e.day_local) as active_days,
    COUNT(e.id) as total_entries,
    AVG(d.daily_score) as avg_daily_score,
    MAX(e.timestamp_utc) as last_entry,
    u.created_at as user_since
FROM users u
LEFT JOIN entries e ON u.id = e.user_id
LEFT JOIN daily d ON u.id = d.user_id
GROUP BY u.id, u.telegram_user_id, u.display_name, u.timezone, u.created_at;

-- View for recent activity
CREATE VIEW recent_activity AS
SELECT 
    u.display_name,
    u.telegram_user_id,
    e.day_local,
    e.timestamp_utc,
    e.calories,
    e.protein_g,
    e.score_item,
    e.advice_short
FROM entries e
JOIN users u ON e.user_id = u.id
WHERE e.timestamp_utc >= NOW() - INTERVAL '7 days'
ORDER BY e.timestamp_utc DESC;
