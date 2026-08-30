// ハエ叩きゲーム(ダンジョンRPG企画 ミニゲーム #06 / 対応曲: hoshizora)
// 敵が出現し、しばらくは小さいまま画面内をハエのように不規則に飛び回る
// (buzzフェーズ)。この間にタップすれば撃退。飛び回ったまま一定時間
// タップされないと、動きを止めて一気に拡大しながら迫ってくる(chargeフェーズ)。
// 最大サイズに達すると被弾してライフ-1、ライフ0でゲームオーバー。
//
// 敵は2種類: 「蚊」は1タップで撃退、「蜂」はタフで2タップ必要(1発当てても
// まだ生きていて、もう1タップしないと倒せない)。
// 「味方」はタップするとハートが1回復する(見逃してもペナルティなし)。
// ハートは最大10。他のゲームより被弾を前提にした高難度(出現間隔が短く、
// 突進も速い)。
//
// 敵画像は assets/tataki_enemy1.GIF(蚊)/tataki_enemy2.GIF(蜂)/
// tataki_mikata1.GIF(味方)。BGMは assets/hoshizora.m4a
// (原曲先頭を切り出し、末尾フェードアウト済み)。

const ENEMY_DEFS = [
  { type: "mosquito", img: "assets/tataki_enemy1.GIF",  hp: 1, points: 100, weight: 60 },
  { type: "bee",       img: "assets/tataki_enemy2.GIF", hp: 2, points: 250, weight: 25 },
  { type: "ally",      img: "assets/tataki_mikata1.GIF", hp: 1, points: 0,   weight: 15 },
];
const TOTAL_WEIGHT = ENEMY_DEFS.reduce((s, d) => s + d.weight, 0);

const ENEMY_HALF = 36;
const MIN_SEPARATION = 84;
const COMBO_BONUS_STEP = 0.1; // コンボ1につき+10%
const COMBO_BONUS_CAP = 2.0;  // 最大+200%(x3)
const SONG_UNLOCK_SCORE = 20000;
const START_LIVES = 10;
const HEAL_AMOUNT = 1;
const HIGHSCORE_KEY = "haetataki_hoshizora_highscore";

const BUZZ_SCALE = 0.55;   // 飛び回っている間の大きさ
const CHARGE_SCALE = 1.6;  // 最大まで迫ってきた時の大きさ

// buzzフェーズの動きは「ランダムに目標地点を追いかける」不規則な方式をやめて、
// 数種類の規則的な軌道パターンから選ぶ方式にする(予測しやすく、スピードも遅め)。
const MOVE_PATTERNS = ["orbit", "hsweep", "vsweep", "drift"];
const ORBIT_RADIUS_MIN = 35, ORBIT_RADIUS_MAX = 65;
const ORBIT_SPEED = 0.85;   // rad/s
const SWEEP_AMPLITUDE_MIN = 55, SWEEP_AMPLITUDE_MAX = 95;
const SWEEP_SPEED = 0.75;   // rad/s
const DRIFT_SPEED = 26;     // px/s(直進、端で跳ね返る)
// 主軌道は規則的なまま、その上に小さく素早い震え(羽ばたき感)を重ねる
const JITTER_AMP = 4;       // px
const JITTER_FREQ_X = 6.0;  // rad/s
const JITTER_FREQ_Y = 7.3;  // rad/s(Xと少しずらして単調な往復に見えないようにする)

// 経過時間ベースで難易度(飛び回る時間・突進までの速さ・出現間隔)が上がる。
// RAMP_DURATION_MSでMAXに到達し、以降はMAXのまま維持。
// ハートを10に増やした分、他ゲームより明確にきつい設定にしてある
// (出現間隔が短く同時出現数も多い=結構くらう前提)。
const RAMP_DURATION_MS = 45000;
const MAX_CONCURRENT_CAP = 4;

function lerp(a, b, t) { return a + (b - a) * t; }

function getDifficulty(elapsedMs) {
  const progress = Math.min(1, elapsedMs / RAMP_DURATION_MS);
  const buzzDuration = lerp(8000, 3200, progress);   // 飛び回っていられる時間
  const chargeDuration = lerp(1400, 700, progress);  // 突進(拡大)にかかる時間
  const maxConcurrent = Math.min(MAX_CONCURRENT_CAP, 2 + Math.floor(progress * (MAX_CONCURRENT_CAP - 1)));
  const gap = lerp(1100, 500, progress);
  return { buzzDuration, chargeDuration, maxConcurrent, gap, progress };
}

