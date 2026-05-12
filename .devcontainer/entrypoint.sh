#!/bin/bash
set -e

cd /opt/io

echo "Starting Io browser REPL..."
make serve CFLAGS="${IO_CFLAGS}" &
SERVER_PID=$!

trap 'kill "$SERVER_PID" 2>/dev/null; exit 0' TERM INT

until curl -sf http://localhost:8000 > /dev/null 2>&1; do
    sleep 0.5
done

echo "Io browser REPL ready at http://localhost:8000"
echo "CLI: io <file.io>"

wait "$SERVER_PID"
