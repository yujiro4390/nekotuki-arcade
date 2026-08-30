// 神経衰弱ゲーム(ダンジョンRPG企画 ミニゲーム #08 / 対応曲: kanashikuttemo)
// 全3ステージ制。STAGE1=8枚(4ペア)→STAGE2=16枚(8ペア)→STAGE3=32枚(16ペア)と
// カードがどんどん増えて小さくなり、難易度が上がっていく。
// カードをめくって同じイラスト(機材/身の回りの物)のペアを揃える。
// BGMはスタートと同時に純粋なBGMとして流れ続け、曲が終わる(150秒)までに
// STAGE3まで揃えられなければゲームオーバー。ミスしてもその場では終わらず、
// コンボが切れるだけ(=減点圧はコンボにのみ乗る。致命的なペナルティはなし)。
//
// カードの絵柄は実写イラスト(バンドの持ち物9種+身の回りの物7種、計16種)を使用。
const ALL_PAIR_DEFS = [
  { key: "mic",       img: "assets/mic.png" },
  { key: "himawari",  img: "assets/himawari.png" },
  { key: "amp",       img: "assets/amp.png" },
  { key: "wine",      img: "assets/wine.png" },
  { key: "tuner",     img: "assets/tuner.png" },
  { key: "bass",      img: "assets/bass.png" },
  { key: "laptop",    img: "assets/laptop.png" },
  { key: "hamburg",   img: "assets/hamburg.png" },
  { key: "acoustic",  img: "assets/acoustic.png" },
  { key: "guitar",    img: "assets/guitar.png" },
  { key: "pegwinder", img: "assets/pegwinder.png" },
  { key: "effector",  img: "assets/effector.png" },
  { key: "beer",      img: "assets/beer.png" },
  { key: "shovel",    img: "assets/shovel.png" },
  { key: "soysauce",  img: "assets/soysauce.png" },
  { key: "omurice",   img: "assets/omurice.png" },
];

// 各ステージで使うペア数とグリッド列数。先頭からN個を使う(ステージが進むほど
// 絵柄の種類も増える)。列数が増えるほどカードが小さくなる。
const STAGES = [
  { pairs: 4,  cols: 4 },  // STAGE1: 8枚
  { pairs: 8,  cols: 4 },  // STAGE2: 16枚
  { pairs: 16, cols: 8 },  // STAGE3: 32枚
];

const MATCH_BASE_POINTS = 200;
const COMBO_BONUS_STEP = 0.15; // コンボ1につき+15%
const COMBO_BONUS_CAP = 1.5;   // 最大+150%
const MISMATCH_DELAY_MS = 700;
const STAGE_TRANSITION_MS = 1600;
const HIGHSCORE_KEY = "shinkeisuijaku_kanashikuttemo_highscore";
const BASE_BGM_VOLUME = 0.5;

const board = document.getElementById("board");
const stageLabel = document.getElementById("stageLabel");
const stageTransition = document.getElementById("stageTransition");
const scoreLabel = document.getElementById("scoreLabel");
const comboLabel = document.getElementById("comboLabel");
const turnsLabel = document.getElementById("turnsLabel");
const toastEl = document.getElementById("toast");
const bestHint = document.getElementById("bestHint");
const muteBtn = document.getElementById("muteBtn");
const bgm = document.getElementById("bgm");
bgm.volume = BASE_BGM_VOLUME;

const startScreen = document.getElementById("startScreen");
const gameScreen = document.getElementById("gameScreen");
const resultScreen = document.getElementById("resultScreen");
const resultTitle = document.getElementById("resultTitle");
const resultMessage = document.getElementById("resultMessage");