const field = document.getElementById("field");
const scoreLabel = document.getElementById("scoreLabel");
const comboLabel = document.getElementById("comboLabel");
const livesLabel = document.getElementById("livesLabel");
const toastEl = document.getElementById("toast");
const bestHint = document.getElementById("bestHint");
const muteBtn = document.getElementById("muteBtn");
const bgm = document.getElementById("bgm");
const BASE_BGM_VOLUME = 0.5;
bgm.volume = BASE_BGM_VOLUME;

const startScreen = document.getElementById("startScreen");
const gameScreen = document.getElementById("gameScreen");
const resultScreen = document.getElementById("resultScreen");
const resultTitle = document.getElementById("resultTitle");
const resultMessage = document.getElementById("resultMessage");

let score = 0;
let combo = 0;
let lives = START_LIVES;
let songUnlocked = false;
let activeEnemies = []; // { def, el, phase, phaseStart, buzzDuration, chargeDuration, pos, target, nextRetarget, done }
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

function playHitSfx() {
  playTone({ freq: 660, type: "triangle", duration: 0.08, gain: 0.3 });
  playTone({ freq: 990, type: "triangle", duration: 0.12, gain: 0.3, delay: 0.05 });
}
function playPartialHitSfx() {
  // 蜂の1発目(まだ倒せていない)用の、軽めの手応え音
  playTone({ freq: 440, type: "triangle", duration: 0.06, gain: 0.22 });
}
function playHealSfx() {
  playTone({ freq: 660, type: "sine", duration: 0.08, gain: 0.3 });
  playTone({ freq: 880, type: "sine", duration: 0.08, gain: 0.3, delay: 0.06 });
  playTone({ freq: 1320, type: "sine", duration: 0.16, gain: 0.3, delay: 0.12 });
}
function playDamageSfx() {
  playTone({ startFreq: 220, endFreq: 60, type: "sawtooth", duration: 0.28, gain: 0.32 });
}

function showScreen(el) {
  [startScreen, gameScreen, resultScreen].forEach((s) => s.classList.add("hidden"));
  el.classList.remove("hidden");
}

