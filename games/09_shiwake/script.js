// 仕分けゲーム(ダンジョンRPG企画 ミニゲーム #9 / 対応曲: Fixed Mind)
// 流れてくる私物を、正しいメンバーのレーンへドラッグ/タップで仕分ける。
// アイテムは無限に湧き続け、完全ランダム(連続で同じものが出ることもある)。
// ミスしてもコンボが切れるだけでゲームは終わらない。BGMがBGM_CUTOFF_SEC秒に達したら
// フェードアウトしてそこでゲーム終了(曲のテンポは変更しない、原曲のまま)。
// 落下速度・同時出現数は開始47秒でMAXに到達し、以降はカットオフまでMAXを維持。
//
// アイテム画像は assets/item-<member>-<key>.png に置くと自動で読み込まれる。
// 画像が無い間はプレースホルダー(色付きアイコン+ラベル)で動作する。
// BGMは assets/bgm.m4a を再生する(無ければ無音のまま進行)。

const ITEMS = [
  { member: "saaya",  key: "mic",       label: "マイク" },
  { member: "saaya",  key: "acoustic",  label: "アコギ" },
  { member: "saaya",  key: "ribbon",    label: "リボン" },
  { member: "maana",  key: "stick",     label: "スティック" },
  { member: "maana",  key: "tuner",     label: "ドラムチューナー" },
  { member: "maana",  key: "coke",      label: "コークハイ" },
  { member: "yujiro", key: "guitar",    label: "ギター" },
  { member: "yujiro", key: "pegwinder", label: "ペグ回し" },
  { member: "yujiro", key: "effector",  label: "エフェクター" },
  { member: "kojiro", key: "bass",      label: "ベース" },
  { member: "kojiro", key: "himawari",  label: "ひまわり" },
  { member: "kojiro", key: "beer",      label: "ビール" },
];

const MEMBER_COLOR = {
  saaya:  "#ff6fa5",
  maana:  "#3fb6c9",
  yujiro: "#f2b134",
  kojiro: "#7bc96f",
};

const ITEM_HALF_WIDTH = 38;
const MIN_ITEM_SEPARATION = 90;
const BASE_POINTS = 100;
const COMBO_BONUS_STEP = 0.1; // コンボ1につき+10%
const COMBO_BONUS_CAP = 2.0;  // 最大+200%(x3)
const SONG_UNLOCK_SCORE = 20000; // RPG本編では、この点数以上でFixed Mindを入手した扱いにする想定
const HIGHSCORE_KEY = "shiwake_fixedmind_highscore";

// 経過時間ベースで難易度(落下速度・同時出現数)が上がる。RAMP_DURATION_MSでMAXに到達し、以降はMAXのまま維持。
const RAMP_DURATION_MS = 47000; // 47秒でMAXに到達
const MAX_CONCURRENT_CAP = 3; // 同時に流れる最大数(体感に合わせて抑えめ)

// BGMはテンポを変えず原曲のまま再生し、1:37(97秒)で終了する。
// 終了の少し前からフェードアウトして、ぶつ切りにならないようにする。
const BGM_CUTOFF_SEC = 97; // 1:37
const BGM_FADE_SEC = 3; // フェードアウトの長さ
const BASE_BGM_VOLUME = 0.5;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// 難易度は「経過時間」に応じて連続的にきつくなり、RAMP_DURATION_MSでMAXに到達 → それ以降はMAXのまま維持
function getDifficulty(elapsedMs) {
  const progress = Math.min(1, elapsedMs / RAMP_DURATION_MS);
  const duration = lerp(4200, 1200, progress);
  const maxConcurrent = Math.min(MAX_CONCURRENT_CAP, 1 + Math.floor(progress * MAX_CONCURRENT_CAP));
  const gap = lerp(900, 320, progress);
  return { duration, maxConcurrent, gap, progress };
}

const belt = document.getElementById("belt");
const lanes = Array.from(document.querySelectorAll(".lane"));
const scoreLabel = document.getElementById("scoreLabel");
const comboLabel = document.getElementById("comboLabel");
const missLabel = document.getElementById("missLabel");
const toastEl = document.getElementById("toast");
const bestHint = document.getElementById("bestHint");
const muteBtn = document.getElementById("muteBtn");
const bgm = document.getElementById("bgm");
bgm.volume = BASE_BGM_VOLUME; // 効果音が埋もれないよう控えめに

const startScreen = document.getElementById("startScreen");
const gameScreen = document.getElementById("gameScreen");
const resultScreen = document.getElementById("resultScreen");
const resultTitle = document.getElementById("resultTitle");
const resultMessage = document.getElementById("resultMessage");

