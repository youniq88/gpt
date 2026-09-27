#!/bin/bash
# 맥에서 desktop-buddy 를 최신 코드로 바꾸고 다시 실행한다.
DIR=$(find ~ -maxdepth 4 -name start-mac.command -path '*desktop-buddy*' -not -path '*/Library/*' 2>/dev/null | head -1 | xargs -I{} dirname "{}")
[ -z "$DIR" ] && { echo "desktop-buddy 폴더를 못 찾았어요"; exit 1; }
echo "앱 폴더: $DIR"
pkill -f 'desktop-buddy/node_modules/electron' 2>/dev/null
mkdir -p "$DIR/backup" && cp "$DIR"/{index.html,main.js,preload.js} "$DIR/backup/" 2>/dev/null
BASE=https://raw.githubusercontent.com/youniq88/gpt/claude/dreamy-noether-y5bv0z/desktop-buddy
for f in index.html main.js preload.js control.html README.md; do
  curl -fsSL "$BASE/$f" -o "$DIR/$f.new" && mv "$DIR/$f.new" "$DIR/$f" || { echo "$f 받기 실패"; exit 1; }
done
echo "업데이트 완료. 다시 실행합니다..."
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
cd "$DIR" && npm start