function updateHud() {
  scoreLabel.textContent = `SCORE ${score.toLocaleString()}`;
  livesLabel.textContent = `❤️ ${Math.max(0, lives)}/${START_LIVES}`;
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

function triggerDamageFx() {
  field.classList.remove("hit-flash", "shake");
  void field.offsetWidth; // reflow for restart
  field.classList.add("hit-flash", "shake");
  setTimeout(() => field.classList.remove("hit-flash", "shake"), 320);
}

// ヒット時の炸裂エフェクト。敵自身のtransformとは別要素にして、
// 突進フェーズ中のJSによる毎フレーム上書きと競合しないようにする。
function spawnHitBurst(x, y, variant) {
  const el = document.createElement("div");
  el.className = `hit-burst hit-burst-${variant}`;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  field.appendChild(el);
  setTimeout(() => el.remove(), 420);
}

// 「+100」「+1❤️」のようなポップアップを一瞬表示してフワッと消える
function spawnScorePopup(x, y, text) {
  const el = document.createElement("div");
  el.className = "score-popup";
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.textContent = text;
  field.appendChild(el);
  setTimeout(() => el.remove(), 700);
}

function startBgm() {
  try { bgm.currentTime = 0; } catch (e) { /* メタデータ未取得時は無視 */ }
  bgm.volume = BASE_BGM_VOLUME; // load()でリセットされることがあるため再生開始のたびに設定し直す
  bgm.playbackRate = 1.0; // テンポは原曲のまま(毎フレーム書き換えない)
  bgm.play().catch(() => { /* 素材未配置 or ブラウザ制限時は無音のまま続行 */ });
}

// BGMをfetchで丸ごと先読みしてからBlob URLに差し替える(モバイル回線でのMIME/遅延の癖を回避)
const startBtn = document.getElementById("startBtn");
async function preloadBgm() {
  try {
    const res = await fetch(bgm.getAttribute("src"));
    if (!res.ok) throw new Error(`bgm fetch failed: ${res.status}`);
    const buf = await res.arrayBuffer();
    const blob = new Blob([buf], { type: "audio/mp4" });
    bgm.src = URL.createObjectURL(blob);
    bgm.load(); // srcの書き換えだけだと反映が遅れる/されないブラウザがあるため明示的にロードし直す
  } catch (e) {
    // 読み込みに失敗しても無音で遊べるようにする
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = "タップしてスタート";
  }
}
preloadBgm();

// 曲が最後まで流れ切ったらそこでゲーム終了(ループしない、末尾フェードアウトは音源に焼き込み済み)
bgm.addEventListener("ended", () => {
  if (!gameEnded) finishRun("song");
});

muteBtn.addEventListener("click", () => {
  muted = !muted;
  bgm.muted = muted;
  muteBtn.textContent = muted ? "🔇" : "🔊";
});

function startGame() {
  score = 0;
  combo = 0;
  lives = START_LIVES;
  songUnlocked = false;
  activeEnemies.forEach((e) => e.el.remove());
  activeEnemies = [];
  gameEnded = false;
  toastEl.classList.add("hidden");
  updateHud();
  showScreen(gameScreen);
  startBgm();
  runStartTime = performance.now();
  nextSpawnAllowedAt = runStartTime;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
}

function randomPointInField() {
  const w = field.clientWidth;
  const h = field.clientHeight;
  const marginX = ENEMY_HALF + 8;
  const marginY = ENEMY_HALF + 8;
  return {
    x: marginX + Math.random() * Math.max(0, w - marginX * 2),
    y: marginY + Math.random() * Math.max(0, h - marginY * 2),
  };
}

// 出現位置は他の敵と重なりすぎないよう軽く分散させる
function pickSpawnPos() {
  let best = randomPointInField();
  let bestScore = -1;
  for (let attempt = 0; attempt < 8; attempt++) {
    const p = randomPointInField();
    let minDist = Infinity;
    for (const e of activeEnemies) {
      minDist = Math.min(minDist, Math.hypot(p.x - e.pos.x, p.y - e.pos.y));
    }
    if (minDist === Infinity || minDist >= MIN_SEPARATION) return p;
    if (minDist > bestScore) { bestScore = minDist; best = p; }
  }
  return best;
}

function pickEnemyDef() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const def of ENEMY_DEFS) {
    if (r < def.weight) return def;
    r -= def.weight;
  }
  return ENEMY_DEFS[0];
}

function buildEnemyEl(def) {
  const el = document.createElement("div");
  el.className = `enemy type-${def.type}`;
  const img = document.createElement("img");
  img.src = def.img;
  img.alt = def.type;
  img.draggable = false;
  el.appendChild(img);
  return el;
}

function spawnOne(diff) {
  const def = pickEnemyDef();
  const el = buildEnemyEl(def);
  field.appendChild(el);

  const pos = pickSpawnPos();
  el.style.left = `${pos.x}px`;
  el.style.top = `${pos.y}px`;
  el.style.transform = `scale(${BUZZ_SCALE})`;
  el.style.opacity = "0.9";

  const now = performance.now();
  const w = field.clientWidth;
  const h = field.clientHeight;
  const pattern = MOVE_PATTERNS[Math.floor(Math.random() * MOVE_PATTERNS.length)];
  // 軌道パターンごとのパラメータをこの時点で確定させる(以後はtで決まる規則的な動き)
  const orbitRadius = ORBIT_RADIUS_MIN + Math.random() * (ORBIT_RADIUS_MAX - ORBIT_RADIUS_MIN);
  const sweepAmp = SWEEP_AMPLITUDE_MIN + Math.random() * (SWEEP_AMPLITUDE_MAX - SWEEP_AMPLITUDE_MIN);
  // 軌道が画面外にはみ出さないよう、中心(=出現位置)を余白ぶん内側にクランプ
  const marginX = ENEMY_HALF + 8 + (pattern === "orbit" ? orbitRadius : pattern === "hsweep" ? sweepAmp : 0);
  const marginY = ENEMY_HALF + 8 + (pattern === "orbit" ? orbitRadius : pattern === "vsweep" ? sweepAmp : 0);
  const center = {
    x: Math.min(w - marginX, Math.max(marginX, pos.x)),
    y: Math.min(h - marginY, Math.max(marginY, pos.y)),
  };
  const driftAngle = Math.random() * Math.PI * 2;

  const enemy = {
    def,
    el,
    hp: def.hp,
    phase: "buzz",
    phaseStart: now,
    buzzDuration: diff.buzzDuration,
    chargeDuration: diff.chargeDuration,
    pos,
    pattern,
    center,
    orbitRadius,
    sweepAmp,
    phaseAngle: Math.random() * Math.PI * 2,
    driftVx: Math.cos(driftAngle) * DRIFT_SPEED,
    driftVy: Math.sin(driftAngle) * DRIFT_SPEED,
    driftStart: now, // phaseStart(buzz→charge用)とは別に持つ、跳ね返りのたびにリセットする基準時刻
    done: false,
  };
  activeEnemies.push(enemy);

  el.addEventListener("pointerdown", (ev) => {
    ev.stopPropagation();
    handleTap(enemy);
  });

  return enemy;
}

