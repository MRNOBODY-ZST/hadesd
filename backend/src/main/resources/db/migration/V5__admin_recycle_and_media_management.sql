ALTER TABLE content ADD COLUMN deleted_at VARCHAR(40) NULL;
CREATE INDEX content_deleted_created ON content(deleted_at,created_at,id);
ALTER TABLE revision ADD COLUMN publication_protected BOOLEAN NOT NULL DEFAULT FALSE;
-- An expired snapshot no longer contains its manifest. Older revisions cannot be
-- proven never published, so preserve them conservatively during this migration.
UPDATE revision r SET publication_protected=TRUE
 WHERE EXISTS(SELECT 1 FROM release_entry e WHERE e.revision_id=r.id)
    OR EXISTS(SELECT 1 FROM release_snapshot s WHERE s.retained=FALSE AND r.created_at<=s.created_at);
CREATE TABLE media_deletion_queue (
 media_id CHAR(36) PRIMARY KEY, created_at VARCHAR(40) NOT NULL
);
