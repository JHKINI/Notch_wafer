/* ==========================================================================
   core — 순수 로직. DOM, 시간, 전역 상태에 의존하지 않는다.
   같은 입력이면 항상 같은 출력이 나오므로 Node에서 그대로 단위 테스트한다.
   ========================================================================== */

/* ---------- 결정적 난수 ---------- */

/** mulberry32: 시드 하나로 재현 가능한 [0, 1) 난수열을 만든다. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32비트. 문자열 식별자를 시드로 바꾼다. */
export function hashSeed(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/* ---------- 도메인 상수 ---------- */

/** 300 mm 웨이퍼. 길이 단위는 모두 mm. */
export const WAFER = Object.freeze({
  radius: 150,
  edgeExclusion: 3,
  dieW: 6.5,
  dieH: 7.2,
  cols: 46,
  rows: 42,
});

/** 반경 구역 경계. 값은 유효 반경(반경 − 가장자리 제외폭)에 대한 비율이다. */
export const ZONE_EDGES = Object.freeze([0.3, 0.5, 0.7, 0.85]);
export const ZONE_COUNT = ZONE_EDGES.length + 1;

/** bin 1은 양품, 2~6은 불량 유형. 배열 인덱스가 곧 bin 코드다. */
export const BIN_PASS = 1;
export const FAIL_BINS = Object.freeze([2, 3, 4, 5, 6]);
export const BIN_LABEL = Object.freeze({
  1: '양품',
  2: 'Open/Short',
  3: '누설 전류',
  4: '기능 불량',
  5: '속도 미달',
  6: 'DC 파라메트릭',
});

export const PATTERN_LABEL = Object.freeze({
  none: '특이 패턴 없음',
  center: 'Center (중심 집중)',
  donut: 'Donut (도넛)',
  edgeRing: 'Edge-Ring (가장자리 링)',
  edgeLoc: 'Edge-Loc (가장자리 국부)',
  loc: 'Loc (국부 군집)',
  scratch: 'Scratch (스크래치)',
  random: 'Random (전면 산발)',
  nearFull: 'Near-full (전면 불량)',
});

/**
 * 합성 맵의 계급 하한. 로트 25매 기준 "같은 자리에서 불량이 난 매수".
 * 전체 불량은 배경 불량(약 5%)만으로도 자리마다 1~2매씩 쌓인다. 그대로 칠하면 맵 전체가 붉어져
 * 반복 불량이 묻히므로 3매부터 색을 준다. 유형 하나만 볼 때는 배경이 훨씬 낮아 1매부터 센다.
 */
export const STACK_BREAKS = Object.freeze({
  all: Object.freeze([3, 5, 7, 10, 15]),
  bin: Object.freeze([1, 2, 3, 5, 8]),
});

/** @param {number} bin 0이면 전체 불량 */
export const stackBreaks = (bin) => (bin === 0 ? STACK_BREAKS.all : STACK_BREAKS.bin);

export function stackClass(count, breaks) {
  let k = 0;
  while (k < breaks.length && count >= breaks[k]) k++;
  return k; // 0 = 첫 계급 미만(칠하지 않음), 1..5 = 계급
}

/* ---------- 다이 배치 ---------- */

export function zoneOf(rNorm) {
  let z = 0;
  while (z < ZONE_EDGES.length && rNorm >= ZONE_EDGES[z]) z++;
  return z;
}

/**
 * 유효 반경 안에 네 모서리가 모두 들어오는 다이만 남긴다.
 * 다이별 속성은 SoA(typed array)로 둔다. 웨이퍼 25매가 같은 배치를 공유한다.
 */
export function buildGeometry(spec = WAFER) {
  const usable = spec.radius - spec.edgeExclusion;
  const { cols, rows, dieW, dieH } = spec;
  const lookup = new Int16Array(cols * rows).fill(-1);
  const col = [];
  const row = [];
  const x = [];
  const y = [];
  const rn = [];
  const theta = [];
  const zone = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const cx = (i - cols / 2 + 0.5) * dieW;
      const cy = (j - rows / 2 + 0.5) * dieH;
      const farX = Math.abs(cx) + dieW / 2;
      const farY = Math.abs(cy) + dieH / 2;
      if (farX * farX + farY * farY > usable * usable) continue;
      lookup[j * cols + i] = col.length;
      col.push(i);
      row.push(j);
      x.push(cx);
      y.push(cy);
      const r = Math.hypot(cx, cy) / usable;
      rn.push(r);
      theta.push(Math.atan2(cx, -cy)); // 0 = 12시, 시계 방향이 +
      zone.push(zoneOf(r));
    }
  }
  return Object.freeze({
    spec,
    usable,
    count: col.length,
    lookup,
    col: Int16Array.from(col),
    row: Int16Array.from(row),
    x: Float32Array.from(x),
    y: Float32Array.from(y),
    rn: Float32Array.from(rn),
    theta: Float32Array.from(theta),
    zone: Uint8Array.from(zone),
  });
}

