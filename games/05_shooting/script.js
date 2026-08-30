// ミニシューティング(ダンジョンRPG企画 ミニゲーム #05 / 対応曲(仮): harukaze)
// 自機は指の位置に直接ついてくる(ドラッグ追従、スワイプ判定は使わない —
// ブロックパズルでスワイプ操作が暴走したバグの教訓を踏まえ、pointermoveで
// 座標を直接反映するだけのシンプルな方式にする)。
// 弾は自動連射(発射ボタン不要)、上から降ってくる雑魚(動きパターン数種+
// 弾パターン数種)を撃ち落とす。雑魚を倒すと10%でアイテムドロップ
// (オプション追加/範囲レーザー/追尾ミサイル/回復)。
// 敵 or 敵弾に自機が当たるとライフ-1(❤️×3、被弾後は短い無敵時間あり)、
// ライフ0でゲームオーバー。
// 一定時間経過で「雑魚を産んでくるボス」が出現、通常の雑魚湧きは止まり、
// ボスを倒せばクリア。倒す前にライフが尽きればゲームオーバー。

const START_LIVES = 3;
const INVINCIBLE_MS = 1200;
const SHIP_RADIUS = 20;
const ENEMY_RADIUS = 18;
const PLAYER_BULLET_RADIUS = 5;
const ENEMY_BULLET_RADIUS = 6;
const ITEM_RADIUS = 16;
const BOSS_RADIUS = 62;

const PLAYER_FIRE_INTERVAL_MS = 440; // 半分の速度(以前の倍の間隔)
const LASER_FIRE_INTERVAL_MS = 260;
const MISSILE_FIRE_INTERVAL_MS = 300;
const OPTION_FIRE_INTERVAL_MS = 440;
const PLAYER_BULLET_SPEED = 480; // px/s(上方向)
const MISSILE_SPEED = 380;
const MISSILE_TURN_RATE = 4.2; // rad/s(追尾の曲がりやすさ)
const ENEMY_BULLET_SPEED = 220; // px/s
const BOSS_BULLET_SPEED = 200; // px/s

// レーザーは自機のすぐ上では細く、画面上に行くほど広がる円錐状の範囲判定
const LASER_NARROW_HALF = 8;  // 自機付近での半幅(px)
const LASER_WIDE_HALF = 60;   // 画面最上部での半幅(px)

const BASE_POINTS = 100;
const COMBO_BONUS_STEP = 0.1;
const COMBO_BONUS_CAP = 2.0;
const HIGHSCORE_KEY = "shooting_harukaze_highscore";
const BASE_BGM_VOLUME = 0.5;

const ITEM_DROP_CHANCE = 0.10;
const ITEM_TYPES = ["option", "laser", "missile", "heal"];
const ITEM_FALL_SPEED = 65; // px/s
const OPTION_MAX = 2;
const HEAL_AMOUNT = 1;
// レーザー/ミサイルは時間経過で通常装備に戻らない。別の武器アイテムを
// 拾うまでその武器のまま(=ずっと持続)。

const BOSS_TRIGGER_MS = 100000; // このタイミングでボス出現、以降は雑魚の自然湧き停止
const BOSS_HP = 750;
const BOSS_POINTS_PER_HIT = 40;
const BOSS_KILL_BONUS = 3000;
const BOSS_MINION_GAP_MS = 3200;
const BOSS_BULLET_GAP_MS = 1600;
const BOSS_Y = 110;
const BOSS_SWAY_SPEED = 0.5;
const BOSS_SWAY_AMP = 90;

// 経過時間ベースで難易度(敵の出現間隔・降下速度・発砲頻度)が上がる。
// ボス出現(BOSS_TRIGGER_MS)でMAXに到達し、以降は雑魚の自然湧き自体が止まる。
const RAMP_DURATION_MS = 45000;

function lerp(a, b, t) { return a + (b - a) * t; }

function getDifficulty(elapsedMs) {
  const progress = Math.min(1, elapsedMs / RAMP_DURATION_MS);
  const spawnGap = lerp(1100, 480, progress);
  const enemySpeed = lerp(55, 120, progress);
  const enemyFireGap = lerp(2600, 1300, progress);
  const maxConcurrent = Math.min(6, 2 + Math.floor(progress * 5));
  return { spawnGap, enemySpeed, enemyFireGap, maxConcurrent, progress };
}

