import { rollBall, TOUCH_SPEEDS, type RollOptions, type RollResult, type Touch } from './physics.ts';
import type { Terrain } from './terrain.ts';
import type { Vec2 } from './types.ts';

/**
 * 推杆瞄准求解：固定出球速度，搜索发射方向使滚动轨迹在洞杯处
 * 横向偏差为零（入洞或最近点跨轨误差最小）。
 *
 * 搜索策略：先在直线方向 ±60° 内网格扫描给误差函数 f(θ) 定号，
 * 再二分收敛到 0.02°。输出的瞄准点取发射方向上与洞等距的位置，
 * 并给出相对球-洞直线的横向偏移（米）及是否偏向高坡一侧。
 */

export interface AimSolution {
  /** 发射方向（单位向量，数学坐标） */
  direction: Vec2;
  /** 发射方向角（度） */
  angleDeg: number;
  /** 瞄准目标点（发射方向上、与洞等距） */
  aimPoint: Vec2;
  /** 横向偏移（米，带符号：沿球→洞方向左侧为正） */
  offsetM: number;
  /** 偏移方向描述 */
  offsetSide: 'left' | 'right' | 'none';
  /** 偏移是否朝高坡一侧 */
  offsetIsUphill: boolean;
  /** 残差（米）：轨迹与洞杯的最近距离 */
  residual: number;
  holed: boolean;
  /** 是否成功收敛（false 表示当前力度无法停在洞附近，给出最接近解） */
  converged: boolean;
  roll: RollResult;
}

const deg2rad = (d: number) => (d * Math.PI) / 180;
const rad2deg = (r: number) => (r * 180) / Math.PI;

/**
 * 瞄准误差：球沿轨迹到达“洞位距离”处的有符号横向偏差（叉积），
 * 再加上未抵达该距离时的纵向缺口。这样只有真正穿过洞位附近的轨迹
 * 误差才接近零，避免短推在球-洞线起点附近被误判为命中。
 */
function aimError(roll: RollResult, ball: Vec2, hole: Vec2): number {
  const dx = hole.x - ball.x;
  const dy = hole.y - ball.y;
  const targetDist = Math.hypot(dx, dy);
  const ux = dx / targetDist;
  const uy = dy / targetDist;
  const px = -uy;
  const py = ux;

  let best: { along: number; cross: number } | null = null;
  for (const s of roll.samples) {
    const rx = s.x - ball.x;
    const ry = s.y - ball.y;
    const along = rx * ux + ry * uy;
    const cross = rx * px + ry * py;
    if (!best || Math.abs(along - targetDist) < Math.abs(best.along - targetDist)) {
      best = { along, cross };
    }
  }
  if (!best) return targetDist;
  const shortfall = Math.max(0, targetDist - best.along);
  return best.cross + Math.sign(best.cross || 1) * shortfall;
}

