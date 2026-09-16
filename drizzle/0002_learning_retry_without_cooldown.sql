-- Cooldown history is retained for backward-compatible backups but no longer enforced.
DROP TRIGGER IF EXISTS wrong_lease;