const field = document.getElementById("field");
const scoreLabel = document.getElementById("scoreLabel");
const livesLabel = document.getElementById("livesLabel");
const toastEl = document.getElementById("toast");
const bestHint = document.getElementById("bestHint");
const muteBtn = document.getElementById("muteBtn");
const bossHpWrap = document.getElementById("bossHpWrap");
const bossHpFill = document.getElementById("bossHpFill");
const bgm = document.getElementById("bgm");
bgm.volume = BASE_BGM_VOLUME;

const startScreen = document.getElementById("startScreen");
const gameScreen = document.getElementById("gameScreen");
const resultScreen = document.getElementById("resultScreen");
const resultTitle = document.getElementById("resultTitle");
const resultMessage = document.getElementById("resultMessage");

let score = 0;
let combo = 0;
let lives = START_LIVES;
let songCleared = false;
let gameEnded = false;
let muted = false;
let rafId = null;
let runStartTime = 0;

let shipEl = null;
let shipPos = { x: 0, y: 0 };
let dragging = false;
let invincibleUntil = 0;

let weaponMode = "normal"; // "normal" | "laser" | "missile"(別の武器を拾うまでずっと持続)
let options = []; // { el, side, nextFireAt }

let enemies = [];
let playerBullets = [];
let enemyBullets = [];
let items = [];
let boss = null;
let bossPhase = false;
let bossSpawned = false;
let nextEnemySpawnAt = 0;
let nextPlayerFireAt = 0;

function getHighscore() {
  return parseInt(localStorage.getItem(HIGHSCORE_KEY) || "0", 10);
}

// --- 効果音(Web Audio APIでその場合成) ---
let audioCtx = null;
function ensureAudioCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}
function playTone({ freq, startFreq, endFreq, type = "sine", duration = 0.1, gain = 0.15, delay = 0 }) {
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
  g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}
function playShootSfx() { playTone({ freq: 900, type: "square", duration: 0.04, gain: 0.06 }); }
function playHitSfx() { playTone({ freq: 660, type: "triangle", duration: 0.08, gain: 0.22 }); }
function playDamageSfx() { playTone({ startFreq: 220, endFreq: 60, type: "sawtooth", duration: 0.26, gain: 0.3 }); }
function playItemSfx() {
  playTone({ freq: 660, type: "sine", duration: 0.08, gain: 0.28 });
  playTone({ freq: 990, type: "sine", duration: 0.12, gain: 0.28, delay: 0.07 });
}
function playBossHitSfx() { playTone({ freq: 440, type: "square", duration: 0.06, gain: 0.18 }); }
function playClearSfx() {
  playTone({ freq: 660, type: "sine", duration: 0.1, gain: 0.3 });
  playTone({ freq: 880, type: "sine", duration: 0.1, gain: 0.3, delay: 0.08 });
  playTone({ freq: 1320, type: "sine", duration: 0.22, gain: 0.3, delay: 0.16 });
}
function playBossAppearSfx() {
  playTone({ startFreq: 120, endFreq: 300, type: "sawtooth", duration: 0.5, gain: 0.25 });
}

function showScreen(el) {
  [startScreen, gameScreen, resultScreen].forEach((s) => s.classList.add("hidden"));
  el.classList.remove("hidden");
}

function updateHud() {
  scoreLabel.textContent = `SCORE ${score.toLocaleString()}`;
  livesLabel.textContent = "❤️".repeat(Math.max(0, lives)) + "🖤".repeat(Math.max(0, START_LIVES - lives));
}

function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove("hidden", "fade-out");
  clearTimeout(showToast._t1);
  clearTimeout(showToast._t2);
  showToast._t1 = setTimeout(() => toastEl.classList.add("fade-out"), 1800);
  showToast._t2 = setTimeout(() => toastEl.classList.add("hidden"), 2200);
}

function triggerDamageFx() {
  field.classList.remove("hit-flash");
  void field.offsetWidth;
  field.classList.add("hit-flash");
  setTimeout(() => field.classList.remove("hit-flash"), 320);
}

