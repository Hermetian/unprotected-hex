// Hexagonal grid with lazy coloring and encircling detection
// WebGL instanced rendering for massive performance

const canvas = document.getElementById('canvas');
const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
const statusDiv = document.getElementById('status');
const zoomSlider = document.getElementById('zoomSlider');
const zoomValue = document.getElementById('zoomValue');
const speedSlider = document.getElementById('speedSlider');
const speedValue = document.getElementById('speedValue');
const modeSelect = document.getElementById('modeSelect');

// Game mode
let gameMode = 'escape';  // 'escape' | 'hexvshex'

// WebGL setup
const gl = canvas.getContext('webgl2');
if (!gl) {
    alert('WebGL2 not supported');
    throw new Error('WebGL2 not supported');
}

// Hex grid parameters
const BASE_HEX_SIZE = 25;
let zoomLevel = 1;
let speedMultiplier = 1;

// Neighbor offsets
const NEIGHBOR_OFFSETS = [
    [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]
];

// Numeric key encoding
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

// State
let hexColors = new Map();      // numKey -> true (white) or false (black)
let hexInstances = [];          // Array of {q, r, color} for GPU upload
let instanceBufferDirty = true;
let startHex = null;
let isRunning = false;
let panOffset = { x: 0, y: 0 };
let isDragging = false;
let lastMouse = { x: 0, y: 0 };

// Run history - persistent (escape mode)
const STORAGE_KEY = 'unprotected-hex-runs';
let runHistory = [];  // Array of {escaped, distance, hexCount, timestamp, interrupted}
let currentRunId = null;  // Track in-progress run

// Hex vs Hex run history - persistent (separate from escape mode)
const HVH_STORAGE_KEY = 'unprotected-hex-hvh-runs';
let hvhRunHistory = [];  // Array of {winner, distance, hexCount, timestamp, interrupted}
let hvhCurrentRunId = null;

function loadRunHistory() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            runHistory = JSON.parse(saved);
            // Mark any "in-progress" runs from previous sessions as interrupted
            for (const run of runHistory) {
                if (run.inProgress) {
                    run.inProgress = false;
                    run.interrupted = true;
                }
            }
            saveRunHistory();
        }
    } catch (e) {
        console.error('Failed to load run history:', e);
        runHistory = [];
    }
}

function saveRunHistory() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(runHistory));
    } catch (e) {
        console.error('Failed to save run history:', e);
    }
}

function startRun() {
    currentRunId = runHistory.length;
    runHistory.push({
        escaped: null,
        distance: 0,
        hexCount: 0,
        timestamp: Date.now(),
        interrupted: false,
        inProgress: true
    });
    saveRunHistory();
}

function endRun(escaped, distance) {
    if (currentRunId !== null && runHistory[currentRunId]) {
        runHistory[currentRunId].escaped = escaped;
        runHistory[currentRunId].distance = distance;
        runHistory[currentRunId].hexCount = hexInstances.length;
        runHistory[currentRunId].inProgress = false;
        saveRunHistory();
        currentRunId = null;
    }
}

function interruptRun(distanceSoFar) {
    if (currentRunId !== null && runHistory[currentRunId]) {
        runHistory[currentRunId].distance = distanceSoFar;
        runHistory[currentRunId].hexCount = hexInstances.length;
        runHistory[currentRunId].interrupted = true;
        runHistory[currentRunId].inProgress = false;
        saveRunHistory();
        currentRunId = null;
    }
}

function getRunStats() {
    const completed = runHistory.filter(r => !r.interrupted);
    const escaped = completed.filter(r => r.escaped).length;
    const encircled = completed.filter(r => r.escaped === false).length;
    const interrupted = runHistory.filter(r => r.interrupted).length;
    return { total: runHistory.length, escaped, encircled, interrupted };
}

