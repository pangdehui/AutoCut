ALTER TABLE `processingTasks` MODIFY COLUMN `taskType` enum('analysis','editing','subtitle','combined','ai_edit','tts','ai_video_creator') NOT NULL;

ALTER TABLE `creditTransactions` MODIFY COLUMN `type` enum('analysis','editing','subtitle','admin_recharge','admin_deduction','ai_video_creator') NOT NULL;

ALTER TABLE `creditRates` MODIFY COLUMN `type` enum('analysis','editing','subtitle','ai_video_creator') NOT NULL;

INSERT INTO `creditRates` (`type`, `creditsPerMinute`, `description`) VALUES ('ai_video_creator', 30, 'AI 视频创作（理解需求+脚本+配音+剪辑）');