function startBgm() {
  try { bgm.currentTime = 0; } catch (e) { /* メタデータ未取得時は無視 */ }
  bgm.volume = BASE_BGM_VOLUME;
  bgm.playbackRate = 1.0;
  bgm.play().catch(() => {});
}

const startBtn = document.getElementById("startBtn");
async function preloadBgm() {
  try {
    const res = await fetch(bgm.getAttribute("src"));
    if (!res.ok) throw new Error(`bgm fetch failed: ${res.status}`);
    const buf = await res.arrayBuffer();
    const blob = new Blob([buf], { type: "audio/mp4" });
    bgm.src = URL.createObjectURL(blob);
    bgm.load();
  } catch (e) {
    // 読み込みに失敗しても無音で遊べるようにする
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = "タップしてスタート";
  }
}
preloadBgm();

// クリア条件は「ボスを倒す」なので、曲が流れ切っても自動クリアにはしない
// (戦闘が長引いていたら無音のまま続行、ループはさせない)。
bgm.addEventListener("ended", () => { /* 何もしない */ });

muteBtn.addEventListener("click", () => {
  muted = !muted;
  bgm.muted = muted;
  muteBtn.textContent = muted ? "🔇" : "🔊";
});

// --- 自機のドラッグ追従(スワイプ判定は使わず、pointer座標を直接反映するだけ) ---
field.addEventListener("pointerdown", (ev) => {
  if (gameEnded) return;
  dragging = true;
  field.setPointerCapture(ev.pointerId);
  updateShipFromPointer(ev);
});
field.addEventListener("pointermove", (ev) => {
  if (!dragging || gameEnded) return;
  updateShipFromPointer(ev);
});
field.addEventListener("pointerup", () => { dragging = false; });
field.addEventListener("pointercancel", () => { dragging = false; });

function updateShipFromPointer(ev) {
  const rect = field.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;
  const w = field.clientWidth;
  const h = field.clientHeight;
  shipPos.x = Math.min(w - SHIP_RADIUS, Math.max(SHIP_RADIUS, x));
  shipPos.y = Math.min(h - SHIP_RADIUS, Math.max(SHIP_RADIUS, y));
}

function clearAllEntities() {
  enemies.forEach((e) => e.el.remove());
  playerBullets.forEach((b) => b.el.remove());
  enemyBullets.forEach((b) => b.el.remove());
  items.forEach((it) => it.el.remove());
  options.forEach((o) => o.el.remove());
  if (boss) boss.el.remove();
  enemies = [];
  playerBullets = [];
  enemyBullets = [];
  items = [];
  options = [];
  boss = null;
  if (shipEl) shipEl.remove();
  shipEl = null;
}

function startGame() {
  score = 0;
  combo = 0;
  lives = START_LIVES;
  songCleared = false;
  gameEnded = false;
  weaponMode = "normal";
  bossPhase = false;
  bossSpawned = false;
  clearAllEntities();
  toastEl.classList.add("hidden");
  bossHpWrap.classList.add("hidden");
  updateHud();
  showScreen(gameScreen);

  shipEl = document.createElement("div");
  shipEl.id = "ship";
  const shipImg = document.createElement("img");
  shipImg.src = "assets/player.gif";
  shipImg.draggable = false;
  shipEl.appendChild(shipImg);
  field.appendChild(shipEl);
  shipPos = { x: field.clientWidth / 2, y: field.clientHeight - 80 };
  invincibleUntil = 0;

  startBgm();
  runStartTime = performance.now();
  nextEnemySpawnAt = runStartTime + 500;
  nextPlayerFireAt = runStartTime;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
}

// ============ 雑魚(通常敵) ============

const ENEMY_MOVE_PATTERNS = ["straight", "sway", "zigzag"];
const ENEMY_BULLET_PATTERNS = [
  { type: "straight", weight: 50 },
  { type: "aimed", weight: 30 },
  { type: "spread", weight: 20 },
];
const BULLET_PATTERN_TOTAL = ENEMY_BULLET_PATTERNS.reduce((s, p) => s + p.weight, 0);

