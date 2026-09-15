CREATE TRIGGER award_completion AFTER INSERT ON completions WHEN NOT EXISTS(SELECT 1 FROM settings WHERE key='restore_mode' AND value='1') BEGIN
 INSERT INTO tickets(student_id,delta,completion_id,reason,created_at) VALUES(NEW.student_id,1,NEW.id,'completion',NEW.completed_at);
 UPDATE rounds SET finished_at=NEW.completed_at WHERE id=NEW.round_id AND finished_at IS NULL AND (SELECT COUNT(*) FROM completions WHERE round_id=NEW.round_id AND revoked_at IS NULL)=(SELECT COUNT(*) FROM mishnayot);
 INSERT OR IGNORE INTO rounds(number,started_at) SELECT 2,NEW.completed_at FROM rounds WHERE id=NEW.round_id AND number=1 AND finished_at IS NOT NULL;
END;
--> statement-breakpoint
CREATE TRIGGER finish_lease AFTER UPDATE OF result ON leases WHEN OLD.result IS NULL AND NEW.result='correct' BEGIN
 INSERT INTO completions(round_id,mishnah_id,student_id,class_id,completed_at,content_revision) SELECT NEW.round_id,NEW.mishnah_id,NEW.student_id,class_id,unixepoch(),NEW.content_revision FROM students WHERE id=NEW.student_id;
END;
--> statement-breakpoint
CREATE TRIGGER wrong_lease AFTER UPDATE OF result ON leases WHEN OLD.result IS NULL AND NEW.result='wrong' BEGIN
 INSERT INTO cooldowns(student_id,mishnah_id,until_at) VALUES(NEW.student_id,NEW.mishnah_id,unixepoch()+CAST((SELECT value FROM settings WHERE key='cooldown_seconds') AS INTEGER)) ON CONFLICT(student_id,mishnah_id) DO UPDATE SET until_at=excluded.until_at;
END;
--> statement-breakpoint
CREATE TRIGGER no_negative_tickets BEFORE INSERT ON tickets WHEN NEW.delta<0 AND NOT EXISTS(SELECT 1 FROM settings WHERE key='restore_mode' AND value='1') AND (SELECT COALESCE(SUM(delta),0) FROM tickets WHERE student_id=NEW.student_id)+NEW.delta<0 BEGIN
 SELECT RAISE(ABORT,'negative_ticket_balance');
END;
--> statement-breakpoint
CREATE TRIGGER revoke_completion AFTER UPDATE OF revoked_at ON completions WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL BEGIN
 INSERT INTO tickets(student_id,delta,reason,created_at) VALUES(NEW.student_id,-1,'ביטול השלמה '||NEW.id,NEW.revoked_at);
END;
