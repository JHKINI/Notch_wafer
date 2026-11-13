// @ts-check
/* ==========================================================================
   app — 화면. core의 순수 함수 위에 상태 저장소, 렌더러, 입력 처리를 얹는다.
   흐름은 한 방향이다: 입력 → action → store.set → 렌더러가 바뀐 조각만 다시 그린다.
   ========================================================================== */
import {
  BIN_LABEL,
  BIN_PASS,
  FAIL_BINS,
  LOT_DEFS,
  PATTERN_LABEL,
  WAFERS_PER_LOT,
  ZONE_EDGES,
  buildGeometry,
  buildLot,
  clampView,
  dieCoord,
  normalizeText,
  scaleBarLength,
  searchItems,
  stackBreaks,
  stackClass,
  zoomAbout,
} from './core.js';

/* ---------- 1. 기반: 상수, 포맷, DOM 도우미 ---------- */

const GEO = buildGeometry();
const LOCALE = 'ko-KR';
const STORAGE_KEY = 'notch.review.v1';
const THUMB_PX = 44; // styles의 --thumb와 같은 값
const SVG_NS = 'http://www.w3.org/2000/svg';
const TAU = Math.PI * 2;
const MINUS = '−';
const root = document.documentElement;

const nf0 = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dtf = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' });

/** @param {number} v 0~1 비율 */
const pct = (v) => `${nf1.format(v * 100)}%`;
/** @param {number} n */
const slotName = (n) => String(n).padStart(2, '0');
/** @param {number} n */
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `${MINUS}${Math.abs(n)}` : '0');

const STATUS = Object.freeze({
  ok: { label: '정상', icon: 'check' },
  watch: { label: '주의', icon: 'triangle' },
  out: { label: '관리 이탈', icon: 'diamond' },
});
const ZONE_NAMES = ['중심부', '안쪽', '중간', '바깥쪽', '가장자리'];

const mqDark = matchMedia('(prefers-color-scheme: dark)');
const mqMotion = matchMedia('(prefers-reduced-motion: reduce)');
const motionOK = () => !mqMotion.matches;

/** 있어야 하는 요소가 없으면 조용히 넘어가지 않고 바로 알린다. @param {string} id */
function must(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} 요소가 없습니다`);
  return el;
}

/**
 * 속성 규칙: text → textContent, vars → CSS 변수, on* → 리스너, 나머지 → attribute.
 * 데이터에서 온 문자열은 모두 textContent로만 들어간다(innerHTML을 쓰지 않는다).
 * @param {Element} el
 * @param {Record<string, any> | null | undefined} props
 */
function setProps(el, props) {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'text') el.textContent = String(value);
    else if (key === 'vars') {
      for (const [name, v] of Object.entries(value)) /** @type {HTMLElement} */ (el).style.setProperty(name, String(v));
    } else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
}

/** @typedef {Node | string | null | false | undefined} Child */

/** @param {Element} el @param {Child[]} kids */
function appendKids(el, kids) {
  for (const kid of kids) if (kid != null && kid !== false && kid !== '') el.append(kid);
  return el;
}

/** @param {string} tag @param {Record<string, any> | null} [props] @param {...Child} kids */
const h = (tag, props, ...kids) => {
  const el = document.createElement(tag);
  setProps(el, props);
  appendKids(el, kids);
  return el;
};

/** @param {string} tag @param {Record<string, any> | null} [props] @param {...Child} kids */
const s = (tag, props, ...kids) => {
  const el = document.createElementNS(SVG_NS, tag);
  setProps(el, props);
  appendKids(el, kids);
  return el;
};

/** @param {string} name */
const icon = (name) => s('svg', { class: 'icon', 'aria-hidden': 'true' }, s('use', { href: `#i-${name}` }));

/** @param {'ok' | 'watch' | 'out'} status */
const statusPill = (status) => h('span', { class: 'pill', 'data-status': status }, icon(STATUS[status].icon), STATUS[status].label);

const els = {
  main: must('main'),
  skipLink: must('skip-link'),
  lotSelect: /** @type {HTMLSelectElement} */ (must('lot-select')),
  openPalette: must('open-palette'),
  findKbd: must('find-kbd'),
  helpMod: must('help-mod'),
  toggleTheme: must('toggle-theme'),
  themeIcon: must('theme-icon'),
  openHelp: must('open-help'),
  lotId: must('lot-id'),
  lotMeta: must('lot-meta'),
  lotYield: must('lot-yield'),
  lotOut: must('lot-out'),
  lotWatch: must('lot-watch'),
  lotHold: must('lot-hold'),
  copyReport: must('copy-report'),
  stripCount: must('strip-count'),
  nextFlagged: must('next-flagged'),
  wafers: must('wafers'),
  modeWafer: /** @type {HTMLInputElement} */ (must('mode-wafer')),
  modeLot: /** @type {HTMLInputElement} */ (must('mode-lot')),
  zoomOut: must('zoom-out'),
  zoomIn: must('zoom-in'),
  zoomReset: must('zoom-reset'),
  zoomLevel: must('zoom-level'),
  stage: must('stage'),
  map: /** @type {HTMLCanvasElement} */ (must('map')),
  stageTag: must('stage-tag'),
  scalebarLine: must('scalebar-line'),
  scalebarLabel: must('scalebar-label'),
  readout: must('readout'),
  roKeys: [1, 2, 3, 4].map((n) => must(`ro-k${n}`)),
  roValues: [1, 2, 3, 4].map((n) => must(`ro-v${n}`)),
  legend: must('legend'),
  detailTitle: must('detail-title'),
  detailStatus: must('detail-status'),
  detailYield: must('detail-yield'),
  detailDelta: must('detail-delta'),
  patternName: must('pattern-name'),
  patternWhy: must('pattern-why'),
  detailActions: must('detail-actions'),
  toggleHold: must('toggle-hold'),
  holdLabel: must('hold-label'),
  clearBin: must('clear-bin'),
  bins: must('bins'),
  zones: must('zones'),
  spcInfoBtn: must('spc-info-btn'),
  spcInfo: must('spc-info'),
  toggleTable: must('toggle-table'),
  limCl: must('lim-cl'),
  limLcl: must('lim-lcl'),
  limUcl: must('lim-ucl'),
  chart: must('chart'),
  tablewrap: must('tablewrap'),
  spcRows: must('spc-rows'),
  palette: /** @type {HTMLDialogElement} */ (must('palette')),
  paletteInput: /** @type {HTMLInputElement} */ (must('palette-input')),
  paletteClose: must('palette-close'),
  paletteList: must('palette-list'),
  paletteEmpty: must('palette-empty'),
  help: /** @type {HTMLDialogElement} */ (must('help')),
  helpClose: must('help-close'),
  report: /** @type {HTMLDialogElement} */ (must('report')),
  reportText: /** @type {HTMLTextAreaElement} */ (must('report-text')),
  reportClose: must('report-close'),
  toasts: must('toasts'),
  tip: must('tip'),
  announce: must('announce'),
  fatal: must('fatal'),
};

/* ---------- 2. 데이터 접근 ---------- */

/** @typedef {ReturnType<typeof buildLot>} Lot */
/** @typedef {Lot['wafers'][number]} Wafer */

/** @type {Map<string, Lot>} */
const lotCache = new Map();

/** 로트는 처음 열 때 한 번만 생성한다. @param {string} id @returns {Lot} */
function getLot(id) {
  const def = LOT_DEFS.find((d) => d.id === id) ?? LOT_DEFS[0];
  let lot = lotCache.get(def.id);
  if (!lot) {
    lot = buildLot(def, GEO);
    lotCache.set(def.id, lot);
  }
  return lot;
}

/** @param {Lot} lot @param {number} slot */
const waferOf = (lot, slot) => lot.wafers[slot - 1];

/** 처음 보여 줄 웨이퍼: 가장 나쁜 이탈 웨이퍼, 없으면 주의 웨이퍼. @param {Lot} lot */
function defaultSlot(lot) {
  /** @param {string} status */
  const worst = (status) => lot.wafers.filter((w) => w.status === status).sort((a, b) => a.yield - b.yield)[0];
  return (worst('out') ?? worst('watch') ?? lot.wafers[0]).slot;
}

/* ---------- 3. 상태 저장소 ---------- */

/**
 * @typedef {object} State
 * @property {string} lotId
 * @property {number} slot        1~25
 * @property {'wafer' | 'lot'} mode
 * @property {number} bin         강조할 불량 bin, 0이면 강조 없음
 * @property {number} die         고정해 둔 다이 인덱스, 없으면 -1
 * @property {Record<string, number[]>} holds  로트별 보류 슬롯
 * @property {boolean} table      관리도를 표로 볼지
 */

/**
 * 가장 작은 저장소. set은 얕은 병합이고, 렌더는 마이크로태스크로 한 번에 모아서 한다.
 * 렌더러는 (지금 상태, 직전에 그린 상태)를 받아 바뀐 키만 처리한다.
 * @param {State} initial
 */
function createStore(initial) {
  let state = initial;
  /** @type {any} */
  let painted = {};
  let queued = false;
  /** @type {Array<(s: State, p: Partial<State>) => void>} */
  const renderers = [];

  function flush() {
    queued = false;
    if (state === painted) return;
    const prev = painted;
    painted = state;
    for (const render of renderers) render(state, prev);
  }
  return {
    get: () => state,
    /** @param {Partial<State>} patch */
    set(patch) {
      const next = { ...state, ...patch };
      const keys = /** @type {(keyof State)[]} */ (Object.keys(next));
      if (keys.every((k) => next[k] === state[k])) return;
      state = next;
      if (!queued) {
        queued = true;
        queueMicrotask(flush);
      }
    },
    flush,
    /** @param {(s: State, p: Partial<State>) => void} render */
    use(render) {
      renderers.push(render);
    },
  };
}

/** @param {State} now @param {Partial<State>} prev @param {...keyof State} keys */
const changed = (now, prev, ...keys) => keys.some((k) => now[k] !== prev[k]);

/** @type {ReturnType<typeof createStore>} */
let store;

/** @param {State} state */
const holdsOf = (state) => state.holds[state.lotId] ?? [];

/* ---------- 4. 보존: 저장소와 주소 ---------- */

/** 외부에서 온 값은 믿지 않는다. 알려진 로트의 유효한 슬롯만 남긴다. @param {unknown} value */
function sanitizeHolds(value) {
  /** @type {Record<string, number[]>} */
  const out = {};
  if (!value || typeof value !== 'object') return out;
  for (const def of LOT_DEFS) {
    const list = /** @type {Record<string, unknown>} */ (value)[def.id];
    if (!Array.isArray(list)) continue;
    const slots = [...new Set(list)].filter((n) => Number.isInteger(n) && n >= 1 && n <= WAFERS_PER_LOT).sort((a, b) => a - b);
    if (slots.length) out[def.id] = slots;
  }
  return out;
}

