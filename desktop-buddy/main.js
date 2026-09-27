const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, desktopCapturer } = require('electron');
const path = require('path');

// 설정 저장 폴더를 전용으로 분리한다.
// 이 줄이 없으면 %APPDATA%\Electron 을 쓰는데, 패키징하지 않은 다른
// Electron 앱들과 폴더를 공유해 설정이 섞일 수 있다.
// (app.getPath('userData') 를 읽기 전에 호출해야 적용된다)
app.setName('desktop-buddy');

// --- 자원 절약 설정 (창을 만들기 전에 지정해야 적용된다) ---
// 이 앱은 정지 이미지 두 장만 쓰므로 무거운 기능이 전부 필요 없다.
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=48');
app.commandLine.appendSwitch('disable-features', [
  'CalculateNativeWinOcclusion', // 항상 위 창의 가림 판정 계산 제거(불필요한 CPU)
  'MediaSessionService',
  'HardwareMediaKeyHandling',
].join(','));
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// 정지 이미지 두 장을 번갈아 보여줄 뿐이라 GPU 가속이 필요 없다.
// 끄면 GPU 프로세스(약 100MB)가 통째로 사라진다.
// 화면이 깨지거나 깜빡이면 NO_GPU=0 으로 실행해 되돌릴 수 있다.
if (process.env.NO_GPU !== '0') {
  app.disableHardwareAcceleration();
}

const fs = require('fs');

let win = null;   // 캐릭터 창
let ctl = null;   // 조작판 창
let tray = null;
let trayThroughItem = null;
let clickThrough = false;

// 창이 살아 있을 때만 보낸다
function toChar(ch, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(ch, ...args);
}
function toCtl(ch, ...args) {
  if (ctl && !ctl.isDestroyed()) ctl.webContents.send(ch, ...args);
}

// --- 크기·위치 기억하기 ---
const MIN_SIZE = 120;
const MAX_SIZE = 1400;
const DEFAULT_SIZE = 340;
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    // 앞의 BOM 을 떼고 읽는다. BOM 이 붙어 있으면 JSON.parse 가 실패해
    // 설정이 말없이 초기화되어 버린다.
    const raw = fs.readFileSync(settingsPath, 'utf8').replace(/^﻿/, '');
    const s = JSON.parse(raw);
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {}; // 파일이 없거나 깨졌으면 기본값으로
  }
}

// 저장된 설정을 메모리에 들고 있는다. 창 크기만 저장하면서
// 민감도 같은 다른 값을 지워버리는 일이 없도록 항상 병합해서 쓴다.
let settings = {};

function writeSettingsNow() {
  try {
    if (win && !win.isDestroyed()) {
      const [w] = win.getSize();
      const [x, y] = win.getPosition();
      settings.size = w;
      settings.x = x;
      settings.y = y;
    }
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
    return true;
  } catch (e) {
    console.error('설정 저장 실패:', e.message);
    return false;
  }
}

let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  // 드래그 중에는 이벤트가 쏟아지므로 잠잠해진 뒤에 한 번만 쓴다
  saveTimer = setTimeout(writeSettingsNow, 500);
}

function clampSize(n) {
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(n)));
}

// 화면 밖으로 완전히 나가버리지 않도록 위치를 보정한다
function visibleOnSomeDisplay(x, y, size) {
  return screen.getAllDisplays().some((d) => {
    const b = d.workArea;
    return x + size > b.x + 40 && x < b.x + b.width - 40
        && y + size > b.y + 40 && y < b.y + b.height - 40;
  });
}

function resizeTo(newSize, anchorCenter = true) {
  if (!win || win.isDestroyed()) return;
  const size = clampSize(newSize);
  const [oldW] = win.getSize();
  if (size === oldW) return;

  let [x, y] = win.getPosition();
  if (anchorCenter) {
    // 가운데를 기준으로 커지고 작아지게 — 캐릭터가 튀지 않는다
    const d = (size - oldW) / 2;
    x = Math.round(x - d);
    y = Math.round(y - d);
  }
  win.setBounds({ x, y, width: size, height: size });
  saveSettings();
  toChar('size-changed', size);
  toCtl('size-changed', size);
}

function createWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  settings = loadSettings();
  const saved = settings;

  const size = clampSize(saved.size || DEFAULT_SIZE);
  let x = Number.isInteger(saved.x) ? saved.x : width - size - 40;
  let y = Number.isInteger(saved.y) ? saved.y : 80;
  if (!visibleOnSomeDisplay(x, y, size)) {
    x = width - size - 40;
    y = 80;
  }

  win = new BrowserWindow({
    width: size,
    height: size, // 원본 이미지가 정사각형이라 창도 정사각형으로
    minWidth: MIN_SIZE,
    minHeight: MIN_SIZE,
    maxWidth: MAX_SIZE,
    maxHeight: MAX_SIZE,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 창이 포커스를 잃어도 타이머가 느려지면 안 된다.
      // (다른 프로그램으로 강의하는 동안에도 입이 움직여야 하므로)
      backgroundThrottling: false,
      spellcheck: false,
      webgl: false,
      devTools: false,
      enableWebSQL: false,
    },
  });

  // 전체화면(발표/녹화) 위에서도 계속 보이도록.
  // 맥은 visibleOnFullScreen 을 켜야 전체화면 앱 위에 남는다.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // 가장자리를 끌어 크기를 바꿔도 항상 정사각형을 유지 → 캐릭터가 찌그러지지 않는다
  win.setAspectRatio(1);

  // 사용자가 직접 옮기거나 크기를 바꾼 것도 기억한다
  win.on('resize', saveSettings);
  // 가장자리를 끌어 바꾼 크기도 조작판 숫자에 반영
  win.on('resize', () => toCtl('size-changed', win.getSize()[0]));
  win.on('move', saveSettings);

  // 마이크 권한 자동 허용 (요청 시 + 사전 확인 시 둘 다 필요)
  const ses = win.webContents.session;
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === 'media' || permission === 'audioCapture');
  });
  ses.setPermissionCheckHandler((wc, permission) => {
    return permission === 'media' || permission === 'audioCapture';
  });

  // PC 사운드 모드: getDisplayMedia 요청이 오면 화면 선택 창 없이
  // 주 모니터 + 시스템 소리(루프백)를 바로 넘긴다. 화면 트랙은 렌더러가
  // 받자마자 끄고 오디오만 쓴다.
  ses.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer.getSources({ types: ['screen'] })
      .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
      .catch(() => callback({}));
  });

  win.loadFile('index.html');

  // 개발용: SELF_CAPTURE=<0~1> 로 실행하면 실제 운영 설정 그대로의 창을
  // PNG 로 저장하고 종료한다. (GPU 설정 등이 화면에 영향을 주는지 확인)
  if (process.env.SELF_CAPTURE) {
    const fs = require('fs');
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 2000));
      await win.webContents.executeJavaScript(
        `document.body.dataset.forceLevel = '${process.env.SELF_CAPTURE}';`
      );
      if (process.env.SELF_UI === '1') {
        // 우클릭했을 때와 같은 상태를 만든다
        await win.webContents.executeJavaScript(
          "window.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))"
        );
      }
      await new Promise((r) => setTimeout(r, 400));
      for (let i = 0; i < 10; i++) {
        const img = await win.webContents.capturePage();
        const buf = img.isEmpty() ? Buffer.alloc(0) : img.toPNG();
        if (buf.length) {
          fs.writeFileSync(path.join(__dirname, 'selfshot.png'), buf);
          break;
        }
        await new Promise((r) => setTimeout(r, 600));
      }
      app.quit();
    });
  }
}

function setClickThrough(value) {
  clickThrough = value;
  win.setIgnoreMouseEvents(value, { forward: true });
  if (trayThroughItem) trayThroughItem.checked = value;
  toChar('click-through-changed', value);
  toCtl('click-through-changed', value);
}

