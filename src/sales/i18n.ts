/**
 * Every word the shop sales screens show, in English and Hindi.
 * Use `const { t } = useT()` and `t('key', { name: 'Lux' })` for {name} slots.
 * The language choice is per phone (staff can switch with one tap) and starts
 * from the shop's default language in Shop settings.
 */
import { useStore } from './useStore';
import type { Language } from './types';

const en = {
  // Common
  save: 'Save',
  saving: 'Saving...',
  cancel: 'Cancel',
  close: 'Close',
  edit: 'Edit',
  done: 'Done',
  search: 'Search',
  tryAgain: 'Try again',
  loading: 'Loading...',
  switchLanguage: 'हिंदी',
  optional: '(optional)',
  yes: 'Yes',
  no: 'No',
  noMatch: 'Nothing matches your search.',
  needsInternet: 'This needs the internet. Check the connection and try again.',
  ownerOnly: 'Only the owner can change this.',
  loadFailed: 'Could not load this page',

  // Menu
  menuGroup: 'Shop sales',
  menuNewSale: 'New sale',
  menuSales: 'Sale bills',
  menuItems: 'Items and rates',
  menuParties: 'Customers',
  menuSettings: 'Shop settings',

  // Settings
  settingsTitle: 'Shop settings',
  settingsHint: 'These details are printed on every bill.',
  shopName: 'Shop name',
  address: 'Address',
  phone: 'Phone number',
  gstin: 'GST number (GSTIN)',
  state: 'State',
  upiId: 'UPI ID (for customers to pay you)',
  ratesIncludeGst: 'Item rates already include GST',
  ratesIncludeGstHint: 'Most shops: yes. Turn this off only if you add GST on top of the rate.',
  printerWidth: 'Printer paper width',
  printerLater: 'Printing comes in the next update. Your choice is kept for it.',
  receiptFooter: 'Message at the bottom of the bill',
  defaultLanguage: 'Language for new phones',
  deviceSeries: "This phone's bill series",
  deviceSeriesHint:
    'Every phone that makes bills needs its own letter (A, B, C...). Bills from this phone will be numbered {example}.',
  settingsSaved: 'Shop details saved.',
  settingsSaveFailed: 'Shop details could not be saved',
  shopNameRequired: 'Please type the shop name.',
  gstinInvalid: 'This GST number does not look right. It has 15 letters and numbers, like 23ABCDE1234F1Z5.',
  ownerOnlySettings: 'Only the owner can change shop settings.',

  // Items
  itemsTitle: 'Items and rates',
  addItem: 'Add item',
  editItem: 'Change item',
  addCategory: 'Add category',
  editCategory: 'Change category',
  reorderCategories: 'Change order',
  categoryOrderSaved: 'Category order saved.',
  moveUp: 'Move up',
  moveDown: 'Move down',
  allItems: 'All',
  noCategory: 'No category',
  searchItems: 'Search item (English or Hindi)...',
  itemName: 'Item name',
  itemNameHi: 'Name in Hindi',
  category: 'Category',
  chooseCategory: 'Choose category',
  unit: 'Unit',
  saleRate: 'Sale rate (₹)',
  purchaseRate: 'Purchase rate (₹)',
  purchaseRateHint: 'What you pay for it. Used to work out profit.',
  gstRate: 'GST rate',
  hsn: 'HSN code',
  showInBills: 'Show this item when billing',
  hidden: 'Hidden',
  itemSaved: '"{name}" saved.',
  itemSaveFailed: 'The item could not be saved',
  itemNameRequired: 'Please type the item name.',
  rateInvalid: 'Type the rate as a number, like 40 or 40.50.',
  noItems: 'No items yet',
  noItemsHint: 'Add the things you sell with their rate. The rate then fills in by itself on every bill.',
  itemsCount: '{n} items',
  categoryName: 'Category name',
  categoryNameHi: 'Category name in Hindi',
  categorySaved: 'Category "{name}" saved.',
  categoryNameRequired: 'Please type the category name.',
  showCategory: 'Show this category when billing',

  // Units
  unit_pcs: 'Piece',
  unit_kg: 'Kilo',
  unit_box: 'Box',
  unit_packet: 'Packet',
  unit_dozen: 'Dozen',
  unit_metre: 'Metre',
  unit_litre: 'Litre',

  // Parties
  partiesTitle: 'Customers and suppliers',
  addParty: 'Add customer',
  editParty: 'Change details',
  searchParties: 'Search name or phone...',
  partyName: 'Name',
  partyPhone: 'Phone number',
  partyAddress: 'Address',
  partyGstin: 'GST number',
  partyType: 'This is a',
  type_customer: 'Customer',
  type_supplier: 'Supplier',
  type_both: 'Both',
  openingBalance: 'Old balance (₹)',
  openingBalanceHint:
    'Money they already owed you before this app. Leave 0 if none. If you owe them, put a minus sign, like -500.',
  oldBalance: 'Old balance {amount}',
  partySaved: '"{name}" saved.',
  partySaveFailed: 'The customer could not be saved',
  partyNameRequired: 'Please type the name.',
  phoneInvalid: 'The phone number should have 10 digits.',
  noParties: 'No customers yet',
  noPartiesHint: 'Add customers who buy on udhaar or need a GST bill. Walk-in customers need nothing.',
  quickAddTitle: 'New customer',
  quickAddHint: 'Only name and phone now. Add the rest later in Customers.',
  otherStateNote: 'Other state: IGST',

  // New sale
  newSaleTitle: 'New sale',
  customer: 'Customer',
  cashSale: 'Cash Sale',
  cashSaleHint: 'Walk-in customer',
  change: 'Change',
  chooseCustomer: 'Choose customer',
  newCustomer: 'New customer',
  addItems: 'Add items',
  noLinesYet: 'No items on this bill yet. Tap "Add items".',
  qty: 'Qty',
  rate: 'Rate',
  amount: 'Amount',
  remove: 'Remove',
  decrease: 'One less',
  increase: 'One more',
  updateSavedRate: 'Also change the saved rate (now {old})',
  gstBill: 'GST bill',
  nonGstBill: 'Without GST',
  discount: 'Discount',
  discountInRupees: '₹',
  discountInPercent: '%',
  payment: 'Payment',
  pay_cash: 'Cash',
  pay_upi: 'UPI',
  pay_credit: 'Udhaar',
  pay_partial: 'Part paid',
  paidNow: 'Paid now (₹)',
  paidBy: 'Paid by',
  udhaarLeft: 'Udhaar left: {amount}',
  itemsTotal: 'Items total',
  taxableValue: 'Taxable value',
  gstIncluded: 'GST included in rates',
  gstAdded: 'GST',
  cgst: 'CGST',
  sgst: 'SGST',
  igst: 'IGST',
  roundOff: 'Round off',
  total: 'Total',
  saveAndPrint: 'Save and Print',
  saveOnly: 'Save only',
  printingLater: 'Printing comes in the next update.',
  billSaved: 'Bill {number} saved.',
  billSavedOffline: 'Bill {number} saved on this phone. It will upload by itself when the internet is back.',
  billSaveFailed: 'The bill could not be saved on this phone. Please try again.',
  numberOnUpload: 'number given on upload',
  needLines: 'Add at least one item to the bill.',
  needCustomerForCredit: 'Udhaar needs a customer. Tap "Change" next to Cash Sale and choose or add the customer.',
  paidInvalid: 'The paid amount must be more than ₹0 and less than the total.',
  qtyInvalid: 'Check the quantity of "{name}".',
  rateInvalidLine: 'Check the rate of "{name}".',
  discountInvalid: 'Check the discount. It cannot be more than the items total.',
  clearBill: 'Clear bill',
  clearBillConfirm: 'Remove all items from this bill? Nothing has been saved yet.',
  clearBillYes: 'Yes, clear it',
  newBill: 'New bill',
  viewBill: 'View bill',
  savedTitle: 'Bill saved',

  // Item picker
  pickerHint: 'Tap an item to add it. Tap again for one more.',
  oftenSold: 'Often sold',
  onBill: '{n} on bill',
  pickerDone: 'Done',
  noItemsToPick: 'No items yet. The owner can add them in "Items and rates".',

  // Bills list and detail
  salesTitle: 'Sale bills',
  allCustomers: 'All customers',
  billsSummary: '{n} bills · {amount}',
  noBills: 'No bills on these dates.',
  waitingUpload: 'Waiting to upload',
  uploadFailed: 'Not uploaded',
  retryUpload: 'Upload again',
  cancelled: 'Cancelled',
  billDate: 'Date',
  billTime: 'Time',
  paymentType: 'Payment',
  paid: 'Paid',
  udhaar: 'Udhaar',
  madeBy: 'Made by',
  gstBreakup: 'GST breakup',
  gstRateLabel: 'GST {rate}%',
  billNotFound: 'This bill could not be found.',
  hsnShort: 'HSN',

  // Sync
  syncWaiting: '{n} bills waiting to upload',
  syncFailed: '{n} bills not uploaded. Open Sale bills to see why.',
};

