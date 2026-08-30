// 10秒で止めろ!ゲーム(ダンジョンRPG企画 ミニゲーム #07 / 対応曲(仮): startline)
// タイマーが0.00からカウントアップし、STOPを押した瞬間の値が目標タイムに
// どれだけ近いかで得点が決まる。目標は全ラウンド共通で10.00秒、
// 許容誤差も共通で±0.3秒。ラウンドが進んでも数字そのものの難度は上げず、
// 代わりに「見え方」だけを変えて難しくする:
//   ROUND1: 常時表示
//   ROUND2: 3秒あたりから薄くなり始め、7秒で完全に見えなくなる
//   ROUND3: 2秒で突然非表示になる
// つまりラウンドが進むほど「感覚だけ」が頼りになる。
// 3ラウンド全て±0.3秒以内で止められたら曲入手。外しても即終了はしない
// (仕分けゲームと同じく強制終了なし、その場で次のラウンドへ進める)。
//
// BGMは無し(曲があると拍でタイミングが分かってしまうため、あえて無音)。

const ROUNDS = [
  { target: 10.00, tolerance: 0.3, visibility: "always" },
  { target: 10.00, tolerance: 0.3, visibility: "fade",   fadeStart: 3.0, fadeEnd: 7.0 },
  { target: 10.00, tolerance: 0.3, visibility: "cutoff", cutoffAt: 2.0 },
];

const MAX_ROUND_POINTS = 1000;
const HIGHSCORE_KEY = "tomero_startline_highscore";
const RESULT_PAUSE_MS = 1800;

const startScreen = document.getElementById("startScreen");
const gameScreen = document.getElementById("gameScreen");
const resultScreen = document.getElementById("resultScreen");
const resultTitle = document.getElementById("resultTitle");
const resultMessage = document.getElementById("resultMessage");

const roundLabel = document.getElementById("roundLabel");
const scoreLabel = document.getElementById("scoreLabel");
const targetLabel = document.getElementById("targetLabel");
const timerDisplay = document.getElementById("timerDisplay");
const feedbackLabel = document.getElementById("feedbackLabel");
const roundBtn = document.getElementById("roundBtn");
const gaugeTarget = document.getElementById("gaugeTarget");
const gaugeTolerance = document.getElementById("gaugeTolerance");
const gaugeMarker = document.getElementById("gaugeMarker");
const bestHint = document.getElementById("bestHint");

