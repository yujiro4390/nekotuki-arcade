(() => {
  "use strict";

  // ------------------------------------------------------------------
  // Config
  // ------------------------------------------------------------------
  const BOARD_SIZE = 8;
  const CHARACTERS = ["saaya", "maana", "kojiro", "yujiro"];
  const WILDCARD = "wildcard";
  const WILDCARD_CHANCE = 0.12; // chance a tray slot becomes a 1-cell wildcard piece
  const LEADERBOARD_KEY = "nekotuki_blockpuzzle_leaderboard_v1";
  const RECENT_NAMES_KEY = "nekotuki_blockpuzzle_recent_names_v1";
  const LEADERBOARD_MAX = 20;

  // polyomino shapes as arrays of [row, col] offsets (monomino..pentomino-ish)
  const SHAPES = [
    [[0, 0]],
    [[0, 0], [0, 1]],
    [[0, 0], [1, 0]],
    [[0, 0], [0, 1], [0, 2]],
    [[0, 0], [1, 0], [2, 0]],
    [[0, 0], [0, 1], [1, 0], [1, 1]],
    [[0, 0], [0, 1], [0, 2], [1, 0]],
    [[0, 0], [0, 1], [0, 2], [1, 2]],
    [[0, 0], [1, 0], [1, 1], [1, 2]],
    [[0, 2], [1, 0], [1, 1], [1, 2]],
    [[0, 0], [1, 0], [2, 0], [2, 1]],
    [[0, 1], [1, 1], [2, 0], [2, 1]],
    [[0, 0], [0, 1], [1, 1], [2, 1]],
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[0, 1], [1, 0], [1, 1], [2, 0]],
    [[0, 0], [0, 1], [0, 2], [0, 3]],
    [[0, 0], [1, 0], [2, 0], [3, 0]],
    [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]],
    [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]],
  ];

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  let board = createEmptyBoard();
  let tray = [];        // array of {shape, character, used}
  let selectedIdx = -1;
  let score = 0;
  let playerName = "";
  let gameActive = false;
  let busy = false;         // true while a line-clear animation is in flight (blocks input)
  let previewedCells = [];  // cells currently showing a preview highlight, so we can clear just those

  function createEmptyBoard() {
    return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  }

  // ------------------------------------------------------------------
  // DOM refs
  // ------------------------------------------------------------------
  const screens = {
    title: document.getElementById("screen-title"),
    game: document.getElementById("screen-game"),
    over: document.getElementById("screen-over"),
    board: document.getElementById("screen-board"),
  };
  const boardEl = document.getElementById("board");
  const trayEl = document.getElementById("tray");
  const scoreEl = document.getElementById("score");
  const hudPlayerEl = document.getElementById("hud-player");
  const songBarEl = document.getElementById("song-bar");
  const hintEl = document.getElementById("hint");
  const bgm = document.getElementById("bgm");
  const finalScoreEl = document.getElementById("final-score");
  const overTitleEl = document.getElementById("over-title");
  const overReasonEl = document.getElementById("over-reason");
  const leaderboardEl = document.getElementById("leaderboard");
  const nameInput = document.getElementById("player-name");
  const quickNamesEl = document.getElementById("quick-names");

  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.add("hidden"));
    screens[name].classList.remove("hidden");
  }

  // ------------------------------------------------------------------
  // Error banner — surfaces uncaught errors on-screen instead of failing
  // silently, so a problem can be reported/screenshotted without devtools.
  // ------------------------------------------------------------------
  const errorBanner = document.getElementById("error-banner");
  function showError(msg) {
    errorBanner.textContent = `⚠ ${msg}`;
    errorBanner.classList.remove("hidden");
  }
  window.addEventListener("error", (e) => {
    showError(`${e.message} (${e.filename ? e.filename.split("/").pop() : ""}:${e.lineno})`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    showError(`unhandled promise rejection: ${e.reason}`);
  });

  // ------------------------------------------------------------------
  // Sound effects (synthesized, no asset files needed)
  // ------------------------------------------------------------------
  let audioCtx = null;
  function ctx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }
  function beep({ freq = 440, dur = 0.12, type = "sine", gain = 0.15, slideTo = null }) {
    try {
      const ac = ctx();
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ac.currentTime);
      if (slideTo) osc.frequency.linearRampToValueAtTime(slideTo, ac.currentTime + dur);
      g.gain.setValueAtTime(gain, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
      osc.connect(g).connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + dur + 0.02);
    } catch (e) { /* audio not available, ignore */ }
  }
  const sfx = {
    place: () => beep({ freq: 320, dur: 0.08, type: "square", gain: 0.12 }),
    clear: (n) => beep({ freq: 500 + n * 80, dur: 0.22, type: "triangle", gain: 0.18, slideTo: 900 + n * 80 }),
    monochrome: () => beep({ freq: 700, dur: 0.35, type: "sawtooth", gain: 0.15, slideTo: 1400 }),
    bad: () => beep({ freq: 160, dur: 0.15, type: "square", gain: 0.1, slideTo: 90 }),
    gameover: () => beep({ freq: 300, dur: 0.6, type: "sine", gain: 0.16, slideTo: 60 }),
  };

  // ------------------------------------------------------------------
  // Piece generation
  // ------------------------------------------------------------------
  function randomPiece() {
    if (Math.random() < WILDCARD_CHANCE) {
      return { shape: [[0, 0]], character: WILDCARD };
    }
    const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
    const character = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
    return { shape, character };
  }

  function refillTray() {
    tray = [randomPiece(), randomPiece(), randomPiece()];
    selectedIdx = -1;
  }

  // ------------------------------------------------------------------
  // Placement logic
  // ------------------------------------------------------------------
  function shapeBounds(shape) {
    const maxR = Math.max(...shape.map(c => c[0]));
    const maxC = Math.max(...shape.map(c => c[1]));
    return { rows: maxR + 1, cols: maxC + 1 };
  }

  function canPlaceAt(shape, r0, c0) {
    for (const [dr, dc] of shape) {
      const r = r0 + dr, c = c0 + dc;
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
      if (board[r][c]) return false;
    }
    return true;
  }

  function anyPlacement(shape) {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (canPlaceAt(shape, r, c)) return true;
      }
    }
    return false;
  }

  function placeAt(shape, character, r0, c0) {
    for (const [dr, dc] of shape) {
      board[r0 + dr][c0 + dc] = character;
    }
  }

  function isMonochromeLine(cells) {
    let real = null;
    for (const ch of cells) {
      if (ch === WILDCARD) continue;
      if (real === null) real = ch;
      else if (real !== ch) return false;
    }
    return true; // all wildcard, or all same real character (or empty—won't be called on empty)
  }

  function clearFullLines() {
    const fullRows = [];
    const fullCols = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      if (board[r].every(v => v !== null)) fullRows.push(r);
    }
    for (let c = 0; c < BOARD_SIZE; c++) {
      let full = true;
      for (let r = 0; r < BOARD_SIZE; r++) if (!board[r][c]) { full = false; break; }
      if (full) fullCols.push(c);
    }
    if (fullRows.length === 0 && fullCols.length === 0) return { cleared: 0, monochromeCount: 0 };

    let monochromeCount = 0;
    fullRows.forEach(r => { if (isMonochromeLine(board[r])) monochromeCount++; });
    fullCols.forEach(c => {
      const col = [];
      for (let r = 0; r < BOARD_SIZE; r++) col.push(board[r][c]);
      if (isMonochromeLine(col)) monochromeCount++;
    });

    // animate then clear
    const cellsToAnimate = [];
    fullRows.forEach(r => { for (let c = 0; c < BOARD_SIZE; c++) cellsToAnimate.push([r, c]); });
    fullCols.forEach(c => { for (let r = 0; r < BOARD_SIZE; r++) cellsToAnimate.push([r, c]); });
    cellsToAnimate.forEach(([r, c]) => {
      const el = boardEl.children[r * BOARD_SIZE + c];
      if (el) el.classList.add("clearing");
    });

    const n = fullRows.length + fullCols.length;
    setTimeout(() => {
      fullRows.forEach(r => { for (let c = 0; c < BOARD_SIZE; c++) board[r][c] = null; });
      fullCols.forEach(c => { for (let r = 0; r < BOARD_SIZE; r++) board[r][c] = null; });
      renderBoard();
      busy = false;
    }, 320);

    return { cleared: n, monochromeCount };
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------
  function tileUrl(character) {
    return `assets/tile-${character}.png`;
  }

  // Builds the 64 cell <div>s once per board-state change (placement, clear,
  // new game). Each cell's click/hover listeners are attached exactly once
  // here and never torn down — hover previews are handled separately by
  // toggling classes on these same persistent nodes (see showPreview /
  // clearPreview below), so a stationary hand of pieces moving over the
  // board never triggers a DOM rebuild. Rebuilding on every hover was the
  // original bug: it destroyed the very cell under the pointer mid-gesture,
  // which is what made placement clicks unreliable and made the board feel
  // like it "crashed" during normal mouse movement.
  function renderBoard() {
    boardEl.innerHTML = "";
    previewedCells = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const div = document.createElement("div");
        div.className = "cell";
        const val = board[r][c];
        if (val) {
          div.classList.add("filled");
          div.style.backgroundImage = `url(${tileUrl(val)})`;
        }
        div.addEventListener("click", () => onCellClick(r, c));
        div.addEventListener("mouseenter", () => onCellHover(r, c));
        boardEl.appendChild(div);
      }
    }
  }

  function clearPreview() {
    previewedCells.forEach(([r, c]) => {
      const el = boardEl.children[r * BOARD_SIZE + c];
      if (el) el.classList.remove("preview-ok", "preview-bad");
    });
    previewedCells = [];
  }

  function showPreview(cells, valid) {
    clearPreview();
    const cls = valid ? "preview-ok" : "preview-bad";
    cells.forEach(([r, c]) => {
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return;
      const el = boardEl.children[r * BOARD_SIZE + c];
      if (el) el.classList.add(cls);
    });
    previewedCells = cells;
  }

  function renderTray() {
    trayEl.innerHTML = "";
    tray.forEach((piece, idx) => {
      const slot = document.createElement("div");
      slot.className = "tray-slot";
      if (!piece) {
        slot.classList.add("used");
        trayEl.appendChild(slot);
        return;
      }
      if (idx === selectedIdx) slot.classList.add("selected");
      if (!anyPlacement(piece.shape)) slot.classList.add("no-fit");

      const { rows, cols } = shapeBounds(piece.shape);
      const grid = document.createElement("div");
      grid.className = "piece-grid";
      grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
      const filled = new Set(piece.shape.map(([r, c]) => `${r},${c}`));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cell = document.createElement("div");
          if (filled.has(`${r},${c}`)) {
            cell.className = "piece-cell";
            cell.style.backgroundImage = `url(${tileUrl(piece.character)})`;
          } else {
            cell.className = "piece-cell empty";
          }
          grid.appendChild(cell);
        }
      }
      slot.appendChild(grid);
      slot.addEventListener("click", () => onTraySelect(idx));
      trayEl.appendChild(slot);
    });
  }

  function onTraySelect(idx) {
    if (busy || !tray[idx]) return;
    selectedIdx = selectedIdx === idx ? -1 : idx;
    clearPreview();
    renderTray();
  }

  function onCellHover(r, c) {
    if (busy || selectedIdx < 0 || !tray[selectedIdx]) return;
    const piece = tray[selectedIdx];
    const cells = piece.shape.map(([dr, dc]) => [r + dr, c + dc]);
    const valid = canPlaceAt(piece.shape, r, c);
    showPreview(cells, valid);
  }

  function onCellClick(r, c) {
    if (!gameActive || busy || selectedIdx < 0 || !tray[selectedIdx]) return;
    const piece = tray[selectedIdx];
    if (!canPlaceAt(piece.shape, r, c)) {
      sfx.bad();
      return;
    }
    clearPreview();
    placeAt(piece.shape, piece.character, r, c);
    score += piece.shape.length;
    sfx.place();
    tray[selectedIdx] = null;
    selectedIdx = -1;

    if (tray.every(p => p === null)) refillTray();
    renderTray();
    renderBoard();

    const { cleared, monochromeCount } = clearFullLines();
    if (cleared > 0) {
      busy = true;
      score += 10 * cleared * cleared;
      sfx.clear(cleared);
      if (monochromeCount > 0) {
        score += 25 * monochromeCount;
        setTimeout(() => sfx.monochrome(), 120);
      }
    }
    updateHud();

    // deadlock check (delay slightly so the clear animation has settled)
    setTimeout(checkDeadlock, 350);
  }

  function checkDeadlock() {
    if (!gameActive) return;
    const remaining = tray.filter(p => p !== null);
    const stuck = remaining.length > 0 && remaining.every(p => !anyPlacement(p.shape));
    if (stuck) endGame("deadlock");
  }

  function updateHud() {
    scoreEl.textContent = score;
  }

  // ------------------------------------------------------------------
  // Song timer
  // ------------------------------------------------------------------
  function updateSongBar() {
    if (!bgm.duration || isNaN(bgm.duration)) return;
    const remaining = Math.max(0, 1 - bgm.currentTime / bgm.duration);
    songBarEl.style.width = `${remaining * 100}%`;
    songBarEl.classList.toggle("low", remaining < 0.2);
  }

  // ------------------------------------------------------------------
  // Game lifecycle
  // ------------------------------------------------------------------
  function startGame() {
    playerName = nameInput.value.trim() || "名無しメンバー";
    board = createEmptyBoard();
    score = 0;
    selectedIdx = -1;
    gameActive = true;
    refillTray();
    updateHud();
    hudPlayerEl.textContent = playerName;
    renderBoard();
    renderTray();
    showScreen("game");

    bgm.currentTime = 0;
    bgm.play().catch(() => { /* needs user gesture on some browsers; button click covers it */ });
    songBarEl.style.width = "100%";
    songBarEl.classList.remove("low");
  }

  function endGame(reason) {
    if (!gameActive) return;
    gameActive = false;
    bgm.pause();
    sfx.gameover();
    saveScore(playerName, score);
    finalScoreEl.textContent = score;
    overTitleEl.textContent = reason === "song" ? "曲終了!" : "詰み!";
    overReasonEl.textContent = reason === "song"
      ? "曲が終わりました。お疲れさまでした。"
      : "ブロックがどこにも置けなくなりました。";
    rememberRecent(playerName);
    renderLeaderboardQuickNames();
    showScreen("over");
  }

  function rememberRecent(name) {
    let list = JSON.parse(localStorage.getItem(RECENT_NAMES_KEY) || "[]");
    list = [name, ...list.filter(n => n !== name)].slice(0, 6);
    localStorage.setItem(RECENT_NAMES_KEY, JSON.stringify(list));
  }

  bgm.addEventListener("timeupdate", updateSongBar);
  bgm.addEventListener("ended", () => endGame("song"));

  // ------------------------------------------------------------------
  // Leaderboard
  // ------------------------------------------------------------------
  function loadLeaderboard() {
    return JSON.parse(localStorage.getItem(LEADERBOARD_KEY) || "[]");
  }
  function saveScore(name, s) {
    const list = loadLeaderboard();
    list.push({ name, score: s, date: new Date().toISOString().slice(0, 10) });
    list.sort((a, b) => b.score - a.score);
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(list.slice(0, LEADERBOARD_MAX)));
  }
  function renderLeaderboard() {
    const list = loadLeaderboard();
    leaderboardEl.innerHTML = "";
    if (list.length === 0) {
      leaderboardEl.innerHTML = `<li class="lb-empty">まだ記録がありません。最初の1位を目指そう!</li>`;
      return;
    }
    list.forEach((entry, i) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="rank">${i + 1}</span>
        <span class="lb-name">${escapeHtml(entry.name)}</span>
        <span class="lb-score">${entry.score}</span>
      `;
      leaderboardEl.appendChild(li);
    });
  }
  function renderLeaderboardQuickNames() {
    const names = JSON.parse(localStorage.getItem(RECENT_NAMES_KEY) || "[]");
    quickNamesEl.innerHTML = "";
    names.forEach(n => {
      const chip = document.createElement("span");
      chip.className = "quick-name-chip";
      chip.textContent = n;
      chip.addEventListener("click", () => { nameInput.value = n; });
      quickNamesEl.appendChild(chip);
    });
  }
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ------------------------------------------------------------------
  // Wire up buttons
  // ------------------------------------------------------------------
  document.getElementById("btn-start").addEventListener("click", startGame);
  document.getElementById("btn-again").addEventListener("click", () => {
    nameInput.value = "";
    renderLeaderboardQuickNames();
    showScreen("title");
  });
  document.getElementById("btn-show-board").addEventListener("click", () => {
    renderLeaderboard();
    showScreen("board");
  });
  document.getElementById("btn-board").addEventListener("click", () => {
    renderLeaderboard();
    showScreen("board");
  });
  document.getElementById("btn-board-back").addEventListener("click", () => showScreen("title"));
  boardEl.addEventListener("mouseleave", clearPreview);
  document.getElementById("btn-board-clear").addEventListener("click", () => {
    if (confirm("ランキングの記録を全部消します。よろしいですか？")) {
      localStorage.removeItem(LEADERBOARD_KEY);
      renderLeaderboard();
    }
  });

  renderLeaderboardQuickNames();
  showScreen("title");
})();
