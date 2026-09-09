#!/bin/sh
# Install as /etc/letsencrypt/renewal-hooks/deploy/50-hadesd-nginx.
# Certbot only invokes deploy hooks after a certificate is renewed successfully.
set -eu
/usr/sbin/nginx -t
/bin/systemctl reload nginx
