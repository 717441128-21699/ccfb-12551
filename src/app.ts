import { GreenScene } from './render/GreenScene.ts';
import { PickerControls } from './render/PickerControls.ts';
import { composeLegend } from './render/legend.ts';
import { delaunay } from './lib/delaunay.ts';
import { Terrain } from './lib/terrain.ts';
import { parseSurveyCsv } from './lib/csv.ts';
import { stimpToFriction } from './lib/friction.ts';
import { computePuttLines, type PuttLines } from './lib/aim.ts';
import type { Vec2 } from './lib/types.ts';

interface UiState {
  stimp: number;
  mowMm: number;
  hour: number;
  verticalScale: number;
  ball: Vec2 | null;
  hole: Vec2 | null;
}

export class App {
  private gs: GreenScene;
  private controls: PickerControls | null = null;
  private terrain: Terrain | null = null;
  private putt: PuttLines | null = null;
  private state: UiState = {
    stimp: 11,
    mowMm: 3.2,
    hour: 10,
    verticalScale: 4,
    ball: null,
    hole: null,
  };
  private recomputeTimer = 0;
  private readonly els: Record<string, HTMLElement>;

  constructor() {
    const container = document.getElementById('view')!;
    this.gs = new GreenScene(container, {
      latitude: 31.2,
      longitude: 121.5,
      utcOffset: 8,
    });
    this.els = {
      status: document.getElementById('status')!,
      info: document.getElementById('info')!,
      slope: document.getElementById('slope-readout')!,
    };
    this.bindUi();
    this.loop();
  }

