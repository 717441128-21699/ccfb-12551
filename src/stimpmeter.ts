import type { TurfSettings } from './types';

/**
 * 斯坦普表(Stimpmeter)读数 → 草面滚动摩擦系数。
 *
 * 斯坦普表让球从固定斜槽滚下,出槽速度 v0 ≈ 1.83 m/s(6 ft/s),
 * 在水平果岭上滚动的距离 S 就是读数。由能量守恒:
 *   ½ m v0² = μ m g S  →  μ = v0² / (2 g S)
 */
const V0 = 1.8288; // m/s,USGA 标准出槽速度
const G = 9.81;

export function stimpmeterToMu(stimpmeterFt: number): number {
  const s = stimpmeterFt * 0.3048; // 英尺 → 米
  return (V0 * V0) / (2 * G * s);
}

/** 由摩擦系数反推水平制动减速度 (m/s²) */
export function brakingDecel(mu: number): number {
  return mu * G;
}

/**
 * 修剪高度对果岭速度的修正。
 * 基准:3.2 mm 时读数即实测值;剪得越短越快,越长越慢。
 * 每 ±0.5 mm 大约影响 ±0.5 ft(经验曲线,可在草况页微调)。
 */
export function mowingHeightAdjustment(mowingHeightMm: number): number {
  return (3.2 - mowingHeightMm) * 1.0; // 英尺
}

/** 湿度修正:湿果岭更慢 */
export function moistureAdjustment(moisture: TurfSettings['moisture']): number {
  switch (moisture) {
    case 'dry': return 0.5;
    case 'normal': return 0;
    case 'wet': return -1.0;
  }
}

/** 综合草况得到有效斯坦普表读数(英尺) */
export function effectiveStimpmeter(t: TurfSettings): number {
  const eff = t.stimpmeterFt + mowingHeightAdjustment(t.mowingHeightMm) + moistureAdjustment(t.moisture);
  return Math.max(4, Math.min(16, eff));
}

export function effectiveMu(t: TurfSettings): number {
  return stimpmeterToMu(effectiveStimpmeter(t));
}

/** 常用修剪高度预设(锦标赛/日常) */
export const MOWING_PRESETS = [
  { label: '锦标赛 2.8 mm', mm: 2.8, stim: 11.5 },
  { label: '会员日 3.2 mm', mm: 3.2, stim: 10.0 },
  { label: '雨季留草 3.8 mm', mm: 3.8, stim: 8.5 },
];
