// ねこつきラン — 横スクロール エンドレスランナー
'use strict';

/* ---------- エラーバナー（デバッグ用に画面に出す） ---------- */
const errorBanner = document.getElementById('errorBanner');
function showError(msg) {
  errorBanner.textContent = '⚠ ' + msg;
  errorBanner.style.display = 'block';
}
window.onerror = (msg) => showError(String(msg));
window.addEventListener('unhandledrejection', (e) => showError(String(e.reason)));

/* ---------- キャラ定義 ---------- */
const CHARACTERS = [
  { id: 'saaya', name: 'さあや', file: 'assets/tile-saaya.png', frames: ['assets/run-saaya-0.png', 'assets/run-saaya-1.png', 'assets/run-saaya-2.png', 'assets/run-saaya-3.png'], cutin: 'assets/cutin-saaya.png' },
  { id: 'maana', name: 'まあな', file: 'assets/tile-maana.png', frames: ['assets/run-maana-0.png', 'assets/run-maana-1.png', 'assets/run-maana-2.png', 'assets/run-maana-3.png'], cutin: 'assets/cutin-maana.png' },
  { id: 'kojiro', name: 'こうじろう', file: 'assets/tile-kojiro.png', frames: ['assets/run-kojiro-0.png', 'assets/run-kojiro-1.png', 'assets/run-kojiro-2.png', 'assets/run-kojiro-3.png'], cutin: 'assets/cutin-kojiro.png' },
  { id: 'yujiro', name: 'ゆうじろう', file: 'assets/tile-yujiro.png', frames: ['assets/run-yujiro-0.png', 'assets/run-yujiro-1.png', 'assets/run-yujiro-2.png', 'assets/run-yujiro-3.png'], cutin: 'assets/cutin-yujiro.png' },
];

const LS_KEY_RANKING = 'nekotuki_run_ranking';
const LS_KEY_RECENT = 'nekotuki_run_recent_names';
const LS_KEY_CHAR = 'nekotuki_run_last_char';
const LS_KEY_BEST = 'nekotuki_run_best';

/* ---------- 画面切り替え ---------- */
const screens = {
  charSelect: document.getElementById('charSelect'),
  game: document.getElementById('gameScreen'),
  gameOver: document.getElementById('gameOverScreen'),
  ranking: document.getElementById('rankingScreen'),
};
function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

/* ---------- サウンド（Web Audio 合成、音声ファイル不要） ---------- */
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function beep({ freq = 440, duration = 0.1, type = 'square', gain = 0.15, slideTo = null }) {
  try {
    const ctx = ensureAudio();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + duration);
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) { /* audio not critical */ }
}
const sfx = {
  jump: () => beep({ freq: 520, slideTo: 780, duration: 0.12, type: 'square' }),
  score: () => beep({ freq: 900, duration: 0.06, type: 'sine', gain: 0.08 }),
  hit: () => beep({ freq: 220, slideTo: 60, duration: 0.4, type: 'sawtooth', gain: 0.2 }),
  note: () => beep({ freq: 700, slideTo: 1150, duration: 0.09, type: 'sine', gain: 0.14 }),
  revive: () => beep({ freq: 500, slideTo: 140, duration: 0.3, type: 'square', gain: 0.18 }),
  explosion: () => {
    beep({ freq: 180, slideTo: 40, duration: 0.28, type: 'sawtooth', gain: 0.22 });
    setTimeout(() => beep({ freq: 900, slideTo: 200, duration: 0.08, type: 'square', gain: 0.12 }), 30);
  },
  clear: () => {
    [523, 659, 784, 1046].forEach((freq, i) => {
      setTimeout(() => beep({ freq, duration: 0.2, type: 'sine', gain: 0.16 }), i * 90);
    });
  },
};

/* ---------- キャラ選択画面 ---------- */
const charList = document.getElementById('charList');
let selectedChar = localStorage.getItem(LS_KEY_CHAR) || CHARACTERS[0].id;

