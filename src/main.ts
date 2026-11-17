import './style.css';
import type { Green, TurfSettings } from './types';
import { parseCsv } from './csv';
import { GreenSurface } from './surface';
import { GreenScene, type SceneOptions } from './green3d';
import { generateSampleGreenPoints, generateTestGreenPoints, verifySlopeAccuracy } from './testGreen';
import { effectiveMu, effectiveStimpmeter, MOWING_PRESETS, stimpmeterToMu } from './stimpmeter';
import { simulatePutt, speedToHole, type PuttResult } from './putt';

// ---------- 全局状态 ----------
const state = {
  greens: [
    { id: 'g7', name: '7 号洞果岭(示例)', hole: 7, points: generateSampleGreenPoints() },
    { id: 'test', name: '测试果岭(解析坡面)', hole: 0, points: generateTestGreenPoints() },
  ] as Green[],
  activeId: 'g7',
  surfaces: new Map<string, GreenSurface>(),
  turf: { stimpmeterFt: 10, mowingHeightMm: 3.2, moisture: 'normal' } as TurfSettings,
  view: { contourInterval: 0.1, showContours: true, showArrows: true, timeOfDay: 10, exaggeration: 2 } as SceneOptions,
  putt: { ball: null as { x: number; y: number } | null, hole: null as { x: number; y: number } | null, result: null as PuttResult | null },
};

function activeGreen(): Green {
  return state.greens.find(g => g.id === state.activeId)!;
}

function activeSurface(): GreenSurface {
  let s = state.surfaces.get(state.activeId);
  if (!s) {
    s = new GreenSurface(activeGreen().points);
    state.surfaces.set(state.activeId, s);
  }
  return s;
}

// ---------- 路由 ----------
const pages = [
  { id: 'course', label: '球场' },
  { id: 'survey', label: '测量数据' },
  { id: 'green3d', label: '三维果岭' },
  { id: 'putt', label: '推杆线' },
  { id: 'turf', label: '草况设置' },
] as const;
type PageId = (typeof pages)[number]['id'];
let currentPage: PageId = 'course';
let cleanup: (() => void) | null = null;

const app = document.getElementById('app')!;
app.innerHTML = `
  <header>
    <h1>⛳ 果岭坡度三维查看</h1>
    <span class="sub">养护组每周测量 · 球童与会员可读</span>
  </header>
  <nav></nav>
  <main></main>
`;
const navEl = app.querySelector('nav')!;
const mainEl = app.querySelector('main')!;

for (const p of pages) {
  const b = document.createElement('button');
  b.textContent = p.label;
  b.dataset.page = p.id;
  b.onclick = () => showPage(p.id);
  navEl.appendChild(b);
}

function showPage(id: PageId) {
  if (cleanup) { cleanup(); cleanup = null; }
  currentPage = id;
  navEl.querySelectorAll('button').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.page === id));
  mainEl.innerHTML = '';
  const renderers: Record<PageId, () => void> = {
    course: renderCourse,
    survey: renderSurvey,
    green3d: renderGreen3d,
    putt: renderPutt,
    turf: renderTurf,
  };
  renderers[id]();
}

