// at the top, before anything else
const bgMusic = new Audio('sound_effects/background_arcade_music.wav');
bgMusic.loop   = true;
bgMusic.volume = 0.50;

MIN_CHALLENGE_WORD_LENGTH = 3;
MAX_CHALLENGE_WORD_LENGTH = 7;
MAX_DUPLICATES = 2;

let challengeTime     = 40;    // seconds
let currentTimer      = challengeTime;
let challengeInterval = null;
const timerDisplay    = document.getElementById('timerDisplay');

let lives = 3;
const lifeContainer = document.getElementById('lifeContainer');

const LETTER_SPAWN_RATE = 10;
const LETTER_SPAWN_RADIUS = 7;  // How far letters are in the arena 


// --- Audio SFX & Unlock ---
const sfxLetter       = new Audio('sound_effects/letter_pickup.wav');
const sfxSubmit       = new Audio('sound_effects/accepted_submission.wav');
const sfxCrash        = new Audio('sound_effects/word_scatter.wav');
const sfxHeartLost    = new Audio('sound_effects/lost_heart.wav');
const sfxHeartsRefill = new Audio('sound_effects/hearts_refill.wav');

function playSfx(sfx) {
  const clip = sfx.cloneNode();
  clip.currentTime = 0;
  clip.play().catch(()=>{});
}


function unlockAudio() {
  // prime each SFX once
  [sfxLetter, sfxSubmit, sfxCrash, sfxHeartLost, sfxHeartsRefill].forEach(sfx => {
    sfx.play().catch(() => {});
    sfx.pause();
    sfx.currentTime = 0;
  });

  // now prime AND start your bgMusic
  bgMusic.play().catch(() => {});
  // no need to reset currentTime — you want it looping

  window.removeEventListener('keydown', unlockAudio);
}

// listen for the first keypress to unlock
window.addEventListener('keydown', unlockAudio);

// --- DOM & Canvas refs ---
const canvas            = document.getElementById('game');
const ctx               = canvas.getContext('2d');
const wordInput         = document.getElementById('wordInput');
const scoreValueEl      = document.getElementById('scoreValue');
const letterInventoryEl = document.getElementById('letterInventory');
const challengeContainer= document.getElementById('wordChallengeTiles');

// --- Game state ---
let gameSpeed        = 200;
let paused           = false;
let overlayActive = true;
let playerScore      = 0;

// Scrabble bag & points
const letterBag = (
  'A'.repeat(9)+'B'.repeat(2)+'C'.repeat(2)+
  'D'.repeat(4)+'E'.repeat(12)+'F'.repeat(2)+
  'G'.repeat(3)+'H'.repeat(2)+'I'.repeat(9)+
  'J'+'K'+'L'.repeat(4)+'M'.repeat(2)+
  'N'.repeat(6)+'O'.repeat(8)+'P'.repeat(2)+
  'Q'+'R'.repeat(6)+'S'.repeat(4)+'T'.repeat(6)+
  'U'.repeat(4)+'V'.repeat(2)+'W'.repeat(2)+
  'X'+'Y'.repeat(2)+'Z'
).split('');
const points = {
  A:1,B:3,C:3,D:2,E:1,F:4,G:2,H:4,I:1,J:8,
  K:5,L:1,M:3,N:1,O:1,P:3,Q:10,R:1,S:1,T:1,
  U:1,V:4,W:4,X:8,Y:4,Z:10
};