/** @returns {Record<string, unknown>} */
function loadStored() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {}; // 저장소가 막혀 있거나 값이 깨졌으면 빈 상태로 시작한다
  }
}

/** @param {State} state */
function saveStored(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ holds: state.holds, table: state.table }));
  } catch {
    // 저장하지 못해도 화면 동작에는 영향이 없다
  }
}

/** 주소에는 "#로트-슬롯" 한 덩어리만 둔다. @param {State} state */
const routeOf = (state) => `#${state.lotId.toLowerCase()}-${slotName(state.slot)}`;

/** @param {string} hash */
function parseRoute(hash) {
  const m = /^#?([a-z0-9]+)-(\d{1,2})$/i.exec(hash);
  if (!m) return null;
  const def = LOT_DEFS.find((d) => d.id.toLowerCase() === m[1].toLowerCase());
  const slot = Number(m[2]);
  return def && slot >= 1 && slot <= WAFERS_PER_LOT ? { lotId: def.id, slot } : null;
}

/** 첫 상태: 주소에 경로가 있으면 그 웨이퍼, 없으면 첫 로트에서 가장 나쁜 웨이퍼. */
function initialState() {
  const stored = loadStored();
  const route = parseRoute(location.hash);
  const lotId = route?.lotId ?? LOT_DEFS[0].id;
  /** @type {State} */
  const state = {
    lotId,
    slot: route?.slot ?? defaultSlot(getLot(lotId)),
    mode: 'wafer',
    bin: 0,
    die: -1,
    holds: sanitizeHolds(stored.holds),
    table: Boolean(stored.table),
  };
  return state;
}

/* ---------- 5. 테마 토큰 → 캔버스 색 ---------- */

const TOKEN_VARS = {
  disc: '--w-disc',
  rim: '--w-rim',
  die: '--w-die',
  fail: '--w-fail',
  dim: '--w-dim',
  cursor: '--w-cursor',
  s1: '--w-s1',
  s2: '--w-s2',
  s3: '--w-s3',
  s4: '--w-s4',
  s5: '--w-s5',
};
/** @typedef {keyof typeof TOKEN_VARS} TokenKey */

/**
 * 캔버스는 CSS 변수를 모른다. 임시 요소에 색을 입혀 브라우저가 계산한 rgb()를 읽어 온다.
 * 강제 색상 모드의 시스템 색 키워드도 같은 경로로 풀린다.
 * @returns {Record<TokenKey, string>}
 */
function readTokens() {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  document.body.append(probe);
  /** @type {any} */
  const out = {};
  for (const [key, name] of Object.entries(TOKEN_VARS)) {
    probe.style.color = `var(${name})`;
    out[key] = getComputedStyle(probe).color;
  }
  probe.remove();
  return out;
}
let tokens = readTokens();

/** "rgb(r, g, b)" → [r, g, b]. @param {string} color */
const parseRgb = (color) => (color.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number);

const currentTheme = () => {
  const forced = root.dataset.theme;
  return forced === 'dark' || forced === 'light' ? forced : mqDark.matches ? 'dark' : 'light';
};

/* ---------- 6. 웨이퍼 맵 (캔버스) ---------- */

/**
 * @typedef {object} MapLayer
 * @property {Uint8Array} cls        다이별 색 계급
 * @property {TokenKey[]} palette    계급 → 토큰 이름. 색은 그릴 때 읽으므로 테마가 바뀌어도 그대로 쓴다
 */

// 패턴 웨이퍼 표면의 무지갯빛. 다이가 덮지 않는 스크라이브 라인과 가장자리에서만 비친다.
const SHEEN = /** @type {const} */ ([
  [0, 'rgba(144,133,233,0.22)'],
  [0.17, 'rgba(96,200,224,0.10)'],
  [0.34, 'rgba(255,255,255,0.02)'],
  [0.5, 'rgba(240,190,120,0.12)'],
  [0.67, 'rgba(255,255,255,0.02)'],
  [0.84, 'rgba(230,120,180,0.10)'],
  [1, 'rgba(144,133,233,0.22)'],
]);
const STAGE_PAD = 10;

/**
 * @param {HTMLElement} stage
 * @param {HTMLCanvasElement} canvas
 * @param {{ onPick: (die: number, viaKeyboard: boolean) => void, onHover: (die: number) => void, onSwipe: (dir: 1 | -1) => void, onView: (v: { k: number, pxPerMm: number }) => void }} handlers
 */
