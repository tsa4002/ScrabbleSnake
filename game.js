// at the top, before anything else
const bgMusic = new Audio('sound_effects/background_arcade_music.wav');
bgMusic.loop   = true;
bgMusic.volume = 0.50;

// Sound controls
let isMuted = false;
const activeSfx = new Set();

MIN_CHALLENGE_WORD_LENGTH = 3;
MAX_CHALLENGE_WORD_LENGTH = 7;
MAX_DUPLICATES = 2;

let challengeTime     = 40;    // seconds
let currentTimer      = challengeTime;
let challengeInterval = null;
let timerAnimationTimeout = null;
let challengeActive = false;
let challengeGeneration = 0;
const timerDisplay    = document.getElementById('timerDisplay');

let lives = 3;
const lifeContainer = document.getElementById('lifeContainer');

const LETTER_SPAWN_RATE = 10;
const LETTER_SPAWN_RADIUS = 7;  // How far letters are in the arena

const barrierWiggles = [];  // each { x, y, letter, frame }

// --- Audio SFX & Unlock ---
const sfxLetter       = new Audio('sound_effects/letter_pickup.wav');
const sfxSubmit       = new Audio('sound_effects/accepted_submission.wav');
const sfxCrash        = new Audio('sound_effects/word_scatter.wav');
const sfxHeartLost    = new Audio('sound_effects/lost_heart.wav');
const sfxHeartsRefill = new Audio('sound_effects/hearts_refill.wav');

function playSfx(sfx) {
  if (isMuted) return;

  const clip = sfx.cloneNode();
  clip.currentTime = 0;
  clip.muted = isMuted;
  activeSfx.add(clip);

  clip.addEventListener('ended', () => activeSfx.delete(clip), { once: true });
  clip.play().catch(() => activeSfx.delete(clip));
}

function unlockAudio() {
  // Prime the audio elements after the browser receives a user gesture.
  if (!isMuted) {
    [sfxLetter, sfxSubmit, sfxCrash, sfxHeartLost, sfxHeartsRefill].forEach(sfx => {
      sfx.play().catch(() => {});
      sfx.pause();
      sfx.currentTime = 0;
    });

    bgMusic.play().catch(() => {});
  }

  window.removeEventListener('keydown', unlockAudio);
}

// Listen for the first keypress to unlock audio.
window.addEventListener('keydown', unlockAudio);

// --- DOM & Canvas refs ---
const canvas             = document.getElementById('game');
const ctx                = canvas.getContext('2d');
const wordInput          = document.getElementById('wordInput');
const scoreValueEl       = document.getElementById('scoreValue');
const letterInventoryEl  = document.getElementById('letterInventory');
const challengeContainer = document.getElementById('wordChallengeTiles');

// --- Game state ---
let gameSpeed    = 200;
let paused       = false;
let overlayActive = true;
let playerScore  = 0;

// Scrabble bag & points
const letterBag = (
  'A'.repeat(9) + 'B'.repeat(3) + 'C'.repeat(3) +
  'D'.repeat(4) + 'E'.repeat(10) + 'F'.repeat(3) +
  'G'.repeat(3) + 'H'.repeat(3) + 'I'.repeat(9) +
  'J'.repeat(3) + 'K'.repeat(3) + 'L'.repeat(4) + 'M'.repeat(3) +
  'N'.repeat(6) + 'O'.repeat(8) + 'P'.repeat(3) +
  'Q'.repeat(3) + 'R'.repeat(6) + 'S'.repeat(4) + 'T'.repeat(6) +
  'U'.repeat(4) + 'V'.repeat(3) + 'W'.repeat(3) +
  'X'.repeat(3) + 'Y'.repeat(3) + 'Z'.repeat(3)
).split('');

const points = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10
};

// --- Canvas setup ---
const padding = 20;
const tileSize = 20;

let cols, rows;