let spawnedCount = 0;
let score = 0;
let combo = 0;
let misses = 0;
let songUnlocked = false;
let activeItems = []; // { def, el, startTime, duration, dragging, dragOffsetX, dragOffsetY }
let nextSpawnAllowedAt = 0;
let gameEnded = false;
let rafId = null;
let runStartTime = 0;
let muted = false;

function getHighscore() {
  return parseInt(localStorage.getItem(HIGHSCORE_KEY) || "0", 10);
}

// --- 効果音(Web Audio APIでその場合成。音声素材は不要) ---
let audioCtx = null;
function ensureAudioCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

function playTone({ freq, startFreq, endFreq, type = "sine", duration = 0.12, gain = 0.2, delay = 0 }) {
  if (muted) return;
  const ctx = ensureAudioCtx();
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  if (startFreq !== undefined && endFreq !== undefined) {
    osc.frequency.setValueAtTime(startFreq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), t0 + duration);
  } else {
    osc.frequency.setValueAtTime(freq, t0);
  }
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function playPickupSfx() {
  playTone({ freq: 900, type: "sine", duration: 0.06, gain: 0.22 });
}
function playHitSfx() {
  playTone({ freq: 660, type: "triangle", duration: 0.09, gain: 0.3 });
  playTone({ freq: 990, type: "triangle", duration: 0.14, gain: 0.3, delay: 0.06 });
}
function playMissSfx() {
  playTone({ startFreq: 220, endFreq: 80, type: "sawtooth", duration: 0.22, gain: 0.26 });
}

// iOSはAudioContextを作る/resumeするだけでは足りず、実際に一度音を鳴らす操作が
// 必要な場合があるため、ユーザー操作(スタート押下)の中でほぼ無音の音を鳴らしておく。
function unlockAudioForIOS() {
  const ctx = ensureAudioCtx();
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  g.gain.value = 0.0001;
  osc.connect(g).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.01);
}

function showScreen(el) {
  [startScreen, gameScreen, resultScreen].forEach((s) => s.classList.add("hidden"));
  el.classList.remove("hidden");
}

function updateHud() {
  scoreLabel.textContent = `SCORE ${score.toLocaleString()}`;
  missLabel.textContent = `ミス ${misses}`;
  if (combo >= 2) {
    comboLabel.textContent = `${combo} COMBO`;
    comboLabel.classList.remove("hidden");
  } else {
    comboLabel.classList.add("hidden");
  }
}

function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove("hidden", "fade-out");
  clearTimeout(showToast._t1);
  clearTimeout(showToast._t2);
  showToast._t1 = setTimeout(() => toastEl.classList.add("fade-out"), 1800);
  showToast._t2 = setTimeout(() => toastEl.classList.add("hidden"), 2200);
}

let lastAppliedBgmRate = null;
function setBgmRate(rate) {
  // 毎フレーム書き換えると音声パイプラインが不安定になることがあるため、
  // 値が意味のある差(0.01以上)で変わった時だけ実際に設定する
  if (lastAppliedBgmRate !== null && Math.abs(rate - lastAppliedBgmRate) < 0.01) return;
  lastAppliedBgmRate = rate;
  bgm.playbackRate = rate;
  // 速度を上げてもピッチが上ずらないようにする(対応ブラウザのみ)
  bgm.preservesPitch = true;
  bgm.mozPreservesPitch = true;
  bgm.webkitPreservesPitch = true;
}

function startBgm() {
  try {
    bgm.currentTime = 0; // メタデータ未取得だと例外を投げるブラウザがあるため保険
  } catch (e) {
    // 無視して続行(再生開始時には先頭から鳴る)
  }
  bgm.volume = BASE_BGM_VOLUME; // load()でリセットされることがあるため、再生開始のたびに設定し直す
  setBgmRate(1.0); // テンポは原曲のまま変更しない
  bgm.play().catch(() => {
    // 再生できない(素材未配置 or ブラウザ制限)場合は無音のまま続行
  });
}

// BGMをfetchで丸ごと先読みしてからBlob URLに差し替える。
// モバイル回線でのストリーミング再生の癖(遅延・MIMEタイプ判定など)を
// まるごと回避するため、再生開始までに全部ダウンロードし切っておく。
const startBtn = document.getElementById("startBtn");

