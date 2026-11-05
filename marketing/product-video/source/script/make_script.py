import json
from docx import Document
from docx.shared import Pt, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
def cs(run):
    run.font.name = 'Nirmala UI'
    run._element.rPr.rFonts.set(qn('w:cs'), 'Nirmala UI')


D = '/home/user/reelmimic/projects/stockshop'
TL = json.load(open(f'{D}/audio/tl.json'))
VO = {s['id']: s for s in json.load(open(f'{D}/vo/scenes.json'))}

VIS = {
 'p1_hook': 'काइनेटिक टेक्स्ट कार्ड: "Dukaan ka stock", "Godown ka hisaab", "Party ke bill" — फिर बड़ा "REGISTER" लाल लाइन से कटता है।',
 'p1_intro': 'फ़ोन नीचे से उड़कर आता है, स्टॉक ओवरव्यू स्क्रीन। हेडलाइन: Sab kuch, ek hi app mein',
 'p1_overview': 'स्टॉक लिस्ट पर ज़ूम-इन — आइटम कार्ड, फ़्लोर टैग, "1,120 left" हाइलाइट; फिर लिस्ट स्क्रॉल।',
 'p1_low': '"Low stock" फ़िल्टर पर टैप → सिर्फ़ कम स्टॉक वाले आइटम, "Very low" लाल हाइलाइट।',
 'p1_addtake': 'Add stock शीट (Lace Roll – Golden, 120) → सेव टोस्ट; Take out stock (ayush, Saree Fall, 25) → रिकॉर्ड टोस्ट।',
 'p1_history': 'Taken items history — स्टाफ़ का नाम, मात्रा, तारीख़-समय; "Download PDF" बटन हाइलाइट।',
 'p1_added': 'Stock added by date — "Last 7 days" पर टैप, लिस्ट स्क्रॉल।',
 'p1_bills': 'Party bills लिस्ट → Add party bill (Take photo / Gallery) → बिल डिटेल: Paid और Left to pay हाइलाइट।',
 'p1_payments': 'Payments: Total paid, To parties, To transport → "Pay bills together" शीट।',
 'p1_rate': 'Rate analysis: "Rates gone up" कार्ड, आइटम का नया रेट vs पुराना, % बढ़त, पार्टियाँ।',
 'p1_transport': 'Transport bills: बिल्टी नंबर, वज़न, पार्टी, "Left: ₹500" हाइलाइट; लिस्ट स्क्रॉल।',
 'p1_workers': 'Workers: शॉप स्टाफ़ की सैलरी, जॉब वर्क — Give goods / Receive goods → Give goods शीट।',
 'p1_outro': 'फ़ोन पीछे हटता है, स्टॉक के 8 सेक्शन चिप्स में; टैगलाइन: Poora godown, ab aapki jeb mein.',
 'p2_hook': 'टाइटल "SALES & BILLING — Ab baat counter ki", दुकान आइकन, ग्राहकों की लाइन, घूमती घड़ी → "Ab nahi!" स्टैम्प।',
 'p2_items': 'New sale → Add items शीट → हिंदी में सर्च "लेस" → आइटम पर टैप करके जोड़ना → Done।',
 'p2_pad': 'Qty पर टैप → बड़ा नंबर पैड, "12" टाइप → Amount ₹420 अपने आप।',
 'p2_customer': 'Change → ग्राहक चुनें (Laxmi Tailors) → GST टॉगल → 5% डिस्काउंट, सबटोटल हाइलाइट।',
 'p2_payment': 'Cash / UPI बटन हाइलाइट → Amount received ₹300, Balance (उधार) ₹246 लाल में।',
 'p2_print': 'Save → "Bill saved" (₹546, Part paid) → Print preview रसीद → UPI QR कोड पर ज़ूम।',
 'p2_share': 'Share → "WhatsApp to Laxmi Tailors" बटन → Share as image / PDF विकल्प।',
 'p2_list': 'Sale bills (आज के बिल) स्क्रॉल → "Udhaar" टैब: ग्राहकों का बाकी बैलेंस।',
 'p2_edit': 'बिल खोलें → Receive payment शीट → Edit bill बटन हाइलाइट।',
 'p2_masters': 'Customers लिस्ट (Old balance) → Items and rates (हिंदी नाम, GST, रेट)।',
 'p2_extras': 'स्टाफ़ लॉगिन (ayush) → स्टाफ़ का सीमित मेन्यू → पूरा ऐप हिंदी में → ऑफ़लाइन बिल "Waiting to upload"।',
 'p2_outro': 'दो फ़ोन (Stock + Sales), फ़ीचर चिप्स, टैगलाइन "Stock se Sale tak" + बटन "Aaj hi shuru kijiye"।',
}

