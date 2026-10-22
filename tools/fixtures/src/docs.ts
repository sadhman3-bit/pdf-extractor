// Layouts for every synthetic fixture. All companies and people are fictional.
// Mobile numbers come from ACMA's range reserved for fiction (0491 570 xxx);
// landlines use the fictional (02) 5550 xxxx range.
import { PageBuilder, type Metrics, type PageLayout, rng } from './layout';

export const money = (n: number) =>
  n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const dmy = (d: number, m: number, y = 2026) => `${pad(d)}/${pad(m)}/${y}`;

/** A random ABN that passes the checksum (fictional; never looked up). */
export function makeAbn(seed: number): string {
  const r = rng(seed);
  const W = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  for (;;) {
    const d = Array.from({ length: 11 }, (_, i) =>
      i === 0 ? 1 + Math.floor(r() * 9) : Math.floor(r() * 10),
    );
    const sum = d.reduce((s, v, i) => s + (i === 0 ? v - 1 : v) * W[i]!, 0);
    if (sum % 89 === 0) {
      const s = d.join('');
      return `${s.slice(0, 2)} ${s.slice(2, 5)} ${s.slice(5, 8)} ${s.slice(8)}`;
    }
  }
}

export const ABN = {
  northline: makeAbn(101),
  coastal: makeAbn(202),
  apex: makeAbn(303),
  ridgeway: makeAbn(404),
  harbourside: makeAbn(505),
};

function footer(p: PageBuilder, left: string, n: number, total: number) {
  p.text(50, 812, left, 8);
  p.right(545, 812, `Page ${n} of ${total}`, 8);
}

// ---------------------------------------------------------------- Northline

export interface FuelRow {
  date: string;
  card: string;
  site: string;
  product: string;
  litres: number;
  amount: number;
  /** What is printed, when it differs from the true amount (scanned misprint). */
  printed?: string;
  smudge?: boolean;
}

export interface NorthlineSpec {
  statementNo: string;
  statementDate: string;
  accountNo: string;
  period: string;
  dueDate: string;
  rows: FuelRow[];
  layout: 'current' | 'old';
}

export function northlineTotals(spec: NorthlineSpec) {
  const total = r2(spec.rows.reduce((s, r) => s + r.amount, 0));
  return { total, gst: r2(total / 11) };
}

