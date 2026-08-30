// 何が映ってるでしょうかクイズ(ダンジョンRPG企画 ミニゲーム #10 / 対応曲: aenaiyoru)
// ぼやけた写真(filter: blur())が時間経過で徐々にクリアになっていく。
// 「何の写真か」を4択で当てる。早く(ぼやけたまま)正解するほど高得点。
// 選択肢はランダムな不正解ではなく、正解と見た目/カテゴリが紛らわしい
// ダミー(例: オムライスの誤答候補はチャーハン/ミートソースパスタ等)を
// あらかじめ用意してある(decoys)。一発勝負、外すとそのラウンドは失敗の
// まま次へ進む(仕分けゲームと同じく強制終了なし)。
// 1プレイぶんはITEMSからランダムにROUNDS_PER_PLAY問抽出してクリアで曲入手。
//
// 写真は神経衰弱ゲームと同じ16種の実写イラストを流用(assets/items/)。
// BGMは assets/aenaiyoru.m4a (原曲先頭を切り出し、末尾フェードアウト済み)を
// プレイ中ずっと背景で流すだけ。

const ITEMS = [
  { key: "mic",       name: "マイク",       img: "assets/items/mic.png",       decoys: ["ヘッドセット", "リモコン", "ドライヤー"] },
  { key: "tuner",      name: "チューニングキー", img: "assets/items/tuner.png",     decoys: ["六角レンチ", "スパナ", "ドライバー"] },
  { key: "acoustic",  name: "アコギ",       img: "assets/items/acoustic.png",  decoys: ["ウクレレ", "バンジョー", "マンドリン"] },
  { key: "guitar",    name: "エレキギター", img: "assets/items/guitar.png",    decoys: ["ベース", "アコギ", "ウクレレ"] },
  { key: "pegwinder", name: "ペグ回し",     img: "assets/items/pegwinder.png", decoys: ["缶切り", "栓抜き", "ドライバー"] },
  { key: "effector",  name: "エフェクター", img: "assets/items/effector.png",  decoys: ["電源タップ", "モバイルバッテリー", "ルーター"] },
  { key: "bass",      name: "ベース",       img: "assets/items/bass.png",      decoys: ["エレキギター", "アコギ", "ウクレレ"] },
  { key: "himawari",  name: "ひまわり",     img: "assets/items/himawari.png",  decoys: ["タンポポ", "マーガレット", "コスモス"] },
  { key: "beer",      name: "ビール",       img: "assets/items/beer.png",      decoys: ["ウーロン茶", "麦茶", "コーラ"] },
  { key: "amp",       name: "アンプ",       img: "assets/items/amp.png",       decoys: ["スピーカー", "電子レンジ", "金庫"] },
  { key: "laptop",    name: "ノートPC",     img: "assets/items/laptop.png",    decoys: ["タブレット", "電子辞書", "ゲーム機"] },
  { key: "shovel",    name: "スコップ",     img: "assets/items/shovel.png",    decoys: ["ほうき", "熊手", "傘"] },
  { key: "soysauce",  name: "しょうゆ",     img: "assets/items/soysauce.png",  decoys: ["みりん", "お酢", "ソース"] },
  { key: "wine",      name: "ワイン",       img: "assets/items/wine.png",      decoys: ["シャンパン", "ジュース", "オリーブオイル"] },
  { key: "hamburg",   name: "ハンバーグ",   img: "assets/items/hamburg.png",   decoys: ["ステーキ", "メンチカツ", "ローストビーフ"] },
  { key: "omurice",   name: "オムライス",   img: "assets/items/omurice.png",   decoys: ["チャーハン", "ミートソースパスタ", "カツ丼"] },
];
const ROUNDS_PER_PLAY = 6;

const REVEAL_DURATION_MS = 8000; // ぼかしが完全に晴れるまでの時間
const START_BLUR_PX = 28;
const MAX_POINTS = 1000;
const MIN_POINTS_IF_CORRECT = 200; // 完全に見えてから正解しても最低これだけは入る
const HIGHSCORE_KEY = "mosaic_aenaiyoru_highscore";
const RESULT_PAUSE_MS = 1800;
const BASE_BGM_VOLUME = 0.5;

