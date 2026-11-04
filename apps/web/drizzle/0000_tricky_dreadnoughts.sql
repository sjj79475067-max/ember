CREATE TABLE `agent_changelog` (
	`id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`title` text NOT NULL,
	`bodyMd` text DEFAULT '' NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`tokenId` text,
	`agentName` text NOT NULL,
	`agentType` text DEFAULT 'generic' NOT NULL,
	`machine` text DEFAULT '' NOT NULL,
	`sessionRef` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`startedAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL,
	`lastSeenAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL,
	`closedAt` integer
);
--> statement-breakpoint
CREATE INDEX `idx_asess_agent` ON `agent_sessions` (`agentName`,`status`);--> statement-breakpoint
CREATE TABLE `ai_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`kind` text DEFAULT 'openai_compat' NOT NULL,
	`baseUrl` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`apiKeyEnc` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`isDefault` integer DEFAULT 0 NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`providerId` text NOT NULL,
	`feature` text NOT NULL,
	`inputTokens` integer DEFAULT 0 NOT NULL,
	`outputTokens` integer DEFAULT 0 NOT NULL,
	`ms` integer DEFAULT 0 NOT NULL,
	`ok` integer DEFAULT 1 NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`name` text NOT NULL,
	`agentType` text DEFAULT 'generic' NOT NULL,
	`prefix` text NOT NULL,
	`hash` text NOT NULL,
	`scopes` text DEFAULT 'read,write' NOT NULL,
	`lastUsedAt` integer,
	`revokedAt` integer,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_hash_unique` ON `api_tokens` (`hash`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actorType` text NOT NULL,
	`actorName` text DEFAULT '' NOT NULL,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entityId` text DEFAULT '' NOT NULL,
	`diffJson` text DEFAULT '{}' NOT NULL,
	`requestId` text DEFAULT '' NOT NULL,
	`ip` text DEFAULT '' NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_entity` ON `audit_log` (`entity`,`entityId`);--> statement-breakpoint
CREATE INDEX `idx_audit_time` ON `audit_log` (`createdAt`);--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`title` text NOT NULL,
	`rationaleMd` text DEFAULT '' NOT NULL,
	`impact` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'accepted' NOT NULL,
	`meetingId` text,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_decisions_project` ON `decisions` (`projectId`);--> statement-breakpoint
CREATE TABLE `file_refs` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`itemId` text,
	`label` text NOT NULL,
	`machine` text DEFAULT '' NOT NULL,
	`path` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'file' NOT NULL,
	`archiveTo` text DEFAULT 'local' NOT NULL,
	`sizeBytes` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`lastVerifiedAt` integer,
	`verifiedBy` text DEFAULT '' NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_files_project` ON `file_refs` (`projectId`);--> statement-breakpoint
CREATE INDEX `idx_files_verified` ON `file_refs` (`lastVerifiedAt`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text,
	`kind` text DEFAULT 'meeting' NOT NULL,
	`source` text DEFAULT 'paste' NOT NULL,
	`fingerprint` text NOT NULL,
	`rawText` text DEFAULT '' NOT NULL,
	`summaryMd` text DEFAULT '' NOT NULL,
	`createdItemIds` text DEFAULT '[]' NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_batches_fingerprint_unique` ON `import_batches` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `item_events` (
	`id` text PRIMARY KEY NOT NULL,
	`itemId` text NOT NULL,
	`actorType` text NOT NULL,
	`actorName` text DEFAULT '' NOT NULL,
	`action` text DEFAULT 'update' NOT NULL,
	`fromStatus` text DEFAULT '' NOT NULL,
	`toStatus` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_events_item` ON `item_events` (`itemId`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`workstreamId` text,
	`parentId` text,
	`title` text NOT NULL,
	`detailMd` text DEFAULT '' NOT NULL,
	`doneDefinition` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text DEFAULT 'P1' NOT NULL,
	`dueAt` integer,
	`evidence` text DEFAULT '' NOT NULL,
	`blockReason` text DEFAULT '' NOT NULL,
	`claimedBy` text DEFAULT '' NOT NULL,
	`claimedAt` integer,
	`claimNote` text DEFAULT '' NOT NULL,
	`sourceType` text DEFAULT 'manual' NOT NULL,
	`sourceRef` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`completedAt` integer,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_items_project_status` ON `items` (`projectId`,`status`);--> statement-breakpoint
CREATE INDEX `idx_items_due` ON `items` (`dueAt`);--> statement-breakpoint
CREATE INDEX `idx_items_claim` ON `items` (`claimedBy`);--> statement-breakpoint
CREATE TABLE `meetings` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`title` text NOT NULL,
	`heldAt` integer NOT NULL,
	`participants` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`minutesMd` text DEFAULT '' NOT NULL,
	`summaryMd` text DEFAULT '' NOT NULL,
	`attachments` text DEFAULT '[]' NOT NULL,
	`tags` text DEFAULT '' NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_meetings_project` ON `meetings` (`projectId`,`heldAt`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text,
	`title` text NOT NULL,
	`bodyMd` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `policies` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text,
	`title` text NOT NULL,
	`bodyMd` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`required` integer DEFAULT 0 NOT NULL,
	`appliesToTools` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `policy_acks` (
	`id` text PRIMARY KEY NOT NULL,
	`policyId` text NOT NULL,
	`policyVersion` integer NOT NULL,
	`actorType` text DEFAULT 'agent' NOT NULL,
	`actorName` text DEFAULT '' NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ack_unique` ON `policy_acks` (`policyId`,`policyVersion`,`actorName`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'admin' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`summaryMd` text DEFAULT '' NOT NULL,
	`dueAt` integer,
	`localRoot` text DEFAULT '' NOT NULL,
	`githubRepo` text DEFAULT '' NOT NULL,
	`archiveNote` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_key_unique` ON `projects` (`key`);--> statement-breakpoint
CREATE INDEX `idx_projects_status` ON `projects` (`status`);--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text,
	`targetType` text DEFAULT 'item' NOT NULL,
	`targetId` text DEFAULT '' NOT NULL,
	`kind` text NOT NULL,
	`severity` text DEFAULT 'P1' NOT NULL,
	`title` text NOT NULL,
	`bodyMd` text DEFAULT '' NOT NULL,
	`dedupeKey` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`snoozedUntil` integer,
	`ackedAt` integer,
	`ackedBy` text DEFAULT '' NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminders_dedupeKey_unique` ON `reminders` (`dedupeKey`);--> statement-breakpoint
CREATE INDEX `idx_reminders_status` ON `reminders` (`status`,`severity`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`tokenHash` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_tokenHash_unique` ON `sessions` (`tokenHash`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`updatedAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`passwordHash` text NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workstreams` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`name` text NOT NULL,
	`intent` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ws_project` ON `workstreams` (`projectId`);