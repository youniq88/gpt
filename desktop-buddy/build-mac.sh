#!/bin/bash
# 맥에서 desktop-buddy 를 "Desktop Buddy.app" 으로 만들어 응용 프로그램 폴더에 설치하고 실행한다.
# 맥에서 직접 빌드하므로 "확인되지 않은 개발자" 격리 표시가 붙지 않는다.

DIR=$(find ~ -maxdepth 4 -name start-mac.command -path '*desktop-buddy*' -not -path '*/Library/*' -not -path '*/build/*' 2>/dev/null | head -1 | xargs -I{} dirname "{}")
[ -z "$DIR" ] && { echo "desktop-buddy 폴더를 못 찾았어요"; exit 1; }
echo "① 앱 폴더: $DIR"
cd "$DIR" || exit 1

export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
command -v npm >/dev/null || { echo "Node.js 가 없어요"; exit 1; }

# 실행 중인 캐릭터를 끈다 (개발 실행본과 앱 둘 다)
pkill -f 'desktop-buddy/node_modules/electron' 2>/dev/null
pkill -f 'Desktop Buddy.app/Contents/MacOS' 2>/dev/null

echo "② 최신 코드 받는 중..."
BASE=https://raw.githubusercontent.com/youniq88/gpt/claude/dreamy-noether-y5bv0z/desktop-buddy
mkdir -p backup && cp index.html main.js preload.js backup/ 2>/dev/null
for f in index.html main.js preload.js control.html README.md; do
  curl -fsSL "$BASE/$f" -o "$f.new" && mv "$f.new" "$f" || { echo "$f 받기 실패"; exit 1; }
done
[ -d node_modules/electron ] || npm install || { echo "npm install 실패"; exit 1; }

echo "③ 앱 아이콘 만드는 중..."
mkdir -p build && rm -rf build/icon.iconset && mkdir build/icon.iconset
for s in 16 32 128 256 512; do
  sips -z $s $s base.png --out "build/icon.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) base.png --out "build/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns build/icon.iconset -o build/icon.icns || echo "   (아이콘 생략)"

# 마이크 사용 안내 문구(없으면 맥이 마이크를 막는다) + 독 아이콘 숨김
cat > build/info.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>NSMicrophoneUsageDescription</key><string>말소리에 맞춰 캐릭터 입을 움직이기 위해 마이크를 사용합니다.</string>
<key>LSUIElement</key><true/>
</dict></plist>
PLIST

echo "④ 앱 만드는 중 (1~3분)..."
ARCH=$(uname -m); [ "$ARCH" = "x86_64" ] && ARCH=x64
ICON_OPT=(); [ -f build/icon.icns ] && ICON_OPT=(--icon=build/icon.icns)
npx -y @electron/packager@18 . "Desktop Buddy" \
  --platform=darwin --arch="$ARCH" --out=build --overwrite \
  --app-bundle-id=com.youniq.desktopbuddy \
  --extend-info=build/info.plist "${ICON_OPT[@]}" \
  --ignore='^/(build|backup|gen\.html|gen-jitter\.js|capture\.js|.*\.bat|.*\.command|.*\.sh|.*\.log|HANDOFF\.md|\.git)' \
  || { echo "앱 만들기 실패"; exit 1; }

APP="build/Desktop Buddy-darwin-$ARCH/Desktop Buddy.app"
# 내용을 바꿨으므로 다시 서명한다 (애플 실리콘은 서명이 없으면 실행이 막힌다)
codesign --force --deep --sign - "$APP" || { echo "서명 실패"; exit 1; }

echo "⑤ 응용 프로그램 폴더에 설치 중..."
DEST=/Applications
if ! { rm -rf "$DEST/Desktop Buddy.app" && cp -R "$APP" "$DEST/"; } 2>/dev/null; then
  DEST="$HOME/Applications"; mkdir -p "$DEST"
  rm -rf "$DEST/Desktop Buddy.app" && cp -R "$APP" "$DEST/" || { echo "설치 실패"; exit 1; }
fi
echo "   설치됨: $DEST/Desktop Buddy.app"

echo "⑥ 실행합니다! 마이크 권한 창이 뜨면 '허용'을 눌러주세요."
open "$DEST/Desktop Buddy.app"