function resizeCanvas() {
  canvas.width = canvas.parentElement.clientWidth - padding;
  canvas.height = window.innerHeight - padding;

  cols = Math.floor(canvas.width / tileSize);
  rows = Math.floor(canvas.height / tileSize);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function preloadLetters() {
  const totalCells = cols * rows;
  const targetDensity = 0.02;
  const lettersToPlace = Math.floor(totalCells * targetDensity);

  let tries = 0;

  while (
    lettersOnBoard.length < lettersToPlace &&
    tries < lettersToPlace * 5
  ) {
    tries++;

    const x = Math.floor(Math.random() * cols);
    const y = Math.floor(Math.random() * rows);

    if (canPlaceLetter(x, y)) {
      lettersOnBoard.push({
        x,
        y,
        letter: randomLetter()
      });
    }
  }
}

/**
 * Can we place at (x,y)?
 * - Not on the snake
 * - No existing letter exactly there
 * - At most 1 other letter within radius R
 */
function canPlaceLetter(x, y) {
  // Do not spawn on the snake.
  if (snake.some(s => s.x === x && s.y === y)) {
    return false;
  }

  // Do not spawn on another letter.
  if (lettersOnBoard.some(t => t.x === x && t.y === y)) {
    return false;
  }

  // Allow at most 1 neighbor within LETTER_SPAWN_RADIUS.
  let neighbors = 0;

  for (
    let dx = -LETTER_SPAWN_RADIUS;
    dx <= LETTER_SPAWN_RADIUS;
    dx++
  ) {
    for (
      let dy = -LETTER_SPAWN_RADIUS;
      dy <= LETTER_SPAWN_RADIUS;
      dy++
    ) {
      if (
        dx * dx + dy * dy <=
        LETTER_SPAWN_RADIUS * LETTER_SPAWN_RADIUS
      ) {
        if (
          lettersOnBoard.some(
            t => t.x === x + dx && t.y === y + dy
          )
        ) {
          neighbors++;

          if (neighbors > 1) {
            return false;
          }
        }
      }
    }
  }

  return true;
}

// --- Snake & board ---
let snake = [
  { x: 5, y: 5, letter: null }
];

let direction = { x: 1, y: 0 };
let nextDirection = { ...direction };
let lettersOnBoard = [];

// --- Animation state ---
let headBounce = 0;
let glowingTiles = [];

function renderLives() {
  // Assumes lifeContainer has exactly 3 .heart spans.
  Array.from(lifeContainer.children).forEach((heart, i) => {
    heart.classList.toggle('full', i < lives);
    heart.classList.toggle('empty', i >= lives);
  });
}

// --- Word Challenge Data & UI ---
let challengeWords = [];

// Load and filter wordlist.txt via XHR.
function loadChallengeWords(callback) {
  const xhr = new XMLHttpRequest();

  xhr.open('GET', 'wordlist.txt', true);

  xhr.onreadystatechange = () => {
    if (xhr.readyState !== 4) {
      return;
    }

    if (xhr.status === 200) {
      // Split lines, uppercase, keep only A-Z, length 3-7.
      const lines = xhr.responseText.split('\n');

      challengeWords = lines
        .map(w => w.trim().toUpperCase())
        .filter(w => /^[A-Z]+$/.test(w))
        .filter(
          w =>
            w.length >= MIN_CHALLENGE_WORD_LENGTH &&
            w.length <= MAX_CHALLENGE_WORD_LENGTH
        );
    } else {
      console.error('Could not load wordlist.txt; using fallback list.');
      challengeWords = ['DEFAULT', 'WORDS', 'HERE'];
    }

    // Start the game after challengeWords is populated.
    callback();
  };

  xhr.send();
}

// Start the game after the wordlist loads.
loadChallengeWords(() => {
  pickNewChallenge();

  moveInterval = setInterval(moveSnake, gameSpeed);
  setInterval(spawnLetter, LETTER_SPAWN_RATE);

  requestAnimationFrame(drawLoop);
  wordInput.blur();
  paused = false;
});

/**
 * Picks a random challenge from challengeWords.
 */
async function pickNewChallenge() {
  // Keep the timer stopped until the new challenge has finished dropping in.
  stopChallengeTimer();
  const thisChallenge = ++challengeGeneration;

  const pool = challengeWords.filter(w => {
    if (
      w.length < MIN_CHALLENGE_WORD_LENGTH ||
      w.length > MAX_CHALLENGE_WORD_LENGTH
    ) {
      return false;
    }

    const counts = {};

    for (const ch of w) {
      counts[ch] = (counts[ch] || 0) + 1;

      if (counts[ch] > MAX_DUPLICATES) {
        return false;
      }
    }

    return true;
  });

  if (pool.length === 0) {
    console.error('No valid challenge words found.');
    currentChallenge = 'WORD';
  } else {
    currentChallenge = pool[
      Math.floor(Math.random() * pool.length)
    ];
  }

  renderChallenge();

  // Reset the bar visually, but do not start its countdown yet.
  const timerFill = document.getElementById('timerFill');
  if (timerFill) {
    timerFill.style.transition = 'none';
    timerFill.style.width = '100%';
  }

  await animateChallengeDrop();

  // Ignore an older animation if a newer challenge has already been picked.
  if (thisChallenge !== challengeGeneration) return;

  startChallengeTimer();
}

async function handleChallengeTimeout() {
  // 1. Lose one life.
  lives = Math.max(0, lives - 1);
  renderLives();

  playSfx(sfxHeartLost);

  // 2. Apply penalty for the missed word.
  const penalty = currentChallenge
    .split('')
    .reduce((sum, ch) => sum + (points[ch] || 0), 0);

  playerScore -= penalty;
  scoreValueEl.textContent = playerScore;

  // 3. If out of lives, drop the inventory, freeze, refill, and teleport.
  if (lives === 0) {
    // Snapshot the current tail segments.
    const oldTail = snake.slice(1);

    // Deduct inventory points.
    let invPenalty = 0;

    oldTail.forEach(seg => {
      if (seg.letter) {
        invPenalty += points[seg.letter] || 0;
      }
    });

    playerScore -= invPenalty;
    scoreValueEl.textContent = playerScore;

    // Spill each letter onto the board at its segment's position.
    oldTail.forEach(seg => {
      if (seg.letter) {
        lettersOnBoard.push({
          x: seg.x,
          y: seg.y,
          letter: seg.letter
        });
      }
    });

    // Clear the snake to just the head.
    snake = [
      {
        x: snake[0].x,
        y: snake[0].y,
        letter: null
      }
    ];

    updateInventory();

    // Stop movement.
    paused = true;
    clearTimeout(challengeInterval);

    // Freeze the CSS timer bar.
    const fill = document.getElementById('timerFill');
    if (fill) {
      fill.style.transition = 'none';
      fill.style.width = '0%';
    }

    // Animate hearts refilling evenly over 2 seconds.
    const emptyHearts = Array.from(
      document.querySelectorAll('#lifeContainer .heart.empty')
    );

    const refillInterval = 2000 / emptyHearts.length;

    emptyHearts.forEach((heart, i) => {
      setTimeout(() => {
        heart.classList.replace('empty', 'full');
      }, refillInterval * (i + 1));
    });

    // After 2 seconds, teleport, reset lives, and resume.
    setTimeout(() => {
      playSfx(sfxHeartsRefill);

      // Teleport the head to a random free cell.
      const free = [];

      for (let x = 0; x < cols; x++) {
        for (let y = 0; y < rows; y++) {
          if (
            !lettersOnBoard.some(t => t.x === x && t.y === y) &&
            !(x === snake[0].x && y === snake[0].y)
          ) {
            free.push({ x, y });
          }
        }
      }

      if (free.length) {
        const p = free[Math.floor(Math.random() * free.length)];

        snake[0].x = p.x;
        snake[0].y = p.y;
      }

      // Reset lives to full and render.
      lives = 3;
      renderLives();

      // Resume movement and start a new challenge.
      paused = false;
      pickNewChallenge();
    }, 2000);

    return;
  }

  // Otherwise, drop the challenge tiles and pick a new one.
  await animateChallengeFall();
  pickNewChallenge();
}

function stopChallengeTimer() {
  // Mark the challenge as resolved.
  challengeActive = false;

  // Cancel the JavaScript countdown.
  clearTimeout(challengeInterval);
  challengeInterval = null;

  // Cancel any pending timer animation start.
  clearTimeout(timerAnimationTimeout);
  timerAnimationTimeout = null;

  // Freeze the timer bar at its current position.
  const timerFill = document.getElementById('timerFill');

  if (timerFill) {
    const currentWidth = window.getComputedStyle(timerFill).width;

    timerFill.style.transition = 'none';
    timerFill.style.width = currentWidth;
  }
}

function startChallengeTimer() {
  // Clear any previous timers before starting this challenge.
  clearTimeout(challengeInterval);
  clearTimeout(timerAnimationTimeout);

  challengeInterval = null;
  timerAnimationTimeout = null;
  challengeActive = true;

  const timerFill = document.getElementById('timerFill');

  if (timerFill) {
    timerFill.style.transition = 'none';
    timerFill.style.width = '100%';
  }

  // Start the visual bar and JavaScript deadline at the same moment.
  timerAnimationTimeout = setTimeout(() => {
    timerAnimationTimeout = null;

    if (!challengeActive) return;

    if (timerFill) {
      timerFill.style.transition = `width ${challengeTime}s linear`;
      timerFill.style.width = '0%';
    }

    challengeInterval = setTimeout(() => {
      if (!challengeActive) return;

      stopChallengeTimer();
      handleChallengeTimeout();
    }, challengeTime * 1000);
  }, 50);
}

function renderChallenge() {
  challengeContainer.innerHTML = '';

  currentChallenge.split('').forEach(letter => {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.textContent = letter;

    const pt = document.createElement('div');
    pt.className = 'tile-points';
    pt.textContent = points[letter] || '';

    tile.appendChild(pt);
    challengeContainer.appendChild(tile);
  });
}

// Drop-in animation for new challenge tiles.
async function animateChallengeDrop() {
  const tiles = Array.from(challengeContainer.children);

  tiles.forEach((tile, i) => {
    tile.style.transform = 'translateY(-100px)';
    tile.style.opacity = '0';

    setTimeout(() => {
      tile.style.transition = 'transform 0.5s ease, opacity 0.5s ease';
      tile.style.transform = 'translateY(0)';
      tile.style.opacity = '1';
    }, i * 100);
  });

  const animationDuration = tiles.length
    ? (tiles.length - 1) * 100 + 500
    : 0;

  await new Promise(resolve => setTimeout(resolve, animationDuration));
}

// --- Inventory Rendering ---
function updateInventory() {
  letterInventoryEl.innerHTML = '';

  const counts = {};

  snake.slice(1).forEach(s => {
    if (s.letter) {
      counts[s.letter] = (counts[s.letter] || 0) + 1;
    }
  });

  Object.entries(counts).forEach(([L, c]) => {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.textContent = L;

    const pt = document.createElement('div');
    pt.className = 'tile-points';
    pt.textContent = points[L];

    tile.appendChild(pt);

    if (c > 1) {
      const cb = document.createElement('div');
      cb.className = 'tile-count';
      cb.textContent = c;
      tile.appendChild(cb);
    }

    letterInventoryEl.appendChild(tile);
  });

  scoreValueEl.textContent = playerScore;
}

updateInventory();

// --- Controls ---
document.addEventListener('keydown', e => {
  // M toggles sound anywhere except while the user is typing in a field.
  const target = e.target;
  const isTypingInField = document.activeElement === wordInput || (
    target instanceof HTMLElement && (
      target.matches('input, textarea, select') ||
      target.isContentEditable ||
      Boolean(target.closest('[contenteditable="true"]'))
    )
  );

  if (
    e.key.toLowerCase() === 'm' &&
    !e.repeat &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !isTypingInField
  ) {
    e.preventDefault();
    toggleMute();
    return;
  }

  if (
    overlayActive &&
    ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)
  ) {
    document.getElementById('startOverlay').style.display = 'none';
    overlayActive = false;
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    wordInput.focus();
    return;
  }

  if (paused) {
    return;
  }

  if (e.key === 'ArrowUp' && direction.y === 0) {
    nextDirection = { x: 0, y: -1 };
  }

  if (e.key === 'ArrowDown' && direction.y === 0) {
    nextDirection = { x: 0, y: 1 };
  }

  if (e.key === 'ArrowLeft' && direction.x === 0) {
    nextDirection = { x: -1, y: 0 };
  }

  if (e.key === 'ArrowRight' && direction.x === 0) {
    nextDirection = { x: 1, y: 0 };
  }
});

