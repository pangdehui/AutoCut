CREATE TABLE `creditRates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` enum('analysis','editing','subtitle') NOT NULL,
	`creditsPerMinute` decimal(10,2) NOT NULL,
	`description` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `creditRates_id` PRIMARY KEY(`id`),
	CONSTRAINT `creditRates_type_unique` UNIQUE(`type`)
);
--> statement-breakpoint
CREATE TABLE `creditTransactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`amount` bigint NOT NULL,
	`type` enum('analysis','editing','subtitle','admin_recharge','admin_deduction') NOT NULL,
	`description` text,
	`taskId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `creditTransactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `emailVerificationCodes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`code` varchar(10) NOT NULL,
	`type` enum('register','login','reset') NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`usedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `emailVerificationCodes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `processingTasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`videoId` int NOT NULL,
	`taskType` enum('analysis','editing','subtitle','combined') NOT NULL,
	`status` enum('queued','processing','completed','failed') NOT NULL DEFAULT 'queued',
	`progress` int DEFAULT 0,
	`creditsUsed` bigint DEFAULT 0,
	`parameters` json,
	`result` json,
	`errorMessage` text,
	`queuedAt` timestamp NOT NULL DEFAULT (now()),
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `processingTasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subtitles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskId` int NOT NULL,
	`videoId` int NOT NULL,
	`language` varchar(10) NOT NULL,
	`filePath` text,
	`content` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `subtitles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `userCredits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`balance` bigint NOT NULL DEFAULT 0,
	`totalEarned` bigint NOT NULL DEFAULT 0,
	`totalUsed` bigint NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `userCredits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `videoAnalysis` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskId` int NOT NULL,
	`videoId` int NOT NULL,
	`sceneDescriptions` json,
	`keywords` json,
	`highlights` json,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `videoAnalysis_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `videos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`filePath` text NOT NULL,
	`fileSize` bigint NOT NULL,
	`duration` decimal(10,2),
	`mimeType` varchar(50) NOT NULL,
	`uploadedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `videos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `email` varchar(320) NOT NULL;--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `loginMethod` varchar(64) DEFAULT 'email';--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `lastSignedIn` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `emailVerified` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `isActive` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_email_unique` UNIQUE(`email`);