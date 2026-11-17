import { GRAVITY, DEFAULT_ROUGH_FRICTION } from './friction.ts';
import type { Terrain } from './terrain.ts';
import type { Vec2, Vec3 } from './types.ts';

/**
 * 高尔夫球在 TIN 坡面上的滚动物理（二维水平坐标积分 + 贴地约束）。
 *
 * 切向加速度：a = g·(t − μ·v̂)，其中 t = −∇h / (1+|∇h|²) 为重力沿
 * 坡面的切向分量（由平面法向直接给出，无需差分），μ·v̂ 为与运动方向
 * 相反的滚动阻力。固定时间步 RK1（欧拉）积分，步长 5ms，对果岭
 * 这类低速、缓坡场景精度足够且结果稳定可复现。
 *
 * 边界处理（验收点 3）：球到达 TIN 边界不会停下。记录出界点后切换到
 * 果岭外模型——沿用出界三角形的坡度并改用长草摩擦，继续积分直到
 * 真正停住，轨迹带 offGreen 标记。
 */

export interface RollOptions {
  muGreen: number;
  muRough?: number;
  /** 球洞水平位置；距洞小于捕获半径时停在洞内 */
  hole?: Vec2;
  holeRadius?: number;
  /** 最长积分时间（秒），防御性兜底 */
  maxTime?: number;
  dt?: number;
}

export interface RollSample {
  x: number;
  y: number;
  z: number;
  t: number;
  speed: number;
  offGreen: boolean;
}

export interface RollResult {
  samples: RollSample[];
  /** 停点（或入洞点/超时点） */
  end: Vec3;
  stopped: boolean;
  holed: boolean;
  /** 滚出果岭的位置（未出界则为 null） */
  exitPoint: Vec3 | null;
  /** 出界时的速度（m/s） */
  exitSpeed: number;
  totalTime: number;
}

const STOP_SPEED = 0.05;
const DEFAULT_HOLE_RADIUS = 0.108 / 2; // 洞杯直径 108mm
/** 洞缘捕获能量系数：v_capture = sqrt(K_capture·g·r_hole)，
 *  由刚体撞入洞杯的能量分析（Holmes 等）给出，典型值 1.63 */
const HOLE_CAPTURE_FACTOR = 1.63;