// --- Canvas setup ---
const padding = 20, tileSize = 20;
let cols, rows;
function resizeCanvas() {
  canvas.width  = canvas.parentElement.clientWidth - padding;
  canvas.height = window.innerHeight - padding;
  cols = Math.floor(canvas.width / tileSize);
  rows = Math.floor(canvas.height / tileSize);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function preloadLetters() {
  const totalCells = cols * rows;
  const targetDensity = 0.02;              // e.g. 2% of cells have a letter
  const lettersToPlace = Math.floor(totalCells * targetDensity);

  let tries = 0;
  while (lettersOnBoard.length < lettersToPlace && tries < lettersToPlace * 5) {
    tries++;
    const x = Math.floor(Math.random() * cols);
    const y = Math.floor(Math.random() * rows);
    if (canPlaceLetter(x, y)) {
      lettersOnBoard.push({ x, y, letter: randomLetter() });
    }
  }
}


/**
 * Can we place at (x,y)?  
 * – not on the snake  
 * – no existing letter exactly there  
 * – at most 1 other letter within radius R
 */
function canPlaceLetter(x, y) {
  //  a) Don’t spawn on the snake
  if (snake.some(s => s.x === x && s.y === y)) return false;

  // b) Don’t spawn on another letter
  if (lettersOnBoard.some(t => t.x === x && t.y === y)) return false;

  // c) Enforce sparse density: allow at most 1 neighbor within LETTER_SPAWN_RADIUS
  let neighbors = 0;
  for (let dx = -LETTER_SPAWN_RADIUS; dx <= LETTER_SPAWN_RADIUS; dx++) {
    for (let dy = -LETTER_SPAWN_RADIUS; dy <= LETTER_SPAWN_RADIUS; dy++) {
      if (dx*dx + dy*dy <= LETTER_SPAWN_RADIUS*LETTER_SPAWN_RADIUS) {
        if (lettersOnBoard.some(t => t.x === x + dx && t.y === y + dy)) {
          neighbors++;
          if (neighbors > 1) return false;
        }
      }
    }
  }
  return true;
}



// --- Snake & board ---
let snake = [
  { x: 5, y: 5, letter: null },   // head only, no pre‑loaded letters
];

let direction     = { x:1, y:0 };
let nextDirection = { ...direction };
let lettersOnBoard= [];

// --- Anim state ---
let headBounce   = 0;
let glowingTiles = [];

function renderLives() {
  // assume lifeContainer has exactly 3 .heart spans
  Array.from(lifeContainer.children).forEach((heart, i) => {
    heart.classList.toggle('full', i < lives);
    heart.classList.toggle('empty', i >= lives);
  });
}

// --- Word Challenge Data & UI ---
let challengeWords = [];

// load + filter wordlist.txt via XHR
function loadChallengeWords(callback) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', 'wordlist.txt', true);
  xhr.onreadystatechange = () => {
    if (xhr.readyState !== 4) return;

    if (xhr.status === 200) {
      // Split lines, uppercase, keep only A–Z, length 3–7
      const lines = xhr.responseText.split('\n');
      challengeWords = lines
        .map(w => w.trim().toUpperCase())
        .filter(w => /^[A-Z]+$/.test(w))
        .filter(w => w.length >= MIN_CHALLENGE_WORD_LENGTH && w.length <= MAX_CHALLENGE_WORD_LENGTH);
    } else {
      console.error('Could not load wordlist.txt; using fallback list.');
      challengeWords = ['DEFAULT','WORDS','HERE'];
    }

    // Now that challengeWords is populated, start the game
    callback();
  };
  xhr.send();
}

// then, instead of calling pickNewChallenge() right away, do:
loadChallengeWords(() => {
  pickNewChallenge();
  moveInterval = setInterval(moveSnake, gameSpeed);
  setInterval(spawnLetter, LETTER_SPAWN_RATE);
  requestAnimationFrame(drawLoop);

  // ← THIS IS THE KEY PART:
  wordInput.blur();
  paused = false;
});



/**
 * Picks a random challenge from `challengeWords`, but only
 * uses it if the dictionary API confirms it exists.
 */