wordInput.addEventListener('focus', () => paused = true);
wordInput.addEventListener('blur', () => paused = false);

wordInput.addEventListener('keydown', async e => {
  if (e.key === 'Enter') {
    e.preventDefault();

    await handleWordSubmission(
      wordInput.value.trim().toUpperCase()
    );

    wordInput.value = '';
    updateInventory();
    wordInput.blur();
  }
});

// --- Snake Movement ---
function moveSnake() {
  if (paused) {
    return;
  }

  const newX = snake[0].x + nextDirection.x;
  const newY = snake[0].y + nextDirection.y;

  // --- Barrier letter check ---
  const idx = lettersOnBoard.findIndex(
    t => t.x === newX && t.y === newY
  );

  if (idx !== -1) {
    const L = lettersOnBoard[idx].letter;
    const haveCount = snake.slice(1).filter(
      s => s.letter === L
    ).length;

    if (haveCount >= 2) {
      // Too many of this letter: treat it as a barrier.
      barrierWiggles.push({
        x: newX,
        y: newY,
        letter: L,
        frame: 0
      });

      return;
    } else {
      // Pick up the letter.
      lettersOnBoard.splice(idx, 1);
      playSfx(sfxLetter);
      headBounce = 15;

      const tail = snake[snake.length - 1];

      snake.push({
        x: tail.x,
        y: tail.y,
        letter: L
      });

      updateInventory();
    }
  }

  // --- Move the snake forward ---
  direction = nextDirection;

  for (let i = snake.length - 1; i > 0; i--) {
    snake[i].x = snake[i - 1].x;
    snake[i].y = snake[i - 1].y;
  }

  snake[0].x = newX;
  snake[0].y = newY;

  // --- Self collision ---
  for (let i = 1; i < snake.length; i++) {
    if (snake[i].x === newX && snake[i].y === newY) {
      playSfx(sfxCrash);

      const oldTail = snake.slice(1);

      paused = true;

      triggerInventoryLossAnimation().then(() => {
        oldTail.forEach(seg => {
          if (seg.letter) {
            lettersOnBoard.push({
              x: seg.x,
              y: seg.y,
              letter: seg.letter
            });
          }
        });

        snake = [{
          x: newX,
          y: newY,
          letter: null
        }];

        updateInventory();
        paused = false;
      });

      return;
    }
  }
}

