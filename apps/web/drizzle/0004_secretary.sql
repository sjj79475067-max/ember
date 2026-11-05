ALTER TABLE `items` ADD `waitingFor` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `items` ADD `delegatedAt` integer;
--> statement-breakpoint
ALTER TABLE `items` ADD `followUpAt` integer;
--> statement-breakpoint
ALTER TABLE `items` ADD `plannedFor` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `items` ADD `rollCount` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `items` ADD `deferUntil` integer;
--> statement-breakpoint
CREATE TABLE `weekly_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`weekStart` text NOT NULL,
	`top3Json` text DEFAULT '[]' NOT NULL,
	`notesMd` text DEFAULT '' NOT NULL,
	`statsJson` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`author` text DEFAULT '' NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_reviews_weekStart_unique` ON `weekly_reviews` (`weekStart`);
--> statement-breakpoint
CREATE INDEX `idx_items_planned` ON `items` (`plannedFor`);
--> statement-breakpoint
CREATE INDEX `idx_items_waiting` ON `items` (`waitingFor`);
