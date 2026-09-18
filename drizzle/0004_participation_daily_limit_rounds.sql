DROP INDEX `completed_once`;--> statement-breakpoint
CREATE UNIQUE INDEX `completed_once_per_student` ON `completions` (`round_id`,`mishnah_id`,`student_id`) WHERE "completions"."revoked_at" IS NULL;--> statement-breakpoint
DROP INDEX `one_lease`;--> statement-breakpoint
ALTER TABLE `leases` ADD `answered_at` integer;--> statement-breakpoint
ALTER TABLE `leases` ADD `day_start` integer;--> statement-breakpoint
ALTER TABLE `leases` ADD `day_end` integer;--> statement-breakpoint
ALTER TABLE `leases` ADD `school_added` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `leases` ADD `ticket_awarded` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
DROP TRIGGER finish_lease;
--> statement-breakpoint
DROP TRIGGER award_completion;
--> statement-breakpoint
CREATE TRIGGER award_completion AFTER INSERT ON completions WHEN NOT EXISTS(SELECT 1 FROM settings WHERE key='restore_mode' AND value='1') BEGIN
 UPDATE rounds SET finished_at=NEW.completed_at WHERE id=NEW.round_id AND finished_at IS NULL AND (SELECT COUNT(DISTINCT mishnah_id) FROM completions WHERE round_id=NEW.round_id AND revoked_at IS NULL)=(SELECT COUNT(*) FROM mishnayot);
 INSERT OR IGNORE INTO rounds(number,started_at) SELECT number+1,NEW.completed_at FROM rounds WHERE id=NEW.round_id AND finished_at IS NOT NULL;
END;
--> statement-breakpoint
CREATE TRIGGER finish_lease AFTER UPDATE OF result ON leases WHEN OLD.result IS NULL AND NEW.result='correct' BEGIN
 UPDATE leases SET school_added=NOT EXISTS(SELECT 1 FROM completions WHERE round_id=NEW.round_id AND mishnah_id=NEW.mishnah_id AND revoked_at IS NULL) WHERE id=NEW.id;
 INSERT OR IGNORE INTO completions(round_id,mishnah_id,student_id,class_id,completed_at,content_revision) SELECT NEW.round_id,NEW.mishnah_id,NEW.student_id,class_id,NEW.answered_at,NEW.content_revision FROM students WHERE id=NEW.student_id;
 INSERT INTO tickets(student_id,delta,completion_id,reason,created_at)
 SELECT NEW.student_id,1,c.id,'completion',NEW.answered_at FROM completions c JOIN students s ON s.id=c.student_id
 WHERE c.round_id=NEW.round_id AND c.mishnah_id=NEW.mishnah_id AND c.student_id=NEW.student_id AND c.revoked_at IS NULL AND s.is_staff=0
 AND NOT EXISTS(SELECT 1 FROM tickets WHERE completion_id=c.id)
 AND (SELECT COUNT(*) FROM tickets WHERE student_id=NEW.student_id AND delta=1 AND completion_id IS NOT NULL AND created_at>=NEW.day_start AND created_at<NEW.day_end)<3;
 UPDATE leases SET ticket_awarded=changes() WHERE id=NEW.id;
END;
--> statement-breakpoint
-- Keep every old completion and ticket. Resume automatically if the old bonus already ended.
INSERT INTO rounds(number,started_at) SELECT MAX(number)+1,unixepoch() FROM rounds HAVING COUNT(*)>0 AND NOT EXISTS(SELECT 1 FROM rounds WHERE finished_at IS NULL);