export function northlinePages(m: Metrics, spec: NorthlineSpec): PageLayout[] {
  const { total, gst } = northlineTotals(spec);
  const p = new PageBuilder(m);
  p.text(50, 62, 'NORTHLINE FUEL', 20, 'bold');
  p.text(50, 80, 'Fuel card statement', 12);
  p.text(50, 96, `Northline Fuel Pty Ltd   ABN ${ABN.northline}`, 8);
  p.text(50, 108, 'PO Box 410, Ryde NSW 1680', 8);

  const L = 340;
  const V = 440;
  p.text(L, 62, 'Statement No:', 10).text(V, 62, spec.statementNo, 10);
  p.text(L, 78, 'Statement Date:', 10).text(V, 78, spec.statementDate, 10);
  p.text(L, 94, 'Account No:', 10).text(V, 94, spec.accountNo, 10);
  p.text(L, 110, 'Period:', 10).text(V, 110, spec.period, 10);

  p.text(50, 150, 'Account holder', 10, 'bold');
  p.text(50, 164, 'Brightwater Logistics Pty Ltd', 10);
  p.text(50, 177, '88 Harbour Street, Wollongong NSW 2500', 10);

  p.text(L, 150, 'Summary', 10, 'bold');
  if (spec.layout === 'current') {
    p.text(L, 168, 'Total GST:', 10).right(545, 168, `$${money(gst)}`, 10);
    p.text(L, 184, 'Total Due:', 10, 'bold').right(545, 184, `$${money(total)}`, 10, 'bold');
    p.text(L, 200, 'Due date:', 10).right(545, 200, spec.dueDate, 10);
  } else {
    p.text(L, 168, 'Amount payable:', 10, 'bold').right(545, 168, `$${money(total)}`, 10, 'bold');
    p.text(L, 184, 'GST included:', 10).right(545, 184, `$${money(gst)}`, 10);
    p.text(L, 200, 'Pay by:', 10).right(545, 200, spec.dueDate, 10);
  }

  p.text(50, 240, 'Transactions', 12, 'bold');
  const H = 262;
  p.text(50, H, 'Date', 9, 'bold');
  p.text(120, H, 'Card', 9, 'bold');
  p.text(190, H, 'Site', 9, 'bold');
  p.text(300, H, 'Product', 9, 'bold');
  p.right(450, H, 'Litres', 9, 'bold');
  p.right(545, H, 'Amount', 9, 'bold');
  p.rule(50, 545, H + 5);
  let y = H + 18;
  for (const r of spec.rows) {
    p.text(50, y, r.date, 9);
    p.text(120, y, r.card, 9);
    p.text(190, y, r.site, 9);
    p.text(300, y, r.product, 9);
    p.right(450, y, r.litres.toFixed(2), 9);
    p.right(545, y, r.printed ?? money(r.amount), 9, 'regular', r.smudge ?? false);
    y += 16;
  }
  p.rule(50, 545, y - 10);
  p.text(300, y + 2, 'Subtotal', 9, 'bold').right(545, y + 2, money(total), 9, 'bold');
  p.text(
    50,
    y + 40,
    'Thank you for fuelling with Northline. Payment is due by the due date shown above.',
    9,
  );
  footer(p, `Northline Fuel · Fuel card statement ${spec.statementNo}`, 1, 2);

  const q = new PageBuilder(m);
  q.text(50, 62, 'Important information', 12, 'bold');
  const info = [
    'Report lost or stolen cards straight away so we can cancel them.',
    'Prices include GST. A tax invoice is available for every transaction on request.',
    'Disputed transactions must be raised within 30 days of the statement date.',
    'This statement was produced for fixture testing and describes no real account.',
  ];
  info.forEach((t, i) => q.text(50, 90 + i * 16, t, 10));
  footer(q, `Northline Fuel · Fuel card statement ${spec.statementNo}`, 2, 2);
  return [p.build(), q.build()];
}

const SITES = [
  'Ryde',
  'Parramatta',
  'Chatswood',
  'Hornsby',
  'Penrith',
  'Liverpool',
  'Gosford',
  'Blacktown',
];
const PRODUCTS = ['Diesel', 'Unleaded 91', 'Premium 98'];

function fuelRows(seed: number, month: number, card: string, n: number): FuelRow[] {
  const r = rng(seed);
  const days = Array.from({ length: n }, () => 1 + Math.floor(r() * 28)).sort((a, b) => a - b);
  return days.map((d) => {
    const litres = r2(25 + r() * 55);
    const product = PRODUCTS[Math.floor(r() * PRODUCTS.length)]!;
    const price = product === 'Diesel' ? 1.889 : product === 'Unleaded 91' ? 1.759 : 2.059;
    return {
      date: dmy(d, month),
      card,
      site: SITES[Math.floor(r() * SITES.length)]!,
      product,
      litres,
      amount: r2(litres * price),
    };
  });
}

/** September: the reference statement. Amounts total $424.18 (GST $38.56). */
export const NORTHLINE_SEP_ROWS: FuelRow[] = [
  {
    date: '03/09/2026',
    card: '•• 0021',
    site: 'Ryde',
    product: 'Diesel',
    litres: 52.1,
    amount: 98.45,
  },
  {
    date: '08/09/2026',
    card: '•• 0021',
    site: 'Parramatta',
    product: 'Unleaded 91',
    litres: 34.79,
    amount: 61.2,
  },
  {
    date: '12/09/2026',
    card: '•• 0021',
    site: 'Chatswood',
    product: 'Diesel',
    litres: 39.89,
    amount: 75.36,
  },
  {
    date: '17/09/2026',
    card: '•• 0021',
    site: 'Hornsby',
    product: 'Premium 98',
    litres: 21.04,
    amount: 43.32,
  },
  {
    date: '23/09/2026',
    card: '•• 0021',
    site: 'Ryde',
    product: 'Diesel',
    litres: 46.67,
    amount: 88.15,
  },
  {
    date: '28/09/2026',
    card: '•• 0021',
    site: 'Penrith',
    product: 'Unleaded 91',
    litres: 32.8,
    amount: 57.7,
  },
];

