/**
 * Stimpmeter（斯坦普表）读数 → 草面滚动摩擦系数换算。
 *
 * 模型依据（可标定，常量均导出）：
 *  1. 标准 Stimpmeter 出球速度 v0 ≈ 1.83 m/s（USGA 仪器倾角约 20°）；
 *  2. 平面匀减速滚动：v0² = 2·μ·g·S，S 为读数（英尺换算成米），
 *     故 μ = v0² / (2 g S_m)；
 *  3. 修剪高度影响：草叶越长，能量损失越大，同一读数对应的实际速度
 *     随修剪高度变化。用指数模型把“参考修剪高度下的读数”折算为
 *     当前修剪高度下的等效读数 S_eff = S·exp(-k·(h-h_ref))，
 *     再代入上式。k 为现场可标定系数（默认每毫米 5% 速度差）。
 */

export const STIMP_EXIT_SPEED = 1.83; // m/s
export const GRAVITY = 9.81; // m/s²
export const FOOT = 0.3048; // m
export const REF_MOW_MM = 3.2; // 参考修剪高度（约 0.125 英寸）
export const DEFAULT_MOW_FACTOR = 0.05; // 每毫米修剪高度差对应的速度指数系数

export interface FrictionOptions {
  /** 修剪高度（毫米） */
  mowHeightMm?: number;
  /** 修剪高度影响系数，默认 0.05/mm */
  mowFactor?: number;
  /** 出球速度覆盖（仪器标定用） */
  exitSpeed?: number;
}

/** 修剪高度折算后的等效 Stimp 读数（英尺）。 */
export function effectiveStimp(stimpFt: number, opts: FrictionOptions = {}): number {
  const h = opts.mowHeightMm ?? REF_MOW_MM;
  const k = opts.mowFactor ?? DEFAULT_MOW_FACTOR;
  if (!(stimpFt > 0)) throw new Error('Stimp 读数必须为正数');
  return stimpFt * Math.exp(-k * (h - REF_MOW_MM));
}

/** Stimp 读数 + 修剪高度 → 滚动摩擦系数 μ（无量纲）。 */
export function stimpToFriction(stimpFt: number, opts: FrictionOptions = {}): number {
  const sEff = effectiveStimp(stimpFt, opts);
  const v0 = opts.exitSpeed ?? STIMP_EXIT_SPEED;
  const distanceM = sEff * FOOT;
  return (v0 * v0) / (2 * GRAVITY * distanceM);
}

/** 逆换算：μ → 等效 Stimp 读数（英尺），便于 UI 双向校验。 */
export function frictionToStimp(mu: number, opts: FrictionOptions = {}): number {
  if (!(mu > 0)) throw new Error('摩擦系数必须为正数');
  const v0 = opts.exitSpeed ?? STIMP_EXIT_SPEED;
  const sEff = (v0 * v0) / (2 * GRAVITY * mu * FOOT);
  const h = opts.mowHeightMm ?? REF_MOW_MM;
  const k = opts.mowFactor ?? DEFAULT_MOW_FACTOR;
  return sEff / Math.exp(-k * (h - REF_MOW_MM));
}

/** 果岭外长草/球道摩擦（球滚出果岭后使用），默认显著大于果岭。 */
export const DEFAULT_ROUGH_FRICTION = 0.25;
