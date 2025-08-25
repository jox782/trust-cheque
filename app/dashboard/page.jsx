"use client"
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Arabic Cheque Printer (Egypt) – Single-file React App
 * -----------------------------------------------------
 * Features
 * - RTL Arabic UI & cheque output
 * - Bank templates (multiple layouts) with drag-and-drop field positioning
 * - Upload a cheque background per template (PNG/JPG)
 * - Inputs: Payee (Arabic), Amount (number), Date, Memo
 * - Auto convert amount numbers → Arabic words
 * - Live preview, print-ready (browser print)
 * - Save templates & cheques locally (localStorage)
 *
 * Notes
 * - This is a starter you can drop into Cursor. It’s self-contained.
 * - For pixel-perfect alignment, adjust scale at print time and tweak field positions in Edit Layout mode.
 */

// --------------------------- Utilities ---------------------------

const LSK = {
  templates: "cheque.templates.v1",
  lastTemplateId: "cheque.lastTemplateId.v1",
  history: "cheque.history.v1",
};

// Basic Arabic number words (Egyptian standard formal writing).
// Supports integers up to 999,999,999. For larger/edge cases, extend as needed.
function numberToArabicWords(n) {
  n = Number(n);
  if (!isFinite(n)) return "";
  if (n === 0) return "صفر";
  const ones = [
    "",
    "واحد",
    "اثنان",
    "ثلاثة",
    "أربعة",
    "خمسة",
    "ستة",
    "سبعة",
    "ثمانية",
    "تسعة",
    "عشرة",
    "أحد عشر",
    "اثنا عشر",
    "ثلاثة عشر",
    "أربعة عشر",
    "خمسة عشر",
    "ستة عشر",
    "سبعة عشر",
    "ثمانية عشر",
    "تسعة عشر",
  ];
  const tens = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
  const hundreds = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];

  function underThousand(num) {
    let parts = [];
    const h = Math.floor(num / 100);
    const t = num % 100;
    if (h) parts.push(hundreds[h]);
    if (t) {
      if (t < 20) {
        parts.push(ones[t]);
      } else {
        const ten = Math.floor(t / 10);
        const one = t % 10;
        if (one) parts.push(`${ones[one]} و ${tens[ten]}`);
        else parts.push(tens[ten]);
      }
    }
    return parts.join(" و ");
  }

  const scales = [
    { value: 1_000_000_000, sing: "مليار", dual: "ملياران", plural: "مليارات" },
    { value: 1_000_000, sing: "مليون", dual: "مليونان", plural: "ملايين" },
    { value: 1_000, sing: "ألف", dual: "ألفان", plural: "آلاف" },
  ];

  let remainder = n;
  let words = [];
  for (const { value, sing, dual, plural } of scales) {
    if (remainder >= value) {
      const q = Math.floor(remainder / value);
      remainder = remainder % value;
      let qWords = underThousand(q);
      // Arabic pluralization nuance for counted nouns
      let scaleWord = sing;
      if (q === 2) scaleWord = dual;
      else if (q >= 3 && q <= 10) scaleWord = plural;
      else scaleWord = sing;

      if (q === 1) {
        words.push(scaleWord);
      } else if (q === 2) {
        words.push(scaleWord);
      } else {
        words.push(`${qWords} ${scaleWord}`);
      }
    }
  }
  if (remainder) words.push(underThousand(remainder));
  return words.join(" و ");
}

function formatArabicCurrencyWords(amount, currencyMain = "جنيه", currencySub = "قرش") {
  // Expect amount like 1234.56
  const integer = Math.floor(Math.abs(amount));
  const fraction = Math.round((Math.abs(amount) - integer) * 100);
  const integerWords = numberToArabicWords(integer);
  const fractionWords = fraction ? numberToArabicWords(fraction) : "";
  let mainUnit = currencyMain;
  let subUnit = currencySub;
  // Simplified; in formal writing you may inflect units (جنيهاً/قرشاً)
  return fraction
    ? `${integerWords} ${mainUnit} و ${fractionWords} ${subUnit}`
    : `${integerWords} ${mainUnit}`;
}