// Hex vs Hex history functions
function loadHvhHistory() {
    try {
        const saved = localStorage.getItem(HVH_STORAGE_KEY);
        if (saved) {
            hvhRunHistory = JSON.parse(saved);
            for (const run of hvhRunHistory) {
                if (run.inProgress) {
                    run.inProgress = false;
                    run.interrupted = true;
                }
            }
            saveHvhHistory();
        }
    } catch (e) {
        console.error('Failed to load hvh run history:', e);
        hvhRunHistory = [];
    }
}

function saveHvhHistory() {
    try {
        localStorage.setItem(HVH_STORAGE_KEY, JSON.stringify(hvhRunHistory));
    } catch (e) {
        console.error('Failed to save hvh run history:', e);
    }
}

function startHvhRun() {
    hvhCurrentRunId = hvhRunHistory.length;
    hvhRunHistory.push({
        winner: null,  // 'white', 'black', or 'unresolved'
        distance: 0,
        hexCount: 0,
        timestamp: Date.now(),
        interrupted: false,
        inProgress: true
    });
    saveHvhHistory();
}

function endHvhRun(winner, distance) {
    if (hvhCurrentRunId !== null && hvhRunHistory[hvhCurrentRunId]) {
        hvhRunHistory[hvhCurrentRunId].winner = winner;
        hvhRunHistory[hvhCurrentRunId].distance = distance;
        hvhRunHistory[hvhCurrentRunId].hexCount = hexInstances.length;
        hvhRunHistory[hvhCurrentRunId].inProgress = false;
        saveHvhHistory();
        hvhCurrentRunId = null;
    }
}

function interruptHvhRun(distanceSoFar) {
    if (hvhCurrentRunId !== null && hvhRunHistory[hvhCurrentRunId]) {
        hvhRunHistory[hvhCurrentRunId].distance = distanceSoFar;
        hvhRunHistory[hvhCurrentRunId].hexCount = hexInstances.length;
        hvhRunHistory[hvhCurrentRunId].interrupted = true;
        hvhRunHistory[hvhCurrentRunId].inProgress = false;
        saveHvhHistory();
        hvhCurrentRunId = null;
    }
}

function getHvhStats() {
    const completed = hvhRunHistory.filter(r => !r.interrupted);
    const whiteWins = completed.filter(r => r.winner === 'white').length;
    const blackWins = completed.filter(r => r.winner === 'black').length;
    const unresolved = completed.filter(r => r.winner === 'unresolved').length;
    const interrupted = hvhRunHistory.filter(r => r.interrupted).length;
    return { total: hvhRunHistory.length, whiteWins, blackWins, unresolved, interrupted };
}

// Track current distance for interruption
let currentMaxDist = 0;

// Handle page unload during run
window.addEventListener('beforeunload', () => {
    if (isRunning) {
        if (gameMode === 'escape') {
            interruptRun(currentMaxDist);
        } else {
            interruptHvhRun(currentMaxDist);
        }
    }
});

// Shaders
const vertexShaderSource = `#version 300 es
precision highp float;

// Per-vertex (hex geometry)
in vec2 a_vertex;

// Per-instance
in vec2 a_hexCoord;  // q, r
in float a_color;    // 0 = black, 1 = white

uniform vec2 u_resolution;
uniform vec2 u_pan;
uniform float u_hexSize;
uniform float u_hexWidth;
uniform float u_hexHeight;

out vec3 v_color;

void main() {
    // Axial to pixel
    float px = u_hexWidth * (a_hexCoord.x + a_hexCoord.y / 2.0);
    float py = u_hexHeight * 0.75 * a_hexCoord.y;

    // Apply hex size to vertex, then translate
    vec2 pos = a_vertex * u_hexSize + vec2(px, py) + u_pan + u_resolution / 2.0;

    // Convert to clip space
    vec2 clipSpace = (pos / u_resolution) * 2.0 - 1.0;
    gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);

    // Color
    v_color = a_color > 0.5 ? vec3(1.0, 1.0, 1.0) : vec3(0.2, 0.2, 0.25);
}
`;

