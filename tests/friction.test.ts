import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveStimp,
  frictionToStimp,
  stimpToFriction,
  REF_MOW_MM,
} from '../src/lib/friction.ts';

test('Stimp 10 平面摩擦系数与经典模型 μ=v0²/(2gS) 一致（约 0.056）', () => {
  const mu = stimpToFriction(10);
  const expected = (1.83 * 1.83) / (2 * 9.81 * 10 * 0.3048);
  assert.ok(Math.abs(mu - expected) < 1e-12);
  assert.ok(mu > 0.05 && mu < 0.06, `μ=${mu}`);
  // 与常用经验区间对照：Stimp 10 对应 μ 约 0.055–0.07
  assert.ok(mu > 0.05 && mu < 0.075);
});

test('逆换算与正换算互逆', () => {
  for (const s of [7, 10, 12, 14]) {
    const mu = stimpToFriction(s);
    assert.ok(Math.abs(frictionToStimp(mu) - s) < 1e-9);
  }
});

test('修剪高度越高（草越长），等效 Stimp 越小、摩擦越大', () => {
  const base = stimpToFriction(10, { mowHeightMm: REF_MOW_MM });
  const long = stimpToFriction(10, { mowHeightMm: 5 });
  const short = stimpToFriction(10, { mowHeightMm: 2 });
  assert.ok(long > base);
  assert.ok(short < base);
  // 同读数 5mm 草的等效读数应明显小于参考高度
  assert.ok(effectiveStimp(10, { mowHeightMm: 5 }) < 10);
});

test('非法读数抛错', () => {
  assert.throws(() => stimpToFriction(0));
  assert.throws(() => stimpToFriction(-3));
});
