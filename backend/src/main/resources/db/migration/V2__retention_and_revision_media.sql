ALTER TABLE release_snapshot ADD COLUMN retained BOOLEAN NOT NULL DEFAULT TRUE;
CREATE TABLE revision_media (
 revision_id CHAR(36) NOT NULL, media_id CHAR(36) NOT NULL,
 PRIMARY KEY(revision_id,media_id), FOREIGN KEY(revision_id) REFERENCES revision(id), FOREIGN KEY(media_id) REFERENCES media(id)
);
-- Conservative backfill: retain an object if its ID occurs anywhere in an immutable revision.
INSERT IGNORE INTO revision_media(revision_id,media_id)
 SELECT r.id,m.id FROM revision r JOIN media m ON LOCATE(m.id,CAST(r.document AS CHAR)) > 0;
