"use client"
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

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

// Convert Western numerals (0123456789) to Arabic-Indic numerals (٠١٢٣٤٥٦٧٨٩)
function toArabicNumerals(str) {
  const arabicNumerals = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  const westernNumerals = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  
  let result = str.toString();
  for (let i = 0; i < westernNumerals.length; i++) {
    result = result.replace(new RegExp(westernNumerals[i], 'g'), arabicNumerals[i]);
  }
  return result;
}

// Default fields used on most Egyptian cheques
const DEFAULT_FIELDS = [
  { id: "date", label: "التاريخ", bind: "date", x: 70, y: 8, fontSize: 14 },
  { id: "payee", label: "إسم المستفيد", bind: "payee", x: 15, y: 30, fontSize: 18 },
  { id: "amountNum", label: "المبلغ بالأرقام", bind: "amountNum", x: 75, y: 30, fontSize: 18 },
  { id: "amountWords", label: "المبلغ كتابة", bind: "amountWords", x: 10, y: 45, fontSize: 14 },
  { id: "amountWords2", label: "2المبلغ كتابة", bind: "amountWords2", x: 10, y: 45, fontSize: 14 },
  { id: "memo", label: "الغرض/ملاحظات", bind: "memo", x: 10, y: 60, fontSize: 12 },
  { id: "signature", label: "التوقيع", bind: "signature", x: 80, y: 80, fontSize: 12 },
];


// Standard cheque dimensions by region
const CHEQUE_DIMENSIONS = {
  egypt: { width: 177.8, height: 88.9, label: "مصر - معيار" },
};

// Some sample Egyptian bank templates to start with (positions are illustrative)
const SAMPLE_TEMPLATES = [
  {
    id: "DEFAULT",
    name: "DEFAULT",
    bg: null, // user can upload their own background
    widthMM: CHEQUE_DIMENSIONS.egypt.width, // Egyptian standard
    heightMM: CHEQUE_DIMENSIONS.egypt.height,
    fields: DEFAULT_FIELDS,
    dpi: 300,
    printOffsetX: 0,
    printOffsetY: 0,
    isDefault: true, // Mark as default template
  }
];

function useLocalStorage(key, initial) {
  const [state, setState] = useState(initial);
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize from localStorage after mounting
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const stored = JSON.parse(raw);
        // If this is templates, merge with default templates to ensure they're always available
        if (key === LSK.templates) {
          const defaultTemplates = initial.filter(t => t.isDefault);
          const userTemplates = stored.filter(t => !t.isDefault);
          const mergedTemplates = [...defaultTemplates, ...userTemplates];
          setState(mergedTemplates);
        } else {
          setState(stored);
        }
      } else {
        setState(initial);
      }
    } catch {
      setState(initial);
    }
    setIsInitialized(true);
  }, []);

  // Save to localStorage when state changes (but only after initialization)
  useEffect(() => {
    if (isInitialized) {
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch {}
    }
  }, [key, state, isInitialized]);

  return [state, setState];
}

// --------------------------- Main App ---------------------------

export default function Dashboard() {
  // Add hydration-safe mounting check
  const [isMounted, setIsMounted] = useState(false);
  
  useEffect(() => {
    setIsMounted(true);
  }, []);
  
  const [templates, setTemplates] = useLocalStorage(LSK.templates, SAMPLE_TEMPLATES);
  const [selectedTemplateId, setSelectedTemplateId] = useLocalStorage(LSK.lastTemplateId, templates?.[0]?.id || "banquemisr");
  const currentTemplate = useMemo(() => templates?.find(t => t.id === selectedTemplateId) || templates[0], [templates, selectedTemplateId]);

  const [form, setForm] = useState({ payee: " ", amount: " ", date: " ", memo: " ", signature: " " });
  
  // Initialize date after mounting to prevent hydration mismatch
  useEffect(() => {
    if (isMounted && !form.date) {
      setForm(prev => ({ ...prev, date: new Date().toLocaleDateString("ar-EG") }));
    }
  }, [isMounted, form.date]);
  
  // Toast notification system
  const [toast, setToast] = useState(null);
  const [isLoading, setIsLoading] = useState({});
  
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };
  
  const setButtonLoading = (buttonId, loading) => {
    setIsLoading(prev => ({ ...prev, [buttonId]: loading }));
  };

  const [editMode, setEditMode] = useState(false);
  const [activeFieldId, setActiveFieldId] = useState(null);
  const [editingTemplate, setEditingTemplate] = useState(false);
  const [tempTemplateName, setTempTemplateName] = useState("");
  const [tempTemplateId, setTempTemplateId] = useState("");
  const [selectedBgFile, setSelectedBgFile] = useState(null);
  const [selectedTemplateFile, setSelectedTemplateFile] = useState(null);
  const [useArabicNumerals, setUseArabicNumerals] = useState(true);
