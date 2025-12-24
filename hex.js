// Hexagonal grid with lazy coloring and encircling detection
// Each hex has 50% chance of being black or white when first tested

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
const statusDiv = document.getElementById('status');
const zoomSlider = document.getElementById('zoomSlider');
const zoomValue = document.getElementById('zoomValue');
const speedSlider = document.getElementById('speedSlider');
const speedValue = document.getElementById('speedValue');

// Hex grid parameters
const BASE_HEX_SIZE = 25;
let zoomLevel = 1;
let speedMultiplier = 1;

// Precompute hex vertex angles (pointy-top)
const HEX_ANGLES = [];
for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i - 30);
    HEX_ANGLES.push({ cos: Math.cos(angle), sin: Math.sin(angle) });
}

// Neighbor offsets (static, no allocation per call)
const NEIGHBOR_OFFSETS = [
    [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]
];

// Numeric key encoding/decoding (avoids string allocation/parsing)
// Supports coords from -50000 to +49999
const KEY_OFFSET = 50000;
const KEY_MULTIPLIER = 100000;

function numKey(q, r) {
    return (q + KEY_OFFSET) * KEY_MULTIPLIER + (r + KEY_OFFSET);
}

function decodeKey(key) {
    const q = Math.floor(key / KEY_MULTIPLIER) - KEY_OFFSET;
    const r = (key % KEY_MULTIPLIER) - KEY_OFFSET;
    return { q, r };
}

function getHexSize() {
    return BASE_HEX_SIZE * zoomLevel;
}

function getHexWidth() {
    return Math.sqrt(3) * getHexSize();
}

function getHexHeight() {
    return 2 * getHexSize();
}

// State - using numeric keys for performance
let hexColors = new Map(); // numKey(q,r) -> true (white) or false (black)
let startHex = null;
let isRunning = false;
let panOffset = { x: 0, y: 0 };
let isDragging = false;
let lastMouse = { x: 0, y: 0 };

// Axial coordinate helpers for pointy-top hexagons
function axialToPixel(q, r) {
    const x = getHexWidth() * (q + r / 2);
    const y = getHexHeight() * 0.75 * r;
    return { x, y };
}

function pixelToAxial(px, py) {
    const hexSize = getHexSize();
    const q = (px * Math.sqrt(3) / 3 - py / 3) / hexSize;
    const r = (py * 2 / 3) / hexSize;
    return axialRound(q, r);
}

function axialRound(q, r) {
    const s = -q - r;
    let rq = Math.round(q);
    let rr = Math.round(r);
    let rs = Math.round(s);

    const qDiff = Math.abs(rq - q);
    const rDiff = Math.abs(rr - r);
    const sDiff = Math.abs(rs - s);

    if (qDiff > rDiff && qDiff > sDiff) {
        rq = -rr - rs;
    } else if (rDiff > sDiff) {
        rr = -rq - rs;
    }

    return { q: rq, r: rr };
}

// Get or assign color to a hex (lazy evaluation)
function getHexColor(q, r) {
    const key = numKey(q, r);
    let color = hexColors.get(key);
    if (color === undefined) {
        color = Math.random() < 0.5;
        hexColors.set(key, color);
    }
    return color;
}

function setHexColor(q, r, isWhite) {
    hexColors.set(numKey(q, r), isWhite);
}

// Check if a hex is visible on screen
function isHexVisible(q, r, margin = 1) {
    const { x, y } = axialToPixel(q, r);
    const screenX = x + canvas.width / 2 + panOffset.x;
    const screenY = y + canvas.height / 2 + panOffset.y;
    const hexSize = getHexSize();
    const m = hexSize * margin;
    return screenX > -m && screenX < canvas.width + m &&
           screenY > -m && screenY < canvas.height + m;
}

// Draw a single hexagon path (no fill/stroke - caller batches those)
function drawHexPath(screenX, screenY, hexSize) {
    ctx.moveTo(screenX + hexSize * HEX_ANGLES[0].cos, screenY + hexSize * HEX_ANGLES[0].sin);
    for (let i = 1; i < 6; i++) {
        ctx.lineTo(screenX + hexSize * HEX_ANGLES[i].cos, screenY + hexSize * HEX_ANGLES[i].sin);
    }
    ctx.closePath();
}

