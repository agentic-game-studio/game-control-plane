#!/bin/sh
set -e

# Ensure the Railway volume mount point (and any sub-directories) exists
# and is owned by the non-root `node` user. The /data mount is owned by
# root when the volume is first created; this chown makes it writable.
mkdir -p /data/workspace 2>/dev/null || true
chown -R node:nodejs /data 2>/dev/null || true

# Drop privileges and run the CMD as the `node` user.
exec gosu node "$@"
