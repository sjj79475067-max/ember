CREATE TABLE `captures` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`externalId` text NOT NULL,
	`sender` text DEFAULT '' NOT NULL,
	`chatRef` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'text' NOT NULL,
	`rawText` text DEFAULT '' NOT NULL,
	`transcript` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`parser` text DEFAULT '' NOT NULL,
	`reviewRef` text DEFAULT '' NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cap_ext` ON `captures` (`channel`, `externalId`);
--> statement-breakpoint
CREATE INDEX `idx_cap_status` ON `captures` (`status`, `createdAt`);
--> statement-breakpoint
CREATE TABLE `capture_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`captureId` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`type` text DEFAULT 'item' NOT NULL,
	`projectId` text,
	`projectConfidence` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`dueAt` integer,
	`priority` text DEFAULT 'P1' NOT NULL,
	`targetItemId` text,
	`done` integer DEFAULT 0 NOT NULL,
	`waitingFor` text DEFAULT '' NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`fieldsJson` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`resultType` text DEFAULT '' NOT NULL,
	`resultId` text DEFAULT '' NOT NULL,
	`decidedBy` text DEFAULT '' NOT NULL,
	`decidedAt` integer,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cd_capture` ON `capture_drafts` (`captureId`);
--> statement-breakpoint
CREATE INDEX `idx_cd_status` ON `capture_drafts` (`status`);
