import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRidgeGreen } from './util.ts';
import { rollBall } from '../src/lib/physics.ts';
import { stimpToFriction } from '../src/lib/friction.ts';

/**
 * 验收点 3：洞位放在坡顶边缘，球滚出果岭后不能停在边界上，
 * 必须继续按长草摩擦积分，给出完整越界轨迹与出界点/出界速度。
 */
test('球越过脊顶滚出果岭：不在边界停止，轨迹延伸到 TIN 外', () => {
  const { terrain, half } = makeRidgeGreen();
  const mu = stimpToFriction(11);
  // 洞位在坡顶边缘 y≈half 附近，球从脊顶向北侧边缘高速推
  const ball = { x: 0, y: half - 1 };
  const hole = { x: 0, y: half - 0.2 };
  const z0 = terrain.heightAt(ball.x, ball.y)!;
  const r = rollBall(terrain, ball, z0, { x: 0, y: 1 }, 4.2, {
    muGreen: mu,
    hole,
    muRough: 0.25,
  });

  assert.ok(r.exitPoint !== null, '应记录出界点');
  assert.ok(r.exitSpeed > 0, '出界时应仍有速度，而不是停在边界');
  // 出界点确实贴近 TIN 边界
  assert.ok(Math.abs(r.exitPoint!.y - half) < 0.6, `出界点 y=${r.exitPoint!.y} 不在边界附近`);
  // 出界后采样点继续存在且 offGreen 标记翻转
  const outside = r.samples.filter((s) => s.offGreen);
  assert.ok(outside.length > 5, '出界后轨迹采样点过少');
  // 轨迹末端越过边界足够远，证明没有卡在边界
  assert.ok(r.end.y > half + 0.5, `末端 y=${r.end.y} 未明显越过边界 half=${half}`);
  assert.ok(r.stopped, '长草段最终应停住');
  // 越界后速度单调衰减（长草摩擦大），且轨迹 z 连续外推
  for (let i = 1; i < outside.length; i++) {
    assert.ok(outside[i].speed <= outside[i - 1].speed + 1e-9, '长草段速度不应增加');
  }
});

test('洞位本身在坡顶边缘：未入洞的球同样完整越界', () => {
  const { terrain, half } = makeRidgeGreen();
  const ball = { x: 2, y: half - 3 };
  const hole = { x: 2, y: half - 0.15 };
  const z0 = terrain.heightAt(ball.x, ball.y)!;
  const r = rollBall(terrain, ball, z0, { x: 0, y: 1 }, 4.5, {
    muGreen: stimpToFriction(12),
    hole,
  });
  assert.ok(r.exitPoint !== null);
  assert.ok(r.end.y > half);
  assert.ok(r.samples.at(-1)!.offGreen);
});

test('不出界的推杆 exitPoint 为 null', () => {
  const { terrain } = makeRidgeGreen();
  const r = rollBall(
    terrain,
    { x: 0, y: 0 },
    terrain.heightAt(0, 0)!,
    { x: 1, y: 0 },
    1.0,
    { muGreen: stimpToFriction(10) },
  );
  assert.equal(r.exitPoint, null);
  assert.ok(r.samples.every((s) => !s.offGreen));
});