//excel state
const [useExcelRows, setUseExcelRows] = useState([])
const [useCurruntRowIndex, setUseCurruntRowIndex] = useState(null)

  const amountNum = useMemo(() => {
    const amount = (form.amount || "").toString();
    return amount && useArabicNumerals ? toArabicNumerals(amount) : amount;
  }, [form.amount, useArabicNumerals]);
  
  const amountWords = useMemo(() => {
    const n = Number(form.amount);
    if (isNaN(n)) return "";
    return formatArabicCurrencyWords(n, "جنيه مصري", "قرش");
  }, [form.amount]);

  const chequeRef = useRef(null);

  // mm to px helper (approx using 96dpi by default for screen; print will scale)
  const pxPerMM = 96 / 25.4; // screen render only

  // Save to history (local only)
  const [, setHistory] = useLocalStorage(LSK.history, []);
  const saveCheque = () => {
    setButtonLoading('save', true);
    try {
      const record = {
        id: crypto.randomUUID(),
        templateId: currentTemplate.id,
        form: { ...form, amountWords },
        at: new Date().toISOString(),
      };
      setHistory(prev => [record, ...prev]);
      showToast('تم حفظ الشيك في السجل بنجاح', 'success');
    } catch (error) {
      showToast('فشل في حفظ الشيك', 'error');
    } finally {
      setButtonLoading('save', false);
    }
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
    if (!file) {
      setSelectedBgFile(null);
      return;
    }
    
    setSelectedBgFile(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      updateTemplate(t => ({ ...t, bg: reader.result }));
      showToast('تم تحميل خلفية الشيك بنجاح', 'success');
    };
    reader.readAsDataURL(file);
  };

  const addTemplate = () => {
    setButtonLoading('addTemplate', true);
    try {
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
      showToast('تم إنشاء قالب جديد بنجاح', 'success');
    } catch (error) {
      showToast('فشل في إنشاء القالب', 'error');
    } finally {
      setButtonLoading('addTemplate', false);
    }
  };

  const startEditingTemplate = () => {
    setEditingTemplate(true);
    setTempTemplateName(currentTemplate.name);
    setTempTemplateId(currentTemplate?.id);
  };

  const saveTemplateName = () => {
    if (!tempTemplateName.trim()) {
      showToast('Please Enter Template Name', 'error');
      return;
    }
    // if (!tempTemplateId.trim()) {
    //   showToast('Please Enter Template ID', 'error');
    //   return;
    // }
    
    setButtonLoading('saveTemplateName', true);
    try {
      updateTemplate(t => ({ ...t, name: tempTemplateName.trim() }));
      setEditingTemplate(false);
      showToast('تم تحديث اسم القالب بنجاح', 'success');
    } catch (error) {
      showToast('فشل في تحديث اسم القالب', 'error');
    } finally {
      setButtonLoading('saveTemplateName', false);
    }
  };

  const cancelEditingTemplate = () => {
    setEditingTemplate(false);
    setTempTemplateName("");
  };

  //excel fucntions
  const handleExcelImport = async (e) => {
    console.log("excel func1")
    const file = e.target.files?.[0];
    if (!file) 
    {console.log("no excel file");
      return;
    }
     
    let amountWordsEx = "";
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    console.log(json)
    // Skip header row
    const values = json.slice(1).map((row) => ({
      name: row[0],
      amount: row[1],
      date: row[2],
      bank: row[3],
    }));
    console.log("values",values)
    setUseExcelRows(values);
    setUseCurruntRowIndex(0);
    
    if (values.length > 0) {
      // Auto-select bank template based on bank name from Excel
      const firstRow = values[0];
      // autoSelectBankTemplate(firstRow.bank);
      
      // Fill form with first row data
      setForm({
        payee: firstRow.name,
        amount: firstRow.amount,
        date: firstRow.date,
        bank: firstRow.bank,
      });
    }
  };

  const handleNext = () => {
    if (useCurruntRowIndex < useExcelRows.length - 1) {
      const newIndex = useCurruntRowIndex + 1;
      setUseCurruntRowIndex(newIndex);
      const row = useExcelRows[newIndex];
      
      // Auto-select bank template for this row
      // autoSelectBankTemplate(row.bank);
      
      setForm({
        payee: row.name,
        amount: row.amount,
        date: row.date,
        bank: row.bank,
      });
      console.log("form",form)
    }
  };

  const handlePrev = () => {
    if (useCurruntRowIndex > 0) {
      const newIndex = useCurruntRowIndex - 1;
      setUseCurruntRowIndex(newIndex);
      const row = useExcelRows[newIndex];
      
      // Auto-select bank template for this row
      // autoSelectBankTemplate(row.bank);
      
      setForm({
        payee: row.name,
        amount: row.amount,
        date: row.date,
        bank: row.bank,
      });
    }
  };

  const removeTemplate = () => {
    // Prevent deletion of default templates
    if (currentTemplate.isDefault) {
      showToast('لا يمكن حذف القوالب الافتراضية', 'error');
      return;
    }
    
    if (!confirm("حذف هذا القالب؟")) return;
    
    setButtonLoading('removeTemplate', true);
    try {
      setTemplates(prev => prev.filter(t => t.id !== currentTemplate.id));
      setSelectedTemplateId(templates[0]?.id || "");
      showToast('تم حذف القالب بنجاح', 'success');
    } catch (error) {
      showToast('فشل في حذف القالب', 'error');
    } finally {
      setButtonLoading('removeTemplate', false);
    }
  };

  // Export current template
  const exportTemplate = () => {
    try {
      const templateData = JSON.stringify(currentTemplate, null, 2);
      const blob = new Blob([templateData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `template-${currentTemplate.name.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('تم تصدير القالب بنجاح', 'success');
    } catch (error) {
      showToast('فشل في تصدير القالب', 'error');
    }
  };

  // Import template
  const importTemplate = (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      setSelectedTemplateFile(null);
      return;
    }

    setSelectedTemplateFile(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const templateData = JSON.parse(e.target.result);
        
        // Handle both single template and array of templates
        if (Array.isArray(templateData)) {
          // Multiple templates
          const importedTemplates = templateData.map(template => ({
            ...template,
            id: `imported_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: `${template.name} (مستورد)`,
            isDefault: false // Imported templates are not default
          }));
          setTemplates(prev => [...prev, ...importedTemplates]);
          setSelectedTemplateId(importedTemplates[0].id);
          showToast(`تم استيراد ${importedTemplates.length} قالب بنجاح`, 'success');
        } else {
          // Single template
          const newTemplate = { 
            ...templateData, 
            id: `imported_${Date.now()}`,
            name: `${templateData.name} (مستورد)`,
            isDefault: false // Imported templates are not default
          };
          setTemplates(prev => [...prev, newTemplate]);
          setSelectedTemplateId(newTemplate.id);
          showToast('تم استيراد القالب بنجاح', 'success');
        }
      } catch (error) {
        showToast('فشل في استيراد القالب - تأكد من صحة الملف', 'error');
        setSelectedTemplateFile(null);
      }
    };
    reader.readAsText(file);
    // Reset file input after processing
    setTimeout(() => {
      event.target.value = '';
      setSelectedTemplateFile(null);
    }, 2000);
  };

  // Export all templates
  const exportAllTemplates = () => {
    try {
      const allTemplatesData = JSON.stringify(templates, null, 2);
      const blob = new Blob([allTemplatesData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `all-templates-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('تم تصدير جميع القوالب بنجاح', 'success');
    } catch (error) {
      showToast('فشل في تصدير القوالب', 'error');
    }
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

  const printCheque = () => {
    setButtonLoading('print', true);
    saveCheque();
    showToast('جاري تحضير الطباعة...', 'info');
    
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
        setButtonLoading('print', false);
        showToast('تم إرسال الشيك للطباعة', 'success');
      }, 1000);
    }, 100);
  };

  // Show loading state until hydrated
  if (!isMounted) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center" dir="rtl">
        <div className="text-center">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center mx-auto mb-4">
            <span className="text-lg text-white">🏦</span>
          </div>
          <h1 className="text-4xl font-bold text-slate-700">Elite Cheque</h1>
          <h1 className="text-4xl font-bold text-slate-700">مجموعة التيسير الطبية</h1>
          <h1 className="text-4xl font-bold text-slate-700">قطاع تكنولوجيا المعلومات</h1>
          <h1 className="text-xl font-bold text-slate-700">طباعة الشيكات المصرفية</h1>
          <p className="text-sm text-slate-500 mt-2">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" dir="rtl">
      <header className="sticky top-0 z-10 bg-gradient-to-r from-blue-600 to-green-600 text-white border-b border-slate-200 print:hidden">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
              <span className="text-lg">🏦</span>
            </div>
            <div>
              <h1 className="text-xl font-bold">Elite Cheque</h1>
              <span className="text-xs text-blue-100">THG - IT Department</span>
            </div>
          </div>
          <div className="ms-auto flex items-center gap-2">
            <button className={`px-3 py-1.5 rounded-2xl text-sm border transition-colors ${editMode ? "bg-amber-400 border-amber-300 text-amber-900" : "bg-white/10 border-white/20 text-white hover:bg-white/20"}`} onClick={() => setEditMode(v => !v)}>
              {editMode ? "وضع تعديل التخطيط: مفعل" : "وضع تعديل التخطيط"}
            </button>
            <button 
              className="px-3 py-1.5 rounded-2xl text-sm border bg-white/10 border-white/20 text-white hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" 
              onClick={addTemplate}
              disabled={isLoading.addTemplate}
            >
              {isLoading.addTemplate ? 'جاري الإنشاء...' : '➕ قالب جديد'}
            </button>
            
            <button 
              className="w-20 px-3 py-1.5 rounded-2xl text-sm border bg-white text-blue-600 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium" 
              onClick={handlePrev}
              disabled={useExcelRows.length < 1}
            >
              السابق
            </button>
            <button 
              className="px-3 py-1.5 rounded-2xl text-sm border bg-white text-blue-600 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium" 
              disabled={useExcelRows.length < 1}
            >
              {useExcelRows.length > 0 ? `${useCurruntRowIndex + 1} / ${useExcelRows.length}` : '0 / 0'}
            </button>

            <button 
              className=" w-20 px-3 py-1.5 rounded-2xl text-sm border bg-white text-blue-600 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium" 
              onClick={handleNext}
              disabled={useExcelRows.length < 1}
            >
            التالي
            </button>

            <button 
              className="px-3 py-1.5 rounded-2xl text-sm border bg-white text-blue-600 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium" 
              onClick={printCheque}
              disabled={isLoading.print}
            >
              {isLoading.print ? 'جاري التحضير...' : '🖨️ طباعة'}
            </button>
            <button 
              className=" rounded-2xl text-sm border bg-white text-blue-600 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"             >
               {/* Import Excel Button */}
            <div className=" bg-blue-50 border border-blue-200 rounded-xl">
                <div className="relative">
                  <input 
                    id="template-import"
                    type="file" 
                    accept=".xlsx"
                    onChange={handleExcelImport}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    title="Import Excel File"
                  />
                  <label 
                    htmlFor="template-import"
                    className={`flex items-center justify-center px-2 w-full border-2 border-dashed rounded-lg transition-colors cursor-pointer ${
                      selectedTemplateFile 
                        ? 'border-green-400 bg-green-50' 
                        : 'border-blue-300 hover:border-blue-500 hover:bg-blue-100 bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{selectedTemplateFile ? '✅' : '📁'}</span>
                      <div className="text-center">
                        <div className="text-xs font-medium text-blue-700">
                          {selectedTemplateFile ? selectedTemplateFile : 'Select Excel File'}
                        </div>
                        
                      </div>
                    </div>
                  </label>
                </div>
            </div>
            
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Controls */}
        <section className="lg:col-span-2 bg-white p-4 rounded-2xl shadow print:hidden">
          <h2 className="font-semibold mb-3">البيانات</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 text-sm">إسم المستفيد</label>
            <input className="col-span-2 border rounded-xl px-3 py-2" value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} />

            <label className="col-span-2 text-sm">المبلغ (جنيه.قرش)</label>
            <div className="col-span-2 space-y-2">
              <input className="w-full border rounded-xl px-3 py-2" type="number" step="0.01" value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>

            <label className="col-span-2 text-sm">التاريخ</label>
            <div className="col-span-2 space-y-2">
              <input className="w-full border rounded-xl px-3 py-2" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>

            <label className="col-span-2 text-sm">ملاحظات (اختياري)</label>
            <input className="col-span-2 border rounded-xl px-3 py-2" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />

            <label className="col-span-2 text-sm">التوقيع (اختياري)</label>
            <input className="col-span-2 border rounded-xl px-3 py-2" value={form.signature} onChange={(e) => setForm({ ...form, signature: e.target.value })} />

            <div className="col-span-2 flex gap-2 mt-2">
              {/* <button 
                className="px-3 py-1.5 rounded-2xl text-sm border bg-green-50 hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed" 
                onClick={saveCheque}
                disabled={isLoading.save}
                title="حفظ بيانات هذا الشيك في سجل الشيكات المحفوظة محلياً"
              >
                {isLoading.save ? 'جاري الحفظ...' : '💾 حفظ الشيك'}
              </button> */}
              
            </div>
            <label className="col-span-2 text-sm">البنك / القالب</label>
            {editingTemplate ? (
              <div className="col-span-2 gap-2">
                <input 
                  className="flex-1 border rounded-xl px-3 py-2"
                  value={tempTemplateName}
                  onChange={(e) => setTempTemplateName(e.target.value)}
                  placeholder="Template Name"
                  onKeyPress={(e) => e.key === 'Enter' && saveTemplateName()}
                />
                {/* <input 
                  className="flex-1 border rounded-xl px-3 py-2"
                  value={tempTemplateId}
                  onChange={(e) => setTempTemplateId(e.target.value)}
                  placeholder="Template ID"
                  onKeyPress={(e) => e.key === 'Enter' && saveTemplateName()}
                /> */}
                <hr className="my-5" />
                <button 
                  className="px-3 py-2 m-2 bg-green-500 text-white rounded-xl hover:bg-green-600 disabled:opacity-50"
                  onClick={saveTemplateName}
                  disabled={isLoading.saveTemplateName}
                >
                  {isLoading.saveTemplateName ? '...' : '✓'}
                </button>
                <button 
                  className="px-3 py-2 m-2 bg-gray-500 text-white rounded-xl hover:bg-gray-600"
                  onClick={cancelEditingTemplate}
                >
                  ✕
                </button>
                <button 
                className="px-3 py-2 rounded-xl bg-red-400 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed" 
                onClick={removeTemplate}
                disabled={isLoading.removeTemplate || currentTemplate.isDefault}
                title={currentTemplate.isDefault ? 'لا يمكن حذف القوالب الافتراضية' : 'حذف هذا القالب'}
              >
                {isLoading.removeTemplate ? 'جاري الحذف...' : 
                 currentTemplate.isDefault ? '🔒 قالب افتراضي' : 'حذف القالب'}
              </button>
              </div>
            ) : (
              <div className="col-span-2 flex gap-2">
                <select
                  className="flex-1 border rounded-xl px-3 py-2"
                  value={currentTemplate.id}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                >
                  {templates.map(t => (
                    <option key={`${t}-${Math.random(6)}`} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <button 
                  className="px-3 py-2 bg-blue-500 text-white rounded-xl hover:bg-blue-600"
                  onClick={startEditingTemplate}
                  title="تعديل اسم القالب"
                >
                  ✏️
                </button>
              </div>
            )}

            <label className="col-span-2 text-sm">خلفية الشيك (اختياري)</label>
            <div className="col-span-2 space-y-2">
              <div className="relative">
                <input 
                  id="bg-upload" 
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
                  type="file" 
                  accept="image/*" 
                  onChange={handleBgUpload} 
                />
                <label 
                  htmlFor="bg-upload" 
                  className={`flex items-center justify-center w-full px-4 py-3 border-2 border-dashed rounded-xl transition-colors cursor-pointer ${
                    selectedBgFile || currentTemplate.bg 
                      ? 'border-green-400 bg-green-50' 
                      : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'
                  }`}
                >
                  <div className="text-center">
                    <div className="text-2xl mb-1">
                      {selectedBgFile || currentTemplate.bg ? '✅' : '🖼️'}
                    </div>
                    <div className="text-sm font-medium text-gray-700">
                      {selectedBgFile ? selectedBgFile : 
                       currentTemplate.bg ? 'خلفية محملة - اختر أخرى' : 
                       'اختر صورة خلفية الشيك'}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">PNG, JPG, GIF حتى 5MB</div>
                  </div>
                </label>
              </div>
              {currentTemplate.bg && (
                <button 
                  className="w-full px-3 py-1.5 text-xs border border-red-300 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                  onClick={() => {
                    updateTemplate(t => ({ ...t, bg: null }));
                    setSelectedBgFile(null);
                    showToast('تم حذف خلفية الشيك', 'success');
                  }}
                >
                  🗑️ إزالة الخلفية
                </button>
              )}
            </div>
      
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
              {/* X Y Section */}
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
                  className="px-2 py-1 text-xs bg-red-100 border border-red-300 rounded-lg hover:bg-red-200 transition-colors"
                  onClick={() => {
                    updateTemplate(t => ({ ...t, printOffsetX: 70 }));
                    showToast('تم تطبيق إصلاح الإزاحة 70مم', 'success');
                  }}
                >
                  إصلاح الإزاحة 70مم يساراً
                </button>
                <button 
                  className="px-2 py-1 text-xs bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 transition-colors"
                  onClick={() => {
                    updateTemplate(t => ({ ...t, printOffsetX: 0, printOffsetY: 0 }));
                    showToast('تم إعادة تعيين الإزاحة', 'success');
                  }}
                >
                  إعادة تعيين
                </button>
              </div>
            </div>

            <hr className="col-span-2 my-2" />

            {/* Arabic Numerals Toggle */}
            <div className="col-span-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-amber-800">الأرقام العربية</label>
                  <p className="text-xs text-amber-600 mt-1">
                    {useArabicNumerals ? 'الأرقام: ١٢٣٤٥٦٧٨٩٠' : 'الأرقام: 1234567890'}
                  </p>
                </div>
                <button
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    useArabicNumerals ? 'bg-amber-600' : 'bg-gray-300'
                  }`}
                  onClick={() => setUseArabicNumerals(!useArabicNumerals)}
                  title={useArabicNumerals ? 'تغيير إلى الأرقام الإنجليزية' : 'تغيير إلى الأرقام العربية'}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      useArabicNumerals ? '-translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
            {/* Template Import/Export Section */}
            <div className="col-span-2 mt-4 p-3 bg-blue-50 border border-blue-200 rounded-xl">
              <h3 className="text-sm font-medium mb-2">🔄 إدارة القوالب</h3>
              <div className="grid grid-cols-2 gap-2">
                <button 
                  className="px-2 py-1.5 rounded-lg text-xs border bg-white hover:bg-blue-50 transition-colors"
                  onClick={exportTemplate}
                  title="تصدير القالب الحالي كملف JSON"
                >
                  📤 تصدير القالب
                </button>
                <button 
                  className="px-2 py-1.5 rounded-lg text-xs border bg-white hover:bg-blue-50 transition-colors"
                  onClick={exportAllTemplates}
                  title="تصدير جميع القوالب كملف واحد"
                >
                  📦 تصدير الكل
                </button>
              </div>
              <div className="mt-3">
                <label className="block text-xs text-blue-700 mb-2 font-medium">استيراد قالب:</label>
                <div className="relative">
                  <input 
                    id="template-import"
                    type="file" 
                    accept=".json"
                    onChange={importTemplate}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    title="اختر ملف JSON لاستيراد قالب"
                  />
                  <label 
                    htmlFor="template-import"
                    className={`flex items-center justify-center w-full px-3 py-2 border-2 border-dashed rounded-lg transition-colors cursor-pointer ${
                      selectedTemplateFile 
                        ? 'border-green-400 bg-green-50' 
                        : 'border-blue-300 hover:border-blue-500 hover:bg-blue-100 bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{selectedTemplateFile ? '✅' : '📁'}</span>
                      <div className="text-center">
                        <div className="text-xs font-medium text-blue-700">
                          {selectedTemplateFile ? selectedTemplateFile : 'اختر ملف JSON'}
                        </div>
                        <div className="text-xs text-blue-500">
                          {selectedTemplateFile ? 'جاري المعالجة...' : 'قالب واحد'}
                        </div>
                      </div>
                    </div>
                  </label>
                </div>
              </div>
              <p className="text-xs text-blue-600 mt-2">
                💡 نصيحة: صدّر قوالبك للاحتفاظ بها
              </p>
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
                console.log('Rendering field:', f);
                console.log('Form data:', form);
                console.log('currentTemp', currentTemplate);
                let start = "";
                let end = "";
                let space = "";

                if(f.bind === 'amountNum'){
                  start = "#"
                  end = "#"
                }
                if(f.bind === 'amountWords'){
                  start = "فقط" 
                  end = "لا غير"
                  space = " "
                }
                const value = (f.bind === "amountNum"
                  ? amountNum
                  : f.bind === "amountWords"
                  ? amountWords
                  : f.bind === "date"
                  ? (useArabicNumerals ? toArabicNumerals(form.date) : form.date)
                  : f.bind === "payee"
                  ? form.payee
                  : f.bind === "memo"
                  ? form.memo
                  : f.bind === "signature"
                  ? form.signature
                  : "");

                  {/* if(value.length > 50 && f.bind === "amountWords2" ){
                    let firstPart = value.slice(0, 50); // initial cut
                    const lastSpaceIndex = firstPart.lastIndexOf(" ");

                    if (lastSpaceIndex !== -1) {
                    firstPart = value.slice(0, lastSpaceIndex);
                    }
                    amountWordsEx = value.slice(firstPart.length).trim();
                  } */}
                return (
                  <div
                    key={f.id}
                    onMouseDown={(e) => onMouseDownField(e, f)}
                    className={`absolute select-none cursor-${editMode ? "move" : "default"} ${activeFieldId === f.id ? "ring-2 ring-amber-400" : ""}`}
                    style={{ left: `${f.x}%`, top: `${f.y}%`, transform: "translate(-100%, 0%)", width: '50%' }}
                    title={editMode ? f.label : undefined}
                  >
                    <div
                      className={`px-1 font-medium ${f.bind === 'amountNum' ? 'font-bold text-blue-900' : f.bind === 'payee' ? 'font-semibold' : ''}`}
                      style={{ 
                        fontSize: `${f.fontSize || 14}px`, 
                        lineHeight: 2.3,
                        fontFamily: f.bind === 'amountNum' || f.bind === 'date' ? 'monospace' : 'inherit',
                        letterSpacing: f.bind === 'amountNum' ? '1px' : 'normal'
                      }}
                    >
                      {`${start}${space}${value}${space}${end}`}
                    </div>
                    {/* Font Size Edit Box */}
                    {/* {editMode && (
                      <div className="mt-1 flex items-center gap-1 text-[10px] bg-white/80 rounded px-1 border">
                        <span>{f.label}</span>
                        <input
                          type="number"
                          className="w-12 border rounded px-1"
                          value={f.fontSize || 14}
                          min="8"
                          max="72"
                          onChange={(e) => {
                            const newSize = Number(e.target.value);
                            if (newSize >= 8 && newSize <= 72) {
                              updateField(f.id, { fontSize: newSize });
                            }
                          }}
                          onBlur={(e) => {
                            const newSize = Number(e.target.value);
                            if (newSize < 8) updateField(f.id, { fontSize: 8 });
                            if (newSize > 72) updateField(f.id, { fontSize: 72 });
                          }}
                          title="حجم الخط (8-72)"
                        />
                      </div>
                    )} */}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-between items-center mt-3 print:hidden">
              <div className="text-sm text-slate-500 space-y-1">
                <div>المبلغ كتابة: <span className="font-medium text-slate-700">{amountWords || "—"}</span></div>
                {form.amount && (
                  <div className="flex items-center gap-4">
                    <span>المبلغ بالأرقام: <span className="font-mono font-medium text-slate-700">{amountNum || "—"}</span></span>
                    {/* {form.bank && <span>البنك حسب الاكسيل  :<span className="font-mono font-medium text-slate-700"> {form.bank || "—"} </span></span>} */}
                    <span className="text-xs text-amber-600">
                      ({useArabicNumerals ? 'أرقام عربية' : 'أرقام إنجليزية'})
                    </span>
                  </div>
                )}
              </div>
              <button 
                className="px-3 py-1.5 rounded-2xl text-sm border bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed" 
                onClick={printCheque}
                disabled={isLoading.print}
              >
                {isLoading.print ? 'جاري التحضير...' : 'طباعة'}
              </button>
            </div>
          </div>

                      <div className="text-xs text-slate-500 mt-2 print:hidden">
            <p>نصيحة: للحصول على محاذاة دقيقة على ورقة الشيك الأصلية، قم بطباعة نسخة تجريبية ثم استخدم إعدادات "ضبط محاذاة الطباعة" لتصحيح أي إزاحة.</p>
            <p className="mt-1 text-amber-600">إذا كان النص ينزاح 70مم يساراً عند الطباعة، اضغط "إصلاح الإزاحة 70مم يساراً" في إعدادات المحاذاة.</p>
          </div>
        </section>
      </main>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm print:hidden">
          <div className={`px-4 py-3 rounded-xl shadow-lg border-2 animate-pulse ${
            toast.type === 'success' ? 'bg-green-100 border-green-300 text-green-800' :
            toast.type === 'error' ? 'bg-red-100 border-red-300 text-red-800' :
            toast.type === 'info' ? 'bg-blue-100 border-blue-300 text-blue-800' :
            'bg-gray-100 border-gray-300 text-gray-800'
          }`}>
            <div className="flex items-center gap-2">
              <span className="text-lg">
                {toast.type === 'success' ? '✅' :
                 toast.type === 'error' ? '❌' :
                 toast.type === 'info' ? 'ℹ️' : '📝'}
              </span>
              <span className="text-sm font-medium">{toast.message}</span>
              <button 
                className="ml-auto text-lg hover:opacity-70"
                onClick={() => setToast(null)}
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

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
          }import Dashboard from './page';

        }
      `}</style>
    </div>
  );
}
