/**
 * 2D overlay for text labels and symbols, drawn on a canvas above the WebGL
 * view. Labels are placed by priority with simple collision avoidance so the
 * sky stays readable at every zoom level.
 */

export interface Label {
  x: number;
  y: number;
  text: string;
  color: string;
  priority: number;
  font?: string;
  /** Offset from the anchor (px). */
  dx?: number;
  dy?: number;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  /** Letter spacing in px (constellation names). */
  spacing?: number;
  alpha?: number;
  /** Draw even if it collides. */
  force?: boolean;
  shadow?: boolean;
}

export type SymbolKind = 'circle' | 'dashed-circle' | 'ellipse' | 'square' | 'diamond' | 'cross' | 'plus' | 'radiant' | 'reticle' | 'ring';

export interface SkySymbol {
  x: number;
  y: number;
  kind: SymbolKind;
  size: number;
  color: string;
  alpha?: number;
  angle?: number;
  aspect?: number;
  lineWidth?: number;
}

export const FONT_STACK = `"Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

export class Overlay {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private labels: Label[] = [];
  private symbols: SkySymbol[] = [];
  private paths: { pts: [number, number][]; color: string; width: number; dash?: number[]; alpha?: number }[] = [];
  private dpr = 1;
  private w = 0;
  private h = 0;
  nightVision = false;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'overlay-canvas';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  resize(w: number, h: number, dpr: number): void {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  begin(): void {
    this.labels.length = 0;
    this.symbols.length = 0;
    this.paths.length = 0;
  }

  label(l: Label): void {
    this.labels.push(l);
  }

  symbol(s: SkySymbol): void {
    this.symbols.push(s);
  }

  path(pts: [number, number][], color: string, width = 1.5, dash?: number[], alpha = 1): void {
    this.paths.push({ pts, color, width, dash, alpha });
  }

  private tint(color: string): string {
    return this.nightVision ? '#ff3b30' : color;
  }

  draw(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    for (const p of this.paths) {
      if (p.pts.length < 2) continue;
      ctx.save();
      ctx.globalAlpha = p.alpha ?? 1;
      ctx.strokeStyle = this.tint(p.color);
      ctx.lineWidth = p.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (p.dash) ctx.setLineDash(p.dash);
      ctx.beginPath();
      ctx.moveTo(p.pts[0][0], p.pts[0][1]);
      for (let i = 1; i < p.pts.length; i++) {
        const [x, y] = p.pts[i];
        const [px, py] = p.pts[i - 1];
        if (Math.hypot(x - px, y - py) > Math.max(this.w, this.h) * 0.5) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    for (const s of this.symbols) this.drawSymbol(s);

    // Labels by priority with rectangle collision tests.
    const placed: [number, number, number, number][] = [];
    const sorted = this.labels.sort((a, b) => b.priority - a.priority);
    for (const l of sorted) {
      ctx.font = l.font ?? `500 12px ${FONT_STACK}`;
      const spacing = l.spacing ?? 0;
      const text = l.text;
      const tw = ctx.measureText(text).width + spacing * Math.max(0, text.length - 1);
      const fs = parseFloat(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? '12');
      const align = l.align ?? 'left';
      const x = l.x + (l.dx ?? 0);
      const y = l.y + (l.dy ?? 0);
      let x0 = align === 'center' ? x - tw / 2 : align === 'right' ? x - tw : x;
      const y0 = y - fs * 0.8;
      if (x0 + tw < -50 || x0 > this.w + 50 || y < -20 || y > this.h + 20) continue;
      const rect: [number, number, number, number] = [x0 - 2, y0 - 2, x0 + tw + 2, y0 + fs * 1.1 + 2];
      if (!l.force && placed.some((r) => rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1])) continue;
      placed.push(rect);
      ctx.save();
      ctx.globalAlpha = l.alpha ?? 1;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      if (l.shadow !== false) {
        ctx.shadowColor = 'rgba(0,0,0,0.85)';
        ctx.shadowBlur = 4;
      }
      ctx.fillStyle = this.tint(l.color);
      if (spacing) {
        for (const ch of text) {
          ctx.fillText(ch, x0, y);
          x0 += ctx.measureText(ch).width + spacing;
        }
      } else ctx.fillText(text, x0, y);
      ctx.restore();
    }
  }

  private drawSymbol(s: SkySymbol): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = s.alpha ?? 1;
    ctx.strokeStyle = this.tint(s.color);
    ctx.fillStyle = this.tint(s.color);
    ctx.lineWidth = s.lineWidth ?? 1.2;
    ctx.translate(s.x, s.y);
    if (s.angle) ctx.rotate(s.angle);
    const r = s.size;
    ctx.beginPath();
    switch (s.kind) {
      case 'circle':
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'dashed-circle':
        ctx.setLineDash([2.5, 2.5]);
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'ellipse':
        ctx.ellipse(0, 0, r, r * (s.aspect ?? 0.5), 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'square':
        ctx.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
        ctx.stroke();
        break;
      case 'diamond':
        ctx.moveTo(0, -r);
        ctx.lineTo(r, 0);
        ctx.lineTo(0, r);
        ctx.lineTo(-r, 0);
        ctx.closePath();
        ctx.stroke();
        break;
      case 'cross':
        ctx.moveTo(-r, -r);
        ctx.lineTo(r, r);
        ctx.moveTo(r, -r);
        ctx.lineTo(-r, r);
        ctx.stroke();
        break;
      case 'plus':
        ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
        ctx.moveTo(0, -r);
        ctx.lineTo(0, r);
        ctx.moveTo(-r, 0);
        ctx.lineTo(r, 0);
        ctx.stroke();
        break;
      case 'radiant': {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          ctx.moveTo(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45);
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.stroke();
        break;
      }
      case 'reticle': {
        const g = r * 0.35;
        ctx.lineWidth = s.lineWidth ?? 1.6;
        for (let i = 0; i < 4; i++) {
          ctx.save();
          ctx.rotate((i * Math.PI) / 2);
          ctx.moveTo(-r, -r + g);
          ctx.lineTo(-r, -r);
          ctx.lineTo(-r + g, -r);
          ctx.restore();
        }
        ctx.stroke();
        break;
      }
      case 'ring':
        ctx.lineWidth = s.lineWidth ?? 2;
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        break;
    }
    ctx.restore();
  }
}