  private bindUi() {
    document.getElementById('csv-input')!.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) await this.loadCsv(await file.text(), file.name);
    });
    document.getElementById('demo-btn')!.addEventListener('click', async () => {
      const res = await fetch('./samples/green-demo.csv');
      await this.loadCsv(await res.text(), 'green-demo.csv');
    });
    document.getElementById('stimp')!.addEventListener('input', (e) => {
      this.state.stimp = Number((e.target as HTMLInputElement).value);
      document.getElementById('stimp-val')!.textContent = this.state.stimp.toFixed(1);
      this.scheduleRecompute();
    });
    document.getElementById('mow')!.addEventListener('input', (e) => {
      this.state.mowMm = Number((e.target as HTMLInputElement).value);
      document.getElementById('mow-val')!.textContent = this.state.mowMm.toFixed(1);
      this.scheduleRecompute();
    });
    document.getElementById('time')!.addEventListener('input', (e) => {
      this.state.hour = Number((e.target as HTMLInputElement).value);
      document.getElementById('time-val')!.textContent = this.formatHour(this.state.hour);
      this.gs.setTime(this.state.hour);
    });
    document.getElementById('vscale')!.addEventListener('input', (e) => {
      this.state.verticalScale = Number((e.target as HTMLInputElement).value);
      document.getElementById('vscale-val')!.textContent = `${this.state.verticalScale}×`;
      this.gs.setVerticalScale(this.state.verticalScale);
      this.refreshMarkers();
    });
    document.getElementById('shot-btn')!.addEventListener('click', () => this.screenshot());
  }

  private async loadCsv(text: string, name: string) {
    try {
      const { points, skipped, warnings } = parseSurveyCsv(text);
      const t0 = performance.now();
      const { points: pts, triangles } = delaunay(points);
      const triMs = performance.now() - t0;
      this.terrain = new Terrain(pts, triangles);
      this.gs.buildTerrain(this.terrain);
      this.gs.setTime(this.state.hour);

      // 默认球位/洞位：取内部两个点
      const b = this.terrain.bounds;
      const ball = { x: b.minX + (b.maxX - b.minX) * 0.3, y: (b.minY + b.maxY) / 2 };
      const hole = { x: b.minX + (b.maxX - b.minX) * 0.7, y: (b.minY + b.maxY) / 2 };
      this.state.ball = this.terrain.locate(ball.x, ball.y) ? ball : { ...pts[0] };
      this.state.hole = this.terrain.locate(hole.x, hole.y) ? hole : { ...pts[1] };

      const canvas = this.gs.renderer.domElement;
      this.controls?.dispose();
      this.controls = new PickerControls(this.gs, this.terrain, canvas, (target, p) => {
        if (target === 'ball') this.state.ball = { ...p };
        else this.state.hole = { ...p };
        this.refreshMarkers();
        this.scheduleRecompute();
      });

      this.refreshMarkers();
      this.recompute();
      this.els.status.textContent =
        `已加载 ${name}：${pts.length} 点 / ${triangles.length} 三角形` +
        `（剖分 ${triMs.toFixed(1)}ms${skipped ? `，跳过 ${skipped} 坏行` : ''}）`;
      if (warnings.length) this.els.status.textContent += `；${warnings[0]}`;
    } catch (err) {
      this.els.status.textContent = `加载失败：${(err as Error).message}`;
    }
  }

  private refreshMarkers() {
    if (!this.terrain) return;
    this.gs.setBall(this.state.ball);
    this.gs.setHole(this.state.hole);
    this.controls?.updateMarkerScreens(this.state.ball, this.state.hole, this.state.verticalScale);
    if (this.state.ball) {
      const s = this.terrain.slopeAt(this.state.ball.x, this.state.ball.y);
      this.els.slope.textContent = s
        ? `球位坡度 ${s.percent.toFixed(1)}%（${s.degrees.toFixed(1)}°），坡向 ${s.aspectDeg.toFixed(0)}°`
        : '';
    }
  }

  /** 拖动事件高频触发：合并到 80ms 内的最后一次，保证 100ms 交互预算。 */
  private scheduleRecompute() {
    clearTimeout(this.recomputeTimer);
    this.recomputeTimer = window.setTimeout(() => this.recompute(), 60);
  }

  private recompute() {
    if (!this.terrain || !this.state.ball || !this.state.hole) return;
    const t0 = performance.now();
    const mu = stimpToFriction(this.state.stimp, { mowHeightMm: this.state.mowMm });
    this.putt = computePuttLines(this.terrain, this.state.ball, this.state.hole, { muGreen: mu });
    this.gs.drawLines(this.putt.lines);
    this.gs.setAimPoint(this.putt.aim.aimPoint);
    const ms = performance.now() - t0;

    const a = this.putt.aim;
    const side = a.offsetSide === 'left' ? '左' : a.offsetSide === 'right' ? '右' : '';
    this.els.info.textContent =
      `重算 ${ms.toFixed(1)}ms｜瞄准偏移 ${(Math.abs(a.offsetM) * 100).toFixed(0)}cm` +
      `${side ? `（${side}侧·${a.offsetIsUphill ? '偏高处' : '偏低处'}）` : '（直推）'}` +
      `｜中力度${a.holed ? '入洞' : `残差 ${a.residual.toFixed(2)}m`}`;
  }

  private screenshot() {
    if (!this.terrain) return;
    this.gs.render();
    const url = this.gs.screenshot();
    const canvas = this.gs.renderer.domElement;
    const final = composeLegend(
      url,
      canvas.width,
      canvas.height,
      {
        title: '三维果岭坡度图',
        stimp: this.state.stimp,
        mowMm: this.state.mowMm,
        timeLabel: this.formatHour(this.state.hour),
        aimOffsetM: this.putt ? this.putt.aim.offsetM : null,
        aimSide: this.putt?.aim.offsetSide ?? 'none',
        uphill: this.putt?.aim.offsetIsUphill ?? false,
        ballSlopePercent: this.state.ball
          ? this.terrain.slopeAt(this.state.ball.x, this.state.ball.y)?.percent ?? null
          : null,
        scaleMeters: 5,
      },
    );
    const a = document.createElement('a');
    a.href = final;
    a.download = `green-${Date.now()}.png`;
    a.click();
  }

  private formatHour(h: number) {
    const hh = Math.floor(h).toString().padStart(2, '0');
    const mm = Math.round((h % 1) * 60).toString().padStart(2, '0');
    return `${hh}:${mm}`;
  }

  private loop = () => {
    this.controls?.update();
    this.gs.render();
    requestAnimationFrame(this.loop);
  };
}