async function preloadBgm() {
  try {
    const res = await fetch(bgm.getAttribute("src"));
    if (!res.ok) throw new Error(`bgm fetch failed: ${res.status}`);
    const buf = await res.arrayBuffer();
    const blob = new Blob([buf], { type: "audio/mp4" }); // サーバー側のMIME判定に依存しない
    bgm.src = URL.createObjectURL(blob);
    bgm.load(); // srcの書き換えだけだと反映が遅れる/されないブラウザがあるため明示的にロードし直す
  } catch (e) {
    // 読み込みに失敗しても、ゲーム自体は無音で遊べるようにする
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = "スタート";
  }
}
preloadBgm();

// 曲が最後まで流れ切ったらそこでゲーム終了(ループしない)
bgm.addEventListener("ended", () => {
  if (!gameEnded) finishRun();
});

muteBtn.addEventListener("click", () => {
  muted = !muted;
  bgm.muted = muted;
  muteBtn.textContent = muted ? "🔇" : "🔊";
});

function startGame() {
  spawnedCount = 0;
  score = 0;
  combo = 0;
  misses = 0;
  songUnlocked = false;
  activeItems = [];
  gameEnded = false;
  belt.innerHTML = "";
  toastEl.classList.add("hidden");
  updateHud();
  showScreen(gameScreen);
  // 検証のため、Web Audio(AudioContext)を先に起動する処理を一時的に外している。
  // これが<audio>のBGMをダッキング(音量抑制)させている可能性を切り分けるため。
  // unlockAudioForIOS();
  startBgm();
  runStartTime = performance.now();
  nextSpawnAllowedAt = runStartTime;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
}

function pickSpawnX() {
  const beltWidth = belt.clientWidth;
  const margin = ITEM_HALF_WIDTH + 8;
  const range = Math.max(0, beltWidth - margin * 2);
  let best = margin + Math.random() * range;
  let bestScore = -1;
  for (let attempt = 0; attempt < 8; attempt++) {
    const x = margin + Math.random() * range;
    let minDist = Infinity;
    for (const item of activeItems) {
      const ix = parseFloat(item.el.style.left) || 0;
      minDist = Math.min(minDist, Math.abs(x - ix));
    }
    if (minDist === Infinity || minDist >= MIN_ITEM_SEPARATION) return x;
    if (minDist > bestScore) {
      bestScore = minDist;
      best = x;
    }
  }
  return best;
}

function pickRandomItemDef() {
  return ITEMS[Math.floor(Math.random() * ITEMS.length)];
}

function spawnOne(diff) {
  const def = pickRandomItemDef();
  spawnedCount += 1;

  const el = buildItemEl(def);
  belt.appendChild(el);

  const x = pickSpawnX();
  el.style.left = `${x}px`;
  el.style.top = `-80px`;

  const item = {
    def,
    el,
    startTime: performance.now(),
    duration: diff.duration,
    dragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
  };
  activeItems.push(item);
  attachDragHandlers(item);
}

function buildItemEl(def) {
  const el = document.createElement("div");
  el.className = "item";
  el.draggable = false;

  const img = document.createElement("img");
  img.src = `assets/item-${def.member}-${def.key}.png`;
  img.alt = def.label;
  img.draggable = false; // PCのマウスドラッグだとimgのネイティブD&Dが横取りしてしまうため無効化
  img.onerror = () => {
    img.remove();
    const fb = document.createElement("div");
    fb.className = "item-fallback";
    fb.style.background = MEMBER_COLOR[def.member];
    fb.textContent = def.label.charAt(0);
    el.insertBefore(fb, el.firstChild);
  };
  el.appendChild(img);

  const label = document.createElement("div");
  label.className = "item-label";
  label.textContent = def.label;
  el.appendChild(label);

  return el;
}

function tick(now) {
  if (gameEnded) return;

  const diff = getDifficulty(now - runStartTime);
  const beltHeight = belt.clientHeight;
  const travel = beltHeight + 80;

  // BGMが終了カットオフに近づいたらフェードアウトし、到達したらそこでゲーム終了
  const bgmPos = bgm.currentTime;
  const fadeStart = BGM_CUTOFF_SEC - BGM_FADE_SEC;
  if (bgmPos >= fadeStart) {
    const fadeProgress = Math.min(1, (bgmPos - fadeStart) / BGM_FADE_SEC);
    bgm.volume = BASE_BGM_VOLUME * (1 - fadeProgress);
  }
  if (bgmPos >= BGM_CUTOFF_SEC) {
    finishRun();
    return;
  }

  // 既存アイテムの落下更新
  for (const item of activeItems.slice()) {
    if (item.dragging) continue;
    const elapsed = now - item.startTime;
    const t = Math.min(1, elapsed / item.duration);
    item.el.style.top = `${-80 + t * travel}px`;
    if (t >= 1) {
      finishItem(item, false);
    }
  }

  // 新規スポーン判定(同時出現上限 & スポーン間隔を満たしていれば投入。ずっと湧き続ける)
  if (
    !gameEnded &&
    activeItems.length < diff.maxConcurrent &&
    now >= nextSpawnAllowedAt
  ) {
    spawnOne(diff);
    nextSpawnAllowedAt = now + diff.gap;
  }

  rafId = requestAnimationFrame(tick);
}

