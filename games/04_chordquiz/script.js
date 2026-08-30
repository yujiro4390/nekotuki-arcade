// コード当てクイズ(ダンジョンRPG企画 ミニゲーム #04 / 対応曲(仮): sakura_88)
// 実際に指の押さえ方を撮影した写真を見て、正しいコード名を3択で当てる。
// 一発勝負(和音を作れ!ゲームと違い、聴き取りではなく形を覚える/読み取るクイズ
// なのでリトライ無し)。外しても正解を表示してそのまま次のラウンドへ進む
// (仕分けゲームと同じく強制終了なし)。全ROUNDS_PER_PLAY問正解でクリア。
//
// BGMは耳を使うゲームではないので、低めの音量で流しっぱなしにする。

// 撮影済みの写真(assets/chords/)がある8種類だけを出題する。
// 写真が増えたらここに1行足すだけで出題プールが増える。
const ALL_CHORDS = [
  { key: "A7",      img: "assets/chords/A7.jpg" },
  { key: "C7",      img: "assets/chords/C7.jpg" },
  { key: "Cm7♭5",   img: "assets/chords/Chalfdim.jpg" },
  { key: "D",       img: "assets/chords/D.jpg" },
  { key: "Dm7",     img: "assets/chords/Dm7.jpg" },
  { key: "F",       img: "assets/chords/F.jpg" },
  { key: "G",       img: "assets/chords/G.jpg" },
  { key: "G7",      img: "assets/chords/G7.jpg" },
];
const ROUNDS_PER_PLAY = ALL_CHORDS.length; // 撮れている分は毎回全部出題する

const POINTS_PER_CORRECT = 500;
const HIGHSCORE_KEY = "chordquiz_sakura_88_highscore";
const RESULT_PAUSE_MS = 1600;
const BASE_BGM_VOLUME = 0.3;

const startScreen = document.getElementById("startScreen");
const gameScreen = document.getElementById("gameScreen");
const resultScreen = document.getElementById("resultScreen");
const resultTitle = document.getElementById("resultTitle");
const resultMessage = document.getElementById("resultMessage");

const roundLabel = document.getElementById("roundLabel");
const scoreLabel = document.getElementById("scoreLabel");
const shapeCard = document.getElementById("shapeCard");
const shapeNumber = document.getElementById("shapeNumber");
const feedbackLabel = document.getElementById("feedbackLabel");
const choicesEl = document.getElementById("choices");
const bestHint = document.getElementById("bestHint");
const muteBtn = document.getElementById("muteBtn");
const bgm = document.getElementById("bgm");
bgm.volume = BASE_BGM_VOLUME;

let score = 0;
let roundIndex = 0;
let roundOrder = []; // このプレイでの出題順(ALL_CHORDSから抽出したROUNDS_PER_PLAY問)
let roundPassed = [];
let clearedCount = 0;
let answered = false;
let muted = false;

function getHighscore() {
  return parseInt(localStorage.getItem(HIGHSCORE_KEY) || "0", 10);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
function playCorrectSfx() {
  playTone({ freq: 660, type: "triangle", duration: 0.1, gain: 0.3 });
  playTone({ freq: 990, type: "triangle", duration: 0.16, gain: 0.3, delay: 0.07 });
}
function playWrongSfx() {
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
  roundLabel.textContent = `ROUND ${roundIndex + 1} / ${roundOrder.length}`;
  scoreLabel.textContent = `SCORE ${score.toLocaleString()}`;
}

function startBgm() {
  try { bgm.currentTime = 0; } catch (e) { /* メタデータ未取得時は無視 */ }
  bgm.volume = BASE_BGM_VOLUME;
  bgm.play().catch(() => {});
}

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
  }
}
preloadBgm();

muteBtn.addEventListener("click", () => {
  muted = !muted;
  bgm.muted = muted;
  muteBtn.textContent = muted ? "🔇" : "🔊";
});

function prepareRound() {
  const chord = roundOrder[roundIndex];
  answered = false;
  shapeCard.style.background = "";
  shapeNumber.innerHTML = "";
  const img = document.createElement("img");
  img.src = chord.img;
  img.alt = "コードの押さえ方";
  img.draggable = false;
  shapeNumber.appendChild(img);
  feedbackLabel.textContent = "";

  const decoys = shuffle(ALL_CHORDS.filter((c) => c.key !== chord.key)).slice(0, 2);
  const choiceChords = shuffle([chord, ...decoys]);
  choicesEl.innerHTML = "";
  choiceChords.forEach((c) => {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.textContent = c.key;
    btn.addEventListener("click", () => handleAnswer(c, btn, chord));
    choicesEl.appendChild(btn);
  });

  updateHud();
}

function handleAnswer(picked, btnEl, chord) {
  if (answered) return;
  answered = true;

  const correct = picked.key === chord.key;
  roundPassed[roundIndex] = correct;
  if (correct) {
    clearedCount += 1;
    score += POINTS_PER_CORRECT;
  }

  Array.from(choicesEl.children).forEach((btn) => {
    btn.disabled = true;
    if (btn.textContent === chord.key) btn.classList.add("correct");
    else if (btn === btnEl) btn.classList.add("wrong");
  });

  if (correct) {
    playCorrectSfx();
    feedbackLabel.textContent = `正解!(+${POINTS_PER_CORRECT}点)`;
  } else {
    playWrongSfx();
    feedbackLabel.textContent = `残念…正解は「${chord.key}」でした`;
  }
  updateHud();

  setTimeout(() => {
    roundIndex += 1;
    if (roundIndex >= roundOrder.length) {
      finishRun();
    } else {
      prepareRound();
    }
  }, RESULT_PAUSE_MS);
}

function startGame() {
  score = 0;
  roundIndex = 0;
  roundOrder = shuffle(ALL_CHORDS).slice(0, ROUNDS_PER_PLAY);
  roundPassed = [];
  clearedCount = 0;
  showScreen(gameScreen);
  prepareRound();
  startBgm();
}

function finishRun() {
  bgm.pause();
  const cleared = clearedCount === roundOrder.length;
  const best = getHighscore();
  const isNewBest = score > best;
  if (isNewBest) localStorage.setItem(HIGHSCORE_KEY, String(score));

  if (cleared) playClearSfx();

  const breakdown = roundOrder.map((c, i) => `${c.key} ${roundPassed[i] ? "○" : "×"}`).join("  ");
  resultTitle.textContent = cleared ? "♪ sakura_88 入手!" : "あと少し…!";
  const unlockLine = cleared ? "" : `\n未入手(${roundOrder.length}問全部正解でクリア)`;
  resultMessage.textContent =
    `${breakdown}\nSCORE ${score.toLocaleString()} / ${POINTS_PER_CORRECT * roundOrder.length}` +
    unlockLine +
    (isNewBest ? "\n新記録!" : `\nベスト ${Math.max(best, score).toLocaleString()}`);
  showScreen(resultScreen);
}

function refreshBestHint() {
  const best = getHighscore();
  bestHint.textContent = best > 0 ? `ベストスコア ${best.toLocaleString()}` : "";
}

document.getElementById("startBtn").addEventListener("click", startGame);
document.getElementById("retryBtn").addEventListener("click", startGame);

refreshBestHint();