function createWaferMap(stage, canvas, handlers) {
  const ctx = canvas.getContext('2d');
  const { spec } = GEO;
  const edgeX = new Float32Array(spec.cols + 1);
  const edgeY = new Float32Array(spec.rows + 1);

  let size = 0; // 무대 한 변, CSS px
  let dpr = 1;
  let view = { k: 1, tx: 0, ty: 0 };
  /** @type {MapLayer} */
  let layer = { cls: new Uint8Array(GEO.count), palette: ['die'] };
  let pinned = -1;
  let hover = -1;
  let sheen = 0;
  let reveal = 1; // 0 → 1: 프로버가 위에서 아래로 훑는 연출
  let frame = 0;
  let tween = 0;

  const half = () => size / 2;
  const pxPerMm = () => ((size - 2 * STAGE_PAD) / (2 * spec.radius)) * view.k;

  function emitView() {
    stage.toggleAttribute('data-zoomed', view.k > 1.001);
    handlers.onView({ k: view.k, pxPerMm: pxPerMm() });
  }

  function requestDraw() {
    if (!frame) frame = requestAnimationFrame(drawNow);
  }

  function drawNow() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (!ctx || size === 0) return;
    const scale = pxPerMm();
    const cx = half() + view.tx;
    const cy = half() + view.ty;
    const R = spec.radius * scale;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // 원판과 표면 광택
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fillStyle = tokens.disc;
    ctx.fill();
    if (typeof ctx.createConicGradient === 'function') {
      const gradient = ctx.createConicGradient(sheen, cx, cy);
      for (const [stop, color] of SHEEN) gradient.addColorStop(stop, color);
      ctx.fillStyle = gradient;
      ctx.fill();
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = tokens.rim;
    ctx.stroke();

    // 노치: 6시 방향을 파낸다. 실제 깊이(약 1 mm)로는 보이지 않아 조금 과장했다
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy + R, Math.max(2.5, 2.4 * scale), 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // 다이: 경계를 기기 픽셀에 맞춰 흐려지지 않게 하고, 같은 색끼리 한 번에 칠한다
    const pitchX = spec.dieW * scale;
    const pitchY = spec.dieH * scale;
    const ox = cx - (spec.cols / 2) * pitchX;
    const oy = cy - (spec.rows / 2) * pitchY;
    for (let i = 0; i <= spec.cols; i++) edgeX[i] = Math.round((ox + i * pitchX) * dpr) / dpr;
    for (let j = 0; j <= spec.rows; j++) edgeY[j] = Math.round((oy + j * pitchY) * dpr) / dpr;
    const devicePitch = pitchX * dpr;
    const gap = (devicePitch >= 14 ? Math.max(1, Math.round(dpr * 0.75)) : devicePitch >= 6 ? 1 : 0) / dpr;
    const rowLimit = reveal >= 1 ? spec.rows : Math.floor(reveal * spec.rows);

    for (let c = 0; c < layer.palette.length; c++) {
      let any = false;
      ctx.beginPath();
      for (let i = 0; i < GEO.count; i++) {
        if (layer.cls[i] !== c || GEO.row[i] >= rowLimit) continue;
        const x = edgeX[GEO.col[i]];
        const y = edgeY[GEO.row[i]];
        const w = edgeX[GEO.col[i] + 1] - x - gap;
        const hgt = edgeY[GEO.row[i] + 1] - y - gap;
        if (x > size || y > size || x + w < 0 || y + hgt < 0) continue;
        ctx.rect(x, y, w, hgt);
        any = true;
      }
      if (any) {
        ctx.fillStyle = tokens[layer.palette[c]];
        ctx.fill();
      }
    }

    if (reveal < 1) {
      const y = edgeY[rowLimit];
      const chord = Math.sqrt(Math.max(0, R * R - (y - cy) ** 2));
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = tokens.cursor;
      ctx.fillRect(cx - chord, y, chord * 2, 1.5);
      ctx.globalAlpha = 1;
    }

    drawMarker(hover, false, gap);
    drawMarker(pinned, true, gap);
  }

  /** @param {number} die @param {boolean} strong @param {number} gap */
  function drawMarker(die, strong, gap) {
    if (!ctx || die < 0 || (!strong && die === pinned)) return;
    const x = edgeX[GEO.col[die]];
    const y = edgeY[GEO.row[die]];
    const w = edgeX[GEO.col[die] + 1] - x - gap;
    const hgt = edgeY[GEO.row[die] + 1] - y - gap;
    ctx.strokeStyle = tokens.cursor;
    ctx.globalAlpha = strong ? 1 : 0.75;
    ctx.lineWidth = strong ? 2 : 1;
    ctx.strokeRect(x - 1, y - 1, w + 2, hgt + 2);
    if (strong && w < 16) {
      // 다이가 작을 때는 주변에 원을 둘러 어디를 골랐는지 찾기 쉽게 한다
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x + w / 2, y + hgt / 2, 13, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** 화면 좌표(무대 왼쪽 위 기준) → 다이 인덱스. @param {number} px @param {number} py */
  function dieAt(px, py) {
    const scale = pxPerMm();
    const col = Math.floor((px - (half() + view.tx)) / (spec.dieW * scale) + spec.cols / 2);
    const row = Math.floor((py - (half() + view.ty)) / (spec.dieH * scale) + spec.rows / 2);
    if (col < 0 || row < 0 || col >= spec.cols || row >= spec.rows) return -1;
    return GEO.lookup[row * spec.cols + col];
  }

  /** @param {{ k: number, tx: number, ty: number }} next @param {boolean} [animate] */
  function setView(next, animate = false) {
    cancelAnimationFrame(tween);
    const target = clampView(next, half());
    if (!animate || !motionOK()) {
      view = target;
      requestDraw();
      emitView();
      return;
    }
    const from = view;
    const t0 = performance.now();
    /** @param {number} now */
    const step = (now) => {
      const t = Math.min(1, (now - t0) / 200);
      const e = 1 - (1 - t) ** 3;
      view = {
        k: from.k + (target.k - from.k) * e,
        tx: from.tx + (target.tx - from.tx) * e,
        ty: from.ty + (target.ty - from.ty) * e,
      };
      drawNow();
      emitView();
      if (t < 1) tween = requestAnimationFrame(step);
    };
    tween = requestAnimationFrame(step);
  }

  /** @param {number} factor */
  const zoomBy = (factor) => setView(zoomAbout(view, view.k * factor, 0, 0, half()), true);
  const resetView = () => setView({ k: 1, tx: 0, ty: 0 }, true);

  function playReveal() {
    cancelAnimationFrame(tween);
    if (!motionOK() || document.hidden) {
      reveal = 1;
      requestDraw();
      return;
    }
    const t0 = performance.now();
    /** @param {number} now */
    const step = (now) => {
      const t = Math.min(1, (now - t0) / 260);
      reveal = 1 - (1 - t) ** 3;
      drawNow();
      if (t < 1) tween = requestAnimationFrame(step);
    };
    tween = requestAnimationFrame(step);
  }

  /** 키보드로 옮긴 다이가 화면 밖이면 보이는 곳까지 맵을 민다. @param {number} die */
  function ensureVisible(die) {
    if (view.k <= 1.001) return;
    const scale = pxPerMm();
    const x = half() + view.tx + GEO.x[die] * scale;
    const y = half() + view.ty + GEO.y[die] * scale;
    const margin = 28;
    const dx = x < margin ? margin - x : x > size - margin ? size - margin - x : 0;
    const dy = y < margin ? margin - y : y > size - margin ? size - margin - y : 0;
    if (dx || dy) setView({ k: view.k, tx: view.tx + dx, ty: view.ty + dy });
  }

  /** @param {number} dc @param {number} dr */
  function moveCursor(dc, dr) {
    const { cols, rows } = spec;
    let die = pinned;
    if (die < 0) {
      die = GEO.lookup[(rows >> 1) * cols + (cols >> 1)];
    } else {
      const col = GEO.col[die] + dc;
      const row = GEO.row[die] + dr;
      const next = col < 0 || row < 0 || col >= cols || row >= rows ? -1 : GEO.lookup[row * cols + col];
      if (next < 0) return; // 웨이퍼 밖으로는 나가지 않는다
      die = next;
    }
    handlers.onPick(die, true);
    ensureVisible(die);
  }

  /* --- 포인터: 누르기, 끌기, 두 손가락 확대, 좌우로 밀기 --- */

  /** @typedef {{ x: number, y: number }} Pt */
  /** @type {Map<number, Pt>} */
  const pointers = new Map();
  /** @type {null | { kind: 'press', start: Pt, view: typeof view, moved: boolean, tapOk: boolean } | { kind: 'pinch', dist: number, mid: Pt, view: typeof view }} */
  let gesture = null;
  /** @type {null | { t: number, x: number, y: number }} */
  let lastTap = null;

  /** @param {{ clientX: number, clientY: number }} e @returns {Pt} */
  const local = (e) => {
    const rect = stage.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  /** @param {Pt} p */
  const centered = (p) => ({ x: p.x - half(), y: p.y - half() });

  /** 손가락 수가 바뀔 때마다 기준점을 다시 잡는다. @param {boolean} tapOk */
  function beginGesture(tapOk) {
    const pts = [...pointers.values()];
    if (pts.length === 1) {
      gesture = { kind: 'press', start: pts[0], view: { ...view }, moved: !tapOk, tapOk };
    } else if (pts.length >= 2) {
      const [a, b] = pts;
      gesture = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: { ...view } };
    } else {
      gesture = null;
    }
  }

  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    cancelAnimationFrame(tween);
    pointers.set(e.pointerId, local(e));
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      // 캡처를 못 해도 무대 안에서는 그대로 동작한다
    }
    beginGesture(pointers.size === 1);
  });

  stage.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (!pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse') setHover(dieAt(p.x, p.y));
      return;
    }
    pointers.set(e.pointerId, p);
    if (!gesture) return;
    if (gesture.kind === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const focal = centered(gesture.mid);
      const zoomed = zoomAbout(gesture.view, gesture.view.k * (dist / gesture.dist), focal.x, focal.y, half());
      setView({ k: zoomed.k, tx: zoomed.tx + (mid.x - gesture.mid.x), ty: zoomed.ty + (mid.y - gesture.mid.y) });
    } else if (gesture.kind === 'press') {
      const dx = p.x - gesture.start.x;
      const dy = p.y - gesture.start.y;
      if (!gesture.moved && Math.hypot(dx, dy) > 6) gesture.moved = true;
      if (gesture.moved && gesture.view.k > 1.001) {
        stage.toggleAttribute('data-dragging', true);
        setView({ k: gesture.view.k, tx: gesture.view.tx + dx, ty: gesture.view.ty + dy });
      }
    }
  });

  /** @param {PointerEvent} e */
  function endPointer(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    stage.toggleAttribute('data-dragging', false);
    const g = gesture;
    if (g && g.kind === 'press' && g.tapOk && e.type === 'pointerup') {
      const dx = p.x - g.start.x;
      const dy = p.y - g.start.y;
      if (!g.moved) tap(p, e.timeStamp);
      else if (g.view.k <= 1.001 && e.pointerType !== 'mouse' && Math.abs(dx) > 56 && Math.abs(dx) > 1.8 * Math.abs(dy)) {
        handlers.onSwipe(dx < 0 ? 1 : -1);
      }
    }
    beginGesture(false); // 확대하다 한 손가락을 떼면 남은 손가락으로 계속 끌 수 있다
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && pointers.size === 0) setHover(-1);
  });

  /** @param {Pt} p @param {number} time */
  function tap(p, time) {
    if (lastTap && time - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 28) {
      lastTap = null;
      const focal = centered(p);
      setView(view.k > 1.5 ? { k: 1, tx: 0, ty: 0 } : zoomAbout(view, 3, focal.x, focal.y, half()), true);
      return;
    }
    lastTap = { t: time, x: p.x, y: p.y };
    handlers.onPick(dieAt(p.x, p.y), false);
  }

  /** @param {number} die */
  function setHover(die) {
    if (die === hover) return;
    hover = die;
    handlers.onHover(die);
    requestDraw();
  }

  // 페이지 스크롤을 가로채지 않는다. Ctrl/⌘ + 휠(트랙패드 두 손가락 벌리기 포함)일 때만 확대한다
  stage.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const focal = centered(local(e));
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      setView(zoomAbout(view, view.k * Math.exp(-delta * 0.0045), focal.x, focal.y, half()));
    },
    { passive: false },
  );

  // Safari 데스크톱의 트랙패드 확대는 wheel이 아니라 gesture 이벤트로 온다
  let gestureStartK = 1;
  stage.addEventListener('gesturestart', (e) => {
    e.preventDefault();
    gestureStartK = view.k;
  });
  stage.addEventListener('gesturechange', (/** @type {any} */ e) => {
    e.preventDefault();
    if (pointers.size > 0) return; // 터치는 포인터 이벤트 쪽에서 이미 처리한다
    const focal = centered(local(e));
    setView(zoomAbout(view, gestureStartK * e.scale, focal.x, focal.y, half()));
  });

  stage.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    /** @type {Record<string, [number, number]>} */
    const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const step = steps[e.key];
    if (step) {
      e.preventDefault();
      moveCursor(step[0], step[1]);
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      zoomBy(1.6);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      zoomBy(1 / 1.6);
    } else if (e.key === '0') {
      e.preventDefault();
      resetView();
    }
  });

  function resize() {
    const nextSize = Math.round(stage.getBoundingClientRect().width);
    const nextDpr = Math.min(window.devicePixelRatio || 1, 3);
    if (nextSize === size && nextDpr === dpr) return;
    size = nextSize;
    dpr = nextDpr;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    view = clampView(view, half());
    drawNow(); // 크기를 바꾸면 캔버스가 지워지므로 같은 프레임에 다시 그린다
    emitView();
  }
  new ResizeObserver(resize).observe(stage);

  return {
    resize,
    drawNow,
    zoomBy,
    resetView,
    isZoomed: () => view.k > 1.001,
    /** @param {MapLayer} next @param {{ animate?: boolean, sheen?: number }} [options] */
    setLayer(next, options = {}) {
      layer = next;
      sheen = options.sheen ?? 0;
      if (options.animate) playReveal();
      else {
        reveal = 1;
        requestDraw();
      }
    },
    /** @param {number} die */
    setPinned(die) {
      pinned = die;
      requestDraw();
    },
  };
}

/* ---------- 7. 관리도 (SVG) ---------- */

/** @param {number} lowest 표시해야 하는 가장 낮은 값(0~1) */
function niceAxis(lowest) {
  const span = 1 - lowest;
  const step = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5].find((st) => span / st <= 5) ?? 0.5;
  // 정수 % 단위로 계산해 0.30000000000000004 같은 꼬리를 없앤다
  const stepPct = Math.round(step * 100);
  const minPct = Math.max(0, Math.floor((lowest * 100) / stepPct) * stepPct);
  const ticks = [];
  for (let v = minPct; v <= 100; v += stepPct) ticks.push(v / 100);
  return { min: minPct / 100, ticks };
}

const MARK_PATH = {
  watch: 'M0 -5.8 5.4 4 -5.4 4Z',
  out: 'M0 -6 6 0 0 6 -6 0Z',
};

/**
 * @param {HTMLElement} container
 * @param {{ onSelect: (slot: number) => void }} handlers
 */
