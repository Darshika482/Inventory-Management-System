// Scene timeline for the promo. Times are seconds from the scene start; screen coordinates are app CSS px (390 x 844).
// Shared by the renderer (browser) and the audio builder (node).
(function () {
  const VOD = typeof VO !== 'undefined' ? VO : require('./vo.js');
  const LEAD = 0.3, TAIL = 0.45;

  // hl: [t0, t1, x, y, w, h, color]
  const A = '#F59E0B', G = '#10B981', R = '#EF4444', W = '#FFFFFF';
  const S = [
    // ---------------- PART 1 : STOCK / GODOWN ----------------
    { id: 'p1_hook', hook: 'hook1', kicker: '', cap: '', len: 6.4, sub: true },
    {
      id: 'p1_intro', kicker: 'STOCK + SALES', cap: 'Sab kuch, [ek hi app] mein', len: 4.3,
      phoneIn: [0.0, 1.1],
      shots: [{ t: 0, src: 'st_overview' }],
      cam: [[0, 0, 1.0, 195, 422]],
      sfx: [[0.0, 'riser', 0.5], [1.05, 'impact', 0.8]],
    },
    {
      id: 'p1_overview', kicker: 'STOCK', cap: 'Stock [Overview]',
      shots: [{ t: 0, src: 'st_overview_tall', tall: 1900, scroll: [[4.2, 6.6, 620]] }],
      cam: [[0.3, 1.9, 1.32, 195, 300], [2.0, 3.6, 1.75, 195, 462], [4.0, 4.9, 1.12, 195, 470], [6.6, 7.6, 1.0, 195, 422]],
      hl: [[2.2, 3.9, 29, 391, 332, 143, A], [2.6, 3.9, 39, 425, 70, 22, A]],
    },
    {
      id: 'p1_low', kicker: 'STOCK', cap: '[Low Stock] Alert',
      shots: [{ t: 0, src: 'st_overview' }, { t: 0.75, src: 'st_low', tr: 'fade' }],
      taps: [[0.55, 96, 350]],
      cam: [[0.1, 0.6, 1.45, 120, 350], [1.0, 2.0, 1.6, 195, 520], [3.6, 4.8, 1.05, 195, 440]],
      hl: [[0.2, 0.75, 29, 332, 134, 36, A], [1.6, 3.8, 29, 391, 332, 143, R], [1.8, 3.8, 256, 400, 96, 30, R]],
      sfx: [[1.7, 'pop', 0.5]],
    },
    {
      id: 'p1_addtake', kicker: 'STOCK', cap: '[Add Stock] • [Take Out]',
      shots: [
        { t: 0, src: 'st_overview' },
        { t: 0.55, src: 'st_add_filled', tr: 'up' },
        { t: 2.75, src: 'st_add_done', tr: 'fade' },
        { t: 4.35, src: 'st_take_filled', tr: 'up' },
        { t: 7.05, src: 'st_take_done', tr: 'fade' },
      ],
      taps: [[0.35, 103, 185], [2.55, 195, 733], [4.15, 286, 185], [6.85, 195, 733]],
      cam: [[0.0, 0.4, 1.3, 195, 200], [0.7, 1.4, 1.5, 195, 620], [2.9, 3.4, 1.35, 195, 720], [3.9, 4.25, 1.2, 250, 260],
            [4.5, 5.2, 1.5, 195, 560], [7.1, 7.6, 1.4, 195, 730], [8.3, 9.0, 1.0, 195, 422]],
      hl: [[0.1, 0.55, 16, 163, 175, 44, G], [1.0, 2.55, 17, 520, 356, 150, A], [3.0, 4.0, 16, 690, 358, 100, G],
           [4.0, 4.35, 199, 163, 175, 44, R], [4.8, 6.8, 17, 370, 356, 300, A], [7.2, 8.6, 16, 700, 358, 110, G]],
      sfx: [[3.0, 'chime', 0.55], [7.2, 'chime', 0.55]],
    },
    {
      id: 'p1_history', kicker: 'STOCK', cap: 'Kaun, kab, kitna — [poori history]',
      shots: [{ t: 0, src: 'st_logs' }],
      cam: [[0.2, 1.0, 1.4, 195, 650], [3.4, 4.1, 1.65, 195, 494], [5.2, 5.9, 1.0, 195, 422]],
      hl: [[1.0, 3.4, 16, 528, 358, 300, A], [3.9, 5.5, 33, 470, 324, 48, A]],
    },
    {
      id: 'p1_added', kicker: 'STOCK', cap: 'Stock Added — [date ke hisaab se]',
      shots: [{ t: 0, src: 'st_added' }, { t: 1.6, src: 'st_added_7', tall: 1500, tr: 'fade', scroll: [[3.0, 5.0, 420]] }],
      taps: [[1.35, 112, 426]],
      cam: [[0.1, 1.0, 1.5, 195, 430], [1.9, 2.6, 1.3, 195, 520], [5.0, 5.8, 1.0, 195, 422]],
      hl: [[0.5, 1.6, 33, 402, 324, 104, A]],
    },
    {
      id: 'p1_bills', kicker: 'PURCHASE', cap: '[Party Bills]',
      shots: [
        { t: 0, src: 'st_bills_tall', tall: 1800, scroll: [[0.6, 2.0, 220]] },
        { t: 2.3, src: 'st_addbill', tr: 'up' },
        { t: 4.6, src: 'st_bill_open', tr: 'left' },
      ],
      taps: [[2.1, 327, 160]],
      cam: [[0.0, 0.6, 1.2, 195, 420], [2.4, 3.1, 1.7, 195, 262], [4.0, 4.5, 1.0, 195, 422], [4.9, 5.6, 1.65, 195, 252], [7.4, 8.4, 1.0, 195, 422]],
      hl: [[2.8, 4.2, 17, 232, 356, 56, A], [5.2, 6.4, 17, 228, 356, 46, G], [6.3, 7.8, 17, 280, 356, 46, R]],
    },
    {
      id: 'p1_payments', kicker: 'PURCHASE', cap: '[Payments] — sab ka hisaab',
      shots: [{ t: 0, src: 'st_payments_tall', tall: 1800, scroll: [[2.2, 3.4, 260]] }, { t: 3.7, src: 'st_paymany', tr: 'up' }],
      cam: [[0.2, 1.0, 1.5, 195, 200], [2.0, 2.6, 1.1, 195, 420], [3.9, 4.6, 1.35, 195, 480], [5.9, 6.6, 1.0, 195, 422]],
      hl: [[0.7, 2.1, 12, 98, 366, 168, G], [4.4, 5.9, 0, 245, 390, 600, A]],
    },
    {
      id: 'p1_rate', kicker: 'PURCHASE', cap: '[Rate Analysis]',
      shots: [{ t: 0, src: 'st_analysis_tall', tall: 1900 }],
      cam: [[0.2, 1.0, 1.55, 195, 330], [2.4, 3.4, 1.75, 195, 720], [5.6, 6.6, 1.0, 195, 422]],
      hl: [[0.8, 2.4, 12, 300, 176, 110, R], [3.3, 5.4, 12, 680, 366, 82, A], [3.8, 5.4, 18, 740, 70, 22, R]],
    },
    {
      id: 'p1_transport', kicker: 'PURCHASE', cap: '[Transport] Bills',
      shots: [{ t: 0, src: 'st_transport_tall', tall: 1800, scroll: [[2.6, 4.0, 380]] }],
      cam: [[0.2, 1.0, 1.55, 195, 340], [2.6, 3.4, 1.15, 195, 450], [4.2, 5.0, 1.0, 195, 422]],
      hl: [[0.8, 2.6, 16, 255, 358, 200, A], [1.2, 2.6, 270, 266, 96, 34, R]],
    },
    {
      id: 'p1_workers', kicker: 'TEAM', cap: '[Workers] & Job Work',
      shots: [{ t: 0, src: 'st_workers_tall', tall: 1800 }, { t: 4.7, src: 'st_givegoods', tr: 'up' }],
      taps: [[4.45, 110, 590]],
      cam: [[0.2, 1.0, 1.55, 195, 330], [2.4, 3.2, 1.55, 195, 560], [4.9, 5.6, 1.35, 195, 330], [6.8, 7.4, 1.0, 195, 422]],
      hl: [[0.8, 2.4, 16, 226, 358, 218, A], [2.9, 4.5, 29, 553, 332, 73, A], [5.4, 6.9, 17, 340, 356, 170, G]],
    },
    { id: 'p1_outro', hook: 'outro1', kicker: '', cap: '', len: 5.2 },

    // ---------------- PART 2 : SHOP SALES / BILLING ----------------
    { id: 'p2_hook', hook: 'hook2', kicker: '', cap: '', len: 6.2 },
    {
      id: 'p2_items', kicker: 'BILLING', cap: '[New Sale] • Add Items',
      phoneIn: [0.0, 0.8],
      shots: [
        { t: 0, src: 'sl_new_empty' },
        { t: 1.35, src: 'sl_picker', tr: 'up' },
        { t: 2.9, src: 'sl_picker_hi', tr: 'fade' },
        { t: 4.8, src: 'sl_picker', tr: 'fade' },
        { t: 6.3, src: 'sl_picker_picked', tr: 'fade' },
      ],
      taps: [[1.15, 195, 283], [2.7, 195, 136], [5.3, 340, 266], [5.65, 340, 721], [6.0, 340, 526], [7.6, 195, 799]],
      cam: [[0.8, 1.2, 1.25, 195, 300], [1.6, 2.2, 1.05, 195, 422], [2.8, 3.3, 1.75, 195, 180], [4.6, 5.1, 1.1, 195, 440], [6.4, 7.0, 1.2, 195, 560], [7.6, 8.4, 1.0, 195, 422]],
      hl: [[0.9, 1.35, 12, 259, 366, 48, A], [3.2, 4.7, 17, 112, 356, 48, A], [3.4, 4.7, 17, 230, 356, 80, G], [6.6, 8.0, 17, 775, 356, 48, A]],
    },
    {
      id: 'p2_pad', kicker: 'BILLING', cap: 'Bada [number pad]',
      shots: [{ t: 0, src: 'sl_new_items' }, { t: 0.65, src: 'sl_pad_open', tr: 'up' }, { t: 2.0, src: 'sl_pad_12', tr: 'cut' }],
      taps: [[0.45, 57, 273], [1.55, 55, 612], [1.9, 148, 612]],
      cam: [[0.0, 0.5, 1.3, 120, 300], [0.8, 1.3, 1.3, 195, 640], [2.2, 2.9, 1.75, 195, 490], [4.8, 5.6, 1.0, 195, 422]],
      hl: [[2.3, 4.8, 16, 432, 175, 80, A], [2.9, 4.8, 16, 522, 358, 40, G]],
      sfx: [[1.55, 'tick', 0.5], [1.9, 'tick', 0.5]],
    },
    {
      id: 'p2_customer', kicker: 'BILLING', cap: 'Customer • [GST] • Discount',
      shots: [
        { t: 0, src: 'sl_new_items' },
        { t: 0.55, src: 'sl_party_choose', tr: 'up' },
        { t: 1.7, src: 'sl_new_party', tr: 'fade' },
        { t: 3.6, src: 'sl_new_discount', tr: 'fade' },
      ],
      taps: [[0.35, 218, 168], [1.5, 195, 612]],
      cam: [[0.0, 0.3, 1.4, 195, 170], [0.7, 1.2, 1.25, 195, 520], [1.8, 2.4, 1.55, 195, 180], [3.8, 4.5, 1.6, 195, 330], [6.6, 7.4, 1.0, 195, 422]],
      hl: [[2.0, 3.6, 12, 112, 252, 48, A], [2.5, 3.6, 272, 112, 106, 48, G], [4.1, 5.4, 29, 82, 332, 48, A], [5.0, 6.6, 29, 400, 332, 70, G]],
    },
    {
      id: 'p2_payment', kicker: 'BILLING', cap: 'Cash • UPI • [Udhaar]',
      shots: [{ t: 0, src: 'sl_new_discount' }, { t: 3.0, src: 'sl_new_payment', tr: 'fade' }],
      taps: [[2.8, 113, 612]],
      cam: [[0.0, 0.6, 1.6, 195, 200], [2.6, 3.2, 1.45, 195, 600], [6.0, 6.8, 1.0, 195, 422]],
      hl: [[0.6, 2.4, 29, 172, 332, 52, A], [3.3, 6.0, 29, 640, 332, 72, R]],
    },
    {
      id: 'p2_print', kicker: 'BILLING', cap: 'Print + [UPI QR]',
      shots: [
        { t: 0, src: 'sl_new_payment' },
        { t: 0.6, src: 'sl_saved', tr: 'fade' },
        { t: 2.3, src: 'sl_preview', tr: 'up' },
        { t: 4.9, src: 'sl_preview2', tr: 'scrollswap' },
      ],
      taps: [[0.4, 101, 812], [2.1, 276, 465]],
      cam: [[0.0, 0.3, 1.3, 195, 700], [0.7, 1.3, 1.2, 195, 330], [2.5, 3.2, 1.45, 195, 380], [3.6, 4.8, 1.45, 195, 560], [5.1, 5.8, 1.9, 140, 660], [7.4, 8.2, 1.0, 195, 422]],
      hl: [[0.1, 0.6, 12, 788, 179, 48, G], [5.5, 7.6, 66, 612, 92, 92, A]],
      sfx: [[0.75, 'kaching', 0.7], [2.5, 'printer', 0.6]],
    },
    {
      id: 'p2_share', kicker: 'BILLING', cap: '[WhatsApp] pe bill',
      shots: [{ t: 0, src: 'sl_saved' }, { t: 0.7, src: 'sl_share', tr: 'up' }],
      taps: [[0.5, 195, 675]],
      cam: [[0.0, 0.4, 1.3, 195, 650], [0.9, 1.6, 1.55, 195, 470], [2.9, 3.6, 1.45, 195, 690], [4.6, 5.3, 1.0, 195, 422]],
      hl: [[1.4, 3.0, 30, 462, 330, 96, G], [3.3, 4.8, 17, 662, 356, 160, A]],
    },
    {
      id: 'p2_list', kicker: 'BILLS', cap: 'Sale Bills • [Udhaar] list',
      shots: [{ t: 0, src: 'sl_bills_tall', tall: 1900, scroll: [[0.8, 1.9, 380], [2.0, 2.6, 0]] }, { t: 3.0, src: 'sl_udhaar_tall', tall: 1700, tr: 'fade', scroll: [[5.0, 6.2, 200]] }],
      taps: [[2.8, 133, 173]],
      cam: [[0.0, 0.6, 1.2, 195, 420], [2.5, 2.8, 1.35, 195, 260], [3.2, 3.9, 1.5, 195, 470], [5.8, 6.5, 1.0, 195, 422]],
      hl: [[0.2, 1.0, 12, 252, 366, 42, A], [3.4, 5.6, 12, 400, 366, 300, R]],
    },
    {
      id: 'p2_edit', kicker: 'BILLS', cap: 'Receive Payment • [Edit Bill]',
      shots: [{ t: 0, src: 'sl_bill_open', tr: 'fade' }, { t: 1.6, src: 'sl_receive', tr: 'up' }, { t: 4.2, src: 'sl_bill_open', tr: 'fade' }],
      taps: [[1.4, 195, 402], [3.9, 195, 795]],
      cam: [[0.0, 0.6, 1.45, 195, 420], [1.8, 2.5, 1.5, 195, 640], [4.3, 5.0, 1.6, 195, 334], [7.4, 8.2, 1.0, 195, 422]],
      hl: [[0.5, 1.5, 17, 374, 356, 56, A], [2.3, 3.9, 797 - 780, 555, 356, 165, G], [4.9, 7.4, 17, 310, 356, 48, A]],
      sfx: [[4.0, 'chime', 0.55]],
    },
    {
      id: 'p2_masters', kicker: 'MASTERS', cap: 'Customers • [Items & Rates]',
      shots: [{ t: 0, src: 'sl_parties_tall', tall: 1800, scroll: [[1.0, 2.6, 300]] }, { t: 3.4, src: 'sl_items_tall', tall: 1900, tr: 'left', scroll: [[5.3, 7.2, 420]] }],
      cam: [[0.0, 0.8, 1.45, 195, 330], [3.4, 4.0, 1.5, 195, 330], [7.2, 8.0, 1.0, 195, 422]],
      hl: [[0.6, 1.0, 12, 225, 366, 70, R], [3.9, 5.3, 12, 224, 366, 150, A]],
    },
    {
      id: 'p2_extras', kicker: 'EXTRA', cap: '[Staff login] • Hindi/English • [Offline]',
      shots: [
        { t: 0, src: 'sf_login_filled', tr: 'fade' },
        { t: 2.2, src: 'sf_menu', tr: 'fade' },
        { t: 3.9, src: 'sl_hindi', tr: 'left' },
        { t: 6.2, src: 'sl_offline_saved', tr: 'fade' },
      ],
      taps: [[1.9, 195, 598]],
      cam: [[0.0, 0.7, 1.35, 195, 470], [2.3, 2.9, 1.3, 140, 330], [4.0, 4.7, 1.4, 195, 300], [6.3, 7.0, 1.4, 195, 420], [9.0, 9.9, 1.0, 195, 422]],
      hl: [[0.6, 1.9, 49, 497, 292, 56, A], [2.6, 3.9, 0, 60, 290, 210, A], [4.6, 6.1, 150, 80, 80, 46, A], [6.8, 9.0, 135, 397, 120, 30, A]],
    },
    { id: 'p2_outro', hook: 'outro2', kicker: '', cap: '', len: 7.2 },
  ];

  let t = 0;
  for (const s of S) {
    const v = VOD[s.id];
    s.part = v.part; s.vo = v.dur; s.en = v.en;
    s.voAt = s.hook === 'hook1' ? 0.25 : s.hook === 'hook2' ? 0.3 : s.hook ? 0.4 : LEAD;
    s.len = s.len || Math.max(s.vo + LEAD + TAIL, 3);
    if (s.len < s.voAt + s.vo + 0.3) s.len = s.voAt + s.vo + 0.3;
    s.start = t; t += s.len;
  }
  const part1End = S.find((s) => s.id === 'p1_outro');
  const TL = { scenes: S, total: t, part2Start: part1End.start + part1End.len, W: 1080, H: 1920 };
  if (typeof module !== 'undefined') module.exports = TL; else window.TL = TL;
})();
