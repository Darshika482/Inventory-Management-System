// Demo data for the promo capture. All names are invented.
import { randomUUID } from 'node:crypto';

let s = 42;
const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const TODAY = new Date('2026-11-05T11:20:00+05:30');
const daysAgo = (d, h = 11, m = 0) => {
  const t = new Date(TODAY);
  t.setDate(t.getDate() - d);
  if (d === 0) t.setUTCHours(2 + (h % 3), m, 0, 0); else t.setUTCHours(Math.max(h - 5, 3), m, 0, 0);
  return t;
};
const iso = (t) => t.toISOString();
const ymd = (t) => new Date(t.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
const stamp = (t) =>
  `${t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Kolkata' })} at ${t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}`;
const money = (n) => (Math.round(n * 100) / 100).toFixed(2);

export function seed() {
  const users = [
    { id: randomUUID(), username: 'rajesh', role: 'Admin', password_hash: 'demo123' },
    { id: randomUUID(), username: 'ayush', role: 'Worker', password_hash: 'demo123' },
    { id: randomUUID(), username: 'mohit', role: 'Worker', password_hash: 'demo123' },
  ];
  const workerIds = users.filter((u) => u.role === 'Worker').map((u) => u.username);

  // ---------- Godown stock ----------
  const godown = [
    ['Cotton Thread 300 mt', 'boxes', 'First Floor', 240, 186],
    ['Polyester Thread 800 mt', 'boxes', 'First Floor', 180, 42],
    ['Saree Fall – Cotton', 'pieces', 'First Floor', 1200, 935],
    ['Saree Fall – Poly', 'pieces', 'First Floor', 900, 612],
    ['Blouse Piece – Plain', 'pieces', 'Second Floor', 600, 418],
    ['Lace Roll – Golden', 'rolls', 'Second Floor', 150, 18],
    ['Lace Roll – Silver', 'rolls', 'Second Floor', 150, 96],
    ['Dori – Silk', 'bundles', 'First Floor', 300, 221],
    ['Buttons – Fancy', 'packets', 'First Floor', 500, 377],
    ['Elastic 1 inch', 'rolls', 'Second Floor', 200, 9],
    ['Zip 9 inch', 'packets', 'First Floor', 400, 288],
    ['Canvas – Stiff', 'metres', 'Second Floor', 1000, 640],
    ['Astar Cotton', 'metres', 'Second Floor', 1500, 1120],
    ['Hooks & Eyes', 'packets', 'First Floor', 350, 31],
    ['Net Fabric', 'metres', 'Second Floor', 800, 455],
    ['Fusing Cloth', 'metres', 'First Floor', 600, 372],
  ];
  const categories = godown.map(([name, unit, floor, initial, current], i) => ({
    id: `cat-${i + 1}`,
    name, unit, floor,
    initial_stock: initial,
    current_quantity: current,
    created_at: iso(daysAgo(70 - i)),
  }));

  const withdrawal_logs = [];
  for (let i = 0; i < 46; i++) {
    const c = pick(categories);
    const t = daysAgo(int(0, 30), int(9, 19), int(0, 59));
    withdrawal_logs.push({
      id: `log-${i}`,
      worker_id: pick(workerIds),
      category_id: c.id,
      category_name: c.name,
      quantity: int(2, 40),
      timestamp: stamp(t),
      status: rnd() < 0.92 ? 'Approved' : 'Rejected',
      created_at: iso(t),
    });
  }
  const stock_additions = [];
  for (let i = 0; i < 24; i++) {
    const c = pick(categories);
    const t = daysAgo(int(0, 40), int(10, 18), int(0, 59));
    stock_additions.push({
      id: `add-${i}`,
      category_id: c.id,
      category_name: c.name,
      quantity: int(20, 200),
      floor: c.floor,
      unit: c.unit,
      type: i < 4 ? 'new' : 'restock',
      timestamp: stamp(t),
      created_at: iso(t),
    });
  }

  // ---------- Party (purchase) bills ----------
  const firms = [
    ['Shree Ganesh Textiles', '23AAKFS4821K1Z3'],
    ['Mahavir Thread House', '27AABCM7710P1ZQ'],
    ['Rajkamal Lace Works', '24AADFR9902L1Z8'],
    ['Om Sai Fabrics', '23AAGPO3311M1Z1'],
    ['Navkar Trims & Accessories', '27AAJCN5521F1ZT'],
  ];
  const transports = ['Shree Balaji Transport', 'Maa Durga Roadways', 'Gati Cargo Movers', 'New Bharat Logistics'];
  const billItems = [
    ['Cotton Thread 300 mt', '5204', 'Box', 330],
    ['Polyester Thread 800 mt', '5401', 'Box', 410],
    ['Saree Fall – Cotton', '5208', 'Piece', 18.5],
    ['Lace Roll – Golden', '5804', 'Roll', 265],
    ['Elastic 1 inch', '5604', 'Roll', 140],
    ['Hooks & Eyes', '8308', 'Packet', 22],
    ['Net Fabric', '6005', 'Meter', 48],
    ['Buttons – Fancy', '9606', 'Packet', 35],
  ];
  const purchase_bills = [];
  const bill_payments = [];
  for (let i = 0; i < 14; i++) {
    const [firm, gst] = firms[i % firms.length];
    const t = daysAgo(3 + i * 4, 12);
    const items = Array.from({ length: int(2, 4) }, () => {
      const [name, hsn, unit, base] = pick(billItems);
      const rate = Math.round(base * (1 + (14 - i) * 0.012) * 100) / 100;
      const quantity = int(10, 120);
      return { name, hsn, quantity, unit, rate, amount: Math.round(quantity * rate * 100) / 100 };
    });
    const gross = items.reduce((a, b) => a + b.amount, 0);
    const discounts = i % 3 === 0 ? [{ name: 'Cash discount', amount: Math.round(gross * 0.02) }] : [];
    const disc = discounts.reduce((a, b) => a + b.amount, 0);
    const gstAmt = Math.round((gross - disc) * 0.05);
    const net = gross - disc + gstAmt;
    const id = `pb-${i}`;
    purchase_bills.push({
      id, firm_name: firm, bill_no: `${['SG', 'MT', 'RL', 'OS', 'NT'][i % 5]}/${1400 + i * 7}`,
      bill_date: ymd(t), gst_number: gst, lr_no: `LR${88100 + i * 13}`, transport_name: pick(transports),
      items, gross_amount: gross, discounts, discount: disc, gst_amount: gstAmt, net_amount: net,
      photo_url: null, created_at: iso(t),
    });
    if (i > 2) {
      const full = i % 4 !== 1;
      bill_payments.push({
        id: `bp-${i}`, bill_id: id, paid_on: ymd(daysAgo(1 + i * 3)),
        amount: full ? net : Math.round(net / 2), method: pick(['Cheque', 'Bank transfer', 'UPI', 'Cash']),
        reference: `${int(100000, 999999)}`, bank_name: pick(['SBI', 'PNB', 'HDFC Bank']), photo_url: null,
        group_id: null, created_at: iso(daysAgo(1 + i * 3)),
      });
    }
  }

  const transport_bills = [];
  const transport_payments = [];
  for (let i = 0; i < 10; i++) {
    const t = daysAgo(2 + i * 5);
    transport_bills.push({
      id: `tb-${i}`, received_date: ymd(t), transport_name: transports[i % transports.length],
      item: pick(['Thread cartons', 'Lace bundle', 'Fall bales', 'Mixed trims']), weight: `${int(18, 140)} kg`,
      bilty_no: `${int(40000, 49999)}`, party_name: firms[i % firms.length][0], amount: int(3, 18) * 50,
      photo_url: null, created_at: iso(t),
    });
    if (i > 1 && i % 2 === 0) transport_payments.push({
      id: `tp-${i}`, bill_id: `tb-${i}`, paid_on: ymd(daysAgo(i * 4)), amount: transport_bills[i].amount,
      method: 'Cash', reference: '', bank_name: '', photo_url: null, group_id: null, created_at: iso(daysAgo(i * 4)),
    });
  }

  const item_groups = [
    { id: 'grp-1', name: 'All Threads', members: ['Cotton Thread 300 mt', 'Polyester Thread 800 mt'], created_at: iso(daysAgo(30)) },
  ];

  // ---------- Workers (job work + shop staff) ----------
  const workerRows = [
    ['Sunita Bai', 'Job work', '98260 41122', 0],
    ['Ramesh Kumar', 'Shop', '94250 77310', 12000],
    ['Kavita Devi', 'Job work', '70004 55821', 0],
    ['Imran Khan', 'Shop', '99770 21456', 14000],
    ['Pooja Sahu', 'Job work', '88895 10273', 0],
  ];
  const workers = workerRows.map(([name, type, phone, sal], i) => ({
    id: `w-${i}`, name, type, phone, monthly_salary: sal, note: '', created_at: iso(daysAgo(90)),
  }));
  const worker_goods_issues = [];
  const worker_goods_returns = [];
  const worker_payments = [];
  workers.forEach((w, i) => {
    if (w.type === 'Job work') {
      for (let k = 0; k < 3; k++) {
        const d = daysAgo(4 + k * 9 + i);
        worker_goods_issues.push({ id: `gi-${i}-${k}`, worker_id: w.id, issued_on: ymd(d),
          items: [{ item: 'Saree Fall – Cotton', quantity: int(80, 200), unit: 'pieces' }, { item: 'Cotton Thread 300 mt', quantity: int(2, 6), unit: 'boxes' }],
          note: '', created_at: iso(d) });
        if (k > 0) worker_goods_returns.push({ id: `gr-${i}-${k}`, worker_id: w.id, returned_on: ymd(daysAgo(1 + k * 9 + i)),
          items: [{ item: 'Saree Fall – Cotton (stitched)', quantity: int(70, 180), unit: 'pieces' }],
          meters_used: 0, rate: 4, amount: int(70, 180) * 4, note: '', created_at: iso(daysAgo(1 + k * 9 + i)) });
      }
    }
    worker_payments.push({ id: `wp-${i}`, worker_id: w.id, paid_on: ymd(daysAgo(5 + i)), amount: w.monthly_salary || int(4, 9) * 100,
      method: pick(['Cash', 'UPI']), reference: '', bank_name: '', photo_url: null, note: '', created_at: iso(daysAgo(5 + i)) });
  });

  // ---------- Shop sales ----------
  const shopCats = ['Thread', 'Fall', 'Lace', 'Blouse', 'Buttons', 'Zip', 'Elastic', 'Dori'].map((name, i) => ({
    id: randomUUID(), name, name_hi: ['धागा', 'फॉल', 'लेस', 'ब्लाउज़', 'बटन', 'ज़िप', 'इलास्टिक', 'डोरी'][i], sort_order: i, is_active: true, created_at: iso(daysAgo(60)),
  }));
  const catId = (n) => shopCats.find((c) => c.name === n).id;
  const shopItemDefs = [
    ['300 mt Thread', 'Thread', 'pcs', 35, 30, 5, '5204', '300 मी. धागा'],
    ['800 mt Thread', 'Thread', 'pcs', 70, 61, 5, '5401', '800 मी. धागा'],
    ['Thread Box (10 pcs)', 'Thread', 'box', 340, 300, 5, '5204', 'धागा डिब्बा'],
    ['Cotton Fall', 'Fall', 'pcs', 30, 18.5, 5, '5208', 'कॉटन फॉल'],
    ['Poly Fall', 'Fall', 'pcs', 22, 14, 5, '5407', 'पॉली फॉल'],
    ['Golden Lace', 'Lace', 'metre', 25, 13, 5, '5804', 'गोल्डन लेस'],
    ['Silver Lace', 'Lace', 'metre', 22, 12, 5, '5804', 'सिल्वर लेस'],
    ['Blouse Piece', 'Blouse', 'pcs', 90, 62, 5, '5208', 'ब्लाउज़ पीस'],
    ['Fancy Buttons (12)', 'Buttons', 'packet', 40, 28, 12, '9606', 'फैंसी बटन'],
    ['Zip 9 inch', 'Zip', 'pcs', 12, 7, 12, '9607', 'ज़िप 9 इंच'],
    ['Elastic 1 inch', 'Elastic', 'metre', 8, 4.5, 5, '5604', 'इलास्टिक'],
    ['Silk Dori', 'Dori', 'pcs', 15, 9, 5, '5607', 'सिल्क डोरी'],
    ['Hooks & Eyes', 'Buttons', 'packet', 30, 22, 18, '8308', 'हुक'],
    ['Canvas Stiff', 'Blouse', 'metre', 45, 32, 5, '5901', 'कैनवास'],
  ];
  const shop_items = shopItemDefs.map(([name, cat, unit, sale, pur, gst, hsn, hi]) => ({
    id: randomUUID(), category_id: catId(cat), name, name_hi: hi, unit, sale_rate: money(sale), purchase_rate: money(pur),
    gst_rate: String(gst), hsn, is_active: true, updated_by: null, created_at: iso(daysAgo(60)), updated_at: iso(daysAgo(60)),
  }));
  const partyDefs = [
    ['Laxmi Tailors', '98931 22145', 'Sadar Bazaar', 'customer', 1250],
    ['Meena Boutique', '94241 88012', 'Napier Town', 'customer', 0],
    ['Gupta Cloth Store', '99261 33790', 'Gol Bazaar', 'customer', 4300],
    ['Sharma Ladies Corner', '70241 66548', 'Wright Town', 'customer', 0],
    ['Noor Stitching Centre', '88171 90432', 'Gorakhpur', 'customer', 780],
    ['Anjali Fashion', '93009 11276', 'Civil Lines', 'customer', 0],
    ['Kamal Dresses', '98270 45671', 'Ranjhi', 'customer', 2150],
    ['Shubh Creations', '97520 31108', 'Madan Mahal', 'customer', 0],
  ];
  const shop_parties = partyDefs.map(([name, phone, address, type, ob]) => ({
    id: randomUUID(), name, phone, address, gstin: '', state_code: '23', party_type: type, opening_balance: money(ob),
    carried_balance: '0.00', is_active: true, created_at: iso(daysAgo(80)), updated_at: iso(daysAgo(80)),
  }));

  const shop_invoices = [];
  const shop_invoice_items = [];
  let n = 0;
  for (let d = 34; d >= 0; d--) {
    const count = d === 0 ? 6 : int(3, 7);
    for (let k = 0; k < count; k++) {
      n++;
      const t = daysAgo(d, int(10, 19), int(0, 59));
      const walkIn = rnd() < 0.35;
      const party = walkIn ? null : pick(shop_parties);
      const lines = Array.from({ length: int(1, 4) }, () => {
        const it = pick(shop_items);
        const qty = int(1, 12);
        const rate = Number(it.sale_rate);
        const total = qty * rate;
        const gst = Number(it.gst_rate);
        const taxable = total / (1 + gst / 100);
        return { it, qty, rate, total, gst, taxable, tax: total - taxable };
      });
      const total = Math.round(lines.reduce((a, l) => a + l.total, 0));
      const taxSum = lines.reduce((a, l) => a + l.tax, 0);
      const sub = lines.reduce((a, l) => a + l.taxable, 0);
      const mode = walkIn ? pick(['cash', 'upi']) : pick(['cash', 'upi', 'credit', 'partial', 'credit']);
      const paid = mode === 'credit' ? 0 : mode === 'partial' ? Math.round(total / 2) : total;
      const id = randomUUID();
      shop_invoices.push({
        id, client_id: randomUUID(), bill_type: 'sale', series: 'A', bill_number: `S-A/2026-27/${String(n + 120).padStart(4, '0')}`,
        fy: '2026-27', bill_date: ymd(t), party_id: party?.id ?? null, party_name: party?.name ?? 'Cash sale', party_gstin: '',
        is_gst: true, is_interstate: false, rates_include_gst: true, payment_mode: mode, paid_mode: mode === 'partial' ? 'cash' : null,
        subtotal: money(sub), discount: '0.00', discount_percent: null, cgst: money(taxSum / 2), sgst: money(taxSum / 2), igst: '0.00',
        round_off: money(total - lines.reduce((a, l) => a + l.total, 0)), total: money(total), paid_amount: money(paid), status: 'active',
        converted_from: null, notes: '', created_by: pick(users).id, updated_by: null, created_at: iso(t), updated_at: iso(t), version: 1,
      });
      lines.forEach((l, i) => shop_invoice_items.push({
        id: randomUUID(), invoice_id: id, line_no: i, item_id: l.it.id, item_name: l.it.name, hsn: l.it.hsn, unit: l.it.unit,
        qty: l.qty.toFixed(3), rate: money(l.rate), gst_rate: String(l.gst), discount_amount: '0.00', taxable_amount: money(l.taxable),
        tax_amount: money(l.tax), line_total: money(l.total), cost_rate: l.it.purchase_rate,
      }));
    }
  }

  return {
    app_users: users,
    app_user_list: users.map(({ id, username, role }) => ({ id, username, role })),
    categories, withdrawal_logs, stock_additions,
    purchase_bills, bill_payments, transport_bills, transport_payments, item_groups,
    workers, worker_goods_issues, worker_goods_returns, worker_payments,
    shop_settings: [{
      id: 1, shop_name: 'Aapki Dukaan', address: 'Main Market, Station Road', phone: '98765 43210', gstin: '23ABCDE1234F1Z5',
      state_code: '23', upi_id: 'aapkidukaan@upi', upi_accounts: [{ id: 'u1', label: 'Shop UPI', upiId: 'aapkidukaan@upi', payeeName: 'Aapki Dukaan', merchantCode: '' }],
      logo_url: null, printer_width_mm: 58, rates_include_gst: true, receipt_footer: 'Dhanyavaad! Phir padhariye.', language: 'en',
      updated_by: null, updated_at: iso(daysAgo(10)),
    }],
    shop_categories: shopCats, shop_items, shop_parties,
    shop_counters: [{ bill_type: 'sale', fy: '2026-27', series: 'A', last_number: n + 120 }],
    shop_invoices, shop_invoice_items, shop_payments: [], shop_invoice_versions: [],
  };
}