function createControlChart(container, handlers) {
  /** @type {Lot | null} */
  let lot = null;
  let width = 0;
  let selected = 0;
  /** @type {Map<number, SVGElement>} */
  const points = new Map();
  /** @type {SVGElement | null} */
  let cross = null;
  /** @type {SVGElement | null} */
  let svgEl = null;
  /** @type {(slot: number) => number} */
  let xOf = () => 0;
  /** @type {(v: number) => number} */
  let yOf = () => 0;

  function build() {
    points.clear();
    cross = null;
    svgEl = null;
    if (!lot || width < 120) {
      container.replaceChildren();
      return;
    }
    const data = lot;
    const W = width;
    const H = W < 520 ? 236 : 276;
    const m = { top: 14, right: 54, bottom: 26, left: 40 };
    const plotRight = W - m.right;
    const plotBottom = H - m.bottom;
    const count = data.wafers.length;
    const axis = niceAxis(Math.min(data.limits.lcl, ...data.wafers.map((w) => w.yield)));

    xOf = (slot) => m.left + 12 + ((slot - 1) / (count - 1)) * (plotRight - m.left - 24);
    yOf = (v) => m.top + (1 - (v - axis.min) / (1 - axis.min)) * (plotBottom - m.top);

    const furniture = s('g', { 'aria-hidden': 'true' });
    for (const tick of axis.ticks) {
      const y = Math.round(yOf(tick)) + 0.5;
      furniture.append(
        s('line', { class: 'c-grid', x1: m.left, x2: plotRight, y1: y, y2: y }),
        s('text', { class: 'c-tick', x: m.left - 8, y: y + 4, 'text-anchor': 'end', text: `${Math.round(tick * 100)}%` }),
      );
    }
    const everyOther = W >= 680 ? 1 : 5;
    for (const w of data.wafers) {
      if (w.slot !== 1 && w.slot % everyOther !== 0) continue;
      furniture.append(s('text', { class: 'c-tick', x: xOf(w.slot), y: H - 6, 'text-anchor': 'middle', text: slotName(w.slot) }));
    }

    // 한계선과 오른쪽 이름표. 이름표끼리 겹치면 위아래로 벌리고 짧은 이음선을 긋는다
    const lines = [
      { key: 'ucl', label: '상한', y: yOf(data.limits.ucl), cls: 'c-limit' },
      { key: 'cl', label: '중심선', y: yOf(data.limits.cl), cls: 'c-cl' },
      { key: 'lcl', label: '하한', y: yOf(data.limits.lcl), cls: 'c-limit' },
    ];
    const labelY = lines.map((l) => l.y);
    const minGap = 14;
    if (labelY[1] - labelY[0] < minGap) labelY[0] = labelY[1] - minGap;
    if (labelY[2] - labelY[1] < minGap) labelY[2] = labelY[1] + minGap;
    lines.forEach((line, index) => {
      const y = Math.round(line.y) + 0.5;
      furniture.append(s('line', { class: line.cls, x1: m.left, x2: plotRight, y1: y, y2: y }));
      if (Math.abs(labelY[index] - line.y) > 1) {
        furniture.append(s('line', { class: 'c-leader', x1: plotRight, y1: y, x2: plotRight + 6, y2: labelY[index] }));
      }
      furniture.append(s('text', { class: 'c-tick', x: plotRight + 8, y: labelY[index] + 4, text: line.label }));
    });

    furniture.append(s('path', { class: 'c-line', d: data.wafers.map((w, i) => `${i ? 'L' : 'M'}${xOf(w.slot).toFixed(1)} ${yOf(w.yield).toFixed(1)}`).join('') }));

    cross = s('line', { class: 'c-cross', y1: m.top, y2: plotBottom, visibility: 'hidden' });
    furniture.append(cross);

    // 점 사이가 좁으면 배경색 테두리가 선을 다 가린다. 그때는 선과 같은 색인 정상 점의 테두리를 뺀다
    const dense = xOf(2) - xOf(1) < 16;
    const list = s('g', { role: 'listbox', 'aria-label': '슬롯별 수율', 'aria-orientation': 'horizontal', 'data-dense': dense });
    for (const w of data.wafers) {
      const status = /** @type {'ok' | 'watch' | 'out'} */ (w.status);
      const mark = status === 'ok' ? s('circle', { class: 'c-mark', r: dense ? 3.5 : 4 }) : s('path', { class: 'c-mark', d: MARK_PATH[status] });
      const point = s(
        'g',
        {
          class: 'c-pt',
          role: 'option',
          tabindex: '-1',
          'aria-selected': 'false',
          'aria-label': `슬롯 ${slotName(w.slot)}, 수율 ${pct(w.yield)}, ${STATUS[status].label}`,
          'data-slot': w.slot,
          'data-status': status,
          transform: `translate(${xOf(w.slot).toFixed(1)} ${yOf(w.yield).toFixed(1)})`,
        },
        s('circle', { class: 'c-ring', r: 9 }),
        mark,
      );
      points.set(w.slot, point);
      list.append(point);
    }

    // 직접 이름표는 가장 낮은 점 하나에만 붙인다. 나머지 값은 툴팁과 표가 맡는다
    const lowest = data.wafers.reduce((a, b) => (b.yield < a.yield ? b : a));
    const lx = Math.min(plotRight - 20, Math.max(m.left + 20, xOf(lowest.slot)));
    const ly = yOf(lowest.yield);
    const below = ly + 24 < plotBottom;
    const label = s('text', { class: 'c-label', 'aria-hidden': 'true', x: lx, y: below ? ly + 21 : ly - 13, 'text-anchor': 'middle', text: pct(lowest.yield) });

    svgEl = s(
      'svg',
      { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'group', 'aria-label': `슬롯별 수율 관리도. 중심선 ${pct(data.limits.cl)}, 관리 하한 ${pct(data.limits.lcl)}. 화살표 키로 점을 옮기고 Enter로 그 웨이퍼를 엽니다.` },
      furniture,
      label,
      list,
    );
    wire(svgEl);
    container.replaceChildren(svgEl);
    select(selected);
  }

  /** @param {number} clientX */
  function nearestSlot(clientX) {
    if (!svgEl || !lot) return 1;
    const rect = svgEl.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * width;
    const step = xOf(2) - xOf(1);
    return Math.min(lot.wafers.length, Math.max(1, Math.round((x - xOf(1)) / step) + 1));
  }

  /** 십자선과 툴팁: 포인터가 선 위에 정확히 올라가지 않아도 가장 가까운 슬롯을 잡는다. @param {number} slot */
  function showAt(slot) {
    if (!lot || !svgEl || !cross) return;
    const w = waferOf(lot, slot);
    const x = Math.round(xOf(slot)) + 0.5;
    cross.setAttribute('x1', String(x));
    cross.setAttribute('x2', String(x));
    cross.setAttribute('visibility', 'visible');
    const rect = svgEl.getBoundingClientRect();
    const scale = rect.width / width;
    const status = /** @type {'ok' | 'watch' | 'out'} */ (w.status);
    showTip(rect.left + xOf(slot) * scale, rect.top + yOf(w.yield) * scale, pct(w.yield), [
      `슬롯 ${slotName(slot)}, ${STATUS[status].label}`,
      w.pattern.key === 'none' ? '' : PATTERN_LABEL[w.pattern.key],
    ]);
  }

  function hide() {
    cross?.setAttribute('visibility', 'hidden');
    hideTip();
  }

  /** @param {SVGElement} el */
  function wire(el) {
    el.addEventListener('pointermove', (e) => {
      if (/** @type {PointerEvent} */ (e).pointerType === 'touch') return; // 터치는 누르면 바로 선택되므로 툴팁이 필요 없다
      showAt(nearestSlot(/** @type {PointerEvent} */ (e).clientX));
    });
    el.addEventListener('pointerleave', hide);
    el.addEventListener('click', (e) => handlers.onSelect(nearestSlot(/** @type {MouseEvent} */ (e).clientX)));
    el.addEventListener('focusin', (e) => {
      const point = /** @type {Element} */ (e.target).closest('.c-pt');
      if (point && point.matches(':focus-visible')) showAt(Number(point.getAttribute('data-slot')));
    });
    el.addEventListener('focusout', hide);
    el.addEventListener('keydown', (e) => {
      const ke = /** @type {KeyboardEvent} */ (e);
      const point = /** @type {Element} */ (ke.target).closest('.c-pt');
      if (!point || !lot) return;
      const slot = Number(point.getAttribute('data-slot'));
      /** @type {Record<string, number>} */
      const moves = { ArrowLeft: slot - 1, ArrowRight: slot + 1, Home: 1, End: lot.wafers.length };
      if (ke.key in moves) {
        ke.preventDefault();
        const next = Math.min(lot.wafers.length, Math.max(1, moves[ke.key]));
        /** @type {any} */ (points.get(next))?.focus();
      } else if (ke.key === 'Enter' || ke.key === ' ') {
        ke.preventDefault();
        handlers.onSelect(slot);
      }
    });
  }

  /** @param {number} slot */
  function select(slot) {
    selected = slot;
    for (const [n, point] of points) {
      point.setAttribute('aria-selected', String(n === slot));
      point.setAttribute('tabindex', n === slot ? '0' : '-1');
    }
  }

  return {
    select,
    /** @param {Lot} next */
    setLot(next) {
      lot = next;
      width = Math.round(container.clientWidth);
      build();
    },
    resize() {
      const next = Math.round(container.clientWidth);
      if (next === 0 || next === width) return; // 숨겨진 동안(표 보기)에는 다시 그리지 않는다
      width = next;
      build();
    },
  };
}

/* ---------- 8. 툴팁, 알림, 낭독 ---------- */

/** @param {number} x @param {number} y 뷰포트 좌표 @param {string} value @param {string[]} lines */
function showTip(x, y, value, lines) {
  els.tip.replaceChildren(h('strong', { text: value }), ...lines.filter(Boolean).map((line) => h('div', { text: line })));
  els.tip.hidden = false;
  const w = els.tip.offsetWidth;
  const hgt = els.tip.offsetHeight;
  const left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2));
  const top = y - hgt - 14 < 8 ? y + 16 : y - hgt - 14;
  els.tip.style.translate = `${Math.round(left)}px ${Math.round(top)}px`;
}

function hideTip() {
  els.tip.hidden = true;
}

let toastTimer = 0;

/**
 * 한 번에 하나만 띄운다. 포인터나 초점이 올라가 있는 동안에는 사라지지 않는다.
 * @param {string} message
 * @param {{ actionLabel?: string, onAction?: () => void }} [options]
 */
function toast(message, options = {}) {
  const dismiss = () => {
    clearTimeout(toastTimer);
    node.remove();
  };
  const arm = () => {
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(dismiss, options.onAction ? 7000 : 4000);
  };
  const node = h(
    'div',
    { class: 'toast' },
    h('span', { text: message }),
    options.onAction &&
      h('button', {
        type: 'button',
        class: 'toast-action',
        text: options.actionLabel,
        onclick: () => {
          options.onAction?.();
          dismiss();
        },
      }),
    h('button', { type: 'button', class: 'toast-close', 'aria-label': '알림 닫기', onclick: dismiss }, icon('close')),
  );
  node.addEventListener('pointerenter', () => clearTimeout(toastTimer));
  node.addEventListener('pointerleave', arm);
  node.addEventListener('focusin', () => clearTimeout(toastTimer));
  node.addEventListener('focusout', arm);
  clearTimeout(toastTimer);
  els.toasts.replaceChildren(node);
  arm();
}

let announceTimer = 0;

/** 화면 낭독기에만 전하는 한 줄. 연속 입력은 마지막 것만 읽힌다. @param {string} text */
function announce(text) {
  clearTimeout(announceTimer);
  announceTimer = window.setTimeout(() => {
    els.announce.textContent = text;
  }, 120);
}

/* ---------- 9. 렌더러 ---------- */

