import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/core.js';

const geo = core.buildGeometry();

test('난수열은 시드가 같으면 같다', () => {
  const a = core.mulberry32(42);
  const b = core.mulberry32(42);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
  assert.equal(core.hashSeed('K7A2417/7'), core.hashSeed('K7A2417/7'));
  assert.notEqual(core.hashSeed('K7A2417/7'), core.hashSeed('K7A2417/8'));
});

test('다이 배치: 개수, 좌우·상하 대칭, 조회표 일관성', () => {
  assert.ok(geo.count > 1250 && geo.count < 1450, `gross die ${geo.count}`);
  const { cols, rows } = geo.spec;
  for (let i = 0; i < geo.count; i++) {
    const c = geo.col[i];
    const r = geo.row[i];
    assert.equal(geo.lookup[r * cols + c], i);
    assert.ok(geo.lookup[r * cols + (cols - 1 - c)] >= 0, 'mirror x');
    assert.ok(geo.lookup[(rows - 1 - r) * cols + c] >= 0, 'mirror y');
    assert.ok(geo.rn[i] < 1);
    assert.equal(geo.zone[i], core.zoneOf(geo.rn[i]));
  }
});

test('표시 좌표와 시계 방향', () => {
  const top = geo.lookup[0 * geo.spec.cols + 23];
  const i = top >= 0 ? top : geo.lookup[1 * geo.spec.cols + 23];
  assert.ok(core.dieCoord(geo, i).y > 0, '위쪽 행은 Y가 +');
  assert.equal(core.clockHour(0), 12);
  assert.equal(core.clockHour(Math.PI / 2), 3);
  assert.equal(core.clockHour(Math.PI), 6);
  assert.equal(core.clockHour(-Math.PI / 2), 9);
  assert.equal(core.clockHour(2 * Math.PI - 0.01), 12);
});

test('중앙값과 관리한계', () => {
  assert.equal(core.median([3, 1, 2]), 2);
  assert.equal(core.median([4, 1, 3, 2]), 2.5);
  assert.ok(Number.isNaN(core.median([])));
  // 이동범위: 1, 1, 1, 30, 30 → 중앙값 1 → 3σ = 3 / 0.9539
  const lim = core.controlLimits([0.9, 0.91, 0.9, 0.91, 0.61, 0.91]);
  assert.ok(Math.abs(lim.cl - 0.905) < 1e-9);
  assert.ok(Math.abs(lim.mrMedian - 0.01) < 1e-9);
  assert.ok(Math.abs(lim.cl - lim.lcl - (3 * 0.01) / 0.9539) < 1e-9);
  assert.ok(lim.lcl > 0.61, '이상치가 한계를 넓히지 않는다');
  assert.equal(core.controlLimits([0.99, 1, 0.99, 1]).ucl, 1, 'UCL은 100%를 넘지 않는다');
});

test('합성 맵 계급 경계', () => {
  const all = core.stackBreaks(0);
  const one = core.stackBreaks(3);
  assert.deepEqual([0, 2, 3, 4, 5, 7, 9, 10, 14, 15, 25].map((n) => core.stackClass(n, all)), [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 7, 8, 25].map((n) => core.stackClass(n, one)), [0, 1, 2, 3, 3, 4, 4, 5, 5]);
});

test('확대·이동: 고정점 유지와 범위 제한', () => {
  const half = 160;
  const v0 = { k: 1, tx: 0, ty: 0 };
  const v1 = core.zoomAbout(v0, 3, 40, -30, half);
  // 고정점 아래의 웨이퍼 좌표가 변하지 않아야 한다: (f - t) / k 가 같다
  assert.ok(Math.abs((40 - v1.tx) / v1.k - 40) < 1e-9);
  assert.ok(Math.abs((-30 - v1.ty) / v1.k - -30) < 1e-9);
  assert.deepEqual(core.clampView({ k: 1, tx: 99, ty: -99 }, half), { k: 1, tx: 0, ty: 0 });
  assert.equal(core.clampView({ k: 99, tx: 0, ty: 0 }, half).k, core.ZOOM_MAX);
  assert.equal(core.zoomAbout(v1, 0.2, 0, 0, half).k, core.ZOOM_MIN);
  assert.equal(core.scaleBarLength(1.1), 50);
  assert.equal(core.scaleBarLength(4.5), 20);
});

