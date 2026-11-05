ALTER TABLE `items` ADD `kind` text DEFAULT 'task' NOT NULL;
--> statement-breakpoint
ALTER TABLE `items` ADD `milestoneId` text;
--> statement-breakpoint
ALTER TABLE `items` ADD `requirementId` text;
--> statement-breakpoint
ALTER TABLE `items` ADD `mustMeet` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `items` ADD `startAt` integer;
--> statement-breakpoint
ALTER TABLE `items` ADD `leadTimeDays` integer;
--> statement-breakpoint
ALTER TABLE `items` ADD `templateKey` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `projects` ADD `template` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `projects` ADD `updateEveryDays` integer DEFAULT 7 NOT NULL;
--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'phase' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`goal` text DEFAULT '' NOT NULL,
	`startAt` integer,
	`dueAt` integer,
	`status` text DEFAULT 'planned' NOT NULL,
	`gateDecision` text DEFAULT 'pending' NOT NULL,
	`gateNote` text DEFAULT '' NOT NULL,
	`gateDecidedAt` integer,
	`gateDecidedBy` text DEFAULT '' NOT NULL,
	`gateProposal` text DEFAULT '' NOT NULL,
	`templateKey` text DEFAULT '' NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ms_project` ON `milestones` (`projectId`, `position`);
--> statement-breakpoint
CREATE TABLE `requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`detailMd` text DEFAULT '' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`priority` text DEFAULT 'P1' NOT NULL,
	`milestoneId` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`closeReason` text DEFAULT '' NOT NULL,
	`closeConfirmed` integer DEFAULT 1 NOT NULL,
	`closedAt` integer,
	`closedBy` text DEFAULT '' NOT NULL,
	`createdBy` text DEFAULT '' NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_req_project` ON `requirements` (`projectId`, `status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_req_code` ON `requirements` (`projectId`, `code`);
--> statement-breakpoint
CREATE TABLE `item_deps` (
	`id` text PRIMARY KEY NOT NULL,
	`blockerId` text NOT NULL,
	`blockedId` text NOT NULL,
	`lagDays` integer DEFAULT 0 NOT NULL,
	`createdBy` text DEFAULT '' NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_dep_pair` ON `item_deps` (`blockerId`, `blockedId`);
--> statement-breakpoint
CREATE INDEX `idx_dep_blocked` ON `item_deps` (`blockedId`);
--> statement-breakpoint
CREATE TABLE `project_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`health` text NOT NULL,
	`progressMd` text DEFAULT '' NOT NULL,
	`blockersMd` text DEFAULT '' NOT NULL,
	`nextMd` text DEFAULT '' NOT NULL,
	`autoSummary` text DEFAULT '' NOT NULL,
	`author` text DEFAULT '' NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pu_project` ON `project_updates` (`projectId`, `createdAt`);
--> statement-breakpoint
CREATE INDEX `idx_items_ms` ON `items` (`milestoneId`);
--> statement-breakpoint
CREATE INDEX `idx_items_req` ON `items` (`requirementId`);