import { GoogleGenAI, Type } from '@google/genai';
import { BillDiscount, BillLineItem, PaymentMethod } from '../types';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY ?? '';

/** True when a Gemini API key is configured and "fill from photo" can work. */
export const isPhotoFillAvailable = Boolean(apiKey);

/** Error with a message that is safe to show directly to the user. */
export class PhotoReadError extends Error {}

export interface ExtractedBill {
  firmName: string;
  billNo: string;
  billDate: string;
  gstNumber: string;
  lrNo: string;
  transportName: string;
  items: BillLineItem[];
  discounts: BillDiscount[];
  gstAmount: number;
}

export interface ExtractedPayment {
  amount: number;
  paidOn: string;
  method: PaymentMethod | '';
  reference: string;
  bankName: string;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const EXTRACTION_TIMEOUT_MS = 30_000;

// Tried in order. The "lite" models answer in ~5 seconds; if one is over its
// usage limit or overloaded, the next one is tried automatically.
const MODEL_CHAIN = [
  'gemini-flash-lite-latest',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
];

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new PhotoReadError(
              'The photo is taking too long to read. Check your internet and try again, or fill the details by hand.'
            )
          ),
        ms
      )
    ),
  ]);
}

/** Usage limit reached / model overloaded — worth trying the next model. */
function isBusyError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 429 || status === 503) return true;
  return /RESOURCE_EXHAUSTED|quota|UNAVAILABLE|overloaded|high demand/i.test(String(err));
}

async function askGemini(file: File, prompt: string, schema: object): Promise<unknown> {
  const ai = new GoogleGenAI({ apiKey });
  const base64 = await fileToBase64(file);

  for (const model of MODEL_CHAIN) {
    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                { inlineData: { mimeType: file.type || 'image/jpeg', data: base64 } },
                { text: prompt },
              ],
            },
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: schema,
          },
        }),
        EXTRACTION_TIMEOUT_MS
      );
      return JSON.parse(response.text ?? '{}');
    } catch (err) {
      if (isBusyError(err)) continue; // silently switch to the next model
      throw err;
    }
  }

  throw new PhotoReadError(
    'Photo reading is very busy right now. Please wait a minute and try again, or fill the details by hand.'
  );
}

export async function extractBillFromImage(file: File): Promise<ExtractedBill> {
  const schema = {
    type: Type.OBJECT,
    properties: {
      firmName: { type: Type.STRING, description: 'Seller / firm / company name on the bill header' },
      billNo: { type: Type.STRING, description: 'Bill or invoice number' },
      billDate: { type: Type.STRING, description: 'Bill date in YYYY-MM-DD format, empty if not visible' },
      gstNumber: {
        type: Type.STRING,
        description: 'GSTIN / GST number of the seller firm (15 characters like 24ABCDE1234F1Z5), empty if not visible',
      },
      lrNo: { type: Type.STRING, description: 'LR number / lorry receipt number, empty if not visible' },
      transportName: { type: Type.STRING, description: 'Transport / carrier name, empty if not visible' },
      items: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            quantity: { type: Type.NUMBER },
            unit: {
              type: Type.STRING,
              description: 'Unit of the quantity, e.g. Piece, Meter, Kg, Box, Dozen. Empty if not shown.',
            },
            rate: { type: Type.NUMBER },
            amount: { type: Type.NUMBER },
          },
          required: ['name', 'quantity', 'unit', 'rate', 'amount'],
        },
      },
      discounts: {
        type: Type.ARRAY,
        description:
          'Every discount line on the bill, each with its printed name and amount in rupees. Empty array if none.',
        items: {
          type: Type.OBJECT,
          properties: {
            name: {
              type: Type.STRING,
              description: 'Name of the discount as printed, e.g. "Cash Discount", "Special Discount", "Scheme"',
            },
            amount: { type: Type.NUMBER, description: 'Discount amount in rupees (not percent)' },
          },
          required: ['name', 'amount'],
        },
      },
      gstAmount: {
        type: Type.NUMBER,
        description:
          'Total GST / tax amount in rupees ADDED to the bill (CGST + SGST + IGST combined). 0 if no GST is charged.',
      },
    },
    required: [
      'firmName',
      'billNo',
      'billDate',
      'gstNumber',
      'lrNo',
      'transportName',
      'items',
      'discounts',
      'gstAmount',
    ],
  };

  const raw = (await askGemini(
    file,
    'This is a photo of a purchase bill / invoice from an Indian wholesale firm. ' +
      'Read it carefully and extract the details. Dates on Indian bills are usually DD-MM-YYYY or DD/MM/YYYY — convert to YYYY-MM-DD. ' +
      'For each line item extract the item name, quantity, unit, rate per unit and line amount. ' +
      'Bills often have MORE THAN ONE discount line (e.g. Cash Discount, Special Discount, Scheme) — ' +
      'extract every discount separately with its printed name and rupee amount. ' +
      'If a discount is printed as a percentage, calculate the rupee amount from the bill total. ' +
      'GST is usually ADDED after discounts — extract the total GST amount in rupees (add CGST, SGST and IGST together if shown separately). ' +
      'If a field is not visible or unclear, return an empty string (or 0 for numbers). Do not guess.',
    schema
  )) as Partial<ExtractedBill>;

  return {
    firmName: raw.firmName ?? '',
    billNo: raw.billNo ?? '',
    billDate: raw.billDate ?? '',
    gstNumber: raw.gstNumber ?? '',
    lrNo: raw.lrNo ?? '',
    transportName: raw.transportName ?? '',
    items: Array.isArray(raw.items)
      ? raw.items
          .filter((item) => item && (item.name || item.amount))
          .map((item) => ({
            name: item.name ?? '',
            quantity: Number(item.quantity) || 0,
            unit: item.unit ?? '',
            rate: Number(item.rate) || 0,
            amount: Number(item.amount) || 0,
          }))
      : [],
    discounts: Array.isArray(raw.discounts)
      ? raw.discounts
          .filter((d) => d && Number(d.amount) > 0)
          .map((d) => ({
            name: d.name || 'Discount',
            amount: Number(d.amount) || 0,
          }))
      : [],
    gstAmount: Number(raw.gstAmount) || 0,
  };
}