function handleTap(enemy) {
  if (enemy.done) return;

  if (enemy.def.type === "ally") {
    enemy.done = true;
    removeEnemy(enemy, "popped");
    lives = Math.min(START_LIVES, lives + HEAL_AMOUNT);
    combo += 1;
    playHealSfx();
    spawnHitBurst(enemy.pos.x, enemy.pos.y, "heal");
    spawnScorePopup(enemy.pos.x, enemy.pos.y, `+${HEAL_AMOUNT}❤️`);
    updateHud();
    checkSongUnlock();
    return;
  }

  // 蚊/蜂: hpが残っていればまだ倒せない(蜂は2タップ必要)
  enemy.hp -= 1;
  if (enemy.hp > 0) {
    playPartialHitSfx();
    enemy.el.classList.remove("hit-pulse");
    void enemy.el.offsetWidth; // reflow for restart
    enemy.el.classList.add("hit-pulse");
    // dangerクラスのpulseアニメと同じfilterプロパティを取り合うので、
    // 短時間で外して元のアニメ(danger中なら赤脈動)に戻す
    setTimeout(() => enemy.el.classList.remove("hit-pulse"), 220);
    spawnHitBurst(enemy.pos.x, enemy.pos.y, "partial");
    return;
  }

  enemy.done = true;
  removeEnemy(enemy, "popped");
  const bonus = Math.min(COMBO_BONUS_CAP, combo * COMBO_BONUS_STEP);
  const gained = Math.round(enemy.def.points * (1 + bonus));
  score += gained;
  combo += 1;
  playHitSfx();
  spawnHitBurst(enemy.pos.x, enemy.pos.y, "kill");
  spawnScorePopup(enemy.pos.x, enemy.pos.y, `+${gained}`);
  updateHud();
  checkSongUnlock();
}

function handleLeak(enemy) {
  if (enemy.done) return;
  enemy.done = true;
  removeEnemy(enemy, "leaked");

  if (enemy.def.type === "mosquito" || enemy.def.type === "bee") {
    lives -= 1;
    triggerDamageFx();
    playDamageSfx();
    updateHud();
    if (lives <= 0) {
      finishRun("damage");
    }
  }
  // 味方(ally)を見逃してもペナルティなし
}

function removeEnemy(enemy, animClass) {
  const idx = activeEnemies.indexOf(enemy);
  if (idx !== -1) activeEnemies.splice(idx, 1);
  enemy.el.classList.add(animClass);
  setTimeout(() => enemy.el.remove(), 240);
}

function checkSongUnlock() {
  if (!songUnlocked && score >= SONG_UNLOCK_SCORE) {
    songUnlocked = true;
    showToast("♪ hoshizora を入手!");
  }
}