async function pickNewChallenge() {
  // 1) First filter by length _and_ by duplicate‑letter cap
  const pool = challengeWords
    .filter(w =>
      w.length >= MIN_CHALLENGE_WORD_LENGTH &&
      w.length <= MAX_CHALLENGE_WORD_LENGTH &&
      // ensure no letter appears more than MAX_DUPLICATES times:
      Object.values(
        w.split('').reduce((freq, ch) => {
          freq[ch] = (freq[ch] || 0) + 1;
          return freq;
        }, {})
      ).every(count => count <= MAX_DUPLICATES)
    );

  if (!pool.length) {
    console.error("No words in pool after duplicate‑filter!");
    currentChallenge = "WORD";
    renderChallenge();
    animateChallengeDrop();
    startChallengeTimer();
    return;
  }

  let candidate;
  let isValid = false;

  // 2) Now do the dictionary API check on a shuffled copy
  let tries = [...pool]; // we’ll remove from here as we go
  while (tries.length && !isValid) {
    const idx       = Math.floor(Math.random() * tries.length);
    candidate       = tries.splice(idx, 1)[0];

    try {
      const res  = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${candidate.toLowerCase()}`
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          isValid = true;
        }
      }
    } catch {
      // ignore network / API glitches and keep trying
    }
  }

  // 3) Fallback if nothing passed
  currentChallenge = isValid ? candidate : "WORD";

  // 4) Render & animate
  renderChallenge();
  animateChallengeDrop();
  startChallengeTimer();
}


async function handleChallengeTimeout() {
  // 1) Lose one life
  lives = Math.max(0, lives - 1);
  renderLives();

  playSfx(sfxHeartLost);

  // 2) Apply penalty for the missed word
  const penalty = currentChallenge
    .split('')
    .reduce((sum, ch) => sum + (points[ch] || 0), 0);
  playerScore -= penalty;
  scoreValueEl.textContent = playerScore;

  // 3) If out of lives, do the full inventory‑drop + freeze + refill + teleport
  if (lives === 0) {
    // 3a) Snapshot the current tail segments
    const oldTail = snake.slice(1);

    // 3b) Deduct inventory points
    let invPenalty = 0;
    oldTail.forEach(seg => {
      if (seg.letter) invPenalty += (points[seg.letter] || 0);
    });
    playerScore -= invPenalty;
    scoreValueEl.textContent = playerScore;

    // 3c) Spill each letter onto the board at its segment’s x,y
    oldTail.forEach(seg => {
      if (seg.letter) {
        lettersOnBoard.push({
          x: seg.x,
          y: seg.y,
          letter: seg.letter
        });
      }
    });

    // 3d) Clear snake to just the head
    snake = [{ x: snake[0].x, y: snake[0].y, letter: null }];
    updateInventory();

    // 3e) STOP everything
    paused = true;
    clearTimeout(challengeInterval);
    // also freeze the CSS timer bar:
    const fill = document.getElementById('timerFill');
    fill.style.transition = 'none';
    fill.style.width = '0%';

    // 3f) Animate hearts refilling evenly over 2 seconds
    //    (we assume hearts start all .empty)
    const emptyHearts = Array.from(document.querySelectorAll('#lifeContainer .heart.empty'));
    const refillInterval = 2000 / emptyHearts.length;
    emptyHearts.forEach((heart, i) => {
      setTimeout(() => {
        heart.classList.replace('empty', 'full');
      }, refillInterval * (i + 1));
    });

    // 3g) After 2 seconds, teleport, reset lives, resume
    setTimeout(() => {
      playSfx(sfxHeartsRefill);
      // Teleport head to a random free cell
      const free = [];
      for (let x = 0; x < cols; x++) {
        for (let y = 0; y < rows; y++) {
          // avoid landing right on a tile or on the head itself
          if (
            !lettersOnBoard.some(t => t.x === x && t.y === y) &&
            !(x === snake[0].x && y === snake[0].y)
          ) free.push({ x, y });
        }
      }
      if (free.length) {
        const p = free[Math.floor(Math.random() * free.length)];
        snake[0].x = p.x;
        snake[0].y = p.y;
      }

      //  Reset lives to full and render
      lives = 3;
      renderLives();

      //  Resume movement & start new challenge
      paused = false;
      pickNewChallenge();     // also calls startChallengeTimer()
    }, 2000);

    return;
  }

  // 4) Otherwise (lives > 0): just drop the challenge tiles & pick a new one
  await animateChallengeFall();
  pickNewChallenge();
}



function startChallengeTimer() {
  clearInterval(challengeInterval); // Cancel any previous timers

  const timerFill = document.getElementById('timerFill');
  timerFill.style.transition = 'none';
  timerFill.style.width = '100%'; // Reset immediately

  // Wait a moment to allow DOM update before starting transition
  setTimeout(() => {
    timerFill.style.transition = `width ${challengeTime}s linear`;
    timerFill.style.width = '0%';
  }, 50);

  // Use setTimeout (not setInterval) to trigger the timeout action
  challengeInterval = setTimeout(() => {
    handleChallengeTimeout();
  }, challengeTime * 1000);
}


function renderChallenge() {
  challengeContainer.innerHTML = '';
  currentChallenge.split('').forEach(letter => {
    const tile = document.createElement('div');
    tile.className   = 'tile';
    tile.textContent = letter;
    const pt = document.createElement('div');
    pt.className     = 'tile-points';
    pt.textContent   = points[letter] || '';
    tile.appendChild(pt);
    challengeContainer.appendChild(tile);
  });
}

// Drop-in animation for new challenge tiles
function animateChallengeDrop() {
  const tiles = Array.from(challengeContainer.children);
  tiles.forEach((tile,i) => {
    tile.style.transform = 'translateY(-100px)';
    tile.style.opacity   = '0';
    setTimeout(() => {
      tile.style.transition = 'transform 0.5s ease, opacity 0.5s ease';
      tile.style.transform  = 'translateY(0)';
      tile.style.opacity    = '1';
    }, i * 100);
  });
}

// --- Inventory Rendering ---
function updateInventory() {
  letterInventoryEl.innerHTML = '';
  const counts = {};
  snake.slice(1).forEach(s => {
    if (s.letter) counts[s.letter] = (counts[s.letter]||0) + 1;
  });
  Object.entries(counts).forEach(([L,c]) => {
    const tile = document.createElement('div');
    tile.className   = 'tile';
    tile.textContent = L;
    const pt = document.createElement('div');
    pt.className     = 'tile-points';
    pt.textContent   = points[L];
    tile.appendChild(pt);
    if (c>1) {
      const cb = document.createElement('div');
      cb.className   = 'tile-count';
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
  if (overlayActive && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
    document.getElementById('startOverlay').style.display = 'none';
    overlayActive = false;
  }

  if (paused) return;
  if (e.key === 'ArrowUp'    && direction.y === 0) nextDirection = { x: 0, y: -1 };
  if (e.key === 'ArrowDown'  && direction.y === 0) nextDirection = { x: 0, y: 1 };
  if (e.key === 'ArrowLeft'  && direction.x === 0) nextDirection = { x: -1, y: 0 };
  if (e.key === 'ArrowRight' && direction.x === 0) nextDirection = { x: 1, y: 0 };
});



wordInput.addEventListener('focus',()=>paused=true);
wordInput.addEventListener('blur', ()=>paused=false);
wordInput.addEventListener('keydown', async e => {
  if (e.key==='Enter') {
    e.preventDefault();
    await handleWordSubmission(wordInput.value.trim().toUpperCase());
    wordInput.value='';
    updateInventory();
    wordInput.blur();
  }
});

// --- Snake Movement ---
function moveSnake() {
  if (paused) return;
  direction = nextDirection;
  const newX = snake[0].x + direction.x;
  const newY = snake[0].y + direction.y;

  for (let i=snake.length-1;i>0;i--) {
    snake[i].x=snake[i-1].x; snake[i].y=snake[i-1].y;
  }
  snake[0].x=newX; snake[0].y=newY;

  // self-collision
  for (let i=1;i<snake.length;i++){
    if (snake[i].x===newX && snake[i].y===newY){
      playSfx(sfxCrash);
      const oldTail=snake.slice(1);
      paused=true;
      triggerInventoryLossAnimation().then(()=>{
        oldTail.forEach(seg=>{
          if(seg.letter) lettersOnBoard.push({x:seg.x,y:seg.y,letter:seg.letter});
        });
        snake=[{x:newX,y:newY,letter:null}];
        updateInventory();
        paused=false;
      });
      return;
    }
  }


  // 4. Letter pickup with max‑2 cap
const idx = lettersOnBoard.findIndex(t => t.x === newX && t.y === newY);
if (idx !== -1) {
  const L = lettersOnBoard[idx].letter;

  // count how many of L we already have
  const haveCount = snake.slice(1).filter(s => s.letter === L).length;
  if (haveCount < 2) {
    // remove from board and grow
    lettersOnBoard.splice(idx, 1);
    playSfx(sfxLetter);
    headBounce = 15;
    // … pulse glow down the snake …
    const tail = snake[snake.length - 1];
    snake.push({ x: tail.x, y: tail.y, letter: L });
    updateInventory();
  }
  // otherwise we ignore it (leave it on the board)
}

}

// --- Drawing ---
function draw() {
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const offX = canvas.width/2 - snake[0].x*tileSize;
  const offY = canvas.height/2 - snake[0].y*tileSize;
  ctx.setTransform(1,0,0,1,offX,offY);

  glowingTiles = glowingTiles.filter(g=>{
    const alpha=Math.max(0,Math.min(1,g.frames/10));
    ctx.save();
    ctx.shadowColor=`rgba(255,255,255,${alpha})`;
    ctx.shadowBlur=15;
    ctx.fillStyle=`rgba(255,255,255,${alpha*0.3})`;
    ctx.fillRect(g.x*tileSize,g.y*tileSize,tileSize,tileSize);
    ctx.restore();
    g.frames--; return g.frames>0;
  });

  snake.forEach((seg,i)=>{
    let px=seg.x*tileSize,py=seg.y*tileSize,size=tileSize-2;
    if(i===0 && headBounce>0){
      const sc=1+0.1*(headBounce/5),ds=size*(sc-1);
      px-=ds/2;py-=ds/2;size+=ds;headBounce--;
    }
    ctx.fillStyle='#ffe6a8';
    ctx.fillRect(px,py,size,size);
    if(seg.letter){
      ctx.fillStyle='black';
      ctx.font=`${tileSize-6}px monospace`;
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(seg.letter,px+size/2,py+size/2);
    }
  });

  ctx.fillStyle='white';
  ctx.font=`${tileSize-4}px monospace`;
  ctx.textAlign='center';ctx.textBaseline='middle';
  lettersOnBoard.forEach(t=>{
    ctx.fillText(t.letter,t.x*tileSize+tileSize/2,t.y*tileSize+tileSize/2);
  });
}

function drawLoop(){
  draw();
  requestAnimationFrame(drawLoop);
}

// --- Letter Spawning ---
function spawnLetter() {
  const R  = 50;
  const hx = snake[0].x;
  const hy = snake[0].y;
  const L  = letterBag[Math.floor(Math.random() * letterBag.length)];

  // pick a random spot in the R‐radius square:
  const x = Math.floor(hx - R + Math.random() * (2 * R + 1));
  const y = Math.floor(hy - R + Math.random() * (2 * R + 1));

  // only place if it passes our spacing rules:
  if (canPlaceLetter(x, y)) {
    lettersOnBoard.push({ x, y, letter: L });
  }
}


// --- Inventory-Loss Animation ---
async function triggerInventoryLossAnimation(){
  letterInventoryEl.classList.add('shake');
  await new Promise(r=>setTimeout(r,600));
  const tiles=Array.from(letterInventoryEl.children);
  tiles.forEach(t=>setTimeout(()=>t.classList.add('fall'),Math.random()*300));
  await new Promise(r=>setTimeout(r,1400));
  let deduction=0;
  tiles.forEach(t=>{
    const L=t.textContent.trim()[0],
          cnt=parseInt(t.querySelector('.tile-count')?.textContent||'1',10);
    deduction += (points[L]||0)*cnt;
  });
  playerScore-=deduction;
  letterInventoryEl.classList.remove('shake');
  letterInventoryEl.innerHTML='';
  scoreValueEl.textContent=playerScore;
}

// --- Word Submission & Scoring ---
async function handleWordSubmission(input) {
  if (!input) return;

  // ← NEW: only the exact challenge word is acceptable
  if (input !== currentChallenge) {
    flashInputError();
    return;
  }

  // 1) Build list of body segments (skip head)
  const body  = snake.slice(1);
  const pairs = body.map((s, i) => ({ letter: s.letter, index: i + 1 }));
  const used  = [];

  // 2) (Optional) you can skip the “can form” loop, 
  //    since you *know* you spelled the exact challenge
  for (let ch of input) {
    const m = pairs.find(p => p.letter === ch && !used.includes(p.index));
    if (!m) {
      flashInputError();  
      return; 
    }
    used.push(m.index);
  }


  // 4) Remove & reposition segments (unchanged)
  const oldPos = snake.map(s => ({ x: s.x, y: s.y }));
  used.sort((a, b) => b - a).forEach(i => snake.splice(i, 1));
  const kept = oldPos.map((_, i) => i).filter(i => !used.includes(i));
  for (let i = 1; i < snake.length; i++) {
    const oi = kept[i];
    snake[i].x = oldPos[oi].x;
    snake[i].y = oldPos[oi].y;
  }

  // 5) Score & feedback
  updateInventory();
  let wordScore = 0;
  for (let ch of input) wordScore += points[ch] || 0;
  playerScore += wordScore;

  playSfx(sfxSubmit);
  flashInputSuccess();

  // 6) Animate challenge‐tiles falling & pick a new one
  await animateChallengeFall();
  pickNewChallenge();
}



// --- Animate challenge tiles falling ---
async function animateChallengeFall(){
  const tiles=Array.from(challengeContainer.children);
  tiles.forEach((t,i)=>setTimeout(()=>t.classList.add('fall'),i*100));
  await new Promise(r=>setTimeout(r,tiles.length*100+1600));
  tiles.forEach(t=>t.remove());
}

// --- Input Feedback ---
function flashInputSuccess(){
  wordInput.classList.add('success');
  setTimeout(()=>wordInput.classList.remove('success'),600);
}
function flashInputError(){
  wordInput.classList.add('error');
  setTimeout(()=>wordInput.classList.remove('error'),400);
}

renderLives();