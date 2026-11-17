import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBowlGreen } from './util.ts';
import { computePuttLines } from '../src/lib/aim.ts';
import { stimpToFriction } from '../src/lib/friction.ts';

/**
 * 验收点 2 的计算侧预算：手机拖动球位后，滚动线必须在 100ms 内重画。
 * 渲染本身为 GPU 操作，这里测量纯 CPU 计算（瞄准求解 + 三条滚动线），
 * 取 30 次连续重算的平均与 P95，均需 < 100ms 且留足渲染余量。
 * 测点规模取养护组常见密度：25m×25m、1m 间距 = 676 点。
 */
test('滚动线重算性能：均值与 P95 均 < 100ms', () => {
  const terrain = makeBowlGreen(25, 1);
  assert.ok(terrain.points.length >= 600);
  const opts = { muGreen: stimpToFriction(11) };
  const times: number[] = [];

  // 预热（JIT/内联缓存）
  computePuttLines(terrain, { x: -8, y: -8 }, { x: 6, y: 5 }, opts);

  for (let i = 0; i < 30; i++) {
    const bx = -9 + (i % 6) * 1.7;
    const by = -9 + Math.floor(i / 6) * 2.3;
    const t0 = performance.now();
    computePuttLines(terrain, { x: bx, y: by }, { x: 5, y: 4 }, opts);
    times.push(performance.now() - t0);
  }
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const sorted = [...times].sort((a, b) => a - b);
  const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1];
  assert.ok(mean < 100, `平均耗时 ${mean.toFixed(1)}ms 超过 100ms 预算`);
  assert.ok(p95 < 100, `P95 耗时 ${p95.toFixed(1)}ms 超过 100ms 预算`);
});
