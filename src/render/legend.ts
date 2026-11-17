/**
 * 截图图例：在 WebGL 渲染图上用 Canvas2D 叠加
 * 标题、比例尺、坡度色带、三档力度图例、瞄准读数与时间戳。
 */

export interface LegendData {
  title: string;
  stimp: number;
  mowMm: number;
  timeLabel: string;
  aimOffsetM: number | null;
  aimSide: 'left' | 'right' | 'none';
  uphill: boolean;
  ballSlopePercent: number | null;
  scaleMeters: number;
}

const TOUCH_META = [
  { key: 'light', label: '轻力度', color: '#2ecc71' },
  { key: 'medium', label: '中力度', color: '#f1c40f' },
  { key: 'heavy', label: '重力度', color: '#e74c3c' },
] as const;

export function composeLegend(dataUrl: string, w: number, h: number, data: LegendData): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = new Image();
  img.src = dataUrl;
  ctx.drawImage(img, 0, 0, w, h);

  const pad = Math.max(12, w * 0.018);
  const panelW = Math.min(330, w * 0.32);
  const lineH = 26;

  // 半透明面板
  ctx.fillStyle = 'rgba(20, 32, 22, 0.72)';
  const panelH = pad * 2 + lineH * 7.4 + 110;
  roundRect(ctx, pad, pad, panelW, panelH, 10);
  ctx.fill();

  ctx.textBaseline = 'middle';
  let y = pad + 18;
  ctx.fillStyle = '#f2f7ee';
  ctx.font = `600 ${Math.round(panelW * 0.072)}px system-ui, sans-serif`;
  ctx.fillText(data.title, pad + 14, y);
  y += lineH;
  ctx.font = `400 ${Math.round(panelW * 0.052)}px system-ui, sans-serif`;
  ctx.fillStyle = '#cfe0c6';
  ctx.fillText(`Stimp ${data.stimp.toFixed(1)} 英尺 · 草高 ${data.mowMm.toFixed(1)}mm`, pad + 14, y);
  y += lineH;
  ctx.fillText(`时刻 ${data.timeLabel}`, pad + 14, y);
  y += lineH;
  if (data.ballSlopePercent !== null) {
    ctx.fillText(`球位坡度 ${data.ballSlopePercent.toFixed(1)}%`, pad + 14, y);
    y += lineH;
  }
  if (data.aimOffsetM !== null && data.aimSide !== 'none') {
    const side = data.aimSide === 'left' ? '左' : '右';
    const dir = data.uphill ? '高坡侧' : '低坡侧';
    ctx.fillStyle = '#9fd0ff';
    ctx.fillText(`瞄准偏移 ${(data.aimOffsetM * 100).toFixed(0)}cm（${side}·${dir}）`, pad + 14, y);
  } else {
    ctx.fillStyle = '#9fd0ff';
    ctx.fillText('瞄准偏移 0（直推）', pad + 14, y);
  }
  y += lineH * 1.25;

  // 力度图例
  for (const m of TOUCH_META) {
    ctx.fillStyle = m.color;
    ctx.fillRect(pad + 14, y - 7, 34, 6);
    ctx.fillStyle = '#e6efe0';
    ctx.fillText(m.label, pad + 58, y);
    y += lineH * 0.92;
  }
  y += 8;

  // 坡度色带 0–8%
  const barW = panelW - 28;
  const grad = ctx.createLinearGradient(pad + 14, 0, pad + 14 + barW, 0);
  grad.addColorStop(0, '#3d7a34');
  grad.addColorStop(1, '#c9c25a');
  ctx.fillStyle = grad;
  ctx.fillRect(pad + 14, y, barW, 12);
  ctx.fillStyle = '#e6efe0';
  ctx.font = `400 ${Math.round(panelW * 0.046)}px system-ui, sans-serif`;
  ctx.fillText('坡度 0%', pad + 14, y + 26);
  ctx.fillText('8%+', pad + 14 + barW - 26, y + 26);
  y += 48;

  // 比例尺
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad + 14, y);
  ctx.lineTo(pad + 14 + barW * 0.4, y);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`比例尺 ${data.scaleMeters}m`, pad + 14, y + 16);

  // 右下角时间戳
  ctx.fillStyle = 'rgba(20,32,22,0.6)';
  const stamp = new Date().toLocaleString('zh-CN');
  ctx.font = `400 12px system-ui, sans-serif`;
  const tw = ctx.measureText(stamp).width;
  roundRect(ctx, w - tw - 24, h - 34, tw + 16, 24, 6);
  ctx.fill();
  ctx.fillStyle = '#dce8d4';
  ctx.fillText(stamp, w - tw - 16, h - 22);

  return canvas.toDataURL('image/png');
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
