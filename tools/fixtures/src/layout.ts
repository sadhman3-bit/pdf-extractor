// A tiny page-layout model shared by the PDF writer (pdf-lib) and the HTML
// renderer used for scanned variants. Coordinates are points, origin top-left,
// `y` is the text baseline.
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont } from 'pdf-lib';

export type FontKey = 'regular' | 'bold' | 'symbol';

export interface TextOp {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  size: number;
  font: FontKey;
  /** Scanned variants only: blur and speckle over this text. */
  smudge?: boolean;
}

export interface RuleOp {
  kind: 'rule';
  x0: number;
  x1: number;
  y: number;
}

export type Op = TextOp | RuleOp;

export interface PageLayout {
  width: number;
  height: number;
  ops: Op[];
}

export const A4 = { width: 595.28, height: 841.89 };

export interface Metrics {
  width(text: string, size: number, font: FontKey): number;
}

export class PageBuilder {
  readonly ops: Op[] = [];
  constructor(
    private readonly m: Metrics,
    readonly width = A4.width,
    readonly height = A4.height,
  ) {}

  text(x: number, y: number, text: string, size = 10, font: FontKey = 'regular', smudge = false) {
    if (text === '') return this;
    const op: TextOp = { kind: 'text', x, y, text, size, font };
    if (smudge) op.smudge = true;
    this.ops.push(op);
    return this;
  }

  /** Right-aligned text ending at xRight. */
  right(
    xRight: number,
    y: number,
    text: string,
    size = 10,
    font: FontKey = 'regular',
    smudge = false,
  ) {
    return this.text(xRight - this.m.width(text, size, font), y, text, size, font, smudge);
  }

  rule(x0: number, x1: number, y: number) {
    this.ops.push({ kind: 'rule', x0, x1, y });
    return this;
  }

  build(): PageLayout {
    return { width: this.width, height: this.height, ops: this.ops };
  }
}

export interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  symbol: PDFFont;
}

export async function newDoc(
  title: string,
): Promise<{ doc: PDFDocument; fonts: Fonts; metrics: Metrics }> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const fixed = new Date('2026-10-01T00:00:00Z');
  doc.setTitle(title);
  doc.setProducer('pdfx fixture generator');
  doc.setCreator('pdfx fixture generator');
  doc.setCreationDate(fixed);
  doc.setModificationDate(fixed);
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    symbol: await doc.embedFont(StandardFonts.Symbol),
  };
  const metrics: Metrics = {
    width: (text, size, font) => fonts[font].widthOfTextAtSize(text, size),
  };
  return { doc, fonts, metrics };
}

/** Draws a layout as real text. `rotate` 90 stores the page landscape with /Rotate 90. */
export function drawPage(doc: PDFDocument, fonts: Fonts, layout: PageLayout, rotate: 0 | 90 = 0) {
  if (rotate === 0) {
    const page = doc.addPage([layout.width, layout.height]);
    for (const op of layout.ops) {
      if (op.kind === 'text') {
        page.drawText(op.text, {
          x: op.x,
          y: layout.height - op.y,
          size: op.size,
          font: fonts[op.font],
          color: rgb(0.08, 0.1, 0.12),
        });
      } else {
        page.drawLine({
          start: { x: op.x0, y: layout.height - op.y },
          end: { x: op.x1, y: layout.height - op.y },
          thickness: 0.6,
          color: rgb(0.6, 0.63, 0.67),
        });
      }
    }
    return;
  }
  // Rotated: media box is landscape; display (dx, dy) maps to user (ux = dy, uy = dx).
  const page = doc.addPage([layout.height, layout.width]);
  page.setRotation(degrees(90));
  for (const op of layout.ops) {
    if (op.kind === 'text') {
      page.drawText(op.text, {
        x: op.y,
        y: op.x,
        size: op.size,
        font: fonts[op.font],
        rotate: degrees(90),
        color: rgb(0.08, 0.1, 0.12),
      });
    } else {
      page.drawLine({
        start: { x: op.y, y: op.x0 },
        end: { x: op.y, y: op.x1 },
        thickness: 0.6,
        color: rgb(0.6, 0.63, 0.67),
      });
    }
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** HTML for rendering a page in Chromium (scanned variants). 1 CSS px = 1 pt. */
export function pageHtml(layout: PageLayout, seed: number, tiltDeg: number): string {
  const spans = layout.ops
    .map((op) => {
      if (op.kind === 'rule') {
        return `<div class="rule" style="left:${op.x0}px;top:${op.y}px;width:${op.x1 - op.x0}px"></div>`;
      }
      const family =
        op.font === 'symbol' ? 'Symbol, "Segoe UI Symbol", serif' : 'Helvetica, Arial, sans-serif';
      const weight = op.font === 'bold' ? 700 : 400;
      const cls = op.smudge ? 't smudge' : 't';
      return `<span class="${cls}" style="left:${op.x}px;top:${op.y - op.size * 0.93}px;font-size:${op.size}px;font-family:${family};font-weight:${weight}">${esc(op.text)}</span>`;
    })
    .join('\n');
  return `<!doctype html><html><head><style>
  html,body{margin:0;padding:0;background:#fff}
  #page{position:relative;width:${layout.width}px;height:${layout.height}px;overflow:hidden;background:#fdfdfb;transform:rotate(${tiltDeg}deg);transform-origin:50% 50%}
  .t{position:absolute;white-space:pre;color:#1a1c20;line-height:1.15}
  .rule{position:absolute;height:0;border-top:0.6px solid #999}
  .smudge{filter:blur(0.5px);color:#55585e}
  canvas{position:absolute;left:0;top:0}
  </style></head><body><div id="page">${spans}<canvas id="noise" width="${Math.round(layout.width * 3)}" height="${Math.round(layout.height * 3)}" style="width:${layout.width}px;height:${layout.height}px"></canvas></div>
  <script>
  (function(){
    let s=${seed >>> 0};
    const r=()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
    const c=document.getElementById('noise').getContext('2d');
    for(let i=0;i<9000;i++){const g=Math.floor(110+r()*120);c.fillStyle='rgba('+g+','+g+','+g+','+(0.25+r()*0.5)+')';c.fillRect(r()*c.canvas.width,r()*c.canvas.height,1+r()*2,1+r()*2);}
    document.querySelectorAll('.smudge').forEach(function(el){
      const b=el.getBoundingClientRect();
      c.fillStyle='rgba(140,140,140,0.36)';c.fillRect((b.left-1)*3,(b.top+b.height*0.3)*3,(b.width+2)*3,b.height*0.5*3);
      for(let i=0;i<190;i++){const g=Math.floor(95+r()*90);c.fillStyle='rgba('+g+','+g+','+g+','+(0.3+r()*0.35)+')';c.fillRect((b.left+r()*b.width)*3,(b.top+r()*b.height)*3,1+r()*2,1+r()*2);}
    });
  })();
  </script></body></html>`;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