/** @param {Lot} lot @param {State} state @returns {MapLayer} */
function buildLayer(lot, state) {
  const cls = new Uint8Array(GEO.count);
  if (state.mode === 'lot') {
    const counts = lot.stack[state.bin];
    const breaks = stackBreaks(state.bin);
    for (let i = 0; i < GEO.count; i++) cls[i] = stackClass(counts[i], breaks);
    return { cls, palette: ['die', 's1', 's2', 's3', 's4', 's5'] };
  }
  const bins = waferOf(lot, state.slot).bins;
  for (let i = 0; i < GEO.count; i++) {
    cls[i] = bins[i] === BIN_PASS ? 0 : state.bin === 0 || bins[i] === state.bin ? 1 : 2;
  }
  return { cls, palette: ['die', 'fail', 'dim'] };
}

/** 판정 근거를 한 문장으로. 숫자는 판정에 실제로 쓰인 값 그대로다. @param {Wafer['pattern']} p */
function patternEvidence(p) {
  /** @type {any} */
  const e = p;
  switch (p.key) {
    case 'edgeRing':
      return `가장자리 구역 불량률이 ${pct(e.edge)}로 안쪽 ${pct(e.inner)}의 ${nf1.format(e.ratio)}배이고, 둘레 전체에 고르게 퍼져 있습니다.`;
    case 'edgeLoc':
      return e.size
        ? `${e.hour}시 방향 가장자리에 불량 다이 ${e.size}개가 한 덩어리로 붙어 있습니다.`
        : `가장자리 불량이 ${e.hour}시 방향에 몰려 있습니다. 가장자리 구역 불량률 ${pct(e.edge)}, 안쪽 ${pct(e.inner)}.`;
    case 'center':
      return `중심부 불량률이 ${pct(e.center)}로 바깥쪽 ${pct(e.outer)}의 ${nf1.format(e.ratio)}배입니다.`;
    case 'donut':
      return `반경 30~70% 구간 불량률이 ${pct(e.mid)}로 중심부 ${pct(e.center)}, 가장자리 ${pct(e.edge)}보다 높고 고리 모양으로 이어집니다.`;
    case 'loc':
      return `${e.hour}시 방향, 반경 ${nf0.format(e.rNorm * 100)}% 위치에 불량 다이 ${e.size}개가 한 덩어리로 붙어 있습니다.`;
    case 'scratch':
      return `길이 약 ${nf0.format(e.length)} mm의 가는 선을 따라 불량 다이 ${e.size}개가 이어져 있습니다.`;
    case 'random':
      return `불량률 ${pct(e.failRate)}가 구역과 상관없이 고르게 높습니다.`;
    case 'nearFull':
      return `다이의 ${pct(e.failRate)}가 불량입니다.`;
    default:
      return '구역 간 불량률 차이와 불량 군집이 모두 기준 이내입니다.';
  }
}

/** @param {string} key */
const shortPattern = (key) => PATTERN_LABEL[/** @type {keyof typeof PATTERN_LABEL} */ (key)].split(' (')[0];
/** @param {string} key */
const patternLabel = (key) => PATTERN_LABEL[/** @type {keyof typeof PATTERN_LABEL} */ (key)];
/** @param {number} bin */
const binLabel = (bin) => BIN_LABEL[/** @type {keyof typeof BIN_LABEL} */ (bin)];

/** @param {State} now @param {Partial<State>} prev */
function renderLot(now, prev) {
  if (!changed(now, prev, 'lotId', 'holds')) return;
  const lot = getLot(now.lotId);
  if (now.lotId !== prev.lotId) {
    els.lotSelect.value = lot.id;
    els.lotId.textContent = lot.id;
    els.lotMeta.textContent = `${lot.product}, ${lot.step} 검사. ${dtf.format(new Date(lot.tested))} 완료. 웨이퍼당 다이 ${nf0.format(GEO.count)}개.`;
    els.lotYield.textContent = pct(lot.yield);
    els.lotOut.textContent = String(lot.counts.out);
    els.lotWatch.textContent = String(lot.counts.watch);
    setTone(els.lotOut, lot.counts.out > 0 ? 'out' : null);
    setTone(els.lotWatch, lot.counts.watch > 0 ? 'watch' : null);
    els.stripCount.textContent = `${lot.wafers.length}매`;
    els.limCl.textContent = pct(lot.limits.cl);
    els.limLcl.textContent = pct(lot.limits.lcl);
    els.limUcl.textContent = pct(lot.limits.ucl);
    els.nextFlagged.toggleAttribute('disabled', lot.counts.out === 0);
  }
  els.lotHold.textContent = String(holdsOf(now).length);
}

/** 수치 칸 왼쪽 줄무늬의 색을 상태로 정한다. @param {HTMLElement} valueEl @param {string | null} status */
function setTone(valueEl, status) {
  const stat = valueEl.closest('.stat');
  if (!stat) return;
  if (status) stat.setAttribute('data-status', status);
  else stat.removeAttribute('data-status');
}

/** @param {Wafer} w */
function waferOption(w) {
  const status = /** @type {'ok' | 'watch' | 'out'} */ (w.status);
  const base = `슬롯 ${slotName(w.slot)}, 수율 ${pct(w.yield)}, ${STATUS[status].label}${w.pattern.key === 'none' ? '' : `, ${patternLabel(w.pattern.key)}`}`;
  return h(
    'button',
    { type: 'button', class: 'wf', role: 'option', tabindex: '-1', 'aria-selected': 'false', 'aria-label': base, 'data-label': base, 'data-slot': w.slot, 'data-status': status },
    h('canvas', { 'aria-hidden': 'true' }),
    h('span', { class: 'wf-slot', text: slotName(w.slot) }),
    h('span', { class: 'wf-yield', text: pct(w.yield) }),
    status !== 'ok' && h('span', { class: 'wf-flag' }, icon(STATUS[status].icon)),
    h('span', { class: 'wf-hold', hidden: true }, icon('pause')),
  );
}

const thumbGrid = document.createElement('canvas');
thumbGrid.width = GEO.spec.cols;
thumbGrid.height = GEO.spec.rows;
const thumbCtx = thumbGrid.getContext('2d');

/**
 * 썸네일은 "다이 하나 = 픽셀 하나"로 작은 비트맵을 만든 뒤 확대해 붙인다.
 * 25매 × 1,300여 다이를 사각형으로 하나씩 그리는 것보다 훨씬 싸다.
 * @param {Lot} lot @param {number} bin
 */