const fragmentShaderSource = `#version 300 es
precision highp float;

in vec3 v_color;
out vec4 fragColor;

void main() {
    fragColor = vec4(v_color, 1.0);
}
`;

// Compile shader
function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

// Create program
function createProgram(gl, vertexShader, fragmentShader) {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    return program;
}

// Initialize WebGL
const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
const program = createProgram(gl, vertexShader, fragmentShader);

// Get locations
const a_vertex = gl.getAttribLocation(program, 'a_vertex');
const a_hexCoord = gl.getAttribLocation(program, 'a_hexCoord');
const a_color = gl.getAttribLocation(program, 'a_color');
const u_resolution = gl.getUniformLocation(program, 'u_resolution');
const u_pan = gl.getUniformLocation(program, 'u_pan');
const u_hexSize = gl.getUniformLocation(program, 'u_hexSize');
const u_hexWidth = gl.getUniformLocation(program, 'u_hexWidth');
const u_hexHeight = gl.getUniformLocation(program, 'u_hexHeight');

// Create hex geometry (6 triangles from center, pointy-top)
const hexVertices = [0, 0]; // center
for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i - 30);
    hexVertices.push(Math.cos(angle), Math.sin(angle));
}
// Triangle fan indices: center + 6 outer vertices + repeat first outer to close
const hexIndices = [];
for (let i = 0; i < 6; i++) {
    hexIndices.push(0, i + 1, ((i + 1) % 6) + 1);
}

// Create VAO
const vao = gl.createVertexArray();
gl.bindVertexArray(vao);

// Hex geometry buffer (static)
const hexVertexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, hexVertexBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(hexVertices), gl.STATIC_DRAW);
gl.enableVertexAttribArray(a_vertex);
gl.vertexAttribPointer(a_vertex, 2, gl.FLOAT, false, 0, 0);

// Index buffer
const hexIndexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, hexIndexBuffer);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(hexIndices), gl.STATIC_DRAW);

// Instance buffers (dynamic)
const instanceCoordBuffer = gl.createBuffer();
const instanceColorBuffer = gl.createBuffer();

// Set up instanced attributes
gl.bindBuffer(gl.ARRAY_BUFFER, instanceCoordBuffer);
gl.enableVertexAttribArray(a_hexCoord);
gl.vertexAttribPointer(a_hexCoord, 2, gl.FLOAT, false, 0, 0);
gl.vertexAttribDivisor(a_hexCoord, 1); // per instance

gl.bindBuffer(gl.ARRAY_BUFFER, instanceColorBuffer);
gl.enableVertexAttribArray(a_color);
gl.vertexAttribPointer(a_color, 1, gl.FLOAT, false, 0, 0);
gl.vertexAttribDivisor(a_color, 1); // per instance

gl.bindVertexArray(null);

// Coordinate helpers
function getHexSize() {
    return BASE_HEX_SIZE * zoomLevel;
}

function getHexWidth() {
    return Math.sqrt(3) * getHexSize();
}

