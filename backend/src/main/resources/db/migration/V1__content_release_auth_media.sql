CREATE TABLE admin_account (
 singleton TINYINT PRIMARY KEY DEFAULT 1, username VARCHAR(100) NOT NULL UNIQUE,
 password_hash VARCHAR(255) NOT NULL, created_at VARCHAR(40) NOT NULL,
 CONSTRAINT one_admin CHECK (singleton = 1)
);
CREATE TABLE content (
 id CHAR(36) PRIMARY KEY, type VARCHAR(20) NOT NULL, version BIGINT NOT NULL,
 created_at VARCHAR(40) NOT NULL, latest_revision_id CHAR(36) NULL
);
CREATE TABLE revision (
 id CHAR(36) PRIMARY KEY, content_id CHAR(36) NOT NULL, created_at VARCHAR(40) NOT NULL,
 document JSON NOT NULL, FOREIGN KEY(content_id) REFERENCES content(id), INDEX revision_content_created(content_id,created_at)
);
ALTER TABLE content ADD CONSTRAINT content_latest_revision FOREIGN KEY(latest_revision_id) REFERENCES revision(id);
CREATE TABLE site_settings (singleton TINYINT PRIMARY KEY, document JSON NOT NULL, CONSTRAINT one_settings CHECK (singleton = 1));
CREATE TABLE release_snapshot (
 id CHAR(36) PRIMARY KEY, created_at VARCHAR(40) NOT NULL, document JSON NOT NULL
);
CREATE TABLE release_entry (
 release_id CHAR(36) NOT NULL, content_id CHAR(36) NOT NULL, revision_id CHAR(36) NOT NULL,
 route VARCHAR(200) NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, plain_text MEDIUMTEXT NOT NULL, tags TEXT NOT NULL,
 PRIMARY KEY(release_id,content_id), UNIQUE KEY release_route(release_id,route),
 FOREIGN KEY(release_id) REFERENCES release_snapshot(id), FOREIGN KEY(revision_id) REFERENCES revision(id),
 FULLTEXT INDEX searchable(title,summary,plain_text,tags) WITH PARSER ngram
);
CREATE TABLE publish_job (
 id CHAR(36) PRIMARY KEY, release_id CHAR(36) NOT NULL, operation VARCHAR(20) NOT NULL,
 status VARCHAR(20) NOT NULL, created_at VARCHAR(40) NOT NULL, attempts INT NOT NULL DEFAULT 0,
 error VARCHAR(1000) NULL, lease_token CHAR(36) NULL, lease_expires_at BIGINT NULL,
 FOREIGN KEY(release_id) REFERENCES release_snapshot(id), INDEX claim_jobs(status,created_at)
);
CREATE TABLE publisher_lock (singleton TINYINT PRIMARY KEY);
INSERT INTO publisher_lock VALUES (1);
CREATE TABLE media (
 id CHAR(36) PRIMARY KEY, filename VARCHAR(255) NOT NULL, mime VARCHAR(100) NOT NULL,
 byte_size BIGINT NOT NULL, created_at VARCHAR(40) NOT NULL, storage_key VARCHAR(200) NOT NULL UNIQUE
);
CREATE TABLE release_media (
 release_id CHAR(36) NOT NULL, media_id CHAR(36) NOT NULL,
 PRIMARY KEY(release_id,media_id), FOREIGN KEY(release_id) REFERENCES release_snapshot(id), FOREIGN KEY(media_id) REFERENCES media(id)
);
CREATE TABLE audit_event (
 id CHAR(36) PRIMARY KEY, event VARCHAR(80) NOT NULL, subject_id VARCHAR(100) NOT NULL, created_at VARCHAR(40) NOT NULL
);
