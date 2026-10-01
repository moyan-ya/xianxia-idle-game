-- ============================================================
-- 仙侠游戏 · MySQL 8.0 建表脚本
-- 字符集 utf8mb4 / 排序 utf8mb4_0900_ai_ci（MySQL 8 默认）
--
-- 货币说明：全项目只有一种货币 —— 灵石（spirit_stone）。
-- 早期的"灵气"已合并进灵石，role.qi 列已移除。
--
-- 用法：
--   mysql -uroot -p < sql/schema.sql
--   node scripts/init-db.js --reset     全新初始化
--   node scripts/migrate.js             老库平滑升级（保留玩家数据）
-- ============================================================

CREATE DATABASE IF NOT EXISTS `xianxia`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE `xianxia`;

-- 依赖顺序倒序删除，方便反复初始化
DROP TABLE IF EXISTS `log_action`;
DROP TABLE IF EXISTS `log_battle`;
DROP TABLE IF EXISTS `log_currency`;
DROP TABLE IF EXISTS `role_stage`;
DROP TABLE IF EXISTS `role_item`;
DROP TABLE IF EXISTS `role`;
DROP TABLE IF EXISTS `account`;

-- ------------------------------------------------------------
-- 账号
-- ------------------------------------------------------------
CREATE TABLE `account` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`      VARCHAR(32)     NOT NULL                COMMENT '登录名',
  `password_hash` CHAR(60)        NOT NULL                COMMENT 'bcrypt 哈希',
  `status`        TINYINT         NOT NULL DEFAULT 1      COMMENT '1正常 0封禁',
  `last_login_at` DATETIME        NULL,
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='账号';

-- ------------------------------------------------------------
-- 角色（一账号一角色，MVP 简化）
-- 惰性结算基准：last_settle_at，绝不遍历全服玩家
-- ------------------------------------------------------------
CREATE TABLE `role` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `account_id`     BIGINT UNSIGNED NOT NULL,
  `nickname`       VARCHAR(32)     NOT NULL                COMMENT '道号',
  `realm`          SMALLINT        NOT NULL DEFAULT 0      COMMENT '境界序号 0炼气..7大乘',
  `realm_level`    TINYINT         NOT NULL DEFAULT 1      COMMENT '境界内层数 1..9',
  `exp`            BIGINT          NOT NULL DEFAULT 0      COMMENT '修为，突破消耗',
  `spirit_stone`   BIGINT          NOT NULL DEFAULT 0      COMMENT '灵石（唯一货币）',
  `roots`          JSON            NOT NULL                COMMENT '五行灵根 {"金":62,...}',
  `root_pity`      JSON            NULL                    COMMENT '各灵根洗练保底计数 {"金":3,...}，第 5 次必出更高值',
  `root_pending`   JSON            NULL                    COMMENT '待确认的洗练结果 {element,value,oldValue,guaranteed}',
  `cave_level`     SMALLINT        NOT NULL DEFAULT 1      COMMENT '洞府等级',
  `break_pity`     TINYINT         NOT NULL DEFAULT 0      COMMENT '突破保底计数，每失败一次+1',
  `break_bonus`    INT             NOT NULL DEFAULT 0      COMMENT '悟道石带来的突破成功率加成，万分比（500 = +5%），升入新大境界时清零',
  `total_break`    INT             NOT NULL DEFAULT 0      COMMENT '累计突破次数',
  `last_settle_at` DATETIME        NOT NULL                COMMENT '惰性结算基准时间',
  `version`        INT             NOT NULL DEFAULT 0      COMMENT '乐观锁版本',
  `created_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_account` (`account_id`),
  UNIQUE KEY `uk_nickname` (`nickname`),
  KEY `idx_rank` (`realm`,`realm_level`,`exp`),
  CONSTRAINT `fk_role_account` FOREIGN KEY (`account_id`) REFERENCES `account` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='角色';

-- ------------------------------------------------------------
-- 背包（一格一物；equipped=1 表示已装备，法宝/功法共用此表）
-- ------------------------------------------------------------
CREATE TABLE `role_item` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_id`    BIGINT UNSIGNED NOT NULL,
  `item_id`    INT             NOT NULL                COMMENT '对应 game/item.json',
  `num`        INT             NOT NULL DEFAULT 0,
  `equipped`   TINYINT         NOT NULL DEFAULT 0      COMMENT '1已装备',
  `obtained_at` DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_item` (`role_id`,`item_id`),
  KEY `idx_role` (`role_id`),
  CONSTRAINT `fk_item_role` FOREIGN KEY (`role_id`) REFERENCES `role` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='背包/装备';

-- ------------------------------------------------------------
-- 试炼塔进度：逐层解锁，首通全额奖励，重复挑战按比例发放
-- ------------------------------------------------------------
CREATE TABLE `role_stage` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_id`        BIGINT UNSIGNED NOT NULL,
  `stage_id`       INT             NOT NULL,
  `clear_count`    INT             NOT NULL DEFAULT 0,
  `first_clear_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_stage` (`role_id`,`stage_id`),
  CONSTRAINT `fk_stage_role` FOREIGN KEY (`role_id`) REFERENCES `role` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='试炼塔进度';

-- ------------------------------------------------------------
-- 货币流水：任何增删都留痕，运营期对账与回滚的救命稻草
-- 记账契约：每条流水的 delta 只反映它自己的 reason；
--           挂机结算永远单独记 reason='settle'；
--           同一事务内多条流水共享事务结束时的余额。
-- ------------------------------------------------------------
CREATE TABLE `log_currency` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_id`       BIGINT UNSIGNED NOT NULL,
  `kind`          VARCHAR(16)     NOT NULL                COMMENT 'stone/exp',
  `delta`         BIGINT          NOT NULL                COMMENT '变动量，可负',
  `balance_after` BIGINT          NOT NULL                COMMENT '余额；同一事务内多条流水共享事务结束时的余额',
  `reason`        VARCHAR(32)     NOT NULL                COMMENT 'settle/breakthrough/shop/use/cave/reroll/sell/battle/init',
  `remark`        VARCHAR(64)     NULL,
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_role_time` (`role_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='货币流水';

-- ------------------------------------------------------------
-- 行动记录：给"右侧行动区"用的玩家可读战报式短讯
-- 与流水表分工：流水给运营对账，本表给玩家看"我刚做了什么"
-- ------------------------------------------------------------
CREATE TABLE `log_action` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_id`    BIGINT UNSIGNED NOT NULL,
  `type`       VARCHAR(24)     NOT NULL                COMMENT 'init/settle/shop/battle/cave/breakthrough/use/reroll/sell/equip',
  `text`       VARCHAR(160)    NOT NULL                COMMENT '一句人话，如「在坊市购入 玄铁重剑 ×1，耗灵石 6000」',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_role_time` (`role_id`,`created_at`),
  CONSTRAINT `fk_action_role` FOREIGN KEY (`role_id`) REFERENCES `role` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='行动记录';

-- ------------------------------------------------------------
-- 战斗记录：seed 用于服务端复算校验（防作弊）
-- ------------------------------------------------------------
CREATE TABLE `log_battle` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_id`    BIGINT UNSIGNED NOT NULL,
  `stage_id`   INT             NOT NULL,
  `seed`       BIGINT UNSIGNED NOT NULL,
  `win`        TINYINT         NOT NULL,
  `rounds`     TINYINT         NOT NULL DEFAULT 0,
  `detail`     JSON            NOT NULL                COMMENT '战报明细',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_role_time` (`role_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='战斗记录';