function paintThumbs(lot, bin) {
  if (!thumbCtx) return;
  const { spec } = GEO;
  const px = Math.round(THUMB_PX * Math.min(window.devicePixelRatio || 1, 3));
  const colors = [tokens.die, tokens.fail, tokens.dim].map(parseRgb);
  const image = thumbCtx.createImageData(spec.cols, spec.rows);
  const scale = px / (2 * spec.radius);
  const w = spec.cols * spec.dieW * scale;
  const hgt = spec.rows * spec.dieH * scale;

  lot.wafers.forEach((wafer, index) => {
    const canvas = els.wafers.children[index]?.querySelector('canvas');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    if (canvas.width !== px) {
      canvas.width = px;
      canvas.height = px;
    }
    image.data.fill(0);
    for (let i = 0; i < GEO.count; i++) {
      const b = wafer.bins[i];
      const color = colors[b === BIN_PASS ? 0 : bin === 0 || b === bin ? 1 : 2];
      const o = (GEO.row[i] * spec.cols + GEO.col[i]) * 4;
      image.data[o] = color[0];
      image.data[o + 1] = color[1];
      image.data[o + 2] = color[2];
      image.data[o + 3] = 255;
    }
    thumbCtx.putImageData(image, 0, 0);

    ctx.clearRect(0, 0, px, px);
    ctx.beginPath();
    ctx.arc(px / 2, px / 2, px / 2 - 0.5, 0, TAU);
    ctx.fillStyle = tokens.disc;
    ctx.fill();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(thumbGrid, (px - w) / 2, (px - hgt) / 2, w, hgt);
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = tokens.rim;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(px / 2, px, px * 0.05, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  });
}

/** 목록 자신의 가로 스크롤만 움직인다(페이지 세로 스크롤은 건드리지 않는다). @param {HTMLElement} list @param {Element} item @param {boolean} smooth */
function keepInView(list, item, smooth) {
  if (list.scrollWidth <= list.clientWidth + 1) return;
  const listRect = list.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  const left = list.scrollLeft + (itemRect.left - listRect.left) - (listRect.width - itemRect.width) / 2;
  list.scrollTo({ left, behavior: smooth && motionOK() ? 'smooth' : 'auto' });
}

/** @param {State} now @param {Partial<State>} prev */
function renderStrip(now, prev) {
  const lot = getLot(now.lotId);
  const first = prev.lotId === undefined;
  if (now.lotId !== prev.lotId) els.wafers.replaceChildren(...lot.wafers.map(waferOption));
  if (changed(now, prev, 'lotId', 'bin')) paintThumbs(lot, now.bin);
  if (!changed(now, prev, 'lotId', 'slot', 'holds')) return;

  const held = new Set(holdsOf(now));
  const hadFocus = els.wafers.contains(document.activeElement);
  /** @type {HTMLElement | null} */
  let current = null;
  for (const el of /** @type {HTMLCollectionOf<HTMLElement>} */ (els.wafers.children)) {
    const slot = Number(el.dataset.slot);
    const isCurrent = slot === now.slot;
    el.setAttribute('aria-selected', String(isCurrent));
    el.tabIndex = isCurrent ? 0 : -1;
    el.setAttribute('aria-label', `${el.dataset.label}${held.has(slot) ? ', 보류' : ''}`);
    /** @type {HTMLElement} */ (el.querySelector('.wf-hold')).hidden = !held.has(slot);
    if (isCurrent) current = el;
  }
  if (!current) return;
  if (hadFocus) current.focus({ preventScroll: true });
  if (changed(now, prev, 'lotId', 'slot')) keepInView(els.wafers, current, !first);
}

/** @type {ReturnType<typeof createWaferMap>} */
let map;
let inTransition = false; // 화면 전환 스냅숏 중에는 스캔 연출을 끈다
let hoverDie = -1;

/** @param {State} now @param {Partial<State>} prev */
function renderMap(now, prev) {
  const lot = getLot(now.lotId);
  if (changed(now, prev, 'lotId', 'slot', 'mode', 'bin')) {
    const isWafer = now.mode === 'wafer';
    const animate = prev.lotId !== undefined && !inTransition && isWafer && changed(now, prev, 'lotId', 'slot', 'mode');
    map.setLayer(buildLayer(lot, now), { animate, sheen: isWafer ? now.slot * 0.7 : 0 });
    els.modeWafer.checked = isWafer;
    els.modeLot.checked = !isWafer;
    if (isWafer) {
      const w = waferOf(lot, now.slot);
      els.stageTag.textContent = `슬롯 ${slotName(w.slot)}`;
      els.stage.setAttribute(
        'aria-label',
        `슬롯 ${slotName(w.slot)} 웨이퍼 맵. 다이 ${nf0.format(w.total)}개 중 불량 ${nf0.format(w.fails)}개. 결함 패턴 ${patternLabel(w.pattern.key)}.`,
      );
    } else {
      els.stageTag.textContent = `${lot.wafers.length}매 합성`;
      els.stage.setAttribute('aria-label', `로트 ${lot.id} 합성 맵. 웨이퍼 ${lot.wafers.length}매를 겹쳐 같은 자리에서 불량이 난 매수를 보여 줍니다.`);
    }
  }
  if (changed(now, prev, 'die')) map.setPinned(now.die);
  if (changed(now, prev, 'lotId', 'slot', 'mode', 'bin', 'die')) updateReadout();
}

/** 다이 하나에 대해 화면과 낭독이 함께 쓰는 값. @param {State} state @param {number} die */
function describeDie(state, die) {
  const lot = getLot(state.lotId);
  const coord = dieCoord(GEO, die);
  const where = `X ${signed(coord.x)}, Y ${signed(coord.y)}`;
  const radius = `${nf0.format(GEO.rn[die] * GEO.usable)} mm`;
  if (state.mode === 'lot') {
    let top = 0;
    for (const b of FAIL_BINS) if (lot.stack[b][die] > (top ? lot.stack[top][die] : 0)) top = b;
    return [where, `${lot.stack[state.bin][die]} / ${lot.wafers.length}매`, radius, top ? `${binLabel(top)} ${lot.stack[top][die]}매` : '불량 없음'];
  }
  const bin = waferOf(lot, state.slot).bins[die];
  return [where, `BIN ${bin} ${binLabel(bin)}`, radius, `${lot.stack[0][die]} / ${lot.wafers.length}매`];
}

/** 지나가는 다이(hover)가 있으면 그것을, 없으면 고정한 다이를 보여 준다. */
function updateReadout() {
  const state = store.get();
  const die = hoverDie >= 0 ? hoverDie : state.die;
  const keys = state.mode === 'lot' ? ['좌표', '불량 매수', '중심 거리', '가장 많은 유형'] : ['좌표', '판정', '중심 거리', '같은 자리 불량'];
  const values = die >= 0 ? describeDie(state, die) : ['다이를 눌러 확인', '–', '–', '–'];
  els.readout.toggleAttribute('data-empty', die < 0);
  keys.forEach((key, i) => {
    els.roKeys[i].textContent = key;
    els.roValues[i].textContent = values[i];
  });
}

/** @param {State} now @param {Partial<State>} prev */
function renderLegend(now, prev) {
  if (!changed(now, prev, 'lotId', 'mode', 'bin')) return;
  /** @param {string} cssVar @param {string} label */
  const swatch = (cssVar, label) => h('span', { class: 'swatch', vars: { '--c': `var(${cssVar})` }, text: label });
  if (now.mode === 'wafer') {
    const items = [swatch('--w-die', '양품'), swatch('--w-fail', now.bin ? binLabel(now.bin) : '불량')];
    if (now.bin) items.push(swatch('--w-dim', '그 외 불량'));
    els.legend.replaceChildren(...items);
    return;
  }
  const breaks = stackBreaks(now.bin);
  const classes = breaks.map((lo, i) => {
    const hi = breaks[i + 1];
    return hi === undefined ? `${lo} 이상` : hi - 1 === lo ? String(lo) : `${lo}–${hi - 1}`;
  });
  els.legend.replaceChildren(
    swatch('--w-die', breaks[0] === 1 ? '0' : `0–${breaks[0] - 1}`),
    ...classes.map((label, i) => swatch(`--w-s${i + 1}`, label)),
    h('span', { class: 'legend-note', text: `같은 자리에서 ${now.bin ? `${binLabel(now.bin)} 불량이` : '불량이'} 난 웨이퍼 수 (${getLot(now.lotId).wafers.length}매 중)` }),
  );
}

/** @param {State} now @param {Partial<State>} prev */
function renderDetail(now, prev) {
  if (!changed(now, prev, 'lotId', 'slot', 'mode', 'bin', 'holds')) return;
  const lot = getLot(now.lotId);
  const wafer = waferOf(lot, now.slot);
  const scopeIsLot = now.mode === 'lot';
  const scope = scopeIsLot ? lot : wafer;

  if (changed(now, prev, 'lotId', 'slot', 'mode')) {
    els.detailTitle.textContent = scopeIsLot ? '로트 전체' : `슬롯 ${slotName(wafer.slot)}`;
    els.detailYield.textContent = pct(scope.yield);
    els.detailStatus.hidden = scopeIsLot;
    els.detailActions.hidden = scopeIsLot;

    if (scopeIsLot) {
      els.detailDelta.textContent = `웨이퍼 ${lot.wafers.length}매, 다이 ${nf0.format(lot.total)}개`;
      /** @type {Map<string, number>} */
      const tally = new Map();
      for (const w of lot.wafers) if (w.pattern.key !== 'none') tally.set(w.pattern.key, (tally.get(w.pattern.key) ?? 0) + 1);
      const flagged = [...tally.values()].reduce((a, b) => a + b, 0);
      els.patternName.textContent = flagged ? `패턴이 보이는 웨이퍼 ${flagged}매` : patternLabel('none');
      els.patternWhy.textContent = flagged
        ? `${[...tally].map(([key, n]) => `${shortPattern(key)} ${n}매`).join(', ')}. 합성 맵에서 같은 자리에 반복되는 불량이 밝게 보입니다.`
        : `${lot.wafers.length}매 모두 구역 통계와 불량 군집이 기준 이내입니다.`;
    } else {
      const status = /** @type {'ok' | 'watch' | 'out'} */ (wafer.status);
      const diff = wafer.yield - lot.limits.cl;
      els.detailDelta.textContent =
        Math.abs(diff) < 0.0005 ? '로트 중앙값과 같음' : `로트 중앙값보다 ${nf1.format(Math.abs(diff) * 100)}%p ${diff < 0 ? '낮음' : '높음'}`;
      els.detailStatus.dataset.status = status;
      els.detailStatus.replaceChildren(icon(STATUS[status].icon), STATUS[status].label);
      els.patternName.textContent = patternLabel(wafer.pattern.key);
      els.patternWhy.textContent = patternEvidence(wafer.pattern);
    }

    // 불량 유형: 많은 순서. 순서는 범위(웨이퍼/로트)가 바뀔 때만 다시 정해서, 누른 버튼의 초점이 유지된다
    const ranked = FAIL_BINS.map((bin) => ({ bin, count: scope.binCounts[bin] })).sort((a, b) => b.count - a.count || a.bin - b.bin);
    const max = Math.max(1, ranked[0].count);
    els.bins.replaceChildren(
      ...ranked.map(({ bin, count }) => {
        const share = scope.fails ? count / scope.fails : 0;
        return h(
          'li',
          null,
          h(
            'button',
            { type: 'button', class: 'bin', 'data-bin': bin, 'aria-pressed': 'false', 'aria-label': `${binLabel(bin)}, 다이 ${nf0.format(count)}개, 불량의 ${pct(share)}` },
            h('span', { class: 'bin-name', text: binLabel(bin) }),
            h('span', { class: 'bin-count', text: nf0.format(count) }),
            h('span', { class: 'bin-share', text: pct(share) }),
            h('span', { class: 'bin-bar', vars: { '--v': (count / max).toFixed(4) }, 'data-zero': count === 0 }),
          ),
        );
      }),
    );

    const bounds = [0, ...ZONE_EDGES, 1];
    els.zones.replaceChildren(
      ...ZONE_NAMES.map((name, z) => {
        const rate = scope.zoneTotal[z] ? scope.zoneFail[z] / scope.zoneTotal[z] : 0;
        return h(
          'li',
          { class: 'zone' },
          h('span', { class: 'zone-name' }, name, h('small', { text: `반경 ${Math.round(bounds[z] * 100)}–${Math.round(bounds[z + 1] * 100)}%` })),
          h('span', { class: 'zone-value', text: pct(rate) }),
          h('span', { class: 'zone-meter', 'aria-hidden': 'true' }, h('i', { vars: { '--v': rate.toFixed(4) } })),
        );
      }),
    );
  }

  for (const button of els.bins.querySelectorAll('.bin')) {
    button.setAttribute('aria-pressed', String(Number(button.getAttribute('data-bin')) === now.bin));
  }
  els.clearBin.hidden = now.bin === 0;

  const held = holdsOf(now).includes(now.slot);
  els.toggleHold.setAttribute('aria-pressed', String(held));
  els.holdLabel.textContent = held ? '보류 해제' : '보류 지정';
}

/** @type {ReturnType<typeof createControlChart>} */
let chart;

/** @param {State} now @param {Partial<State>} prev */
function renderSpc(now, prev) {
  const lot = getLot(now.lotId);
  if (now.lotId !== prev.lotId) {
    chart.setLot(lot);
    els.spcRows.replaceChildren(
      ...lot.wafers.map((w) =>
        h(
          'tr',
          { 'data-slot': w.slot },
          h('td', null, h('button', { type: 'button', class: 'btn btn-small', 'data-slot': w.slot, 'aria-label': `슬롯 ${slotName(w.slot)} 열기`, text: slotName(w.slot) })),
          h('td', { class: 'num', text: pct(w.yield) }),
          h('td', null, statusPill(/** @type {'ok' | 'watch' | 'out'} */ (w.status))),
          h('td', { text: patternLabel(w.pattern.key) }),
        ),
      ),
    );
  }
  if (changed(now, prev, 'lotId', 'slot')) {
    chart.select(now.slot);
    for (const row of els.spcRows.children) {
      if (Number(row.getAttribute('data-slot')) === now.slot) row.setAttribute('aria-current', 'true');
      else row.removeAttribute('aria-current');
    }
  }
  if (changed(now, prev, 'table')) {
    els.tablewrap.hidden = !now.table;
    els.chart.hidden = now.table;
    els.toggleTable.setAttribute('aria-pressed', String(now.table));
    if (!now.table) chart.resize();
  }
}

/** @param {State} now @param {Partial<State>} prev */
function syncRoute(now, prev) {
  if (!changed(now, prev, 'lotId', 'slot')) return;
  const target = routeOf(now);
  if (location.hash === target) return;
  try {
    location.replace(target); // 기록을 쌓지 않고 주소만 바꾼다. 뒤로 가기가 웨이퍼 넘김으로 채워지지 않는다
  } catch {
    // 샌드박스가 막으면 주소만 갱신되지 않는다
  }
}

/** @param {State} now @param {Partial<State>} prev */
function persist(now, prev) {
  if (prev.lotId !== undefined && changed(now, prev, 'holds', 'table')) saveStored(now);
}

/* ---------- 10. 동작(action) ---------- */

/**
 * DOM 갱신을 화면 전환으로 감싼다. 지원하지 않거나 모션을 줄인 환경에서는 그냥 실행한다.
 * @param {() => void} update @param {string} [className]
 */
function withTransition(update, className) {
  const run = () => {
    inTransition = true;
    try {
      update();
      store.flush();
      map.drawNow();
    } finally {
      inTransition = false;
    }
  };
  if (typeof document.startViewTransition !== 'function' || !motionOK() || document.hidden) {
    run();
    return;
  }
  if (className) root.classList.add(className);
  const transition = document.startViewTransition(run);
  const done = () => {
    if (className) root.classList.remove(className);
  };
  // 전환이 건너뛰어져도(탭 전환 등) 갱신 자체는 끝난 상태다
  transition.ready.catch(() => {});
  transition.finished.then(done, done);
}

/** @param {number} slot */
function selectWafer(slot) {
  const clamped = Math.min(WAFERS_PER_LOT, Math.max(1, slot));
  store.set({ slot: clamped, mode: 'wafer', die: -1 });
}

/** @param {1 | -1} dir */
function stepWafer(dir) {
  const { slot } = store.get();
  const next = slot + dir;
  if (next >= 1 && next <= WAFERS_PER_LOT) selectWafer(next);
}

/** @param {1 | -1} dir */
function stepFlagged(dir) {
  const state = store.get();
  const lot = getLot(state.lotId);
  const count = lot.wafers.length;
  for (let n = 1; n <= count; n++) {
    const slot = ((state.slot - 1 + dir * n + count * n) % count) + 1;
    if (waferOf(lot, slot).status === 'out') {
      selectWafer(slot);
      announce(`슬롯 ${slotName(slot)}, 수율 ${pct(waferOf(lot, slot).yield)}, 관리 이탈`);
      return;
    }
  }
  toast('이 로트에는 관리 이탈 웨이퍼가 없습니다.');
}

/** @param {'wafer' | 'lot'} mode */
const setMode = (mode) => store.set({ mode, die: -1 });
const toggleMode = () => setMode(store.get().mode === 'wafer' ? 'lot' : 'wafer');

/** @param {number} bin */
const toggleBin = (bin) => store.set({ bin: store.get().bin === bin ? 0 : bin });

/** @param {string} id */
function setLot(id) {
  if (id === store.get().lotId) return;
  const lot = getLot(id);
  withTransition(() => store.set({ lotId: lot.id, slot: defaultSlot(lot), mode: 'wafer', bin: 0, die: -1 }));
}

function toggleHold() {
  const state = store.get();
  if (state.mode !== 'wafer') return;
  const before = state.holds;
  const list = holdsOf(state);
  const held = list.includes(state.slot);
  const next = held ? list.filter((n) => n !== state.slot) : [...list, state.slot].sort((a, b) => a - b);
  store.set({ holds: { ...before, [state.lotId]: next } });
  toast(held ? `슬롯 ${slotName(state.slot)} 웨이퍼의 보류를 해제했습니다.` : `슬롯 ${slotName(state.slot)} 웨이퍼를 보류로 지정했습니다.`, {
    actionLabel: '실행 취소',
    onAction: () => store.set({ holds: before }),
  });
}

const toggleTable = () => store.set({ table: !store.get().table });

/** @param {State} state */
function buildReport(state) {
  const lot = getLot(state.lotId);
  const lines = [
    `[Notch 웨이퍼 리뷰] 로트 ${lot.id} (시뮬레이션 데이터)`,
    `${lot.product} / ${lot.step} / ${dtf.format(new Date(lot.tested))} 검사 완료`,
    `로트 수율 ${pct(lot.yield)} (웨이퍼 ${lot.wafers.length}매, 다이 ${nf0.format(lot.total)}개)`,
    `관리한계: 중심선 ${pct(lot.limits.cl)}, 하한 ${pct(lot.limits.lcl)}, 상한 ${pct(lot.limits.ucl)}`,
  ];
  for (const [status, title] of /** @type {const} */ ([
    ['out', '관리 이탈'],
    ['watch', '주의'],
  ])) {
    const list = lot.wafers.filter((w) => w.status === status);
    lines.push(`${title} ${list.length}매${list.length ? ':' : ''}`);
    for (const w of list) lines.push(`  슬롯 ${slotName(w.slot)}  ${pct(w.yield)}  ${patternLabel(w.pattern.key)}`);
  }
  const held = holdsOf(state);
  lines.push(held.length ? `보류: 슬롯 ${held.map(slotName).join(', ')}` : '보류: 없음');
  return lines.join('\n');
}

/** 클립보드는 사용자 동작 안에서만 쓸 수 있다. 막히면 직접 복사할 수 있게 내용을 보여 준다. */
async function copyReport() {
  const text = buildReport(store.get());
  try {
    await navigator.clipboard.writeText(text);
    toast('리포트를 복사했습니다.');
  } catch {
    els.reportText.value = text;
    els.report.showModal();
    els.reportText.select();
  }
}

/** 테마가 바뀐 뒤: 버튼 문구와 캔버스 색을 새 토큰에 맞춘다. 여러 번 불려도 결과가 같다. */
function syncTheme() {
  const dark = currentTheme() === 'dark';
  els.toggleTheme.setAttribute('aria-label', dark ? '밝은 테마로 바꾸기' : '어두운 테마로 바꾸기');
  els.themeIcon.setAttribute('href', dark ? '#i-sun' : '#i-moon');
  tokens = readTokens();
  if (!store) return;
  const state = store.get();
  paintThumbs(getLot(state.lotId), state.bin);
  map.drawNow();
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  const rect = els.toggleTheme.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  root.style.setProperty('--vt-x', `${x}px`);
  root.style.setProperty('--vt-y', `${y}px`);
  root.style.setProperty('--vt-r', `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`);
  withTransition(() => {
    root.dataset.theme = next;
    syncTheme();
  }, 'vt-theme');
}

/** Esc 한 번에 한 단계씩: 고정한 다이 → 강조 → 확대. 풀 것이 있었으면 true. */
function clearOne() {
  const state = store.get();
  if (state.die >= 0) store.set({ die: -1 });
  else if (state.bin) store.set({ bin: 0 });
  else if (map.isZoomed()) map.resetView();
  else return false;
  return true;
}

/* ---------- 11. 찾기와 명령 ---------- */

/**
 * @typedef {object} PaletteItem
 * @property {string} label
 * @property {string} sub
 * @property {string} kind
 * @property {string} icon
 * @property {string} [status]
 * @property {() => void} run
 * @property {string} hay   검색 대상(정규화한 문자열)
 */

/** 열 때마다 지금 상태에 맞는 항목을 새로 만든다. 문구가 항상 "누르면 일어나는 일"과 일치한다. */
function paletteItems() {
  const state = store.get();
  const lot = getLot(state.lotId);
  /** @type {PaletteItem[]} */
  const items = [];
  /** @param {Omit<PaletteItem, 'hay'> & { keywords?: string }} item */
  const add = (item) => items.push({ ...item, hay: normalizeText(`${item.label} ${item.sub} ${item.kind} ${item.keywords ?? ''}`) });

  if (lot.counts.out) add({ label: '다음 이탈 웨이퍼로 이동', sub: 'N', kind: '명령', icon: 'next', run: () => stepFlagged(1), keywords: 'next out' });
  add({
    label: state.mode === 'wafer' ? '로트 합성 맵 보기' : '웨이퍼 맵 보기',
    sub: 'M',
    kind: '명령',
    icon: 'layers',
    run: toggleMode,
    keywords: 'stack composite map 겹쳐',
  });
  if (state.mode === 'wafer') {
    const held = holdsOf(state).includes(state.slot);
    add({ label: `슬롯 ${slotName(state.slot)} ${held ? '보류 해제' : '보류 지정'}`, sub: 'H', kind: '명령', icon: 'pause', run: toggleHold, keywords: 'hold' });
  }
  if (state.bin) add({ label: '불량 유형 강조 해제', sub: 'Esc', kind: '명령', icon: 'close', run: () => store.set({ bin: 0 }), keywords: 'filter clear' });
  add({ label: '리포트 복사', sub: '', kind: '명령', icon: 'copy', run: copyReport, keywords: 'report copy 보고서' });
  add({ label: state.table ? '관리도를 차트로 보기' : '관리도를 표로 보기', sub: '', kind: '명령', icon: 'table', run: toggleTable, keywords: 'table chart spc' });
  const dark = currentTheme() === 'dark';
  add({ label: dark ? '밝은 테마로 바꾸기' : '어두운 테마로 바꾸기', sub: '', kind: '명령', icon: dark ? 'sun' : 'moon', run: toggleTheme, keywords: 'theme dark light 다크 라이트' });
  add({ label: '단축키와 조작법 보기', sub: '?', kind: '명령', icon: 'keyboard', run: () => els.help.showModal(), keywords: 'help shortcut 도움말' });

  for (const def of LOT_DEFS) {
    if (def.id !== state.lotId) add({ label: `로트 ${def.id} 열기`, sub: def.product, kind: '로트', icon: 'layers', run: () => setLot(def.id), keywords: 'lot' });
  }
  for (const w of lot.wafers) {
    const status = /** @type {'ok' | 'watch' | 'out'} */ (w.status);
    add({
      label: `슬롯 ${slotName(w.slot)}`,
      sub: `${pct(w.yield)}, ${STATUS[status].label}${w.pattern.key === 'none' ? '' : `, ${shortPattern(w.pattern.key)}`}`,
      kind: '웨이퍼',
      icon: STATUS[status].icon,
      status,
      run: () => selectWafer(w.slot),
      keywords: `${w.slot} w${w.slot} wafer ${patternLabel(w.pattern.key)}`,
    });
  }
  return items;
}

const palette = {
  /** @type {PaletteItem[]} */ items: [],
  /** @type {PaletteItem[]} */ shown: [],
  active: 0,
};

function openPalette() {
  if (els.palette.open) return;
  if (els.help.open) els.help.close();
  palette.items = paletteItems();
  els.paletteInput.value = '';
  renderPalette('');
  els.palette.showModal();
  els.paletteInput.focus();
}

/** @param {string} query */
function renderPalette(query) {
  palette.shown = searchItems(palette.items, query);
  palette.active = 0;
  els.paletteList.replaceChildren(
    ...palette.shown.map((item, i) =>
      h(
        'li',
        { class: 'palette-item', role: 'option', id: `palette-option-${i}`, 'aria-selected': String(i === 0), 'data-index': i, 'data-status': item.status },
        icon(item.icon),
        h('span', { class: 'palette-label' }, item.label, item.sub && h('span', { class: 'palette-sub', text: item.sub })),
        h('span', { class: 'palette-kind', text: item.kind }),
      ),
    ),
  );
  const empty = palette.shown.length === 0;
  els.paletteList.hidden = empty;
  els.paletteEmpty.hidden = !empty;
  if (empty) els.paletteEmpty.textContent = `"${query.trim()}"에 맞는 항목이 없습니다. 슬롯 번호나 패턴 이름으로 찾아 보세요.`;
  syncPaletteActive(false);
}

/** @param {boolean} scroll */
function syncPaletteActive(scroll) {
  const options = els.paletteList.children;
  for (let i = 0; i < options.length; i++) options[i].setAttribute('aria-selected', String(i === palette.active));
  const active = options[palette.active];
  if (active) els.paletteInput.setAttribute('aria-activedescendant', active.id);
  else els.paletteInput.removeAttribute('aria-activedescendant');
  if (scroll) active?.scrollIntoView({ block: 'nearest' });
}

/** @param {number} index */
function runPaletteItem(index) {
  const item = palette.shown[index];
  if (!item) return;
  els.palette.close(); // 먼저 닫아 초점을 원래 자리로 돌려놓은 뒤 실행한다
  item.run();
}

/* ---------- 12. 입력 연결 ---------- */

function wire() {
  for (const def of LOT_DEFS) els.lotSelect.append(h('option', { value: def.id, text: def.id }));
  els.lotSelect.addEventListener('change', () => setLot(els.lotSelect.value));

  const isApple = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  els.findKbd.textContent = isApple ? '⌘K' : 'Ctrl K';
  els.helpMod.textContent = isApple ? '⌘' : 'Ctrl';

  els.skipLink.addEventListener('click', (e) => {
    e.preventDefault(); // 주소의 #은 웨이퍼 경로로 쓰고 있으므로 건드리지 않는다
    els.main.focus();
  });

  els.openPalette.addEventListener('click', openPalette);
  els.toggleTheme.addEventListener('click', toggleTheme);
  els.openHelp.addEventListener('click', () => els.help.showModal());
  els.copyReport.addEventListener('click', copyReport);
  els.nextFlagged.addEventListener('click', () => stepFlagged(1));
  els.toggleHold.addEventListener('click', toggleHold);
  els.toggleTable.addEventListener('click', toggleTable);
  els.clearBin.addEventListener('click', () => store.set({ bin: 0 }));
  els.modeWafer.addEventListener('change', () => setMode('wafer'));
  els.modeLot.addEventListener('change', () => setMode('lot'));
  els.zoomIn.addEventListener('click', () => map.zoomBy(1.6));
  els.zoomOut.addEventListener('click', () => map.zoomBy(1 / 1.6));
  els.zoomReset.addEventListener('click', () => map.resetView());

  // 웨이퍼 목록: 클릭과 방향키. 선택이 초점을 따라간다
  els.wafers.addEventListener('click', (e) => {
    const option = /** @type {Element} */ (e.target).closest('.wf');
    if (option) selectWafer(Number(option.getAttribute('data-slot')));
  });
  els.wafers.addEventListener('keydown', (e) => {
    const first = /** @type {HTMLElement | null} */ (els.wafers.firstElementChild);
    if (!first) return;
    // 격자로 놓였을 때는 위아래 키가 한 줄씩 움직인다. 열 수는 실제 배치에서 센다
    let perRow = 0;
    for (const el of /** @type {HTMLCollectionOf<HTMLElement>} */ (els.wafers.children)) {
      if (el.offsetTop !== first.offsetTop) break;
      perRow++;
    }
    const { slot } = store.get();
    /** @type {Record<string, number>} */
    const moves = { ArrowLeft: slot - 1, ArrowRight: slot + 1, ArrowUp: slot - perRow, ArrowDown: slot + perRow, Home: 1, End: WAFERS_PER_LOT };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const next = moves[e.key];
    if (next >= 1 && next <= WAFERS_PER_LOT) selectWafer(next);
  });

  els.bins.addEventListener('click', (e) => {
    const button = /** @type {Element} */ (e.target).closest('.bin');
    if (button) toggleBin(Number(button.getAttribute('data-bin')));
  });

  els.spcRows.addEventListener('click', (e) => {
    const button = /** @type {Element} */ (e.target).closest('button[data-slot]');
    if (button) selectWafer(Number(button.getAttribute('data-slot')));
  });

  // 찾기와 명령
  els.paletteInput.addEventListener('input', () => renderPalette(els.paletteInput.value));
  els.paletteInput.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return; // 한글 조합 중의 Enter는 글자를 확정하는 키다
    const last = palette.shown.length - 1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (last < 0) return;
      palette.active = e.key === 'ArrowDown' ? (palette.active >= last ? 0 : palette.active + 1) : palette.active <= 0 ? last : palette.active - 1;
      syncPaletteActive(true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runPaletteItem(palette.active);
    }
  });
  els.paletteList.addEventListener('click', (e) => {
    const option = /** @type {Element} */ (e.target).closest('.palette-item');
    if (option) runPaletteItem(Number(option.getAttribute('data-index')));
  });
  els.paletteList.addEventListener('pointermove', (e) => {
    const option = /** @type {Element} */ (e.target).closest('.palette-item');
    const index = option ? Number(option.getAttribute('data-index')) : -1;
    if (index >= 0 && index !== palette.active) {
      palette.active = index;
      syncPaletteActive(false);
    }
  });
  els.paletteClose.addEventListener('click', () => els.palette.close());
  els.helpClose.addEventListener('click', () => els.help.close());
  els.reportClose.addEventListener('click', () => els.report.close());
  for (const dialog of [els.palette, els.help, els.report]) {
    // 바깥(배경)을 누르면 닫는다. 안쪽 내용은 대화상자를 가득 채우므로 target이 dialog면 배경이다
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
  }

  // Popover API가 없는 브라우저: 버튼으로 직접 여닫는다
  if (!('popover' in HTMLElement.prototype)) {
    els.spcInfo.hidden = true;
    els.spcInfo.classList.add('is-fallback');
    els.spcInfoBtn.addEventListener('click', () => {
      els.spcInfo.hidden = !els.spcInfo.hidden;
    });
  }

  document.addEventListener('keydown', onGlobalKey);
  window.addEventListener('hashchange', () => {
    const route = parseRoute(location.hash);
    if (route) store.set({ ...route, die: -1 });
  });
  window.addEventListener('scroll', hideTip, { passive: true });

  // 테마는 호스트가 data-theme으로 바꿀 수도, OS 설정이 바뀔 수도 있다. 어느 쪽이든 캔버스를 다시 칠한다
  new MutationObserver(syncTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  mqDark.addEventListener('change', syncTheme);
  matchMedia('(forced-colors: active)').addEventListener('change', syncTheme);

  new ResizeObserver(() => chart.resize()).observe(els.chart);
  // 브라우저 확대나 모니터 이동으로 배율이 바뀌면 캔버스 해상도를 다시 맞춘다
  window.addEventListener('resize', () => {
    map.resize();
    const state = store.get();
    paintThumbs(getLot(state.lotId), state.bin);
  });
}

