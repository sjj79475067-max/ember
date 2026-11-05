ALTER TABLE `projects` ADD `isInbox` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `projects` ADD `aliases` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `items` ADD `parkingLot` integer;
--> statement-breakpoint
ALTER TABLE `items` ADD `sourceProjectKey` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `policies` ADD `status` text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE `policies` ADD `purpose` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `policies` ADD `scopeMode` text DEFAULT 'tools' NOT NULL;
--> statement-breakpoint
ALTER TABLE `policies` ADD `expiresAt` integer;
--> statement-breakpoint
ALTER TABLE `policies` ADD `reviewEveryDays` integer;
--> statement-breakpoint
ALTER TABLE `policies` ADD `lastReviewedAt` integer;
--> statement-breakpoint
ALTER TABLE `policies` ADD `proposedBy` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `policies` ADD `approvedBy` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `policies` ADD `approvedAt` integer;
--> statement-breakpoint
ALTER TABLE `items` ADD `needsReview` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `items` ADD `supersededBy` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_items_next` ON `items` (`projectId`, `status`, `dueAt`);
--> statement-breakpoint
-- 升级前已存在的「必读+全局+不限工具」条例：改为只在用户批准后按「全部写操作」生效，避免升级后全局卡死
UPDATE `policies` SET `scopeMode` = 'all', `purpose` = coalesce(nullif(`purpose`,''), '升级前已存在：作用范围未限定') WHERE `required` = 1 AND `projectId` IS NULL AND (`appliesToTools` IS NULL OR trim(`appliesToTools`) = '');