export function rollBall(
  terrain: Terrain,
  start: Vec2,
  startZ: number,
  dir: Vec2,
  speed: number,
  opts: RollOptions,
): RollResult {
  const dt = opts.dt ?? 0.008;
  const maxTime = opts.maxTime ?? 30;
  const muRough = opts.muRough ?? DEFAULT_ROUGH_FRICTION;
  const holeR = opts.holeRadius ?? DEFAULT_HOLE_RADIUS;

  let x = start.x;
  let y = start.y;
  let z = startZ;
  let vx = dir.x * speed;
  let vy = dir.y * speed;
  let t = 0;
  let offGreen = false;
  let exitPoint: Vec3 | null = null;
  let exitSpeed = 0;
  let holed = false;
  let stopped = false;

  // 出界后沿用地形坡度（由最近边界三角形缓存）
  let cachedSlope: { gradX: number; gradY: number } | null = null;

  const samples: RollSample[] = [];
  const pushSample = (s: number) => {
    samples.push({ x, y, z, t, speed: s, offGreen });
  };
  pushSample(speed);

  /**
   * 洞杯捕获判定（Holmes 能量模型）：轨迹线段与洞杯圆相交，
   * 且经过洞缘时速度低于捕获速度 v* = sqrt(K·g·r)。
   * 低速时退化为圆心距判定，高速撞洞缘会弹开不捕获。
   */
  const checkHole = (px: number, py: number, sp: number): boolean => {
    if (!opts.hole) return false;
    const dx = x - px;
    const dy = y - py;
    const seg2 = dx * dx + dy * dy;
    const fx = px - opts.hole.x;
    const fy = py - opts.hole.y;
    let minDist2 = fx * fx + fy * fy;
    if (seg2 > 1e-15) {
      const tau = Math.max(0, Math.min(1, -(fx * dx + fy * dy) / seg2));
      const cx = px + tau * dx - opts.hole.x;
      const cy = py + tau * dy - opts.hole.y;
      minDist2 = cx * cx + cy * cy;
    }
    if (minDist2 > holeR * holeR) return false;
    const captureSpeed = Math.sqrt(HOLE_CAPTURE_FACTOR * GRAVITY * holeR);
    return sp <= captureSpeed;
  };

  const maxSteps = Math.ceil(maxTime / dt);
  let prevX = x;
  let prevY = y;
  for (let step = 0; step < maxSteps; step++) {
    // 入洞判定：线段穿过洞杯且速度低于捕获阈值（防止步长跨过洞杯）
    if (opts.hole && !offGreen && step > 0 && checkHole(prevX, prevY, Math.hypot(vx, vy))) {
      holed = true;
      stopped = true;
      const hz = terrain.heightAt(opts.hole.x, opts.hole.y) ?? z;
      x = opts.hole.x;
      y = opts.hole.y;
      z = hz;
      pushSample(0);
      break;
    }

    const loc = terrain.locate(x, y);
    let gradX: number;
    let gradY: number;
    if (loc) {
      const plane = terrain.planeAt(loc.tri);
      // 平面 nx·x+ny·y+nz·z+d=0 → z = −(nx·x+ny·y+d)/nz
      gradX = -plane.normal.x / plane.normal.z;
      gradY = -plane.normal.y / plane.normal.z;
      cachedSlope = { gradX, gradY };
      z = terrain.heightAt(x, y) ?? z;
    } else {
      // —— 已出果岭：不在边界停，沿用最后坡度 + 长草摩擦 ——
      if (!offGreen) {
        offGreen = true;
        exitPoint = { x, y, z };
        exitSpeed = Math.hypot(vx, vy);
      }
      if (cachedSlope) {
        gradX = cachedSlope.gradX;
        gradY = cachedSlope.gradY;
        // 沿延伸平面外推高程，保证轨迹连续
        z += gradX * vx * dt + gradY * vy * dt;
      } else {
        gradX = 0;
        gradY = 0;
      }
    }

    const speedNow = Math.hypot(vx, vy);
    const mu = offGreen ? muRough : opts.muGreen;
    // 约束 z=h(x,y) 的拉格朗日推导（无滑动滚动等效阻力系数 μ）：
    //   水平切向重力:  -g·grad / (1+|grad|²)
    //   水平滚动阻力:  -μ·g·v / (|v|·(1+|grad|²))
    // 平地时退化为标准匀减速 a = -μg，与 Stimp 标定模型一致。
    const gDen = 1 + gradX * gradX + gradY * gradY;

    // 当前步阻力方向上的减速度（不含重力，重力在停球判定中单独处理）
    const decel = (mu * GRAVITY) / gDen;
    const gravityPull = (GRAVITY * Math.hypot(gradX, gradY)) / gDen;

    if (speedNow <= STOP_SPEED && gravityPull <= decel) {
      // 静摩擦/滚动阻力足以抵消重力切向分量 → 停住
      vx = 0;
      vy = 0;
      stopped = true;
      pushSample(0);
      break;
    }

    let ax = (-GRAVITY * gradX) / gDen;
    let ay = (-GRAVITY * gradY) / gDen;

    if (speedNow > 1e-9) {
      ax -= (mu * GRAVITY * vx) / (speedNow * gDen);
      ay -= (mu * GRAVITY * vy) / (speedNow * gDen);
    }

    vx += ax * dt;
    vy += ay * dt;
    const newSpeed = Math.hypot(vx, vy);
    // 步内动能耗尽（速度方向反转）且重力不足以维持滚动 → 本步停住
    if (newSpeed > speedNow && gravityPull <= decel) {
      vx = 0;
      vy = 0;
      stopped = true;
      pushSample(0);
      break;
    }

    x += vx * dt;
    y += vy * dt;
    if (!offGreen) {
      const hz = terrain.heightAt(x, y);
      if (hz !== null) z = hz;
    }
    t += dt;
    prevX = x;
    prevY = y;

    if (step % 8 === 0) pushSample(newSpeed); // 200Hz 物理，25Hz 采样
  }

  if (!stopped) pushSample(Math.hypot(vx, vy));

  return {
    samples,
    end: { x, y, z },
    stopped,
    holed,
    exitPoint,
    exitSpeed,
    totalTime: t,
  };
}

/** 三档力度对应的初始速度（m/s），可在 UI 调整。
 *  典型 3–10m 推杆出球速度 0.8–2.0 m/s。 */
export const TOUCH_SPEEDS = {
  light: 1.1,
  medium: 1.5,
  heavy: 2.0,
} as const;

export type Touch = keyof typeof TOUCH_SPEEDS;
