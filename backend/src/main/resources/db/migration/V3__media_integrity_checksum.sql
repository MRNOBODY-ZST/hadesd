-- Existing objects are nullable until verified by a controlled backup/restore audit.
-- All new uploads store SHA-256 computed from the accepted bytes before persistence.
ALTER TABLE media ADD COLUMN sha256 CHAR(64) NULL;