export const NORTHLINE: Record<string, NorthlineSpec> = {
  sep26: {
    statementNo: 'ST-48213',
    statementDate: '30/09/2026',
    accountNo: 'NL-7731-0021',
    period: '01/09/2026 – 30/09/2026',
    dueDate: '21/10/2026',
    rows: NORTHLINE_SEP_ROWS,
    layout: 'current',
  },
  jun26: {
    statementNo: 'ST-46102',
    statementDate: '30/06/2026',
    accountNo: 'NL-7731-0021',
    period: '01/06/2026 – 30/06/2026',
    dueDate: '21/07/2026',
    rows: fuelRows(606, 6, '•• 0021', 5),
    layout: 'old',
  },
  jul26: {
    statementNo: 'ST-46811',
    statementDate: '31/07/2026',
    accountNo: 'NL-7731-0021',
    period: '01/07/2026 – 31/07/2026',
    dueDate: '21/08/2026',
    rows: fuelRows(707, 7, '•• 0021', 7),
    layout: 'current',
  },
  aug26: {
    statementNo: 'ST-47530',
    statementDate: '31/08/2026',
    accountNo: 'NL-7731-0021',
    period: '01/08/2026 – 31/08/2026',
    dueDate: '21/09/2026',
    rows: fuelRows(808, 8, '•• 0021', 6),
    layout: 'current',
  },
  /** Card 2, scanned. Row 4 is really $43.32 but the scan shows a smudged "34.32". */
  sep26card2: {
    statementNo: 'ST-48214',
    statementDate: '30/09/2026',
    accountNo: 'NL-7731-0034',
    period: '01/09/2026 – 30/09/2026',
    dueDate: '21/10/2026',
    rows: NORTHLINE_SEP_ROWS.map((r, i) => ({
      ...r,
      card: '•• 0034',
      ...(i === 3 ? { printed: '34.32', smudge: true } : {}),
    })),
    layout: 'current',
  },
};

// ---------------------------------------------------------------- Coastal Telco

export interface CallRow {
  service: string;
  date: string;
  time: string;
  number: string;
  description: string;
  wrap?: string;
  duration: string;
  amount: number;
}

const SERVICES = ['0491 570 156', '0491 570 157', '0491 570 158'];
const CALLED = [
  '0491 570 159',
  '0491 570 110',
  '0491 570 313',
  '0491 570 737',
  '02 5550 1234',
  '02 5550 4410',
  '02 5550 8812',
];
const DESCS: [string, string?][] = [
  ['Mobile call'],
  ['National call'],
  ['Mobile call – national', 'roaming partner network'],
  ['Call to voicemail'],
  ['Video call'],
  ['Mobile call – after', 'hours business line'],
];

export const COASTAL = {
  accountNo: '4471 2093',
  invoiceNo: 'CT-2026-09-118',
  billDate: '02/10/2026',
  dueDate: '23/10/2026',
  pages: 14,
  linesPerPage: 44,
};

