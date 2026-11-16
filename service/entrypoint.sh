#!/bin/sh
set -eu
mkdir -p /data
chown node:node /data
exec setpriv --reuid=node --regid=node --init-groups node service/server.mjs
