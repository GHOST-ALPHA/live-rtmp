#!/bin/bash

# Production SSL Bootstrap Script for Let's Encrypt + Nginx
# Run this on your production Linux server at 159.89.170.164

domains=(live.naxatranewshindi.com)
rsa_key_size=4096
data_path="./certbot"
email="admin@naxatranewshindi.com" # Dynamic email for Let's Encrypt notices
staging=0 # Set to 1 to test certificate generation without rate limits

if [ -d "$data_path/conf/live/$domains" ]; then
  echo "### Existing certificates found for $domains. Skipping bootstrap."
  echo "### If you want to force re-creation, delete the '$data_path/conf' directory and re-run."
  exit 0
fi

echo "### Creating dummy certificate for $domains (allowing Nginx to start)..."
path="/etc/letsencrypt/live/$domains"
mkdir -p "$data_path/conf/live/$domains"
docker compose run --rm --entrypoint \
  "openssl req -x509 -nodes -newkey rsa:2048 -days 1\
    -keyout '$path/privkey.pem' \
    -out '$path/fullchain.pem' \
    -subj '/CN=localhost'" certbot

echo "### Starting Nginx..."
docker compose up --force-recreate -d nginx

echo "### Deleting dummy certificate..."
docker compose run --rm --entrypoint \
  "rm -Rf /etc/letsencrypt/live/$domains && \
   rm -Rf /etc/letsencrypt/archive/$domains && \
   rm -Rf /etc/letsencrypt/renewal/$domains.conf" certbot

echo "### Requesting Let's Encrypt certificate for $domains..."
# Select challenge directory
mkdir -p "$data_path/www"

# Enable staging if requested
staging_arg=""
if [ $staging -ne 0 ]; then staging_arg="--staging"; fi

docker compose run --rm --entrypoint \
  "certbot certonly --webroot -w /var/www/certbot \
    $staging_arg \
    --email '$email' \
    --agree-tos \
    --no-eff-email \
    -d $domains \
    --preferred-challenges http-01 \
    --keep-until-expiring" certbot

echo "### Reloading Nginx with new production certificates..."
docker compose exec nginx nginx -s reload

echo "### Let's Encrypt SSL Bootstrap Completed Successfully! ###"
