#!/bin/bash
set -e

cd /opt/io

echo "Starting Io browser REPL..."
make serve CFLAGS="${IO_CFLAGS}" &

sleep 2

echo "Io browser REPL ready."
echo "wasmtime io available via: io"

tail -f /dev/null