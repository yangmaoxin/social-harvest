CREATE TABLE IF NOT EXISTS scrm_account (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'ID',
  account_id VARCHAR(191) NOT NULL DEFAULT '' COMMENT '账号唯一标识（抖音号 / 视频号ID 等平台公开账号标识）',
  origin_type TINYINT NOT NULL DEFAULT 0 COMMENT '来源 1:视频号 2：抖音 3：小红书...',
  account_name VARCHAR(128) NOT NULL DEFAULT '' COMMENT '账号名称',
  account_photo VARCHAR(1024) NOT NULL DEFAULT '' COMMENT '账号头像URL',
  profile_url VARCHAR(1024) NOT NULL DEFAULT '' COMMENT '账号主页链接',
  fans_count BIGINT NOT NULL DEFAULT 0 COMMENT '粉丝数量',
  raw_payload_json LONGTEXT NOT NULL COMMENT '原始接口载荷JSON',
  created_at DATETIME NOT NULL COMMENT '创建时间',
  updated_at DATETIME NOT NULL COMMENT '更新时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_origin_account (origin_type, account_id),
  KEY idx_origin_updated_at (origin_type, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账号主体信息表';