// Default fields used on most Egyptian cheques
const DEFAULT_FIELDS = [
  { id: "date", label: "التاريخ", bind: "date", x: 70, y: 8, fontSize: 14 },
  { id: "payee", label: "إسم المستفيد", bind: "payee", x: 15, y: 30, fontSize: 18 },
  { id: "amountNum", label: "المبلغ بالأرقام", bind: "amountNum", x: 75, y: 30, fontSize: 18 },
  { id: "amountWords", label: "المبلغ كتابة", bind: "amountWords", x: 10, y: 45, fontSize: 14 },
  { id: "memo", label: "الغرض/ملاحظات", bind: "memo", x: 10, y: 60, fontSize: 12 },
  { id: "signature", label: "التوقيع", bind: "signature", x: 80, y: 80, fontSize: 12 },
];

// Optimized fields for compact cheques (168mm × 80mm)
const COMPACT_FIELDS = [
  { id: "date", label: "التاريخ", bind: "date", x: 85, y: 12, fontSize: 12 },
  { id: "payee", label: "إسم المستفيد", bind: "payee", x: 25, y: 35, fontSize: 16 },
  { id: "amountNum", label: "المبلغ بالأرقام", bind: "amountNum", x: 85, y: 35, fontSize: 16 },
  { id: "amountWords", label: "المبلغ كتابة", bind: "amountWords", x: 20, y: 55, fontSize: 12 },
  { id: "memo", label: "الغرض/ملاحظات", bind: "memo", x: 20, y: 70, fontSize: 10 },
  { id: "signature", label: "التوقيع", bind: "signature", x: 85, y: 85, fontSize: 10 },
];

// Standard cheque dimensions by region
const CHEQUE_DIMENSIONS = {
  egypt: { width: 177.8, height: 88.9, label: "مصر - معيار" },
  bahrain: { width: 177.8, height: 88.9, label: "البحرين - معيار" },
  us_personal: { width: 158.75, height: 69.85, label: "أمريكا - شخصي" },
  us_business: { width: 203.2, height: 88.9, label: "أمريكا - تجاري" },
  uk_standard: { width: 175, height: 88, label: "بريطانيا - معيار" },
  compact: { width: 168, height: 80, label: "مدمج - 168×80 مم" },
  custom: { width: 210, height: 99, label: "مخصص" }
};

// Some sample Egyptian bank templates to start with (positions are illustrative)
const SAMPLE_TEMPLATES = [
  {
    id: "banquemisr",
    name: "Banque Misr (نموذج)",
    bg: null, // user can upload their own background
    widthMM: CHEQUE_DIMENSIONS.egypt.width, // Egyptian standard
    heightMM: CHEQUE_DIMENSIONS.egypt.height,
    fields: DEFAULT_FIELDS,
    dpi: 300,
    printOffsetX: 0,
    printOffsetY: 0,
  },
  {
    id: "nbe",
    name: "NBE – البنك الأهلي المصري (نموذج)",
    bg: null,
    widthMM: CHEQUE_DIMENSIONS.egypt.width,
    heightMM: CHEQUE_DIMENSIONS.egypt.height,
    fields: DEFAULT_FIELDS.map(f => ({ ...f, y: f.y + (f.id === "date" ? 2 : 0) })),
    dpi: 300,
    printOffsetX: 0,
    printOffsetY: 0,
  },
];

function useLocalStorage(key, initial) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {}
  }, [key, state]);
  return [state, setState];
}

// --------------------------- Main App ---------------------------