// --- 조작판 창 ---
// 캐릭터 창과 분리된 일반 창. 방송 화면에는 캐릭터만 잡히고,
// 조작은 이 창에서 한다. 닫아도 앱은 계속 돈다(우클릭·트레이로 다시 열기).
function openControl() {
  if (ctl && !ctl.isDestroyed()) {
    ctl.show();
    ctl.focus();
    return;
  }
  const saved = settings.control || {};
  const opts = {
    width: 400,
    height: 720,
    minWidth: 340,
    minHeight: 420,
    title: 'Desktop Buddy 조작판',
    backgroundColor: '#1b1b1d',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      devTools: false,
    },
  };
  if (Number.isInteger(saved.x) && Number.isInteger(saved.y)
      && visibleOnSomeDisplay(saved.x, saved.y, 200)) {
    opts.x = saved.x;
    opts.y = saved.y;
  }
  if (Number.isInteger(saved.w) && Number.isInteger(saved.h)) {
    opts.width = saved.w;
    opts.height = saved.h;
  }
  ctl = new BrowserWindow(opts);
  ctl.setMenuBarVisibility(false);
  ctl.loadFile('control.html');

  const remember = () => {
    if (!ctl || ctl.isDestroyed()) return;
    const b = ctl.getBounds();
    settings.control = { x: b.x, y: b.y, w: b.width, h: b.height };
    saveSettings();
  };
  ctl.on('move', remember);
  ctl.on('resize', remember);
  // 조작판이 보일 때만 캐릭터 창이 진단 숫자를 계산·전송한다
  ctl.on('show', () => toChar('control-visible', true));
  ctl.on('hide', () => toChar('control-visible', false));
  ctl.webContents.on('did-finish-load', () => toChar('control-visible', true));
  ctl.on('closed', () => {
    ctl = null;
    toChar('control-visible', false);
  });
}

function createTray() {
  // 맥 메뉴막대에서도 보이도록 실제 아이콘 파일을 쓴다.
  // (예전엔 1x1 투명 이미지라 맥에서는 아무것도 안 보였다)
  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
  // 맥은 템플릿 이미지로 지정해야 밝은/어두운 메뉴막대에 맞춰 색이 반전된다
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray = new Tray(icon);
  const menu = Menu.buildFromTemplate([
    { label: '조작판 열기', click: () => openControl() },
    { type: 'separator' },
    {
      label: '크기',
      submenu: [
        { label: '아주 작게 (160)', click: () => resizeTo(160) },
        { label: '작게 (240)', click: () => resizeTo(240) },
        { label: '보통 (340)', click: () => resizeTo(340) },
        { label: '크게 (480)', click: () => resizeTo(480) },
        { label: '아주 크게 (640)', click: () => resizeTo(640) },
        { type: 'separator' },
        { label: '10% 키우기', click: () => resizeTo(win.getSize()[0] * 1.1) },
        { label: '10% 줄이기', click: () => resizeTo(win.getSize()[0] / 1.1) },
      ],
    },
    {
      id: 'through',
      label: '클릭 통과 (마우스 무시)',
      type: 'checkbox',
      checked: false,
      click: (item) => setClickThrough(item.checked),
    },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]);
  trayThroughItem = menu.getMenuItemById('through');
  tray.setToolTip('Desktop Buddy');
  tray.setContextMenu(menu);
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    // 독 아이콘 숨김 — 윈도우의 skipTaskbar 와 같은 역할
    if (app.dock) app.dock.hide();
    // 맥은 마이크 권한을 시스템에 따로 요청해야 한다
    try {
      const { systemPreferences } = require('electron');
      await systemPreferences.askForMediaAccess('microphone');
    } catch (e) {
      console.error('마이크 권한 요청 실패:', e.message);
    }
  }
  createWindow();
  createTray();
  openControl();
});

// 캐릭터 창이 닫히면(=앱 종료 의도) 조작판도 함께 닫고 끝낸다.
// 조작판만 닫는 것은 앱 종료가 아니다.
app.on('window-all-closed', () => app.quit());

