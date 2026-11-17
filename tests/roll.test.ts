import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePlaneGreen } from './util.ts';
import { rollBall } from '../src/lib/physics.ts';
import { stimpToFriction } from '../src/lib/friction.ts';

/**
 * 平坡匀速减速的解析校验：v0² = 2·μ·g·d → 停球距离 d = v0²/(2μg)。
 */
test('零坡度时滚动距离与匀减速解析解一致', () => {
  const { terrain } = makePlaneGreen(0, 0);
  const mu = stimpToFriction(11);
  const v0 = 1.6;
  const r = rollBall(terrain, { x: 0, y: 0 }, terrain.heightAt(0, 0)!, { x: 1, y: 0 }, v0, {
    muGreen: mu,
  });
  assert.ok(r.stopped);
  const actual = Math.hypot(r.end.x, r.end.y);
  const expected = (v0 * v0) / (2 * mu * 9.81);
  const relErr = Math.abs(actual - expected) / expected;
  assert.ok(relErr < 0.02, `距离 ${actual.toFixed(2)}m vs 解析 ${expected.toFixed(2)}m，相对误差 ${relErr}`);
});

test('下坡滚动比平坡远，上坡比平坡近（全程在果岭内）', () => {
  // sx>0：+x 方向 z 升高（上坡），-x 方向为下坡
  const sx = 0.02;
  const { terrain } = makePlaneGreen(sx, 0, 10, 1);
  const mu = stimpToFriction(11);
  const z0 = terrain.heightAt(0, 0)!;
  const down = rollBall(terrain, { x: 0, y: 0 }, z0, { x: -1, y: 0 }, 1.0, { muGreen: mu });
  const up = rollBall(terrain, { x: 0, y: 0 }, z0, { x: 1, y: 0 }, 1.0, { muGreen: mu });
  const flat = rollBall(
    makePlaneGreen(0, 0, 10, 1).terrain,
    { x: 0, y: 0 },
    0.1,
    { x: 1, y: 0 },
    1.0,
    { muGreen: mu },
  );
  const dist = (r: typeof down) =>
    Math.hypot(r.end.x - r.samples[0].x, r.end.y - r.samples[0].y);
  assert.ok(dist(down) > dist(flat) * 1.15, `下坡 ${dist(down)} vs 平坡 ${dist(flat)}`);
  assert.ok(dist(up) < dist(flat) * 0.9, `上坡 ${dist(up)} vs 平坡 ${dist(flat)}`);
});

test('球在坡上静止时若重力切向分量小于静摩擦应停住', () => {
  const { terrain } = makePlaneGreen(0.02, 0);
  const mu = stimpToFriction(9); // μ≈0.067，大于 2% 坡的切向分量
  const r = rollBall(terrain, { x: 0, y: 0 }, terrain.heightAt(0, 0)!, { x: 1, y: 0 }, 0.04, {
    muGreen: mu,
  });
  assert.ok(r.stopped);
  assert.equal(r.holed, false);
});

test('洞杯捕获：步长跨过洞杯时通过线段-圆相交判定入洞', () => {
  const { terrain } = makePlaneGreen(0, 0);
  const r = rollBall(
    terrain,
    { x: 0, y: 0 },
    terrain.heightAt(0, 0)!,
    { x: 1, y: 0 },
    1.5,
    { muGreen: stimpToFriction(11), hole: { x: 1.5, y: 0 }, holeRadius: 0.108 / 2 },
  );
  assert.ok(r.holed);
  assert.ok(Math.abs(r.end.x - 1.5) < 0.108 / 2 + 1e-6);
});