function pickBulletPattern() {
  let r = Math.random() * BULLET_PATTERN_TOTAL;
  for (const p of ENEMY_BULLET_PATTERNS) {
    if (r < p.weight) return p.type;
    r -= p.weight;
  }
  return "straight";
}

function spawnEnemy(diff, atX) {
  const el = document.createElement("div");
  el.className = "enemy";
  const img = document.createElement("img");
  img.src = "assets/enemy1.gif";
  img.draggable = false;
  el.appendChild(img);
  field.appendChild(el);

  const w = field.clientWidth;
  const x = atX !== undefined ? atX : ENEMY_RADIUS + Math.random() * Math.max(1, w - ENEMY_RADIUS * 2);
  const now = performance.now();
  enemies.push({
    el,
    x,
    y: -ENEMY_RADIUS,
    baseX: x,
    swayPhase: Math.random() * Math.PI * 2,
    pattern: ENEMY_MOVE_PATTERNS[Math.floor(Math.random() * ENEMY_MOVE_PATTERNS.length)],
    zigDir: Math.random() < 0.5 ? -1 : 1,
    nextZigAt: now + 400 + Math.random() * 500,
    speed: diff.enemySpeed * (0.85 + Math.random() * 0.3),
    bulletPattern: pickBulletPattern(),
    nextFireAt: now + 700 + Math.random() * diff.enemyFireGap,
    done: false,
  });
}

// ============ プレイヤー弾・アイテム効果 ============

function spawnPlayerBullet() {
  if (weaponMode === "laser") {
    fireLaserPulse();
    return;
  }
  const el = document.createElement("div");
  el.className = weaponMode === "missile" ? "p-bullet p-missile" : "p-bullet";
  field.appendChild(el);
  const bullet = { el, x: shipPos.x, y: shipPos.y - SHIP_RADIUS, vx: 0, vy: -PLAYER_BULLET_SPEED, missile: weaponMode === "missile" };
  playerBullets.push(bullet);
  playShootSfx();
}

function fireLaserPulse() {
  // 自機の少し上で細く、画面上端に行くほど広がる円錐(台形)ビーム
  const beam = document.createElement("div");
  beam.className = "laser-beam";
  beam.style.left = `${shipPos.x - LASER_WIDE_HALF}px`;
  beam.style.width = `${LASER_WIDE_HALF * 2}px`;
  beam.style.top = "0px";
  beam.style.height = `${shipPos.y}px`;
  const narrowPct = (0.5 - LASER_NARROW_HALF / (LASER_WIDE_HALF * 2)) * 100;
  const narrowPctR = 100 - narrowPct;
  beam.style.clipPath = `polygon(${narrowPct}% 100%, ${narrowPctR}% 100%, 100% 0%, 0% 0%)`;
  field.appendChild(beam);
  setTimeout(() => beam.remove(), 140);
  playTone({ freq: 1400, type: "sawtooth", duration: 0.1, gain: 0.1 });

  // ビーム内(高さに応じて半幅が広がる)の敵とボスに一括ダメージ
  for (const enemy of enemies.slice()) {
    if (enemy.done) continue;
    if (enemy.y >= shipPos.y || enemy.y < 0) continue;
    const ratio = 1 - enemy.y / shipPos.y; // 0=自機付近, 1=画面最上部
    const halfWidthAtY = lerp(LASER_NARROW_HALF, LASER_WIDE_HALF, ratio);
    if (Math.abs(enemy.x - shipPos.x) < halfWidthAtY) {
      damageEnemy(enemy);
    }
  }
  if (boss && !boss.done && !boss.entering && boss.y < shipPos.y) {
    const ratio = 1 - boss.y / shipPos.y;
    const halfWidthAtY = lerp(LASER_NARROW_HALF, LASER_WIDE_HALF, ratio) + BOSS_RADIUS * 0.6;
    if (Math.abs(boss.x - shipPos.x) < halfWidthAtY) {
      damageBoss(1);
    }
  }
}

function spawnOption(side) {
  const el = document.createElement("div");
  el.className = "option-ship";
  const img = document.createElement("img");
  img.src = side === "left" ? "assets/option1.gif" : "assets/option2.gif";
  img.draggable = false;
  el.appendChild(img);
  field.appendChild(el);
  options.push({ el, side, nextFireAt: performance.now() });
}