function getHexHeight() {
    return 2 * getHexSize();
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

// Get or assign color to a hex
function getHexColor(q, r) {
    const key = numKey(q, r);
    let color = hexColors.get(key);
    if (color === undefined) {
        color = Math.random() < 0.5;
        hexColors.set(key, color);
        hexInstances.push({ q, r, color: color ? 1 : 0 });
        instanceBufferDirty = true;
    }
    return color;
}

function setHexColor(q, r, isWhite) {
    const key = numKey(q, r);
    const isNew = !hexColors.has(key);
    hexColors.set(key, isWhite);
    if (isNew) {
        hexInstances.push({ q, r, color: isWhite ? 1 : 0 });
        instanceBufferDirty = true;
    }
}

// Upload instance data to GPU
function uploadInstanceData() {
    if (!instanceBufferDirty || hexInstances.length === 0) return;

    const coords = new Float32Array(hexInstances.length * 2);
    const colors = new Float32Array(hexInstances.length);

    for (let i = 0; i < hexInstances.length; i++) {
        coords[i * 2] = hexInstances[i].q;
        coords[i * 2 + 1] = hexInstances[i].r;
        colors[i] = hexInstances[i].color;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, instanceCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, coords, gl.DYNAMIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, instanceColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);

    instanceBufferDirty = false;
}

// Render
function render() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.1, 0.1, 0.18, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (hexInstances.length === 0) return;

    uploadInstanceData();

    gl.useProgram(program);
    gl.bindVertexArray(vao);

    // Set uniforms
    gl.uniform2f(u_resolution, canvas.width, canvas.height);
    gl.uniform2f(u_pan, panOffset.x, panOffset.y);
    gl.uniform1f(u_hexSize, getHexSize());
    gl.uniform1f(u_hexWidth, getHexWidth());
    gl.uniform1f(u_hexHeight, getHexHeight());

    // Draw all hexes in one call
    gl.drawElementsInstanced(gl.TRIANGLES, 18, gl.UNSIGNED_SHORT, 0, hexInstances.length);

    // Draw start hex marker (simple 2D overlay)
    if (startHex) {
        drawStartMarker();
    }
}

// Draw start hex marker using 2D canvas overlay
let ctx2d = null;
let overlayCanvas = null;

function initOverlay() {
    overlayCanvas = document.createElement('canvas');
    overlayCanvas.style.position = 'absolute';
    overlayCanvas.style.top = '0';
    overlayCanvas.style.left = '0';
    overlayCanvas.style.pointerEvents = 'none';
    overlayCanvas.style.zIndex = '1';
    document.body.appendChild(overlayCanvas);
    ctx2d = overlayCanvas.getContext('2d');
}

function drawStartMarker() {
    if (!ctx2d) initOverlay();

    overlayCanvas.width = canvas.width;
    overlayCanvas.height = canvas.height;
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);

    const hexWidth = getHexWidth();
    const hexHeight = getHexHeight();
    const screenX = hexWidth * (startHex.q + startHex.r / 2) + canvas.width / 2 + panOffset.x;
    const screenY = hexHeight * 0.75 * startHex.r + canvas.height / 2 + panOffset.y;

    ctx2d.beginPath();
    ctx2d.arc(screenX, screenY, getHexSize() * 0.3, 0, Math.PI * 2);
    ctx2d.fillStyle = '#4488ff';
    ctx2d.fill();
}

// BFS encirclement check
async function checkEncirclement(startQ, startR) {
    const ESCAPE_DISTANCE = 10000;
    const BASE_MAX_DELAY = 50;
    const BASE_MIN_DELAY = 1;

    const visited = new Set();
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
        currentMaxDist = maxDistReached;  // Track for interruption

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

            if (isWhite) {
                queueQ.push(nq);
                queueR.push(nr);
                queueDist.push(dist + 1);
            }

            if (isMaxSpeed) {
                if (stepCount % 1000 === 0) {
                    const now = performance.now();
                    if (now - lastRenderTime > 50) {
                        statusDiv.textContent = `Distance: ${dist} | Frontier: ${exposedCount} | Visited: ${visited.size}`;
                        render();
                        lastRenderTime = now;
                    }
                    await sleep(0);
                }
            } else {
                const batchSize = Math.max(1, Math.floor(exposedCount / 5 * speedMultiplier));
                if (stepCount % batchSize === 0) {
                    const now = performance.now();
                    if (now - lastRenderTime > 16) {
                        statusDiv.textContent = `Distance: ${dist} | Frontier: ${exposedCount} | Visited: ${visited.size}`;
                        render();
                        lastRenderTime = now;
                    }
                    if (delay > 0) {
                        await sleep(delay);
                    }
                }
            }
        }
    }

    render();
    return { escaped: false, distance: maxDistReached };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Hex vs Hex algorithm functions