let score = 0;
let roundIndex = 0;
let clearedCount = 0;
let roundPassed = []; // 各ラウンドが±0.3秒以内に収まったか(結果画面の内訳表示用)
let running = false; // タイマー計測中か
let startTimestamp = 0;
let rafId = null;
let inputLocked = false;

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
function playTone({ freq, startFreq, endFreq, type = "sine", duration = 0.12, gain = 0.2, delay = 0 }) {
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
function playStartSfx() {
  playTone({ freq: 440, type: "sine", duration: 0.08, gain: 0.2 });
}
function playPerfectSfx() {
  playTone({ freq: 880, type: "triangle", duration: 0.1, gain: 0.3 });
  playTone({ freq: 1320, type: "triangle", duration: 0.18, gain: 0.3, delay: 0.08 });
}
function playGoodSfx() {
  playTone({ freq: 660, type: "triangle", duration: 0.12, gain: 0.28 });
}
function playMissSfx() {
  playTone({ startFreq: 300, endFreq: 150, type: "sawtooth", duration: 0.2, gain: 0.24 });
}
function playClearSfx() {
  playTone({ freq: 660, type: "sine", duration: 0.1, gain: 0.3 });
  playTone({ freq: 880, type: "sine", duration: 0.1, gain: 0.3, delay: 0.08 });
  playTone({ freq: 1320, type: "sine", duration: 0.22, gain: 0.3, delay: 0.16 });
}

function showScreen(el) {
  [startScreen, gameScreen, resultScreen].forEach((s) => s.classList.add("hidden"));
  el.classList.remove("hidden");
}

function updateHud() {
  roundLabel.textContent = `ROUND ${roundIndex + 1} / ${ROUNDS.length}`;
  scoreLabel.textContent = `SCORE ${score.toLocaleString()}`;
}

const startBtn = document.getElementById("startBtn");
startBtn.disabled = false;
startBtn.textContent = "タップしてスタート";

function prepareRound() {
  const round = ROUNDS[roundIndex];
  targetLabel.textContent = `目標 ${round.target.toFixed(2)} 秒(許容 ±${round.tolerance.toFixed(2)}秒)`;
  timerDisplay.textContent = "0.00";
  timerDisplay.style.opacity = "1";
  feedbackLabel.textContent = "";
  gaugeMarker.classList.add("hidden");

  // ゲージのスケールは目標タイムの1.5倍を全幅とする(目標が右寄りに来る程度の余白)
  const gaugeMax = round.target * 1.5;
  const targetPct = (round.target / gaugeMax) * 100;
  const toleranceWidthPct = (round.tolerance / gaugeMax) * 100;
  gaugeTarget.style.left = `${targetPct}%`;
  gaugeTolerance.style.left = `${Math.max(0, targetPct - toleranceWidthPct)}%`;
  gaugeTolerance.style.width = `${toleranceWidthPct * 2}%`;

  roundBtn.textContent = "▶ スタート";
  roundBtn.disabled = false;
  inputLocked = false;
  updateHud();
}

// ラウンドごとの見え方ルールを反映した不透明度を返す
function getTimerOpacity(round, elapsed) {
  if (round.visibility === "fade") {
    if (elapsed <= round.fadeStart) return 1;
    if (elapsed >= round.fadeEnd) return 0;
    return 1 - (elapsed - round.fadeStart) / (round.fadeEnd - round.fadeStart);
  }
  if (round.visibility === "cutoff") {
    return elapsed >= round.cutoffAt ? 0 : 1;
  }
  return 1; // "always"
}

function tick() {
  if (!running) return;
  const round = ROUNDS[roundIndex];
  const elapsed = (performance.now() - startTimestamp) / 1000;
  timerDisplay.textContent = elapsed.toFixed(2);
  timerDisplay.style.opacity = String(getTimerOpacity(round, elapsed));
  rafId = requestAnimationFrame(tick);
}

function handleRoundBtn() {
  if (inputLocked) return;
  if (!running) {
    // スタート
    running = true;
    startTimestamp = performance.now();
    playStartSfx();
    roundBtn.textContent = "■ STOP";
    rafId = requestAnimationFrame(tick);
  } else {
    // ストップ
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    const elapsed = (performance.now() - startTimestamp) / 1000;
    resolveRound(elapsed);
  }
}

function resolveRound(elapsed) {
  inputLocked = true;
  const round = ROUNDS[roundIndex];
  const error = Math.abs(elapsed - round.target);
  const ratio = error / round.tolerance;
  const points = Math.max(0, Math.round(MAX_ROUND_POINTS * (1 - Math.min(1, ratio))));
  score += points;

  // 結果は見えていた/いないに関わらず種明かしとして表示する
  timerDisplay.textContent = elapsed.toFixed(2);
  timerDisplay.style.opacity = "1";

  const gaugeMax = round.target * 1.5;
  const markerPct = Math.min(100, Math.max(0, (elapsed / gaugeMax) * 100));
  gaugeMarker.style.left = `${markerPct}%`;
  gaugeMarker.classList.remove("hidden");

  const passed = error <= round.tolerance;
  roundPassed[roundIndex] = passed;
  if (passed) clearedCount += 1;

  let feedback;
  if (ratio <= 0.15) {
    feedback = "パーフェクト!!";
    playPerfectSfx();
  } else if (passed) {
    feedback = "クリア!";
    playGoodSfx();
  } else if (ratio <= 1.5) {
    feedback = "おしい!";
    playGoodSfx();
  } else {
    feedback = "残念…";
    playMissSfx();
  }
  feedbackLabel.textContent = `${feedback}(誤差 ${error.toFixed(2)}秒 / +${points}点)`;
  updateHud();

  roundBtn.disabled = true;
  setTimeout(() => {
    roundIndex += 1;
    if (roundIndex >= ROUNDS.length) {
      finishRun();
    } else {
      prepareRound();
    }
  }, RESULT_PAUSE_MS);
}

function startGame() {
  score = 0;
  roundIndex = 0;
  clearedCount = 0;
  roundPassed = [];
  running = false;
  inputLocked = false;
  showScreen(gameScreen);
  prepareRound();
}

function finishRun() {
  const cleared = clearedCount === ROUNDS.length;
  const best = getHighscore();
  const isNewBest = score > best;
  if (isNewBest) localStorage.setItem(HIGHSCORE_KEY, String(score));

  if (cleared) playClearSfx();

  const breakdown = roundPassed.map((p, i) => `ROUND${i + 1} ${p ? "○" : "×"}`).join("  ");
  resultTitle.textContent = cleared ? "♪ startline 入手!" : "あと少し…!";
  const unlockLine = cleared ? "" : "\n未入手(全ラウンド±0.3秒以内でクリア)";
  resultMessage.textContent =
    `${breakdown}\nSCORE ${score.toLocaleString()} / ${MAX_ROUND_POINTS * ROUNDS.length}` +
    unlockLine +
    (isNewBest ? "\n新記録!" : `\nベスト ${Math.max(best, score).toLocaleString()}`);
  showScreen(resultScreen);
}

function refreshBestHint() {
  const best = getHighscore();
  bestHint.textContent = best > 0 ? `ベストスコア ${best.toLocaleString()}` : "";
}

startBtn.addEventListener("click", startGame);
roundBtn.addEventListener("click", handleRoundBtn);
document.getElementById("retryBtn").addEventListener("click", startGame);

refreshBestHint();