function renderCharSelect() {
  charList.innerHTML = '';
  CHARACTERS.forEach((c) => {
    const opt = document.createElement('div');
    opt.className = 'char-option' + (c.id === selectedChar ? ' selected' : '');
    opt.innerHTML = `<img src="${c.file}" alt="${c.name}"><div>${c.name}</div>`;
    opt.addEventListener('click', () => {
      selectedChar = c.id;
      localStorage.setItem(LS_KEY_CHAR, selectedChar);
      renderCharSelect();
    });
    charList.appendChild(opt);
  });
}
renderCharSelect();

// 走行コマは選択タイミングまで待たず、タイトル画面表示中に4キャラ分まとめて先読みしておく
// （開始直後に読み込みが間に合わず静止画にフォールバックして見える問題への対策）
CHARACTERS.forEach((c) => {
  c.frameImages = c.frames.map((src) => {
    const im = new Image();
    im.src = src;
    return im;
  });
  c.cutinImage = new Image();
  c.cutinImage.src = c.cutin;
});

function loadRanking() {
  try { return JSON.parse(localStorage.getItem(LS_KEY_RANKING)) || []; }
  catch { return []; }
}
function saveRanking(list) {
  localStorage.setItem(LS_KEY_RANKING, JSON.stringify(list));
}
function bestScore() {
  return Number(localStorage.getItem(LS_KEY_BEST) || 0);
}

function renderRankingPreview() {
  const list = loadRanking().slice(0, 3);
  const el = document.getElementById('rankingPreview');
  if (list.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = '<b>TOP3</b><br>' + list.map((r, i) => `${i + 1}. ${r.name} — ${r.score}`).join('<br>');
}
renderRankingPreview();

/* ---------- ゲーム本体 ---------- */
const canvas = document.getElementById('canvas');
const ctx2d = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
const GROUND_Y = H - 40;

let charImg = new Image();
let playerFrames = []; // 選択中キャラの走行コマ（4枚）

// 背景（横長の街並み画像）とエンカウンター敵（イラ）は起動時から先読み
const bgImg = new Image();
bgImg.src = 'assets/background-city.jpg';
const BG_DRAW_H = GROUND_Y; // 画像の下端を地面ラインに合わせる

const enemyImg = new Image();
enemyImg.src = 'assets/enemy-ira.png';
const ENEMY_RATIO = 261 / 500; // enemy-ira.png の幅/高さ比（フォールバック用）

const iraFrontImg = new Image();
iraFrontImg.src = 'assets/ira-front.png';

// BGM。この曲(約3分45秒)が終わるまでに音符200個(20×10)を集められないとタイムアップ負け。
const bgmEl = document.getElementById('bgm');
bgmEl.volume = 0.55;
let bgmEnded = false;
bgmEl.addEventListener('ended', () => {
  bgmEnded = true;
  if (state && state.running && !cutscene) finishRun('timeup');
});

const PLAYER_W = 70;
const PLAYER_H = 74;
const ANIM_STEP = 34; // この距離だけ進むごとに走行コマを1つ進める

/* ---------- イラ討伐カットシーン（♪20個ごと） ---------- */
const TOTAL_IRA = 10;
const NOTES_PER_CUTSCENE = 20;
// フェーズの区切り（フレーム数の累積）
const CUT_T1 = 30; // カットイン：スライドイン＋拡大
const CUT_T2 = CUT_T1 + 10; // 画面を覆い尽くして静止
const CUT_T3 = CUT_T2 + 8; // 白フラッシュ
const CUT_T4 = CUT_T3 + 22; // カットインが引いて爆発エフェクトが見える
const CUT_T5 = CUT_T4 + 70; // 減った状態をしっかり見せてからゲームに戻る（戻りが早すぎた反省で延長）

let cutscene = null; // null以外の間はカットシーン中（ラン側のloopは止める）

function makeStars(n) {
  const colors = ['#ffffff', '#ffe27a', '#7ec8ff'];
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({
      x: Math.random() * W,
      y: Math.random() * H,
      r: 1 + Math.random() * 2.2,
      c: colors[Math.floor(Math.random() * colors.length)],
    });
  }
  return arr;
}

