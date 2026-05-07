CREATE TABLE `projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `processingTasks` MODIFY COLUMN `taskType` enum('analysis','editing','subtitle','combined','ai_edit') NOT NULL;--> statement-breakpoint
ALTER TABLE `videos` ADD `projectId` int;