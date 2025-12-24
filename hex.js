// Hexagonal grid with lazy coloring and encircling detection
// Each hex has 50% chance of being black or white when first tested

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
const statusDiv = document.getElementById('status');

// Hex grid parameters
const HEX_SIZE = 25;
const HEX_WIDTH = Math.sqrt(3) * HEX_SIZE;
const HEX_HEIGHT = 2 * HEX_SIZE;

// State
let hexColors = new Map(); // "q,r" -> true (white) or false (black)
let startHex = null;
let isRunning = false;
let panOffset = { x: 0, y: 0 };
let isDragging = false;
let lastMouse = { x: 0, y: 0 };

// Axial coordinate helpers for pointy-top hexagons
function axialToPixel(q, r) {
    const x = HEX_WIDTH * (q + r / 2);
    const y = HEX_HEIGHT * 0.75 * r;
    return { x, y };
}

function pixelToAxial(px, py) {
    const q = (px * Math.sqrt(3) / 3 - py / 3) / HEX_SIZE;
    const r = (py * 2 / 3) / HEX_SIZE;
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

function hexKey(q, r) {
    return `${q},${r}`;
}

// Get the 6 neighbors of a hex (axial coordinates)
function getNeighbors(q, r) {
    return [
        { q: q + 1, r: r },
        { q: q + 1, r: r - 1 },
        { q: q, r: r - 1 },
        { q: q - 1, r: r },
        { q: q - 1, r: r + 1 },
        { q: q, r: r + 1 }
    ];
}

// Get or assign color to a hex (lazy evaluation)
function getHexColor(q, r) {
    const key = hexKey(q, r);
    if (!hexColors.has(key)) {
        // 50% chance white (true), 50% chance black (false)
        hexColors.set(key, Math.random() < 0.5);
    }
    return hexColors.get(key);
}

// Set a hex to a specific color
function setHexColor(q, r, isWhite) {
    hexColors.set(hexKey(q, r), isWhite);
}

// Draw a single hexagon
function drawHex(q, r, fillColor, strokeColor = '#333') {
    const { x, y } = axialToPixel(q, r);
    const screenX = x + canvas.width / 2 + panOffset.x;
    const screenY = y + canvas.height / 2 + panOffset.y;

    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 180 * (60 * i - 30);
        const hx = screenX + HEX_SIZE * Math.cos(angle);
        const hy = screenY + HEX_SIZE * Math.sin(angle);
        if (i === 0) {
            ctx.moveTo(hx, hy);
        } else {
            ctx.lineTo(hx, hy);
        }
    }
    ctx.closePath();

    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1;
    ctx.stroke();
}

// Render the current state
function render() {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Calculate visible hex range
    const centerPixelX = -panOffset.x;
    const centerPixelY = -panOffset.y;
    const viewRadius = Math.max(canvas.width, canvas.height) / HEX_SIZE + 5;

    // Draw grid background (uncolored hexes)
    const centerAxial = pixelToAxial(centerPixelX, centerPixelY);
    const range = Math.ceil(viewRadius / 1.5);

    for (let dq = -range; dq <= range; dq++) {
        for (let dr = -range; dr <= range; dr++) {
            const q = centerAxial.q + dq;
            const r = centerAxial.r + dr;
            const key = hexKey(q, r);

            if (!hexColors.has(key)) {
                // Uncolored - show as gray outline
                drawHex(q, r, 'transparent', '#2a2a4a');
            }
        }
    }

    // Draw colored hexes
    for (const [key, isWhite] of hexColors) {
        const [q, r] = key.split(',').map(Number);
        const color = isWhite ? '#ffffff' : '#000000';
        const stroke = isWhite ? '#aaa' : '#444';
        drawHex(q, r, color, stroke);
    }

    // Highlight start hex
    if (startHex) {
        const { x, y } = axialToPixel(startHex.q, startHex.r);
        const screenX = x + canvas.width / 2 + panOffset.x;
        const screenY = y + canvas.height / 2 + panOffset.y;

        ctx.beginPath();
        ctx.arc(screenX, screenY, HEX_SIZE * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = '#4488ff';
        ctx.fill();
    }
}

// Check if the start hex can escape to infinity through white hexes
// Uses BFS with a distance limit - if we reach the limit, we "escaped"
async function checkEncirclement(startQ, startR) {
    const ESCAPE_DISTANCE = 50; // If we reach this far, consider it escaped
    const ANIMATION_DELAY = 20; // ms between steps

    const visited = new Set();
    const queue = [{ q: startQ, r: startR, dist: 0 }];
    visited.add(hexKey(startQ, startR));

    let maxDistReached = 0;

    while (queue.length > 0) {
        const { q, r, dist } = queue.shift();
        maxDistReached = Math.max(maxDistReached, dist);

        statusDiv.textContent = `Exploring... Distance: ${dist}, Frontier: ${queue.length}`;

        if (dist >= ESCAPE_DISTANCE) {
            return { escaped: true, distance: dist };
        }

        // Check all neighbors
        const neighbors = getNeighbors(q, r);
        for (const n of neighbors) {
            const key = hexKey(n.q, n.r);
            if (visited.has(key)) continue;
            visited.add(key);

            // Color this hex (lazy evaluation)
            const isWhite = getHexColor(n.q, n.r);

            // Animate
            render();
            await sleep(ANIMATION_DELAY);

            if (isWhite) {
                // Can continue through white hex
                queue.push({ q: n.q, r: n.r, dist: dist + 1 });
            }
            // Black hex blocks the path
        }
    }

    // Queue exhausted - we're encircled
    return { escaped: false, distance: maxDistReached };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Handle canvas click
function handleClick(e) {
    if (isDragging || isRunning) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - canvas.width / 2 - panOffset.x;
    const mouseY = e.clientY - rect.top - canvas.height / 2 - panOffset.y;

    const hex = pixelToAxial(mouseX, mouseY);

    if (!startHex) {
        // First click - set start hex as white
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

    if (result.escaped) {
        statusDiv.textContent = `ESCAPED! Reached distance ${result.distance}`;
        statusDiv.className = 'escaped';
    } else {
        statusDiv.textContent = `ENCIRCLED! Max distance: ${result.distance}`;
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

// Initialize
resize();
