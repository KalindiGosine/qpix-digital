const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

const playPauseBtn = document.getElementById('playPause');
const stepBackBtn = document.getElementById('stepBack');
const stepForwardBtn = document.getElementById('stepForward');
const resetBtn = document.getElementById('reset');
const showInstructionsBtn = document.getElementById('showInstructions');
const showRunMetricsBtn = document.getElementById('showRunMetrics');
const speedInput = document.getElementById('speed');
const scrubber = document.getElementById('scrubber');
const fileInput = document.getElementById('fileInput');
const scenarioEl = document.getElementById('scenario');
const statusEl = document.getElementById('status');
const selectionEl = document.getElementById('selection');
const fpgaPopupEl = document.getElementById('fpgaPopup');
const fpgaPopupTitleEl = document.getElementById('fpgaPopupTitle');
const fpgaPopupBodyEl = document.getElementById('fpgaPopupBody');
const fpgaPopupCloseEl = document.getElementById('fpgaPopupClose');
const instructionsPopupEl = document.getElementById('instructionsPopup');
const instructionsPopupCloseEl = document.getElementById('instructionsPopupClose');
const runMetricsPopupEl = document.getElementById('runMetricsPopup');
const runMetricsPopupBodyEl = document.getElementById('runMetricsPopupBody');
const runMetricsPopupCloseEl = document.getElementById('runMetricsPopupClose');
const hudEl = document.getElementById('hud');
const hudResizeHandleEl = document.getElementById('hudResizeHandle');
const dataPacketMetricsSummaryEl = document.getElementById('dataPacketMetricsSummary');
const dataPacketMetricsListEl = document.getElementById('dataPacketMetricsList');
const filterConfigWriteEl = document.getElementById('filterConfigWrite');
const filterConfigReadEl = document.getElementById('filterConfigRead');
const filterEventDataEl = document.getElementById('filterEventData');
const filterOtherPacketEl = document.getElementById('filterOtherPacket');
const filterSharedFifoEl = document.getElementById('filterSharedFifo');
const filterPacketLabelsEl = document.getElementById('filterPacketLabels');
const filterPersistentInjectionEl = document.getElementById('filterPersistentInjection');

const EDGE_TO_BIT = { north: 0, east: 1, south: 2, west: 3 };

let playback = null;
let isPlaying = false;
let currentTickIndex = 0;
let selectedTarget = null;
let lastFrameMs = 0;
let accumulator = 0;
let hudResizeState = null;

const HUD_MIN_WIDTH = 260;
const HUD_MAX_WIDTH = 640;
const HUD_STORAGE_KEY = 'larpix-playback-hud-width';

function clampHudWidth(width) {
  const viewportMax = Math.max(HUD_MIN_WIDTH, Math.min(HUD_MAX_WIDTH, Math.floor(window.innerWidth * 0.7)));
  return Math.max(HUD_MIN_WIDTH, Math.min(viewportMax, Math.round(width)));
}

function applyHudWidth(width) {
  const clamped = clampHudWidth(width);
  document.body.style.setProperty('--hud-width', `${clamped}px`);
  return clamped;
}

function loadHudWidth() {
  const raw = window.localStorage?.getItem(HUD_STORAGE_KEY);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 320;
}

function persistHudWidth(width) {
  try {
    window.localStorage?.setItem(HUD_STORAGE_KEY, String(width));
  } catch (_) {}
}

function startHudResize(clientX) {
  hudResizeState = {
    startX: clientX,
    startWidth: hudEl?.getBoundingClientRect().width || loadHudWidth(),
  };
  document.body.classList.add('hud-resizing');
}

function updateHudResize(clientX) {
  if (!hudResizeState) return;
  const nextWidth = hudResizeState.startWidth + (clientX - hudResizeState.startX);
  const applied = applyHudWidth(nextWidth);
  persistHudWidth(applied);
  resize();
}

function stopHudResize() {
  if (!hudResizeState) return;
  hudResizeState = null;
  document.body.classList.remove('hud-resizing');
}


function buildSharedFifoIndex(obj) {
  const byChip = new Map();
  let maxObserved = Math.max(0, Number(obj.shared_fifo_capacity || obj.shared_fifo_max || 0));
  for (const update of obj.shared_fifo_updates || []) {
    const key = `${update.x},${update.y}`;
    const list = byChip.get(key) || [];
    list.push(update);
    byChip.set(key, list);
    maxObserved = Math.max(maxObserved, Number(update.shared_fifo_occupancy || 0));
  }
  obj._sharedFifoByChip = byChip;
  obj._sharedFifoScaleMax = Math.max(1, maxObserved);
}