// --- Drawing ---
function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const offX = canvas.width / 2 - snake[0].x * tileSize;
  const offY = canvas.height / 2 - snake[0].y * tileSize;

  ctx.setTransform(1, 0, 0, 1, offX, offY);

  glowingTiles = glowingTiles.filter(g => {
    const alpha = Math.max(0, Math.min(1, g.frames / 10));

    ctx.save();
    ctx.shadowColor = `rgba(255,255,255,${alpha})`;
    ctx.shadowBlur = 15;
    ctx.fillStyle = `rgba(255,255,255,${alpha * 0.3})`;
    ctx.fillRect(
      g.x * tileSize,
      g.y * tileSize,
      tileSize,
      tileSize
    );
    ctx.restore();

    g.frames--;
    return g.frames > 0;
  });

  snake.forEach((seg, i) => {
    let px = seg.x * tileSize;
    let py = seg.y * tileSize;
    let size = tileSize - 2;

    if (i === 0 && headBounce > 0) {
      const sc = 1 + 0.1 * (headBounce / 5);
      const ds = size * (sc - 1);

      px -= ds / 2;
      py -= ds / 2;
      size += ds;
      headBounce--;
    }

    ctx.fillStyle = '#ffe6a8';
    ctx.fillRect(px, py, size, size);

    if (seg.letter) {
      ctx.fillStyle = 'black';
      ctx.font = `${tileSize - 6}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.fillText(
        seg.letter,
        px + size / 2,
        py + size / 2
      );
    }
  });

  ctx.fillStyle = 'white';
  ctx.font = `${tileSize - 4}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  lettersOnBoard.forEach(t => {
    const wiggle = barrierWiggles.find(
      b => b.x === t.x && b.y === t.y
    );

    let offsetX = 0;

    if (wiggle) {
      const wigglePhase = wiggle.frame / 10;
      offsetX = Math.sin(wigglePhase * Math.PI * 4) * 3;
      wiggle.frame++;

      if (wiggle.frame > 10) {
        const idx = barrierWiggles.indexOf(wiggle);

        if (idx !== -1) {
          barrierWiggles.splice(idx, 1);
        }
      }
    }

    ctx.fillText(
      t.letter,
      t.x * tileSize + tileSize / 2 + offsetX,
      t.y * tileSize + tileSize / 2
    );
  });
}

function drawLoop() {
  draw();
  requestAnimationFrame(drawLoop);
}

// --- Letter Spawning ---
function spawnLetter() {
  const R = 50;
  const hx = snake[0].x;
  const hy = snake[0].y;
  const L = letterBag[
    Math.floor(Math.random() * letterBag.length)
  ];

  // Pick a random spot in the R-radius square.
  const x = Math.floor(hx - R + Math.random() * (2 * R + 1));
  const y = Math.floor(hy - R + Math.random() * (2 * R + 1));

  // Only place if it passes our spacing rules.
  if (canPlaceLetter(x, y)) {
    lettersOnBoard.push({ x, y, letter: L });
  }
}

// --- Inventory-Loss Animation ---
async function triggerInventoryLossAnimation() {
  letterInventoryEl.classList.add('shake');

  await new Promise(r => setTimeout(r, 600));

  const tiles = Array.from(letterInventoryEl.children);

  tiles.forEach(t => {
    setTimeout(() => t.classList.add('fall'), Math.random() * 300);
  });

  await new Promise(r => setTimeout(r, 1400));

  let deduction = 0;

  tiles.forEach(t => {
    const L = t.textContent.trim()[0];
    const cnt = parseInt(
      t.querySelector('.tile-count')?.textContent || '1',
      10
    );

    deduction += (points[L] || 0) * cnt;
  });

  playerScore -= deduction;

  letterInventoryEl.classList.remove('shake');
  letterInventoryEl.innerHTML = '';

  scoreValueEl.textContent = playerScore;
}

// --- Word Submission & Scoring ---
async function handleWordSubmission(input) {
  if (!input || !challengeActive) {
    return;
  }

  // Only the exact challenge word is acceptable.
  if (input !== currentChallenge) {
    flashInputError();
    return;
  }

  // Build a list of body segments, skipping the head.
  const body = snake.slice(1);
  const pairs = body.map((s, i) => ({
    letter: s.letter,
    index: i + 1
  }));

  const used = [];

  for (const ch of input) {
    const m = pairs.find(
      p => p.letter === ch && !used.includes(p.index)
    );

    if (!m) {
      flashInputError();
      return;
    }

    used.push(m.index);
  }

  stopChallengeTimer();

  // Remove and reposition segments.
  const oldPos = snake.map(s => ({
    x: s.x,
    y: s.y
  }));

  used.sort((a, b) => b - a).forEach(i => {
    snake.splice(i, 1);
  });

  const kept = oldPos
    .map((_, i) => i)
    .filter(i => !used.includes(i));

  for (let i = 1; i < snake.length; i++) {
    const oi = kept[i];

    snake[i].x = oldPos[oi].x;
    snake[i].y = oldPos[oi].y;
  }

  // Score and feedback.
  updateInventory();

  let wordScore = 0;

  for (const ch of input) {
    wordScore += points[ch] || 0;
  }

  playerScore += wordScore;

  playSfx(sfxSubmit);
  flashInputSuccess();

  // Animate challenge tiles falling and pick a new challenge.
  await animateChallengeFall();
  pickNewChallenge();
}

// --- Animate challenge tiles falling ---
async function animateChallengeFall() {
  const tiles = Array.from(challengeContainer.children);

  tiles.forEach((t, i) => {
    setTimeout(() => t.classList.add('fall'), i * 100);
  });

  await new Promise(r => setTimeout(r, tiles.length * 100 + 1600));

  tiles.forEach(t => t.remove());
}

// --- Input Feedback ---
function flashInputSuccess() {
  wordInput.classList.add('success');

  setTimeout(() => {
    wordInput.classList.remove('success');
  }, 600);
}

function flashInputError() {
  wordInput.classList.add('error');

  setTimeout(() => {
    wordInput.classList.remove('error');
  }, 400);
}

renderLives();

// =========================================================================
// GAME CONTROL BUTTONS
// These handlers expect resetButton, muteButton/muteIcon, and shareButton
// in the HTML.
// =========================================================================

// RESET BUTTON
const resetButton = document.getElementById('resetButton');

function handleResetButton() {
  // Reloading clears the score, lives, timers, board, and challenge state.
  window.location.reload();
}

if (resetButton) {
  resetButton.addEventListener('click', handleResetButton);
}

// MUTE BUTTON AND M KEYBOARD SHORTCUT
const muteButton = document.getElementById('muteButton');
const muteIcon = document.getElementById('muteIcon');

const soundOnIcon = `
  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
  <path d="M15.5 8.5a5 5 0 0 1 0 7"/>
  <path d="M19 5a10 10 0 0 1 0 14"/>
`;

const soundOffIcon = `
  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
  <path d="m17 9 5 6"/>
  <path d="m22 9-5 6"/>
`;

function updateMuteButton() {
  if (muteIcon) {
    muteIcon.innerHTML = isMuted ? soundOffIcon : soundOnIcon;
  }

  if (muteButton) {
    const label = isMuted ? 'Unmute sound (M)' : 'Mute sound (M)';
    muteButton.title = label;
    muteButton.setAttribute('aria-label', label);
    muteButton.setAttribute('aria-pressed', String(isMuted));
    muteButton.setAttribute('aria-keyshortcuts', 'M');
  }
}

function toggleMute() {
  isMuted = !isMuted;
  bgMusic.muted = isMuted;

  // Also mute or unmute any sound effects that are already playing.
  activeSfx.forEach(clip => {
    clip.muted = isMuted;
  });

  if (!isMuted) {
    bgMusic.play().catch(() => {});
  }

  updateMuteButton();
}

function handleMuteButton() {
  toggleMute();
}

if (muteButton) {
  muteButton.addEventListener('click', handleMuteButton);
}

// Set the correct icon and accessible label on initial page load.
updateMuteButton();

// SHARE BUTTON
const shareButton = document.getElementById('shareButton');

async function handleShareButton() {
  const shareData = {
    title: 'Scrabble Snake',
    text: 'Come play Scrabble Snake!',
    url: window.location.href
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(window.location.href);

      shareButton.title = 'Link copied!';
      shareButton.setAttribute('aria-label', 'Link copied!');

      setTimeout(() => {
        shareButton.title = 'Share game';
        shareButton.setAttribute('aria-label', 'Share game');
      }, 2000);

      return;
    }

    window.prompt(
      'Copy this link to share the game:',
      window.location.href
    );
  } catch (error) {
    // Closing the native share sheet is not an error.
    if (error.name !== 'AbortError') {
      console.error('Sharing failed:', error);
    }
  }
}

if (shareButton) {
  shareButton.addEventListener('click', handleShareButton);
}