function drawExplosion(ctx, x, y, progress) {
  const r = 6 + progress * 46;
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - progress);
  ctx.fillStyle = '#fff2b0';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ff8a3d';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(ang) * r * 0.7, y + Math.sin(ang) * r * 0.7);
    ctx.lineTo(x + Math.cos(ang) * r * 1.3, y + Math.sin(ang) * r * 1.3);
    ctx.stroke();
  }
  ctx.restore();
}

function startCutscene() {
  state.running = false;
  cancelAnimationFrame(rafId);
  const c = CHARACTERS.find((x) => x.id === selectedChar) || CHARACTERS[0];
  const count = state.iraRemaining;
  const slots = [];
  for (let i = 0; i < count; i++) {
    const s = 40 + Math.random() * 50;
    slots.push({ x: s / 2 + Math.random() * (W - s), y: s / 2 + Math.random() * (H - s), s, removed: false });
  }
  cutscene = {
    t: 0,
    stars: makeStars(120),
    slots,
    targetIndex: Math.floor(Math.random() * count),
    cutinImg: c.cutinImage,
    triggered: false,
  };
  requestAnimationFrame(cutsceneLoop);
}

function drawCutscene(cs) {
  ctx2d.clearRect(0, 0, W, H);
  ctx2d.fillStyle = '#05040f';
  ctx2d.fillRect(0, 0, W, H);

  cs.stars.forEach((st) => {
    ctx2d.fillStyle = st.c;
    ctx2d.beginPath();
    ctx2d.arc(st.x, st.y, st.r, 0, Math.PI * 2);
    ctx2d.fill();
  });

  cs.slots.forEach((sl, i) => {
    if (sl.removed) {
      if (cs.t >= CUT_T3 && cs.t < CUT_T4) {
        drawExplosion(ctx2d, sl.x, sl.y, (cs.t - CUT_T3) / (CUT_T4 - CUT_T3));
      }
      return;
    }
    if (iraFrontImg.complete && iraFrontImg.naturalWidth > 0) {
      ctx2d.drawImage(iraFrontImg, sl.x - sl.s / 2, sl.y - sl.s / 2, sl.s, sl.s);
    }
  });

  // カットインする選択中キャラ
  const img = cs.cutinImg;
  if (img && img.complete && img.naturalWidth > 0 && cs.t < CUT_T4) {
    let ease, alpha;
    if (cs.t <= CUT_T1) {
      ease = 1 - Math.pow(1 - cs.t / CUT_T1, 3);
      alpha = Math.min(1, (cs.t / CUT_T1) * 2);
    } else if (cs.t <= CUT_T3) {
      ease = 1;
      alpha = 1;
    } else {
      ease = 1;
      alpha = Math.max(0, 1 - (cs.t - CUT_T3) / (CUT_T4 - CUT_T3));
    }
    const drawH = H * (0.55 + ease * 1.35);
    const drawW = drawH * (img.naturalWidth / img.naturalHeight);
    const cx = W - ease * (W * 0.35);
    const cy = H * 0.55;
    ctx2d.save();
    ctx2d.globalAlpha = alpha;
    ctx2d.drawImage(img, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
    ctx2d.restore();
  }

  // 白フラッシュ（画面を覆い尽くした瞬間の演出）
  if (cs.t > CUT_T2 && cs.t <= CUT_T3) {
    const p = (cs.t - CUT_T2) / (CUT_T3 - CUT_T2);
    ctx2d.save();
    ctx2d.globalAlpha = Math.sin(p * Math.PI) * 0.85;
    ctx2d.fillStyle = '#ffffff';
    ctx2d.fillRect(0, 0, W, H);
    ctx2d.restore();
  }
}

function cutsceneLoop() {
  const cs = cutscene;
  if (!cs) return;
  cs.t++;

  if (!cs.triggered && cs.t >= CUT_T3) {
    cs.triggered = true;
    cs.slots[cs.targetIndex].removed = true;
    state.iraRemaining = Math.max(0, state.iraRemaining - 1);
    document.getElementById('iraLabel').textContent = 'イラ ' + state.iraRemaining;
    sfx.explosion();
  }

  drawCutscene(cs);

  if (cs.t >= CUT_T5) {
    cutscene = null;
    if (state.iraRemaining <= 0) {
      finishRun('clear');
    } else if (bgmEnded) {
      finishRun('timeup');
    } else {
      state.running = true;
      rafId = requestAnimationFrame(loop);
    }
    return;
  }
  requestAnimationFrame(cutsceneLoop);
}

let state = null; // 現在のランのステート
function resetState() {
  state = {
    running: true,
    t: 0,
    speed: 6,
    score: 0,
    notesCollected: 0,
    notesSinceCutscene: 0,
    iraRemaining: TOTAL_IRA,
    lastScoreTick: 0,
    player: { x: 90, y: GROUND_Y - PLAYER_H, w: PLAYER_W, h: PLAYER_H, vy: 0, onGround: true, rot: 0, squash: 1 },
    obstacles: [],
    nextObstacleAt: 780, // 開始直後すぐに敵が来ないよう猶予を持たせる（前回比3倍）
    notes: [],
    nextNoteAt: 100,
    iraFlyers: [],
    nextIraFlyerAt: 900, // たまにしか飛んでこないトラップ枠
    bgScroll: 0,
    animIndex: 0,
    animAcc: 0,
    frame: 0,
  };
}

const GRAVITY = 0.7;
const JUMP_VY = -17; // 頂点高さ ≒ VY^2/(2*GRAVITY) ≒ 207px（かなり大きく跳べるようにして難易度を下げる）

function jump() {
  if (!state || !state.running) return;
  if (state.player.onGround) {
    state.player.vy = JUMP_VY;
    state.player.onGround = false;
    sfx.jump();
  }
}

// シンプルな四分音符（符頭+符尾）をベクターで描く。Unicodeの♪グリフだと
// フォント次第でつぶれた黄色い塊＝バナナっぽく見えてしまったための対策。
function drawNote(ctx, x, y, s) {
  const r = s * 0.34;
  ctx.save();
  ctx.fillStyle = '#ff4fa3';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  // 符頭（少し傾いた楕円）
  ctx.beginPath();
  ctx.ellipse(x - r * 0.1, y + s * 0.3, r, r * 0.76, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 符尾（縦棒）
  ctx.beginPath();
  ctx.lineCap = 'round';
  ctx.lineWidth = s * 0.13;
  ctx.moveTo(x + r * 0.75, y + s * 0.12);
  ctx.lineTo(x + r * 0.75, y - s * 0.62);
  ctx.stroke();
  ctx.restore();
}

function spawnObstacle() {
  const h = 40 + Math.random() * 34; // 40〜74px（少し大きめに）
  const w = h * ENEMY_RATIO;
  state.obstacles.push({ x: W + 20, y: GROUND_Y - h, w, h });
}

// 最大ジャンプ高さ(頂点)は VY^2/(2*GRAVITY) ≒ 207px。その範囲でランダムに音符を降らせる。
function spawnNote() {
  const y = GROUND_Y - (30 + Math.random() * 160);
  state.notes.push({ x: W + 20, y, r: 15 });
}

// たまに飛んでくるIRA_FRONT。触っちゃうとカットシーンのイラが3体復活するトラップ枠。
function spawnIraFlyer() {
  const s = 44 + Math.random() * 14;
  const y = GROUND_Y - (30 + Math.random() * 160);
  state.iraFlyers.push({ x: W + 20, y, s });
}

function update() {
  if (!state.running) return;
  state.frame++;
  state.speed = 4 + Math.min(0.8, state.score / 2000); // だんだん速く（基本速度を少し落とした）
  state.score += state.speed * 0.06;

  // プレイヤー物理
  const p = state.player;
  p.vy += GRAVITY;
  p.y += p.vy;
  if (p.y >= GROUND_Y - p.h) {
    p.y = GROUND_Y - p.h;
    if (!p.onGround) p.squash = 0.7;
    p.vy = 0;
    p.onGround = true;
  }
  p.squash += (1 - p.squash) * 0.2;
  p.rot = p.onGround ? 0 : Math.min(0.5, -p.vy * 0.02);

  // 走行アニメ（進んだ距離に応じてコマを送る。ジャンプ中は止める）
  if (p.onGround) {
    state.animAcc += state.speed;
    while (state.animAcc >= ANIM_STEP) {
      state.animAcc -= ANIM_STEP;
      state.animIndex = (state.animIndex + 1) % 4;
    }
  }

  // 背景スクロール（キャラより手前の要素より遅く流してパララックス感を出す）
  state.bgScroll += state.speed * 0.5;

  // 敵（イラ）
  state.obstacles.forEach((o) => (o.x -= state.speed));
  state.obstacles = state.obstacles.filter((o) => o.x + o.w > -10);
  state.nextObstacleAt -= state.speed;
  if (state.nextObstacleAt <= 0) {
    spawnObstacle();
    // 前回比3倍の間隔
    state.nextObstacleAt = 1200 + Math.random() * 780 - Math.min(60, state.score / 10);
    state.nextObstacleAt = Math.max(780, state.nextObstacleAt);
  }

  // 当たり判定（敵）— 見た目の絵柄よりだいぶ小さめの判定にして体感の理不尽さを減らす
  for (const o of state.obstacles) {
    if (
      p.x < o.x + o.w - 18 &&
      p.x + p.w - 18 > o.x &&
      p.y < o.y + o.h - 16 &&
      p.y + p.h - 16 > o.y
    ) {
      return gameOver();
    }
  }

  // 音符（コレクタブル）
  state.notes.forEach((n) => (n.x -= state.speed));
  state.notes = state.notes.filter((n) => n.x > -20);
  state.nextNoteAt -= state.speed;
  if (state.nextNoteAt <= 0) {
    spawnNote();
    state.nextNoteAt = 90 + Math.random() * 150;
  }
  for (const n of state.notes) {
    if (
      p.x < n.x + n.r &&
      p.x + p.w > n.x - n.r &&
      p.y < n.y + n.r &&
      p.y + p.h > n.y - n.r
    ) {
      n.x = -9999; // 次のフィルタで除去
      state.notesCollected++;
      state.notesSinceCutscene++;
      state.score += 50;
      sfx.note();
    }
  }
  state.notes = state.notes.filter((n) => n.x > -20);

  // たまに飛んでくるIRA_FRONT（トラップ）
  state.iraFlyers.forEach((f) => (f.x -= state.speed));
  state.iraFlyers = state.iraFlyers.filter((f) => f.x > -40);
  state.nextIraFlyerAt -= state.speed;
  if (state.nextIraFlyerAt <= 0) {
    spawnIraFlyer();
    state.nextIraFlyerAt = 1400 + Math.random() * 1200;
  }
  for (const f of state.iraFlyers) {
    const r = f.s / 2;
    if (
      p.x < f.x + r &&
      p.x + p.w > f.x - r &&
      p.y < f.y + r &&
      p.y + p.h > f.y - r
    ) {
      f.x = -9999;
      state.iraRemaining = Math.min(TOTAL_IRA, state.iraRemaining + 3);
      document.getElementById('iraLabel').textContent = 'イラ ' + state.iraRemaining;
      sfx.revive();
    }
  }
  state.iraFlyers = state.iraFlyers.filter((f) => f.x > -40);

  // 音符を20個集めるごとにイラ討伐カットシーンへ
  if (state.notesSinceCutscene >= NOTES_PER_CUTSCENE && !cutscene) {
    state.notesSinceCutscene -= NOTES_PER_CUTSCENE;
    return startCutscene();
  }

  // スコア刻みSE
  if (Math.floor(state.score / 200) > Math.floor(state.lastScoreTick / 200)) sfx.score();
  state.lastScoreTick = state.score;

  document.getElementById('scoreLabel').textContent = 'SCORE: ' + Math.floor(state.score);
  document.getElementById('bestLabel').textContent = 'BEST: ' + Math.max(bestScore(), Math.floor(state.score));
  document.getElementById('notesLabel').textContent = '♪ ' + state.notesCollected;
  document.getElementById('iraLabel').textContent = 'イラ ' + state.iraRemaining;
}

function draw() {
  ctx2d.clearRect(0, 0, W, H);

  // 空
  ctx2d.fillStyle = '#fffaf0';
  ctx2d.fillRect(0, 0, W, H);

  // 背景（横長の街並み画像をループ）。未読み込みならフラットな背景のままフォールバック
  if (bgImg.complete && bgImg.naturalWidth > 0) {
    const bgW = bgImg.naturalWidth * (BG_DRAW_H / bgImg.naturalHeight);
    let x = -(state.bgScroll % bgW);
    while (x < W) {
      ctx2d.drawImage(bgImg, x, 0, bgW, BG_DRAW_H);
      x += bgW;
    }
  }

  // 地面
  ctx2d.strokeStyle = '#ffb066';
  ctx2d.lineWidth = 3;
  ctx2d.beginPath();
  ctx2d.moveTo(0, GROUND_Y);
  ctx2d.lineTo(W, GROUND_Y);
  ctx2d.stroke();

  // 音符（コレクタブル）
  state.notes.forEach((n) => {
    const bob = Math.sin((state.frame + n.x) * 0.15) * 4;
    drawNote(ctx2d, n.x, n.y + bob, 26);
  });

  // たまに飛んでくるIRA_FRONT（トラップ：触るとイラが3体復活する）
  state.iraFlyers.forEach((f) => {
    const bob = Math.sin((state.frame + f.x) * 0.12) * 5;
    const y = f.y + bob;
    ctx2d.save();
    ctx2d.strokeStyle = 'rgba(255,60,60,0.6)';
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    ctx2d.arc(f.x, y, f.s / 2 + 4, 0, Math.PI * 2);
    ctx2d.stroke();
    ctx2d.restore();
    if (iraFrontImg.complete && iraFrontImg.naturalWidth > 0) {
      ctx2d.drawImage(iraFrontImg, f.x - f.s / 2, y - f.s / 2, f.s, f.s);
    }
  });

  // 敵（イラ）
  state.obstacles.forEach((o) => {
    if (enemyImg.complete && enemyImg.naturalWidth > 0) {
      ctx2d.drawImage(enemyImg, o.x, o.y, o.w, o.h);
    } else {
      ctx2d.fillStyle = '#7cbf6a';
      ctx2d.beginPath();
      ctx2d.roundRect(o.x, o.y, o.w, o.h, 6);
      ctx2d.fill();
    }
  });

  // プレイヤー
  const p = state.player;
  const frameImg = p.onGround ? playerFrames[state.animIndex] : playerFrames[1];
  ctx2d.save();
  ctx2d.translate(p.x + p.w / 2, p.y + p.h / 2);
  ctx2d.rotate(-p.rot);
  ctx2d.scale(1 / p.squash, p.squash);
  if (frameImg && frameImg.complete && frameImg.naturalWidth > 0) {
    ctx2d.drawImage(frameImg, -p.w / 2, -p.h / 2, p.w, p.h);
  } else if (charImg.complete && charImg.naturalWidth > 0) {
    ctx2d.drawImage(charImg, -p.w / 2, -p.h / 2, p.w, p.h);
  } else {
    ctx2d.fillStyle = '#ff8a3d';
    ctx2d.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
  }
  ctx2d.restore();
}

let rafId = null;
function loop() {
  update();
  draw();
  if (state.running) rafId = requestAnimationFrame(loop);
}

function startGame() {
  const c = CHARACTERS.find((x) => x.id === selectedChar) || CHARACTERS[0];
  charImg = new Image();
  charImg.src = c.file; // 走行コマの読み込みが間に合わない場合のフォールバック
  playerFrames = c.frameImages || c.frames.map((src) => {
    const im = new Image();
    im.src = src;
    return im;
  });
  resetState();
  showScreen('game');
  document.getElementById('scoreLabel').textContent = 'SCORE: 0';
  document.getElementById('bestLabel').textContent = 'BEST: ' + bestScore();
  document.getElementById('notesLabel').textContent = '♪ 0';
  document.getElementById('iraLabel').textContent = 'イラ ' + TOTAL_IRA;
  bgmEnded = false;
  bgmEl.currentTime = 0;
  bgmEl.play().catch((e) => showError('BGM再生に失敗しました: ' + e));
  cancelAnimationFrame(rafId);
  loop();
}

function gameOver() {
  finishRun('crash');
}

// reason: 'crash'(敵に当たった) / 'timeup'(曲が終わるまでにイラを全滅できなかった) / 'clear'(イラ全滅)
function finishRun(reason) {
  state.running = false;
  cutscene = null;
  cancelAnimationFrame(rafId);
  bgmEl.pause();
  const titleEl = document.getElementById('gameOverTitle');
  const msgEl = document.getElementById('gameOverMessage');
  if (reason === 'clear') {
    sfx.clear();
    titleEl.textContent = 'イライラ解消！';
    msgEl.textContent = '';
  } else if (reason === 'timeup') {
    sfx.hit();
    titleEl.textContent = 'ゲームオーバー';
    msgEl.textContent = '君はイライラに負けてしまった';
  } else {
    sfx.hit();
    titleEl.textContent = 'ゲームオーバー';
    msgEl.textContent = '';
  }
  const finalScore = Math.floor(state.score);
  if (finalScore > bestScore()) localStorage.setItem(LS_KEY_BEST, String(finalScore));
  document.getElementById('finalScore').textContent = 'SCORE: ' + finalScore;
  renderRecentChips();
  showScreen('gameOver');
}

/* ---------- 名前入力・リーダーボード ---------- */
function loadRecentNames() {
  try { return JSON.parse(localStorage.getItem(LS_KEY_RECENT)) || []; }
  catch { return []; }
}
function pushRecentName(name) {
  let list = loadRecentNames().filter((n) => n !== name);
  list.unshift(name);
  list = list.slice(0, 6);
  localStorage.setItem(LS_KEY_RECENT, JSON.stringify(list));
}
function renderRecentChips() {
  const el = document.getElementById('recentChips');
  el.innerHTML = '';
  loadRecentNames().forEach((n) => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.textContent = n;
    chip.addEventListener('click', () => (document.getElementById('nameInput').value = n));
    el.appendChild(chip);
  });
}

document.getElementById('saveScoreBtn').addEventListener('click', () => {
  const name = document.getElementById('nameInput').value.trim() || 'なまえなし';
  const finalScore = Number(document.getElementById('finalScore').textContent.replace('SCORE: ', ''));
  const list = loadRanking();
  list.push({ name, score: finalScore, at: Date.now() });
  list.sort((a, b) => b.score - a.score);
  saveRanking(list.slice(0, 20));
  pushRecentName(name);
  renderRankingList();
  showScreen('ranking');
});

function renderRankingList() {
  const el = document.getElementById('rankingList');
  const list = loadRanking();
  el.innerHTML = list.length
    ? list.map((r) => `<li><span>${r.name}</span><span>${r.score}</span></li>`).join('')
    : '<li>まだ記録がありません</li>';
}

/* ---------- ボタン/操作 ---------- */
document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('retryBtn').addEventListener('click', () => showScreen('charSelect'));
document.getElementById('backToTitleBtn').addEventListener('click', () => {
  renderRankingPreview();
  showScreen('charSelect');
});

window.addEventListener('keydown', (e) => {
  if ((e.code === 'Space' || e.code === 'ArrowUp') && !screens.game.classList.contains('hidden')) {
    e.preventDefault();
    jump();
  }
});
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  jump();
});

showScreen('charSelect');
