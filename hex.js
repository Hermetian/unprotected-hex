// Hexagonal grid with lazy coloring and encircling detection
// WebGL instanced rendering for massive performance

import {
    CONFIG, NEIGHBOR_OFFSETS,
    numKey, pixelToAxial,
    createBattle, stepBattle, findEncircledPockets,
    sliderToSpeed, speedToLabel, computePacing,
} from './hex-core.js';
import { RunTracker } from './run-tracker.js';
import { RunSession } from './run-session.js';

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
let zoomLevel = 1;
let speedMultiplier = 1;

// State
let hexColors = new Map();      // numKey -> true (white) or false (black)
let hexInstances = [];          // Array of {q, r, color} for GPU upload
let instanceBufferDirty = true;
let startHex = null;
let isRunning = false;
// Cancels an in-flight escape/battle loop when the user resets, switches mode,
// or starts a new run, so the old loop stops mutating the grid. See run-session.js.
const runSession = new RunSession();
let panOffset = { x: 0, y: 0 };
let isDragging = false;
let lastMouse = { x: 0, y: 0 };

// Run tracking — escape mode
const escapeTracker = new RunTracker(
    'unprotected-hex-runs',
    'escaped',
    (history) => {
        const completed = history.filter(r => !r.interrupted);
        const escaped = completed.filter(r => r.escaped).length;
        const encircled = completed.filter(r => r.escaped === false).length;
        const interrupted = history.filter(r => r.interrupted).length;
        return { total: history.length, escaped, encircled, interrupted };
    }
);

// Run tracking — hex vs hex mode
const hvhTracker = new RunTracker(
    'unprotected-hex-hvh-runs',
    'winner',
    (history) => {
        const completed = history.filter(r => !r.interrupted);
        const whiteWins = completed.filter(r => r.winner === 'white').length;
        const blackWins = completed.filter(r => r.winner === 'black').length;
        const unresolved = completed.filter(r => r.winner === 'unresolved').length;
        const interrupted = history.filter(r => r.interrupted).length;
        return { total: history.length, whiteWins, blackWins, unresolved, interrupted };
    }
);

// Track current distance for interruption
let currentMaxDist = 0;