function spawnOptionBullet(opt) {
  // オプションはメインの武器モードに関わらず、常に通常弾を撃つ
  // (レーザー/ミサイル中にオプションが何もしなくなるのを避けるため)
  const el = document.createElement("div");
  el.className = "p-bullet";
  field.appendChild(el);
  const x = opt.el._x || shipPos.x;
  const y = (opt.el._y || shipPos.y) - 10;
  playerBullets.push({ el, x, y, vx: 0, vy: -PLAYER_BULLET_SPEED, missile: false });
}

function applyItemEffect(type) {
  playItemSfx();
  if (type === "option") {
    if (options.length < OPTION_MAX) {
      spawnOption(options.length === 0 ? "left" : "right");
      showToast("オプション追加!");
    } else {
      score += 300;
      showToast("オプション満タン(+300点)");
    }
  } else if (type === "laser") {
    weaponMode = "laser";
    showToast("範囲レーザー!");
  } else if (type === "missile") {
    weaponMode = "missile";
    showToast("追尾ミサイル!");
  } else if (type === "heal") {
    lives = Math.min(START_LIVES, lives + HEAL_AMOUNT);
    showToast("ライフ回復!");
    updateHud();
  }
}

function spawnItem(x, y) {
  const type = ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)];
  const el = document.createElement("div");
  el.className = "item-drop";
  const img = document.createElement("img");
  img.src = `assets/item_${type}.png`;
  img.draggable = false;
  el.appendChild(img);
  field.appendChild(el);
  items.push({ el, x, y, type, done: false });
}

// ============ ボス ============

function spawnBoss() {
  bossPhase = true;
  bossSpawned = true;
  const el = document.createElement("div");
  el.className = "boss";
  const img = document.createElement("img");
  img.src = "assets/boss.gif";
  img.draggable = false;
  el.appendChild(img);
  field.appendChild(el);
  const w = field.clientWidth;
  boss = {
    el,
    x: w / 2,
    y: -BOSS_RADIUS,
    targetY: BOSS_Y,
    hp: BOSS_HP,
    maxHp: BOSS_HP,
    swayPhase: 0,
    spawnTime: performance.now(),
    nextMinionAt: performance.now() + 3000,
    nextBulletAt: performance.now() + 2000,
    entering: true,
    done: false,
  };
  bossHpWrap.classList.remove("hidden");
  updateBossHpBar();
  showToast("ボス出現!");
  playBossAppearSfx();
}

function updateBossHpBar() {
  if (!boss) return;
  bossHpFill.style.width = `${Math.max(0, (boss.hp / boss.maxHp) * 100)}%`;
}

function damageBoss(amount) {
  if (!boss || boss.done || boss.entering) return;
  boss.hp -= amount;
  boss.el.classList.remove("hit-pulse");
  void boss.el.offsetWidth;
  boss.el.classList.add("hit-pulse");
  setTimeout(() => boss && boss.el && boss.el.classList.remove("hit-pulse"), 150);
  playBossHitSfx();
  const bonus = Math.min(COMBO_BONUS_CAP, combo * COMBO_BONUS_STEP);
  score += Math.round(BOSS_POINTS_PER_HIT * (1 + bonus));
  combo += 1;
  updateHud();
  updateBossHpBar();
  if (boss.hp <= 0) {
    defeatBoss();
  }
}

function defeatBoss() {
  boss.done = true;
  score += BOSS_KILL_BONUS;
  updateHud();
  boss.el.classList.add("boss-defeated");
  setTimeout(() => { if (boss) boss.el.remove(); }, 500);
  finishRun("bossDefeated");
}

// ============ 敵/自機ダメージ処理 ============

function damageEnemy(enemy) {
  if (enemy.done) return;
  enemy.done = true;
  const idx = enemies.indexOf(enemy);
  if (idx !== -1) enemies.splice(idx, 1);
  enemy.el.classList.add("popped");
  setTimeout(() => enemy.el.remove(), 180);

  const bonus = Math.min(COMBO_BONUS_CAP, combo * COMBO_BONUS_STEP);
  score += Math.round(BASE_POINTS * (1 + bonus));
  combo += 1;
  playHitSfx();
  updateHud();

  if (Math.random() < ITEM_DROP_CHANCE) {
    spawnItem(enemy.x, enemy.y);
  }
}

