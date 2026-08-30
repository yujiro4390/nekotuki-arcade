// 和音を作れ!ゲーム(ダンジョンRPG企画 ミニゲーム #03 / 対応曲(仮): sakura_88)
// 中央のカードをタップすると「お手本の和音」(3音同時)が鳴る。何度でも聴き直せる。
// 下の6個のボタンには音名を表示しない。各ボタン右下の🔈で単音プレビューできる。
// お手本と同じ3音を選んで「和音を鳴らす」を押すと判定。正解なら次のラウンドへ、
// 不正解ならボタンの配置(音の組み合わせ自体は同じ6音)をシャッフルして再挑戦。
// 回数制限なし(仕分けゲームと同じく強制終了なし)。全5ラウンドクリアで曲入手。
// プレイ中はBGM無し(耳で音程を聴き分けるゲームのため、邪魔になる音は流さない)。
//
// 音源はWeb Audio APIでその場合成(C4〜B4のダイアトニック7音を使用)。

const NOTE_POOL = [
  { key: "C", freq: 261.63 },
  { key: "D", freq: 293.66 },
  { key: "E", freq: 329.63 },
  { key: "F", freq: 349.23 },
  { key: "G", freq: 392.00 },
  { key: "A", freq: 440.00 },
  { key: "B", freq: 493.88 },
];
const NOTE_BY_KEY = Object.fromEntries(NOTE_POOL.map((n) => [n.key, n]));

// 和音は「ルートの上に3度・5度(・7度)を積む」ルールで機械的に生成する。
// 7音の音階を配列として、ルートのインデックスから2つ飛ばしに音を拾えば
// (7音しかないので折り返す=mod)、それがそのまま3度堆積になる。
// count=3で三和音(ルート・3度・5度)、count=4で四和音(+7度)。
function stackThirds(rootIndex, count) {
  const notes = [];
  for (let n = 0; n < count; n++) {
    const idx = (rootIndex + n * 2) % NOTE_POOL.length;
    notes.push(NOTE_POOL[idx].key);
  }
  return notes;
}

// 全てC4〜B4の7音だけで組める、ダイアトニックな三和音(7スケール度数ぶん=7種、転回形含む)
const TRIADS = NOTE_POOL.map((_, i) => ({ notes: stackThirds(i, 3) }));
// 同じ7音プールで組める、ダイアトニックな四和音(セブンスコード、同じく7種)
const TETRADS = NOTE_POOL.map((_, i) => ({ notes: stackThirds(i, 4) }));

// ROUND1〜3は三和音、ROUND4〜5は四和音
const TRIAD_ROUNDS = 3;
const TETRAD_ROUNDS = 2;
const TOTAL_ROUNDS = TRIAD_ROUNDS + TETRAD_ROUNDS;
const BUTTON_COUNT = 6;
const BASE_POINTS = 1000;
const POINTS_PER_EXTRA_ATTEMPT = 150;
const MIN_POINTS = 100;
const HIGHSCORE_KEY = "waon_sakura88_highscore";
const RESULT_PAUSE_MS = 1200;

const startScreen = document.getElementById("startScreen");
const gameScreen = document.getElementById("gameScreen");
const resultScreen = document.getElementById("resultScreen");
const resultMessage = document.getElementById("resultMessage");

const roundLabel = document.getElementById("roundLabel");
const scoreLabel = document.getElementById("scoreLabel");
const attemptsLabel = document.getElementById("attemptsLabel");
const sampleCard = document.getElementById("sampleCard");
const feedbackLabel = document.getElementById("feedbackLabel");
const noteGrid = document.getElementById("noteGrid");
const playChordBtn = document.getElementById("playChordBtn");
const bestHint = document.getElementById("bestHint");

let score = 0;
let roundIndex = 0;
let roundChords = []; // このプレイでの出題順(CHORDSのシャッフル抜粋)
let currentButtons = []; // このラウンドの6ボタン分の音キー配列
let selected = new Set();
let attempts = 1;
let inputLocked = false;

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

// --- 音source(Web Audio APIで実音程を合成) ---
let audioCtx = null;
function ensureAudioCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}
function playNote(freq, { delay = 0, duration = 0.7, gain = 0.22 } = {}) {
  const ctx = ensureAudioCtx();
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}
function playChordNotes(keys) {
  keys.forEach((k) => playNote(NOTE_BY_KEY[k].freq));
}
function playCorrectSfx() {
  playNote(880, { duration: 0.15, gain: 0.25 });
  playNote(1320, { delay: 0.08, duration: 0.2, gain: 0.25 });
}
function playWrongSfx() {
  const ctx = ensureAudioCtx();
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(280, t0);
  osc.frequency.exponentialRampToValueAtTime(140, t0 + 0.2);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.24, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.25);
}
function playClearSfx() {
  playNote(660, { duration: 0.15, gain: 0.28 });
  playNote(880, { delay: 0.1, duration: 0.15, gain: 0.28 });
  playNote(1320, { delay: 0.2, duration: 0.25, gain: 0.28 });
}

function showScreen(el) {
  [startScreen, gameScreen, resultScreen].forEach((s) => s.classList.add("hidden"));
  el.classList.remove("hidden");
}

