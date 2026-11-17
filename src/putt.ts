import type { GreenSurface } from './surface';
import type { Vec2 } from './types';

const G = 9.81;

export interface PuttResult {
  /** 轨迹点(含时间),球出界或停止时结束 */
  points: { x: number; y: number; z: number; t: number }[];
  /** 停止原因 */
  outcome: 'holed' | 'stopped' | 'off-green' | 'too-long';
  /** 总滚动距离(米) */
  distance: number;
  /** 横向偏移(拐点总位移,米) */
  breakAmount: number;
  /** 用时(秒) */
  duration: number;
}

export interface PuttOptions {
  /** 初始速度 m/s */
  speed: number;
  /** 初始方向(单位向量) */
  dir: Vec2;
  /** 摩擦系数(由斯坦普表换算) */
  mu: number;
  /** 洞位与半径 */
  hole?: { x: number; y: number; radius?: number };
  /** 进洞最大过洞速度 m/s,超过则涮洞而过 */
  maxHoleSpeed?: number;
  maxTime?: number;
  dt?: number;
}

/**
 * 推杆滚动模拟:半隐式欧拉积分。
 * 球受沿曲面投影的重力分量(-g·∇z,小坡度近似)与恒定大小、
 * 与速度反向的滚动摩擦(μ·g)。速度为零且坡度力不足以克服
 * 静摩擦(取 μ)时球停止。
 */
export function simulatePutt(
  surface: GreenSurface,
  start: Vec2,
  opts: PuttOptions,
): PuttResult {
  const dt = opts.dt ?? 0.005;
  const maxTime = opts.maxTime ?? 60;
  const holeRadius = opts.hole?.radius ?? 0.054; // 球洞半径 54mm
  const maxHoleSpeed = opts.maxHoleSpeed ?? 1.63; // 经验值:过洞速度超 ~1.6 m/s 不进

  let x = start.x, y = start.y;
  const dirMag = Math.hypot(opts.dir.x, opts.dir.y) || 1;
  let vx = (opts.dir.x / dirMag) * opts.speed;
  let vy = (opts.dir.y / dirMag) * opts.speed;

  const points: PuttResult['points'] = [];
  let t = 0;
  let distance = 0;
  const startZ = surface.heightAt(x, y);
  if (startZ === null) {
    return { points, outcome: 'off-green', distance: 0, breakAmount: 0, duration: 0 };
  }
  points.push({ x, y, z: startZ, t });

  let outcome: PuttResult['outcome'] = 'stopped';

  while (t < maxTime) {
    const grad = surface.gradientAt(x, y);
    if (!grad) { outcome = 'off-green'; break; }

    // 重力沿曲面分量(小坡度近似)
    let ax = -G * grad.x;
    let ay = -G * grad.y;

    const speed = Math.hypot(vx, vy);
    const friction = opts.mu * G;
    if (speed > 1e-6) {
      ax -= (vx / speed) * friction;
      ay -= (vy / speed) * friction;
    } else {
      // 静止:坡度力不足以克服摩擦则停住
      if (Math.hypot(ax, ay) <= friction) { outcome = 'stopped'; break; }
    }

    const nvx = vx + ax * dt;
    const nvy = vy + ay * dt;
    // 摩擦把速度减到反向 → 停(滚动摩擦不会反向加速)
    if (speed > 1e-6 && nvx * vx + nvy * vy < 0) {
      vx = 0; vy = 0;
    } else {
      vx = nvx; vy = nvy;
    }

    x += vx * dt;
    y += vy * dt;
    t += dt;
    distance += Math.hypot(vx, vy) * dt;

    const z = surface.heightAt(x, y);
    if (z === null) { outcome = 'off-green'; break; }
    points.push({ x, y, z, t });

    if (opts.hole) {
      const dh = Math.hypot(x - opts.hole.x, y - opts.hole.y);
      if (dh < holeRadius && Math.hypot(vx, vy) <= maxHoleSpeed) {
        outcome = 'holed';
        break;
      }
    }
    if (Math.hypot(vx, vy) < 1e-4) { outcome = 'stopped'; break; }
  }
  if (t >= maxTime) outcome = 'too-long';

  // 横向偏移:终点到"起点→洞口直线"的有符号距离(无洞时相对初速方向)
  let breakAmount = 0;
  const last = points[points.length - 1];
  if (opts.hole) {
    const hx = opts.hole.x - start.x, hy = opts.hole.y - start.y;
    const hl = Math.hypot(hx, hy) || 1;
    breakAmount = Math.abs((last.x - start.x) * (-hy / hl) + (last.y - start.y) * (hx / hl));
  }

  return { points, outcome, distance, breakAmount, duration: t };
}

/**
 * 反推"刚好以进洞速度到达洞口"的初速:
 * 沿起点→洞口直线采样坡度,能量法估算,再迭代修正。
 */
export function speedToHole(surface: GreenSurface, start: Vec2, hole: Vec2, mu: number, holingSpeed = 0.75): number {
  const dx = hole.x - start.x, dy = hole.y - start.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return 0;
  const ux = dx / dist, uy = dy / dist;

  // 一维能量积分:v² = v_end² + 2μg·s + 2g·Δz(沿直线,上坡为正)
  let v2 = holingSpeed * holingSpeed;
  const steps = Math.max(20, Math.ceil(dist / 0.25));
  const ds = dist / steps;
  for (let i = steps - 1; i >= 0; i--) {
    const s = i * ds;
    const z0 = surface.heightAt(start.x + ux * s, start.y + uy * s);
    const z1 = surface.heightAt(start.x + ux * (s + ds), start.y + uy * (s + ds));
    if (z0 === null || z1 === null) continue;
    v2 += 2 * mu * G * ds + 2 * G * (z1 - z0);
    if (v2 < 0) v2 = 0;
  }
  return Math.sqrt(v2) * 1.05; // 留 5% 余量抵消侧坡带来的路径增长
}
