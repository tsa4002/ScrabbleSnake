(() => {
  'use strict';

  const CONFIG = {
    // Number of independent word-snakes visible or entering at one time.
    snakeCount: 17,

    // Only words with at least this many letters are used.
    minimumWordLength: 5,

    // Match the tile scale and movement feel of the main game.
    tileSize: 20,
    movementIntervalMinMs: 175,
    movementIntervalMaxMs: 245,

    // A snake considers changing direction after this many steps.
    directionChangeMinSteps: 2,
    directionChangeMaxSteps: 5,

    // Spawn anywhere in this expanded area around the viewport.
    // It is not limited to the four exact edges.
    spawnPaddingPx: 180,

    // Each new snake enters on its own schedule.
    initialSpawnStaggerMinMs: 450,
    initialSpawnStaggerMaxMs: 1500,
    replacementDelayMinMs: 500,
    replacementDelayMaxMs: 3500,

    // Small, independent timing variation between snakes.
    movementJitterMs: 35,

    // Match the single-player inventory shake and falling-tile animation.
    tileShakeDurationMs: 600,
    tileFallStaggerMs: 300,
    tileFallDurationMs: 1500,
    tileFallDistanceViewportMultiplier: 1.2
  };

  const canvas = document.getElementById('homeSnakeCanvas');
  const modeScreen = document.getElementById('modeScreen');

  if (!canvas || !modeScreen) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const DIRECTIONS = [
    { x: 1, y: 0, name: 'right' },
    { x: -1, y: 0, name: 'left' },
    { x: 0, y: 1, name: 'down' },
    { x: 0, y: -1, name: 'up' }
  ];

  let viewportWidth = window.innerWidth;
  let viewportHeight = window.innerHeight;
  let columns = Math.ceil(viewportWidth / CONFIG.tileSize);
  let rows = Math.ceil(viewportHeight / CONFIG.tileSize);
  let pixelRatio = Math.max(1, window.devicePixelRatio || 1);

  let wordPool = [];
  let snakes = [];
  let fallingTiles = [];
  let pendingSpawns = [];
  let animationFrame = null;
  let running = false;
  let pausedAt = null;

  const randomBetween = (min, max) => min + Math.random() * (max - min);
  const randomInt = (min, max) => Math.floor(randomBetween(min, max + 1));

  function resizeCanvas() {
    viewportWidth = window.innerWidth;
    viewportHeight = window.innerHeight;
    columns = Math.ceil(viewportWidth / CONFIG.tileSize);
    rows = Math.ceil(viewportHeight / CONFIG.tileSize);
    pixelRatio = Math.max(1, window.devicePixelRatio || 1);

    canvas.width = Math.round(viewportWidth * pixelRatio);
    canvas.height = Math.round(viewportHeight * pixelRatio);
    canvas.style.width = `${viewportWidth}px`;
    canvas.style.height = `${viewportHeight}px`;

    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    draw(performance.now());
  }

  function isInsideViewport(x, y) {
    return x >= 0 && x < columns && y >= 0 && y < rows;
  }

  function distanceFromViewport(x, y) {
    const dx = x < 0 ? -x : x >= columns ? x - columns + 1 : 0;
    const dy = y < 0 ? -y : y >= rows ? y - rows + 1 : 0;
    return dx + dy;
  }

  function randomDirectionTowardViewport(x, y) {
    // Start with a direction that actually moves the head toward the viewport.
    // At a corner, either inward axis is chosen randomly.
    const inwardDirections = [];

    if (x < 0) inwardDirections.push(DIRECTIONS[0]);
    else if (x >= columns) inwardDirections.push(DIRECTIONS[1]);

    if (y < 0) inwardDirections.push(DIRECTIONS[2]);
    else if (y >= rows) inwardDirections.push(DIRECTIONS[3]);

    if (inwardDirections.length) {
      return inwardDirections[randomInt(0, inwardDirections.length - 1)];
    }

    // Defensive fallback. Spawn positions should always be outside the view.
    return DIRECTIONS[randomInt(0, DIRECTIONS.length - 1)];
  }

  function randomOutsidePosition() {
    const padding = Math.ceil(CONFIG.spawnPaddingPx / CONFIG.tileSize);
    const minX = -padding;
    const maxX = columns - 1 + padding;
    const minY = -padding;
    const maxY = rows - 1 + padding;

    for (let attempt = 0; attempt < 200; attempt++) {
      const x = randomInt(minX, maxX);
      const y = randomInt(minY, maxY);
      if (!isInsideViewport(x, y)) return { x, y };
    }

    // Guaranteed fallback outside the top edge, with a random horizontal offset.
    return { x: randomInt(minX, maxX), y: minY - 1 };
  }

  function cellKey(x, y) {
    return `${x},${y}`;
  }

  function isPositionAvailable(candidateSegments) {
    const occupied = new Set();

    for (const snake of snakes) {
      for (const segment of snake.segments) {
        occupied.add(cellKey(segment.x, segment.y));
      }
    }

    const candidateCells = new Set();
    for (const segment of candidateSegments) {
      const key = cellKey(segment.x, segment.y);
      if (occupied.has(key) || candidateCells.has(key)) return false;
      candidateCells.add(key);
    }

    return true;
  }

  function chooseWord(maxLength = Infinity) {
    if (!wordPool.length) return null;

    const eligible = wordPool.filter(word => word.length <= maxLength);
    if (!eligible.length) return null;

    const activeWords = new Set(snakes.map(snake => snake.word));
    const available = eligible.filter(word => !activeWords.has(word));
    const source = available.length ? available : eligible;
    return source[randomInt(0, source.length - 1)];
  }

  function createSnake() {
    const padding = Math.ceil(CONFIG.spawnPaddingPx / CONFIG.tileSize);
    const maxSpawnLength = Math.max(
      columns + padding * 2,
      rows + padding * 2
    ) - 2;
    const word = chooseWord(maxSpawnLength);
    if (!word) return false;

    for (let attempt = 0; attempt < 160; attempt++) {
      const head = randomOutsidePosition();
      const direction = randomDirectionTowardViewport(head.x, head.y);
      const segments = [{ x: head.x, y: head.y, letter: null }];

      for (let i = 0; i < word.length; i++) {
        segments.push({
          x: head.x - direction.x * (i + 1),
          y: head.y - direction.y * (i + 1),
          letter: word[i]
        });
      }

      if (!isPositionAvailable(segments)) continue;

      const now = performance.now();
      snakes.push({
        word,
        segments,
        direction,
        hasEntered: false,
        leaving: false,
        crashed: false,
        stepsUntilTurn: randomInt(
          CONFIG.directionChangeMinSteps,
          CONFIG.directionChangeMaxSteps
        ),
        moveInterval: randomBetween(
          CONFIG.movementIntervalMinMs,
          CONFIG.movementIntervalMaxMs
        ),
        nextMoveAt: now + randomBetween(0, CONFIG.movementJitterMs)
      });
      return true;
    }

    return false;
  }

  // Seed the mode-selection screen with snakes that are already visible on
  // the first frame. Later replacements continue to enter from outside.
  function createInitialSnake() {
    const maxInitialLength = Math.max(columns, rows) - 2;

    for (let attempt = 0; attempt < 240; attempt++) {
      const word = chooseWord(maxInitialLength);
      if (!word) return false;

      const possibleDirections = shuffled(DIRECTIONS.filter(direction => {
        const availableLength = direction.x !== 0 ? columns : rows;
        return word.length + 1 <= availableLength;
      }));

      if (!possibleDirections.length) continue;

      const direction = possibleDirections[0];
      const minX = direction.x > 0 ? word.length : 0;
      const maxX = direction.x < 0 ? columns - 1 - word.length : columns - 1;
      const minY = direction.y > 0 ? word.length : 0;
      const maxY = direction.y < 0 ? rows - 1 - word.length : rows - 1;

      if (minX > maxX || minY > maxY) continue;

      const head = {
        x: randomInt(minX, maxX),
        y: randomInt(minY, maxY)
      };
      const segments = [{ x: head.x, y: head.y, letter: null }];

      for (let i = 0; i < word.length; i++) {
        segments.push({
          x: head.x - direction.x * (i + 1),
          y: head.y - direction.y * (i + 1),
          letter: word[i]
        });
      }

      if (!isPositionAvailable(segments)) continue;

      const now = performance.now();
      snakes.push({
        word,
        segments,
        direction,
        hasEntered: true,
        leaving: false,
        crashed: false,
        stepsUntilTurn: randomInt(
          CONFIG.directionChangeMinSteps,
          CONFIG.directionChangeMaxSteps
        ),
        moveInterval: randomBetween(
          CONFIG.movementIntervalMinMs,
          CONFIG.movementIntervalMaxMs
        ),
        nextMoveAt: now + randomBetween(0, CONFIG.movementJitterMs)
      });
      return true;
    }

    return false;
  }

  function seedInitialSnakes() {
    snakes = [];
    pendingSpawns = [];

    for (let i = 0; i < CONFIG.snakeCount; i++) {
      if (!createInitialSnake()) break;
    }

    // If an unusually small viewport prevents the full initial population
    // from fitting, let the remaining snakes enter independently from outside.
    const missingSnakes = CONFIG.snakeCount - snakes.length;
    const now = performance.now();
    for (let i = 0; i < missingSnakes; i++) {
      pendingSpawns.push(now + randomBetween(
        CONFIG.initialSpawnStaggerMinMs,
        CONFIG.initialSpawnStaggerMaxMs
      ));
    }
  }

  function leftOf(direction) {
    return DIRECTIONS.find(d => d.x === -direction.y && d.y === direction.x);
  }

  function rightOf(direction) {
    return DIRECTIONS.find(d => d.x === direction.y && d.y === -direction.x);
  }

  function shuffled(items) {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = randomInt(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function isOtherSnakeBlocked(snake, x, y) {
    const key = cellKey(x, y);

    // Other snakes remain solid obstacles. The current snake's own body is
    // deliberately not blocked here, so self-collisions can trigger the fall.
    for (const other of snakes) {
      if (other === snake || other.crashed) continue;
      if (other.segments.some(segment => cellKey(segment.x, segment.y) === key)) {
        return true;
      }
    }

    return false;
  }

  function getSafeDirection(snake, preferredDirections) {
    for (const direction of preferredDirections) {
      const nextX = snake.segments[0].x + direction.x;
      const nextY = snake.segments[0].y + direction.y;
      if (!isOtherSnakeBlocked(snake, nextX, nextY)) return direction;
    }
    return null;
  }

  function nextDirectionFor(snake) {
    const forward = snake.direction;
    const alternatives = shuffled([forward, leftOf(forward), rightOf(forward)]);

    // Before a snake enters the viewport, favor steps that bring it closer.
    // Its starting position and target are still independently randomized.
    if (!snake.hasEntered) {
      const currentDistance = distanceFromViewport(
        snake.segments[0].x,
        snake.segments[0].y
      );
      const inwardOptions = alternatives.filter(direction => {
        const x = snake.segments[0].x + direction.x;
        const y = snake.segments[0].y + direction.y;
        return distanceFromViewport(x, y) < currentDistance;
      });

      const safeInward = getSafeDirection(snake, inwardOptions);
      if (safeInward) return safeInward;
    }

    return getSafeDirection(snake, alternatives);
  }

  function beginSelfCollision(snake, now) {
    if (snake.crashed) return;

    snake.crashed = true;
    snake.crashedAt = now;

    // The head and letter tiles fall together. The timing mirrors the
    // single-player inventory animation: shake, stagger, then fall away.
    snake.segments.forEach(segment => {
      fallingTiles.push({
        x: segment.x,
        y: segment.y,
        letter: segment.letter,
        collisionAt: now,
        fallDelay: CONFIG.tileShakeDurationMs + randomBetween(
          0,
          CONFIG.tileFallStaggerMs
        )
      });
    });
  }

  function moveSnake(snake, now) {
    if (snake.crashed) return;

    let direction = snake.direction;

    if (!snake.leaving && snake.stepsUntilTurn <= 0) {
      const nextDirection = nextDirectionFor(snake);
      if (nextDirection) direction = nextDirection;
      snake.stepsUntilTurn = randomInt(
        CONFIG.directionChangeMinSteps,
        CONFIG.directionChangeMaxSteps
      );
    }

    let nextX = snake.segments[0].x + direction.x;
    let nextY = snake.segments[0].y + direction.y;

    // Avoid other snakes. If boxed in, try a wider set of directions,
    // including a U-turn, rather than waiting forever in a small square.
    if (isOtherSnakeBlocked(snake, nextX, nextY)) {
      const reverse = { x: -direction.x, y: -direction.y, name: 'reverse' };
      const safeFallback = getSafeDirection(
        snake,
        shuffled([leftOf(direction), rightOf(direction), direction, reverse])
      );

      if (!safeFallback) {
        snake.nextMoveAt = now + snake.moveInterval;
        return;
      }

      direction = safeFallback;
      nextX = snake.segments[0].x + direction.x;
      nextY = snake.segments[0].y + direction.y;
      snake.stepsUntilTurn = randomInt(
        CONFIG.directionChangeMinSteps,
        CONFIG.directionChangeMaxSteps
      );
    }

    snake.direction = direction;

    // Move the body first, then place the head, matching the main game.
    for (let i = snake.segments.length - 1; i > 0; i--) {
      snake.segments[i].x = snake.segments[i - 1].x;
      snake.segments[i].y = snake.segments[i - 1].y;
    }

    snake.segments[0].x = nextX;
    snake.segments[0].y = nextY;

    // Self-collision is now an intentional part of the home animation.
    // When it happens, the complete word snake shakes and falls away.
    const hitSelf = snake.segments.slice(1).some(segment =>
      segment.x === nextX && segment.y === nextY
    );

    if (hitSelf) {
      beginSelfCollision(snake, now);
      return;
    }

    if (!snake.hasEntered && isInsideViewport(nextX, nextY)) {
      snake.hasEntered = true;
    } else if (snake.hasEntered && !isInsideViewport(nextX, nextY)) {
      snake.leaving = true;
    }

    if (snake.stepsUntilTurn > 0) snake.stepsUntilTurn--;
    snake.nextMoveAt = now + snake.moveInterval + randomBetween(
      -CONFIG.movementJitterMs,
      CONFIG.movementJitterMs
    );
  }

  function drawFallingTiles(now) {
    fallingTiles = fallingTiles.filter(tile => {
      const elapsed = now - tile.collisionAt;
      const fallStart = tile.fallDelay;
      const fallElapsed = elapsed - fallStart;

      if (fallElapsed >= CONFIG.tileFallDurationMs) return false;

      const size = CONFIG.tileSize - 2;
      const startX = tile.x * CONFIG.tileSize;
      const startY = tile.y * CONFIG.tileSize;
      let x = startX;
      let y = startY;
      let alpha = 1;
      let rotation = 0;

      if (elapsed < fallStart) {
        // Small shake during the same 600ms lead-in as the inventory tiles.
        const progress = Math.min(1, elapsed / CONFIG.tileShakeDurationMs);
        x += Math.sin(progress * Math.PI * 6) * 6 * (1 - progress);
      } else {
        const progress = Math.max(0, Math.min(
          1,
          fallElapsed / CONFIG.tileFallDurationMs
        ));
        y += viewportHeight * CONFIG.tileFallDistanceViewportMultiplier * progress;
        alpha = 1 - progress;
        rotation = Math.PI * 2 * progress;
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x + size / 2, y + size / 2);
      ctx.rotate(rotation);
      ctx.fillStyle = '#ffe6a8';
      ctx.fillRect(-size / 2, -size / 2, size, size);

      if (tile.letter) {
        ctx.fillStyle = '#000';
        ctx.font = `${CONFIG.tileSize - 6}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tile.letter, 0, 0);
      }

      ctx.restore();
      return true;
    });
  }

  function cellIntersectsViewport(segment) {
    const left = segment.x * CONFIG.tileSize;
    const top = segment.y * CONFIG.tileSize;
    const right = left + CONFIG.tileSize;
    const bottom = top + CONFIG.tileSize;

    return right > 0 && left < viewportWidth && bottom > 0 && top < viewportHeight;
  }

  function hasFullyDisappeared(snake) {
    return snake.leaving && snake.segments.every(
      segment => !cellIntersectsViewport(segment)
    );
  }

  function draw(now = performance.now()) {
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, viewportWidth, viewportHeight);

    for (const snake of snakes) {
      // Draw tail to head, matching the single-player tile appearance.
      for (let i = snake.segments.length - 1; i >= 0; i--) {
        const segment = snake.segments[i];
        const px = segment.x * CONFIG.tileSize;
        const py = segment.y * CONFIG.tileSize;
        const size = CONFIG.tileSize - 2;

        ctx.fillStyle = '#ffe6a8';
        ctx.fillRect(px, py, size, size);

        if (segment.letter) {
          ctx.fillStyle = '#000';
          ctx.font = `${CONFIG.tileSize - 6}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(
            segment.letter,
            px + size / 2,
            py + size / 2
          );
        }
      }
    }

    drawFallingTiles(now);
  }

  function animationLoop(now) {
    if (!running) return;

    if (modeScreen.hidden || document.hidden) {
      stopAnimation();
      return;
    }

    for (const snake of snakes) {
      if (now >= snake.nextMoveAt) moveSnake(snake, now);
    }

    const removedSnakes = snakes.filter(
      snake => snake.crashed || hasFullyDisappeared(snake)
    );
    snakes = snakes.filter(
      snake => !snake.crashed && !hasFullyDisappeared(snake)
    );

    if (removedSnakes.length) {
      const fallAnimationTime =
        CONFIG.tileShakeDurationMs +
        CONFIG.tileFallStaggerMs +
        CONFIG.tileFallDurationMs;

      // Give every departing snake its own replacement time. This prevents
      // replacements from becoming synchronized when several snakes leave.
      removedSnakes.forEach(snake => {
        const delay = (snake.crashed ? fallAnimationTime : 0) + randomBetween(
          CONFIG.replacementDelayMinMs,
          CONFIG.replacementDelayMaxMs
        );
        pendingSpawns.push(now + delay);
      });
    }

    if (snakes.length < CONFIG.snakeCount && pendingSpawns.length) {
      pendingSpawns.sort((a, b) => a - b);
      if (pendingSpawns[0] <= now) {
        if (createSnake()) {
          pendingSpawns.shift();
        } else {
          pendingSpawns[0] = now + 900;
        }
      }
    }

    draw(now);
    animationFrame = requestAnimationFrame(animationLoop);
  }

  function startAnimation() {
    if (running || !wordPool.length || modeScreen.hidden || document.hidden) return;

    const now = performance.now();
    if (pausedAt !== null) {
      const pausedDuration = now - pausedAt;
      snakes.forEach(snake => { snake.nextMoveAt += pausedDuration; });
      fallingTiles.forEach(tile => { tile.collisionAt += pausedDuration; });
      pendingSpawns = pendingSpawns.map(spawnAt => spawnAt + pausedDuration);
      pausedAt = null;
    }

    running = true;
    if (snakes.length < CONFIG.snakeCount && !pendingSpawns.length) {
      pendingSpawns.push(now + randomBetween(100, 700));
    }
    animationFrame = requestAnimationFrame(animationLoop);
  }

  function stopAnimation() {
    if (!running) return;
    running = false;
    pausedAt = performance.now();
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  }

  async function loadWords() {
    try {
      const response = await fetch('clean_wordlist.txt');
      if (!response.ok) {
        throw new Error(`clean_wordlist.txt returned HTTP ${response.status}`);
      }

      const text = await response.text();
      wordPool = Array.from(new Set(
        text
          .split(/\r?\n/)
          .map(word => word.trim().toUpperCase())
          .filter(word => /^[A-Z]+$/.test(word))
          .filter(word => word.length >= CONFIG.minimumWordLength)
      ));

      if (!wordPool.length) {
        throw new Error('No words of at least five letters were found.');
      }

      seedInitialSnakes();
      draw(performance.now());
      startAnimation();
    } catch (error) {
      console.error('Home screen word snakes could not load wordlist.txt:', error);
    }
  }

  window.addEventListener('resize', resizeCanvas);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || modeScreen.hidden) stopAnimation();
    else startAnimation();
  });

  const modeScreenObserver = new MutationObserver(() => {
    if (modeScreen.hidden) stopAnimation();
    else startAnimation();
  });
  modeScreenObserver.observe(modeScreen, {
    attributes: true,
    attributeFilter: ['hidden']
  });

  resizeCanvas();
  loadWords();
})();