// Calculate hex distance from origin (in hex steps)
function hexDist(q, r) {
    return (Math.abs(q) + Math.abs(r) + Math.abs(-q - r)) / 2;
}

// Calculate clockwise angle from East (0 to 2π)
function clockwiseAngle(q, r) {
    const x = q + r / 2;
    const y = r * Math.sqrt(3) / 2;
    // atan2 gives counter-clockwise from East, we want clockwise
    const ccw = Math.atan2(y, x);
    return (2 * Math.PI - ccw + 2 * Math.PI) % (2 * Math.PI);
}

// Select next frontier hex: outermost, then clockwise-most
function selectNextFrontierHex(frontier) {
    let bestKey = null;
    let bestDist = -1;
    let bestAngle = -1;

    for (const key of frontier) {
        const { q, r } = decodeKey(key);
        const dist = hexDist(q, r);
        const angle = clockwiseAngle(q, r);

        if (dist > bestDist || (dist === bestDist && angle > bestAngle)) {
            bestKey = key;
            bestDist = dist;
            bestAngle = angle;
        }
    }

    return bestKey;
}

// Check if a specific hex is trapped (can't reach distance D through untested hexes)
// Returns true only if completely surrounded by opposite color
function isHexTrapped(startQ, startR, maxDist) {
    const startKey = numKey(startQ, startR);
    const startColor = hexColors.get(startKey);
    if (startColor === undefined) return false;

    // Step 1: Find all connected same-color hexes
    const sameColorRegion = new Set([startKey]);
    const sameColorQueue = [startKey];
    let head = 0;

    while (head < sameColorQueue.length) {
        const key = sameColorQueue[head++];
        const { q, r } = decodeKey(key);

        for (let i = 0; i < 6; i++) {
            const nq = q + NEIGHBOR_OFFSETS[i][0];
            const nr = r + NEIGHBOR_OFFSETS[i][1];
            const nk = numKey(nq, nr);

            if (sameColorRegion.has(nk)) continue;
            if (hexColors.get(nk) === startColor) {
                sameColorRegion.add(nk);
                sameColorQueue.push(nk);
            }
        }
    }

    // Step 2: Find all untested hexes adjacent to this region
    const untestedFrontier = new Set();
    for (const key of sameColorRegion) {
        const { q, r } = decodeKey(key);
        for (let i = 0; i < 6; i++) {
            const nq = q + NEIGHBOR_OFFSETS[i][0];
            const nr = r + NEIGHBOR_OFFSETS[i][1];
            const nk = numKey(nq, nr);
            if (!hexColors.has(nk)) {
                untestedFrontier.add(nk);
            }
        }
    }

    // If no untested frontier, we're completely surrounded by opposite color
    if (untestedFrontier.size === 0) {
        return true;
    }

    // Step 3: Check if any untested frontier hex can reach distance D
    // We do a limited BFS from each frontier hex through untested space
    const MAX_UNTESTED_SEARCH = 10000;
    const visited = new Set();
    const queue = [];

    for (const key of untestedFrontier) {
        visited.add(key);
        queue.push(key);
    }

    head = 0;
    while (head < queue.length && head < MAX_UNTESTED_SEARCH) {
        const key = queue[head++];
        const { q, r } = decodeKey(key);

        // If this untested hex is at distance >= maxDist, we can escape
        if (hexDist(q, r) >= maxDist) {
            return false;
        }

        // Expand through untested hexes only
        for (let i = 0; i < 6; i++) {
            const nq = q + NEIGHBOR_OFFSETS[i][0];
            const nr = r + NEIGHBOR_OFFSETS[i][1];
            const nk = numKey(nq, nr);

            if (visited.has(nk)) continue;

            const neighborColor = hexColors.get(nk);
            if (neighborColor === undefined) {
                // Untested - continue search
                visited.add(nk);
                queue.push(nk);
            }
            // If it's opposite color, it blocks this path
            // If it's same color, we already counted it in sameColorRegion
        }
    }

    // If we searched a lot without finding escape, assume we can escape
    // (the untested space is vast, we just didn't search far enough)
    if (head >= MAX_UNTESTED_SEARCH) {
        return false;
    }

    // If BFS exhausted without finding escape, we're truly trapped
    return true;
}

