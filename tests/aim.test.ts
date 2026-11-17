import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBowlGreen, makePlaneGreen } from './util.ts';
import { solveAim, computePuttLines } from '../src/lib/aim.ts';
import { TOUCH_SPEEDS } from '../src/lib/physics.ts';
import { stimpToFriction } from '../src/lib/friction.ts';

const opts = { muGreen: stimpToFriction(11) };

test('平面直推：瞄准偏移≈0，中等力度入洞', () => {
  const { terrain } = makePlaneGreen(0, 0, 12, 1);
  const aim = solveAim(terrain, { x: -1, y: 0 }, { x: 1, y: 0 }, TOUCH_SPEEDS.medium, opts);
  assert.ok(aim.converged);
  assert.ok(Math.abs(aim.offsetM) < 0.05, `偏移 ${aim.offsetM}m 应近似为 0`);
  assert.ok(aim.holed, '平面中等力度应入洞');
});

test('侧坡推杆：瞄准点偏向高坡一侧（上坡补偿）', () => {
  // 坡度沿 +y 向下（下坡方向 +y），高坡在 -y；球-洞线沿 x 轴，
  // 球会被推向 +y，因此瞄准点必须偏向 -y（高坡侧）
  const { terrain } = makePlaneGreen(0, 0.03, 12, 1);
  const aim = solveAim(terrain, { x: -0.75, y: 0 }, { x: 0.75, y: 0 }, TOUCH_SPEEDS.medium, opts);
  assert.ok(aim.offsetIsUphill, '瞄准偏移应朝高坡一侧');
  assert.ok(Math.abs(aim.offsetM) > 0.05, `侧坡补偿量 ${aim.offsetM}m 过小`);
  // 残差在洞杯半径量级（贴洞缘视为命中窗口）
  assert.ok(aim.residual < 0.15, `入洞残差 ${aim.residual}m 过大`);
});

test('三条滚动线：轻力度最短、重力度最长且共用同一发射方向', () => {
  const terrain = makeBowlGreen(16, 1);
  const { lines, aim } = computePuttLines(terrain, { x: -4, y: -3 }, { x: 3, y: 2 }, opts);
  const len = (r: typeof lines.light) =>
    r.samples.reduce((acc, s, i) => {
      if (i === 0) return 0;
      const p = r.samples[i - 1];
      return acc + Math.hypot(s.x - p.x, s.y - p.y);
    }, 0);
  assert.ok(len(lines.light) < len(lines.medium));
  assert.ok(len(lines.medium) < len(lines.heavy));
  for (const touch of ['light', 'medium', 'heavy'] as const) {
    const s1 = lines[touch].samples[1];
    const s0 = lines[touch].samples[0];
    const ang = Math.atan2(s1.y - s0.y, s1.x - s0.x);
    const target = Math.atan2(aim.direction.y, aim.direction.x);
    const diff = Math.abs(Math.atan2(Math.sin(ang - target), Math.cos(ang - target)));
    assert.ok(diff < 1e-3, `${touch} 发射方向与瞄准解不一致：${diff}`);
  }
});
