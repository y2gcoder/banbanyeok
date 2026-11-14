#!/bin/sh
set -eu
exec java -Xms32m -Xmx256m ${SPIKE_CDS_FLAGS:-} -cp "$(cat /app/classpath.txt)" MainKt