function attachDragHandlers(item) {
  const el = item.el;

  el.addEventListener("pointerdown", (ev) => {
    item.dragging = true;
    el.classList.add("dragging");
    el.setPointerCapture(ev.pointerId);
    const rect = el.getBoundingClientRect();
    item.dragOffsetX = ev.clientX - rect.left;
    item.dragOffsetY = ev.clientY - rect.top;
    playPickupSfx();
  });

  el.addEventListener("pointermove", (ev) => {
    if (!item.dragging) return;
    const beltRect = belt.getBoundingClientRect();
    const left = ev.clientX - beltRect.left - item.dragOffsetX + el.offsetWidth / 2;
    const top = ev.clientY - beltRect.top - item.dragOffsetY;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;

    const laneUnder = laneAtPoint(ev.clientX, ev.clientY);
    lanes.forEach((l) => l.classList.toggle("drag-over", l === laneUnder));
  });

  function endDrag(ev) {
    if (!item.dragging) return;
    item.dragging = false;
    el.classList.remove("dragging");
    lanes.forEach((l) => l.classList.remove("drag-over"));

    const laneUnder = laneAtPoint(ev.clientX, ev.clientY);
    if (laneUnder) {
      resolveDrop(item, laneUnder);
      return;
    }
    // ドロップ先が無ければベルトに戻して落下を継続(現在の見た目位置から再開)
    const beltHeight = belt.clientHeight;
    const travel = beltHeight + 80;
    const currentTop = parseFloat(el.style.top) || 0;
    item.startTime = performance.now() - ((currentTop + 80) / travel) * item.duration;
  }

  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);
}

function laneAtPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  return el ? el.closest(".lane") : null;
}

function resolveDrop(item, laneEl) {
  const correct = laneEl.dataset.member === item.def.member;
  flashLane(laneEl, correct ? "flash-hit" : "flash-miss");
  finishItem(item, correct);
}

function finishItem(item, correct) {
  const idx = activeItems.indexOf(item);
  if (idx === -1) return; // 二重処理防止
  activeItems.splice(idx, 1);
  item.el.remove();

  if (correct) {
    const bonus = Math.min(COMBO_BONUS_CAP, combo * COMBO_BONUS_STEP);
    score += Math.round(BASE_POINTS * (1 + bonus));
    combo += 1;
    playHitSfx();
  } else {
    combo = 0;
    misses += 1;
    playMissSfx();
  }
  updateHud();

  if (!songUnlocked && score >= SONG_UNLOCK_SCORE) {
    songUnlocked = true;
    showToast("♪ Fixed Mind を入手!");
  }
}

function flashLane(laneEl, cls) {
  laneEl.classList.add(cls);
  setTimeout(() => laneEl.classList.remove(cls), 300);
}

function endGame() {
  gameEnded = true;
  if (rafId) cancelAnimationFrame(rafId);
  activeItems.forEach((item) => item.el.remove());
  activeItems = [];
  bgm.pause();
}

function finishRun() {
  endGame();
  const best = getHighscore();
  const isNewBest = score > best;
  if (isNewBest) localStorage.setItem(HIGHSCORE_KEY, String(score));

  resultTitle.textContent = "曲が終わった!";
  const unlockLine = songUnlocked
    ? "\n♪ Fixed Mind 入手!"
    : `\n未入手(あと${Math.max(0, SONG_UNLOCK_SCORE - score).toLocaleString()}点)`;
  resultMessage.textContent =
    `SCORE ${score.toLocaleString()}\nミス ${misses}回` +
    unlockLine +
    (isNewBest ? "\n新記録!" : `\nベスト ${Math.max(best, score).toLocaleString()}`);
  showScreen(resultScreen);
}

function refreshBestHint() {
  const best = getHighscore();
  bestHint.textContent = best > 0 ? `ベストスコア ${best.toLocaleString()}` : "";
}

startBtn.addEventListener("click", startGame);
document.getElementById("retryBtn").addEventListener("click", startGame);

refreshBestHint();
