/**
 * 生成演示用高程 CSV（与 tests 夹具同款碗形果岭 + 坡面叠加），
 * 模拟养护组 1m 间距的周测数据。输出到 public/samples/green-demo.csv。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const out = new URL('../public/samples/green-demo.csv', import.meta.url);
const half = 12;
const step = 1;
const lines: string[] = ['x,y,z'];
for (let x = -half; x <= half; x += step) {
  for (let y = -half; y <= half; y += step) {
    const r2 = x * x + y * y;
    const z =
      0.08 +
      0.004 * r2 +
      0.15 * Math.exp(-((x - 3) ** 2 + (y + 2) ** 2) / 12) +
      0.012 * x;
    lines.push(`${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(4)}`);
  }
}
mkdirSync(dirname(out.pathname.replace(/^\/([A-Za-z]:)/, '$1')), { recursive: true });
writeFileSync(out.pathname.replace(/^\/([A-Za-z]:)/, '$1'), lines.join('\n'), 'utf8');
console.log(`written ${lines.length - 1} points`);