let score = 0;
let combo = 0;
let turns = 0;
let stageIndex = 0;
let matchedCount = 0;
let flipped = []; // 現在表になっているカード(最大2枚)
let inputLocked = false;
let muted = false;
let gameEnded = false;
let songCleared = false; // クリアして曲を入手できたか(結果画面の再生ボタン表示に使う)

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
function playFlipSfx() {
  playTone({ freq: 520, type: "sine", duration: 0.06, gain: 0.18 });
}
function playMatchSfx() {
  playTone({ freq: 660, type: "triangle", duration: 0.1, gain: 0.28 });
  playTone({ freq: 990, type: "triangle", duration: 0.16, gain: 0.28, delay: 0.07 });
}
function playMismatchSfx() {
  playTone({ startFreq: 400, endFreq: 240, type: "sawtooth", duration: 0.14, gain: 0.2 });
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
  scoreLabel.textContent = `SCORE ${score.toLocaleString()}`;
  turnsLabel.textContent = `手数 ${turns}`;
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

// スタートと同時に先頭から流し始め、そのまま純粋なBGMとして最後まで流し続ける
function startBgm() {
  try { bgm.currentTime = 0; } catch (e) { /* メタデータ未取得時は無視 */ }
  bgm.loop = false; // 曲が終わる=タイムアップなので、ループさせない
  bgm.volume = BASE_BGM_VOLUME;
  bgm.play().catch(() => {});
}

// 結果画面(クリア時のみ)から、BGMを最初から聴き直す
function playBgmFull() {
  try { bgm.currentTime = 0; } catch (e) { /* 無視 */ }
  bgm.play().catch(() => {});
}

// 曲が最後まで流れ切ったら、その時点でクリアできていなければゲームオーバー
bgm.addEventListener("ended", () => {
  if (!gameEnded) finishRun("timeup");
});

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

muteBtn.addEventListener("click", () => {
  muted = !muted;
  bgm.muted = muted;
  muteBtn.textContent = muted ? "🔇" : "🔊";
});

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildBoard() {
  const stage = STAGES[stageIndex];
  const pairDefs = ALL_PAIR_DEFS.slice(0, stage.pairs);

  board.innerHTML = "";
  board.classList.remove("cols-4", "cols-8");
  board.classList.add(`cols-${stage.cols}`);
  stageLabel.textContent = `STAGE ${stageIndex + 1} / ${STAGES.length}(${pairDefs.length * 2}枚)`;

  const deck = shuffle([...pairDefs, ...pairDefs]);
  deck.forEach((def) => {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.key = def.key;

    const inner = document.createElement("div");
    inner.className = "card-inner";

    const faceDown = document.createElement("div");
    faceDown.className = "card-face card-face-down";
    faceDown.textContent = "♪";

    const faceUp = document.createElement("div");
    faceUp.className = "card-face card-face-up";
    const img = document.createElement("img");
    img.src = def.img;
    img.alt = def.key;
    img.draggable = false;
    faceUp.appendChild(img);

    inner.appendChild(faceDown);
    inner.appendChild(faceUp);
    card.appendChild(inner);
    board.appendChild(card);

    card.addEventListener("pointerdown", () => handleCardTap(card));
  });
}

function handleCardTap(card) {
  if (gameEnded || inputLocked) return;
  if (card.classList.contains("flipped") || card.classList.contains("matched")) return;
  if (flipped.length >= 2) return;

  card.classList.add("flipped");
  playFlipSfx();
  flipped.push(card);

  if (flipped.length === 2) {
    turns += 1;
    updateHud();
    resolvePair();
  }
}

function resolvePair() {
  inputLocked = true;
  const [a, b] = flipped;
  const isMatch = a.dataset.key === b.dataset.key;

  if (isMatch) {
    setTimeout(() => {
      if (gameEnded) return; // 揃った直後に曲が終わっていたら何もしない
      a.classList.add("matched");
      b.classList.add("matched");
      flipped = [];
      inputLocked = false;
      matchedCount += 1;

      const bonus = Math.min(COMBO_BONUS_CAP, combo * COMBO_BONUS_STEP);
      score += Math.round(MATCH_BASE_POINTS * (1 + bonus));
      combo += 1;
      updateHud();
      playMatchSfx();

      const stage = STAGES[stageIndex];
      if (matchedCount === stage.pairs) {
        if (stageIndex === STAGES.length - 1) {
          setTimeout(() => finishRun("clear"), 400);
        } else {
          setTimeout(() => advanceStage(), 500);
        }
      }
    }, 220); // 揃った瞬間を一瞬見せてから確定
  } else {
    combo = 0;
    updateHud();
    playMismatchSfx();
    a.classList.add("mismatch");
    b.classList.add("mismatch");
    setTimeout(() => {
      if (gameEnded) return;
      a.classList.remove("flipped", "mismatch");
      b.classList.remove("flipped", "mismatch");
      flipped = [];
      inputLocked = false;
    }, MISMATCH_DELAY_MS);
  }
}

function startGame() {
  score = 0;
  combo = 0;
  turns = 0;
  stageIndex = 0;
  matchedCount = 0;
  flipped = [];
  inputLocked = false;
  gameEnded = false;
  songCleared = false;
  updateHud();
  toastEl.classList.add("hidden");
  stageTransition.classList.add("hidden");
  buildBoard();
  showScreen(gameScreen);
  startBgm();
}

function advanceStage() {
  inputLocked = true;
  stageIndex += 1;
  matchedCount = 0;
  flipped = [];
  stageTransition.textContent = `STAGE ${stageIndex} クリア!\n→ STAGE ${stageIndex + 1}へ`;
  stageTransition.classList.remove("hidden");
  setTimeout(() => {
    if (gameEnded) return; // 演出中に曲が終わってタイムアップになっていたら何もしない
    stageTransition.classList.add("hidden");
    buildBoard();
    inputLocked = false;
  }, STAGE_TRANSITION_MS);
}

const replayBtn = document.getElementById("replayBtn");

function finishRun(reason) {
  gameEnded = true;
  songCleared = reason === "clear";
  inputLocked = true;

  if (songCleared) {
    playClearSfx();
  } else {
    bgm.pause();
  }

  const best = getHighscore();
  const isNewBest = songCleared && score > best;
  if (isNewBest) localStorage.setItem(HIGHSCORE_KEY, String(score));

  resultTitle.textContent = songCleared
    ? "♪ kanashikuttemo 入手!"
    : "タイムアップ…曲が終わっちゃった";
  const stageLine = songCleared
    ? ""
    : `\nSTAGE ${stageIndex + 1}で力尽きた`;
  resultMessage.textContent =
    `SCORE ${score.toLocaleString()}\n手数 ${turns}回` +
    stageLine +
    (songCleared ? (isNewBest ? "\n新記録!" : `\nベスト ${Math.max(best, score).toLocaleString()}`) : "");
  replayBtn.classList.toggle("hidden", !songCleared);
  showScreen(resultScreen);
}

function refreshBestHint() {
  const best = getHighscore();
  bestHint.textContent = best > 0 ? `ベストスコア ${best.toLocaleString()}` : "";
}

startBtn.addEventListener("click", startGame);
document.getElementById("retryBtn").addEventListener("click", startGame);
replayBtn.addEventListener("click", playBgmFull);

refreshBestHint();