function removeBullet(list, b) {
  const idx = list.indexOf(b);
  if (idx !== -1) list.splice(idx, 1);
  b.el.remove();
}

function applyDamage() {
  combo = 0;
  lives -= 1;
  invincibleUntil = performance.now() + INVINCIBLE_MS;
  triggerDamageFx();
  playDamageSfx();
  updateHud();
  if (lives <= 0) {
    finishRun("damage");
  }
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

// ============ メインループ ============

function tick(now) {
  if (gameEnded) return;
  const diff = getDifficulty(Math.min(now - runStartTime, BOSS_TRIGGER_MS));
  const h = field.clientHeight;
  const w = field.clientWidth;
  const dt = 1 / 60; // 敵/弾の速度計算は px/s 基準の固定ステップで十分(過度な精度は不要)

  // 自機描画 + 無敵演出
  const invincible = now < invincibleUntil;
  shipEl.classList.toggle("invincible", invincible);
  shipEl.style.left = `${shipPos.x}px`;
  shipEl.style.top = `${shipPos.y}px`;

  // オプション機(自機の斜め後ろに追従)。メインが何であっても常に通常弾を撃つ
  options.forEach((opt) => {
    const offsetX = opt.side === "left" ? -34 : 34;
    const ox = shipPos.x + offsetX;
    const oy = shipPos.y + 14;
    opt.el._x = ox;
    opt.el._y = oy;
    opt.el.style.left = `${ox}px`;
    opt.el.style.top = `${oy}px`;
    if (now >= opt.nextFireAt) {
      spawnOptionBullet(opt);
      opt.nextFireAt = now + OPTION_FIRE_INTERVAL_MS;
    }
  });

  // 自機の自動連射
  const fireInterval = weaponMode === "laser" ? LASER_FIRE_INTERVAL_MS : weaponMode === "missile" ? MISSILE_FIRE_INTERVAL_MS : PLAYER_FIRE_INTERVAL_MS;
  if (now >= nextPlayerFireAt) {
    spawnPlayerBullet();
    nextPlayerFireAt = now + fireInterval;
  }

  // ボス出現トリガー(雑魚の自然湧きはボス出現後停止)
  if (!bossSpawned && now - runStartTime >= BOSS_TRIGGER_MS) {
    spawnBoss();
  }

  // 雑魚の出現(ボス出現前のみ)
  if (!bossPhase && enemies.length < diff.maxConcurrent && now >= nextEnemySpawnAt) {
    spawnEnemy(diff);
    nextEnemySpawnAt = now + diff.spawnGap;
  }

  // ボスの挙動
  if (boss && !boss.done) {
    if (boss.entering) {
      boss.y += 60 * dt;
      if (boss.y >= boss.targetY) {
        boss.y = boss.targetY;
        boss.entering = false;
      }
    } else {
      const t = (now - boss.spawnTime) / 1000;
      boss.x = w / 2 + Math.sin(t * BOSS_SWAY_SPEED) * Math.min(BOSS_SWAY_AMP, w / 2 - BOSS_RADIUS);
      if (now >= boss.nextMinionAt) {
        spawnEnemy(diff, boss.x + (Math.random() - 0.5) * 60);
        boss.nextMinionAt = now + BOSS_MINION_GAP_MS * (0.8 + Math.random() * 0.4);
      }
      if (now >= boss.nextBulletAt) {
        fireBossBullets();
        boss.nextBulletAt = now + BOSS_BULLET_GAP_MS * (0.8 + Math.random() * 0.4);
      }
    }
    boss.el.style.left = `${boss.x}px`;
    boss.el.style.top = `${boss.y}px`;

    if (!boss.entering && !invincible && dist(boss.x, boss.y, shipPos.x, shipPos.y) < BOSS_RADIUS * 0.6 + SHIP_RADIUS) {
      applyDamage();
    }
  }

  // 雑魚の移動・発砲・自機との当たり判定
  for (const enemy of enemies.slice()) {
    if (enemy.done) continue;
    enemy.y += enemy.speed * dt;

    if (enemy.pattern === "sway") {
      enemy.swayPhase += dt * 2;
      enemy.x = enemy.baseX + Math.sin(enemy.swayPhase) * 40;
    } else if (enemy.pattern === "zigzag") {
      if (now >= enemy.nextZigAt) {
        enemy.zigDir *= -1;
        enemy.nextZigAt = now + 400 + Math.random() * 500;
      }
      enemy.x += enemy.zigDir * 70 * dt;
    }
    // "straight" はxを変えない
    enemy.x = Math.min(w - ENEMY_RADIUS, Math.max(ENEMY_RADIUS, enemy.x));
    enemy.el.style.left = `${enemy.x}px`;
    enemy.el.style.top = `${enemy.y}px`;

    if (now >= enemy.nextFireAt) {
      fireEnemyBullets(enemy);
      enemy.nextFireAt = now + diff.enemyFireGap * (0.8 + Math.random() * 0.4);
    }

    if (enemy.y - ENEMY_RADIUS > h) {
      const idx = enemies.indexOf(enemy);
      if (idx !== -1) enemies.splice(idx, 1);
      enemy.el.remove();
      continue;
    }

    if (!invincible && dist(enemy.x, enemy.y, shipPos.x, shipPos.y) < ENEMY_RADIUS + SHIP_RADIUS) {
      const idx = enemies.indexOf(enemy);
      if (idx !== -1) enemies.splice(idx, 1);
      enemy.el.remove();
      applyDamage();
    }
  }

  // 自機弾/オプション弾の移動・当たり判定(ミサイルは追尾)
  for (const b of playerBullets.slice()) {
    if (b.missile) {
      const target = findNearestTarget(b.x, b.y);
      if (target) {
        const desiredAngle = Math.atan2(target.y - b.y, target.x - b.x);
        const currentAngle = Math.atan2(b.vy, b.vx);
        let diffAngle = desiredAngle - currentAngle;
        while (diffAngle > Math.PI) diffAngle -= Math.PI * 2;
        while (diffAngle < -Math.PI) diffAngle += Math.PI * 2;
        const maxTurn = MISSILE_TURN_RATE * dt;
        const turn = Math.max(-maxTurn, Math.min(maxTurn, diffAngle));
        const newAngle = currentAngle + turn;
        b.vx = Math.cos(newAngle) * MISSILE_SPEED;
        b.vy = Math.sin(newAngle) * MISSILE_SPEED;
      } else {
        b.vx = 0;
        b.vy = -MISSILE_SPEED;
      }
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.el.style.left = `${b.x}px`;
    b.el.style.top = `${b.y}px`;
    if (b.y < -20 || b.y > h + 20 || b.x < -20 || b.x > w + 20) { removeBullet(playerBullets, b); continue; }

    let hit = false;
    for (const enemy of enemies) {
      if (enemy.done) continue;
      if (dist(b.x, b.y, enemy.x, enemy.y) < ENEMY_RADIUS + PLAYER_BULLET_RADIUS) {
        damageEnemy(enemy);
        hit = true;
        break;
      }
    }
    if (!hit && boss && !boss.done && !boss.entering && dist(b.x, b.y, boss.x, boss.y) < BOSS_RADIUS * 0.6 + PLAYER_BULLET_RADIUS) {
      damageBoss(b.missile ? 2 : 1);
      hit = true;
    }
    if (hit) removeBullet(playerBullets, b);
  }

  // 敵弾の移動・自機との当たり判定
  for (const b of enemyBullets.slice()) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.el.style.left = `${b.x}px`;
    b.el.style.top = `${b.y}px`;
    if (b.y > h + 20 || b.y < -20 || b.x < -20 || b.x > w + 20) { removeBullet(enemyBullets, b); continue; }

    if (!invincible && dist(b.x, b.y, shipPos.x, shipPos.y) < SHIP_RADIUS + ENEMY_BULLET_RADIUS) {
      removeBullet(enemyBullets, b);
      applyDamage();
    }
  }

  // アイテムの落下・自機との当たり判定
  for (const it of items.slice()) {
    it.y += ITEM_FALL_SPEED * dt;
    it.el.style.left = `${it.x}px`;
    it.el.style.top = `${it.y}px`;
    if (it.y > h + 20) { removeItem(it); continue; }
    if (dist(it.x, it.y, shipPos.x, shipPos.y) < ITEM_RADIUS + SHIP_RADIUS) {
      applyItemEffect(it.type);
      removeItem(it);
    }
  }

  rafId = requestAnimationFrame(tick);
}

function removeItem(it) {
  const idx = items.indexOf(it);
  if (idx !== -1) items.splice(idx, 1);
  it.el.remove();
}

function findNearestTarget(x, y) {
  let best = null;
  let bestDist = Infinity;
  for (const enemy of enemies) {
    if (enemy.done) continue;
    const d = dist(x, y, enemy.x, enemy.y);
    if (d < bestDist) { bestDist = d; best = enemy; }
  }
  if (boss && !boss.done && !boss.entering) {
    const d = dist(x, y, boss.x, boss.y);
    if (d < bestDist) { bestDist = d; best = boss; }
  }
  return best;
}

function fireEnemyBullets(enemy) {
  const pattern = enemy.bulletPattern;
  if (pattern === "straight") {
    spawnEnemyBullet(enemy.x, enemy.y, 0, ENEMY_BULLET_SPEED);
  } else if (pattern === "aimed") {
    const angle = Math.atan2(shipPos.y - enemy.y, shipPos.x - enemy.x);
    spawnEnemyBullet(enemy.x, enemy.y, Math.cos(angle) * ENEMY_BULLET_SPEED, Math.sin(angle) * ENEMY_BULLET_SPEED);
  } else if (pattern === "spread") {
    const baseAngle = Math.PI / 2; // 真下
    [-0.35, 0, 0.35].forEach((offset) => {
      const a = baseAngle + offset;
      spawnEnemyBullet(enemy.x, enemy.y, Math.cos(a) * ENEMY_BULLET_SPEED, Math.sin(a) * ENEMY_BULLET_SPEED);
    });
  }
}

function fireBossBullets() {
  // 自機狙いの3WAY(扇状)。boss-bullet修飾で見た目も雑魚弾より大きく/目立たせる
  const angle = Math.atan2(shipPos.y - boss.y, shipPos.x - boss.x);
  [-0.3, 0, 0.3].forEach((offset) => {
    const a = angle + offset;
    spawnEnemyBullet(
      boss.x, boss.y + BOSS_RADIUS * 0.3,
      Math.cos(a) * BOSS_BULLET_SPEED, Math.sin(a) * BOSS_BULLET_SPEED,
      true
    );
  });
}

function spawnEnemyBullet(x, y, vx, vy, isBoss) {
  const el = document.createElement("div");
  el.className = isBoss ? "e-bullet boss-bullet" : "e-bullet";
  field.appendChild(el);
  enemyBullets.push({ el, x, y, vx, vy });
}

function endGame() {
  gameEnded = true;
  if (rafId) cancelAnimationFrame(rafId);
  bgm.pause();
  clearAllEntities();
}

function finishRun(reason) {
  endGame();
  songCleared = reason === "bossDefeated";
  const best = getHighscore();
  const isNewBest = songCleared && score > best;
  if (isNewBest) localStorage.setItem(HIGHSCORE_KEY, String(score));

  if (songCleared) playClearSfx();

  resultTitle.textContent = songCleared ? "♪ harukaze 入手!" : "やられた…!";
  resultMessage.textContent =
    `SCORE ${score.toLocaleString()}` +
    (songCleared
      ? (isNewBest ? "\n新記録!" : `\nベスト ${Math.max(best, score).toLocaleString()}`)
      : "\nボスを倒せばクリア!");
  showScreen(resultScreen);
}

function refreshBestHint() {
  const best = getHighscore();
  bestHint.textContent = best > 0 ? `ベストスコア ${best.toLocaleString()}` : "";
}

startBtn.addEventListener("click", startGame);
document.getElementById("retryBtn").addEventListener("click", startGame);

refreshBestHint();
