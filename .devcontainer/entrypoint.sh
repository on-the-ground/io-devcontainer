#!/bin/bash
set -e

cd /opt/io

echo "Starting Io browser REPL..."
make serve &
SERVER_PID=$!

cleanup() {
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    exit 0
}

trap cleanup TERM INT

while true; do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "Io browser server exited unexpectedly"
        exit 1
    fi

    if curl -sf http://localhost:8000 > /dev/null 2>&1; then
        break
    fi

    sleep 0.5
done

echo "======================================"
echo "Io browser REPL ready at http://localhost:8000"
echo "CLI: io"
echo "Direct: wasmtime /opt/io/build/bin/io_static"
echo "======================================"

wait "$SERVER_PID"