export interface ExtractedTransportBill {
  receivedDate: string;
  transportName: string;
  item: string;
  weight: string;
  biltyNo: string;
  partyName: string;
  amount: number;
}

export async function extractTransportBillFromImage(file: File): Promise<ExtractedTransportBill> {
  const schema = {
    type: Type.OBJECT,
    properties: {
      receivedDate: {
        type: Type.STRING,
        description: 'Date printed on the bilty / receipt in YYYY-MM-DD format, empty if not visible',
      },
      transportName: {
        type: Type.STRING,
        description: 'Name of the transport company that carried the goods (usually the big name in the header)',
      },
      item: {
        type: Type.STRING,
        description: 'Description of the goods / contents of the parcel, e.g. "Cotton bales", "Cloth bundles". Empty if not visible.',
      },
      weight: {
        type: Type.STRING,
        description: 'Weight of the parcel as printed, including the unit, e.g. "250 kg". Empty if not visible.',
      },
      biltyNo: {
        type: Type.STRING,
        description: 'Bilty number / LR number / GR number / consignment note number, empty if not visible',
      },
      partyName: {
        type: Type.STRING,
        description: 'Consignor / sender / party name — the firm that sent the goods. Empty if not visible.',
      },
      amount: {
        type: Type.NUMBER,
        description: 'Total freight / charges to pay in rupees. 0 if not visible.',
      },
    },
    required: ['receivedDate', 'transportName', 'item', 'weight', 'biltyNo', 'partyName', 'amount'],
  };

  const raw = (await askGemini(
    file,
    'This is a photo of a transport bilty / lorry receipt (LR) / goods consignment note from an Indian transport company. ' +
      'Read it carefully and extract the details. Dates are usually DD-MM-YYYY or DD/MM/YYYY — convert to YYYY-MM-DD. ' +
      'The transport name is the carrier company (usually the large name in the header). ' +
      'The party name is the consignor / sender — the firm that booked or sent the goods. ' +
      'The bilty number may be printed as Bilty No, LR No, GR No or C/N No. ' +
      'The weight should include its unit as printed (e.g. "250 kg"). ' +
      'The amount is the total freight / charges to pay in rupees (grand total including hamali, statistical or other charges if shown). ' +
      'If a field is not visible or unclear, return an empty string (or 0 for the amount). Do not guess.',
    schema
  )) as Partial<ExtractedTransportBill>;

  return {
    receivedDate: raw.receivedDate ?? '',
    transportName: raw.transportName ?? '',
    item: raw.item ?? '',
    weight: raw.weight ?? '',
    biltyNo: raw.biltyNo ?? '',
    partyName: raw.partyName ?? '',
    amount: Number(raw.amount) || 0,
  };
}

const PAYMENT_METHODS: PaymentMethod[] = ['Cash', 'Cheque', 'Bank transfer', 'UPI'];

export async function extractPaymentFromImage(file: File): Promise<ExtractedPayment> {
  const schema = {
    type: Type.OBJECT,
    properties: {
      amount: { type: Type.NUMBER, description: 'Amount paid in rupees' },
      paidOn: { type: Type.STRING, description: 'Payment date in YYYY-MM-DD format, empty if not visible' },
      method: {
        type: Type.STRING,
        description: 'One of: Cash, Cheque, Bank transfer, UPI. Empty if unclear.',
      },
      reference: {
        type: Type.STRING,
        description: 'Transaction ID / UTR number / cheque number, empty if not visible',
      },
      bankName: { type: Type.STRING, description: 'Bank or payment app name, empty if not visible' },
    },
    required: ['amount', 'paidOn', 'method', 'reference', 'bankName'],
  };

  const raw = (await askGemini(
    file,
    'This is a screenshot or photo of a payment proof — a UPI/bank transfer screenshot, NEFT/RTGS receipt, or a cheque. ' +
      'Extract the payment details. Convert any DD-MM-YYYY or DD/MM/YYYY date to YYYY-MM-DD. ' +
      'If it looks like a UPI app screenshot (GPay, PhonePe, Paytm) the method is "UPI". ' +
      'If it is a cheque image the method is "Cheque" and the reference is the cheque number. ' +
      'If a field is not visible, return an empty string (or 0 for the amount). Do not guess.',
    schema
  )) as Partial<ExtractedPayment>;

  const method = PAYMENT_METHODS.includes(raw.method as PaymentMethod)
    ? (raw.method as PaymentMethod)
    : '';

  return {
    amount: Number(raw.amount) || 0,
    paidOn: raw.paidOn ?? '',
    method,
    reference: raw.reference ?? '',
    bankName: raw.bankName ?? '',
  };
}
