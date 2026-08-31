-- 下载站数据库结构（服务启动时会自动执行，此文件仅作参考）
CREATE TABLE IF NOT EXISTS files (
  id             SERIAL PRIMARY KEY,
  filename       TEXT        NOT NULL,                  -- 原始文件名
  stored_name    TEXT        NOT NULL UNIQUE,           -- 磁盘存储名（UUID + 扩展名）
  size           BIGINT      NOT NULL,                  -- 文件大小（字节）
  mime_type      TEXT,                                  -- MIME 类型
  download_count INTEGER     NOT NULL DEFAULT 0,        -- 下载次数
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()     -- 上传时间
);

CREATE INDEX IF NOT EXISTS idx_files_uploaded_at ON files (uploaded_at DESC);
