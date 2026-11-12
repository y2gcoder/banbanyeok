#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p .tools
if [ ! -x .tools/gradle-9.3.1/bin/gradle ]; then
 curl -fL https://services.gradle.org/distributions/gradle-9.3.1-bin.zip -o .tools/gradle.zip
 unzip -q .tools/gradle.zip -d .tools
fi