export default function App() {
  
  const [templates, setTemplates] = useLocalStorage(LSK.templates, SAMPLE_TEMPLATES);
  const [selectedTemplateId, setSelectedTemplateId] = useLocalStorage(LSK.lastTemplateId, templates?.[0]?.id || "banquemisr");
  const currentTemplate = useMemo(() => templates.find(t => t.id === selectedTemplateId) || templates[0], [templates, selectedTemplateId]);

  const [form, setForm] = useState({ payee: "", amount: "", date: new Date().toLocaleDateString("ar-EG"), memo: "", signature: "" });
  const amountNum = useMemo(() => (form.amount || "").toString(), [form.amount]);
  const amountWords = useMemo(() => {
    const n = Number(form.amount);
    if (isNaN(n)) return "";
    return formatArabicCurrencyWords(n, "جنيه مصري", "قرش");
  }, [form.amount]);

  const [editMode, setEditMode] = useState(false);
  const [activeFieldId, setActiveFieldId] = useState(null);

  const chequeRef = useRef(null);

  // mm to px helper (approx using 96dpi by default for screen; print will scale)
  const pxPerMM = 96 / 25.4; // screen render only

  // Save to history (local only)
  const [, setHistory] = useLocalStorage(LSK.history, []);
  const saveCheque = () => {
    const record = {
      id: crypto.randomUUID(),
      templateId: currentTemplate.id,
      form: { ...form, amountWords },
      at: new Date().toISOString(),
    };
    setHistory(prev => [record, ...prev]);
  };

  const updateTemplate = (updater) => {
    setTemplates(prev => prev.map(t => (t.id === currentTemplate.id ? updater(t) : t)));
  };

  const validateAndUpdateDimension = (field, value) => {
    const numValue = Number(value || 0);
    // Reasonable cheque size limits (in mm)
    const minWidth = 100, maxWidth = 250;
    const minHeight = 50, maxHeight = 150;
    
    if (field === 'widthMM') {
      const validWidth = Math.max(minWidth, Math.min(maxWidth, numValue));
      updateTemplate(t => ({ ...t, widthMM: validWidth }));
    } else if (field === 'heightMM') {
      const validHeight = Math.max(minHeight, Math.min(maxHeight, numValue));
      updateTemplate(t => ({ ...t, heightMM: validHeight }));
    }
  };

  const handleBgUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      updateTemplate(t => ({ ...t, bg: reader.result }));
    };
    reader.readAsDataURL(file);
  };

  const addTemplate = () => {
    const id = `tpl_${Date.now()}`;
    const nt = {
      id,
      name: "قالب جديد",
      bg: null,
      widthMM: CHEQUE_DIMENSIONS.egypt.width,
      heightMM: CHEQUE_DIMENSIONS.egypt.height,
      fields: DEFAULT_FIELDS.map(f => ({ ...f })),
      dpi: 300,
      printOffsetX: 0, // Print alignment offset in mm
      printOffsetY: 0,
    };
    setTemplates(prev => [...prev, nt]);
    setSelectedTemplateId(id);
  };

  const applyDimensionPreset = (presetKey) => {
    const preset = CHEQUE_DIMENSIONS[presetKey];
    if (preset) {
      // Use optimized field positions for compact dimensions
      const fieldsToUse = presetKey === 'compact' ? COMPACT_FIELDS : DEFAULT_FIELDS;
      
      updateTemplate(t => ({ 
        ...t, 
        widthMM: preset.width, 
        heightMM: preset.height,
        fields: fieldsToUse.map(f => ({ ...f })) // Create a copy of the fields
      }));
    }
  };

  const removeTemplate = () => {
    if (!confirm("حذف هذا القالب؟")) return;
    setTemplates(prev => prev.filter(t => t.id !== currentTemplate.id));
    setSelectedTemplateId(templates[0]?.id || "");
  };

  // Drag logic
  const onMouseDownField = (e, fld) => {
    if (!editMode) return;
    e.preventDefault();
    setActiveFieldId(fld.id);
    const rect = chequeRef.current.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startPos = { x: fld.x, y: fld.y };

    const onMove = (ev) => {
      const dx = ((ev.clientX - startX) / rect.width) * 100;
      const dy = ((ev.clientY - startY) / rect.height) * 100;
      const newX = Math.min(98, Math.max(0, startPos.x + dx));
      const newY = Math.min(98, Math.max(0, startPos.y + dy));
      updateTemplate(t => ({
        ...t,
        fields: t.fields.map(f => (f.id === fld.id ? { ...f, x: newX, y: newY } : f)),
      }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setActiveFieldId(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const updateField = (id, patch) => {
    updateTemplate(t => ({
      ...t,
      fields: t.fields.map(f => (f.id === id ? { ...f, ...patch } : f)),
    }));
  };

  const autoAdjustPositions = () => {
    // Auto-adjust field positions based on current dimensions
    const { widthMM, heightMM } = currentTemplate;
    
    if (widthMM <= 170 && heightMM <= 85) {
      // Use compact positioning for smaller cheques
      updateTemplate(t => ({
        ...t,
        fields: COMPACT_FIELDS.map(f => ({ ...f }))
      }));
    } else {
      // Use default positioning for standard/larger cheques
      updateTemplate(t => ({
        ...t,
        fields: DEFAULT_FIELDS.map(f => ({ ...f }))
      }));
    }
  };

  const printCheque = () => {
    saveCheque();
    
    // Ensure the cheque is fully rendered before printing
    setTimeout(() => {
      // Create print styles for text-only output on real cheque paper
      const printOffsetX = currentTemplate.printOffsetX || 0;
      const printOffsetY = currentTemplate.printOffsetY || 0;
      
      const printStyles = `
        @media print {
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          
          @page {
            size: ${currentTemplate.widthMM}mm ${currentTemplate.heightMM}mm;
            margin: 0;
          }
          
          body {
            margin: 0;
            padding: 0;
            background: white !important;
          }
          
          /* Hide all UI elements except the cheque text */
          header, .print\\:hidden, 
          main > section:first-child,
          main > section:last-child > div > div:first-child,
          main > section:last-child > div > div:last-child,
          main > section:last-child > div > div:nth-child(3) {
            display: none !important;
          }
          
          /* Make the main container full page */
          main {
            padding: 0 !important;
            margin: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            max-width: none !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            background: white !important;
          }
          
          /* Style the cheque container */
          main > section:last-child {
            box-shadow: none !important;
            background: white !important;
            padding: 0 !important;
            margin: 0 !important;
            width: 100% !important;
            height: 100% !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            border-radius: 0 !important;
          }
          
          main > section:last-child > div {
            box-shadow: none !important;
            border: none !important;
            margin: 0 !important;
            padding: 0 !important;
            border-radius: 0 !important;
            background: white !important;
            width: ${currentTemplate.widthMM}mm !important;
            height: ${currentTemplate.heightMM}mm !important;
          }
          
          /* Style the cheque itself - WHITE BACKGROUND ONLY */
          .cheque-container {
            width: ${currentTemplate.widthMM}mm !important;
            height: ${currentTemplate.heightMM}mm !important;
            border: none !important;
            border-radius: 0 !important;
            background: white !important;
            background-image: none !important;
            position: relative !important;
            overflow: visible !important;
            box-shadow: none !important;
            transform: translate(${printOffsetX}mm, ${printOffsetY}mm) !important;
          }
          
          /* Remove ALL decorative elements */
          .cheque-container > div:not(.absolute) {
            display: none !important;
          }
          
          /* Hide all background images and gradients */
          [style*="background-image"],
          [style*="background-gradient"] {
            background: white !important;
            background-image: none !important;
          }
          
          /* Optimize text rendering for print - BLACK TEXT ONLY */
          .absolute {
            -webkit-font-smoothing: antialiased !important;
            -moz-osx-font-smoothing: grayscale !important;
            color: #000 !important;
            font-weight: 600 !important;
            background: transparent !important;
            text-shadow: none !important;
          }
          
          /* Prevent page breaks inside the cheque */
          .cheque-container {
            page-break-inside: avoid !important;
          }
        }
      `;
      
      const style = document.createElement('style');
      style.textContent = printStyles;
      document.head.appendChild(style);
      
      window.print();
      
      // Clean up after a delay
      setTimeout(() => {
        if (document.head.contains(style)) {
          document.head.removeChild(style);
        }
      }, 1000);
    }, 100);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" dir="rtl">
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-slate-200 print:hidden">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <h1 className="text-xl font-bold">طباعة شيكات – مصر</h1>
          <span className="text-xs text-slate-500">(تجريبي)</span>
          <div className="ms-auto flex items-center gap-2">
            <button className={`px-3 py-1.5 rounded-2xl text-sm border ${editMode ? "bg-amber-100 border-amber-300" : "bg-white"}`} onClick={() => setEditMode(v => !v)}>
              {editMode ? "وضع تعديل التخطيط: مفعل" : "وضع تعديل التخطيط"}
            </button>
            <button className="px-3 py-1.5 rounded-2xl text-sm border" onClick={addTemplate}>قالب جديد</button>
            <button className="px-3 py-1.5 rounded-2xl text-sm border" onClick={printCheque}>طباعة</button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Controls */}
        <section className="lg:col-span-2 bg-white p-4 rounded-2xl shadow print:hidden">
          <h2 className="font-semibold mb-3">البيانات</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 text-sm">البنك / القالب</label>
            <select
              className="col-span-2 border rounded-xl px-3 py-2"
              value={currentTemplate.id}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
            >
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>

            <label className="col-span-2 text-sm">خلفية الشيك (اختياري)</label>
            <input className="col-span-2" type="file" accept="image/*" onChange={handleBgUpload} />

            <label className="col-span-2 text-sm">أبعاد الشيك المعيارية</label>
            <select
              className="col-span-2 border rounded-xl px-3 py-2 text-sm"
              onChange={(e) => applyDimensionPreset(e.target.value)}
              defaultValue=""
            >
              <option value="">اختر أبعاد معيارية...</option>
              {Object.entries(CHEQUE_DIMENSIONS).map(([key, dim]) => (
                <option key={key} value={key}>
                  {dim.label} ({dim.width} × {dim.height} مم)
                </option>
              ))}
            </select>

            <div className="col-span-2 grid grid-cols-3 gap-2 text-sm">
              <div>
                <label className="block text-xs">العرض (مم)</label>
                <input 
                  type="number" 
                  className="w-full border rounded-xl px-2 py-1" 
                  value={currentTemplate.widthMM}
                  min="100" 
                  max="250"
                  onChange={(e) => validateAndUpdateDimension('widthMM', e.target.value)} 
                />
              </div>
              <div>
                <label className="block text-xs">الارتفاع (مم)</label>
                <input 
                  type="number" 
                  className="w-full border rounded-xl px-2 py-1" 
                  value={currentTemplate.heightMM}
                  min="50" 
                  max="150"
                  onChange={(e) => validateAndUpdateDimension('heightMM', e.target.value)} 
                />
              </div>
              <div>
                <label className="block text-xs">دقة الطباعة (dpi)</label>
                <input type="number" className="w-full border rounded-xl px-2 py-1" value={currentTemplate.dpi}
                  onChange={(e) => updateTemplate(t => ({ ...t, dpi: Number(e.target.value || 300) }))} />
              </div>
            </div>

            <div className="col-span-2 mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-xl">
              <label className="block text-sm font-medium mb-2">ضبط محاذاة الطباعة (مم)</label>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <label className="block text-xs">إزاحة X (يسار/يمين)</label>
                  <input 
                    type="number" 
                    step="0.5"
                    className="w-full border rounded-xl px-2 py-1" 
                    value={currentTemplate.printOffsetX || 0}
                    onChange={(e) => updateTemplate(t => ({ ...t, printOffsetX: Number(e.target.value || 0) }))} 
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-xs">إزاحة Y (أعلى/أسفل)</label>
                  <input 
                    type="number" 
                    step="0.5"
                    className="w-full border rounded-xl px-2 py-1" 
                    value={currentTemplate.printOffsetY || 0}
                    onChange={(e) => updateTemplate(t => ({ ...t, printOffsetY: Number(e.target.value || 0) }))} 
                    placeholder="0"
                  />
                </div>
              </div>
              <p className="text-xs text-yellow-700 mt-1">للنص الذي ينزاح يساراً 70مم، جرب قيمة +70 في إزاحة X</p>
              <div className="flex gap-2 mt-2">
                <button 
                  className="px-2 py-1 text-xs bg-red-100 border border-red-300 rounded-lg hover:bg-red-200"
                  onClick={() => updateTemplate(t => ({ ...t, printOffsetX: 70 }))}
                >
                  إصلاح الإزاحة 70مم يساراً
                </button>
                <button 
                  className="px-2 py-1 text-xs bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200"
                  onClick={() => updateTemplate(t => ({ ...t, printOffsetX: 0, printOffsetY: 0 }))}
                >
                  إعادة تعيين
                </button>
              </div>
            </div>

            <hr className="col-span-2 my-2" />

            <label className="col-span-2 text-sm">إسم المستفيد</label>
            <input className="col-span-2 border rounded-xl px-3 py-2" value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} />

            <label className="col-span-2 text-sm">المبلغ (جنيه.قرش)</label>
            <input className="col-span-2 border rounded-xl px-3 py-2" type="number" step="0.01" value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })} />

            <label className="col-span-2 text-sm">التاريخ</label>
            <input className="col-span-2 border rounded-xl px-3 py-2" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />

            <label className="col-span-2 text-sm">ملاحظات</label>
            <input className="col-span-2 border rounded-xl px-3 py-2" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />

            <label className="col-span-2 text-sm">التوقيع (اختياري – نص)</label>
            <input className="col-span-2 border rounded-xl px-3 py-2" value={form.signature} onChange={(e) => setForm({ ...form, signature: e.target.value })} />

            <div className="col-span-2 flex gap-2 mt-2">
              <button className="px-3 py-1.5 rounded-2xl text-sm border" onClick={saveCheque}>حفظ للسجل</button>
              <button className="px-3 py-1.5 rounded-2xl text-sm border" onClick={removeTemplate}>حذف القالب</button>
            </div>
            
            <div className="col-span-2 mt-2">
              <button 
                className="w-full px-3 py-2 rounded-2xl text-sm border border-blue-300 bg-blue-50 hover:bg-blue-100 transition-colors" 
                onClick={autoAdjustPositions}
                title="تعديل مواضع النصوص تلقائياً حسب أبعاد الشيك"
              >
                ضبط المواضع تلقائياً للأبعاد الحالية
              </button>
            </div>
          </div>
        </section>

        {/* Preview / Designer */}
        <section className="lg:col-span-3">
          <div className="bg-white p-4 rounded-2xl shadow">
            <div className="flex items-center gap-2 mb-2 print:hidden">
              <h2 className="font-semibold">المعاينة{editMode ? " (تعديل التخطيط)" : ""}</h2>
              <span className="text-xs text-slate-500">اسحب العناصر لتغيير موضعها عند تفعيل وضع التعديل</span>
            </div>

            <div
              ref={chequeRef}
              className="cheque-container relative mx-auto bg-white border-2 border-slate-800 rounded-xl overflow-hidden shadow-lg"
              style={{
                width: `${currentTemplate.widthMM * pxPerMM}px`,
                height: `${currentTemplate.heightMM * pxPerMM}px`,
                backgroundImage: currentTemplate.bg ? `url(${currentTemplate.bg})` : "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)",
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            >
              {/* Decorative bank cheque elements */}
              {!currentTemplate.bg && (
                <>
                  {/* Top decorative border */}
                  <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-600 via-green-600 to-blue-600"></div>
                  
                  {/* Corner decorative elements */}

                  
                  {/* Watermark pattern */}
                  <div className="absolute inset-0 opacity-5 bg-repeat bg-center" 
                       style={{ backgroundImage: `url("data:image/svg+xml,${encodeURIComponent('<svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><g fill="#000" fill-opacity="0.1"><circle cx="20" cy="20" r="2"/></g></svg>')}")` }}></div>
                  
                
                </>
              )}
              
              {currentTemplate.fields.map((f) => {
                const value = (f.bind === "amountNum"
                  ? amountNum
                  : f.bind === "amountWords"
                  ? amountWords
                  : f.bind === "date"
                  ? form.date
                  : f.bind === "payee"
                  ? form.payee
                  : f.bind === "memo"
                  ? form.memo
                  : f.bind === "signature"
                  ? form.signature
                  : "");
                return (
                  <div
                    key={f.id}
                    onMouseDown={(e) => onMouseDownField(e, f)}
                    className={`absolute select-none cursor-${editMode ? "move" : "default"} ${activeFieldId === f.id ? "ring-2 ring-amber-400" : ""}`}
                    style={{ left: `${f.x}%`, top: `${f.y}%`, transform: "translate(-50%, -50%)" }}
                    title={editMode ? f.label : undefined}
                  >
                    <div
                      className={`px-1 font-medium ${f.bind === 'amountNum' ? 'font-bold text-blue-900' : f.bind === 'payee' ? 'font-semibold' : ''}`}
                      style={{ 
                        fontSize: `${f.fontSize || 14}px`, 
                        lineHeight: 1.2,
                        fontFamily: f.bind === 'amountNum' || f.bind === 'date' ? 'monospace' : 'inherit',
                        letterSpacing: f.bind === 'amountNum' ? '1px' : 'normal'
                      }}
                    >
                      {value}
                    </div>
                    {editMode && (
                      <div className="mt-1 flex items-center gap-1 text-[10px] bg-white/80 rounded px-1 border">
                        <span>{f.label}</span>
                        <input
                          type="number"
                          className="w-12 border rounded px-1"
                          value={f.fontSize || 14}
                          onChange={(e) => updateField(f.id, { fontSize: Number(e.target.value || 1) })}
                          title="حجم الخط"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-between items-center mt-3 print:hidden">
              <div className="text-sm text-slate-500">المبلغ كتابة: <span className="font-medium text-slate-700">{amountWords || "—"}</span></div>
              <button className="px-3 py-1.5 rounded-2xl text-sm border" onClick={printCheque}>طباعة</button>
            </div>
          </div>

                      <div className="text-xs text-slate-500 mt-2 print:hidden">
            <p>نصيحة: للحصول على محاذاة دقيقة على ورقة الشيك الأصلية، قم بطباعة نسخة تجريبية ثم استخدم إعدادات "ضبط محاذاة الطباعة" لتصحيح أي إزاحة.</p>
            <p className="mt-1">الأبعاد المعيارية: مصر/البحرين (177.8×88.9 مم)، أمريكا الشخصي (158.75×69.85 مم)، أمريكا التجاري (203.2×88.9 مم)</p>
            <p className="mt-1 text-amber-600">إذا كان النص ينزاح 70مم يساراً عند الطباعة، اضغط "إصلاح الإزاحة 70مم يساراً" في إعدادات المحاذاة.</p>
          </div>
        </section>
      </main>

      <style>{`
        @media print {
          body { 
            -webkit-print-color-adjust: exact; 
            print-color-adjust: exact;
            margin: 0;
            padding: 0;
            background: white !important;
          }
          header, .print\\:hidden { 
            display: none !important; 
          }
          main { 
            padding: 0 !important; 
            max-width: none !important;
            background: white !important;
          }
          section { 
            box-shadow: none !important; 
            background: white !important;
          }
          
          /* White background only for real cheque paper */
          .cheque-container {
            border: none !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            background: white !important;
            background-image: none !important;
          }
          
          /* Hide decorative elements */
          .cheque-container > div:not(.absolute) {
            display: none !important;
          }
          
          /* Ensure text is crisp and black in print */
          .absolute {
            color: #000 !important;
            text-shadow: none !important;
            background: transparent !important;
            font-weight: 600 !important;
          }
        }
      `}</style>
    </div>
  );
}