ipcMain.on('quit-app', () => app.quit());
ipcMain.on('toggle-click-through', () => setClickThrough(!clickThrough));
ipcMain.handle('get-click-through', () => clickThrough);
ipcMain.on('open-control', () => openControl());

// 조작판 → 캐릭터 창 중계
ipcMain.on('play-motion', (_e, name) => {
  if (typeof name === 'string') toChar('play-motion', name);
});
// 캐릭터 창 → 조작판 중계 (진단 숫자, 안내 문구)
ipcMain.on('diag', (_e, d) => toCtl('diag', d));
ipcMain.on('char-msg', (_e, text) => toCtl('char-msg', String(text || '')));

// 배율로 조절 (휠, +/- 버튼)
ipcMain.on('resize-by', (_e, factor) => {
  if (typeof factor !== 'number' || !isFinite(factor) || factor <= 0) return;
  resizeTo(win.getSize()[0] * factor);
});
// 절대 크기로 조절 (프리셋)
ipcMain.on('resize-to', (_e, size) => {
  if (typeof size !== 'number' || !isFinite(size)) return;
  resizeTo(size);
});
ipcMain.handle('get-size', () => (win && !win.isDestroyed() ? win.getSize()[0] : DEFAULT_SIZE));
ipcMain.handle('get-settings', () => settings);

// [저장] 버튼: 대기 중인 지연 저장을 취소하고 지금 즉시 파일에 쓴다
ipcMain.handle('save-now', () => {
  clearTimeout(saveTimer);
  return writeSettingsNow();
});

ipcMain.on('set-sensitivity', (_e, v) => {
  if (typeof v !== 'number' || !isFinite(v)) return;
  settings.sensitivity = Math.max(0.8, Math.min(6, v));
  saveSettings();
  toChar('apply-sensitivity', settings.sensitivity);
});

// --- 동작(모션) ---
const motionsDir = path.join(__dirname, 'motions');
ipcMain.handle('list-motions', () => {
  try {
    if (!fs.existsSync(motionsDir)) fs.mkdirSync(motionsDir);
    return fs.readdirSync(motionsDir)
      .filter((f) => /\.(png|jpe?g|gif|webp)$/i.test(f))
      .sort();
  } catch {
    return [];
  }
});
ipcMain.on('set-audio-source', (_e, v) => {
  settings.audioSource = v === 'pc' ? 'pc' : 'mic';
  saveSettings();
  toChar('apply-audio-source', settings.audioSource);
});

ipcMain.on('set-chroma', (_e, on) => {
  settings.chroma = !!on;
  saveSettings();
  toChar('apply-chroma', settings.chroma);
});

ipcMain.on('set-motion-config', (_e, cfg) => {
  if (!cfg || typeof cfg !== 'object') return;
  settings.motionConfig = {
    interval: Math.min(120, Math.max(2, Number(cfg.interval) || 8)),
    loudRatio: Math.min(5, Math.max(1.5, Number(cfg.loudRatio) || 2.3)),
    trigger: cfg.trigger === 'loud' ? 'loud' : 'random',
    items: cfg.items && typeof cfg.items === 'object' ? cfg.items : {},
  };
  saveSettings();
  toChar('apply-motion-config', settings.motionConfig);
});

// 창 끌어 옮기기 — 누른 순간의 창 위치와 포인터 위치를 기준으로 삼는다
let dragOrigin = null;
ipcMain.on('drag-start', (_e, sx, sy) => {
  if (!win || win.isDestroyed()) return;
  const [wx, wy] = win.getPosition();
  dragOrigin = { wx, wy, sx, sy };
});
ipcMain.on('drag-move', (_e, sx, sy) => {
  if (!dragOrigin || !win || win.isDestroyed()) return;
  win.setPosition(
    Math.round(dragOrigin.wx + (sx - dragOrigin.sx)),
    Math.round(dragOrigin.wy + (sy - dragOrigin.sy))
  );
});