// Render the current state - optimized
function render() {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const hexSize = getHexSize();
    const halfW = canvas.width / 2;
    const halfH = canvas.height / 2;
    const lineWidth = Math.max(0.5, zoomLevel);

    // Collect visible hexes by color
    const whiteHexes = [];
    const blackHexes = [];

    for (const [key, isWhite] of hexColors) {
        const { q, r } = decodeKey(key);
        if (!isHexVisible(q, r)) continue;

        const { x, y } = axialToPixel(q, r);
        const screenX = x + halfW + panOffset.x;
        const screenY = y + halfH + panOffset.y;

        if (isWhite) {
            whiteHexes.push({ screenX, screenY });
        } else {
            blackHexes.push({ screenX, screenY });
        }
    }

    // Draw black hexes batched
    if (blackHexes.length > 0) {
        ctx.beginPath();
        for (const { screenX, screenY } of blackHexes) {
            drawHexPath(screenX, screenY, hexSize);
        }
        ctx.fillStyle = '#000000';
        ctx.fill();
        ctx.strokeStyle = '#444';
        ctx.lineWidth = lineWidth;
        ctx.stroke();
    }

    // Draw white hexes batched
    if (whiteHexes.length > 0) {
        ctx.beginPath();
        for (const { screenX, screenY } of whiteHexes) {
            drawHexPath(screenX, screenY, hexSize);
        }
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#aaa';
        ctx.lineWidth = lineWidth;
        ctx.stroke();
    }

    // Highlight start hex
    if (startHex) {
        const { x, y } = axialToPixel(startHex.q, startHex.r);
        const screenX = x + halfW + panOffset.x;
        const screenY = y + halfH + panOffset.y;

        ctx.beginPath();
        ctx.arc(screenX, screenY, hexSize * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = '#4488ff';
        ctx.fill();
    }
}

// Check if the start hex can escape to infinity through white hexes
// Uses BFS with index-based queue and numeric keys
async function checkEncirclement(startQ, startR) {
    const ESCAPE_DISTANCE = 1000;
    const BASE_MAX_DELAY = 50;
    const BASE_MIN_DELAY = 1;

    const visited = new Set();
    // Use parallel arrays for queue to avoid object allocation
    const queueQ = [startQ];
    const queueR = [startR];
    const queueDist = [0];
    let queueHead = 0;
    visited.add(numKey(startQ, startR));

    let maxDistReached = 0;
    let stepCount = 0;
    let lastRenderTime = performance.now();

    while (queueHead < queueQ.length) {
        const q = queueQ[queueHead];
        const r = queueR[queueHead];
        const dist = queueDist[queueHead++];
        maxDistReached = Math.max(maxDistReached, dist);

        const exposedCount = queueQ.length - queueHead + 1;
        const isMaxSpeed = speedMultiplier === Infinity;
        const baseDelay = Math.max(BASE_MIN_DELAY, BASE_MAX_DELAY / Math.sqrt(exposedCount));
        const delay = isMaxSpeed ? 0 : baseDelay / speedMultiplier;

        if (dist >= ESCAPE_DISTANCE) {
            render();
            return { escaped: true, distance: dist };
        }

        for (let i = 0; i < 6; i++) {
            const nq = q + NEIGHBOR_OFFSETS[i][0];
            const nr = r + NEIGHBOR_OFFSETS[i][1];
            const nk = numKey(nq, nr);

            if (visited.has(nk)) continue;
            visited.add(nk);

            const isWhite = getHexColor(nq, nr);
            stepCount++;

            // Adaptive batching based on speed and frontier size
            const batchSize = isMaxSpeed
                ? Math.max(500, exposedCount * 2)
                : Math.max(1, Math.floor(exposedCount / 5 * speedMultiplier));

            if (stepCount % batchSize === 0) {
                const now = performance.now();
                if (now - lastRenderTime > 16) {
                    statusDiv.textContent = `Distance: ${dist} | Frontier: ${exposedCount} | Visited: ${visited.size}`;
                    render();
                    lastRenderTime = now;
                }

                if (!isMaxSpeed && delay > 0) {
                    await sleep(delay);
                } else if (stepCount % 2000 === 0) {
                    await sleep(0);
                }
            }

            if (isWhite) {
                queueQ.push(nq);
                queueR.push(nr);
                queueDist.push(dist + 1);
            }
        }
    }

    render();
    return { escaped: false, distance: maxDistReached };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Find all pockets of untested hexes completely surrounded by black
function findEncircledPockets() {
    const pocketSizes = [];
    const checkedUntested = new Set();

    // Collect candidate untested hexes adjacent to black
    const candidates = [];
    const candidateSet = new Set();

    for (const [key, isWhite] of hexColors) {
        if (isWhite) continue;
        const { q, r } = decodeKey(key);

        for (let i = 0; i < 6; i++) {
            const nq = q + NEIGHBOR_OFFSETS[i][0];
            const nr = r + NEIGHBOR_OFFSETS[i][1];
            const nk = numKey(nq, nr);

            if (!hexColors.has(nk) && !candidateSet.has(nk)) {
                candidateSet.add(nk);
                candidates.push(nk);
            }
        }
    }

    // Flood fill each candidate region
    for (const startNk of candidates) {
        if (checkedUntested.has(startNk)) continue;

        const { q: startQ, r: startR } = decodeKey(startNk);
        const queueQ = [startQ];
        const queueR = [startR];
        let queueHead = 0;
        let pocketSize = 0;

        const visited = new Set([startNk]);
        let touchesWhite = false;
        const MAX_POCKET_SIZE = 10000;

        while (queueHead < queueQ.length) {
            const q = queueQ[queueHead];
            const r = queueR[queueHead++];
            pocketSize++;
            checkedUntested.add(numKey(q, r));

            if (pocketSize > MAX_POCKET_SIZE) break;

            for (let i = 0; i < 6; i++) {
                const nq = q + NEIGHBOR_OFFSETS[i][0];
                const nr = r + NEIGHBOR_OFFSETS[i][1];
                const nk = numKey(nq, nr);

                if (visited.has(nk)) continue;
                visited.add(nk);

                const colorValue = hexColors.get(nk);
                if (colorValue !== undefined) {
                    if (colorValue) touchesWhite = true;
                } else {
                    queueQ.push(nq);
                    queueR.push(nr);
                }
            }
        }

        if (!touchesWhite && pocketSize <= MAX_POCKET_SIZE && pocketSize > 0) {
            pocketSizes.push(pocketSize);
        }
    }

    return pocketSizes;
}

// Handle canvas click
function handleClick(e) {
    if (isDragging || isRunning) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - canvas.width / 2 - panOffset.x;
    const mouseY = e.clientY - rect.top - canvas.height / 2 - panOffset.y;

    const hex = pixelToAxial(mouseX, mouseY);

    if (!startHex) {
        startHex = hex;
        setHexColor(hex.q, hex.r, true);
        render();
        startBtn.textContent = 'Check Encirclement';
        startBtn.disabled = false;
    }
}

// Start the encirclement check
async function startCheck() {
    if (!startHex || isRunning) return;

    isRunning = true;
    startBtn.disabled = true;
    resetBtn.disabled = true;
    statusDiv.className = '';

    const result = await checkEncirclement(startHex.q, startHex.r);

    // Find encircled pockets (untested regions surrounded by black)
    statusDiv.textContent = 'Analyzing pockets...';
    await sleep(0);
    const pocketSizes = findEncircledPockets();
    const numPockets = pocketSizes.length;
    const maxPocketSize = pocketSizes.length > 0 ? Math.max(...pocketSizes) : 0;
    const totalPocketArea = pocketSizes.reduce((sum, s) => sum + s, 0);

    const pocketInfo = numPockets > 0
        ? ` | Pockets: ${numPockets} (max: ${maxPocketSize}, total: ${totalPocketArea})`
        : ' | No pockets';

    if (result.escaped) {
        statusDiv.textContent = `ESCAPED! Distance ${result.distance}${pocketInfo}`;
        statusDiv.className = 'escaped';
    } else {
        statusDiv.textContent = `ENCIRCLED! Max dist: ${result.distance}${pocketInfo}`;
        statusDiv.className = 'encircled';
    }

    isRunning = false;
    resetBtn.disabled = false;
}

// Reset everything
function reset() {
    hexColors.clear();
    startHex = null;
    isRunning = false;
    startBtn.textContent = 'Click a hexagon to start';
    startBtn.disabled = true;
    statusDiv.textContent = '';
    statusDiv.className = '';
    render();
}

// Pan handling
canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
        isDragging = false;
        lastMouse = { x: e.clientX, y: e.clientY };
    }
});