/** 화면 좌표계와 무관한 표시용 좌표. X는 오른쪽, Y는 위쪽이 +. */
export function dieCoord(geo, i) {
  return {
    x: geo.col[i] - geo.spec.cols / 2,
    y: geo.spec.rows / 2 - 1 - geo.row[i],
  };
}

/** 각도(0 = 12시, 시계 방향)를 시계 방향 표기(1~12시)로 바꾼다. */
export function clockHour(theta) {
  const turn = ((theta / (2 * Math.PI)) % 1 + 1) % 1;
  const hour = Math.round(turn * 12) % 12;
  return hour === 0 ? 12 : hour;
}

/* ---------- 시뮬레이션 데이터 생성 ---------- */

/** 불량 원인별 bin 비율. 순서는 FAIL_BINS와 같다. */
const BIN_MIX = Object.freeze({
  base: [0.14, 0.2, 0.34, 0.2, 0.12],
  center: [0.06, 0.08, 0.52, 0.28, 0.06],
  donut: [0.04, 0.1, 0.18, 0.46, 0.22],
  edgeRing: [0.05, 0.52, 0.12, 0.06, 0.25],
  edgeLoc: [0.08, 0.5, 0.14, 0.06, 0.22],
  loc: [0.3, 0.08, 0.5, 0.08, 0.04],
  scratch: [0.76, 0.06, 0.14, 0.02, 0.02],
  random: [0.2, 0.2, 0.2, 0.2, 0.2],
  nearFull: [0.62, 0.05, 0.28, 0.03, 0.02],
});

function pickBin(mix, u) {
  let acc = 0;
  for (let k = 0; k < mix.length; k++) {
    acc += mix[k];
    if (u < acc) return FAIL_BINS[k];
  }
  return FAIL_BINS[mix.length - 1];
}

const smoothstep = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 점 (px, py)에서 선분 (ax, ay)-(bx, by)까지의 거리. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * 패턴별 "다이 i가 계통 불량일 확률" 함수를 만든다.
 * rand는 웨이퍼마다 고정된 난수열이라 같은 시드면 같은 모양이 나온다.
 */
