ALTER TABLE `students` ADD `is_staff` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
DROP TRIGGER award_completion;
--> statement-breakpoint
CREATE TRIGGER award_completion AFTER INSERT ON completions WHEN NOT EXISTS(SELECT 1 FROM settings WHERE key='restore_mode' AND value='1') BEGIN
 INSERT INTO tickets(student_id,delta,completion_id,reason,created_at) SELECT NEW.student_id,1,NEW.id,'completion',NEW.completed_at FROM students WHERE id=NEW.student_id AND is_staff=0;
 UPDATE rounds SET finished_at=NEW.completed_at WHERE id=NEW.round_id AND finished_at IS NULL AND (SELECT COUNT(*) FROM completions WHERE round_id=NEW.round_id AND revoked_at IS NULL)=(SELECT COUNT(*) FROM mishnayot);
 INSERT OR IGNORE INTO rounds(number,started_at) SELECT 2,NEW.completed_at FROM rounds WHERE id=NEW.round_id AND number=1 AND finished_at IS NOT NULL;
END;

--> statement-breakpoint
DROP TRIGGER revoke_completion;
--> statement-breakpoint
CREATE TRIGGER revoke_completion AFTER UPDATE OF revoked_at ON completions WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL BEGIN
 INSERT INTO tickets(student_id,delta,reason,created_at) SELECT NEW.student_id,-1,'ביטול השלמה '||NEW.id,NEW.revoked_at WHERE EXISTS(SELECT 1 FROM tickets WHERE completion_id=NEW.id AND delta=1);
END;
--> statement-breakpoint
CREATE TRIGGER no_staff_tickets BEFORE INSERT ON tickets WHEN EXISTS(SELECT 1 FROM students WHERE id=NEW.student_id AND is_staff=1) BEGIN
 SELECT RAISE(ABORT,'staff_ticket_forbidden');
END;
