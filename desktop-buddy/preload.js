const { contextBridge, ipcRenderer } = require('electron');

const on = (ch) => (cb) => ipcRenderer.on(ch, (_e, ...args) => cb(...args));

contextBridge.exposeInMainWorld('buddy', {
  quit: () => ipcRenderer.send('quit-app'),
  toggleClickThrough: () => ipcRenderer.send('toggle-click-through'),
  getClickThrough: () => ipcRenderer.invoke('get-click-through'),
  onClickThroughChanged: on('click-through-changed'),

  // 크기 조절
  resizeBy: (factor) => ipcRenderer.send('resize-by', factor),
  resizeTo: (size) => ipcRenderer.send('resize-to', size),
  getSize: () => ipcRenderer.invoke('get-size'),
  onSizeChanged: on('size-changed'),

  // 창 끌어 옮기기
  dragStart: (sx, sy) => ipcRenderer.send('drag-start', sx, sy),
  dragMove: (sx, sy) => ipcRenderer.send('drag-move', sx, sy),

  // 설정
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSensitivity: (v) => ipcRenderer.send('set-sensitivity', v),

  // 동작
  listMotions: () => ipcRenderer.invoke('list-motions'),
  setMotionConfig: (cfg) => ipcRenderer.send('set-motion-config', cfg),
  playMotion: (name) => ipcRenderer.send('play-motion', name),

  // 크로마키 배경
  setChroma: (on) => ipcRenderer.send('set-chroma', on),

  // 즉시 저장
  saveNow: () => ipcRenderer.invoke('save-now'),

  // 입력 소스: 'mic' | 'pc'
  setAudioSource: (v) => ipcRenderer.send('set-audio-source', v),

  // --- 조작판 창 ↔ 캐릭터 창 (메인이 중계) ---
  openControl: () => ipcRenderer.send('open-control'),
  // 캐릭터 창이 받는 것: 조작판에서 바꾼 값
  onApplySensitivity: on('apply-sensitivity'),
  onApplyAudioSource: on('apply-audio-source'),
  onApplyChroma: on('apply-chroma'),
  onApplyMotionConfig: on('apply-motion-config'),
  onPlayMotion: on('play-motion'),
  onControlVisible: on('control-visible'),
  // 캐릭터 창 → 조작판: 진단 숫자, 안내 문구
  sendDiag: (d) => ipcRenderer.send('diag', d),
  onDiag: on('diag'),
  sendMsg: (text) => ipcRenderer.send('char-msg', text),
  onMsg: on('char-msg'),
});
