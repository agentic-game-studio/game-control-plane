#!/bin/sh
set -e

# Ensure the Railway volume mount point and sub-directories exist
# and are owned by the non-root `node` user. The /data mount is owned by
# root when the volume is first created; this chown makes it writable.
# /data/store holds the app's JSON data files (dashboard, tickets, etc.).
mkdir -p /data/workspace /data/store 2>/dev/null || true
chown -R node:nodejs /data 2>/dev/null || true

# Drop privileges and run the CMD as the `node` user.
exec gosu node "$@"