/** Builds the call list and paginates it so the bill has exactly 14 pages. */
export function coastalCalls(): {
  calls: CallRow[];
  pages: { kind: 'group' | 'call' | 'wrap'; call?: CallRow; service?: string }[][];
} {
  const r = rng(1414);
  const pages: { kind: 'group' | 'call' | 'wrap'; call?: CallRow; service?: string }[][] = [];
  const calls: CallRow[] = [];
  const callPages = COASTAL.pages - 1;
  const lastPageLines = 18;
  let serviceIdx = 0;
  let current: string | null = null;
  let day = 1;
  let minute = 8 * 60;
  for (let pg = 0; pg < callPages; pg++) {
    const cap = pg === callPages - 1 ? lastPageLines : COASTAL.linesPerPage;
    const lines: (typeof pages)[number] = [];
    while (lines.length < cap) {
      // Move to the next service at fixed points.
      const want =
        SERVICES[
          Math.min(
            SERVICES.length - 1,
            Math.floor((pg * COASTAL.linesPerPage + lines.length) / 190),
          )
        ]!;
      if (want !== current) {
        if (lines.length + 2 > cap) break;
        current = want;
        serviceIdx++;
        lines.push({ kind: 'group', service: current });
        continue;
      }
      const [desc, wrap] = DESCS[Math.floor(r() * DESCS.length)]!;
      const need = wrap ? 2 : 1;
      if (lines.length + need > cap) break;
      minute += 7 + Math.floor(r() * 90);
      if (minute > 20 * 60) {
        minute = 8 * 60 + Math.floor(r() * 30);
        day = Math.min(30, day + 1);
      }
      const secs = 10 + Math.floor(r() * 900);
      const call: CallRow = {
        service: current,
        date: dmy(day, 9),
        time: `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`,
        number: CALLED[Math.floor(r() * CALLED.length)]!,
        description: desc,
        duration: `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`,
        amount: r2(Math.round((0.1 + (secs / 60) * 0.18 + (wrap ? 0.6 : 0)) * 100) / 100),
      };
      if (wrap) call.wrap = wrap;
      calls.push(call);
      lines.push({ kind: 'call', call });
      if (wrap) lines.push({ kind: 'wrap', call });
    }
    pages.push(lines);
  }
  void serviceIdx;
  return { calls, pages };
}

export function coastalPages(m: Metrics): PageLayout[] {
  const { calls, pages } = coastalCalls();
  const total = r2(calls.reduce((s, c) => s + c.amount, 0));
  const gst = r2(total / 11);
  const out: PageLayout[] = [];
  const running = `Coastal Telco · Account ${COASTAL.accountNo} · Invoice ${COASTAL.invoiceNo}`;

  const p = new PageBuilder(m);
  p.text(50, 62, 'COASTAL TELCO', 20, 'bold');
  p.text(50, 80, 'Tax invoice', 12);
  p.text(50, 96, `Coastal Telco Pty Ltd   ABN ${ABN.coastal}`, 8);
  const L = 340;
  const V = 440;
  p.text(L, 62, 'Account No:', 10).text(V, 62, COASTAL.accountNo, 10);
  p.text(L, 78, 'Invoice No:', 10).text(V, 78, COASTAL.invoiceNo, 10);
  p.text(L, 94, 'Bill Date:', 10).text(V, 94, COASTAL.billDate, 10);
  p.text(L, 110, 'Due Date:', 10).text(V, 110, COASTAL.dueDate, 10);
  p.text(50, 150, 'Customer', 10, 'bold');
  p.text(50, 164, 'Brightwater Logistics Pty Ltd', 10);
  p.text(L, 150, 'Your bill', 10, 'bold');
  p.text(L, 168, 'Call charges:', 10).right(545, 168, `$${money(total)}`, 10);
  p.text(L, 184, 'Total GST:', 10).right(545, 184, `$${money(gst)}`, 10);
  p.text(L, 200, 'Total Due:', 10, 'bold').right(545, 200, `$${money(total)}`, 10, 'bold');
  p.text(50, 240, `Services on this account: ${SERVICES.join(', ')}`, 9);
  p.text(50, 256, 'Your calls are listed on the following pages, grouped by service.', 9);
  footer(p, running, 1, COASTAL.pages);
  out.push(p.build());

  pages.forEach((lines, i) => {
    const q = new PageBuilder(m);
    q.text(50, 30, running, 8);
    q.text(50, 60, 'Call details', 12, 'bold');
    const H = 80;
    q.text(50, H, 'Date', 9, 'bold');
    q.text(110, H, 'Time', 9, 'bold');
    q.text(160, H, 'Number', 9, 'bold');
    q.text(260, H, 'Description', 9, 'bold');
    q.right(470, H, 'Duration', 9, 'bold');
    q.right(545, H, 'Amount', 9, 'bold');
    q.rule(50, 545, H + 5);
    let y = H + 18;
    let pageSum = 0;
    for (const line of lines) {
      if (line.kind === 'group') {
        q.text(50, y, `Service ${line.service}`, 9, 'bold');
      } else if (line.kind === 'call') {
        const c = line.call!;
        q.text(50, y, c.date, 9);
        q.text(110, y, c.time, 9);
        q.text(160, y, c.number, 9);
        q.text(260, y, c.description, 9);
        q.right(470, y, c.duration, 9);
        q.right(545, y, money(c.amount), 9);
        pageSum += c.amount;
      } else {
        q.text(260, y, line.call!.wrap!, 9);
      }
      y += 15;
    }
    q.rule(50, 545, y - 9);
    q.text(50, y + 2, 'Subtotal for this page', 9, 'bold').right(
      545,
      y + 2,
      money(r2(pageSum)),
      9,
      'bold',
    );
    if (i === pages.length - 1) {
      q.text(50, y + 30, `Total calls (${calls.length})`, 9, 'bold').right(
        545,
        y + 30,
        money(total),
        9,
        'bold',
      );
      q.text(50, y + 46, 'GST included in call charges', 9).right(545, y + 46, money(gst), 9);
    }
    footer(q, running, i + 2, COASTAL.pages);
    out.push(q.build());
  });
  return out;
}