function patternField(kind, severity, geo, rand) {
  const { x, y, rn, usable } = geo;
  switch (kind) {
    case 'center': {
      const sigma = 0.2 + 0.06 * rand();
      return (i) => severity * 0.92 * Math.exp(-((rn[i] / sigma) ** 2));
    }
    case 'donut': {
      const r0 = 0.48 + 0.1 * rand();
      const w = 0.08 + 0.03 * rand();
      return (i) => severity * 0.82 * Math.exp(-(((rn[i] - r0) / w) ** 2));
    }
    case 'edgeRing': {
      const start = 0.84 + 0.03 * rand();
      return (i) => severity * 0.95 * smoothstep(start, start + 0.07, rn[i]);
    }
    case 'edgeLoc':
    case 'loc': {
      const angle = rand() * 2 * Math.PI;
      const r0 = kind === 'edgeLoc' ? 0.9 : 0.32 + 0.3 * rand();
      const sigma = (kind === 'edgeLoc' ? 0.13 + 0.05 * rand() : 0.1 + 0.06 * rand()) * usable;
      const cx = Math.sin(angle) * r0 * usable;
      const cy = -Math.cos(angle) * r0 * usable;
      return (i) => {
        const d2 = (x[i] - cx) ** 2 + (y[i] - cy) ** 2;
        return severity * 0.95 * Math.exp(-d2 / (2 * sigma * sigma));
      };
    }
    case 'scratch': {
      // 긁힘은 물리적으로 이어진 손상이라 강도와 무관하게 연속으로 둔다.
      const a0 = rand() * 2 * Math.PI;
      const r0 = (0.1 + 0.45 * rand()) * usable;
      const ax = Math.sin(a0) * r0;
      const ay = -Math.cos(a0) * r0;
      const len = (0.4 + 0.35 * rand()) * usable;
      let bx = -ax;
      let by = -ay;
      for (let attempt = 0; attempt < 6; attempt++) {
        const dir = rand() * 2 * Math.PI;
        const tx = ax + Math.cos(dir) * len;
        const ty = ay + Math.sin(dir) * len;
        if (Math.hypot(tx, ty) <= 0.9 * usable) {
          bx = tx;
          by = ty;
          break;
        }
      }
      const reach = 0.62 * geo.spec.dieH;
      return (i) => (distToSegment(x[i], y[i], ax, ay, bx, by) < reach ? 0.97 : 0);
    }
    case 'random': {
      const p = 0.16 + 0.14 * rand();
      return () => p * severity;
    }
    case 'nearFull': {
      const p = 0.86 + 0.1 * rand();
      return () => p;
    }
    default:
      return () => 0;
  }
}

/**
 * 웨이퍼 한 장의 bin 배열을 만든다.
 * 계통 불량(패턴)과 배경 불량(무작위)을 따로 뽑아, 원인에 맞는 bin 비율을 적용한다.
 */
export function generateWafer(geo, seed, pattern = 'none', severity = 1) {
  const rand = mulberry32(seed);
  const base = 0.03 + 0.03 * rand();
  const field = patternField(pattern, severity, geo, rand);
  const bins = new Uint8Array(geo.count);
  for (let i = 0; i < geo.count; i++) {
    const pPattern = field(i);
    const pBase = base * (1 + 0.8 * geo.rn[i] ** 4); // 가장자리로 갈수록 조금 나빠진다
    const u = rand();
    const v = rand();
    const w = rand();
    if (u < pPattern) bins[i] = pickBin(BIN_MIX[pattern], w);
    else if (v < pBase) bins[i] = pickBin(BIN_MIX.base, w);
    else bins[i] = BIN_PASS;
  }
  return bins;
}

/* ---------- 통계 ---------- */

export function median(values) {
  if (values.length === 0) return NaN;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 개별값 관리도(X chart)의 한계.
 * 평균 대신 중앙값, 평균 이동범위 대신 이동범위 중앙값을 써서
 * 이상 웨이퍼 몇 장이 한계를 넓혀 버리는 일을 막는다.
 * sigma = median(MR) / d4, d4(n = 2) = 0.9539  →  3·sigma ≈ 3.145 × median(MR)
 */
export function controlLimits(values) {
  const cl = median(values);
  const ranges = [];
  for (let i = 1; i < values.length; i++) ranges.push(Math.abs(values[i] - values[i - 1]));
  const mrMedian = ranges.length ? median(ranges) : 0;
  const sigma = mrMedian / 0.9539;
  return {
    cl,
    sigma,
    mrMedian,
    ucl: Math.min(1, cl + 3 * sigma),
    lcl: Math.max(0, cl - 3 * sigma),
  };
}

/** bin 집계와 구역별 불량 수. */
export function summarize(geo, bins) {
  const binCounts = new Uint32Array(7);
  const zoneFail = new Uint32Array(ZONE_COUNT);
  const zoneTotal = new Uint32Array(ZONE_COUNT);
  let fails = 0;
  for (let i = 0; i < geo.count; i++) {
    const b = bins[i];
    const z = geo.zone[i];
    binCounts[b]++;
    zoneTotal[z]++;
    if (b !== BIN_PASS) {
      fails++;
      zoneFail[z]++;
    }
  }
  return { total: geo.count, fails, yield: (geo.count - fails) / geo.count, binCounts, zoneFail, zoneTotal };
}

/* ---------- 결함 패턴 판정 (규칙 기반) ---------- */

/** 8방향으로 붙어 있는 불량 다이 묶음 중 가장 큰 것. */
function largestCluster(geo, bins) {
  const { lookup, count } = geo;
  const { cols, rows } = geo.spec;
  const seen = new Uint8Array(count);
  const stack = new Int32Array(count);
  let best = [];
  for (let s = 0; s < count; s++) {
    if (bins[s] === BIN_PASS || seen[s]) continue;
    const members = [];
    let top = 0;
    stack[top++] = s;
    seen[s] = 1;
    while (top > 0) {
      const i = stack[--top];
      members.push(i);
      const c = geo.col[i];
      const r = geo.row[i];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const cc = c + dc;
          const rr = r + dr;
          if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
          const k = lookup[rr * cols + cc];
          if (k < 0 || seen[k] || bins[k] === BIN_PASS) continue;
          seen[k] = 1;
          stack[top++] = k;
        }
      }
    }
    if (members.length > best.length) best = members;
  }
  return best;
}