function updateHud() {
  roundLabel.textContent = `ROUND ${roundIndex + 1} / ${TOTAL_ROUNDS}`;
  scoreLabel.textContent = `SCORE ${score.toLocaleString()}`;
  attemptsLabel.textContent = `挑戦 ${attempts}回目`;
}

function updatePlayChordBtn() {
  const need = roundChords[roundIndex].notes.length;
  playChordBtn.textContent = `和音を鳴らす(${selected.size}/${need})`;
  playChordBtn.disabled = selected.size !== need || inputLocked;
}

// 出題する6ボタン分の音を組み立てる: 正解N音 + 残りの音から(6-N)音を無作為に抜いたデコイ
function buildRoundButtons(chord) {
  const targetKeys = chord.notes;
  const rest = NOTE_POOL.map((n) => n.key).filter((k) => !targetKeys.includes(k));
  const decoyCount = BUTTON_COUNT - targetKeys.length;
  const decoys = shuffle(rest).slice(0, decoyCount);
  return shuffle([...targetKeys, ...decoys]);
}

function renderNoteGrid() {
  noteGrid.innerHTML = "";
  currentButtons.forEach((key) => {
    const btn = document.createElement("button");
    btn.className = "note-btn";
    if (selected.has(key)) btn.classList.add("selected");
    btn.textContent = "♪";

    const preview = document.createElement("button");
    preview.className = "preview-btn";
    preview.textContent = "🔈";
    preview.addEventListener("click", (ev) => {
      ev.stopPropagation();
      playNote(NOTE_BY_KEY[key].freq, { duration: 0.5 });
    });

    btn.appendChild(preview);
    btn.addEventListener("click", () => toggleNote(key, btn));
    noteGrid.appendChild(btn);
  });
}

function toggleNote(key, btnEl) {
  if (inputLocked) return;
  const need = roundChords[roundIndex].notes.length;
  if (selected.has(key)) {
    selected.delete(key);
    btnEl.classList.remove("selected");
  } else {
    if (selected.size >= need) return; // このラウンドの正解音数まで
    selected.add(key);
    btnEl.classList.add("selected");
  }
  updatePlayChordBtn();
}

function prepareRound() {
  const chord = roundChords[roundIndex];
  attempts = 1;
  selected = new Set();
  inputLocked = false;
  feedbackLabel.textContent = "";
  currentButtons = buildRoundButtons(chord);
  renderNoteGrid();
  updatePlayChordBtn();
  updateHud();
}

function isCorrectSelection(chord) {
  if (selected.size !== chord.notes.length) return false;
  return chord.notes.every((k) => selected.has(k));
}

function handlePlayChord() {
  const chord = roundChords[roundIndex];
  if (inputLocked || selected.size !== chord.notes.length) return;
  inputLocked = true;
  const selectedKeys = Array.from(selected);
  playChordNotes(selectedKeys);

  setTimeout(() => {
    const correct = isCorrectSelection(chord);
    if (correct) {
      const points = Math.max(MIN_POINTS, BASE_POINTS - (attempts - 1) * POINTS_PER_EXTRA_ATTEMPT);
      score += points;
      feedbackLabel.textContent = `正解!(${attempts}回目 / +${points}点)`;
      playCorrectSfx();
      updateHud();
      setTimeout(() => {
        roundIndex += 1;
        if (roundIndex >= TOTAL_ROUNDS) {
          finishRun();
        } else {
          prepareRound();
        }
      }, RESULT_PAUSE_MS);
    } else {
      attempts += 1;
      feedbackLabel.textContent = "ちがう…もう一度聴いてみよう(音の組み合わせも引き直し)";
      playWrongSfx();
      selected = new Set();
      currentButtons = buildRoundButtons(chord); // デコイも含めて毎回引き直す(位置だけでなく中身も変える)
      renderNoteGrid();
      inputLocked = false;
      updatePlayChordBtn();
      updateHud();
    }
  }, 750); // 選んだ和音の余韻を聴かせてから判定
}

sampleCard.addEventListener("click", () => {
  const chord = roundChords[roundIndex];
  if (chord) playChordNotes(chord.notes);
});

function startGame() {
  score = 0;
  roundIndex = 0;
  const triadPicks = shuffle(TRIADS).slice(0, TRIAD_ROUNDS);
  const tetradPicks = shuffle(TETRADS).slice(0, TETRAD_ROUNDS);
  roundChords = [...triadPicks, ...tetradPicks]; // ROUND1-3=三和音, ROUND4-5=四和音
  showScreen(gameScreen);
  prepareRound();
}

function finishRun() {
  playClearSfx();
  const best = getHighscore();
  const isNewBest = score > best;
  if (isNewBest) localStorage.setItem(HIGHSCORE_KEY, String(score));

  resultMessage.textContent =
    `SCORE ${score.toLocaleString()} / ${BASE_POINTS * TOTAL_ROUNDS}` +
    (isNewBest ? "\n新記録!" : `\nベスト ${Math.max(best, score).toLocaleString()}`);
  showScreen(resultScreen);
}

function refreshBestHint() {
  const best = getHighscore();
  bestHint.textContent = best > 0 ? `ベストスコア ${best.toLocaleString()}` : "";
}

document.getElementById("startBtn").addEventListener("click", startGame);
document.getElementById("retryBtn").addEventListener("click", startGame);
playChordBtn.addEventListener("click", handlePlayChord);

refreshBestHint();