function sharedFifoUpdatesForChip(x, y) {
  return playback?._sharedFifoByChip?.get(`${x},${y}`) || [];
}

function sharedFifoOccupancyAt(x, y, tick) {
  const updates = sharedFifoUpdatesForChip(x, y);
  let lo = 0;
  let hi = updates.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((updates[mid].tick ?? 0) <= tick) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? Number(updates[best].shared_fifo_occupancy || 0) : 0;
}

function sharedFifoVisible() {
  return Boolean(filterSharedFifoEl?.checked);
}

function packetLabelsVisible() {
  return Boolean(filterPacketLabelsEl?.checked);
}

function persistentInjectionVisible() {
  return Boolean(filterPersistentInjectionEl?.checked);
}

function buildPersistentInjectionIndex(obj) {
  const firstByChip = new Map();
  for (const event of obj.chip_events || []) {
    if (event?.event !== 'charge_injected') continue;
    const key = `${event.x},${event.y}`;
    const tick = Number(event.tick || 0);
    const prev = firstByChip.get(key);
    if (prev === undefined || tick < prev) firstByChip.set(key, tick);
  }
  obj._persistentInjectionStartByChip = firstByChip;
}

function persistentInjectionStartTick(x, y) {
  return playback?._persistentInjectionStartByChip?.get(`${x},${y}`);
}

