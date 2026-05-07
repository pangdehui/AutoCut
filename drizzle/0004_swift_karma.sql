CREATE TABLE `projects` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `userId` int NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text,
  `createdAt` timestamp NOT NULL DEFAULT NOW()
);

ALTER TABLE `videos` ADD `projectId` int;