test('검색: 모든 토큰 일치, 앞쪽 일치 우선', () => {
  const items = ['슬롯 07 71.2% 관리 이탈 edge-ring', '슬롯 17 scratch 주의', '로트 합성 맵 보기'].map((label) => ({ label, hay: core.normalizeText(label) }));
  assert.deepEqual(core.searchItems(items, '  ').length, 3);
  assert.deepEqual(core.searchItems(items, '슬롯 scratch').map((i) => i.label), [items[1].label]);
  assert.deepEqual(core.searchItems(items, '합성').map((i) => i.label), [items[2].label]);
  assert.equal(core.searchItems(items, 'EDGE')[0].label, items[0].label);
  assert.equal(core.searchItems(items, '없는말').length, 0);
  // '7'은 '07'과 '17' 모두에 들어 있지만, 단어 첫머리로 등장하는 쪽이 먼저다
  const slots = ['슬롯 17 17 w17', '슬롯 07 7 w7'].map((label) => ({ label, hay: core.normalizeText(label) }));
  assert.equal(core.searchItems(slots, '7')[0].label, '슬롯 07 7 w7');
});

test('패턴 판정: 무작위 시드 전반에서 생성 패턴을 맞힌다', () => {
  const kinds = ['none', 'center', 'donut', 'edgeRing', 'edgeLoc', 'loc', 'scratch', 'random', 'nearFull'];
  const trials = 300;
  let correct = 0;
  const report = {};
  for (const kind of kinds) {
    const tally = {};
    for (let s = 0; s < trials; s++) {
      const rand = core.mulberry32(core.hashSeed(`${kind}:${s}`));
      const severity = kind === 'none' ? 1 : 0.6 + 0.4 * rand();
      const bins = core.generateWafer(geo, core.hashSeed(`t/${kind}/${s}`), kind, severity);
      const got = core.classifyPattern(geo, bins).key;
      tally[got] = (tally[got] ?? 0) + 1;
      if (got === kind) correct++;
    }
    report[kind] = tally;
  }
  const accuracy = correct / (kinds.length * trials);
  console.log(JSON.stringify(report));
  console.log('accuracy', accuracy.toFixed(4));
  assert.ok((report.none.none ?? 0) / trials >= 0.98, '정상 웨이퍼 오탐 2% 이하');
  assert.ok(accuracy >= 0.95, `accuracy ${accuracy}`);
});

test('내장 로트: 판정이 생성 패턴과 모두 일치하고, 이야기가 관리도에 드러난다', () => {
  for (const def of core.LOT_DEFS) {
    const lot = core.buildLot(def, geo);
    const rows = lot.wafers.map((w) => `${String(w.slot).padStart(2, '0')} ${(w.yield * 100).toFixed(1)} ${w.status.padEnd(5)} ${w.pattern.key}${w.pattern.key === w.injected ? '' : '  <-- injected ' + w.injected}`);
    console.log(`\n${lot.id} yield ${(lot.yield * 100).toFixed(2)} CL ${(lot.limits.cl * 100).toFixed(2)} LCL ${(lot.limits.lcl * 100).toFixed(2)} UCL ${(lot.limits.ucl * 100).toFixed(2)} out ${lot.counts.out} watch ${lot.counts.watch}\n` + rows.join('\n'));
    for (const w of lot.wafers) assert.equal(w.pattern.key, w.injected, `${lot.id} slot ${w.slot}`);
    assert.equal(lot.stack[0].reduce((a, b) => a + b, 0), lot.fails);
    assert.equal(Array.from(lot.binCounts).reduce((a, b) => a + b, 0), lot.total);
  }
});
