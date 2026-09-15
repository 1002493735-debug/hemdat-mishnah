CREATE TABLE `audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`details` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chapters` (
	`tractate` text NOT NULL,
	`number` integer NOT NULL,
	PRIMARY KEY(`tractate`, `number`),
	FOREIGN KEY (`tractate`) REFERENCES `tractates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `classes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `classes_name_unique` ON `classes` (`name`);--> statement-breakpoint
CREATE TABLE `completions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`round_id` integer NOT NULL,
	`mishnah_id` text NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`completed_at` integer NOT NULL,
	`revoked_at` integer,
	`content_revision` integer NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mishnah_id`) REFERENCES `mishnayot`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `completed_once` ON `completions` (`round_id`,`mishnah_id`) WHERE "completions"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX `contribution` ON `completions` (`class_id`);--> statement-breakpoint
CREATE TABLE `content` (
	`mishnah_id` text PRIMARY KEY NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`questions` text DEFAULT '[]' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'missing' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`mishnah_id`) REFERENCES `mishnayot`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "content_status" CHECK("content"."status" IN ('missing','review','ready'))
);
--> statement-breakpoint
CREATE TABLE `cooldowns` (
	`student_id` text NOT NULL,
	`mishnah_id` text NOT NULL,
	`until_at` integer NOT NULL,
	PRIMARY KEY(`student_id`, `mishnah_id`),
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mishnah_id`) REFERENCES `mishnayot`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `leases` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` integer NOT NULL,
	`mishnah_id` text NOT NULL,
	`student_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`content_revision` integer NOT NULL,
	`text` text NOT NULL,
	`questions` text NOT NULL,
	`challenge` text,
	`result` text,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mishnah_id`) REFERENCES `mishnayot`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_lease` ON `leases` (`round_id`,`mishnah_id`) WHERE "leases"."result" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `one_student_lease` ON `leases` (`student_id`) WHERE "leases"."result" IS NULL;--> statement-breakpoint
CREATE TABLE `login_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`until_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mishnayot` (
	`id` text PRIMARY KEY NOT NULL,
	`tractate` text NOT NULL,
	`chapter` integer NOT NULL,
	`number` integer NOT NULL,
	FOREIGN KEY (`tractate`) REFERENCES `tractates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coordinates` ON `mishnayot` (`tractate`,`chapter`,`number`);--> statement-breakpoint
CREATE TABLE `rounds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`number` integer NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rounds_number_unique` ON `rounds` (`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_round` ON `rounds` ((1)) WHERE "rounds"."finished_at" IS NULL;--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`student_id` text,
	`role` text NOT NULL,
	`csrf` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`class_id` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`student_id` text NOT NULL,
	`delta` integer NOT NULL,
	`completion_id` integer,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`completion_id`) REFERENCES `completions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ticket_delta" CHECK("tickets"."delta" IN(-1,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_completion_ticket` ON `tickets` (`completion_id`) WHERE "tickets"."completion_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `student_tickets` ON `tickets` (`student_id`);--> statement-breakpoint
CREATE TABLE `tractates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
