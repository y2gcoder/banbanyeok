#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p .tools web/public/fonts
curl -fL https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/Korean/NotoSansCJKkr-Regular.otf -o .tools/NotoSansCJKkr-Regular.otf
python3 -m venv .tools/venv
.tools/venv/bin/pip install fonttools==4.68.0 brotli==1.2.1
.tools/venv/bin/pyftsubset .tools/NotoSansCJKkr-Regular.otf --output-file=web/public/fonts/NotoSansKR-og.otf --text='반반역 강남 홍대 신촌 가장 공평한 만남 0123456789분·ABC' --layout-features='*'
cp .tools/NotoSansCJKkr-Regular.otf web/public/fonts/NotoSansKR-full.otf