/** @param {KeyboardEvent} e */
function onGlobalKey(e) {
  if (e.defaultPrevented || e.isComposing) return;
  const mod = e.metaKey || e.ctrlKey;
  // 글자 단축키는 e.code로 받는다. 한글 입력 상태에서도 같은 자리의 키가 동작한다
  if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyK') {
    e.preventDefault();
    openPalette();
    return;
  }
  if (mod || e.altKey) return;
  if (document.querySelector('dialog[open]')) return; // 대화상자가 열려 있으면 그쪽이 키를 쓴다
  const target = /** @type {HTMLElement} */ (e.target);
  const typing = target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || (target instanceof HTMLInputElement && target.type !== 'radio');
  if (typing) return;

  if (e.key === 'Escape') {
    if (clearOne()) e.preventDefault();
    return;
  }
  if (e.key === '?') {
    e.preventDefault();
    els.help.showModal();
    return;
  }
  if (e.key === '/') {
    e.preventDefault();
    openPalette();
    return;
  }
  /** @type {Record<string, () => void>} */
  const byCode = {
    KeyJ: () => stepWafer(1),
    KeyK: () => stepWafer(-1),
    KeyN: () => stepFlagged(e.shiftKey ? -1 : 1),
    KeyM: toggleMode,
    KeyH: toggleHold,
  };
  const action = byCode[e.code];
  if (action) {
    e.preventDefault();
    action();
  }
}