// Get what colors an untested hex touches
function getTouchedColors(q, r) {
    let touchesWhite = false;
    let touchesBlack = false;

    for (let i = 0; i < 6; i++) {
        const nq = q + NEIGHBOR_OFFSETS[i][0];
        const nr = r + NEIGHBOR_OFFSETS[i][1];
        const nk = numKey(nq, nr);
        const color = hexColors.get(nk);
        if (color === true) touchesWhite = true;
        if (color === false) touchesBlack = true;
    }

    return { touchesWhite, touchesBlack };
}

// Get combined frontier (untested hexes adjacent to either color)
// Returns { boundary, whiteFrontier, blackFrontier }
function getFrontiers() {
    const boundary = new Set();      // Touches both colors
    const whiteFrontier = new Set(); // Touches only white
    const blackFrontier = new Set(); // Touches only black
    const seen = new Set();

    for (const [key] of hexColors) {
        const { q, r } = decodeKey(key);
        for (let i = 0; i < 6; i++) {
            const nq = q + NEIGHBOR_OFFSETS[i][0];
            const nr = r + NEIGHBOR_OFFSETS[i][1];
            const nk = numKey(nq, nr);

            if (hexColors.has(nk) || seen.has(nk)) continue;
            seen.add(nk);

            const { touchesWhite, touchesBlack } = getTouchedColors(nq, nr);

            if (touchesWhite && touchesBlack) {
                boundary.add(nk);
            } else if (touchesWhite) {
                whiteFrontier.add(nk);
            } else if (touchesBlack) {
                blackFrontier.add(nk);
            }
        }
    }

    return { boundary, whiteFrontier, blackFrontier };
}