function tick(now) {
  if (gameEnded) return;

  const diff = getDifficulty(now - runStartTime);

  for (const enemy of activeEnemies.slice()) {
    if (enemy.done) continue;

    if (enemy.phase === "buzz") {
      const elapsed = now - enemy.phaseStart;
      if (elapsed >= enemy.buzzDuration) {
        // 飛び回るのをやめて突進フェーズへ(現在地に固定)
        enemy.phase = "charge";
        enemy.phaseStart = now;
        continue;
      }
      // 経過時間tの関数として位置を決める規則的な軌道(フレームレートに依存しない)
      const t = elapsed / 1000;
      if (enemy.pattern === "orbit") {
        enemy.pos.x = enemy.center.x + Math.cos(enemy.phaseAngle + t * ORBIT_SPEED) * enemy.orbitRadius;
        enemy.pos.y = enemy.center.y + Math.sin(enemy.phaseAngle + t * ORBIT_SPEED) * enemy.orbitRadius;
      } else if (enemy.pattern === "hsweep") {
        enemy.pos.x = enemy.center.x + Math.sin(enemy.phaseAngle + t * SWEEP_SPEED) * enemy.sweepAmp;
        enemy.pos.y = enemy.center.y;
      } else if (enemy.pattern === "vsweep") {
        enemy.pos.x = enemy.center.x;
        enemy.pos.y = enemy.center.y + Math.sin(enemy.phaseAngle + t * SWEEP_SPEED) * enemy.sweepAmp;
      } else {
        // drift: ゆっくり直進し、フィールド端で跳ね返る
        // (phaseStartはbuzz→charge移行の判定に使っているので、跳ね返りの基準
        // 時刻はdriftStartとして別に持つ)
        const w = field.clientWidth;
        const h = field.clientHeight;
        const td = (now - enemy.driftStart) / 1000;
        let x = enemy.center.x + enemy.driftVx * td;
        let y = enemy.center.y + enemy.driftVy * td;
        const minX = ENEMY_HALF, maxX = w - ENEMY_HALF;
        const minY = ENEMY_HALF, maxY = h - ENEMY_HALF;
        if (x < minX || x > maxX) { enemy.driftVx *= -1; enemy.center.x = enemy.pos.x; enemy.driftStart = now; x = enemy.pos.x; }
        if (y < minY || y > maxY) { enemy.driftVy *= -1; enemy.center.y = enemy.pos.y; enemy.driftStart = now; y = enemy.pos.y; }
        enemy.pos.x = Math.min(maxX, Math.max(minX, x));
        enemy.pos.y = Math.min(maxY, Math.max(minY, y));
      }
      // 主軌道の上に小さく素早い震えを重ねて「生きてる感」を出す(規則的な軌道自体は変えない)
      const jx = enemy.pos.x + Math.sin(enemy.phaseAngle + t * JITTER_FREQ_X) * JITTER_AMP;
      const jy = enemy.pos.y + Math.cos(enemy.phaseAngle + t * JITTER_FREQ_Y) * JITTER_AMP;
      enemy.el.style.left = `${jx}px`;
      enemy.el.style.top = `${jy}px`;
    } else {
      // charge: 位置は固定したまま拡大し、迫ってくる演出
      const elapsed = now - enemy.phaseStart;
      const t = Math.min(1, elapsed / enemy.chargeDuration);
      const scale = lerp(BUZZ_SCALE, CHARGE_SCALE, t);
      enemy.el.style.transform = `scale(${scale})`;
      enemy.el.classList.toggle("danger", enemy.def.type === "mosquito" || enemy.def.type === "bee");
      if (t >= 1) {
        handleLeak(enemy);
      }
    }
  }

  if (!gameEnded && activeEnemies.length < diff.maxConcurrent && now >= nextSpawnAllowedAt) {
    spawnOne(diff);
    nextSpawnAllowedAt = now + diff.gap;
  }

  rafId = requestAnimationFrame(tick);
}

function endGame() {
  gameEnded = true;
  if (rafId) cancelAnimationFrame(rafId);
  activeEnemies.forEach((e) => e.el.remove());
  activeEnemies = [];
  bgm.pause();
}

function finishRun(reason) {
  endGame();
  const best = getHighscore();
  const isNewBest = score > best;
  if (isNewBest) localStorage.setItem(HIGHSCORE_KEY, String(score));

  resultTitle.textContent = reason === "damage" ? "やられた…!" : "曲が終わった!";
  const unlockLine = songUnlocked
    ? "\n♪ hoshizora 入手!"
    : `\n未入手(あと${Math.max(0, SONG_UNLOCK_SCORE - score).toLocaleString()}点)`;
  resultMessage.textContent =
    `SCORE ${score.toLocaleString()}` +
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
