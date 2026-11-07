(() => {
  'use strict';

  // The shared dictionary lives at the project root. Resolve it from the
  // standalone game page first, then use the path relative to this script.
  const multiplayerScriptUrl = document.currentScript && document.currentScript.src
    ? document.currentScript.src
    : null;
  const WORDLIST_URLS = [...new Set([
    new URL('wordlist.txt', document.baseURI || window.location.href).href,
    ...(multiplayerScriptUrl ? [new URL('../wordlist.txt', multiplayerScriptUrl).href] : [])
  ])];

  // ======================================================================
  // DOUBLE PLAYER CUSTOMIZATION
  // Adjust these values to tune the multiplayer game.
  // ======================================================================
  const CONFIG = {
    tileSize: 20,                 // Grid cell size in pixels
    gameSpeedMs: 200,             // Time between snake moves. Lower = faster
    letterSpawnIntervalMs: 750,   // Time between new letter drops. Lower = more frequent
    letterSpawnRadius: 7,         // Minimum spacing radius used when placing letters
    boardLetterDensity: 0.02,     // Starting board coverage (2% of grid cells)
    minimumBoardLetters: 12,      // Keep at least this many letters available
    minimumWordLength: 3,         // Minimum number of letters required to submit
    snakeOutlineWidth: 1.8,       // Player-color outline thickness around each tile
    feedbackDurationMs: 3000,     // Submission feedback stays visible for 3 seconds
    letterLifetimeMs: 45000,      // Letters disappear after 45 seconds
    letterFadeDurationMs: 10000,  // Fade during the final 10 seconds
    maxMatchDurationSeconds: 600, // Maximum match length: 10 minutes
    matchTimerUpdateMs: 100       // Match timer refresh interval
  };

  // Letter-drop weights. Increase a letter's number to make it appear more
  // often, decrease it to make it rarer, or set it to 0 to remove it.
  // These are the same letter frequencies used by the current Single Player game.
  const LETTER_DISTRIBUTION = {
    A: 9, B: 3, C: 3, D: 4, E: 10, F: 3, G: 3, H: 3, I: 9,
    J: 3, K: 3, L: 4, M: 3, N: 6, O: 8, P: 3, Q: 3, R: 6,
    S: 4, T: 6, U: 4, V: 3, W: 3, X: 3, Y: 3, Z: 3
  };

  const TILE_SIZE = CONFIG.tileSize;
  const GAME_SPEED = CONFIG.gameSpeedMs;
  const LETTER_SPAWN_RATE = CONFIG.letterSpawnIntervalMs;
  const LETTER_SPAWN_RADIUS = CONFIG.letterSpawnRadius;
  const LETTER_DENSITY = CONFIG.boardLetterDensity;
  const MIN_WORD_LENGTH = CONFIG.minimumWordLength;
  const FEEDBACK_DURATION = CONFIG.feedbackDurationMs;
  const LETTER_LIFETIME = CONFIG.letterLifetimeMs;
  const LETTER_FADE_DURATION = Math.min(CONFIG.letterFadeDurationMs, LETTER_LIFETIME);

  const letterBag = Object.entries(LETTER_DISTRIBUTION)
    .flatMap(([letter, count]) => Array(Math.max(0, count)).fill(letter));

  const points = {
    A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
    K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
    U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10
  };

  const players = [
    {
      id: 1,
      name: 'Player 1',
      accent: '#d7a83e',
      snake: [],
      direction: { x: 1, y: 0 },
      nextDirection: { x: 1, y: 0 },
      score: 0,
      words: [],
      headBounce: 0,
      feedback: '',
      feedbackTimeout: null
    },
    {
      id: 2,
      name: 'Player 2',
      accent: '#65afb4',
      snake: [],
      direction: { x: -1, y: 0 },
      nextDirection: { x: -1, y: 0 },
      score: 0,
      words: [],
      headBounce: 0,
      feedback: '',
      feedbackTimeout: null
    }
  ];

  const gameScreen = document.getElementById('multiGameScreen');
  const canvas = document.getElementById('multiGameCanvas');
  const ctx = canvas.getContext('2d');
  const arena = document.getElementById('multiGameArena');
  const startOverlay = document.getElementById('multiStartOverlay');
  const startButton = document.getElementById('multiStartButton');
  const dictionaryStatus = document.getElementById('multiDictionaryStatus');
  const matchDurationInput = document.getElementById('multiMatchDuration');
  const matchMinutesInput = document.getElementById('multiMatchMinutes');
  const matchSecondsInput = document.getElementById('multiMatchSeconds');
  const matchDurationError = document.getElementById('multiMatchDurationError');
  const matchDurationControl = document.querySelector('.multi-duration-control');
  const durationHomeSlot = document.getElementById('multiDurationHomeSlot');
  const resultsDurationSlot = document.getElementById('multiResultsDurationSlot');
  const resultsOverlay = document.getElementById('multiResultsOverlay');
  const resultsStartButton = document.getElementById('multiResultsStartButton');
  const matchTimer = document.getElementById('multiMatchTimer');
  const matchTimerFill = document.getElementById('multiMatchTimerFill');
  const pauseButton = document.getElementById('multiPauseButton');
  const lettersOnBoard = [];
  const barrierWiggles = [];

  let cols = 0;
  let rows = 0;
  let targetLetterCount = 0;
  let acceptedWords = new Set();
  let dictionaryLoaded = false;
  let dictionaryLoading = null;
  let gameRunning = false;
  let gamePaused = false;
  let gameStarted = false;
  let gameInterval = null;
  let spawnInterval = null;
  let matchTimerInterval = null;
  let matchDurationMs = 0;
  let remainingMatchMs = 0;
  let matchHasEnded = false;
  let matchEndTime = 0;
  let pausedAt = 0;
  let animationFrame = null;
  let listenersBound = false;
  let isMuted = false;
  let pauseOverlay = null;

  const bgMusic = new Audio('sound_effects/background_arcade_music.wav');
  bgMusic.loop = true;
  bgMusic.volume = 0.5;

  const sfxLetter = new Audio('sound_effects/letter_pickup.wav');
  const sfxSubmit = new Audio('sound_effects/accepted_submission.wav');
  const sfxCrash = new Audio('sound_effects/word_scatter.wav');
  const sfxErrorSubmission = new Audio('sound_effects/error_submisson.wav');
  const sfxGameOver = new Audio('sound_effects/game_over.wav');
  const activeSfx = new Set();

  function playSfx(source) {
    if (isMuted) return;
    const clip = source.cloneNode();
    clip.currentTime = 0;
    clip.muted = isMuted;
    activeSfx.add(clip);
    clip.addEventListener('ended', () => activeSfx.delete(clip), { once: true });
    clip.play().catch(() => activeSfx.delete(clip));
  }

  function parseDictionary(contents) {
    // Accept the existing one-word-per-line format, while also tolerating
    // whitespace/comma-separated text and a UTF-8 byte-order mark.
    const normalized = contents.replace(/^\uFEFF/, '').toUpperCase();
    const tokens = normalized.match(/[A-Z]+/g) || [];
    return new Set(tokens.filter(word => word.length >= MIN_WORD_LENGTH));
  }

  async function fetchDictionaryFrom(url) {
    const controller = typeof AbortController !== 'undefined'
      ? new AbortController()
      : null;
    const timeoutId = setTimeout(() => {
      if (controller) controller.abort();
    }, 15000);

    try {
      const options = { cache: 'no-store' };
      if (controller) options.signal = controller.signal;

      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} while requesting ${url}`);
      }

      const contents = await response.text();
      if (!contents.trim()) {
        throw new Error(`The file at ${url} is empty.`);
      }
      if (/^\s*(?:<!doctype\s+html|<html[\s>])/i.test(contents)) {
        throw new Error(`The server returned an HTML page instead of wordlist.txt at ${url}`);
      }

      const words = parseDictionary(contents);
      if (!words.size) {
        throw new Error(`No words of at least ${MIN_WORD_LENGTH} letters were found in ${url}`);
      }

      return { words, url };
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new Error(`Timed out after 15 seconds while requesting ${url}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function loadDictionary() {
    if (dictionaryLoaded) return Promise.resolve();
    if (dictionaryLoading) return dictionaryLoading;

    dictionaryStatus.textContent = 'Loading word list...';
    startButton.disabled = true;

    dictionaryLoading = (async () => {
      const failures = [];

      for (const url of WORDLIST_URLS) {
        try {
          const result = await fetchDictionaryFrom(url);
          acceptedWords = result.words;
          dictionaryLoaded = true;
          dictionaryStatus.textContent = `${acceptedWords.size.toLocaleString()} words loaded`;
          dictionaryStatus.title = `Loaded from ${result.url}`;
          updateStartButtonState();
          return;
        } catch (error) {
          failures.push(error && error.message ? error.message : String(error));
        }
      }

      throw new Error(failures.join(' | ') || 'No word-list URL could be resolved.');
    })().catch(error => {
      console.error('Could not load wordlist.txt:', error);
      dictionaryStatus.textContent = `Could not load wordlist.txt: ${error.message}`;
      dictionaryStatus.title = WORDLIST_URLS.join('\n');
      updateStartButtonState();
      // Allow initialize() to retry the request if the player leaves and
      // re-enters multiplayer after correcting the file or server path.
      dictionaryLoading = null;
    });

    return dictionaryLoading;
  }

  function resizeCanvas() {
    const rect = arena.getBoundingClientRect();
    const width = Math.max(TILE_SIZE * 8, Math.floor(rect.width));
    const height = Math.max(TILE_SIZE * 8, Math.floor(rect.height));

    canvas.width = width;
    canvas.height = height;
    cols = Math.max(8, Math.floor(width / TILE_SIZE));
    rows = Math.max(8, Math.floor(height / TILE_SIZE));
    targetLetterCount = Math.max(CONFIG.minimumBoardLetters, Math.floor(cols * rows * LETTER_DENSITY));

    if (gameStarted) {
      players.forEach(player => {
        if (player.snake.some(segment =>
          segment.x < 0 || segment.x >= cols || segment.y < 0 || segment.y >= rows
        )) {
          const cell = findFreeCell();
          if (cell) player.snake = [{ ...cell, letter: null }];
        }
      });

      for (let i = lettersOnBoard.length - 1; i >= 0; i--) {
        const tile = lettersOnBoard[i];
        if (tile.x < 0 || tile.x >= cols || tile.y < 0 || tile.y >= rows) {
          lettersOnBoard.splice(i, 1);
        }
      }
    }
  }

  function allSnakeSegments() {
    return players.flatMap(player => player.snake);
  }

  function cellHasSnake(x, y) {
    return allSnakeSegments().some(segment => segment.x === x && segment.y === y);
  }

  function cellHasLetter(x, y) {
    return lettersOnBoard.some(tile => tile.x === x && tile.y === y);
  }

  function isCellFree(x, y) {
    return x >= 0 && x < cols && y >= 0 && y < rows &&
      !cellHasSnake(x, y) && !cellHasLetter(x, y);
  }

  function findFreeCell(preferredX = null, preferredY = null) {
    if (preferredX !== null && preferredY !== null && isCellFree(preferredX, preferredY)) {
      return { x: preferredX, y: preferredY };
    }

    for (let attempt = 0; attempt < 700; attempt++) {
      const x = Math.floor(Math.random() * cols);
      const y = Math.floor(Math.random() * rows);
      if (isCellFree(x, y)) return { x, y };
    }

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (isCellFree(x, y)) return { x, y };
      }
    }
    return null;
  }

  function resetPlayers() {
    players.forEach(player => {
      clearPlayerFeedback(player);
      player.score = 0;
      player.words.length = 0;
      player.feedback = '';
      player.headBounce = 0;
      player.direction = player.id === 1 ? { x: 1, y: 0 } : { x: -1, y: 0 };
      player.nextDirection = { ...player.direction };
      player.snake = [];
    });

    const middleY = Math.floor(rows / 2);
    const p1 = findFreeCell(Math.floor(cols * 0.23), middleY) || findFreeCell();
    if (p1) players[0].snake = [{ ...p1, letter: null }];

    const p2 = findFreeCell(Math.floor(cols * 0.77), middleY) || findFreeCell();
    if (p2) players[1].snake = [{ ...p2, letter: null }];

    renderScores();
  }

  function randomLetter() {
    return letterBag[Math.floor(Math.random() * letterBag.length)];
  }

  function createBoardLetter(letter, x, y) {
    return { x, y, letter, createdAt: Date.now() };
  }

  function removeExpiredLetters() {
    const now = Date.now();
    for (let i = lettersOnBoard.length - 1; i >= 0; i--) {
      if (now - (lettersOnBoard[i].createdAt || now) >= LETTER_LIFETIME) {
        lettersOnBoard.splice(i, 1);
      }
    }
  }

  function canPlaceLetter(x, y) {
    if (x < 0 || x >= cols || y < 0 || y >= rows) return false;
    if (cellHasSnake(x, y) || cellHasLetter(x, y)) return false;

    let neighbors = 0;
    for (let dx = -LETTER_SPAWN_RADIUS; dx <= LETTER_SPAWN_RADIUS; dx++) {
      for (let dy = -LETTER_SPAWN_RADIUS; dy <= LETTER_SPAWN_RADIUS; dy++) {
        if (dx * dx + dy * dy > LETTER_SPAWN_RADIUS * LETTER_SPAWN_RADIUS) continue;
        if (cellHasLetter(x + dx, y + dy)) {
          neighbors++;
          if (neighbors > 1) return false;
        }
      }
    }
    return true;
  }

  function preloadLetters() {
    let attempts = 0;
    const maxAttempts = targetLetterCount * 40;
    while (lettersOnBoard.length < targetLetterCount && attempts < maxAttempts) {
      attempts++;
      const x = Math.floor(Math.random() * cols);
      const y = Math.floor(Math.random() * rows);
      if (canPlaceLetter(x, y)) lettersOnBoard.push(createBoardLetter(randomLetter(), x, y));
    }
  }

  function spawnLetter() {
    if (!gameRunning || gamePaused) return;
    removeExpiredLetters();
    if (lettersOnBoard.length >= targetLetterCount) return;

    for (let attempt = 0; attempt < 80; attempt++) {
      const x = Math.floor(Math.random() * cols);
      const y = Math.floor(Math.random() * rows);
      if (canPlaceLetter(x, y)) {
        lettersOnBoard.push(createBoardLetter(randomLetter(), x, y));
        return;
      }
    }
  }

  function placeDroppedLetter(letter, preferredX, preferredY) {
    if (!letter) return;
    if (preferredX < 0 || preferredX >= cols || preferredY < 0 || preferredY >= rows) return;

    // Preserve the exact cell where the segment was cut or dropped. A tile
    // may temporarily sit underneath a snake segment and becomes visible
    // when that segment moves away. Never relocate it to a nearby cell.
    lettersOnBoard.push(createBoardLetter(letter, preferredX, preferredY));
  }

  function dropSegments(segments) {
    segments.forEach(segment => {
      if (segment.letter) placeDroppedLetter(segment.letter, segment.x, segment.y);
    });
  }

  function makeMovePlan(player) {
    const snake = player.snake;
    const head = snake[0];
    const nextX = head.x + player.nextDirection.x;
    const nextY = head.y + player.nextDirection.y;

    if (nextX < 0 || nextX >= cols || nextY < 0 || nextY >= rows) {
      return { player, wall: true, nextHead: { x: nextX, y: nextY }, nextSnake: null, pickupIndex: -1, pickupLetter: null, cutSegments: [] };
    }

    const pickupIndex = lettersOnBoard.findIndex(tile => tile.x === nextX && tile.y === nextY);
    const pickupLetter = pickupIndex >= 0 ? lettersOnBoard[pickupIndex].letter : null;

    // Every body segment moves into the cell previously occupied by the
    // segment in front of it. Picking up a letter adds one new tail segment.
    const moved = [{ x: nextX, y: nextY, letter: null }];
    for (let i = 1; i < snake.length; i++) {
      moved.push({
        x: snake[i - 1].x,
        y: snake[i - 1].y,
        letter: snake[i].letter
      });
    }
    if (pickupLetter) {
      const oldTail = snake[snake.length - 1];
      moved.push({ x: oldTail.x, y: oldTail.y, letter: pickupLetter });
    }

    // A self-collision cuts off the struck segment and everything behind it.
    const hitIndex = moved.findIndex((segment, index) =>
      index > 0 && segment.x === nextX && segment.y === nextY
    );

    let nextSnake = moved;
    let cutSegments = [];
    if (hitIndex > 0) {
      cutSegments = moved.slice(hitIndex);
      nextSnake = moved.slice(0, hitIndex);
    }

    return {
      player,
      wall: false,
      nextHead: { x: nextX, y: nextY },
      nextSnake,
      pickupIndex,
      pickupLetter,
      cutSegments
    };
  }

  function plannedSnake(plan) {
    return plan.nextSnake || plan.player.snake;
  }

  function isHeadToHead(planA, planB) {
    if (planA.wall || planB.wall) return false;
    const sameCell = planA.nextHead.x === planB.nextHead.x && planA.nextHead.y === planB.nextHead.y;
    const swapped = planA.nextHead.x === planB.player.snake[0].x &&
      planA.nextHead.y === planB.player.snake[0].y &&
      planB.nextHead.x === planA.player.snake[0].x &&
      planB.nextHead.y === planA.player.snake[0].y;
    return sameCell || swapped;
  }

  function stepGame() {
    if (!gameRunning || gamePaused) return;
    removeExpiredLetters();

    const plans = players.map(makeMovePlan);
    const dead = new Set();
    const headCollision = isHeadToHead(plans[0], plans[1]);

    plans.forEach((plan, index) => {
      if (plan.wall) dead.add(index);
    });

    if (headCollision) {
      dead.add(0);
      dead.add(1);
    } else {
      plans.forEach((plan, index) => {
        const otherPlan = plans[1 - index];
        if (plan.wall || otherPlan.wall) return;
        const otherBody = plannedSnake(otherPlan).slice(1);
        if (otherBody.some(segment =>
          segment.x === plan.nextHead.x && segment.y === plan.nextHead.y
        )) {
          dead.add(index);
        }
      });
    }

    // A dead player loses the letters they had before this tick. Their
    // attempted pickup remains on the board because it was not collected.
    // Collisions intentionally do not call showPlayerFeedback(): the score
    // area is reserved exclusively for word-submission results.
    const dropped = [];
    plans.forEach((plan, index) => {
      const player = players[index];
      if (dead.has(index)) {
        dropped.push(...player.snake.slice(1));
        const oldHead = player.snake[0];
        player.snake = [{ x: oldHead.x, y: oldHead.y, letter: null }];
        player.headBounce = 0;
      } else {
        player.snake = plan.nextSnake;
        dropped.push(...plan.cutSegments);
        // A self-collision cuts the snake but does not kill the player.
        // Play the same scatter sound used for wall/player collisions.
        if (plan.cutSegments.length) playSfx(sfxCrash);
        if (plan.pickupLetter) {
          player.headBounce = 15;
          playSfx(sfxLetter);
        }
        player.direction = { ...player.nextDirection };
      }
    });

    // Remove board letters only when a living player successfully collected
    // them. Process indices from high to low to keep indices stable.
    const pickedIndices = plans
      .filter((plan, index) => !dead.has(index) && plan.pickupIndex >= 0)
      .map(plan => plan.pickupIndex);
    [...new Set(pickedIndices)].sort((a, b) => b - a)
      .forEach(index => lettersOnBoard.splice(index, 1));

    dropSegments(dropped);

    // Respawn after dropping letters so the new head does not overlap them.
    dead.forEach(index => {
      const player = players[index];
      const cell = findFreeCell();
      if (cell) player.snake = [{ ...cell, letter: null }];
      player.direction = player.id === 1 ? { x: 1, y: 0 } : { x: -1, y: 0 };
      player.nextDirection = { ...player.direction };
      playSfx(sfxCrash);
    });

    if (plans.some(plan => plan.pickupLetter || plan.cutSegments.length) || dead.size) {
      renderScores();
    }
  }

  function renderScores() {
    players.forEach(player => {
      const scoreEl = document.getElementById(`p${player.id}Score`);
      if (scoreEl) scoreEl.textContent = player.score;
    });
  }

  function clearPlayerFeedback(player) {
    if (player.feedbackTimeout) {
      clearTimeout(player.feedbackTimeout);
      player.feedbackTimeout = null;
    }

    const feedbackEl = document.getElementById(`p${player.id}Feedback`);
    if (feedbackEl) {
      feedbackEl.textContent = '';
      feedbackEl.style.color = '';
      feedbackEl.classList.remove('feedback-error', 'feedback-success', 'feedback-jiggle', 'feedback-winner', 'feedback-tie');
    }
    player.feedback = '';
  }

  function showPlayerFeedback(player, message, type) {
    clearPlayerFeedback(player);

    const feedbackEl = document.getElementById(`p${player.id}Feedback`);
    if (!feedbackEl) return;

    player.feedback = message;
    feedbackEl.textContent = message;

    // Set the color directly as well as using classes. This keeps the
    // feedback red/green even if another stylesheet has a generic text rule.
    feedbackEl.classList.toggle('feedback-success', type === 'success');
    feedbackEl.classList.toggle('feedback-error', type !== 'success');
    feedbackEl.style.color = type === 'success' ? '#237a36' : '#c62828';

    if (type !== 'success') {
      // Force a fresh animation on every invalid submission, including when
      // the same message is submitted repeatedly.
      feedbackEl.classList.remove('feedback-jiggle');
      void feedbackEl.offsetWidth;
      feedbackEl.classList.add('feedback-jiggle');
    }

    player.feedbackTimeout = setTimeout(() => {
      feedbackEl.textContent = '';
      feedbackEl.style.color = '';
      feedbackEl.classList.remove('feedback-error', 'feedback-success', 'feedback-jiggle', 'feedback-winner', 'feedback-tie');
      player.feedback = '';
      player.feedbackTimeout = null;
    }, FEEDBACK_DURATION);
  }

  function submitWord(player) {
    if (!gameRunning) return;

    const word = player.snake
      .slice(1)
      .map(segment => segment.letter || '')
      .join('');

    if (word.length < MIN_WORD_LENGTH) {
      showPlayerFeedback(player, `Collect at least ${MIN_WORD_LENGTH} letters!`, 'error');
      playSfx(sfxErrorSubmission);
      return;
    }

    if (!acceptedWords.has(word)) {
      showPlayerFeedback(player, `${word} is not in the word list.`, 'error');
      playSfx(sfxErrorSubmission);
      return;
    }

    const wordScore = [...word].reduce((total, letter) => total + (points[letter] || 0), 0);
    player.score += wordScore;
    player.words.push({ word, score: wordScore });

    // Successful submission clears the entire letter body. The head remains.
    const head = player.snake[0];
    player.snake = [{ x: head.x, y: head.y, letter: null }];
    showPlayerFeedback(player, `${word} scored ${wordScore} point${wordScore === 1 ? '' : 's'}!`, 'success');
    playSfx(sfxSubmit);
    renderScores();
  }

  function setDirection(player, direction) {
    // Prevent immediate reversal into the snake's own neck.
    if (player.nextDirection.x + direction.x === 0 &&
        player.nextDirection.y + direction.y === 0) return;
    player.nextDirection = direction;
  }

  function handleKeyDown(event) {
    if (!gameRunning) return;
    if (gamePaused) {
      if (event.key === 'Escape') {
        event.preventDefault();
        resumeRound();
      }
      return;
    }
    const key = event.key.toLowerCase();

    if (key === 'm' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      toggleMute();
      return;
    }

    // Player 1: arrow keys to move, Enter to submit.
    if (event.key === 'Enter' && !event.repeat) {
      event.preventDefault();
      submitWord(players[0]);
      return;
    }

    // Player 2: WASD to move, either Control key to submit.
    if ((event.key === 'Control' || event.code === 'ControlLeft' || event.code === 'ControlRight') && !event.repeat) {
      event.preventDefault();
      submitWord(players[1]);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setDirection(players[0], { x: 0, y: -1 });
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setDirection(players[0], { x: 0, y: 1 });
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setDirection(players[0], { x: -1, y: 0 });
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setDirection(players[0], { x: 1, y: 0 });
    }

    if (key === 'w') {
      event.preventDefault();
      setDirection(players[1], { x: 0, y: -1 });
    } else if (key === 's') {
      event.preventDefault();
      setDirection(players[1], { x: 0, y: 1 });
    } else if (key === 'a') {
      event.preventDefault();
      setDirection(players[1], { x: -1, y: 0 });
    } else if (key === 'd') {
      event.preventDefault();
      setDirection(players[1], { x: 1, y: 0 });
    }
  }

  function drawPlayer(player) {
    const drawnSegments = player.snake.map((segment, index) => {
      let x = segment.x * TILE_SIZE;
      let y = segment.y * TILE_SIZE;
      let size = TILE_SIZE - 2;

      // Match the existing single-player head pop when a letter is collected.
      if (index === 0 && player.headBounce > 0) {
        const scale = 1 + 0.1 * (player.headBounce / 5);
        const delta = size * (scale - 1);
        x -= delta / 2;
        y -= delta / 2;
        size += delta;
      }

      // The tile face always stays the same Scrabble beige as single-player.
      ctx.fillStyle = '#ffe6a8';
      ctx.fillRect(x, y, size, size);

      if (segment.letter) {
        ctx.fillStyle = '#000';
        ctx.font = `${TILE_SIZE - 6}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(segment.letter, x + size / 2, y + size / 2);
      }

      if (index === 0 && player.headBounce > 0) {
        player.headBounce--;
      }

      return { x, y, size };
    });

    // Draw the colored outline as a separate pass so every body segment is
    // outlined visibly. Only the border changes color, never the tile face.
    ctx.save();
    ctx.strokeStyle = player.accent;
    ctx.lineWidth = CONFIG.snakeOutlineWidth;
    ctx.lineJoin = 'miter';
    ctx.shadowColor = player.accent;
    ctx.shadowBlur = 3;

    drawnSegments.forEach(({ x, y, size }) => {
      ctx.strokeRect(x + 0.8, y + 0.8, size - 1.6, size - 1.6);
    });

    ctx.restore();
  }

  function drawBoardLetters() {
    // Freeze letter age and fading while paused. resumeRound() shifts each
    // createdAt timestamp forward by the pause duration before play resumes.
    const now = gamePaused && pausedAt ? pausedAt : Date.now();
    lettersOnBoard.forEach(tile => {
      const age = now - (tile.createdAt || now);
      const fadeStart = LETTER_LIFETIME - LETTER_FADE_DURATION;
      const opacity = age <= fadeStart
        ? 1
        : Math.max(0, 1 - ((age - fadeStart) / LETTER_FADE_DURATION));
      if (opacity <= 0) return;

      const wiggle = barrierWiggles.find(item => item.x === tile.x && item.y === tile.y);
      const offsetX = wiggle ? Math.sin((wiggle.frame / 10) * Math.PI * 4) * 3 : 0;
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.fillStyle = '#fff';
      ctx.font = `${TILE_SIZE - 4}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tile.letter, tile.x * TILE_SIZE + TILE_SIZE / 2 + offsetX, tile.y * TILE_SIZE + TILE_SIZE / 2);
      ctx.restore();
    });

    for (let i = barrierWiggles.length - 1; i >= 0; i--) {
      barrierWiggles[i].frame++;
      if (barrierWiggles[i].frame > 10) barrierWiggles.splice(i, 1);
    }
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawBoardLetters();
    players.forEach(drawPlayer);
  }

  function drawLoop() {
    if (!gameStarted) return;
    draw();
    animationFrame = requestAnimationFrame(drawLoop);
  }

  function toggleMute() {
    isMuted = !isMuted;
    bgMusic.muted = isMuted;
    activeSfx.forEach(clip => { clip.muted = isMuted; });
    if (!isMuted && gameRunning && !gamePaused) bgMusic.play().catch(() => {});
    const button = document.getElementById('multiMuteButton');
    if (button) {
      button.innerHTML = isMuted ? MUTE_OFF_ICON : MUTE_ON_ICON;
      button.title = isMuted ? 'Unmute sound' : 'Mute sound';
      button.setAttribute('aria-label', button.title);
    }
  }

  const MUTE_ON_ICON = '<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>';
  const MUTE_OFF_ICON = '<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="m17 9 5 6"/><path d="m22 9-5 6"/></svg>';

  function parseMatchDuration() {
    const minutesText = matchMinutesInput.value.trim();
    const secondsText = matchSecondsInput.value.trim();
    if (!/^\d{2}$/.test(minutesText) || !/^\d{2}$/.test(secondsText)) return null;

    const minutes = Number(minutesText);
    const seconds = Number(secondsText);
    if (seconds > 59) return null;

    const totalSeconds = minutes * 60 + seconds;
    if (totalSeconds < 1 || totalSeconds > CONFIG.maxMatchDurationSeconds) return null;
    return totalSeconds;
  }

  function updateStartButtonState() {
    if (!startButton) return;
    const validDuration = parseMatchDuration() !== null;
    const shouldDisable = !(dictionaryLoaded && validDuration);
    startButton.disabled = shouldDisable;
    if (resultsStartButton) resultsStartButton.disabled = shouldDisable;

    if (matchDurationInput) {
      matchDurationInput.setAttribute('aria-invalid', String(!validDuration));
    }
    if (matchDurationError) {
      matchDurationError.textContent = validDuration
        ? ''
        : 'Enter a time from 00:01 to 10:00.';
    }
  }

  function handleDurationInput(event) {
    const field = event.currentTarget;
    const cleaned = field.value.replace(/\D/g, '').slice(0, 2);
    if (field.value !== cleaned) field.value = cleaned;

    if (field === matchMinutesInput && cleaned.length === 2 && event.inputType !== 'deleteContentBackward') {
      matchSecondsInput.focus();
      matchSecondsInput.select();
    }
    updateStartButtonState();
  }

  function normalizeDurationField(field) {
    const cleaned = field.value.replace(/\D/g, '').slice(0, 2);
    field.value = cleaned ? cleaned.padStart(2, '0') : '';
  }

  function dispatchDurationInput(field) {
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function removeDurationDigit(field, index) {
    if (index < 0 || index >= field.value.length) return false;
    field.setRangeText('', index, index + 1, 'preserve');
    const caret = Math.max(0, Math.min(index, field.value.length));
    field.setSelectionRange(caret, caret);
    dispatchDurationInput(field);
    return true;
  }

  function handleDurationKeyDown(event) {
    const field = event.currentTarget;
    const selectionStart = field.selectionStart ?? 0;
    const selectionEnd = field.selectionEnd ?? selectionStart;
    const valueLength = field.value.length;

    if (event.key === 'Backspace' && field === matchSecondsInput) {
      // Focusing a segment selects both digits. Treat Backspace on that
      // selection as one digit at a time, so repeated deletion can cross the
      // fixed colon instead of deleting the whole segment and getting stuck.
      if (valueLength > 0 && selectionStart === 0 && selectionEnd === valueLength) {
        event.preventDefault();
        removeDurationDigit(field, valueLength - 1);
        return;
      }

      // Once seconds are empty, or the caret reaches their left edge, move to
      // minutes and remove the final minute digit. The colon is never edited.
      if (valueLength === 0 || (selectionStart === 0 && selectionEnd === 0)) {
        event.preventDefault();
        matchMinutesInput.focus();
        const minuteLastIndex = matchMinutesInput.value.length - 1;
        if (minuteLastIndex >= 0) {
          removeDurationDigit(matchMinutesInput, minuteLastIndex);
        } else {
          matchMinutesInput.setSelectionRange(0, 0);
        }
        return;
      }
    }

    if (event.key === 'Delete' && field === matchMinutesInput) {
      // Mirror the Backspace behavior from the other side of the colon.
      if (valueLength > 0 && selectionStart === 0 && selectionEnd === valueLength) {
        event.preventDefault();
        removeDurationDigit(field, 0);
        return;
      }

      if (valueLength === 0 || (selectionStart === valueLength && selectionEnd === valueLength)) {
        event.preventDefault();
        matchSecondsInput.focus();
        if (matchSecondsInput.value.length > 0) {
          removeDurationDigit(matchSecondsInput, 0);
        } else {
          matchSecondsInput.setSelectionRange(0, 0);
        }
        return;
      }
    }

    if (event.key === 'Enter' && !startButton.disabled) {
      event.preventDefault();
      startRound();
      return;
    }

    if (event.key === 'ArrowRight' && field === matchMinutesInput &&
        selectionStart === valueLength && selectionEnd === valueLength) {
      event.preventDefault();
      matchSecondsInput.focus();
      matchSecondsInput.select();
    } else if (event.key === 'ArrowLeft' && field === matchSecondsInput &&
        selectionStart === 0 && selectionEnd === 0) {
      event.preventDefault();
      matchMinutesInput.focus();
      matchMinutesInput.select();
    }
  }

  function renderMatchTimer(milliseconds) {
    if (!matchTimerFill) return;
    const ratio = matchDurationMs > 0 ? Math.max(0, Math.min(1, milliseconds / matchDurationMs)) : 1;
    matchTimerFill.style.width = `${ratio * 100}%`;
  }

  function clearRoundIntervals() {
    if (gameInterval) clearInterval(gameInterval);
    if (spawnInterval) clearInterval(spawnInterval);
    if (matchTimerInterval) clearInterval(matchTimerInterval);
    gameInterval = null;
    spawnInterval = null;
    matchTimerInterval = null;
  }

  function startRoundIntervals() {
    clearRoundIntervals();
    gameInterval = setInterval(stepGame, GAME_SPEED);
    spawnInterval = setInterval(spawnLetter, LETTER_SPAWN_RATE);
    matchTimerInterval = setInterval(updateMatchTimer, CONFIG.matchTimerUpdateMs);
  }

  function ensurePauseOverlay() {
    if (pauseOverlay && pauseOverlay.isConnected) return pauseOverlay;
    if (!gameScreen) return null;

    pauseOverlay = document.getElementById('multiPauseOverlay');
    if (pauseOverlay) return pauseOverlay;

    pauseOverlay = document.createElement('section');
    pauseOverlay.id = 'multiPauseOverlay';
    pauseOverlay.className = 'multi-pause-overlay';
    pauseOverlay.hidden = true;
    pauseOverlay.setAttribute('role', 'dialog');
    pauseOverlay.setAttribute('aria-modal', 'true');
    pauseOverlay.setAttribute('aria-labelledby', 'multiPauseTitle');
    pauseOverlay.innerHTML = `
      <div class="multi-pause-card">
        <div class="multi-pause-content">
          <section class="multi-pause-section">
            <h2>Guide</h2>
            <ul>
              <li>Submit words after collecting their letter tiles <em>in order</em>.</li>
              <li>A valid word scores the sum of its letter values. The point system and accepted words are sourced from Scrabble.</li>
              <li>Make the other player crash into you or the arena's borders to make them lose their tiles.</li>
              <li>Running into your own body cuts off the section you hit and drops those letters onto the board.</li>

            </ul>
          </section>

          <section class="multi-pause-section">
            <h2>Controls</h2>
            <ul>
              <li><strong>Player 1:</strong> Move with the arrow keys. Press <kbd>Enter</kbd> to submit.</li>
              <li><strong>Player 2:</strong> Move with <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>. Press <kbd>Ctrl</kbd> to submit.</li>
            </ul>
          </section>
        </div>

        <div class="multi-pause-actions">
          <button id="multiResumeButton" type="button">Resume match</button>
        </div>
      </div>
    `;

    gameScreen.appendChild(pauseOverlay);
    const resumeButton = pauseOverlay.querySelector('#multiResumeButton');
    if (resumeButton) resumeButton.addEventListener('click', resumeRound);
    return pauseOverlay;
  }

  function setPauseOverlayVisible(visible) {
    const overlay = ensurePauseOverlay();
    if (!overlay) return;
    overlay.hidden = !visible;
    if (visible) {
      const resumeButton = overlay.querySelector('#multiResumeButton');
      if (resumeButton) resumeButton.focus();
    }
  }

  function fitResultsTileSizes(root = resultsOverlay) {
    if (!root) return;
    root.querySelectorAll('.multi-results-word-tiles').forEach(tiles => {
      const tileCount = tiles.children.length;
      if (!tileCount) return;

      const styles = window.getComputedStyle(tiles);
      const gap = parseFloat(styles.columnGap || styles.gap) || 2;
      const availableWidth = tiles.clientWidth;
      if (!availableWidth) return;

      const tileSize = Math.max(7, Math.min(26, (availableWidth - gap * (tileCount - 1)) / tileCount));
      tiles.style.setProperty('--result-tile-size', `${tileSize}px`);
    });
  }

  function updatePauseButton() {
    if (!pauseButton) return;
    pauseButton.disabled = !gameRunning;
    pauseButton.innerHTML = gamePaused
      ? '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>';
    pauseButton.title = gamePaused ? 'Resume game' : 'Pause game';
    pauseButton.setAttribute('aria-label', pauseButton.title);
  }

  function updateMatchTimer() {
    if (!gameRunning || gamePaused) return;
    remainingMatchMs = Math.max(0, matchEndTime - Date.now());
    renderMatchTimer(remainingMatchMs);
    if (remainingMatchMs <= 0) endMatch();
  }

  function showMatchWinner(player, text = 'Winner!', tie = false) {
    const feedbackEl = document.getElementById(`p${player.id}Feedback`);
    if (!feedbackEl) return;
    clearPlayerFeedback(player);
    feedbackEl.textContent = text;
    feedbackEl.classList.add(tie ? 'feedback-tie' : 'feedback-winner');
    player.feedback = text;
  }

  function ensureResultsPanel(player) {
    if (!resultsOverlay) return null;

    const playerClass = player.id === 1 ? 'player-one-results' : 'player-two-results';
    const scoreId = `multiResultsP${player.id}Score`;
    const wordsId = `multiResultsP${player.id}Words`;
    const card = resultsOverlay.querySelector('.multi-results-card');
    if (!card) {
      console.error('Results dashboard is missing .multi-results-card. Check the results markup in index.html.');
      return null;
    }

    let section = card.querySelector(`.${playerClass}`);
    if (!section) {
      section = document.createElement('section');
      section.className = `multi-results-player ${playerClass}`;
      section.setAttribute('aria-label', `Player ${player.id} results`);
      const footer = card.querySelector('.multi-results-footer');
      card.insertBefore(section, footer || null);
    }

    let header = section.querySelector('.multi-results-player-header');
    if (!header) {
      header = document.createElement('header');
      header.className = 'multi-results-player-header';
      section.appendChild(header);
    }

    if (!header.querySelector('h2')) {
      const heading = document.createElement('h2');
      heading.textContent = `PLAYER ${player.id}`;
      header.appendChild(heading);
    }

    let scoreEl = document.getElementById(scoreId);
    if (!scoreEl) {
      const total = document.createElement('div');
      total.className = 'multi-results-total';
      scoreEl = document.createElement('span');
      scoreEl.id = scoreId;
      const unit = document.createElement('small');
      unit.textContent = 'PTS';
      total.append(scoreEl, unit);
      header.appendChild(total);
    }

    let wordsEl = document.getElementById(wordsId) || section.querySelector('.multi-results-words');
    if (!wordsEl) {
      wordsEl = document.createElement('div');
      section.appendChild(wordsEl);
    }
    wordsEl.id = wordsId;
    wordsEl.classList.add('multi-results-words');
    wordsEl.setAttribute('aria-label', `Player ${player.id} submitted words`);
    wordsEl.setAttribute('tabindex', '0');

    return { scoreEl, wordsEl };
  }

  function calculateWordScore(word) {
    return [...word].reduce((total, letter) => total + (points[letter] || 0), 0);
  }

  function renderResultsDashboard() {
    players.forEach(player => {
      if (!Array.isArray(player.words)) player.words = [];

      const panel = ensureResultsPanel(player);
      if (!panel) return;
      const { scoreEl, wordsEl } = panel;

      scoreEl.textContent = String(player.score);
      wordsEl.replaceChildren();
      wordsEl.dataset.wordCount = String(player.words.length);

      // Keep the full match history. The CSS constrains the visible viewport
      // to about five rows and each player's list scrolls independently.
      const entries = player.words.map(item => {
        const word = String(typeof item === 'string' ? item : item.word || '')
          .toUpperCase()
          .replace(/[^A-Z]/g, '');
        const storedScore = typeof item === 'object' && item !== null ? Number(item.score) : NaN;
        return {
          word,
          score: Number.isFinite(storedScore) ? storedScore : calculateWordScore(word)
        };
      }).filter(item => item.word.length > 0);

      if (!entries.length) {
        const empty = document.createElement('p');
        empty.className = 'multi-results-empty';
        empty.textContent = 'No words submitted';
        wordsEl.appendChild(empty);
        return;
      }

      entries.forEach(entry => {
        const row = document.createElement('div');
        row.className = 'multi-results-word-row';
        row.setAttribute('aria-label', `${entry.word}, ${entry.score} points`);

        const tiles = document.createElement('div');
        tiles.className = 'multi-results-word-tiles';
        tiles.setAttribute('aria-label', entry.word);

        [...entry.word].forEach(letter => {
          const tile = document.createElement('span');
          tile.className = 'multi-results-letter-tile';
          tile.appendChild(document.createTextNode(letter));

          const tilePoints = document.createElement('small');
          tilePoints.className = 'multi-results-letter-points';
          tilePoints.textContent = String(points[letter] || 0);
          tile.appendChild(tilePoints);
          tiles.appendChild(tile);
        });

        const wordScore = document.createElement('strong');
        wordScore.className = 'multi-results-word-score';
        wordScore.textContent = `${entry.score} pts`;

        row.append(tiles, wordScore);
        wordsEl.appendChild(row);
      });

      // Show the oldest entries first when the dashboard opens. Later entries
      // remain available below via this player's own scrollbar.
      wordsEl.scrollTop = 0;
    });

    // Keep every submitted word on one line. Longer words use narrower tiles
    // while the score column remains fixed on the right.
    fitResultsTileSizes(resultsOverlay);
  }

  function endMatch() {
    if (!gameRunning) return;
    setPauseOverlayVisible(false);
    remainingMatchMs = 0;
    renderMatchTimer(0);
    clearRoundIntervals();
    gameRunning = false;
    gamePaused = false;
    bgMusic.pause();
    bgMusic.currentTime = 0;

    players.forEach(clearPlayerFeedback);
    if (players[0].score > players[1].score) {
      showMatchWinner(players[0]);
    } else if (players[1].score > players[0].score) {
      showMatchWinner(players[1]);
    } else {
      showMatchWinner(players[0], 'Tie!', true);
      showMatchWinner(players[1], 'Tie!', true);
    }
    matchHasEnded = true;
    matchTimer.hidden = true;
    startOverlay.hidden = true;

    // Move the existing duration input into the results footer so players can
    // edit the next match length without duplicating the fixed-colon fields.
    if (matchDurationControl && resultsDurationSlot) {
      resultsDurationSlot.appendChild(matchDurationControl);
    }

    // Start the game-over chime before revealing the results card.
    playSfx(sfxGameOver);
    resultsOverlay.hidden = false;
    renderResultsDashboard();

    startButton.textContent = 'Start match';
    updateStartButtonState();
    updatePauseButton();
  }

  function startRound() {
    if (!dictionaryLoaded || gameRunning) return;
    const durationSeconds = parseMatchDuration();
    if (!durationSeconds) {
      updateStartButtonState();
      return;
    }

    matchMinutesInput.blur();
    matchSecondsInput.blur();

    // After a completed match, prepare a genuinely fresh board and reset both
    // scores only when the players choose Start match again.
    if (matchHasEnded) {
      resultsOverlay.hidden = true;
      if (matchDurationControl && durationHomeSlot) {
        durationHomeSlot.appendChild(matchDurationControl);
      }
      lettersOnBoard.length = 0;
      barrierWiggles.length = 0;
      resizeCanvas();
      resetPlayers();
      preloadLetters();
      matchHasEnded = false;
    }

    const matchStartTimestamp = Date.now();
    lettersOnBoard.forEach(tile => { tile.createdAt = matchStartTimestamp; });
    matchDurationMs = durationSeconds * 1000;
    remainingMatchMs = matchDurationMs;
    matchEndTime = Date.now() + remainingMatchMs;
    gameRunning = true;
    gamePaused = false;
    startOverlay.hidden = true;
    matchTimer.hidden = false;
    renderMatchTimer(remainingMatchMs);
    matchTimerFill.style.transition = 'width 100ms linear';
    startRoundIntervals();
    updatePauseButton();
    if (!isMuted) bgMusic.play().catch(() => {});
  }

  function pauseRound() {
    if (!gameRunning || gamePaused) return;
    remainingMatchMs = Math.max(0, matchEndTime - Date.now());
    if (remainingMatchMs <= 0) {
      endMatch();
      return;
    }
    gamePaused = true;
    pausedAt = Date.now();
    clearRoundIntervals();
    matchTimerFill.style.transition = 'none';
    renderMatchTimer(remainingMatchMs);
    bgMusic.pause();
    setPauseOverlayVisible(true);
    updatePauseButton();
  }

  function resumeRound() {
    if (!gameRunning || !gamePaused) return;
    if (remainingMatchMs <= 0) {
      endMatch();
      return;
    }
    const pauseDuration = pausedAt ? Date.now() - pausedAt : 0;
    lettersOnBoard.forEach(tile => {
      if (tile.createdAt) tile.createdAt += pauseDuration;
    });
    pausedAt = 0;
    matchEndTime = Date.now() + remainingMatchMs;
    gamePaused = false;
    setPauseOverlayVisible(false);
    if (pauseButton) pauseButton.focus();
    matchTimerFill.style.transition = 'width 100ms linear';
    startRoundIntervals();
    updatePauseButton();
    if (!isMuted) bgMusic.play().catch(() => {});
  }

  function togglePause() {
    if (!gameRunning) return;
    if (gamePaused) resumeRound();
    else pauseRound();
  }

  function stopRound() {
    clearRoundIntervals();
    gameRunning = false;
    gamePaused = false;
    matchEndTime = 0;
    remainingMatchMs = 0;
    pausedAt = 0;
    bgMusic.pause();
    bgMusic.currentTime = 0;
    updatePauseButton();
  }

  function resetToInstructions() {
    setPauseOverlayVisible(false);
    stopRound();
    matchHasEnded = false;
    resultsOverlay.hidden = true;
    if (matchDurationControl && durationHomeSlot) {
      durationHomeSlot.appendChild(matchDurationControl);
    }
    players.forEach(clearPlayerFeedback);
    lettersOnBoard.length = 0;
    barrierWiggles.length = 0;
    resizeCanvas();
    resetPlayers();
    preloadLetters();
    startOverlay.hidden = false;
    matchTimer.hidden = true;
    if (matchTimerFill) {
      matchTimerFill.style.transition = 'none';
      matchTimerFill.style.width = '100%';
    }
    startButton.textContent = 'Start match';
    updateStartButtonState();
    draw();
  }


  function bindEvents() {
    if (listenersBound) return;
    listenersBound = true;

    window.addEventListener('resize', () => {
      if (document.getElementById('multiGameScreen').hidden) return;
      resizeCanvas();
      draw();
      if (!resultsOverlay.hidden) requestAnimationFrame(() => fitResultsTileSizes(resultsOverlay));
    });

    document.addEventListener('keydown', handleKeyDown);
    startButton.addEventListener('click', startRound);
    resultsStartButton.addEventListener('click', startRound);
    [matchMinutesInput, matchSecondsInput].forEach(field => {
      field.addEventListener('input', handleDurationInput);
      field.addEventListener('focus', () => field.select());
      field.addEventListener('blur', () => {
        normalizeDurationField(field);
        updateStartButtonState();
      });
      field.addEventListener('keydown', handleDurationKeyDown);
    });

    document.getElementById('multiResetButton').addEventListener('click', resetToInstructions);
    document.getElementById('multiMuteButton').addEventListener('click', toggleMute);
    pauseButton.addEventListener('click', togglePause);
  }

  function initialize() {
    bindEvents();
    ensurePauseOverlay();
    // Start dictionary loading before canvas setup so an unrelated rendering
    // error cannot leave the Start button displaying an endless loading state.
    loadDictionary();
    gameStarted = true;
    matchHasEnded = false;
    resultsOverlay.hidden = true;
    if (matchDurationControl && durationHomeSlot) {
      durationHomeSlot.appendChild(matchDurationControl);
    }
    resizeCanvas();
    lettersOnBoard.length = 0;
    barrierWiggles.length = 0;
    resetPlayers();
    preloadLetters();
    startOverlay.hidden = false;
    startButton.textContent = 'Start match';
    matchTimer.hidden = true;
    if (matchTimerFill) {
      matchTimerFill.style.transition = 'none';
      matchTimerFill.style.width = '100%';
    }
    updateStartButtonState();
    updatePauseButton();
    renderScores();
    draw();

    const muteButton = document.getElementById('multiMuteButton');
    if (muteButton) {
      muteButton.innerHTML = isMuted ? MUTE_OFF_ICON : MUTE_ON_ICON;
      muteButton.title = isMuted ? 'Unmute sound' : 'Mute sound';
      muteButton.setAttribute('aria-label', muteButton.title);
    }

    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = requestAnimationFrame(drawLoop);
  }

  function stop() {
    setPauseOverlayVisible(false);
    stopRound();
    matchHasEnded = false;
    players.forEach(clearPlayerFeedback);
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = null;
    gameStarted = false;
  }

  window.startMultiplayerGame = initialize;
  window.stopMultiplayerGame = stop;
})();