// Main hex vs hex check loop
async function hexVsHexCheck() {
    const ESCAPE_DISTANCE = 10000;
    const BASE_MAX_DELAY = 50;
    const BASE_MIN_DELAY = 1;

    // Track the original starting positions
    const whiteStartQ = startHex.q;
    const whiteStartR = startHex.r;
    const blackStartQ = startHex.q + 1;
    const blackStartR = startHex.r;

    let stepCount = 0;
    let maxDistReached = 0;
    let lastRenderTime = performance.now();

    while (true) {
        const { boundary } = getFrontiers();

        // Only test boundary hexes - hexes that touch both colors
        // When boundary is empty, the colors have separated and outcome is determined
        if (boundary.size === 0) {
            break;
        }

        const nextKey = selectNextFrontierHex(boundary);
        if (nextKey === null) {
            break;
        }

        const { q, r } = decodeKey(nextKey);

        // Color it randomly
        const isWhite = Math.random() < 0.5;
        hexColors.set(nextKey, isWhite);
        hexInstances.push({ q, r, color: isWhite ? 1 : 0 });
        instanceBufferDirty = true;

        const dist = hexDist(q, r);
        maxDistReached = Math.max(maxDistReached, dist);
        currentMaxDist = maxDistReached;
        stepCount++;

        // Check distance limit
        if (maxDistReached >= ESCAPE_DISTANCE) {
            render();
            return { winner: 'unresolved', distance: maxDistReached };
        }

        // Check win conditions after every hex - check if ORIGINAL hexes are trapped
        const whiteTrapped = isHexTrapped(whiteStartQ, whiteStartR, ESCAPE_DISTANCE);
        const blackTrapped = isHexTrapped(blackStartQ, blackStartR, ESCAPE_DISTANCE);

        if (whiteTrapped && !blackTrapped) {
            render();
            return { winner: 'black', distance: maxDistReached };
        }
        if (blackTrapped && !whiteTrapped) {
            render();
            return { winner: 'white', distance: maxDistReached };
        }
        if (whiteTrapped && blackTrapped) {
            render();
            return { winner: 'unresolved', distance: maxDistReached };
        }

        // Rendering and delays
        const isMaxSpeed = speedMultiplier === Infinity;
        const baseDelay = Math.max(BASE_MIN_DELAY, BASE_MAX_DELAY / Math.sqrt(boundary.size + 1));
        const delay = isMaxSpeed ? 0 : baseDelay / speedMultiplier;

        if (isMaxSpeed) {
            if (stepCount % 1000 === 0) {
                const now = performance.now();
                if (now - lastRenderTime > 50) {
                    statusDiv.textContent = `Distance: ${Math.round(maxDistReached)} | Boundary: ${boundary.size} | Hexes: ${hexInstances.length}`;
                    render();
                    lastRenderTime = now;
                }
                await sleep(0);
            }
        } else {
            const batchSize = Math.max(1, Math.floor((boundary.size + 1) / 5 * speedMultiplier));
            if (stepCount % batchSize === 0) {
                const now = performance.now();
                if (now - lastRenderTime > 16) {
                    statusDiv.textContent = `Distance: ${Math.round(maxDistReached)} | Boundary: ${boundary.size} | Hexes: ${hexInstances.length}`;
                    render();
                    lastRenderTime = now;
                }
                if (delay > 0) {
                    await sleep(delay);
                }
            }
        }
    }

    // Frontier exhausted - check final state
    render();
    const whiteTrapped = isHexTrapped(whiteStartQ, whiteStartR, ESCAPE_DISTANCE);
    const blackTrapped = isHexTrapped(blackStartQ, blackStartR, ESCAPE_DISTANCE);

    if (whiteTrapped && !blackTrapped) return { winner: 'black', distance: maxDistReached };
    if (blackTrapped && !whiteTrapped) return { winner: 'white', distance: maxDistReached };
    return { winner: 'unresolved', distance: maxDistReached };
}