/**
 * 군집의 주축 길이와 폭(mm), 무게중심.
 * 양 끝 범위 대신 주성분 분산을 쓴다. 옆에 붙은 배경 불량 한두 개에 폭이 흔들리지 않는다.
 * 균일한 띠의 분산은 길이² / 12 이므로 sqrt(12 · 분산)이 길이가 된다.
 */
function clusterShape(geo, members) {
  const n = members.length;
  let mx = 0;
  let my = 0;
  for (const i of members) {
    mx += geo.x[i];
    my += geo.y[i];
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const i of members) {
    const dx = geo.x[i] - mx;
    const dy = geo.y[i] - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const meanVar = (sxx + syy) / (2 * n);
  const spread = Math.hypot((sxx - syy) / (2 * n), sxy / n);
  const pitch = (geo.spec.dieW + geo.spec.dieH) / 2;
  const floor = (pitch * pitch) / 12; // 다이 한 칸보다 좁을 수는 없다
  const length = Math.sqrt(12 * Math.max(meanVar + spread, floor));
  const width = Math.sqrt(12 * Math.max(meanVar - spread, floor));
  return {
    size: n,
    length,
    width,
    elongation: length / width,
    rNorm: Math.hypot(mx, my) / geo.usable,
    theta: Math.atan2(mx, -my),
  };
}

/** 주어진 반경 범위 안 불량 다이의 방향 집중도(평균 합성 길이, 0 = 고름, 1 = 한 방향). */
function angularConcentration(geo, bins, rMin, rMax) {
  let c = 0;
  let s = 0;
  let n = 0;
  for (let i = 0; i < geo.count; i++) {
    if (bins[i] === BIN_PASS || geo.rn[i] < rMin || geo.rn[i] >= rMax) continue;
    c += Math.cos(geo.theta[i]);
    s += Math.sin(geo.theta[i]);
    n++;
  }
  return n === 0 ? { strength: 0, theta: 0 } : { strength: Math.hypot(c, s) / n, theta: Math.atan2(s, c) };
}

const rate = (fail, total) => (total === 0 ? 0 : fail / total);

/**
 * 맵만 보고 패턴을 판정한다. 생성기의 정답을 참조하지 않는다.
 * 전역 통계(전면·링)를 먼저 보고, 남은 경우에만 군집 모양을 본다.
 * 반환값의 숫자들은 화면에 "판정 근거" 문장으로 그대로 쓰인다.
 */
export function classifyPattern(geo, bins, summary = summarize(geo, bins)) {
  const { zoneFail, zoneTotal, fails, total } = summary;
  const failRate = fails / total;
  const zr = Array.from(zoneFail, (f, z) => rate(f, zoneTotal[z]));

  if (failRate >= 0.55) return { key: 'nearFull', failRate };

  // 전면 산발: 불량률이 높은데 구역 간 차이가 표본 오차 수준이다 (카이제곱, 자유도 4).
  if (failRate >= 0.13) {
    let chi2 = 0;
    for (let z = 0; z < ZONE_COUNT; z++) {
      const expected = failRate * zoneTotal[z];
      chi2 += (zoneFail[z] - expected) ** 2 / (expected * (1 - failRate));
    }
    if (chi2 <= 20) return { key: 'random', failRate };
  }

  const edge = zr[4];
  const inner = rate(fails - zoneFail[4], total - zoneTotal[4]);
  if (edge >= 0.22 && edge >= 2.5 * Math.max(inner, 0.03)) {
    const spread = angularConcentration(geo, bins, ZONE_EDGES[3], Infinity);
    const evidence = { edge, inner, ratio: edge / Math.max(inner, 0.001) };
    return spread.strength <= 0.35
      ? { key: 'edgeRing', ...evidence }
      : { key: 'edgeLoc', ...evidence, hour: clockHour(spread.theta) };
  }

  const cluster = largestCluster(geo, bins);
  const shape = cluster.length ? clusterShape(geo, cluster) : null;

  const center = zr[0];
  const outer = rate(zoneFail[2] + zoneFail[3] + zoneFail[4], zoneTotal[2] + zoneTotal[3] + zoneTotal[4]);
  if (center >= 0.22 && center >= 3 * Math.max(outer, 0.03) && shape && shape.rNorm <= 0.25) {
    return { key: 'center', center, outer, ratio: center / Math.max(outer, 0.001) };
  }

  const mid = rate(zoneFail[1] + zoneFail[2], zoneTotal[1] + zoneTotal[2]);
  if (mid >= 0.16 && mid >= 2 * Math.max(center, edge, 0.03)) {
    const spread = angularConcentration(geo, bins, ZONE_EDGES[0], ZONE_EDGES[2]);
    if (spread.strength <= 0.35) return { key: 'donut', mid, center, edge };
  }

  if (shape) {
    const hour = clockHour(shape.theta);
    // 긁힘: 가늘고 길다. 가장자리에서 잘린 초승달 모양 군집과 구분하려고 폭 상한(다이 4칸)을 둔다.
    const maxScratchWidth = 4 * geo.spec.dieH;
    if (shape.size >= 7 && shape.length >= 35 && shape.elongation >= 3.4 && shape.width <= maxScratchWidth) {
      return { key: 'scratch', size: shape.size, length: shape.length, elongation: shape.elongation };
    }
    if (shape.size >= 9) {
      if (shape.rNorm >= 0.7) return { key: 'edgeLoc', edge, inner, hour, size: shape.size };
      return { key: 'loc', size: shape.size, hour, rNorm: shape.rNorm };
    }
  }
  return { key: 'none' };
}

/* ---------- 로트 ---------- */

/**
 * 시뮬레이션 로트 정의. story는 슬롯 번호 → [패턴, 강도].
 * 같은 설비 이상은 연속 슬롯에 걸쳐 나타나도록 잡았다.
 */
export const LOT_DEFS = Object.freeze([
  {
    id: 'K7A2417',
    product: 'NX-12 로직',
    step: 'EDS 1차',
    tested: '2026-11-09T14:20:00+09:00',
    story: { 6: ['edgeRing', 0.45], 7: ['edgeRing', 0.8], 8: ['edgeRing', 1], 9: ['edgeRing', 0.6], 17: ['scratch', 1], 22: ['center', 0.7] },
  },
  {
    id: 'K7A2431',
    product: 'NX-12 로직',
    step: 'EDS 1차',
    tested: '2026-11-10T03:45:00+09:00',
    story: { 3: ['loc', 0.9], 14: ['edgeLoc', 0.9] },
  },
  {
    id: 'K7B0102',
    product: 'NX-12 로직',
    step: 'EDS 1차',
    tested: '2026-11-10T19:05:00+09:00',
    story: { 2: ['scratch', 1], 11: ['donut', 0.6], 12: ['donut', 0.9], 13: ['donut', 0.7], 20: ['random', 1], 25: ['nearFull', 1] },
  },
]);

export const WAFERS_PER_LOT = 25;

/** 로트 하나를 생성하고, 화면이 필요로 하는 모든 파생값을 한 번에 계산한다. */
export function buildLot(def, geo) {
  const wafers = [];
  for (let slot = 1; slot <= WAFERS_PER_LOT; slot++) {
    const [pattern, severity] = def.story[slot] ?? ['none', 1];
    const bins = generateWafer(geo, hashSeed(`${def.id}/${slot}`), pattern, severity);
    const summary = summarize(geo, bins);
    wafers.push({ slot, bins, injected: pattern, ...summary, pattern: classifyPattern(geo, bins, summary) });
  }

  const limits = controlLimits(wafers.map((w) => w.yield));
  for (const w of wafers) {
    w.status = w.yield < limits.lcl ? 'out' : w.pattern.key !== 'none' ? 'watch' : 'ok';
  }

  // 합성 맵: stack[0]은 전체 불량, stack[b]는 bin b만 센 값.
  const stack = Array.from({ length: 7 }, () => new Uint8Array(geo.count));
  const binCounts = new Uint32Array(7);
  const zoneFail = new Uint32Array(ZONE_COUNT);
  const zoneTotal = new Uint32Array(ZONE_COUNT);
  let fails = 0;
  for (const w of wafers) {
    fails += w.fails;
    for (let b = 1; b < 7; b++) binCounts[b] += w.binCounts[b];
    for (let z = 0; z < ZONE_COUNT; z++) {
      zoneFail[z] += w.zoneFail[z];
      zoneTotal[z] += w.zoneTotal[z];
    }
    for (let i = 0; i < geo.count; i++) {
      const b = w.bins[i];
      if (b !== BIN_PASS) {
        stack[0][i]++;
        stack[b][i]++;
      }
    }
  }
  const total = geo.count * wafers.length;
  return {
    ...def,
    wafers,
    limits,
    stack,
    total,
    fails,
    yield: (total - fails) / total,
    binCounts,
    zoneFail,
    zoneTotal,
    counts: {
      out: wafers.filter((w) => w.status === 'out').length,
      watch: wafers.filter((w) => w.status === 'watch').length,
    },
  };
}

/* ---------- 검색 ---------- */

export function normalizeText(text) {
  return String(text).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * 공백으로 나눈 검색어가 모두 들어 있는 항목만 남기고, 앞쪽·단어 경계 일치를 먼저 보여 준다.
 * 항목은 { hay } (미리 정규화한 검색 대상 문자열)을 가져야 한다.
 */
export function searchItems(items, query) {
  const tokens = normalizeText(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return items.slice();
  const hits = [];
  items.forEach((item, order) => {
    let score = 0;
    for (const token of tokens) {
      const at = item.hay.indexOf(token);
      if (at < 0) return;
      score += at === 0 ? 0 : ` ${item.hay}`.includes(` ${token}`) ? 1 : 3;
    }
    hits.push({ item, score, order });
  });
  hits.sort((a, b) => a.score - b.score || a.order - b.order);
  return hits.map((h) => h.item);
}

/* ---------- 보기 변환 (확대·이동) ---------- */

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;

/** 이동량을 확대 배율에 맞춰 가둔다. 배율 1에서는 항상 가운데에 고정된다. */
export function clampView(view, half) {
  const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.k));
  const limit = (k - 1) * half;
  // `|| 0`은 limit이 0일 때 생기는 -0을 지운다.
  return {
    k,
    tx: Math.min(limit, Math.max(-limit, view.tx)) || 0,
    ty: Math.min(limit, Math.max(-limit, view.ty)) || 0,
  };
}

/** (fx, fy)(무대 중심 기준 화면 좌표)를 고정점으로 삼아 배율을 바꾼다. */
export function zoomAbout(view, nextK, fx, fy, half) {
  const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nextK));
  const ratio = k / view.k;
  return clampView({ k, tx: fx - (fx - view.tx) * ratio, ty: fy - (fy - view.ty) * ratio }, half);
}

/** 눈금자 길이: 화면에서 40~110px 사이에 들어오는 보기 좋은 mm 값. */
export function scaleBarLength(pxPerMm) {
  for (const mm of [100, 50, 20, 10, 5, 2]) {
    if (mm * pxPerMm <= 110) return mm;
  }
  return 1;
}
