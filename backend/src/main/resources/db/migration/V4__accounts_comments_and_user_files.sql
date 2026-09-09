CREATE TABLE blog_account (
 id CHAR(36) PRIMARY KEY, username VARCHAR(100) NOT NULL UNIQUE,
 display_name VARCHAR(60) NOT NULL, password_hash VARCHAR(255) NOT NULL,
 role VARCHAR(10) NOT NULL DEFAULT 'USER', created_at VARCHAR(40) NOT NULL,
 CONSTRAINT blog_account_role CHECK (role IN ('ADMIN','USER'))
);
INSERT INTO blog_account(id,username,display_name,password_hash,role,created_at)
 SELECT UUID(),username,LEFT(username,60),password_hash,'ADMIN',created_at FROM admin_account;
-- The controlled bootstrap inserts both legacy singleton and blog identity in one
-- transaction. Registration and bootstrap share this unique username index.
CREATE TABLE user_file (
 id CHAR(36) PRIMARY KEY, owner_id CHAR(36) NOT NULL,
 filename VARCHAR(200) NOT NULL, mime VARCHAR(100) NOT NULL, byte_size BIGINT NOT NULL,
 created_at VARCHAR(40) NOT NULL, sha256 CHAR(64) NOT NULL,
 FOREIGN KEY(owner_id) REFERENCES blog_account(id), INDEX user_file_owner(owner_id,created_at,id)
);
CREATE TABLE blog_comment (
 id CHAR(36) PRIMARY KEY, content_id CHAR(36) NOT NULL, author_id CHAR(36) NOT NULL,
 parent_id CHAR(36) NULL, body TEXT NOT NULL, created_at VARCHAR(40) NOT NULL,
 updated_at VARCHAR(40) NOT NULL, deleted BOOLEAN NOT NULL DEFAULT FALSE,
 FOREIGN KEY(content_id) REFERENCES content(id), FOREIGN KEY(author_id) REFERENCES blog_account(id),
 FOREIGN KEY(parent_id) REFERENCES blog_comment(id),
 INDEX comments_content(content_id,deleted,created_at,id),
 INDEX comments_author(author_id,deleted,created_at,id)
);
CREATE TABLE comment_file (
 comment_id CHAR(36) NOT NULL, file_id CHAR(36) NOT NULL,
 PRIMARY KEY(comment_id,file_id), FOREIGN KEY(comment_id) REFERENCES blog_comment(id),
 FOREIGN KEY(file_id) REFERENCES user_file(id), INDEX comment_file_file(file_id)
);