// Handle page unload during run
window.addEventListener('beforeunload', () => {
    if (isRunning) {
        if (gameMode === 'escape') {
            escapeTracker.interruptRun(currentMaxDist, hexInstances.length);
        } else {
            hvhTracker.interruptRun(currentMaxDist, hexInstances.length);
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
if (!vertexShader || !fragmentShader) {
    alert('Failed to compile WebGL shaders');
    throw new Error('Failed to compile WebGL shaders');
}
const program = createProgram(gl, vertexShader, fragmentShader);
if (!program) {
    alert('Failed to link WebGL program');
    throw new Error('Failed to link WebGL program');
}
// The linked program keeps its own copies; the shader objects are no longer needed.
gl.deleteShader(vertexShader);
gl.deleteShader(fragmentShader);

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
    return CONFIG.BASE_HEX_SIZE * zoomLevel;
}

function getHexWidth() {
    return Math.sqrt(3) * getHexSize();
}

function getHexHeight() {
    return 2 * getHexSize();
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
async function checkEncirclement(startQ, startR, token) {
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
        const { isMaxSpeed, delay, batchSize } = computePacing(exposedCount, speedMultiplier);

        if (dist >= CONFIG.ESCAPE_DISTANCE) {
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
                    // A Reset/mode-switch during the await invalidates our token;
                    // bail out before touching the (now cleared) grid again.
                    if (!runSession.isCurrent(token)) return { cancelled: true };
                }
            } else {
                if (stepCount % batchSize === 0) {
                    const now = performance.now();
                    if (now - lastRenderTime > 16) {
                        statusDiv.textContent = `Distance: ${dist} | Frontier: ${exposedCount} | Visited: ${visited.size}`;
                        render();
                        lastRenderTime = now;
                    }
                    if (delay > 0) {
                        await sleep(delay);
                        if (!runSession.isCurrent(token)) return { cancelled: true };
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

// Main hex vs hex check loop. The simulation itself (cell selection, coloring,
// boundary maintenance, win detection) lives in the pure stepBattle/createBattle
// in hex-core.js and is unit-tested there; this driver only mirrors each colored
// cell into the GPU buffer and handles pacing, rendering, and cancellation.
async function hexVsHexCheck(token) {
    // Capture the start positions up front so a later startHex mutation can't move
    // the goalposts mid-battle (the black hex is placed one cell East — see handleClick).
    const whiteStart = { q: startHex.q, r: startHex.r };
    const blackStart = { q: startHex.q + 1, r: startHex.r };
    const sim = createBattle(whiteStart, blackStart, hexColors);

    let stepCount = 0;
    let lastRenderTime = performance.now();

    while (!sim.done) {
        stepBattle(sim, Math.random);

        // Mirror the freshly-colored cell into the GPU instance buffer.
        if (sim.colored) {
            const { q, r, isWhite } = sim.colored;
            hexInstances.push({ q, r, color: isWhite ? 1 : 0 });
            instanceBufferDirty = true;
        }

        currentMaxDist = sim.maxDistReached;
        stepCount++;

        // Decided (a trap, the distance cap, or the colors separating) — render the
        // final board once below and report the result.
        if (sim.done) break;

        // Frontier size BEFORE this step's coloring — drives pacing and the status
        // readout (the pure stepper captured it for us).
        const exposedCount = sim.exposedCount;
        const { isMaxSpeed, delay, batchSize } = computePacing(exposedCount + 1, speedMultiplier);

        if (isMaxSpeed) {
            if (stepCount % 1000 === 0) {
                const now = performance.now();
                if (now - lastRenderTime > 50) {
                    statusDiv.textContent = `Distance: ${Math.round(sim.maxDistReached)} | Boundary: ${exposedCount} | Hexes: ${hexInstances.length}`;
                    render();
                    lastRenderTime = now;
                }
                await sleep(0);
                // Superseded by a Reset/mode-switch — stop before mutating further.
                if (!runSession.isCurrent(token)) return { cancelled: true };
            }
        } else {
            if (stepCount % batchSize === 0) {
                const now = performance.now();
                if (now - lastRenderTime > 16) {
                    statusDiv.textContent = `Distance: ${Math.round(sim.maxDistReached)} | Boundary: ${exposedCount} | Hexes: ${hexInstances.length}`;
                    render();
                    lastRenderTime = now;
                }
                if (delay > 0) {
                    await sleep(delay);
                    if (!runSession.isCurrent(token)) return { cancelled: true };
                }
            }
        }
    }

    render();
    return { winner: sim.winner, distance: sim.maxDistReached };
}

// Event handlers
function handleClick(e) {
    if (isDragging || isRunning) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - canvas.width / 2 - panOffset.x;
    const mouseY = e.clientY - rect.top - canvas.height / 2 - panOffset.y;

    const hex = pixelToAxial(mouseX, mouseY, getHexSize());

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

    const token = runSession.begin();
    isRunning = true;
    currentMaxDist = 0;
    startBtn.disabled = true;
    resetBtn.disabled = true;
    modeSelect.disabled = true;
    statusDiv.className = '';

    if (gameMode === 'hexvshex') {
        await startHvhCheck(token);
    } else {
        await startEscapeCheck(token);
    }

    // Only tear down if this run is still the active one. If a Reset (or a new
    // run) superseded us, that handler already owns the UI/run state.
    if (runSession.isCurrent(token)) {
        isRunning = false;
        resetBtn.disabled = false;
    }
}

async function startEscapeCheck(token) {
    escapeTracker.startRun();

    const result = await checkEncirclement(startHex.q, startHex.r, token);

    // Reset/mode-switch superseded this run; reset() already interrupted the
    // tracker and cleared the board, so leave the UI alone.
    if (result.cancelled) return;

    escapeTracker.endRun(result.escaped, result.distance, hexInstances.length);

    statusDiv.textContent = 'Analyzing pockets...';
    await sleep(0);
    if (!runSession.isCurrent(token)) return;
    const pocketSizes = findEncircledPockets(hexColors);
    const numPockets = pocketSizes.length;
    const maxPocketSize = pocketSizes.length > 0 ? Math.max(...pocketSizes) : 0;
    const totalPocketArea = pocketSizes.reduce((sum, s) => sum + s, 0);

    const stats = escapeTracker.getStats();

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

    console.log('Run History:', escapeTracker.history);
}

async function startHvhCheck(token) {
    hvhTracker.startRun();

    const result = await hexVsHexCheck(token);

    if (result.cancelled) return;

    hvhTracker.endRun(result.winner, result.distance, hexInstances.length);

    const stats = hvhTracker.getStats();
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

    console.log('HvH Run History:', hvhTracker.history);
}

function reset() {
    // Invalidate any in-flight run so its async loop stops mutating the grid.
    runSession.cancel();

    // Interrupt current run if in progress
    if (isRunning) {
        if (gameMode === 'escape') {
            escapeTracker.interruptRun(currentMaxDist, hexInstances.length);
        } else {
            hvhTracker.interruptRun(currentMaxDist, hexInstances.length);
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
escapeTracker.load();
hvhTracker.load();
updateSpeedFromSlider(parseFloat(speedSlider.value));
resize();

// Log loaded history
const stats = escapeTracker.getStats();
if (stats.total > 0) {
    console.log(`Loaded ${stats.total} escape runs: ${stats.escaped}E/${stats.encircled}C/${stats.interrupted}I`);
}
const hvhStats = hvhTracker.getStats();
if (hvhStats.total > 0) {
    console.log(`Loaded ${hvhStats.total} HvH runs: ${hvhStats.whiteWins}W/${hvhStats.blackWins}B/${hvhStats.unresolved}U/${hvhStats.interrupted}I`);
}