export type TranslationKey = keyof typeof en;

const hi: Record<TranslationKey, string> = {
  save: 'सेव करें',
  saving: 'सेव हो रहा है...',
  cancel: 'छोड़ें',
  close: 'बंद करें',
  edit: 'बदलें',
  done: 'हो गया',
  search: 'खोजें',
  tryAgain: 'फिर से कोशिश करें',
  loading: 'लोड हो रहा है...',
  switchLanguage: 'English',
  optional: '(ज़रूरी नहीं)',
  yes: 'हाँ',
  no: 'नहीं',
  noMatch: 'खोज से कुछ नहीं मिला।',
  needsInternet: 'इसके लिए इंटरनेट चाहिए। कनेक्शन देखकर फिर से कोशिश करें।',
  ownerOnly: 'इसे सिर्फ़ मालिक बदल सकते हैं।',
  loadFailed: 'यह पेज लोड नहीं हुआ',

  menuGroup: 'दुकान बिक्री',
  menuNewSale: 'नई बिक्री',
  menuSales: 'बिक्री के बिल',
  menuItems: 'सामान और रेट',
  menuParties: 'ग्राहक',
  menuSettings: 'दुकान सेटिंग',

  settingsTitle: 'दुकान सेटिंग',
  settingsHint: 'यह जानकारी हर बिल पर छपेगी।',
  shopName: 'दुकान का नाम',
  address: 'पता',
  phone: 'फ़ोन नंबर',
  gstin: 'GST नंबर (GSTIN)',
  state: 'राज्य',
  upiId: 'UPI ID (ग्राहक इस पर पैसे भेजेंगे)',
  ratesIncludeGst: 'सामान के रेट में GST पहले से शामिल है',
  ratesIncludeGstHint: 'ज़्यादातर दुकानों में: हाँ। अगर आप रेट के ऊपर GST जोड़ते हैं, तभी इसे बंद करें।',
  printerWidth: 'प्रिंटर पेपर की चौड़ाई',
  printerLater: 'प्रिंटिंग अगले अपडेट में आएगी। आपका चुनाव उसके लिए सेव रहेगा।',
  receiptFooter: 'बिल के नीचे का संदेश',
  defaultLanguage: 'नए फ़ोन की भाषा',
  deviceSeries: 'इस फ़ोन की बिल सीरीज़',
  deviceSeriesHint:
    'बिल बनाने वाले हर फ़ोन का अपना अक्षर होना चाहिए (A, B, C...)। इस फ़ोन के बिल नंबर ऐसे होंगे: {example}',
  settingsSaved: 'दुकान की जानकारी सेव हो गई।',
  settingsSaveFailed: 'दुकान की जानकारी सेव नहीं हुई',
  shopNameRequired: 'कृपया दुकान का नाम लिखें।',
  gstinInvalid: 'यह GST नंबर सही नहीं लग रहा। इसमें 15 अक्षर और अंक होते हैं, जैसे 23ABCDE1234F1Z5।',
  ownerOnlySettings: 'दुकान सेटिंग सिर्फ़ मालिक बदल सकते हैं।',

  itemsTitle: 'सामान और रेट',
  addItem: 'सामान जोड़ें',
  editItem: 'सामान बदलें',
  addCategory: 'कैटेगरी जोड़ें',
  editCategory: 'कैटेगरी बदलें',
  reorderCategories: 'क्रम बदलें',
  categoryOrderSaved: 'कैटेगरी का क्रम सेव हो गया।',
  moveUp: 'ऊपर करें',
  moveDown: 'नीचे करें',
  allItems: 'सब',
  noCategory: 'बिना कैटेगरी',
  searchItems: 'सामान खोजें (हिंदी या English)...',
  itemName: 'सामान का नाम',
  itemNameHi: 'हिंदी में नाम',
  category: 'कैटेगरी',
  chooseCategory: 'कैटेगरी चुनें',
  unit: 'इकाई',
  saleRate: 'बिक्री रेट (₹)',
  purchaseRate: 'खरीद रेट (₹)',
  purchaseRateHint: 'आप इसे कितने में खरीदते हैं। मुनाफ़ा निकालने में काम आता है।',
  gstRate: 'GST दर',
  hsn: 'HSN कोड',
  showInBills: 'बिल बनाते समय यह सामान दिखाएँ',
  hidden: 'छुपा हुआ',
  itemSaved: '"{name}" सेव हो गया।',
  itemSaveFailed: 'सामान सेव नहीं हुआ',
  itemNameRequired: 'कृपया सामान का नाम लिखें।',
  rateInvalid: 'रेट नंबर में लिखें, जैसे 40 या 40.50।',
  noItems: 'अभी कोई सामान नहीं',
  noItemsHint: 'जो सामान बेचते हैं, उसे रेट के साथ जोड़ें। फिर हर बिल में रेट अपने-आप भर जाएगा।',
  itemsCount: '{n} सामान',
  categoryName: 'कैटेगरी का नाम',
  categoryNameHi: 'हिंदी में कैटेगरी का नाम',
  categorySaved: 'कैटेगरी "{name}" सेव हो गई।',
  categoryNameRequired: 'कृपया कैटेगरी का नाम लिखें।',
  showCategory: 'बिल बनाते समय यह कैटेगरी दिखाएँ',

  unit_pcs: 'पीस',
  unit_kg: 'किलो',
  unit_box: 'डिब्बा',
  unit_packet: 'पैकेट',
  unit_dozen: 'दर्जन',
  unit_metre: 'मीटर',
  unit_litre: 'लीटर',

  partiesTitle: 'ग्राहक और सप्लायर',
  addParty: 'ग्राहक जोड़ें',
  editParty: 'जानकारी बदलें',
  searchParties: 'नाम या फ़ोन खोजें...',
  partyName: 'नाम',
  partyPhone: 'फ़ोन नंबर',
  partyAddress: 'पता',
  partyGstin: 'GST नंबर',
  partyType: 'यह कौन है',
  type_customer: 'ग्राहक',
  type_supplier: 'सप्लायर',
  type_both: 'दोनों',
  openingBalance: 'पुराना हिसाब (₹)',
  openingBalanceHint:
    'इस ऐप से पहले का उनका बाकी पैसा। कुछ बाकी नहीं तो 0 रहने दें। अगर आपको उन्हें देना है, तो माइनस लगाएँ, जैसे -500।',
  oldBalance: 'पुराना हिसाब {amount}',
  partySaved: '"{name}" सेव हो गया।',
  partySaveFailed: 'ग्राहक सेव नहीं हुआ',
  partyNameRequired: 'कृपया नाम लिखें।',
  phoneInvalid: 'फ़ोन नंबर 10 अंकों का होना चाहिए।',
  noParties: 'अभी कोई ग्राहक नहीं',
  noPartiesHint: 'उधार लेने वाले या GST बिल चाहने वाले ग्राहक जोड़ें। आम ग्राहक के लिए कुछ नहीं चाहिए।',
  quickAddTitle: 'नया ग्राहक',
  quickAddHint: 'अभी सिर्फ़ नाम और फ़ोन। बाकी जानकारी बाद में ग्राहक पेज में जोड़ें।',
  otherStateNote: 'दूसरा राज्य: IGST',

  newSaleTitle: 'नई बिक्री',
  customer: 'ग्राहक',
  cashSale: 'नकद बिक्री',
  cashSaleHint: 'आम ग्राहक',
  change: 'बदलें',
  chooseCustomer: 'ग्राहक चुनें',
  newCustomer: 'नया ग्राहक',
  addItems: 'सामान जोड़ें',
  noLinesYet: 'बिल में अभी कोई सामान नहीं। "सामान जोड़ें" दबाएँ।',
  qty: 'मात्रा',
  rate: 'रेट',
  amount: 'रकम',
  remove: 'हटाएँ',
  decrease: 'एक कम',
  increase: 'एक ज़्यादा',
  updateSavedRate: 'सेव किया रेट भी बदलें (अभी {old})',
  gstBill: 'GST बिल',
  nonGstBill: 'बिना GST',
  discount: 'छूट',
  discountInRupees: '₹',
  discountInPercent: '%',
  payment: 'पेमेंट',
  pay_cash: 'नकद',
  pay_upi: 'UPI',
  pay_credit: 'उधार',
  pay_partial: 'कुछ पैसे दिए',
  paidNow: 'अभी दिए (₹)',
  paidBy: 'कैसे दिए',
  udhaarLeft: 'बाकी उधार: {amount}',
  itemsTotal: 'सामान का कुल',
  taxableValue: 'टैक्स योग्य रकम',
  gstIncluded: 'रेट में शामिल GST',
  gstAdded: 'GST',
  cgst: 'CGST',
  sgst: 'SGST',
  igst: 'IGST',
  roundOff: 'राउंड ऑफ',
  total: 'कुल',
  saveAndPrint: 'सेव और प्रिंट',
  saveOnly: 'सिर्फ़ सेव',
  printingLater: 'प्रिंटिंग अगले अपडेट में आएगी।',
  billSaved: 'बिल {number} सेव हो गया।',
  billSavedOffline: 'बिल {number} इस फ़ोन में सेव हो गया। इंटरनेट आने पर अपने-आप अपलोड हो जाएगा।',
  billSaveFailed: 'बिल इस फ़ोन में सेव नहीं हुआ। कृपया फिर से कोशिश करें।',
  numberOnUpload: 'अपलोड होने पर नंबर मिलेगा',
  needLines: 'बिल में कम से कम एक सामान जोड़ें।',
  needCustomerForCredit: 'उधार के लिए ग्राहक चाहिए। नकद बिक्री के पास "बदलें" दबाकर ग्राहक चुनें या जोड़ें।',
  paidInvalid: 'दिए गए पैसे ₹0 से ज़्यादा और कुल से कम होने चाहिए।',
  qtyInvalid: '"{name}" की मात्रा देखें।',
  rateInvalidLine: '"{name}" का रेट देखें।',
  discountInvalid: 'छूट देखें। यह सामान के कुल से ज़्यादा नहीं हो सकती।',
  clearBill: 'बिल साफ़ करें',
  clearBillConfirm: 'इस बिल से सारा सामान हटाएँ? अभी कुछ सेव नहीं हुआ है।',
  clearBillYes: 'हाँ, साफ़ करें',
  newBill: 'नया बिल',
  viewBill: 'बिल देखें',
  savedTitle: 'बिल सेव हो गया',

  pickerHint: 'सामान पर दबाएँ। फिर से दबाने पर एक और जुड़ेगा।',
  oftenSold: 'ज़्यादा बिकने वाले',
  onBill: 'बिल में {n}',
  pickerDone: 'हो गया',
  noItemsToPick: 'अभी कोई सामान नहीं। मालिक "सामान और रेट" में जोड़ सकते हैं।',

  salesTitle: 'बिक्री के बिल',
  allCustomers: 'सभी ग्राहक',
  billsSummary: '{n} बिल · {amount}',
  noBills: 'इन तारीखों में कोई बिल नहीं।',
  waitingUpload: 'अपलोड बाकी',
  uploadFailed: 'अपलोड नहीं हुआ',
  retryUpload: 'फिर से अपलोड करें',
  cancelled: 'रद्द',
  billDate: 'तारीख',
  billTime: 'समय',
  paymentType: 'पेमेंट',
  paid: 'दिए',
  udhaar: 'उधार',
  madeBy: 'किसने बनाया',
  gstBreakup: 'GST का हिसाब',
  gstRateLabel: 'GST {rate}%',
  billNotFound: 'यह बिल नहीं मिला।',
  hsnShort: 'HSN',

  syncWaiting: '{n} बिल अपलोड बाकी',
  syncFailed: '{n} बिल अपलोड नहीं हुए। कारण देखने के लिए बिक्री के बिल खोलें।',
};

const STRINGS: Record<Language, Record<TranslationKey, string>> = { en, hi };
const LANGUAGE_KEY = 'shop_language';

function readStored(): Language | null {
  try {
    const stored = localStorage.getItem(LANGUAGE_KEY);
    return stored === 'en' || stored === 'hi' ? stored : null;
  } catch {
    return null;
  }
}

let current: Language = readStored() ?? 'hi';
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

/** The person tapped the language button: remember it on this phone. */
export function setLanguage(language: Language): void {
  current = language;
  try {
    localStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
  emit();
}

/** Shop default from settings, used only until this phone picks a language. */
export function applyDefaultLanguage(language: Language): void {
  if (readStored() || current === language) return;
  current = language;
  emit();
}

export function translate(language: Language, key: TranslationKey, vars?: Record<string, string | number>): string {
  let text = STRINGS[language][key];
  if (vars) {
    for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}

export function useT() {
  const language = useStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current
  );
  return {
    language,
    t: (key: TranslationKey, vars?: Record<string, string | number>) => translate(language, key, vars),
  };
}