def ts(t):
    m = int(t // 60); s = t - m * 60
    return f'{m}:{s:05.2f}'

doc = Document()
for sec in doc.sections:
    sec.left_margin = sec.right_margin = Cm(1.8); sec.top_margin = sec.bottom_margin = Cm(1.6)
st = doc.styles['Normal']; st.font.name = 'Nirmala UI'; st.font.size = Pt(11)
st.element.rPr.rFonts.set(qn('w:cs'), 'Nirmala UI'); st.element.rPr.rFonts.set(qn('w:eastAsia'), 'Nirmala UI')

def para(text, size=11, bold=False, color=None, align=None, italic=False):
    p = doc.add_paragraph(); r = p.add_run(text); r.font.size = Pt(size); r.bold = bold; r.italic = italic
    cs(r)
    if color: r.font.color.rgb = RGBColor.from_string(color)
    if align: p.alignment = align
    return p

para('प्रोडक्ट इंट्रो और फ़ीचर वीडियो — वॉइसओवर स्क्रिप्ट', 20, True, '0F172A')
para('स्टॉक (गोदाम) + सेल्स (बिलिंग) ऐप  •  9:16 वर्टिकल  •  भाषा: हिंग्लिश (देवनागरी में लिखी गई, ताकि उच्चारण सही हो)', 11, False, '475569')
para(f'कुल लंबाई: {ts(TL["total"])}   |   भाग 1 (स्टॉक): 0:00.00 – {ts(TL["part2Start"])}   |   भाग 2 (सेल्स): {ts(TL["part2Start"])} – {ts(TL["total"])}', 11, True, 'B45309')
para(f'क्रॉप करने के लिए: भाग 2 ठीक {ts(TL["part2Start"])} ({TL["part2Start"]:.2f} सेकंड) से शुरू होता है। भाग 1 वहीं पूरी तरह ख़त्म होता है (फ़ेड), और भाग 2 अपने नए टाइटल, अपने म्यूज़िक और अपनी शुरुआत के साथ खुलता है। वीडियो में "पार्ट 2" बोला या लिखा नहीं गया है, और ऐप का नाम कहीं नहीं है।', 10, False, '334155')
para('नोट: हर सीन की टाइमिंग वीडियो से मेल खाती है। अगर आप ख़ुद या किसी वॉइस आर्टिस्ट से आवाज़ रिकॉर्ड करवाएँ, तो हर लाइन को उसके सीन के समय के अंदर बोलें। एक्स्ट्रा फ़ाइल "music_sfx_only.wav" में बिना आवाज़ का म्यूज़िक और साउंड इफ़ेक्ट्स हैं।', 10, False, '334155', italic=True)

for part, title in [(1, 'भाग 1 — स्टॉक / गोदाम मैनेजमेंट'), (2, 'भाग 2 — शॉप सेल्स / बिलिंग')]:
    doc.add_paragraph()
    para(title, 15, True, '0F766E' if part == 2 else 'B45309')
    scenes = [s for s in TL['scenes'] if s['part'] == part]
    tbl = doc.add_table(rows=1, cols=4); tbl.style = 'Light Grid Accent 1'; tbl.autofit = False
    hdr = tbl.rows[0].cells
    for c, h in zip(hdr, ['#', 'समय', 'वॉइसओवर (हिंदी स्क्रिप्ट)', 'स्क्रीन पर क्या दिखेगा']):
        c.text = ''; r = c.paragraphs[0].add_run(h); r.bold = True; r.font.size = Pt(10)
    for i, s in enumerate(scenes, 1):
        row = tbl.add_row().cells
        a = s['start'] + s['voAt']
        row[0].text = str(i)
        row[1].text = f'{ts(a)}\n– {ts(a + s["vo"])}'
        row[2].text = ''
        r = row[2].paragraphs[0].add_run(VO[s['id']]['hi']); r.font.size = Pt(12); cs(r)
        p2 = row[2].add_paragraph(); r2 = p2.add_run(VO[s['id']]['en']); r2.font.size = Pt(8.5); r2.italic = True; r2.font.color.rgb = RGBColor.from_string('64748B')
        row[3].text = ''
        cap = VO[s['id']]['cap']
        r3 = row[3].paragraphs[0].add_run(f'हेडलाइन: {cap}\n'); r3.bold = True; r3.font.size = Pt(9)
        r4 = row[3].paragraphs[0].add_run(VIS[s['id']]); r4.font.size = Pt(9); cs(r4)
        for c, w in zip(row, [Cm(0.8), Cm(2.2), Cm(8.0), Cm(6.4)]): c.width = w
    for c, w in zip(tbl.rows[0].cells, [Cm(0.8), Cm(2.2), Cm(8.0), Cm(6.4)]): c.width = w
    for col, w in zip(tbl.columns, [Cm(0.8), Cm(2.2), Cm(8.0), Cm(6.4)]): col.width = w
    grid = tbl._tbl.tblGrid
    for gc, w in zip(grid.findall(qn('w:gridCol')), [Cm(0.8), Cm(2.2), Cm(8.0), Cm(6.4)]): gc.set(qn('w:w'), str(int(w.twips)))

doc.add_paragraph()
para('पूरी स्क्रिप्ट (सिर्फ़ बोलने वाला टेक्स्ट)', 15, True, '0F172A')
for part in (1, 2):
    para('भाग 1' if part == 1 else 'भाग 2', 12, True)
    for s in TL['scenes']:
        if s['part'] == part:
            para(VO[s['id']]['hi'], 12)
doc.add_paragraph()
para('उच्चारण संकेत: "जीएसटी" = जी-एस-टी, "यूपीआई" = यू-पी-आई, "पीडीएफ़" = पी-डी-एफ़, "एचएसएन" = एच-एस-एन, "क्यूआर" = क्यू-आर।  "उधार" = क्रेडिट / बाद में पेमेंट।', 10, False, '475569')
out = f'{D}/out/Product_Video_Script_Hindi.docx'
import os; os.makedirs(f'{D}/out', exist_ok=True)
doc.save(out); print(out)
