import { PageBuilder, type Metrics } from './layout';
import { makeAbn } from './docs';
const names = [
  'West Depot',
  'Workshop Dispatch',
  '',
  'Shared Customer Support and After-hours Operations',
  'Harbour Office Link',
  'North Logistics',
  'Driver Pool',
  'Warehouse and Inventory Control Desk',
  'East Office',
  'Depot Router',
  'Driver Pool',
  'Regional Operations',
  'Accounts Desk',
  'South Warehouse',
  'Emergency Standby',
  'Central Support',
];
const prefixes = [
  'Telephone',
  'MobileNet',
  'MobileNet',
  'Telephone',
  'Broadband',
  'Telephone',
  'MobileNet',
  'MobileNet',
  'Telephone',
  'DataLink',
  'MobileNet',
  'Telephone',
  'Telephone',
  'MobileNet',
  'Telephone',
  'MobileNet',
];
const nums = [
  '02 5550 0101',
  '0491 570 006',
  '0491 570 007',
  '02 5550 0104',
  '02 5550 0105',
  '02 5550 0106',
  '0491 570 008',
  '0491 570 009',
  '02-5550-0109',
  '3151276601',
  '0491 570 010',
  '02 5550 0112',
  '02 5550 0113',
  '0491 570 011',
  '02 5550 0115',
  '0491 570 012',
];
const ex = [
  45.45, 57.27, 0, 90.91, 2500, -12.5, 57.27, 72.73, 45.45, 120, 57.27, 90.91, 45.45, 57.27, 0, 100,
];
export const businessRows = names.map((Name, i) => ({
  Name,
  PhoneNumber: nums[i],
  ExclGST: ex[i]!,
  InclGST: Math.round(ex[i]! * 110) / 100,
}));
const totalEx = Math.round(ex.reduce((a, b) => a + b, 0) * 100) / 100;
const totalInc = Math.round(businessRows.reduce((a, b) => a + b.InclGST, 0) * 100) / 100;
const money = (n: number) =>
  n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function businessPages(m: Metrics, variant = false) {
  const pages: PageBuilder[] = [];
  const page = (title: string, table = false) => {
    const p = new PageBuilder(m);
    pages.push(p);
    p.text(44, 45, 'SUMMIT BUSINESS CONNECT', 18, 'bold');
    p.text(44, 63, 'Business telecommunications | Tax invoice', 10);
    p.right(552, 44, variant ? 'Invoice SBC-2026-11002' : 'Invoice SBC-2026-10001', 9, 'bold');
    p.right(552, 62, 'Account 4471 2093', 9);
    p.rule(44, 552, 79).text(44, 100, title, 13, 'bold');
    if (table) {
      p.text(44, 124, 'Item', 8, 'bold').text(96, 124, 'Service Summary', 11, 'bold');
      p.right(472, 124, 'Excl GST $', 9, 'bold')
        .right(552, 124, 'Incl GST $', 9, 'bold')
        .rule(44, 552, 132);
    }
    return p;
  };
  const cover = page('Your account at a glance');
  cover
    .text(44, 136, 'Invoice to', 10, 'bold')
    .text(44, 154, 'BRIGHTWATER LOGISTICS PTY LTD', 11, 'bold');
  cover.text(44, 172, '88 Example Way, Wollongong NSW 2500', 10);
  cover.text(44, 190, 'Customer reference: Operations cost centres', 9);
  cover.text(365, 136, 'Issue date', 9).right(552, 136, variant ? '28/11/2026' : '28/10/2026', 9);
  cover.text(365, 154, 'Payment due', 9).right(552, 154, variant ? '12/12/2026' : '12/11/2026', 9);
  cover.text(44, 237, 'Account activity', 13, 'bold').rule(44, 552, 246);
  const summary = [
    ['Previous balance', 3210],
    ['Payment received', -3210],
    ['Balance brought forward', 0],
    ['New service charges excluding GST', totalEx],
    ['GST on new service charges', totalInc - totalEx],
    ['Total amount due', totalInc],
  ] as const;
  summary.forEach(([label, n], i) => {
    cover
      .text(55, 273 + i * 31, label, 11, i === 5 ? 'bold' : 'regular')
      .right(540, 273 + i * 31, `$${money(n)}`, 11, i === 5 ? 'bold' : 'regular');
  });
  cover.rule(44, 552, 447).text(44, 483, '16 business services on this invoice', 12, 'bold');
  cover.text(44, 505, 'Detailed service charges follow. Each service has its own total.', 10);
  cover.text(
    44,
    524,
    'Credits reduce the amount due. A zero total can represent a standby service.',
    10,
  );
  cover
    .text(44, 578, 'Payment information', 12, 'bold')
    .text(44, 600, 'Direct debit: scheduled on the due date shown above.', 10);
  cover.text(
    44,
    620,
    'Reference: SBC-TEST-44712093. Do not make a payment against this sample.',
    9,
  );
  cover
    .text(44, 684, 'Questions about your bill?', 12, 'bold')
    .text(44, 706, 'Contact billing@summitconnect.example and quote your invoice number.', 10);
  cover.text(44, 740, `Supplier ABN ${makeAbn(1107)} (synthetic test data)`, 9);
  const heading = (p: PageBuilder, i: number, y: number) => {
    const wrap =
      i === 3
        ? ['Shared Customer Support', 'and After-hours Operations']
        : i === 7
          ? ['Warehouse and Inventory', 'Control Desk']
          : [names[i]!];
    p.text(96, y, `${prefixes[i]} ${nums[i]}${wrap[0] ? ` ${wrap[0]}` : ''}`, 9, 'bold');
    if (wrap[1]) p.text(96, y + 14, wrap[1], 9, 'bold');
    return y + (wrap[1] ? 28 : 17);
  };
  const total = (p: PageBuilder, i: number, y: number) => {
    const n = nums[i]!.replaceAll('-', ' ');
    p.text(240, y, `Total for ${n}`, 9, 'bold');
    // Credits deliberately use the common CR suffix, while expected values are negative.
    p.right(472, y, ex[i]! < 0 ? `${money(-ex[i]!)}CR` : `$${money(ex[i]!)}`, 9, 'bold');
    p.right(
      552,
      y,
      businessRows[i]!.InclGST < 0
        ? `${money(-businessRows[i]!.InclGST)}CR`
        : `$${money(businessRows[i]!.InclGST)}`,
      9,
      'bold',
    );
  };
  const block = (p: PageBuilder, i: number, y: number, split = false) => {
    let yy = heading(p, i, y);
    p.text(96, yy, ex[i]! < 0 ? 'Other charges and credits' : 'Services and equipment rental', 9);
    yy += 18;
    p.text(44, yy, `SVC${String(i + 1).padStart(3, '0')}`, 8)
      .text(111, yy, '1', 9)
      .text(128, yy, ex[i]! < 0 ? 'Service adjustment credit' : 'Business communications plan', 9);
    yy += 17;
    p.text(128, yy, ex[i]! < 0 ? 'Credit' : 'Rental', 9).text(
      290,
      yy,
      variant ? '28 Oct to 27 Nov' : '28 Sep to 27 Oct',
      8,
    );
    p.right(472, yy, money(ex[i]!), 9).right(552, yy, money(businessRows[i]!.InclGST), 9);
    if (!split) total(p, i, yy + 22);
    else p.text(96, yy + 22, 'Service charges continue on the next page', 8);
  };
  for (let group = 0; group < 3; group++) {
    const p = page(group ? 'Service charges - continued' : 'Service charges', true);
    if (group) total(p, group * 4 - 1, 158);
    else p.text(96, 158, 'BRIGHTWATER LOGISTICS PTY LTD', 9, 'bold');
    for (let k = 0; k < 3; k++) block(p, group * 4 + k, 202 + k * 145);
    block(p, group * 4 + 3, 670, true);
  }
  let p = page('Service charges - continued', true);
  total(p, 11, 158);
  for (let k = 0; k < 4; k++) {
    if (variant && k === 2) p = page('Service charges - final page', true);
    block(p, 12 + k, variant && k >= 2 ? 180 + (k - 2) * 145 : 195 + k * 125);
  }
  p.rule(96, 552, 718)
    .text(96, 740, 'Service summary total', 10, 'bold')
    .right(472, 740, money(totalEx), 10, 'bold')
    .right(552, 740, money(totalInc), 10, 'bold');
  p.text(96, 762, 'End of service summary', 10, 'bold');
  const usage = page('Usage detail - already included in service totals');
  usage
    .text(44, 136, 'Date', 9, 'bold')
    .text(124, 136, 'Service number', 9, 'bold')
    .text(260, 136, 'Description', 9, 'bold')
    .right(552, 136, 'Included value', 9, 'bold')
    .rule(44, 552, 145);
  for (let i = 0; i < 12; i++)
    usage
      .text(44, 170 + i * 29, `${String(i + 1).padStart(2, '0')}/10/2026`, 9)
      .text(124, 170 + i * 29, nums[i]!, 9)
      .text(260, 170 + i * 29, 'National calls and data usage', 9)
      .right(552, 170 + i * 29, '0.00', 9);
  usage.text(44, 573, 'Total for usage detail', 10, 'bold').right(552, 573, '0.00', 10, 'bold');
  usage.text(44, 619, 'This section is supporting detail, not additional invoice charges.', 10);
  usage
    .text(44, 659, 'Terms', 12, 'bold')
    .text(44, 682, 'All amounts are in Australian dollars. GST is included where applicable.', 9);
  usage.text(
    44,
    701,
    'No real account, bank details or customer data are represented in this invoice.',
    9,
  );
  pages.forEach((p, i) => {
    p.rule(44, 552, 791)
      .text(44, 809, 'SYNTHETIC TEST INVOICE - NOT PAYABLE', 7)
      .right(552, 809, `Page ${i + 1} of ${pages.length}`, 8);
  });
  return pages.map((p) => p.build());
}