function chipHasPersistentInjectionAt(x, y, tick) {
  const start = persistentInjectionStartTick(x, y);
  return start !== undefined && tick >= start;
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

window.addEventListener('resize', resize);
window.addEventListener('pointermove', (event) => {
  if (!hudResizeState) return;
  updateHudResize(event.clientX);
});

window.addEventListener('pointerup', stopHudResize);
window.addEventListener('pointercancel', stopHudResize);


function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function buildStateAt(index) {
  if (!playback) return null;
  const base = new Map();
  for (const chip of playback.initial_chips || []) {
    base.set(`${chip.x},${chip.y}`, deepClone(chip));
  }
  for (const update of playback.chip_updates || []) {
    if ((update.tick ?? 0) > index) continue;
    const key = `${update.x},${update.y}`;
    const prev = base.get(key) || { x: update.x, y: update.y, chip_id: 1, up_mask: 0, down_mask: 0 };
    base.set(key, { ...prev, ...deepClone(update) });
  }
  return base;
}

function tickData() {
  if (!playback) return { state: null, packetEvents: [], chipEvents: [], chargeEvents: [], fpgaTxEvents: [], fpgaRxEvents: [] };
  const clamped = Math.max(0, Math.min(currentTickIndex, playback.total_ticks || 0));
  const packetEvents = (playback.packet_spans || []).filter((span) => span.start_tick <= clamped && clamped < span.end_tick);
  const chipEvents = (playback.chip_updates || []).filter((update) => (update.tick ?? 0) === clamped);
  const chargeEvents = (playback.chip_events || []).filter((event) => (event.tick ?? 0) === clamped);
  const fpgaActive = (playback.fpga_events || []).filter((event) => event.start_tick <= clamped && clamped < event.end_tick);
  return {
    state: buildStateAt(clamped),
    packetEvents,
    chipEvents,
    chargeEvents,
    fpgaTxEvents: fpgaActive.filter((event) => event.direction === 'tx'),
    fpgaRxEvents: fpgaActive.filter((event) => event.direction === 'rx'),
  };
}

function packetCategory(packetType) {
  if (packetType === 'config_write') return 'config_write';
  if (packetType === 'config_read_request' || packetType === 'config_read_reply') return 'config_read';
  if (packetType === 'event_data') return 'event_data';
  return 'other';
}

function packetColor(packetType) {
  const category = packetCategory(packetType);
  return {
    config_write: '#7cff7c',
    config_read: '#4db0ff',
    event_data: '#ff5e87',
    other: '#d7f06a',
  }[category] || '#d7f06a';
}

function packetCategoryVisible(packetType) {
  const category = packetCategory(packetType);
  if (category === 'config_write') return Boolean(filterConfigWriteEl?.checked);
  if (category === 'config_read') return Boolean(filterConfigReadEl?.checked);
  if (category === 'event_data') return Boolean(filterEventDataEl?.checked);
  return Boolean(filterOtherPacketEl?.checked);
}

function summarizeChannels(channels) {
  const list = (channels || []).map((value) => Number(value));
  if (list.length <= 8) return list.join(',');
  return `${list.slice(0, 8).join(',')} +${list.length - 8} more`;
}

function formatDeliveryPercent(received, generated) {
  if (!(generated > 0)) return 'n/a';
  return `${received}/${generated} = ${(100 * received / generated).toFixed(1)}%`;
}

function populateDataPacketMetrics() {
  if (!dataPacketMetricsSummaryEl || !dataPacketMetricsListEl) return;
  if (!playback?.data_packet_metrics) {
    dataPacketMetricsSummaryEl.textContent = 'Data packets: n/a';
    dataPacketMetricsListEl.innerHTML = '<div class="metrics-row metrics-empty">No data packet metrics in playback.</div>' ;
    return;
  }
  const metrics = playback.data_packet_metrics;
  const totalGenerated = Number(metrics.total_generated || 0);
  const totalReceived = Number(metrics.total_received_at_fpga || 0);
  const totalArrivals = Number(metrics.total_arrivals_at_fpga || 0);
  dataPacketMetricsSummaryEl.textContent = `Totals: gen ${totalGenerated} | FPGA unique ${totalReceived} | FPGA arrivals ${totalArrivals} | delivery ${formatDeliveryPercent(totalReceived, totalGenerated)}`;
  const entries = Array.isArray(metrics.generated_by_chip) ? metrics.generated_by_chip : [];
  if (entries.length === 0) {
    dataPacketMetricsListEl.innerHTML = '<div class="metrics-row metrics-empty">No chip-level data packets recorded.</div>' ;
    return;
  }
  dataPacketMetricsListEl.innerHTML = '';
  let visibleEntries = 0;
  for (const entry of entries) {
    const chipId = Number(entry.chip_id || 0);
    const generated = Number(entry.generated_count || 0);
    const received = Number(entry.received_at_fpga_count || 0);
    const arrivals = Number(entry.total_arrivals_at_fpga_count || 0);
    if (generated <= 0) continue;
    visibleEntries += 1;
    const row = document.createElement('div');
    row.className = 'metrics-row';
    row.textContent = `chip ${chipId}: gen=${generated} | FPGA unique ${received} | FPGA arrivals ${arrivals}`;
    dataPacketMetricsListEl.appendChild(row);
  }
  if (visibleEntries === 0) {
    dataPacketMetricsListEl.innerHTML = '<div class="metrics-row metrics-empty">No chip-level generated data packets recorded.</div>';
  }
}

function renderRunMetricsPopup(summary) {
  if (!runMetricsPopupEl || !runMetricsPopupBodyEl) return;
  if (runMetricsPopupEl.classList.contains('hidden')) return;
  if (!summary) {
    runMetricsPopupBodyEl.innerHTML = '<div class="fpga-card"><div class="fpga-empty">No run metrics in this playback.</div></div>';
    return;
  }
  const ticksPerSec = Number(summary.ticks_per_sec || 0);
  const runtimeSec = Number(summary.runtime_sec || 0);
  runMetricsPopupBodyEl.innerHTML = `
    <div class="fpga-card">
      <div class="fpga-card-title">Performance</div>
      <div class="fpga-label">ticks/sec: ${ticksPerSec > 0 ? ticksPerSec.toFixed(1) : 'n/a'}</div>
      <div class="fpga-label">total runtime: ${runtimeSec > 0 ? runtimeSec.toFixed(2) + ' sec' : 'n/a'}</div>
    </div>`;
}

function fpgaFrameBit(event, tick) {
  const offset = tick - Number(event?.start_tick || 0);
  if (offset < 0 || offset >= 66) return null;
  if (offset === 0) return 0;
  if (offset === 65) return 1;
  const packetWord = BigInt(event.packet_word);
  const bitIndex = BigInt(offset - 1);
  return Number((packetWord >> bitIndex) & 1n);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function renderFpgaPopup(fpgaTxEvents, fpgaRxEvents) {
  if (!fpgaPopupEl || !fpgaPopupBodyEl || !fpgaPopupTitleEl) return;
  if (!playback || selectedTarget?.type !== 'fpga') {
    fpgaPopupEl.classList.add('hidden');
    fpgaPopupBodyEl.innerHTML = '';
    return;
  }
  fpgaPopupEl.classList.remove('hidden');
  fpgaPopupTitleEl.textContent = `FPGA at tick ${currentTickIndex}`;
  const sections = [];
  const eventGroups = [
    ['TX', fpgaTxEvents],
    ['RX', fpgaRxEvents],
  ];
  for (const [directionLabel, events] of eventGroups) {
    if (!events.length) {
      sections.push(`<div class="fpga-card"><div class="fpga-card-title">${directionLabel}</div><div class="fpga-empty">Idle on this tick.</div></div>`);
      continue;
    }
    for (const event of events) {
      const bit = fpgaFrameBit(event, currentTickIndex);
      const decode = event.decode || {};
      const decoded = decode.decoded || {};
      sections.push(`
        <div class="fpga-card">
          <div class="fpga-card-title">${directionLabel} ${escapeHtml(event.packet_type || 'packet')}</div>
          <div class="fpga-meta">bit on this tick: ${bit === null ? 'n/a' : bit} | frame ticks ${event.start_tick}..${Math.max(event.start_tick, (event.end_tick || 0) - 1)} | complete @ ${event.complete_tick}</div>
          <div class="fpga-label">${escapeHtml(event.label || '')}</div>
          <div class="fpga-word">word: ${escapeHtml(event.packet_word || '')}</div>
          <pre class="fpga-json">${escapeHtml(JSON.stringify(decoded, null, 2))}</pre>
        </div>`);
    }
  }
  fpgaPopupBodyEl.innerHTML = sections.join('');
}

function updateHud() {
  if (!playback) {
    scenarioEl.textContent = 'Scenario: none';
    statusEl.textContent = 'Tick: 0 / 0';
    if (dataPacketMetricsSummaryEl) dataPacketMetricsSummaryEl.textContent = 'Data packets: n/a';
    if (dataPacketMetricsListEl) dataPacketMetricsListEl.innerHTML = '';
    selectionEl.textContent = 'Selection: none';
    renderFpgaPopup([], []);
    return;
  }
  scenarioEl.textContent = `Scenario: ${playback.name || 'unnamed'}`;
  renderRunMetricsPopup(playback.run_summary);
  const { state, chipEvents, chargeEvents, fpgaTxEvents, fpgaRxEvents } = tickData();
  const parts = [`Tick: ${currentTickIndex} / ${Math.max(0, playback.total_ticks || 0)}`];
  if (chipEvents.length > 0) parts.push(`chip updates: ${chipEvents.length}`);
  if (chargeEvents.length > 0) parts.push(`charge injections: ${chargeEvents.length}`);
  statusEl.textContent = parts.join(' | ');
  if (selectedTarget?.type === 'fpga') {
    const txBit = fpgaTxEvents.length > 0 ? fpgaFrameBit(fpgaTxEvents[0], currentTickIndex) : null;
    const rxBit = fpgaRxEvents.length > 0 ? fpgaFrameBit(fpgaRxEvents[0], currentTickIndex) : null;
    selectionEl.textContent = `Selection: FPGA | TX bit ${txBit === null ? 'idle' : txBit} | RX bit ${rxBit === null ? 'idle' : rxBit} | TX packets ${fpgaTxEvents.length} | RX packets ${fpgaRxEvents.length}`;
    renderFpgaPopup(fpgaTxEvents, fpgaRxEvents);
    return;
  }
  renderFpgaPopup(fpgaTxEvents, fpgaRxEvents);
  if (selectedTarget?.type === 'chip') {
    const chip = state?.get(`${selectedTarget.x},${selectedTarget.y}`);
    if (chip) {
      const activeUpdate = chipEvents.find((update) => update.x === selectedTarget.x && update.y === selectedTarget.y);
      const activeCharge = chargeEvents.find((event) => event.x === selectedTarget.x && event.y === selectedTarget.y);
      let line = `Selection: chip ${chip.chip_id} at (${chip.x},${chip.y}) U${(chip.up_mask || 0).toString(2).padStart(4, '0')} D${(chip.down_mask || 0).toString(2).padStart(4, '0')}`;
      line += ` | FIFO ${sharedFifoOccupancyAt(selectedTarget.x, selectedTarget.y, currentTickIndex)}/${playback._sharedFifoScaleMax || 1}`;
      if (activeUpdate) {
        line += ` | applied reg ${activeUpdate.register_addr} = 0x${Number(activeUpdate.register_data || 0).toString(16).toUpperCase().padStart(2, '0')}`;
      }
      if (activeCharge) {
        line += ` | charge ch ${summarizeChannels(activeCharge.channels)} (${activeCharge.channel_count} total)`;
      }
      selectionEl.textContent = line;
      return;
    }
  }
  if (chargeEvents.length > 0) {
    const event = chargeEvents[0];
    selectionEl.textContent = `Selection: charge injected at chip (${event.x},${event.y}) channels ${summarizeChannels(event.channels)} (${event.channel_count} total)`;
    return;
  }
  if (chipEvents.length > 0) {
    const update = chipEvents[0];
    selectionEl.textContent = `Selection: config applied at chip (${update.x},${update.y}) reg ${update.register_addr} = 0x${Number(update.register_data || 0).toString(16).toUpperCase().padStart(2, '0')}`;
    return;
  }
  selectionEl.textContent = 'Selection: none';
}

function laneEnabled(mask, edge) {
  return ((mask >> EDGE_TO_BIT[edge]) & 1) === 1;
}

function drawLane(cx, cy, cell, edge, color, active = false) {
  const half = cell * 0.42;
  let x2 = cx;
  let y2 = cy;
  if (edge === 'north') y2 -= half;
  if (edge === 'south') y2 += half;
  if (edge === 'east') x2 += half;
  if (edge === 'west') x2 -= half;

  const dx = x2 - cx;
  const dy = y2 - cy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const headLen = Math.max(8, cell * 0.12);
  const headWidth = Math.max(5, cell * 0.07);
  const shaftEndX = x2 - ux * headLen;
  const shaftEndY = y2 - uy * headLen;

  ctx.strokeStyle = color;
  ctx.lineWidth = active ? 6 : 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(shaftEndX, shaftEndY);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(shaftEndX + px * headWidth, shaftEndY + py * headWidth);
  ctx.lineTo(shaftEndX - px * headWidth, shaftEndY - py * headWidth);
  ctx.closePath();
  ctx.fill();
}

function isPacketMotionEvent(event) {
  return Array.isArray(event?.src) && event.src.length === 2 && Array.isArray(event?.dst) && event.dst.length === 2;
}

function drawPacket(event, layout) {
  const src = layout.cellCenter(event.src[0], event.src[1]);
  const dst = layout.cellCenter(event.dst[0], event.dst[1]);
  const duration = Math.max(1, (event.end_tick || 0) - (event.start_tick || 0));
  const t = Math.max(0, Math.min(1, (currentTickIndex - (event.start_tick || 0)) / duration));
  const x = src.x + (dst.x - src.x) * t;
  const y = src.y + (dst.y - src.y) * t;
  const color = packetColor(event.packet_type);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(5, layout.cell * 0.1), 0, Math.PI * 2);
  ctx.fill();
  if (packetLabelsVisible() && event.label) {
    ctx.fillStyle = '#e8edf8';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(event.label, x + 10, y - 10);
  }
}

const SOURCE_FPGA_LANE_COLOR = '#b46cff';
const SOURCE_FPGA_LANE_INACTIVE_COLOR = '#6a4a94';
const SHARED_FIFO_TEXT_COLOR = '#d7a6ff';

function drawSharedFifoBar(left, top, cell, occupancy, scaleMax) {
  const barInset = Math.max(6, cell * 0.08);
  const barWidth = Math.max(12, cell * 0.84 - barInset * 2);
  const barHeight = Math.max(8, cell * 0.1);
  const barLeft = left + barInset;
  const barTop = top + cell * 0.84 - barInset - barHeight;
  const fill = scaleMax > 0 ? Math.max(0, Math.min(1, occupancy / scaleMax)) : 0;

  ctx.fillStyle = '#0e141d';
  ctx.strokeStyle = 'rgba(97, 226, 148, 0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(barLeft, barTop, barWidth, barHeight, 5);
  ctx.fill();
  ctx.stroke();

  if (fill > 0) {
    const fillWidth = Math.max(0, (barWidth - 2) * fill);
    ctx.fillStyle = '#61e294';
    ctx.beginPath();
    ctx.roundRect(barLeft + 1, barTop + 1, fillWidth, Math.max(0, barHeight - 2), 4);
    ctx.fill();
  }

  if (cell >= 72) {
    ctx.fillStyle = occupancy > 0 ? SHARED_FIFO_TEXT_COLOR : '#b996dc';
    ctx.font = `${Math.max(9, cell * 0.11)}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(occupancy), barLeft + barWidth * 0.5, barTop + barHeight * 0.5);
    ctx.textBaseline = 'alphabetic';
  }
}

function fpgaLayout(layout) {
  if (!playback?.source) return null;
  const src = layout.cellCenter(playback.source.x, playback.source.y);
  const size = Math.max(22, layout.cell * 0.34);
  const gap = Math.max(12, layout.cell * 0.18);
  return {
    left: src.x - size * 0.5,
    top: src.y + layout.cell * 0.5 + gap,
    width: size,
    height: size,
    centerX: src.x,
    centerY: src.y + layout.cell * 0.5 + gap + size * 0.5,
  };
}

function pointInRect(x, y, rect) {
  return rect && x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height;
}

function drawFpga(layout, fpgaTxEvents, fpgaRxEvents) {
  const rect = fpgaLayout(layout);
  if (!rect) return null;
  const isSelected = selectedTarget?.type === 'fpga';
  const active = fpgaTxEvents.length > 0 || fpgaRxEvents.length > 0;
  const src = layout.cellCenter(playback.source.x, playback.source.y);
  const connectorColor = active ? SOURCE_FPGA_LANE_COLOR : SOURCE_FPGA_LANE_INACTIVE_COLOR;

  ctx.strokeStyle = connectorColor;
  ctx.lineWidth = active ? 4 : 2;
  ctx.beginPath();
  ctx.moveTo(src.x, src.y + layout.cell * 0.42);
  ctx.lineTo(rect.centerX, rect.top);
  ctx.stroke();

  ctx.fillStyle = active ? '#221431' : '#141925';
  ctx.strokeStyle = isSelected ? '#f0e6ff' : connectorColor;
  ctx.lineWidth = isSelected ? 3 : 2;
  ctx.beginPath();
  ctx.roundRect(rect.left, rect.top, rect.width, rect.height, 8);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f0e6ff';
  ctx.font = `${Math.max(9, layout.cell * 0.09)}px ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('FPGA', rect.centerX, rect.centerY - 4);
  ctx.font = `${Math.max(8, layout.cell * 0.08)}px ui-monospace, monospace`;
  ctx.fillStyle = active ? '#d7a6ff' : '#9eabc2';
  ctx.fillText(`T${fpgaTxEvents.length}/R${fpgaRxEvents.length}`, rect.centerX, rect.centerY + 8);
  ctx.textBaseline = 'alphabetic';
  return rect;
}

function draw() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0a0d12';
  ctx.fillRect(0, 0, width, height);

  if (!playback) {
    updateHud();
    return;
  }

  const rows = playback.rows;
  const cols = playback.cols;
  const hudWidth = hudEl?.getBoundingClientRect().width || loadHudWidth();
  const marginLeft = hudWidth + 40;
  const margin = 30;
  const availW = Math.max(200, width - marginLeft - margin);
  const availH = Math.max(200, height - margin * 2);
  const cell = Math.min(availW / cols, availH / rows);
  const gridW = cell * cols;
  const gridH = cell * rows;
  const originX = marginLeft + (availW - gridW) * 0.5;
  const originY = margin + (availH - gridH) * 0.5;

  const layout = {
    cell,
    cellCenter(x, y) {
      return {
        x: originX + x * cell + cell * 0.5,
        y: originY + (rows - 1 - y) * cell + cell * 0.5,
      };
    },
  };

  const { state, packetEvents, chipEvents, chargeEvents, fpgaTxEvents, fpgaRxEvents } = tickData();

  for (let gy = rows - 1; gy >= 0; gy -= 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      const chip = state.get(`${gx},${gy}`) || { x: gx, y: gy, chip_id: 1, up_mask: 0, down_mask: 0 };
      const { x: cx, y: cy } = layout.cellCenter(gx, gy);
      const left = cx - cell * 0.42;
      const top = cy - cell * 0.42;
      const isSelected = selectedTarget?.type === 'chip' && selectedTarget.x === gx && selectedTarget.y === gy;
      const isSourceChip = playback.source && playback.source.x === gx && playback.source.y === gy;

      const activeUpdate = chipEvents.find((update) => update.x === gx && update.y === gy);
      const activeCharge = chargeEvents.find((event) => event.x === gx && event.y === gy);
      const persistCharge = persistentInjectionVisible() && chipHasPersistentInjectionAt(gx, gy, currentTickIndex);
      if (persistCharge) {
        ctx.strokeStyle = activeCharge ? 'rgba(255, 94, 135, 0.42)' : 'rgba(255, 143, 176, 0.30)';
        ctx.lineWidth = activeCharge ? 9 : 6;
        ctx.beginPath();
        ctx.roundRect(left - 4, top - 4, cell * 0.84 + 8, cell * 0.84 + 8, 14);
        ctx.stroke();
      }
      if (isSourceChip) {
        ctx.strokeStyle = 'rgba(77, 176, 255, 0.9)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(left - 7, top - 7, cell * 0.84 + 14, cell * 0.84 + 14, 16);
        ctx.stroke();
      }
      ctx.fillStyle = activeUpdate ? '#1c2f25' : (isSelected ? '#172131' : (activeCharge ? '#281521' : (persistCharge ? '#21131b' : '#111722')));
      ctx.strokeStyle = activeUpdate ? '#7cff7c' : (isSelected ? '#d8f3ff' : (activeCharge ? '#ff5e87' : (persistCharge ? '#ff8fb0' : '#2c3748')));
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.roundRect(left, top, cell * 0.84, cell * 0.84, 10);
      ctx.fill();
      ctx.stroke();

      for (const edge of ['north', 'east', 'south', 'west']) {
        drawLane(cx, cy, cell, edge, '#394455', false);
      }
      for (const edge of ['north', 'east', 'south', 'west']) {
        if (laneEnabled(chip.up_mask || 0, edge)) drawLane(cx, cy, cell, edge, '#4db0ff', false);
        if (laneEnabled(chip.down_mask || 0, edge)) {
          const downColor = isSourceChip && edge === 'south' ? SOURCE_FPGA_LANE_COLOR : '#ffb04d';
          drawLane(cx, cy, cell, edge, downColor, false);
        }
      }

      ctx.fillStyle = '#eef4ff';
      ctx.font = `${Math.max(13, cell * 0.16)}px ui-monospace, monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(String(chip.chip_id), left + 8, top + 6);
      if (isSourceChip) {
        ctx.fillStyle = '#4db0ff';
        ctx.font = `${Math.max(9, cell * 0.1)}px ui-monospace, monospace`;
        ctx.fillText('SRC', left + 8, top + 24);
      }
      ctx.textBaseline = 'alphabetic';

      if (sharedFifoVisible()) {
        drawSharedFifoBar(left, top, cell, sharedFifoOccupancyAt(gx, gy, currentTickIndex), playback._sharedFifoScaleMax || 1);
      }
    }
  }

  for (const event of packetEvents || []) {
    if (!isPacketMotionEvent(event)) continue;
    if (!packetCategoryVisible(event.packet_type)) continue;
    drawPacket(event, layout);
    const src = layout.cellCenter(event.src[0], event.src[1]);
    const dst = layout.cellCenter(event.dst[0], event.dst[1]);
    ctx.strokeStyle = 'rgba(124,255,124,0.20)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    ctx.lineTo(dst.x, dst.y);
    ctx.stroke();
  }

  drawFpga(layout, fpgaTxEvents, fpgaRxEvents);
  updateHud();
}

function setTick(index) {
  if (!playback) return;
  currentTickIndex = Math.max(0, Math.min(index, playback.total_ticks || 0));
  scrubber.value = String(currentTickIndex);
  draw();
}

function togglePlay() {
  isPlaying = !isPlaying;
  playPauseBtn.textContent = isPlaying ? 'Pause' : 'Play';
}

function step(delta) {
  if (!playback) return;
  setTick(currentTickIndex + delta);
}

function handleCanvasClick(event) {
  if (!playback) return;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const rows = playback.rows;
  const cols = playback.cols;
  const hudWidth = hudEl?.getBoundingClientRect().width || loadHudWidth();
  const marginLeft = hudWidth + 40;
  const margin = 30;
  const availW = Math.max(200, window.innerWidth - marginLeft - margin);
  const availH = Math.max(200, window.innerHeight - margin * 2);
  const cell = Math.min(availW / cols, availH / rows);
  const gridW = cell * cols;
  const gridH = cell * rows;
  const originX = marginLeft + (availW - gridW) * 0.5;
  const originY = margin + (availH - gridH) * 0.5;
  const layout = {
    cell,
    cellCenter(gx, gy) {
      return {
        x: originX + gx * cell + cell * 0.5,
        y: originY + (rows - 1 - gy) * cell + cell * 0.5,
      };
    },
  };
  const fpgaRect = fpgaLayout(layout);
  if (pointInRect(x, y, fpgaRect)) {
    selectedTarget = { type: 'fpga' };
    draw();
    return;
  }
  if (x < originX || x > originX + gridW || y < originY || y > originY + gridH) {
    selectedTarget = null;
    draw();
    return;
  }
  const gx = Math.floor((x - originX) / cell);
  const gyFromTop = Math.floor((y - originY) / cell);
  const gy = rows - 1 - gyFromTop;
  selectedTarget = { type: 'chip', x: gx, y: gy };
  draw();
}

async function loadPlaybackFromObject(obj) {
  playback = obj;
  buildSharedFifoIndex(playback);
  buildPersistentInjectionIndex(playback);
  populateDataPacketMetrics();
  currentTickIndex = 0;
  selectedTarget = null;
  scrubber.max = String(Math.max(0, playback.total_ticks || 0));
  scrubber.value = '0';
  draw();
}

async function loadPlaybackFromUrl(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`failed to load ${url}`);
  const obj = await response.json();
  await loadPlaybackFromObject(obj);
}

playPauseBtn.addEventListener('click', togglePlay);
stepBackBtn.addEventListener('click', () => step(-1));
stepForwardBtn.addEventListener('click', () => step(1));
resetBtn.addEventListener('click', () => setTick(0));
scrubber.addEventListener('input', () => setTick(Number(scrubber.value)));
hudResizeHandleEl?.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  hudResizeHandleEl.setPointerCapture?.(event.pointerId);
  startHudResize(event.clientX);
});
canvas.addEventListener('click', handleCanvasClick);
filterConfigWriteEl?.addEventListener('change', draw);
filterConfigReadEl?.addEventListener('change', draw);
filterEventDataEl?.addEventListener('change', draw);
filterOtherPacketEl?.addEventListener('change', draw);
filterSharedFifoEl?.addEventListener('change', draw);
filterPacketLabelsEl?.addEventListener('change', draw);
filterPersistentInjectionEl?.addEventListener('change', draw);

fpgaPopupCloseEl?.addEventListener('click', () => {
  selectedTarget = null;
  draw();
});

showInstructionsBtn?.addEventListener('click', () => {
  instructionsPopupEl?.classList.remove('hidden');
});

instructionsPopupCloseEl?.addEventListener('click', () => {
  instructionsPopupEl?.classList.add('hidden');
});

showRunMetricsBtn?.addEventListener('click', () => {
  runMetricsPopupEl?.classList.remove('hidden');
  renderRunMetricsPopup(playback?.run_summary || null);
});

runMetricsPopupCloseEl?.addEventListener('click', () => {
  runMetricsPopupEl?.classList.add('hidden');
});

fileInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  await loadPlaybackFromObject(JSON.parse(text));
});

window.addEventListener('keydown', (event) => {
  if (event.code === 'Space') {
    event.preventDefault();
    togglePlay();
  } else if (event.key === 's' || event.key === 'S') {
    step(1);
  } else if (event.key === 'z' || event.key === 'Z') {
    step(-1);
  } else if (event.key === 'r' || event.key === 'R') {
    setTick(0);
  }
});

function animate(ts) {
  if (!lastFrameMs) lastFrameMs = ts;
  const dt = ts - lastFrameMs;
  lastFrameMs = ts;
  if (isPlaying && playback) {
    accumulator += dt;
    const interval = 1000 / Number(speedInput.value || 6);
    while (accumulator >= interval) {
      accumulator -= interval;
      if (currentTickIndex >= (playback.total_ticks || 0)) {
        isPlaying = false;
        playPauseBtn.textContent = 'Play';
        break;
      }
      setTick(currentTickIndex + 1);
    }
  }
  requestAnimationFrame(animate);
}

applyHudWidth(loadHudWidth());
resize();
const playbackUrl = new URLSearchParams(window.location.search).get('playback') || './playback/live_event_3x5_chip14.json';
loadPlaybackFromUrl(playbackUrl).catch((error) => {
  scenarioEl.textContent = 'Scenario: failed to load sample';
  selectionEl.textContent = error.message;
  fpgaPopupEl?.classList.add('hidden');
  runMetricsPopupEl?.classList.add('hidden');
});
requestAnimationFrame(animate);