// ---------------------------------------------------------------- Apex Fleet

export interface ApexRow {
  date: string;
  docket: string;
  vehicle: string;
  description: string;
  qty: string;
  amount: number;
}

export function apexRows(): ApexRow[] {
  const r = rng(4141);
  const items: [string, number, number][] = [
    ['Diesel – bulk', 120, 380],
    ['Service – 15,000 km', 280, 520],
    ['Tyre rotation', 60, 95],
    ['Wheel alignment', 89, 140],
    ['Brake pads – front', 180, 310],
    ['Windscreen repair', 70, 120],
  ];
  const rows: ApexRow[] = [];
  for (let i = 0; i < 41; i++) {
    const credit = i % 9 === 4;
    const [desc, lo, hi] = items[Math.floor(r() * items.length)]!;
    const amount = credit ? -r2(5 + r() * 40) : r2(lo + r() * (hi - lo));
    rows.push({
      date: dmy(1 + Math.floor((i * 29) / 41), 9),
      docket: `D-${40100 + i * 7}`,
      vehicle: `AFS ${pad(100 + Math.floor(r() * 40), 3)}`,
      description: credit ? 'Credit – price adjustment' : desc,
      qty: credit ? '1' : String(1 + Math.floor(r() * 3)),
      amount,
    });
  }
  return rows;
}

export const APEX = {
  invoiceNo: 'AFS-30917',
  invoiceDate: '30/09/2026',
  accountNo: 'BW-0882',
  poNumber: 'PO-77120',
  split: [16, 17, 8],
};

const apexAmount = (n: number) => (n < 0 ? `${money(-n)} CR` : money(n));

export function apexPages(m: Metrics): PageLayout[] {
  const rows = apexRows();
  const total = r2(rows.reduce((s, x) => s + x.amount, 0));
  const gst = r2(total / 11);
  const out: PageLayout[] = [];
  let k = 0;
  APEX.split.forEach((count, pi) => {
    const p = new PageBuilder(m);
    let y: number;
    if (pi === 0) {
      p.text(50, 62, 'APEX FLEET SERVICES', 20, 'bold');
      p.text(50, 80, 'Tax invoice', 12);
      p.text(50, 96, `Apex Fleet Services Pty Ltd   ABN ${ABN.apex}`, 8);
      const L = 340;
      const V = 440;
      p.text(L, 62, 'Invoice No:', 10).text(V, 62, APEX.invoiceNo, 10);
      p.text(L, 78, 'Invoice Date:', 10).text(V, 78, APEX.invoiceDate, 10);
      p.text(L, 94, 'Account No:', 10).text(V, 94, APEX.accountNo, 10);
      p.text(L, 110, 'PO Number:', 10).text(V, 110, APEX.poNumber, 10);
      p.text(50, 140, 'Bill to', 10, 'bold');
      p.text(50, 154, 'Brightwater Logistics Pty Ltd', 10);
      const H = 200;
      p.text(50, H, 'Date', 9, 'bold');
      p.text(115, H, 'Docket', 9, 'bold');
      p.text(175, H, 'Vehicle', 9, 'bold');
      p.text(245, H, 'Description', 9, 'bold');
      p.right(440, H, 'Qty', 9, 'bold');
      p.right(545, H, 'Amount', 9, 'bold');
      p.rule(50, 545, H + 5);
      y = H + 20;
    } else {
      p.text(50, 30, `Apex Fleet Services · Invoice ${APEX.invoiceNo} (continued)`, 8);
      y = 90;
    }
    for (let i = 0; i < count; i++, k++) {
      const row = rows[k]!;
      p.text(50, y, row.date, 9);
      p.text(115, y, row.docket, 9);
      p.text(175, y, row.vehicle, 9);
      p.text(245, y, row.description, 9);
      p.right(440, y, row.qty, 9);
      p.right(545, y, apexAmount(row.amount), 9);
      y += 20;
    }
    if (pi === APEX.split.length - 1) {
      p.rule(245, 545, y - 12);
      p.text(245, y + 4, 'Invoice total', 9, 'bold').right(545, y + 4, money(total), 9, 'bold');
      p.text(340, y + 40, 'Total GST:', 10).right(545, y + 40, `$${money(gst)}`, 10);
      p.text(340, y + 56, 'Total Due:', 10, 'bold').right(
        545,
        y + 56,
        `$${money(total)}`,
        10,
        'bold',
      );
      p.text(50, y + 90, 'Credits are shown as CR and reduce the amount due.', 9);
    } else {
      p.text(50, 790, 'Continued over page', 8);
    }
    footer(p, `Apex Fleet Services · ${APEX.invoiceNo}`, pi + 1, APEX.split.length);
    out.push(p.build());
  });
  return out;
}