canvas.addEventListener('mousemove', (e) => {
    if (e.buttons === 1) {
        const dx = e.clientX - lastMouse.x;
        const dy = e.clientY - lastMouse.y;

        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            isDragging = true;
        }

        if (isDragging) {
            panOffset.x += dx;
            panOffset.y += dy;
            lastMouse = { x: e.clientX, y: e.clientY };
            render();
        }
    }
});

canvas.addEventListener('mouseup', (e) => {
    if (!isDragging) {
        handleClick(e);
    }
    isDragging = false;
});

// Resize handling
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    render();
}

window.addEventListener('resize', resize);

// Button handlers
startBtn.addEventListener('click', startCheck);
resetBtn.addEventListener('click', reset);
startBtn.disabled = true;

// Zoom control
function setZoom(newZoom) {
    zoomLevel = Math.max(0.05, Math.min(2, newZoom));
    zoomSlider.value = zoomLevel;
    zoomValue.textContent = zoomLevel < 0.1 ? zoomLevel.toFixed(2) + 'x' : zoomLevel.toFixed(1) + 'x';
    render();
}

zoomSlider.addEventListener('input', (e) => {
    setZoom(parseFloat(e.target.value));
});

// Mouse wheel / trackpad zoom
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomDelta = e.deltaY > 0 ? -0.05 : 0.05;
    setZoom(zoomLevel + zoomDelta);
}, { passive: false });

// Speed control
function sliderToSpeed(val) {
    if (val >= 5) return Infinity;
    return 0.25 * Math.pow(2, val);
}

function speedToLabel(speed) {
    if (speed === Infinity) return 'MAX';
    if (speed < 1) return speed.toFixed(2) + 'x';
    if (speed >= 10) return Math.round(speed) + 'x';
    return speed.toFixed(1) + 'x';
}

function updateSpeedFromSlider(val) {
    speedMultiplier = sliderToSpeed(val);
    speedValue.textContent = speedToLabel(speedMultiplier);
}

speedSlider.addEventListener('input', (e) => {
    updateSpeedFromSlider(parseFloat(e.target.value));
});

// Initialize
updateSpeedFromSlider(parseFloat(speedSlider.value));
resize();
