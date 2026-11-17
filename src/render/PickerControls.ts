import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { GreenScene } from './GreenScene.ts';
import type { Terrain } from '../lib/terrain.ts';

export type DragTarget = 'ball' | 'hole';

/**
 * 触屏/鼠标交互：
 *  - 单指按在标记上 → 拖动球位或洞位（贴地），回调节流到动画帧；
 *  - 单指空白处 / 双指 → OrbitControls 旋转视角；
 *  - 滚轮 / 双指捏合 → 缩放。
 */
export class PickerControls {
  private controls: OrbitControls;
  private dragging: DragTarget | null = null;
  private activePointers = new Map<number, { x: number; y: number }>();
  private pendingMove: { x: number; y: number } | null = null;
  private rafQueued = false;

  constructor(
    private readonly gs: GreenScene,
    private readonly terrain: Terrain,
    private readonly el: HTMLCanvasElement,
    private readonly onMove: (target: DragTarget, p: { x: number; y: number }) => void,
  ) {
    this.controls = new OrbitControls(gs.camera, el);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2.15;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 80;

    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.handleDown);
    el.addEventListener('pointermove', this.handleMove);
    el.addEventListener('pointerup', this.handleUp);
    el.addEventListener('pointercancel', this.handleUp);
  }

  /** 标记屏幕半径（px），命中判定用。 */
  private markerRadius = 34;
  private ballScreen: { x: number; y: number } | null = null;
  private holeScreen: { x: number; y: number } | null = null;

  updateMarkerScreens(ball: { x: number; y: number } | null, hole: { x: number; y: number } | null, scale: number) {
    const project = (p: { x: number; y: number }) => {
      const z = this.terrain.heightAt(p.x, p.y) ?? 0;
      const v = new THREE.Vector3(p.x, z * scale, p.y).project(this.gs.camera);
      const rect = this.el.getBoundingClientRect();
      return {
        x: ((v.x + 1) / 2) * rect.width,
        y: ((1 - v.y) / 2) * rect.height,
      };
    };
    this.ballScreen = ball ? project(ball) : null;
    this.holeScreen = hole ? project(hole) : null;
  }

  private hitMarker(x: number, y: number): DragTarget | null {
    const rect = this.el.getBoundingClientRect();
    const px = x - rect.left;
    const py = y - rect.top;
    const near = (s: { x: number; y: number } | null) =>
      s !== null && Math.hypot(s.x - px, s.y - py) <= this.markerRadius;
    if (near(this.ballScreen)) return 'ball';
    if (near(this.holeScreen)) return 'hole';
    return null;
  }

  private handleDown = (e: PointerEvent) => {
    this.el.setPointerCapture(e.pointerId);
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.activePointers.size === 1) {
      const target = this.hitMarker(e.clientX, e.clientY);
      if (target) {
        this.dragging = target;
        this.controls.enabled = false;
      }
    } else {
      this.dragging = null;
      this.controls.enabled = true;
    }
  };

  private handleMove = (e: PointerEvent) => {
    const known = this.activePointers.get(e.pointerId);
    if (known) this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!this.dragging || this.activePointers.size > 1) return;
    const p = this.gs.pickGround(e.clientX, e.clientY, this.el);
    if (!p) return;
    if (this.terrain.locate(p.x, p.y) === null) return; // 不允许拖出果岭
    this.pendingMove = p;
    if (!this.rafQueued) {
      this.rafQueued = true;
      requestAnimationFrame(() => {
        this.rafQueued = false;
        if (this.dragging && this.pendingMove) {
          this.onMove(this.dragging, this.pendingMove);
        }
      });
    }
  };

  private handleUp = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId);
    if (this.activePointers.size === 0) {
      this.dragging = null;
      this.controls.enabled = true;
    }
  };

  update() {
    this.controls.update();
  }

  dispose() {
    this.el.removeEventListener('pointerdown', this.handleDown);
    this.el.removeEventListener('pointermove', this.handleMove);
    this.el.removeEventListener('pointerup', this.handleUp);
    this.el.removeEventListener('pointercancel', this.handleUp);
    this.controls.dispose();
  }
}