// ---------------------------------------------------------------- Ridgeway (no template)

export const RIDGEWAY_ITEMS: [string, number, number][] = [
  ['Carton 400 x 300 x 300', 200, 1.85],
  ['Stretch wrap 500 mm', 12, 18.5],
  ['Pallet labels (roll)', 6, 22.4],
  ['Void fill paper', 4, 39.9],
  ['Packing tape 48 mm', 36, 3.1],
];

export function ridgewayPages(m: Metrics): PageLayout[] {
  const p = new PageBuilder(m);
  p.text(50, 62, 'RIDGEWAY PACKAGING', 20, 'bold');
  p.text(50, 80, 'Tax invoice', 12);
  p.text(50, 96, `Ridgeway Packaging Co.   ABN ${ABN.ridgeway}`, 8);
  const L = 340;
  const V = 440;
  p.text(L, 62, 'Invoice No:', 10).text(V, 62, '88231', 10);
  p.text(L, 78, 'Invoice Date:', 10).text(V, 78, '15/09/2026', 10);
  p.text(L, 94, 'PO Number:', 10).text(V, 94, 'PO-66104', 10);
  p.text(L, 110, 'Due Date:', 10).text(V, 110, '15/10/2026', 10);
  p.text(50, 150, 'Invoice to', 10, 'bold');
  p.text(50, 164, 'Brightwater Logistics Pty Ltd', 10);
  const H = 220;
  p.text(50, H, 'Description', 9, 'bold');
  p.right(380, H, 'Qty', 9, 'bold');
  p.right(460, H, 'Unit price', 9, 'bold');
  p.right(545, H, 'Amount', 9, 'bold');
  p.rule(50, 545, H + 5);
  let y = H + 18;
  let sub = 0;
  for (const [d, q, u] of RIDGEWAY_ITEMS) {
    const amt = r2(q * u);
    sub = r2(sub + amt);
    p.text(50, y, d, 9)
      .right(380, y, String(q), 9)
      .right(460, y, money(u), 9)
      .right(545, y, money(amt), 9);
    y += 16;
  }
  const gst = r2(sub * 0.1);
  const total = r2(sub + gst);
  p.rule(340, 545, y - 8);
  p.text(340, y + 8, 'Subtotal:', 10).right(545, y + 8, `$${money(sub)}`, 10);
  p.text(340, y + 24, 'GST:', 10).right(545, y + 24, `$${money(gst)}`, 10);
  p.text(340, y + 40, 'Total Due:', 10, 'bold').right(545, y + 40, `$${money(total)}`, 10, 'bold');
  footer(p, 'Ridgeway Packaging · Invoice 88231', 1, 1);
  return [p.build()];
}

