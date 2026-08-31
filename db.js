import pg from 'pg';

export const pool = new pg.Pool({
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT) || 5432,
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '',
  database: process.env.PG_DATABASE || 'download_station',
});

export async function initDb() {
  await pool.query('DROP TABLE IF EXISTS files');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      TEXT        NOT NULL UNIQUE,
      password_hash TEXT        NOT NULL,
      is_admin      BOOLEAN     NOT NULL DEFAULT FALSE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS resources (
      id             SERIAL PRIMARY KEY,
      title          TEXT        NOT NULL,
      description    TEXT        NOT NULL DEFAULT '',
      filename       TEXT        NOT NULL,
      stored_name    TEXT        NOT NULL UNIQUE,
      size           BIGINT      NOT NULL,
      mime_type      TEXT,
      download_count INTEGER     NOT NULL DEFAULT 0,
      status         TEXT        NOT NULL DEFAULT 'pending',
      uploader_id    INTEGER     REFERENCES users(id) ON DELETE SET NULL,
      uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS comments (
      id          SERIAL PRIMARY KEY,
      resource_id INTEGER     NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      user_id     INTEGER     REFERENCES users(id) ON DELETE SET NULL,
      username    TEXT        NOT NULL,
      content     TEXT        NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_resources_status ON resources (status)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_resources_uploader ON resources (uploader_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_comments_resource ON comments (resource_id)');
}
