import { GoogleGenAI, Type } from '@google/genai';
import { BillLineItem, PaymentMethod } from '../types';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY ?? '';

/** True when a Gemini API key is configured and "fill from photo" can work. */
export const isPhotoFillAvailable = Boolean(apiKey);

export interface ExtractedBill {
  firmName: string;
  billNo: string;
  billDate: string;
  lrNo: string;
  transportName: string;
  items: BillLineItem[];
  discount: number;
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

async function askGemini(file: File, prompt: string, schema: object): Promise<unknown> {
  const ai = new GoogleGenAI({ apiKey });
  const base64 = await fileToBase64(file);

  const response = await ai.models.generateContent({
    // "latest" alias: always points to the newest stable Flash model,
    // so this keeps working when Google retires older versions.
    model: 'gemini-flash-latest',
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
  });

  return JSON.parse(response.text ?? '{}');
}

export async function extractBillFromImage(file: File): Promise<ExtractedBill> {
  const schema = {
    type: Type.OBJECT,
    properties: {
      firmName: { type: Type.STRING, description: 'Seller / firm / company name on the bill header' },
      billNo: { type: Type.STRING, description: 'Bill or invoice number' },
      billDate: { type: Type.STRING, description: 'Bill date in YYYY-MM-DD format, empty if not visible' },
      lrNo: { type: Type.STRING, description: 'LR number / lorry receipt number, empty if not visible' },
      transportName: { type: Type.STRING, description: 'Transport / carrier name, empty if not visible' },
      items: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            quantity: { type: Type.NUMBER },
            rate: { type: Type.NUMBER },
            amount: { type: Type.NUMBER },
          },
          required: ['name', 'quantity', 'rate', 'amount'],
        },
      },
      discount: { type: Type.NUMBER, description: 'Total discount amount in rupees, 0 if none' },
    },
    required: ['firmName', 'billNo', 'billDate', 'lrNo', 'transportName', 'items', 'discount'],
  };

  const raw = (await askGemini(
    file,
    'This is a photo of a purchase bill / invoice from an Indian wholesale firm. ' +
      'Read it carefully and extract the details. Dates on Indian bills are usually DD-MM-YYYY or DD/MM/YYYY — convert to YYYY-MM-DD. ' +
      'For each line item extract the item name, quantity, rate per unit and line amount. ' +
      'If a field is not visible or unclear, return an empty string (or 0 for numbers). Do not guess.',
    schema
  )) as Partial<ExtractedBill>;

  return {
    firmName: raw.firmName ?? '',
    billNo: raw.billNo ?? '',
    billDate: raw.billDate ?? '',
    lrNo: raw.lrNo ?? '',
    transportName: raw.transportName ?? '',
    items: Array.isArray(raw.items)
      ? raw.items
          .filter((item) => item && (item.name || item.amount))
          .map((item) => ({
            name: item.name ?? '',
            quantity: Number(item.quantity) || 0,
            rate: Number(item.rate) || 0,
            amount: Number(item.amount) || 0,
          }))
      : [],
    discount: Number(raw.discount) || 0,
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