// ---------------------------------------------------------------- Harbourside COA

export interface CoaRow {
  test: string;
  method: string;
  methodWrap?: string;
  spec: string;
  result: string;
  unit: string;
}

export const COA_ROWS: CoaRow[] = [
  { test: 'Appearance', method: 'Visual', spec: 'White powder', result: 'Conforms', unit: '' },
  {
    test: 'Identification',
    method: 'IR spectroscopy',
    spec: 'Conforms',
    result: 'Conforms',
    unit: '',
  },
  { test: 'Assay', method: 'Titration', spec: '99.5 – 100.5', result: '99.84', unit: '%' },
  {
    test: 'Water',
    method: 'Karl Fischer',
    methodWrap: 'titration',
    spec: '≤ 0.5',
    result: '0.12',
    unit: '%',
  },
  { test: 'Sulfated ash', method: 'Ph. Eur. 2.4.14', spec: '≤ 0.05', result: '0.01', unit: '%' },
  {
    test: 'Heavy metals',
    method: 'Inductively coupled',
    methodWrap: 'plasma (ICP-MS)',
    spec: '≤ 1',
    result: '0.3',
    unit: 'mg/kg',
  },
  {
    test: 'Oxalate',
    method: 'Ion',
    methodWrap: 'chromatography',
    spec: '≤ 100',
    result: '35',
    unit: 'mg/kg',
  },
  {
    test: 'Particle size',
    method: 'Laser diffraction',
    spec: '0.5 – 1.2',
    result: '0.84',
    unit: 'mm',
  },
];

export const COA = {
  product: 'Citric Acid Anhydrous',
  productCode: 'HC-2391',
  lot: 'A2391-07',
  mfg: '14/08/2026',
  exp: '14/08/2028',
  po: 'PO-55102',
};

export function coaPages(m: Metrics): PageLayout[] {
  const p = new PageBuilder(m);
  p.text(50, 62, 'HARBOURSIDE CHEMICALS', 20, 'bold');
  p.text(50, 80, 'Certificate of Analysis', 12);
  p.text(50, 96, `Harbourside Chemicals Pty Ltd   ABN ${ABN.harbourside}`, 8);
  const L = 50;
  const V = 170;
  const fields: [string, string][] = [
    ['Product:', COA.product],
    ['Product Code:', COA.productCode],
    ['Batch No:', COA.lot],
    ['Manufacture Date:', COA.mfg],
    ['Expiry Date:', COA.exp],
    ['PO Number:', COA.po],
  ];
  fields.forEach(([l, v], i) => p.text(L, 130 + i * 16, l, 10).text(V, 130 + i * 16, v, 10));
  p.text(360, 130, 'Customer', 10, 'bold');
  p.text(360, 146, 'Brightwater Logistics Pty Ltd', 10);

  const H = 250;
  p.text(50, H, 'Test', 9, 'bold');
  p.text(170, H, 'Method', 9, 'bold');
  p.text(320, H, 'Specification', 9, 'bold');
  p.text(430, H, 'Result', 9, 'bold');
  p.text(500, H, 'Unit', 9, 'bold');
  p.rule(50, 545, H + 5);
  let y = H + 18;
  for (const r of COA_ROWS) {
    p.text(50, y, r.test, 9);
    p.text(170, y, r.method, 9);
    if (r.spec.startsWith('≤')) {
      p.text(320, y, '≤', 9, 'symbol');
      p.text(320 + m.width('≤', 9, 'symbol') + 2.5, y, r.spec.slice(2), 9);
    } else {
      p.text(320, y, r.spec, 9);
    }
    p.text(430, y, r.result, 9);
    p.text(500, y, r.unit, 9);
    y += 15;
    if (r.methodWrap) {
      p.text(170, y, r.methodWrap, 9);
      y += 15;
    }
  }
  p.rule(50, 545, y - 9);
  p.text(50, y + 12, 'Conclusion: The batch conforms to the specification.', 10);
  p.text(50, y + 40, 'Released by: Quality Assurance, Harbourside Chemicals', 9);
  footer(p, `Harbourside Chemicals · COA ${COA.lot}`, 1, 1);
  return [p.build()];
}