const startScreen = document.getElementById("startScreen");
const gameScreen = document.getElementById("gameScreen");
const resultScreen = document.getElementById("resultScreen");
const resultTitle = document.getElementById("resultTitle");
const resultMessage = document.getElementById("resultMessage");

const roundLabel = document.getElementById("roundLabel");
const scoreLabel = document.getElementById("scoreLabel");
const photo = document.getElementById("photo");
const feedbackLabel = document.getElementById("feedbackLabel");
const choicesEl = document.getElementById("choices");
const bestHint = document.getElementById("bestHint");
const muteBtn = document.getElementById("muteBtn");
const bgm = document.getElementById("bgm");
bgm.volume = BASE_BGM_VOLUME;

let score = 0;
let roundIndex = 0;
let roundOrder = []; // このプレイでの出題順(ITEMSから抽出したROUNDS_PER_PLAY問)
let roundPassed = [];
let clearedCount = 0;
let answered = false;
let roundStartTime = 0;
let rafId = null;
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

function currentBlurRatio() {
  const elapsed = performance.now() - roundStartTime;
  return Math.max(0, 1 - elapsed / REVEAL_DURATION_MS);
}

function prepareRound() {
  const item = roundOrder[roundIndex];
  answered = false;
  photo.innerHTML = "";
  const img = document.createElement("img");
  img.src = item.img;
  img.alt = "写真";
  img.draggable = false;
  photo.appendChild(img);
  photo.style.filter = `blur(${START_BLUR_PX}px)`;
  feedbackLabel.textContent = "";

  // 選択肢はランダムな他アイテムではなく、あらかじめ用意した「紛らわしい」ダミーを使う
  const choiceNames = shuffle([item.name, ...item.decoys]);
  choicesEl.innerHTML = "";
  choiceNames.forEach((name) => {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.textContent = name;
    btn.addEventListener("click", () => handleAnswer(name, btn));
    choicesEl.appendChild(btn);
  });

  updateHud();
  roundStartTime = performance.now();
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(revealTick);
}

function revealTick() {
  if (answered) return;
  const ratio = currentBlurRatio();
  photo.style.filter = `blur(${(START_BLUR_PX * ratio).toFixed(1)}px)`;
  if (ratio > 0) {
    rafId = requestAnimationFrame(revealTick);
  }
}

function handleAnswer(pickedName, btnEl) {
  if (answered) return;
  answered = true;
  if (rafId) cancelAnimationFrame(rafId);
  photo.style.filter = "blur(0px)"; // 答え合わせのため一旦フルクリアにする

  const item = roundOrder[roundIndex];
  const correct = pickedName === item.name;
  const blurRatio = currentBlurRatio();
  const points = correct
    ? Math.round(MIN_POINTS_IF_CORRECT + (MAX_POINTS - MIN_POINTS_IF_CORRECT) * blurRatio)
    : 0;
  score += points;
  roundPassed[roundIndex] = correct;
  if (correct) clearedCount += 1;

  // 選択肢に正解/不正解のハイライトを付ける
  Array.from(choicesEl.children).forEach((btn) => {
    btn.disabled = true;
    if (btn.textContent === item.name) btn.classList.add("correct");
    else if (btn === btnEl) btn.classList.add("wrong");
  });

  if (correct) {
    playCorrectSfx();
    feedbackLabel.textContent =
      blurRatio >= 0.7 ? `正解!早い!(+${points}点)` :
      blurRatio >= 0.3 ? `正解!(+${points}点)` :
      `正解!ギリギリ(+${points}点)`;
  } else {
    playWrongSfx();
    feedbackLabel.textContent = `残念…正解は「${item.name}」でした`;
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
  roundOrder = shuffle(ITEMS).slice(0, ROUNDS_PER_PLAY);
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

  const breakdown = roundOrder.map((it, i) => `${it.name} ${roundPassed[i] ? "○" : "×"}`).join("  ");
  resultTitle.textContent = cleared ? "♪ aenaiyoru 入手!" : "あと少し…!";
  const unlockLine = cleared ? "" : `\n未入手(${roundOrder.length}問全部正解でクリア)`;
  resultMessage.textContent =
    `${breakdown}\nSCORE ${score.toLocaleString()} / ${MAX_POINTS * roundOrder.length}` +
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
