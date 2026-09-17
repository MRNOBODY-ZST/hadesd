-- Earlier versions served defaults without persisting a settings row. Preserve
-- that published identity before new installations receive neutral defaults.
-- Saved settings and immutable release documents are never rewritten here.
INSERT INTO site_settings(singleton, document)
SELECT 1, JSON_EXTRACT(s.document, '$.site')
FROM release_snapshot s
WHERE s.retained = TRUE
  AND JSON_TYPE(JSON_EXTRACT(s.document, '$.site')) = 'OBJECT'
  AND EXISTS (
    SELECT 1 FROM publish_job j
    WHERE j.release_id = s.id AND j.status = 'SUCCEEDED'
  )
  AND NOT EXISTS (SELECT 1 FROM site_settings WHERE singleton = 1)
ORDER BY s.created_at DESC, s.id DESC
LIMIT 1;