// Find encircled pockets
function findEncircledPockets() {
    const pocketSizes = [];
    const checkedUntested = new Set();
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

// Event handlers
function handleClick(e) {
    if (isDragging || isRunning) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - canvas.width / 2 - panOffset.x;
    const mouseY = e.clientY - rect.top - canvas.height / 2 - panOffset.y;

    const hex = pixelToAxial(mouseX, mouseY);

    if (!startHex) {
        startHex = hex;
        setHexColor(hex.q, hex.r, true);  // White hex at click location

        if (gameMode === 'hexvshex') {
            // Place black hex to the right
            setHexColor(hex.q + 1, hex.r, false);
            startBtn.textContent = 'Start Battle';
        } else {
            startBtn.textContent = 'Check Encirclement';
        }

        render();
        startBtn.disabled = false;
    }
}

async function startCheck() {
    if (!startHex || isRunning) return;

    isRunning = true;
    currentMaxDist = 0;
    startBtn.disabled = true;
    resetBtn.disabled = true;
    modeSelect.disabled = true;
    statusDiv.className = '';

    if (gameMode === 'hexvshex') {
        await startHvhCheck();
    } else {
        await startEscapeCheck();
    }

    isRunning = false;
    resetBtn.disabled = false;
}

async function startEscapeCheck() {
    startRun();  // Begin tracking

    const result = await checkEncirclement(startHex.q, startHex.r);

    endRun(result.escaped, result.distance);  // Finish tracking

    statusDiv.textContent = 'Analyzing pockets...';
    await sleep(0);
    const pocketSizes = findEncircledPockets();
    const numPockets = pocketSizes.length;
    const maxPocketSize = pocketSizes.length > 0 ? Math.max(...pocketSizes) : 0;
    const totalPocketArea = pocketSizes.reduce((sum, s) => sum + s, 0);

    const stats = getRunStats();

    const pocketInfo = numPockets > 0
        ? ` | Pockets: ${numPockets} (max: ${maxPocketSize}, total: ${totalPocketArea})`
        : '';

    const historyInfo = ` | #${stats.total} [${stats.escaped}E/${stats.encircled}C${stats.interrupted ? '/' + stats.interrupted + 'I' : ''}]`;

    if (result.escaped) {
        statusDiv.textContent = `ESCAPED @ ${result.distance}${pocketInfo}${historyInfo}`;
        statusDiv.className = 'escaped';
    } else {
        statusDiv.textContent = `ENCIRCLED @ ${result.distance}${pocketInfo}${historyInfo}`;
        statusDiv.className = 'encircled';
    }

    console.log('Run History:', runHistory);
}

async function startHvhCheck() {
    startHvhRun();  // Begin tracking

    const result = await hexVsHexCheck();

    endHvhRun(result.winner, result.distance);  // Finish tracking

    const stats = getHvhStats();
    const historyInfo = ` | #${stats.total} [${stats.whiteWins}W/${stats.blackWins}B/${stats.unresolved}U${stats.interrupted ? '/' + stats.interrupted + 'I' : ''}]`;

    if (result.winner === 'white') {
        statusDiv.textContent = `WHITE WINS @ dist ${Math.round(result.distance)}${historyInfo}`;
        statusDiv.className = 'escaped';  // Green for white
    } else if (result.winner === 'black') {
        statusDiv.textContent = `BLACK WINS @ dist ${Math.round(result.distance)}${historyInfo}`;
        statusDiv.className = 'encircled';  // Red for black
    } else {
        statusDiv.textContent = `UNRESOLVED @ dist ${Math.round(result.distance)}${historyInfo}`;
        statusDiv.className = '';
    }

    console.log('HvH Run History:', hvhRunHistory);
}

function reset() {
    // Interrupt current run if in progress
    if (isRunning) {
        if (gameMode === 'escape') {
            interruptRun(currentMaxDist);
        } else {
            interruptHvhRun(currentMaxDist);
        }
    }

    hexColors.clear();
    hexInstances = [];
    instanceBufferDirty = true;
    startHex = null;
    isRunning = false;
    startBtn.textContent = 'Click a hexagon to start';
    startBtn.disabled = true;
    modeSelect.disabled = false;
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
    zoomLevel = Math.max(0.02, Math.min(2, newZoom));
    zoomSlider.value = Math.max(0.05, zoomLevel);
    zoomValue.textContent = zoomLevel < 0.1 ? zoomLevel.toFixed(2) + 'x' : zoomLevel.toFixed(1) + 'x';
    render();
}

zoomSlider.addEventListener('input', (e) => {
    setZoom(parseFloat(e.target.value));
});

let lastWheelTime = 0;
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const now = performance.now();
    if (now - lastWheelTime < 16) return;
    lastWheelTime = now;
    const zoomDelta = e.deltaY > 0 ? -0.05 : 0.05;
    setZoom(zoomLevel + zoomDelta * zoomLevel); // Proportional zoom
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

// Mode change handler
modeSelect.addEventListener('change', (e) => {
    if (isRunning) return;  // Don't change mode during run
    gameMode = e.target.value;
    reset();  // Reset when mode changes
});

// Initialize
loadRunHistory();
loadHvhHistory();
updateSpeedFromSlider(parseFloat(speedSlider.value));
resize();

// Log loaded history
const stats = getRunStats();
if (stats.total > 0) {
    console.log(`Loaded ${stats.total} escape runs: ${stats.escaped}E/${stats.encircled}C/${stats.interrupted}I`);
}
const hvhStats = getHvhStats();
if (hvhStats.total > 0) {
    console.log(`Loaded ${hvhStats.total} HvH runs: ${hvhStats.whiteWins}W/${hvhStats.blackWins}B/${hvhStats.unresolved}U/${hvhStats.interrupted}I`);
}
