ALTER TABLE `items` ADD `remindAt` integer;
--> statement-breakpoint
ALTER TABLE `items` ADD `remindedAt` integer;
--> statement-breakpoint
ALTER TABLE `capture_drafts` ADD `remindAt` integer;
--> statement-breakpoint
CREATE INDEX `idx_items_remind` ON `items` (`remindAt`);