export function solveAim(
  terrain: Terrain,
  ball: Vec2,
  hole: Vec2,
  speed: number,
  opts: RollOptions,
): AimSolution {
  const baseAngle = Math.atan2(hole.y - ball.y, hole.x - ball.x);
  const dist = Math.hypot(hole.x - ball.x, hole.y - ball.y);
  const z0 = terrain.heightAt(ball.x, ball.y);
  if (z0 === null) throw new Error('球位在果岭 TIN 范围外');

  const tryAngle = (angle: number) => {
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const roll = rollBall(terrain, ball, z0, dir, speed, { ...opts, hole });
    return { roll, err: aimError(roll, ball, hole) };
  };

  // 1) 网格定号
  const span = deg2rad(60);
  const gridN = 13;
  let lo = baseAngle - span;
  let hi = baseAngle + span;
  let fLo = tryAngle(lo).err;
  let fHi = tryAngle(hi).err;
  let bracketed = fLo * fHi < 0;
  if (!bracketed) {
    let prev = fLo;
    let prevA = lo;
    for (let i = 1; i <= gridN; i++) {
      const a = lo + ((2 * span) * i) / gridN;
      const f = tryAngle(a).err;
      if (prev * f < 0) {
        lo = prevA;
        hi = a;
        fLo = prev;
        fHi = f;
        bracketed = true;
        break;
      }
      prev = f;
      prevA = a;
    }
  }

  // 2) 二分收敛
  let best = tryAngle(baseAngle);
  let bestAngle = baseAngle;
  let converged = false;
  if (bracketed) {
    for (let i = 0; i < 20; i++) {
      if (Math.abs(rad2deg(hi - lo)) < 0.02) {
        converged = true;
        break;
      }
      const mid = (lo + hi) / 2;
      const fm = tryAngle(mid).err;
      if (fLo * fm <= 0) {
        hi = mid;
        fHi = fm;
      } else {
        lo = mid;
        fLo = fm;
      }
    }
    bestAngle = (lo + hi) / 2;
    best = tryAngle(bestAngle);
    // 入洞残差对捕获锥内所有角度均为 0（根不唯一）：
    // 若直推本身可入洞，优先取零偏移的直推解
    const straight = tryAngle(baseAngle);
    if (straight.roll.holed) {
      best = straight;
      bestAngle = baseAngle;
      converged = true;
    }
  } else {
    // 无括号：保留网格中绝对误差最小的一次
    for (let i = 0; i <= gridN; i++) {
      const a = baseAngle - span + ((2 * span) * i) / gridN;
      const r = tryAngle(a);
      if (Math.abs(r.err) < Math.abs(best.err)) {
        best = r;
        bestAngle = a;
      }
    }
  }

  // 发射方向以实际轨迹首段为准（避免取搜索区间中点造成的偏差）
  const s0r = best.roll.samples[0];
  const s1r = best.roll.samples[1] ?? s0r;
  const safeAngle = Math.atan2(s1r.y - s0r.y, s1r.x - s0r.x);
  const aimPoint: Vec2 = {
    x: ball.x + Math.cos(safeAngle) * dist,
    y: ball.y + Math.sin(safeAngle) * dist,
  };
  // 横向偏移：瞄准点相对球-洞直线
  const perp = { x: -(hole.y - ball.y) / dist, y: (hole.x - ball.x) / dist };
  const offX = aimPoint.x - hole.x;
  const offY = aimPoint.y - hole.y;
  const offsetM = offX * perp.x + offY * perp.y;

  // 高坡一侧：洞位附近上坡方向与偏移方向的一致性
  const slope = terrain.slopeAt(hole.x, hole.y);
  let offsetIsUphill = false;
  if (slope && Math.abs(offsetM) > 1e-6) {
    const uphill = { x: -slope.downhill.x, y: -slope.downhill.y };
    const offDir = { x: offX / (Math.hypot(offX, offY) || 1), y: offY / (Math.hypot(offX, offY) || 1) };
    offsetIsUphill = uphill.x * offDir.x + uphill.y * offDir.y > 0;
  }

  const residual = Math.min(
    ...best.roll.samples.map((s) => Math.hypot(s.x - hole.x, s.y - hole.y)),
  );

  return {
    direction: { x: Math.cos(safeAngle), y: Math.sin(safeAngle) },
    angleDeg: rad2deg(safeAngle),
    aimPoint,
    offsetM,
    offsetSide: Math.abs(offsetM) < 1e-4 ? 'none' : offsetM > 0 ? 'left' : 'right',
    offsetIsUphill,
    residual,
    holed: best.roll.holed,
    converged,
    roll: best.roll,
  };
}

export interface PuttLines {
  aim: AimSolution;
  lines: Record<Touch, RollResult>;
}

/** 以中等力度解算瞄准点，再用同一发射方向计算轻/中/重三条滚动线。 */
export function computePuttLines(
  terrain: Terrain,
  ball: Vec2,
  hole: Vec2,
  opts: RollOptions,
): PuttLines {
  const aim = solveAim(terrain, ball, hole, TOUCH_SPEEDS.medium, opts);
  const z0 = terrain.heightAt(ball.x, ball.y)!;
  const lines = {} as Record<Touch, RollResult>;
  (Object.keys(TOUCH_SPEEDS) as Touch[]).forEach((touch) => {
    lines[touch] = rollBall(terrain, ball, z0, aim.direction, TOUCH_SPEEDS[touch], {
      ...opts,
      hole,
    });
  });
  return { aim, lines };
}
