import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePlaneGreen, makeJitteredPlaneGreen } from './util.ts';

/**
 * 验收点 1：已知解析坡面上，TIN 坡度与解析值偏差不超过 2 个百分点。
 * 在规则网格与抖动测点两种数据上各抽查多个位置。
 */
test('规则网格平面果岭：坡度百分比与解析值偏差 ≤ 2 个百分点', () => {
  const cases: Array<[number, number]> = [
    [0.03, 0.04],
    [0.02, -0.03],
    [-0.015, 0.025],
    [0.05, 0.0],
  ];
  for (const [sx, sy] of cases) {
    const { terrain, analytic } = makePlaneGreen(sx, sy);
    const probes = [
      { x: 0, y: 0 },
      { x: 3.5, y: -2.5 },
      { x: -7.1, y: 4.8 },
      { x: 8.9, y: 8.2 },
      { x: -9.4, y: -8.7 },
    ];
    for (const q of probes) {
      const s = terrain.slopeAt(q.x, q.y);
      assert.ok(s, `测点 (${q.x},${q.y}) 应落在 TIN 内`);
      const diffPct = Math.abs(s!.percent - analytic.percent);
      assert.ok(
        diffPct <= 2.0,
        `梯度(${sx},${sy}) 在 (${q.x},${q.y}) 偏差 ${diffPct.toFixed(3)} 个百分点 > 2`,
      );
      const diffDeg = Math.abs(s!.degrees - analytic.degrees);
      assert.ok(diffDeg <= 1.2, `坡角偏差 ${diffDeg.toFixed(3)}° 过大`);
      // 下坡方向与解析方向一致（点积 ≈ 1）
      const dot = s!.downhill.x * analytic.downhill.x + s!.downhill.y * analytic.downhill.y;
      assert.ok(dot > 0.999, '下坡方向与解析值不符');
    }
  }
});

test('抖动测点平面果岭：坡度偏差同样 ≤ 2 个百分点', () => {
  const { terrain, analytic } = makeJitteredPlaneGreen();
  for (let x = -6; x <= 6; x += 2) {
    for (let y = -6; y <= 6; y += 2) {
      const s = terrain.slopeAt(x + 0.31, y - 0.27);
      assert.ok(s);
      assert.ok(
        Math.abs(s!.percent - analytic.percent) <= 2.0,
        `(${x},${y}) 偏差 ${Math.abs(s!.percent - analytic.percent).toFixed(3)}`,
      );
    }
  }
});

test('高程插值在平面上与解析高程一致', () => {
  const sx = 0.03;
  const sy = 0.04;
  const { terrain } = makePlaneGreen(sx, sy);
  for (const q of [
    { x: 1.23, y: -4.56 },
    { x: -7.89, y: 3.21 },
    { x: 5.5, y: 5.5 },
  ]) {
    const z = terrain.heightAt(q.x, q.y)!;
    const expected = sx * q.x + sy * q.y + 0.1;
    assert.ok(Math.abs(z - expected) < 1e-9, `插值误差 ${Math.abs(z - expected)}`);
  }
});

test('TIN 外查询返回 null（边界判定可用）', () => {
  const { terrain } = makePlaneGreen();
  assert.equal(terrain.heightAt(50, 50), null);
  assert.equal(terrain.slopeAt(50, 50), null);
});
