ALTER TABLE `items` ADD `ownerType` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `items` ADD `ownerId` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `items` ADD `recurRule` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `items` ADD `recurParentId` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_items_owner` ON `items` (`ownerType`, `ownerId`);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'account' NOT NULL,
	`name` text NOT NULL,
	`identifier` text DEFAULT '' NOT NULL,
	`authority` text DEFAULT '' NOT NULL,
	`owner` text DEFAULT '' NOT NULL,
	`projectId` text,
	`validFrom` integer,
	`validUntil` integer,
	`renewRule` text DEFAULT '' NOT NULL,
	`remindDays` text DEFAULT '30,14,7' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`sourceItemId` text DEFAULT '' NOT NULL,
	`secretRef` text DEFAULT '' NOT NULL,
	`notesMd` text DEFAULT '' NOT NULL,
	`cost` integer,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_assets_until` ON `assets` (`validUntil`);
--> statement-breakpoint
CREATE INDEX `idx_assets_kind` ON `assets` (`kind`);
--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`specMd` text DEFAULT '' NOT NULL,
	`caveatsMd` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'idea' NOT NULL,
	`budget` integer,
	`qty` integer DEFAULT 1 NOT NULL,
	`neededBy` integer,
	`projectId` text,
	`chosenQuoteId` text,
	`orderNo` text DEFAULT '' NOT NULL,
	`orderedAt` integer,
	`receivedAt` integer,
	`warrantyUntil` integer,
	`holder` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`invoiceStatus` text DEFAULT 'none' NOT NULL,
	`assetId` text,
	`createdBy` text DEFAULT '' NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_purchases_status` ON `purchases` (`status`);
--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`purchaseId` text NOT NULL,
	`vendor` text NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`price` integer NOT NULL,
	`shipping` integer DEFAULT 0 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`capturedAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_quotes_purchase` ON `quotes` (`purchaseId`);
--> statement-breakpoint
CREATE TABLE `orgs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'client' NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`notesMd` text DEFAULT '' NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`orgId` text,
	`name` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`wechat` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`notesMd` text DEFAULT '' NOT NULL,
	`lastContactAt` integer,
	`contactEveryDays` integer,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_contacts_org` ON `contacts` (`orgId`);
--> statement-breakpoint
CREATE TABLE `deals` (
	`id` text PRIMARY KEY NOT NULL,
	`orgId` text,
	`contactId` text,
	`title` text NOT NULL,
	`stage` text DEFAULT 'lead' NOT NULL,
	`amount` integer,
	`probability` integer,
	`expectedCloseAt` integer,
	`nextStep` text DEFAULT '' NOT NULL,
	`nextStepAt` integer,
	`projectId` text,
	`lostReason` text DEFAULT '' NOT NULL,
	`notesMd` text DEFAULT '' NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_deals_stage` ON `deals` (`stage`);
--> statement-breakpoint
CREATE TABLE `trips` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`purpose` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`startAt` integer NOT NULL,
	`endAt` integer NOT NULL,
	`dealId` text,
	`projectId` text,
	`legsJson` text DEFAULT '[]' NOT NULL,
	`lodgingJson` text DEFAULT '[]' NOT NULL,
	`attendees` text DEFAULT '' NOT NULL,
	`notesMd` text DEFAULT '' NOT NULL,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_trips_start` ON `trips` (`startAt`);
--> statement-breakpoint
CREATE TABLE `calendar_feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`tokenHash` text NOT NULL,
	`prefix` text NOT NULL,
	`revokedAt` integer,
	`lastUsedAt` integer,
	`createdAt` integer DEFAULT (cast(strftime('%s','now') as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feeds_tokenHash_unique` ON `calendar_feeds` (`tokenHash`);