/* ---------- 13. 부팅 ---------- */

/** @param {unknown} error */
function showFatal(error) {
  console.error(error);
  els.fatal.textContent = '화면을 그리는 중 문제가 생겼습니다. 페이지를 새로 고치면 처음 상태로 돌아갑니다.';
  els.fatal.hidden = false;
}

function start() {
  store = createStore(initialState());

  map = createWaferMap(els.stage, els.map, {
    onPick(die, viaKeyboard) {
      const state = store.get();
      store.set({ die: viaKeyboard || die !== state.die ? die : -1 }); // 같은 다이를 다시 누르면 고정을 푼다
      if (viaKeyboard && die >= 0) announce(describeDie(state, die).join('. '));
    },
    onHover(die) {
      hoverDie = die;
      updateReadout();
    },
    onSwipe: stepWafer,
    onView({ k, pxPerMm }) {
      els.zoomLevel.textContent = `${Number(k.toFixed(1))}×`;
      const mm = scaleBarLength(pxPerMm);
      els.scalebarLine.style.inlineSize = `${(mm * pxPerMm).toFixed(1)}px`;
      els.scalebarLabel.textContent = `${mm} mm`;
    },
  });
  chart = createControlChart(els.chart, { onSelect: selectWafer });

  wire();
  for (const render of [renderLot, renderStrip, renderMap, renderLegend, renderDetail, renderSpc, syncRoute, persist]) store.use(render);

  syncTheme();
  map.resize();
  store.flush(); // 첫 화면은 기다리지 않고 바로 그린다
  map.drawNow();
}

window.addEventListener('error', (e) => {
  if (e.error instanceof Error) showFatal(e.error); // 리소스 로드 실패나 확장 프로그램 오류는 제외한다
});
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason instanceof Error) showFatal(e.reason);
});

try {
  start();
} catch (error) {
  showFatal(error);
}
