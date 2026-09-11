#!/bin/sh
set -eu
case "$S3_BUCKET" in
  ''|*[!a-z0-9.-]*) echo 'Invalid S3_BUCKET' >&2; exit 1 ;;
esac
mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
mc ready local >/dev/null
mc mb --ignore-existing "local/$S3_BUCKET" >/dev/null
mc anonymous set none "local/$S3_BUCKET" >/dev/null
mc version enable "local/$S3_BUCKET" >/dev/null
cat > /tmp/media-policy.json <<EOF
{"Version":"2012-10-17","Statement":[
  {"Effect":"Allow","Action":["s3:GetBucketLocation","s3:ListBucket"],"Resource":["arn:aws:s3:::$S3_BUCKET"]},
  {"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:DeleteObject"],"Resource":["arn:aws:s3:::$S3_BUCKET/*"]}
]}
EOF
mc admin user add local "$AWS_ACCESS_KEY_ID" "$AWS_SECRET_ACCESS_KEY" >/dev/null
mc admin policy create local hadesd-media /tmp/media-policy.json >/dev/null
mc admin policy attach local hadesd-media --user "$AWS_ACCESS_KEY_ID" >/dev/null
echo 'Private media bucket and application identity are ready.'