// ---------- 页面:球场 ----------
function renderCourse() {
  const div = document.createElement('div');
  div.className = 'page';
  div.innerHTML = `
    <div class="card">
      <h2>球场果岭</h2>
      <p class="dim">选择要查看的果岭。测量数据来自养护组每周的 CSV 高程点文件。</p>
      <div class="list"></div>
    </div>
    <div class="card">
      <h2>导入新测量</h2>
      <p class="dim">CSV 格式:x, y, z(米),支持表头。可先在"测量数据"页检查。</p>
      <div class="row">
        <input type="file" id="csv-file" accept=".csv,.txt" />
        <button class="btn ghost" id="dl-sample">下载示例 CSV</button>
      </div>
    </div>
  `;
  const list = div.querySelector('.list')!;
  for (const g of state.greens) {
    const item = document.createElement('div');
    item.className = 'green-item' + (g.id === state.activeId ? ' active' : '');
    const xs = g.points.map(p => p.x), ys = g.points.map(p => p.y), zs = g.points.map(p => p.z);
    const w = Math.max(...xs) - Math.min(...xs), d = Math.max(...ys) - Math.min(...ys);
    const drop = Math.max(...zs) - Math.min(...zs);
    item.innerHTML = `
      <div>
        <div>${g.name}</div>
        <div class="meta">${g.points.length} 个测点 · ${w.toFixed(0)}×${d.toFixed(0)} m · 高差 ${drop.toFixed(2)} m</div>
      </div>
      <div>${g.id === state.activeId ? '<span class="ok">当前</span>' : ''}</div>
    `;
    item.onclick = () => { state.activeId = g.id; showPage('green3d'); };
    list.appendChild(item);
  }

  div.querySelector<HTMLInputElement>('#csv-file')!.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const points = parseCsv(await file.text());
      const g: Green = {
        id: `csv-${Date.now()}`,
        name: file.name.replace(/\.[^.]+$/, ''),
        hole: state.greens.length,
        points,
      };
      state.greens.push(g);
      state.activeId = g.id;
      showPage('survey');
    } catch (err) {
      alert(`CSV 解析失败:${(err as Error).message}`);
    }
  };

  div.querySelector('#dl-sample')!.addEventListener('click', () => {
    const pts = generateSampleGreenPoints();
    const csv = 'x,y,z\n' + pts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(3)}`).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'green-7-sample.csv';
    a.click();
  });

  mainEl.appendChild(div);
}

// ---------- 页面:测量数据 ----------
function renderSurvey() {
  const g = activeGreen();
  const surface = activeSurface();
  const div = document.createElement('div');
  div.className = 'page';

  const xs = g.points.map(p => p.x), ys = g.points.map(p => p.y), zs = g.points.map(p => p.z);
  const stats = `
    <div class="row">
      <span>测点 <b>${g.points.length}</b></span>
      <span>三角形 <b>${surface.triangles.length}</b></span>
      <span>范围 <b>${(Math.max(...xs) - Math.min(...xs)).toFixed(1)} × ${(Math.max(...ys) - Math.min(...ys)).toFixed(1)} m</b></span>
      <span>高程 <b>${Math.min(...zs).toFixed(2)} ~ ${Math.max(...zs).toFixed(2)} m</b></span>
    </div>
  `;

  let accuracyHtml = '';
  if (g.id === 'test') {
    const acc = verifySlopeAccuracy(surface);
    const ok = acc.maxErrPct <= 2;
    accuracyHtml = `
      <div class="card">
        <h2>精度验证(解析坡面)</h2>
        <p>该果岭由解析曲面生成,坡度真值已知。重建坡度与解析值对比:</p>
        <div class="row">
          <span>最大偏差 <b class="${ok ? 'ok' : 'bad'}">${acc.maxErrPct.toFixed(3)}</b> 个百分点</span>
          <span>平均偏差 <b>${acc.meanErrPct.toFixed(3)}</b> 个百分点</span>
          <span class="${ok ? 'ok' : 'bad'}">${ok ? '✓ 满足 ≤ 2 个百分点要求' : '✗ 超出 2 个百分点'}</span>
        </div>
        <p class="dim">命令行复验:<code>npm test</code></p>
      </div>
    `;
  }

  const previewRows = g.points.slice(0, 200).map(p =>
    `<tr><td>${p.x.toFixed(2)}</td><td>${p.y.toFixed(2)}</td><td>${p.z.toFixed(3)}</td></tr>`).join('');

  div.innerHTML = `
    <div class="card">
      <h2>${g.name} — 测量数据</h2>
      ${stats}
      <div class="row">
        <input type="file" id="csv-replace" accept=".csv,.txt" />
        <span class="dim">上传新 CSV 替换当前果岭数据</span>
      </div>
    </div>
    ${accuracyHtml}
    <div class="card">
      <h2>高程点预览(前 200 行)</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>x (m)</th><th>y (m)</th><th>z (m)</th></tr></thead>
          <tbody>${previewRows}</tbody>
        </table>
      </div>
    </div>
  `;

  div.querySelector<HTMLInputElement>('#csv-replace')!.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      g.points = parseCsv(await file.text());
      state.surfaces.delete(g.id);
      showPage('survey');
    } catch (err) {
      alert(`CSV 解析失败:${(err as Error).message}`);
    }
  };

  mainEl.appendChild(div);
}

// ---------- 页面:三维果岭 ----------
function renderGreen3d() {
  const surface = activeSurface();
  const wrap = document.createElement('div');
  wrap.className = 'page full';
  wrap.innerHTML = `
    <div class="toolbar">
      <div class="row"><label>等高距</label><input type="range" id="ci" min="0.05" max="0.5" step="0.05" value="${state.view.contourInterval}"><span class="val" id="ci-v">${state.view.contourInterval.toFixed(2)} m</span></div>
      <div class="row"><label>时刻</label><input type="range" id="tod" min="6" max="19" step="0.5" value="${state.view.timeOfDay}"><span class="val" id="tod-v">${state.view.timeOfDay.toFixed(1)}:00</span></div>
      <div class="row"><label>高程夸张</label><input type="range" id="ex" min="1" max="5" step="0.5" value="${state.view.exaggeration}"><span class="val" id="ex-v">${state.view.exaggeration.toFixed(1)}×</span></div>
      <div class="row"><label><input type="checkbox" id="sc" ${state.view.showContours ? 'checked' : ''}> 等高线</label>
      <label><input type="checkbox" id="sa" ${state.view.showArrows ? 'checked' : ''}> 下坡箭头</label></div>
      <button class="btn" id="shot">📷 截图(带图例)</button>
    </div>
    <div class="viewer-wrap"><div id="view"></div>
      <div class="hint">拖动旋转 · 滚轮/双指缩放 · 右键/双指平移</div>
    </div>
  `;
  mainEl.appendChild(wrap);

  const scene = new GreenScene(wrap.querySelector('#view') as HTMLElement, state.view);
  scene.buildSurface(surface);

  wrap.querySelector<HTMLInputElement>('#ci')!.oninput = (e) => {
    state.view.contourInterval = Number((e.target as HTMLInputElement).value);
    wrap.querySelector('#ci-v')!.textContent = `${state.view.contourInterval.toFixed(2)} m`;
    scene.setOptions({ contourInterval: state.view.contourInterval });
  };
  wrap.querySelector<HTMLInputElement>('#tod')!.oninput = (e) => {
    state.view.timeOfDay = Number((e.target as HTMLInputElement).value);
    wrap.querySelector('#tod-v')!.textContent = `${state.view.timeOfDay.toFixed(1)}:00`;
    scene.setOptions({ timeOfDay: state.view.timeOfDay });
  };
  wrap.querySelector<HTMLInputElement>('#ex')!.oninput = (e) => {
    state.view.exaggeration = Number((e.target as HTMLInputElement).value);
    wrap.querySelector('#ex-v')!.textContent = `${state.view.exaggeration.toFixed(1)}×`;
    scene.setOptions({ exaggeration: state.view.exaggeration });
  };
  wrap.querySelector<HTMLInputElement>('#sc')!.onchange = (e) => {
    state.view.showContours = (e.target as HTMLInputElement).checked;
    scene.setOptions({ showContours: state.view.showContours });
  };
  wrap.querySelector<HTMLInputElement>('#sa')!.onchange = (e) => {
    state.view.showArrows = (e.target as HTMLInputElement).checked;
    scene.setOptions({ showArrows: state.view.showArrows });
  };
  wrap.querySelector('#shot')!.addEventListener('click', () => {
    scene.screenshot({
      greenName: activeGreen().name,
      contourInterval: state.view.contourInterval,
      turf: state.turf,
      timeOfDay: state.view.timeOfDay,
    });
  });

  cleanup = () => scene.dispose();
}

// ---------- 页面:推杆线 ----------
function renderPutt() {
  const surface = activeSurface();
  const wrap = document.createElement('div');
  wrap.className = 'page full';
  wrap.innerHTML = `
    <div class="toolbar">
      <button class="btn" id="mode-ball">① 点球位</button>
      <button class="btn ghost" id="mode-hole">② 点洞位</button>
      <button class="btn ghost" id="run" disabled>模拟推杆</button>
      <button class="btn ghost" id="clear">清除</button>
      <div class="row"><label>力度</label><input type="range" id="power" min="50" max="200" step="5" value="100"><span class="val" id="power-v">100%</span></div>
      <span class="dim">斯坦普 ${effectiveStimpmeter(state.turf).toFixed(1)} ft(草况页可调)</span>
    </div>
    <div class="viewer-wrap"><div id="view"></div>
      <div class="hint" id="hint">点击果岭放置球位</div>
      <div class="putt-info" id="info" hidden></div>
    </div>
  `;
  mainEl.appendChild(wrap);

  const scene = new GreenScene(wrap.querySelector('#view') as HTMLElement, { ...state.view, showArrows: true });
  scene.buildSurface(surface);
  scene.setMarkers(state.putt.ball, state.putt.hole);
  if (state.putt.result) scene.showPuttPath(state.putt.result.points);

  let mode: 'ball' | 'hole' = 'ball';
  const ballBtn = wrap.querySelector<HTMLButtonElement>('#mode-ball')!;
  const holeBtn = wrap.querySelector<HTMLButtonElement>('#mode-hole')!;
  const runBtn = wrap.querySelector<HTMLButtonElement>('#run')!;
  const hint = wrap.querySelector('#hint')!;
  const info = wrap.querySelector('#info') as HTMLElement;
  let power = 1;

  function setMode(m: 'ball' | 'hole') {
    mode = m;
    ballBtn.classList.toggle('ghost', m !== 'ball');
    holeBtn.classList.toggle('ghost', m !== 'hole');
    hint.textContent = m === 'ball' ? '点击果岭放置球位' : '点击果岭放置洞位';
  }
  ballBtn.onclick = () => setMode('ball');
  holeBtn.onclick = () => setMode('hole');

  function refresh() {
    scene.setMarkers(state.putt.ball, state.putt.hole);
    runBtn.disabled = !(state.putt.ball && state.putt.hole);
  }

  // 区分"点击放置"与"拖动旋转":按下与抬起位置接近才算点击
  let downX = 0, downY = 0;
  const dom = scene.renderer.domElement;
  dom.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
  dom.addEventListener('pointerup', (e) => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
    const hit = scene.pickSurface(e.clientX, e.clientY);
    if (!hit) return;
    if (mode === 'ball') { state.putt.ball = { x: hit.x, y: hit.y }; setMode('hole'); }
    else state.putt.hole = { x: hit.x, y: hit.y };
    state.putt.result = null;
    scene.showPuttPath(null);
    (info as HTMLElement).hidden = true;
    refresh();
  });

  wrap.querySelector<HTMLInputElement>('#power')!.oninput = (e) => {
    power = Number((e.target as HTMLInputElement).value) / 100;
    wrap.querySelector('#power-v')!.textContent = `${Math.round(power * 100)}%`;
  };

  runBtn.onclick = () => {
    const { ball, hole } = state.putt;
    if (!ball || !hole) return;
    const mu = effectiveMu(state.turf);
    const baseSpeed = speedToHole(surface, ball, hole, mu);
    const dir = { x: hole.x - ball.x, y: hole.y - ball.y };
    const result = simulatePutt(surface, ball, {
      speed: baseSpeed * power,
      dir,
      mu,
      hole: { x: hole.x, y: hole.y },
    });
    state.putt.result = result;
    scene.showPuttPath(result.points);
    const outcomeText = { holed: '✓ 进洞', stopped: '停在果岭上', 'off-green': '滚出果岭', 'too-long': '模拟超时' }[result.outcome];
    info.hidden = false;
    info.innerHTML = `
      <b>${outcomeText}</b><br>
      初速 ${(baseSpeed * power).toFixed(2)} m/s<br>
      滚动距离 ${result.distance.toFixed(2)} m<br>
      侧移(拐点量)${result.breakAmount.toFixed(2)} m<br>
      用时 ${result.duration.toFixed(1)} s
    `;
  };

  wrap.querySelector('#clear')!.addEventListener('click', () => {
    state.putt.ball = null; state.putt.hole = null; state.putt.result = null;
    scene.setMarkers(null, null);
    scene.showPuttPath(null);
    info.hidden = true;
    refresh();
    setMode('ball');
  });

  refresh();
  cleanup = () => scene.dispose();
}

// ---------- 页面:草况设置 ----------
function renderTurf() {
  const div = document.createElement('div');
  div.className = 'page';

  function muInfo(): string {
    const eff = effectiveStimpmeter(state.turf);
    const mu = stimpmeterToMu(eff);
    return `有效果岭速度 <b class="ok">${eff.toFixed(1)} ft</b> · 摩擦系数 μ ≈ <b class="ok">${mu.toFixed(4)}</b> · 水平制动 ≈ ${(mu * 9.81).toFixed(2)} m/s²`;
  }

  div.innerHTML = `
    <div class="card">
      <h2>草况设置</h2>
      <p class="dim">斯坦普表读数换算草面滚动摩擦,用于推杆模拟。修剪越短、越干燥,球速越快。</p>
      <div class="row">
        <label>斯坦普读数</label>
        <input type="range" id="stim" min="6" max="14" step="0.5" value="${state.turf.stimpmeterFt}">
        <span class="val" id="stim-v">${state.turf.stimpmeterFt.toFixed(1)} ft</span>
      </div>
      <div class="row">
        <label>修剪高度</label>
        <input type="range" id="mow" min="2.4" max="5" step="0.1" value="${state.turf.mowingHeightMm}">
        <span class="val" id="mow-v">${state.turf.mowingHeightMm.toFixed(1)} mm</span>
      </div>
      <div class="row">
        <label>湿度</label>
        <select id="moist">
          <option value="dry" ${state.turf.moisture === 'dry' ? 'selected' : ''}>干燥(+0.5 ft)</option>
          <option value="normal" ${state.turf.moisture === 'normal' ? 'selected' : ''}>正常</option>
          <option value="wet" ${state.turf.moisture === 'wet' ? 'selected' : ''}>潮湿(−1.0 ft)</option>
        </select>
      </div>
      <h3>快捷预设</h3>
      <div class="row" id="presets"></div>
    </div>
    <div class="card">
      <h2>换算结果</h2>
      <p id="mu-info">${muInfo()}</p>
      <p class="dim">换算公式:μ = v₀² / (2·g·S),v₀ = 1.83 m/s(斯坦普表标准出槽速度),S 为读数。修剪高度以 3.2 mm 为基准,每 ±0.5 mm 约 ±0.5 ft。</p>
    </div>
  `;

  const stim = div.querySelector<HTMLInputElement>('#stim')!;
  const mow = div.querySelector<HTMLInputElement>('#mow')!;
  const moist = div.querySelector<HTMLSelectElement>('#moist')!;
  const update = () => {
    state.turf.stimpmeterFt = Number(stim.value);
    state.turf.mowingHeightMm = Number(mow.value);
    state.turf.moisture = moist.value as TurfSettings['moisture'];
    div.querySelector('#stim-v')!.textContent = `${state.turf.stimpmeterFt.toFixed(1)} ft`;
    div.querySelector('#mow-v')!.textContent = `${state.turf.mowingHeightMm.toFixed(1)} mm`;
    div.querySelector('#mu-info')!.innerHTML = muInfo();
  };
  stim.oninput = update;
  mow.oninput = update;
  moist.onchange = update;

  const presets = div.querySelector('#presets')!;
  for (const p of MOWING_PRESETS) {
    const b = document.createElement('button');
    b.className = 'btn ghost';
    b.textContent = p.label;
    b.onclick = () => {
      stim.value = String(p.stim);
      mow.value = String(p.mm);
      update();
    };
    presets.appendChild(b);
  }

  mainEl.appendChild(div);
}

// ---------- 启动 ----------
showPage(currentPage);
