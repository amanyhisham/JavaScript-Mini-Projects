 // ===== CONFIG =====
const GROQ_KEY = "";
const MODEL = "llama-3.3-70b-versatile";
const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

// ===== STATE =====
let chats = JSON.parse(localStorage.getItem('aichats_v2') || '[]');
let cid = null;
let files = [];
let renameTarget = null;
let recognition = null;
let isRecording = false;
let isStreaming = false;
let systemPrompt = localStorage.getItem('ai_system_prompt') || '';
let isDark = localStorage.getItem('ai_theme') === 'dark';
let currentTTS = null;
let bookmarks = JSON.parse(localStorage.getItem('ai_bookmarks') || '{}');

// ============================================================
// ===== 🛡️ GLOBAL CRASH-PROOF SAFETY LAYER =====
// ============================================================

// Global uncaught error trap — NEVER let anything reach the browser
window.addEventListener('error', e => {
  e.preventDefault();
  console.error('[Global Error]', e.message, e.filename, e.lineno);
  _safeUnlockUI();
  showToast('حدث خطأ غير متوقع — المحادثة ما زالت تعمل', 'warning');
});
window.addEventListener('unhandledrejection', e => {
  e.preventDefault();
  console.error('[Unhandled Promise]', e.reason);
  _safeUnlockUI();
  showToast('حدث خطأ في الشبكة — يمكنك المتابعة', 'warning');
});

// Unlock UI if ever frozen
function _safeUnlockUI() {
  try {
    isStreaming = false;
    const btn = document.getElementById('send-btn');
    const inp = document.getElementById('msg-input');
    if (btn) btn.disabled = false;
    if (inp) inp.disabled = false;
    // Remove any stuck typing indicators
    document.querySelectorAll('.msg-wrapper').forEach(w => {
      if (w.querySelector('.typing-indicator')) w.remove();
    });
  } catch {}
}

// ── safeApiCall: wraps ANY fetch to Groq with full protection ──
async function safeApiCall(fetchFn, fallbackMsg = null) {
  try {
    const result = await Promise.race([
      fetchFn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000))
    ]);
    return result;
  } catch (err) {
    const msg = err?.message || 'خطأ غير معروف';
    if (msg === 'timeout') {
      showToast('انتهى وقت الانتظار — جرب مرة أخرى', 'warning');
    } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      showToast('تحقق من الإنترنت وحاول مجدداً', 'error');
    } else {
      showToast(msg.slice(0, 60), 'error');
    }
    if (fallbackMsg !== null) return fallbackMsg;
    throw err; // re-throw only if no fallback given
  }
}

// ── safeFileHandler: reads files without freezing or crashing ──
function safeFileHandler(file, onSuccess) {
  try {
    if (!file || !(file instanceof File)) {
      showToast('ملف غير صالح', 'error');
      return;
    }
    const MAX = 8 * 1024 * 1024; // 8MB hard cap
    if (file.size > MAX) {
      showToast(`الملف كبير جداً (الحد 8MB): ${file.name}`, 'error');
      return;
    }
    onSuccess();
  } catch (err) {
    console.error('[safeFileHandler]', err);
    showToast(`تعذّر معالجة الملف: ${file?.name || ''}`, 'error');
  }
}

// ── safeImageHandler: generates image with full fallback chain ──
async function safeImageHandler(prompt) {
  try {
    const result = await generateRealImage(prompt);
    if (result && result.blobUrl) {
      return { success: true, url: result };
    }
  } catch (e1) {
    console.warn('[Image gen failed]', e1);
  }
  // Fallback: try direct URL without blob conversion
  try {
    const englishPrompt = await translatePromptToEnglish(prompt);
    const encoded = encodeURIComponent(englishPrompt + ', high quality');
    const seed = Math.floor(Math.random() * 999999);
    const directUrl = `https://image.pollinations.ai/prompt/${encoded}?width=768&height=512&seed=${seed}&nologo=true`;
    return { success: true, url: { blobUrl: directUrl, originalUrl: directUrl } };
  } catch (e2) {
    console.warn('[Image fallback failed]', e2);
  }
  return { success: false, url: null };
}

// ── safePDFHandler: wraps PDF logic with graceful fallback ──
async function safePDFHandler(buildFn) {
  try {
    return await buildFn();
  } catch (err) {
    console.error('[safePDFHandler]', err);
    showToast('تعذّر إنشاء المستند — سيتم الرد نصياً', 'warning');
    return null;
  }
}

// ── safeLocalStorage: never crash on storage read/write ──
function safeSave(data) {
  try {
    localStorage.setItem('aichats_v2', JSON.stringify(data));
  } catch (e) {
    console.warn('[Storage full or blocked]', e);
    showToast('تحذير: التخزين ممتلئ، قد لا تُحفظ المحادثة', 'warning');
  }
}

// Override save() to use safeSave
function save() { safeSave(chats); }

// ============================================================
// ===== END SAFETY LAYER =====
// ============================================================

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  if (isDark) document.body.classList.add('dark');
  updateThemeBtn();

  document.getElementById('rename-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doRename();
    if (e.key === 'Escape') closeModal();
  });

  if (GROQ_KEY === 'YOUR_GROQ_API_KEY_HERE') {
    document.getElementById('api-notice').classList.remove('hidden');
  }

  updateSysPromptLabel();
  renderSidebar();
  initDragDrop();
  initKeyboardShortcuts();
});

// ===== UTILS =====
// save() is defined in the Safety Layer above (uses safeSave)
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
function now() {
  return new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
}

// ===== TOAST (premium - no more browser alerts) =====
function showToast(msg, type = 'success', duration = 3000) {
  const tc = document.getElementById('toast-container');
  const t = document.createElement('div');
  
  const icons = {
    success: 'ti-check',
    error: 'ti-alert-circle',
    warning: 'ti-alert-triangle',
    info: 'ti-info-circle',
    copy: 'ti-copy',
    trash: 'ti-trash',
    bookmark: 'ti-bookmark'
  };
  
  // Handle old API where second param was icon string
  let icon = icons[type] || type;
  let toastClass = 'toast';
  if (type === 'error') toastClass += ' toast-error';
  else if (type === 'warning') toastClass += ' toast-warning';
  else if (type === 'info') toastClass += ' toast-info';
  
  t.className = toastClass;
  t.innerHTML = `<i class="ti ${icon}"></i><span>${msg}</span>`;
  tc.appendChild(t);
  
  // Trigger animation
  requestAnimationFrame(() => t.classList.add('toast-show'));
  
  setTimeout(() => {
    t.classList.remove('toast-show');
    setTimeout(() => t.remove(), 350);
  }, duration);
}

// Replace all browser confirm/alert/prompt with custom modals
function confirmAction(message, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal confirm-modal">
      <div class="confirm-icon"><i class="ti ti-alert-triangle"></i></div>
      <h3>${message}</h3>
      <div class="modal-btns">
        <button class="btn-s" id="confirm-cancel">إلغاء</button>
        <button class="btn-danger" id="confirm-ok">تأكيد</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('modal-visible'));
  
  const close = () => {
    overlay.classList.remove('modal-visible');
    setTimeout(() => overlay.remove(), 250);
  };
  
  overlay.querySelector('#confirm-cancel').onclick = close;
  overlay.querySelector('#confirm-ok').onclick = () => { close(); onConfirm(); };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

function promptAction(message, defaultVal, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>${message}</h3>
      <input type="text" id="prompt-input" value="${defaultVal || ''}" style="margin-bottom:0">
      <div class="modal-btns" style="margin-top:14px">
        <button class="btn-s" id="prompt-cancel">إلغاء</button>
        <button class="btn-p" id="prompt-ok">حسناً</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('modal-visible'));
  
  const inp = overlay.querySelector('#prompt-input');
  inp.focus(); inp.select();
  
  const close = () => {
    overlay.classList.remove('modal-visible');
    setTimeout(() => overlay.remove(), 250);
  };
  
  const confirm = () => { const v = inp.value.trim(); close(); if (v) onConfirm(v); };
  
  overlay.querySelector('#prompt-cancel').onclick = close;
  overlay.querySelector('#prompt-ok').onclick = confirm;
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') close(); });
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

// ===== THEME =====
function toggleTheme() {
  isDark = !isDark;
  document.body.classList.toggle('dark', isDark);
  localStorage.setItem('ai_theme', isDark ? 'dark' : 'light');
  updateThemeBtn();
}
function updateThemeBtn() {
  const btn = document.getElementById('theme-btn');
  if (btn) btn.innerHTML = isDark ? '<i class="ti ti-sun"></i>' : '<i class="ti ti-moon"></i>';
}

// ===== KEYBOARD SHORTCUTS =====
function initKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); newChat(); }
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); toggleChatSearch(); }
      if (e.key === 'b' || e.key === 'B') { e.preventDefault(); toggleSidebar(); }
    }
    if (e.key === 'Escape') {
      closeAllModals();
      const esm = document.getElementById('export-menu');
      if (esm) esm.classList.add('hidden');
    }
  });
}

function openShortcutsModal() {
  const list = document.getElementById('shortcuts-list');
  const shortcuts = [
    ['Ctrl + N', 'محادثة جديدة'],
    ['Ctrl + K', 'بحث في المحادثة'],
    ['Ctrl + B', 'إخفاء/إظهار الشريط الجانبي'],
    ['Enter', 'إرسال الرسالة'],
    ['Shift + Enter', 'سطر جديد'],
    ['Escape', 'إغلاق النوافذ'],
  ];
  list.innerHTML = shortcuts.map(([k, d]) =>
    `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--surface2);border-radius:8px;">
      <span style="font-size:13px;color:var(--text2)">${d}</span>
      <kbd style="background:var(--surface3);border:1px solid var(--border);padding:3px 8px;border-radius:5px;font-size:12px;font-family:monospace;color:var(--text)">${k}</kbd>
    </div>`
  ).join('');
  document.getElementById('shortcuts-modal').classList.remove('hidden');
}
function closeShortcutsModal() { document.getElementById('shortcuts-modal').classList.add('hidden'); }

// ===== DRAG & DROP =====
function initDragDrop() {
  const overlay = document.getElementById('drag-overlay');
  let dragCounter = 0;
  document.addEventListener('dragenter', e => { e.preventDefault(); dragCounter++; overlay.classList.add('active'); });
  document.addEventListener('dragleave', e => { dragCounter--; if (dragCounter <= 0) { dragCounter = 0; overlay.classList.remove('active'); } });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault(); dragCounter = 0; overlay.classList.remove('active');
    const droppedFiles = Array.from(e.dataTransfer.files);
    droppedFiles.forEach(file => readAndAttachFile(file));
  });
}

// ===== FILE READING — 100% crash-proof =====
function readAndAttachFile(file) {
  safeFileHandler(file, () => {
    const isImage = file.type.startsWith('image/');
    const isPDF   = file.type === 'application/pdf';
    const isDocx  = file.name.endsWith('.docx');
    // All text-like types — including code files
    const textExtensions = ['.txt','.md','.markdown','.js','.ts','.jsx','.tsx',
      '.py','.java','.c','.cpp','.h','.cs','.php','.rb','.go','.rs','.swift',
      '.html','.htm','.css','.scss','.json','.xml','.yaml','.yml','.toml',
      '.sh','.bash','.zsh','.env','.csv','.sql','.r','.m','.kt','.dart',
      '.vue','.svelte','.graphql','.prisma','.tf','.ini','.cfg','.log'];
    const isTxt = file.type.startsWith('text/') ||
                  textExtensions.some(ext => file.name.toLowerCase().endsWith(ext));

    if (isImage) {
      _readImage(file);
    } else if (isTxt) {
      _readText(file);
    } else if (isPDF) {
      _attachPDFRef(file); // async — intentionally not awaited; progress shown via toasts
    } else if (isDocx) {
      _attachDocxRef(file);
    } else {
      // Try to read any unknown file type as text (js, py, csv, md, json, etc.)
      _readUnknownAsText(file);
    }
  });
}

function _readImage(file) {
  try {
    const r = new FileReader();
    r.onload = e => {
      try {
        const data = e.target?.result;
        if (!data) throw new Error('empty result');
        files.push({ name: file.name, type: 'image', data, mimeType: file.type });
        renderAttach();
        showToast(`تم إرفاق الصورة: ${file.name}`, 'success');
      } catch (err) {
        showToast(`فشل معالجة الصورة: ${file.name}`, 'error');
      }
    };
    r.onerror = () => showToast(`فشل قراءة الصورة: ${file.name}`, 'error');
    r.readAsDataURL(file);
  } catch (err) {
    showToast(`خطأ في الصورة: ${file.name}`, 'error');
  }
}

function _readText(file) {
  try {
    const r = new FileReader();
    r.onload = e => {
      try {
        let content = e.target?.result || '';
        // Chunk: max 6000 chars to avoid API token overflow
        if (content.length > 6000) {
          content = content.slice(0, 6000) + '\n\n[... تم اقتطاع المحتوى للحد الأقصى المسموح ...]';
        }
        files.push({ name: file.name, type: 'file', data: null, mimeType: file.type, textContent: content });
        renderAttach();
        showToast(`تم إرفاق الملف: ${file.name}`, 'success');
      } catch (err) {
        showToast(`فشل معالجة الملف: ${file.name}`, 'error');
      }
    };
    r.onerror = () => showToast(`فشل قراءة الملف: ${file.name}`, 'error');
    r.readAsText(file, 'UTF-8');
  } catch (err) {
    showToast(`خطأ في الملف: ${file.name}`, 'error');
  }
}

// Read any unknown file type as text (js, py, csv, json, xml, md, etc.)
function _readUnknownAsText(file) {
  try {
    const r = new FileReader();
    r.onload = e => {
      try {
        let content = e.target?.result || '';
        // Check if it looks like binary (lots of null bytes)
        const sample = content.slice(0, 200);
        const nullCount = (sample.match(/\0/g) || []).length;
        if (nullCount > 10) {
          // Binary file — just attach as reference
          files.push({ name: file.name, type: 'file', data: null, mimeType: file.type, textContent: `[ملف ثنائي: ${file.name} — لا يمكن قراءة المحتوى]` });
          renderAttach();
          showToast(`تم إرفاق: ${file.name}`, 'success');
          return;
        }
        if (content.length > 6000) {
          content = content.slice(0, 6000) + '\n\n[... تم اقتطاع المحتوى ...]';
        }
        files.push({ name: file.name, type: 'file', data: null, mimeType: file.type, textContent: content });
        renderAttach();
        showToast(`تم إرفاق الملف: ${file.name}`, 'success');
      } catch (err) {
        showToast(`فشل معالجة الملف: ${file.name}`, 'error');
      }
    };
    r.onerror = () => {
      // If text read fails, attach as reference
      files.push({ name: file.name, type: 'file', data: null, mimeType: file.type, textContent: `[ملف: ${file.name}]` });
      renderAttach();
      showToast(`تم إرفاق: ${file.name}`, 'success');
    };
    r.readAsText(file, 'UTF-8');
  } catch (err) {
    showToast(`خطأ في الملف: ${file.name}`, 'error');
  }
}

// FIX: Real PDF text extraction using PDF.js (cdnjs).
// Replaces the old placeholder-only approach so the AI can actually read the PDF.
async function _attachPDFRef(file) {
  showToast(`جارٍ قراءة PDF: ${file.name}...`, 'info');

  try {
    // Dynamically load PDF.js only when needed (no impact on page load)
    if (!window.pdfjsLib) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      // Set worker source (required by PDF.js)
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    // Read file as ArrayBuffer
    const arrayBuffer = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });

    // Load PDF document
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const totalPages = pdf.numPages;
    const MAX_PAGES = 20;       // Cap to avoid token overflow
    const MAX_CHARS = 8000;     // Cap total text length

    let fullText = `[ملف PDF: ${file.name} — ${totalPages} صفحة]\n\n`;

    for (let i = 1; i <= Math.min(totalPages, MAX_PAGES); i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ').trim();
      if (pageText) {
        fullText += `--- صفحة ${i} ---\n${pageText}\n\n`;
      }
      // Stop early if we've hit the char limit
      if (fullText.length >= MAX_CHARS) {
        fullText = fullText.slice(0, MAX_CHARS) + '\n\n[... تم اقتطاع المحتوى، الحد الأقصى 8000 حرف ...]';
        break;
      }
    }

    // If no text was extracted (scanned/image-based PDF), fall back gracefully
    if (fullText.trim() === `[ملف PDF: ${file.name} — ${totalPages} صفحة]`) {
      fullText = `[ملف PDF ممسوح ضوئياً: ${file.name}]\nهذا الملف يحتوي على صور فقط ولا يمكن استخراج النص منه مباشرة. يمكنني الإجابة على أسئلة عامة إن وصفت المحتوى.`;
      showToast(`PDF ممسوح ضوئياً — لا يمكن استخراج النص: ${file.name}`, 'warning');
    } else {
      showToast(`تم قراءة PDF بنجاح: ${file.name}`, 'success');
    }

    files.push({ name: file.name, type: 'file', data: null, mimeType: file.type, textContent: fullText });
    renderAttach();

  } catch (err) {
    console.error('[PDF extraction error]', err);
    // Graceful fallback: attach with a minimal placeholder so chat still works
    files.push({
      name: file.name, type: 'file', data: null, mimeType: file.type,
      textContent: `[ملف PDF: ${file.name}]\nتعذّر استخراج النص تلقائياً. يمكنك وصف المحتوى وسأساعدك.`
    });
    renderAttach();
    showToast(`تعذّر قراءة PDF — تم الإرفاق بدون نص: ${file.name}`, 'warning');
  }
}

function _attachDocxRef(file) {
  try {
    files.push({
      name: file.name, type: 'file', data: null, mimeType: file.type,
      textContent: `[ملف Word: ${file.name}]\nيرجى تلخيص هذا الملف أو طرح أسئلة عنه وسأساعدك.`
    });
    renderAttach();
    showToast(`تم إرفاق Word: ${file.name}`, 'success');
  } catch { showToast(`تعذّر إرفاق Word: ${file.name}`, 'error'); }
}

// ===== SIDEBAR TOGGLE =====
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const isMobile = window.innerWidth <= 768;

  if (isMobile) {
    const isOpen = sidebar.classList.contains('mobile-open');
    sidebar.classList.toggle('mobile-open', !isOpen);
    if (overlay) {
      overlay.classList.toggle('active', !isOpen);
      overlay.style.display = !isOpen ? 'block' : 'none';
    }
  } else {
    sidebar.classList.toggle('collapsed');
  }
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebar.classList.remove('mobile-open');
  if (overlay) { overlay.classList.remove('active'); overlay.style.display = 'none'; }
}

// ===== CHAT MANAGEMENT (FIXED - isolated sessions) =====
function newChat() {
  const id = uid();
  // CRITICAL: Each chat starts completely fresh with empty messages
  chats.unshift({ id, title: 'محادثة جديدة', messages: [], createdAt: Date.now(), pinned: false });
  save();
  loadChat(id);
  renderSidebar();
  setTimeout(() => document.getElementById('msg-input').focus(), 50);
  showToast('محادثة جديدة', 'success');
}

function loadChat(id) {
  // CRITICAL FIX: Set cid FIRST before any DOM manipulation
  cid = id;
  const chat = chats.find(c => c.id === id);
  if (!chat) return;
  
  document.getElementById('chat-title-bar').textContent = chat.title;
  const ma = document.getElementById('messages-area');
  const es = document.getElementById('empty-state');
  document.getElementById('followup-area').classList.add('hidden');
  
  // CRITICAL FIX: Always clear messages area when switching chats
  ma.innerHTML = '';
  
  if (chat.messages.length === 0) {
    ma.classList.add('hidden');
    es.classList.remove('hidden');
  } else {
    ma.classList.remove('hidden');
    es.classList.add('hidden');
    // Render only messages belonging to THIS chat
    chat.messages.forEach((m) => addMsgDOM(m.role, m.content, m.attachments || [], false, m.ts, m.id));
    scrollBot();
  }
  renderSidebar();
}

function renderSidebar() {
  const q = document.getElementById('search-input').value.toLowerCase();
  const list = document.getElementById('chats-list');
  let filtered = q ? chats.filter(c => c.title.toLowerCase().includes(q)) : chats;
  const pinned = filtered.filter(c => c.pinned);
  const unpinned = filtered.filter(c => !c.pinned);
  list.innerHTML = '';

  if (pinned.length && !q) {
    const sec = document.createElement('div');
    sec.className = 'sidebar-section';
    sec.textContent = 'المثبتة';
    list.appendChild(sec);
    pinned.forEach(chat => list.appendChild(buildChatItem(chat)));
  }

  if (unpinned.length) {
    if (pinned.length && !q) {
      const sec = document.createElement('div');
      sec.className = 'sidebar-section';
      sec.textContent = 'الأخيرة';
      list.appendChild(sec);
    }
    unpinned.forEach(chat => list.appendChild(buildChatItem(chat)));
  }

  if (!filtered.length) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px">لا توجد نتائج</div>';
  }
}

function buildChatItem(chat) {
  const d = document.createElement('div');
  d.className = 'chat-item' + (chat.id === cid ? ' active' : '');
  d.innerHTML = `
    <i class="ti ti-message" style="font-size:14px;flex-shrink:0;color:var(--text3)"></i>
    <span class="chat-name" title="${chat.title}">${chat.pinned ? '<i class="ti ti-pin chat-pin"></i>' : ''}${chat.title}</span>
    <div class="chat-actions">
      <button class="chat-action-btn ${chat.pinned ? 'pin-active' : ''}" onclick="event.stopPropagation();togglePin('${chat.id}')" title="${chat.pinned ? 'إلغاء التثبيت' : 'تثبيت'}">
        <i class="ti ti-pin"></i>
      </button>
      <button class="chat-action-btn" onclick="event.stopPropagation();openRename('${chat.id}')" title="إعادة تسمية">
        <i class="ti ti-pencil"></i>
      </button>
      <button class="chat-action-btn" onclick="event.stopPropagation();delChat('${chat.id}')" title="حذف">
        <i class="ti ti-trash"></i>
      </button>
    </div>`;
  d.onclick = () => loadChat(chat.id);
  return d;
}

function togglePin(id) {
  const c = chats.find(x => x.id === id);
  if (c) { c.pinned = !c.pinned; save(); renderSidebar(); }
}

function delChat(id) {
  confirmAction('هل تريد حذف هذه المحادثة؟', () => {
    chats = chats.filter(c => c.id !== id);
    save();
    if (cid === id) {
      cid = null;
      document.getElementById('messages-area').innerHTML = '';
      document.getElementById('messages-area').classList.add('hidden');
      document.getElementById('empty-state').classList.remove('hidden');
      document.getElementById('chat-title-bar').textContent = 'Chat AI';
      document.getElementById('followup-area').classList.add('hidden');
    }
    renderSidebar();
    showToast('تم حذف المحادثة', 'trash');
  });
}

function openRename(id) {
  renameTarget = id;
  const c = chats.find(x => x.id === id);
  document.getElementById('rename-input').value = c ? c.title : '';
  document.getElementById('modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('rename-input').focus(), 50);
}
function closeModal() { document.getElementById('modal').classList.add('hidden'); renameTarget = null; }
function doRename() {
  const v = document.getElementById('rename-input').value.trim();
  if (!v || !renameTarget) return closeModal();
  const c = chats.find(x => x.id === renameTarget);
  if (c) { c.title = v; save(); }
  if (cid === renameTarget) document.getElementById('chat-title-bar').textContent = v;
  closeModal(); renderSidebar();
}

function clearCurrentChat() {
  if (!cid) return;
  confirmAction('مسح جميع رسائل هذه المحادثة؟', () => {
    const chat = chats.find(c => c.id === cid);
    if (chat) { chat.messages = []; save(); loadChat(cid); }
  });
}

function closeAllModals() {
  ['modal','sys-modal','prompt-modal','stats-modal','shortcuts-modal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}

// ===== SYSTEM PROMPT =====
function openSystemPromptModal() {
  document.getElementById('sys-input').value = systemPrompt;
  document.getElementById('sys-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('sys-input').focus(), 50);
}
function closeSysModal() { document.getElementById('sys-modal').classList.add('hidden'); }
function saveSysPrompt() {
  systemPrompt = document.getElementById('sys-input').value.trim();
  localStorage.setItem('ai_system_prompt', systemPrompt);
  updateSysPromptLabel();
  closeSysModal();
  showToast('تم حفظ System Prompt', 'success');
}
function updateSysPromptLabel() {
  const el = document.getElementById('sys-prompt-label');
  const chip = document.getElementById('sys-prompt-chip');
  if (systemPrompt) {
    el.textContent = systemPrompt.slice(0, 22) + (systemPrompt.length > 22 ? '...' : '');
    chip.classList.add('active');
  } else {
    el.textContent = 'System Prompt';
    chip.classList.remove('active');
  }
}

// ===== PROMPT LIBRARY =====
const PROMPT_LIBRARY = [
  { name: 'مساعد برمجة', prompt: 'أنت مساعد برمجة خبير. أجب بالعربية، قدم كوداً نظيفاً مع شرح مفصل، واستخدم أفضل الممارسات دائماً.' },
  { name: 'مدرس لغة إنجليزية', prompt: 'أنت معلم لغة إنجليزية ودود ومتمرس. ساعد المستخدم على تعلم اللغة بطريقة تفاعلية وممتعة.' },
  { name: 'كاتب إبداعي', prompt: 'أنت كاتب إبداعي موهوب. أكتب بأسلوب أدبي راقٍ، استخدم الصور البلاغية، وابتكر قصصاً مشوقة.' },
  { name: 'محلل بيانات', prompt: 'أنت محلل بيانات خبير. قدم تحليلات دقيقة ومنطقية، استخدم الأرقام والإحصائيات، وقدم توصيات قابلة للتنفيذ.' },
  { name: 'مستشار قانوني', prompt: 'أنت مستشار قانوني متخصص في القانون العربي. قدم معلومات قانونية دقيقة مع التنبيه دائماً بأن هذا للإرشاد فقط.' },
  { name: 'خبير تسويق', prompt: 'أنت خبير تسويق رقمي. قدم استراتيجيات تسويقية فعالة، أفكاراً إبداعية للمحتوى، وتحليل للمنافسين.' },
];
function openPromptLibrary() {
  const list = document.getElementById('prompt-list');
  list.innerHTML = PROMPT_LIBRARY.map((p, i) =>
    `<div style="padding:12px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:all 0.15s" 
         onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='var(--border)'"
         onclick="applyPrompt(${i})">
      <div style="font-weight:700;font-size:13px;color:var(--text);margin-bottom:4px">${p.name}</div>
      <div style="font-size:12px;color:var(--text2);line-height:1.5">${p.prompt.slice(0, 80)}...</div>
    </div>`
  ).join('');
  document.getElementById('prompt-modal').classList.remove('hidden');
}
function closePromptModal() { document.getElementById('prompt-modal').classList.add('hidden'); }
function applyPrompt(i) {
  systemPrompt = PROMPT_LIBRARY[i].prompt;
  localStorage.setItem('ai_system_prompt', systemPrompt);
  updateSysPromptLabel();
  closePromptModal();
  showToast(`تم تطبيق: ${PROMPT_LIBRARY[i].name}`, 'success');
}

// ===== STATS =====
function openStatsModal() {
  const grid = document.getElementById('stats-grid');
  const totalMsgs = chats.reduce((a, c) => a + c.messages.length, 0);
  const userMsgs = chats.reduce((a, c) => a + c.messages.filter(m => m.role === 'user').length, 0);
  const words = chats.reduce((a, c) => a + c.messages.reduce((b, m) => b + (m.content || '').split(' ').length, 0), 0);
  grid.innerHTML = [
    [chats.length, 'المحادثات'],
    [totalMsgs, 'إجمالي الرسائل'],
    [userMsgs, 'رسائلك'],
    [words.toLocaleString('ar'), 'كلمة تقريباً'],
  ].map(([n, l]) => `<div class="stat-card"><div class="stat-num">${n}</div><div class="stat-label">${l}</div></div>`).join('');
  document.getElementById('stats-modal').classList.remove('hidden');
}
function closeStatsModal() { document.getElementById('stats-modal').classList.add('hidden'); }

// ===== CHAT SEARCH =====
function toggleChatSearch() {
  const bar = document.getElementById('chat-search-bar');
  bar.classList.toggle('hidden');
  if (!bar.classList.contains('hidden')) {
    document.getElementById('chat-search-input').focus();
  } else {
    clearSearchHighlights();
    document.getElementById('search-results-count').textContent = '';
  }
}
function searchInChat() {
  const q = document.getElementById('chat-search-input').value.trim().toLowerCase();
  clearSearchHighlights();
  if (!q) { document.getElementById('search-results-count').textContent = ''; return; }
  const bubbles = document.querySelectorAll('.msg-bubble');
  let count = 0;
  bubbles.forEach(b => {
    const html = b.innerHTML;
    if (b.textContent.toLowerCase().includes(q)) {
      b.innerHTML = html.replace(new RegExp(`(${q})`, 'gi'), '<mark class="highlight">$1</mark>');
      count++;
    }
  });
  document.getElementById('search-results-count').textContent = count ? `${count} نتيجة` : 'لا توجد نتائج';
}
function clearSearchHighlights() {
  document.querySelectorAll('mark.highlight').forEach(m => {
    m.replaceWith(m.textContent);
  });
}

// ===== EXPORT =====
function toggleExportMenu() {
  const menu = document.getElementById('export-menu');
  menu.classList.toggle('hidden');
}
document.addEventListener('click', e => {
  const btn = document.getElementById('export-btn');
  const menu = document.getElementById('export-menu');
  if (btn && menu && !btn.contains(e.target) && !menu.contains(e.target)) {
    menu.classList.add('hidden');
  }
});

function exportChat(format) {
  document.getElementById('export-menu').classList.add('hidden');
  if (!cid) return showToast('لا توجد محادثة للتصدير', 'warning');
  const chat = chats.find(c => c.id === cid);
  if (!chat || !chat.messages.length) return showToast('المحادثة فارغة', 'warning');

  let content = '', ext = format, mime = 'text/plain';

  if (format === 'md') {
    content = `# ${chat.title}\n\n`;
    chat.messages.forEach(m => {
      const role = m.role === 'user' ? '**أنت**' : '**AI**';
      content += `${role}\n\n${m.content || ''}\n\n---\n\n`;
    });
    mime = 'text/markdown';
  } else if (format === 'txt') {
    chat.messages.forEach(m => {
      const role = m.role === 'user' ? 'أنت' : 'AI';
      content += `[${role}]\n${m.content || ''}\n\n`;
    });
  } else if (format === 'json') {
    content = JSON.stringify(chat, null, 2);
    mime = 'application/json';
  }

  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${chat.title}.${ext}`;
  a.click(); URL.revokeObjectURL(url);
  showToast('تم تصدير المحادثة', 'success');
}

function shareChat() {
  document.getElementById('export-menu').classList.add('hidden');
  if (!cid) return;
  const chat = chats.find(c => c.id === cid);
  if (!chat) return;
  let text = `💬 ${chat.title}\n\n`;
  chat.messages.slice(-6).forEach(m => {
    const role = m.role === 'user' ? 'أنت' : 'AI';
    text += `[${role}]: ${(m.content || '').slice(0, 200)}${m.content && m.content.length > 200 ? '...' : ''}\n\n`;
  });
  if (navigator.share) {
    navigator.share({ title: chat.title, text }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text).then(() => showToast('تم نسخ المحادثة', 'copy'));
  }
}

// ===== IMAGE GENERATION - Pollinations.ai (FREE, no key needed) =====
function isImageRequest(text) {
  const keywords = [
    // عربي — فعل "طلع/اطلع"
    'طلع صورة', 'طلعلي صورة', 'اطلع صورة', 'اطلعلي صورة', 'طلعي صورة',
    'طلع لي صورة', 'طلع لى صورة',
    // عربي — بقية الكلمات
    'ارسم', 'رسم', 'صمم', 'أنشئ صورة', 'انشئ صورة', 'اصنع صورة', 'توليد صورة',
    'صورة لـ', 'صورة من', 'اعمل لي صورة', 'عايز صورة', 'عاوز صورة', 'اعمل صورة',
    'ولّد صورة', 'عمل صورة', 'صورة توضيحية', 'رسم توضيحي', 'شعار', 'لوجو', 'لوغو',
    'أيقونة', 'ايقونة', 'صفحة غلاف', 'بانر', 'بوستر', 'تصميم صورة', 'تصميم شعار',
    'تصميم لوجو', 'تصميم ايقونة', 'تصميم بوستر', 'تصميم بانر', 'ماك اب', 'mockup',
    'صورة عن', 'صورة لـ', 'صور عن', 'صور لـ',
    'اعملي صورة', 'اعملي صور', 'اعمل صور', 'عمل لي صورة',
    // إنجليزي
    'generate image', 'draw', 'create image', 'make image', 'design image',
    'generate a picture', 'create a logo', 'draw me', 'paint',
    'generate an image', 'create a picture', 'create picture', 'generate picture',
    'make a picture', 'make picture', 'make an image', 'show me an image',
    'create an image', 'produce an image', 'produce a picture', 'illustration',
    'photo', 'artwork', 'logo', 'icon', 'poster', 'banner', 'visual content', 'mockup'
  ];
  const lower = text.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

async function translatePromptToEnglish(arabicPrompt) {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 120,
        temperature: 0.3,
        messages: [
          { role: 'system', content: 'Translate the image description to concise English for image generation. Return ONLY the English prompt, no explanation, max 20 words.' },
          { role: 'user', content: arabicPrompt }
        ]
      })
    });
    if (!res.ok) return arabicPrompt;
    const d = await res.json();
    return d.choices?.[0]?.message?.content?.trim() || arabicPrompt;
  } catch { return arabicPrompt; }
}

// Fetch image as blob URL — avoids CORS + gives us real timeout control
async function _fetchImageAsBlob(url, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) throw new Error('not an image');
    return URL.createObjectURL(blob);
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function generateRealImage(prompt) {
  const englishPrompt = await translatePromptToEnglish(prompt);
  const cleanPrompt = englishPrompt
    .replace(/^(generate|create|make|draw|design|produce|show me|paint|render)\s+(an?\s+)?(image|picture|photo|illustration|logo|icon|poster|banner|mockup)(\s+of)?/i, '')
    .trim() || englishPrompt;

  const basePrompt = cleanPrompt + ', high quality, detailed';
  const encoded = encodeURIComponent(basePrompt);
  const seed = Math.floor(Math.random() * 999999);

  const candidates = [
    `https://image.pollinations.ai/prompt/${encoded}?width=768&height=512&seed=${seed}&nologo=true&model=flux`,
    `https://image.pollinations.ai/prompt/${encoded}?width=768&height=512&seed=${seed}&nologo=true&model=turbo`,
    `https://image.pollinations.ai/prompt/${encoded}?width=512&height=512&seed=${seed}&nologo=true`,
  ];

  for (const url of candidates) {
    try {
      console.log('[Image] Trying blob fetch:', url.split('?')[0]);
      const blobUrl = await _fetchImageAsBlob(url, 35000);
      return { blobUrl, originalUrl: url };
    } catch (err) {
      console.warn('[Image] Blob failed, using direct URL:', err.message);
      // Return direct URL — browser <img> can load it even if fetch() fails due to CORS/timeout
      return { blobUrl: url, originalUrl: url };
    }
  }

  throw new Error('تعذّر توليد الصورة');
}

function buildImageResponseHTML(prompt, imageData) {
  const safePrompt = prompt.replace(/'/g, "\\'").replace(/"/g, '&quot;');
  // imageData is { blobUrl, originalUrl } or legacy string URL
  const displayUrl = (imageData && imageData.blobUrl) ? imageData.blobUrl : (imageData || '');
  const downloadUrl = (imageData && imageData.originalUrl) ? imageData.originalUrl : displayUrl;

  return `
    <div class="ai-image-wrapper" style="margin-top:10px">
      <div class="ai-image-container" style="border-radius:14px;overflow:hidden;border:1px solid var(--border);box-shadow:var(--shadow);background:var(--surface2);position:relative">
        <img src="${displayUrl}" alt="${safePrompt}"
          style="width:100%;max-width:100%;border-radius:14px;cursor:zoom-in;display:block"
          onerror="this.parentElement.innerHTML='<div style=\\'padding:32px;text-align:center;color:var(--danger);font-size:13px\\'>⚠️ فشل عرض الصورة — اضغط توليد مرة أخرى</div>'">
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <button onclick="downloadImageAsBlob('${downloadUrl}', 'ai-image.jpg', this)"
          style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;background:var(--primary);color:#fff;border-radius:20px;font-size:12.5px;font-weight:600;font-family:var(--font);border:none;cursor:pointer">
          <i class="ti ti-download"></i> تحميل الصورة
        </button>
        <button onclick="regenerateImageFromBtn(this, '${safePrompt}')"
          style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;background:var(--surface2);color:var(--text2);border:1px solid var(--border);border-radius:20px;font-size:12.5px;cursor:pointer;font-weight:600;font-family:var(--font)">
          <i class="ti ti-refresh"></i> توليد مرة أخرى
        </button>
      </div>
    </div>`;
}

// Download image via blob — bypasses CORS restriction on cross-origin download attribute
async function downloadImageAsBlob(imageUrl, filename, btn) {
  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> جاري التحميل...';
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    showToast('تم تحميل الصورة', 'success');
  } catch (err) {
    console.error('[downloadImageAsBlob]', err);
    showToast('تعذّر تحميل الصورة — جرب مرة أخرى', 'error');
  } finally {
    btn.disabled = false; btn.innerHTML = originalHTML;
  }
}

async function regenerateImageFromBtn(btn, originalPrompt) {
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> جاري التوليد...';
  const wrapper = btn.closest('.ai-image-wrapper');
  const container = wrapper?.querySelector('.ai-image-container');
  const existingImg = container?.querySelector('img');
  // Show loading spinner
  if (container) container.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;gap:12px;min-height:200px"><div style="width:36px;height:36px;border:3px solid var(--primary);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite"></div><span style="font-size:13px;color:var(--text2)">جاري التوليد...</span></div>';
  try {
    const result = await generateRealImage(originalPrompt);
    if (container) {
      container.innerHTML = `<img src="${result.blobUrl}" alt="${originalPrompt}" style="width:100%;max-width:100%;border-radius:14px;cursor:zoom-in;display:block">`;
    }
  } catch (err) {
    if (container) container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--danger);font-size:13px">⚠️ فشل توليد الصورة — تحقق من الإنترنت وحاول مجدداً</div>';
    showToast('تعذّر توليد الصورة', 'error');
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-refresh"></i> توليد مرة أخرى';
}

// ===== MESSAGE DOM =====
function addMsgDOM(role, content, atts = [], scroll = true, ts = null, msgId = null) {
  const ma = document.getElementById('messages-area');
  document.getElementById('empty-state').classList.add('hidden');
  ma.classList.remove('hidden');
  const id = msgId || uid();
  const timestamp = ts || now();
  const isBookmarked = bookmarks[id] || false;

  const w = document.createElement('div');
  w.className = 'msg-wrapper';
  w.dataset.msgId = id;

  const row = document.createElement('div');
  row.className = `msg-row ${role}`;

  const av = document.createElement('div');
  av.className = `avatar ${role === 'user' ? 'user' : 'ai'}`;
  av.textContent = role === 'user' ? 'أنت' : 'AI';

  const inner = document.createElement('div');
  inner.className = 'msg-inner';

  const tsEl = document.createElement('div');
  tsEl.className = 'msg-timestamp';
  tsEl.textContent = timestamp;

  const bub = document.createElement('div');
  bub.className = `msg-bubble ${role === 'user' ? 'user' : 'ai'}${isBookmarked ? ' msg-bookmarked' : ''}`;
  bub.innerHTML = formatMsg(content);

  atts.forEach(a => {
    if (a.type === 'image') {
      const img = document.createElement('img');
      img.src = a.data; img.className = 'msg-img'; img.alt = a.name;
      bub.appendChild(img);
    } else {
      const fa = document.createElement('div'); fa.className = 'file-attach';
      fa.innerHTML = `<i class="ti ti-file"></i><span>${a.name}</span>`;
      bub.appendChild(fa);
    }
  });

  // Actions
  const acts = document.createElement('div');
  acts.className = 'msg-actions';

  const cp = makeActBtn('ti-copy', 'نسخ', () => {
    navigator.clipboard.writeText(content);
    showToast('تم النسخ', 'copy');
    cp.innerHTML = '<i class="ti ti-check"></i> تم';
    setTimeout(() => { cp.innerHTML = '<i class="ti ti-copy"></i> نسخ'; }, 1500);
  });
  acts.appendChild(cp);

  const bk = makeActBtn(isBookmarked ? 'ti-bookmark-filled' : 'ti-bookmark', isBookmarked ? 'محفوظ' : 'حفظ', () => {
    bookmarks[id] = !bookmarks[id];
    localStorage.setItem('ai_bookmarks', JSON.stringify(bookmarks));
    bub.classList.toggle('msg-bookmarked', bookmarks[id]);
    bk.innerHTML = `<i class="ti ${bookmarks[id] ? 'ti-bookmark-filled' : 'ti-bookmark'}"></i> ${bookmarks[id] ? 'محفوظ' : 'حفظ'}`;
    showToast(bookmarks[id] ? 'تم الحفظ' : 'تم الإلغاء', 'bookmark');
  });
  acts.appendChild(bk);

  if (role === 'assistant') {
    const tts = makeActBtn('ti-volume', 'استماع', () => speakText(content, tts));
    acts.appendChild(tts);
    const regen = makeActBtn('ti-refresh', 'إعادة', () => regenerateMsg(id));
    acts.appendChild(regen);
  }

  if (role === 'user') {
    const edit = makeActBtn('ti-edit', 'تعديل', () => editMsg(id, content));
    acts.appendChild(edit);
  }

  inner.appendChild(tsEl);
  inner.appendChild(bub);
  inner.appendChild(acts);

  if (role === 'user') { row.appendChild(inner); row.appendChild(av); }
  else { row.appendChild(av); row.appendChild(inner); }

  w.appendChild(row);
  ma.appendChild(w);
  if (scroll) scrollBot();
  return bub;
}

function makeActBtn(icon, label, fn) {
  const btn = document.createElement('button');
  btn.className = 'msg-act-btn';
  btn.innerHTML = `<i class="ti ${icon}"></i> ${label}`;
  btn.onclick = fn;
  return btn;
}

function formatMsg(t) {
  if (!t) return '';
  t = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  t = t.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const langLabel = lang || 'code';
    const escapedCode = code.trim();
    return `<div class="code-block-wrapper">
      <div class="code-block-lang">
        <span>${langLabel}</span>
        <button class="code-copy-btn" onclick="navigator.clipboard.writeText(this.closest('.code-block-wrapper').querySelector('.code-block').textContent);this.innerHTML='<i class=\\'ti ti-check\\'></i>';setTimeout(()=>this.innerHTML='<i class=\\'ti ti-copy\\'></i>',1500)" title="نسخ">
          <i class="ti ti-copy"></i>
        </button>
      </div>
      <div class="code-block">${escapedCode}</div>
    </div>`;
  });
  t = t.replace(/`([^`]+)`/g, '<code style="background:var(--code-bg);padding:1px 6px;border-radius:4px;font-family:monospace;font-size:12.5px;color:var(--code-text);">$1</code>');
  t = t.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*(.*?)\*/g, '<em>$1</em>');
  t = t.replace(/^#{3}\s(.+)/gm, '<h5 style="margin:10px 0 4px;font-size:14px;font-weight:700;color:var(--text)">$1</h5>');
  t = t.replace(/^#{2}\s(.+)/gm, '<h4 style="margin:12px 0 5px;font-size:15px;font-weight:800;color:var(--text)">$1</h4>');
  t = t.replace(/^#{1}\s(.+)/gm, '<h3 style="margin:14px 0 6px;font-size:16px;font-weight:800;color:var(--text)">$1</h3>');
  t = t.replace(/^[-*]\s(.+)/gm, '<li style="margin:3px 0;padding-right:4px;list-style:none;display:flex;gap:6px;align-items:flex-start"><span style="color:var(--primary);margin-top:4px;font-size:10px">●</span><span>$1</span></li>');
  t = t.replace(/\n/g, '<br>');
  return t;
}

function scrollBot() {
  const m = document.getElementById('messages-area');
  setTimeout(() => { m.scrollTop = m.scrollHeight; }, 50);
}

function fillMsg(t) {
  document.getElementById('msg-input').value = t;
  document.getElementById('msg-input').style.height = 'auto';
  document.getElementById('msg-input').style.height = Math.min(document.getElementById('msg-input').scrollHeight, 120) + 'px';
  document.getElementById('msg-input').focus();
}

function handleInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
}

// ===== FILE ATTACH =====
function attachFile(inp) {
  Array.from(inp.files).forEach(file => readAndAttachFile(file));
  inp.value = '';
}

function renderAttach() {
  const p = document.getElementById('attach-preview');
  if (!files.length) { p.classList.add('hidden'); return; }
  p.classList.remove('hidden'); p.innerHTML = '';
  files.forEach((f, i) => {
    const d = document.createElement('div'); d.className = 'attach-item';
    const icon = f.type === 'image' ? 'ti-photo' : 'ti-file';
    d.innerHTML = `<i class="ti ${icon}"></i><span>${f.name}</span><button onclick="files.splice(${i},1);renderAttach()"><i class="ti ti-x"></i></button>`;
    p.appendChild(d);
  });
}

// ===== EDIT & REGENERATE =====
function editMsg(msgId, originalContent) {
  const chat = chats.find(c => c.id === cid);
  if (!chat) return;
  const idx = chat.messages.findIndex(m => m.id === msgId);
  if (idx === -1) return;

  promptAction('تعديل الرسالة:', originalContent, (newText) => {
    if (newText.trim() === originalContent.trim()) return;
    chat.messages.splice(idx);
    chat.messages.push({ role: 'user', content: newText.trim(), attachments: [], ts: now(), id: uid() });
    save();
    loadChat(cid);
    getAIResponse(chat);
  });
}

function regenerateMsg(msgId) {
  const chat = chats.find(c => c.id === cid);
  if (!chat) return;
  const idx = chat.messages.findIndex(m => m.id === msgId);
  if (idx === -1) return;
  chat.messages.splice(idx);
  save();
  loadChat(cid);
  getAIResponse(chat);
}

// ===== SEND MESSAGE — fully crash-proof =====
async function sendMsg() {
  try {
    const inp = document.getElementById('msg-input');
    const text = inp.value.trim();
    if (!text && !files.length) return;
    if (isStreaming) return;

    if (!cid) newChat();
    const activeCid = cid;
    const chat = chats.find(c => c.id === activeCid);
    if (!chat) return;

    const btn = document.getElementById('send-btn');
    btn.disabled = true; inp.disabled = true;

    const atts = [...files]; files = []; renderAttach();
    inp.value = ''; inp.style.height = 'auto';

    const msgId = uid();
    const umsg = { role: 'user', content: text, attachments: atts, ts: now(), id: msgId };
    chat.messages.push(umsg);

    if (chat.messages.length === 1 && text) {
      chat.title = text.length > 35 ? text.slice(0, 35) + '...' : text;
      try { document.getElementById('chat-title-bar').textContent = chat.title; } catch {}
      renderSidebar();
    }

    addMsgDOM('user', text, atts, true, umsg.ts, msgId);
    save();

    try { document.getElementById('followup-area').classList.add('hidden'); } catch {}

    if (isPDFRequest(text) && !atts.some(a => a.type === 'image') && !atts.some(a => a.mimeType === 'application/pdf')) {
      await handlePDFRequest(text, chat, activeCid, btn, inp);
      return;
    }

    if (isImageRequest(text) && !atts.some(a => a.type === 'image')) {
      await handleImageRequest(text, chat, activeCid, btn, inp);
      return;
    }

    await getAIResponse(chat, btn, inp, activeCid);

  } catch (fatal) {
    console.error('[sendMsg FATAL]', fatal);
    _safeUnlockUI();
    showToast('حدث خطأ — يمكنك المتابعة', 'error');
  }
}

// ===== PDF GENERATION =====
function isPDFRequest(text) {
  const keywords = [
    // PDF صريح
    'اعمل pdf', 'اعملي pdf', 'انشئ pdf', 'أنشئ pdf', 'ولّد pdf', 'generate pdf',
    'create pdf', 'make pdf', 'اعمل ملف pdf', 'اكتب pdf', 'عايز pdf', 'عاوز pdf',
    'pdf عن', 'pdf لـ',
    // تقرير
    'اعمل تقرير', 'اعملي تقرير', 'انشئ تقرير', 'أنشئ تقرير',
    'اكتب تقرير', 'اكتبي تقرير', 'عاوز تقرير', 'عايز تقرير',
    'طلع تقرير', 'طلعلي تقرير', 'اطلع تقرير',
    'تقرير عن', 'تقرير لـ', 'تقرير حول',
    'اعمل ملخص', 'اعملي ملخص', 'انشئ ملخص', 'اكتب ملخص',
    'generate report', 'create report', 'make report', 'write report'
  ];
  const lower = text.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

// ── PDF via HTML print window — the ONLY reliable way to render Arabic in PDF ──
// jsPDF cannot shape Arabic characters correctly (outputs garbage). Instead we:
// 1. Build a styled HTML page with proper RTL + Arabic font (Cairo via Google Fonts)
// 2. Open it in a hidden print window
// 3. Return a blob URL of that HTML so the download button works immediately,
//    and the preview button lets the user Ctrl+P / Save as PDF from the browser.
function _buildHTMLPDF(title, aiContent, dateStr) {

  // Convert markdown-ish content to clean HTML paragraphs
  function markdownToHTML(text) {
    const lines = text
      .replace(/```[\s\S]*?```/g, match => `<pre class="code">${match.replace(/```\w*\n?/g, '').trim()}</pre>`)
      .split('\n');

    let html = '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { html += '<br>'; continue; }
      if (line.startsWith('# '))   { html += `<h1>${line.slice(2)}</h1>`; continue; }
      if (line.startsWith('## '))  { html += `<h2>${line.slice(3)}</h2>`; continue; }
      if (line.startsWith('### ')) { html += `<h3>${line.slice(4)}</h3>`; continue; }
      if (line.startsWith('- ') || line.startsWith('* ')) {
        html += `<li>${line.slice(2).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</li>`;
        continue;
      }
      if (/^\d+\.\s/.test(line)) {
        html += `<li class="num">${line.replace(/^\d+\.\s/, '')}</li>`;
        continue;
      }
      const para = line
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>');
      html += `<p>${para}</p>`;
    }
    return html;
  }

  const bodyHTML = markdownToHTML(aiContent);
  const safeTitle = title.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const htmlContent = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Cairo', Arial, sans-serif;
      direction: rtl;
      text-align: right;
      color: #1e1e2f;
      background: #fff;
      padding: 0;
      line-height: 1.9;
      font-size: 14px;
    }
    .header {
      background: linear-gradient(135deg, #7C5CFF, #c47eff, #FF7AB6);
      color: white;
      padding: 28px 36px 22px;
      margin-bottom: 36px;
    }
    .header .brand {
      font-size: 12px;
      opacity: 0.8;
      margin-bottom: 8px;
      text-align: left;
    }
    .header h1 {
      font-size: 22px;
      font-weight: 800;
      margin-bottom: 6px;
    }
    .header .date {
      font-size: 12px;
      opacity: 0.75;
    }
    .content {
      padding: 0 40px 40px;
    }
    h1 { font-size: 20px; font-weight: 800; color: #7C5CFF; margin: 24px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #7C5CFF; }
    h2 { font-size: 17px; font-weight: 700; color: #7C5CFF; margin: 20px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e0d9ff; }
    h3 { font-size: 15px; font-weight: 700; color: #6b6b7a; margin: 16px 0 6px; }
    p  { margin: 6px 0; color: #1e1e2f; font-size: 13.5px; }
    li { margin: 5px 0 5px 0; padding-right: 16px; position: relative; font-size: 13.5px; list-style: none; }
    li::before { content: "●"; color: #7C5CFF; position: absolute; right: 0; font-size: 9px; top: 5px; }
    li.num::before { content: none; }
    li.num { padding-right: 4px; }
    strong { font-weight: 700; color: #1e1e2f; }
    em { font-style: italic; color: #555; }
    pre.code { background: #f4f0ff; border: 1px solid #ddd6ff; border-radius: 8px; padding: 12px 16px; font-family: monospace; font-size: 12px; direction: ltr; text-align: left; margin: 12px 0; white-space: pre-wrap; color: #1e1e2f; }
    br { display: block; margin: 2px 0; content: ""; }
    .footer { margin-top: 40px; padding: 16px 40px; border-top: 1px solid #eaeaf5; font-size: 11px; color: #aaa; text-align: center; }
    @media print {
      body { font-size: 13px; }
      .header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
    }
    .print-btn {
      position: fixed;
      top: 16px;
      left: 16px;
      background: #7C5CFF;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 20px;
      font-family: 'Cairo', sans-serif;
      font-size: 14px;
      cursor: pointer;
      font-weight: 700;
      box-shadow: 0 2px 12px rgba(124,92,255,0.35);
      z-index: 9999;
    }
    .print-btn:hover { background: #6b4eee; }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">🖨️ حفظ كـ PDF</button>
  <div class="header">
    <div class="brand">Chat AI — Made by Amany 2026</div>
    <h1>${safeTitle}</h1>
    <div class="date">${dateStr}</div>
  </div>
  <div class="content">
    ${bodyHTML}
  </div>
  <div class="footer">تم إنشاؤه بواسطة Chat AI — ${dateStr}</div>
</body>
</html>`;

  return htmlContent;
}

async function handlePDFRequest(text, chat, activeCid, btn, inp) {
  isStreaming = true;
  const typing = showTyping();

  try {
    // 1. Get AI content
    const aiContent = await safeApiCall(() => callGroq([
      ...chat.messages.slice(0, -1),
      {
        role: 'user',
        content: `اكتب محتوى تفصيلياً ومنظماً بالعربية عن: "${text}".
قسّم المحتوى بعناوين واضحة (استخدم ## للعناوين الرئيسية و### للفرعية) وفقرات منظمة.
استخدم قوائم (- بند) عند الحاجة. يجب أن يكون المحتوى احترافياً وشاملاً.
لا تستخدم جداول أو كود برمجي.`,
        attachments: []
      }
    ]), '');

    typing.remove();
    if (cid !== activeCid) { isStreaming = false; btn.disabled = false; inp.disabled = false; return; }

    if (!aiContent) {
      showToast('لم يتمكن AI من توليد المحتوى', 'warning');
      await getAIResponse(chat, btn, inp, activeCid);
      return;
    }

    const title = text
      .replace(/اعمل(ي)? (pdf|تقرير|ملخص) (عن|لـ|لـ|حول)?/gi, '')
      .replace(/(pdf|تقرير|ملخص) (عن|لـ|حول)/gi, '')
      .replace(/طلع(لي|لى|ي)? (تقرير|pdf|ملخص)/gi, '')
      .replace(/(generate|create|make|write) (pdf|report|summary)/gi, '')
      .trim() || text;

    const dateStr = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
    const fileName = `${title.slice(0, 35).replace(/[^\u0600-\u06FFa-zA-Z0-9 ]/g, '') || 'تقرير'}.html`.trim();

    // 2. Build HTML-based report (correct Arabic — no jsPDF garbage encoding)
    showToast('جاري إنشاء التقرير...', 'info', 2000);
    const htmlContent = _buildHTMLPDF(title, aiContent, dateStr);
    const htmlBlob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const previewUrl = URL.createObjectURL(htmlBlob);

    // 3. Build response UI
    const previewText = aiContent.replace(/[#*`]/g, '').slice(0, 260);

    const pdfResponseHTML = `
      <div style="margin-top:10px">
        <div style="background:linear-gradient(135deg,rgba(124,92,255,0.08),rgba(255,122,182,0.08));border:1px solid var(--border);border-radius:14px;padding:18px 20px;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
            <div style="width:44px;height:44px;background:linear-gradient(135deg,#7C5CFF,#FF7AB6);border-radius:12px;display:flex;align-items:center;justify-content:center;color:white;font-size:22px;flex-shrink:0">📄</div>
            <div>
              <div style="font-weight:700;font-size:14px;color:var(--text)">${fileName}</div>
              <div style="font-size:12px;color:var(--text2);margin-top:2px">افتح التقرير ← اضغط 🖨️ أو Ctrl+P ← اختر Save as PDF</div>
            </div>
          </div>
          <div style="font-size:12.5px;color:var(--text2);line-height:1.8;max-height:90px;overflow:hidden;border-top:1px solid var(--border);padding-top:10px;margin-top:4px">${previewText}...</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <a href="${previewUrl}" target="_blank"
            style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;background:var(--primary);color:#fff;border-radius:20px;font-size:13px;text-decoration:none;font-weight:700;font-family:var(--font);box-shadow:0 2px 8px rgba(124,92,255,0.3)">
            <i class="ti ti-eye"></i> فتح التقرير
          </a>
          <a href="${previewUrl}" download="${fileName}"
            style="display:inline-flex;align-items:center;gap:6px;padding:9px 16px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:20px;font-size:13px;text-decoration:none;font-weight:600;font-family:var(--font)">
            <i class="ti ti-download"></i> تحميل
          </a>
        </div>
        <div style="margin-top:8px;font-size:11.5px;color:var(--text3);padding-right:2px">
          💡 افتح التقرير ← اضغط زر <strong>🖨️ حفظ كـ PDF</strong> في أعلى الصفحة
        </div>
      </div>`;

    const plainText = `تم إنشاء تقرير عن: "${title}"`;
    const aiMsgId = uid();
    chat.messages.push({ role: 'assistant', content: plainText + '\n\n' + aiContent, attachments: [], ts: now(), id: aiMsgId });
    save();

    const bub = addMsgDOM('assistant', plainText, [], true, now(), aiMsgId);
    bub.innerHTML = `<p style="font-size:13.5px;margin-bottom:6px">📄 تم إنشاء التقرير بنجاح!</p>` + pdfResponseHTML;
    showToast('تم إنشاء التقرير!', 'success');

  } catch (err) {
    console.error('[handlePDFRequest]', err);
    if (typing.parentNode) typing.remove();
    showToast('حدث خطأ — سيتم الرد نصياً', 'warning');
    await getAIResponse(chat, btn, inp, activeCid);
    return;
  }

  isStreaming = false;
  btn.disabled = false; inp.disabled = false;
  inp.focus();
}

// Handle image generation requests — 100% crash-proof
async function handleImageRequest(text, chat, activeCid, btn, inp) {
  isStreaming = true;

  // Show typing with image-specific message
  const ma = document.getElementById('messages-area');
  ma.classList.remove('hidden');
  const typingW = document.createElement('div'); typingW.className = 'msg-wrapper';
  const typingRow = document.createElement('div'); typingRow.className = 'msg-row';
  const typingAv = document.createElement('div'); typingAv.className = 'avatar ai'; typingAv.textContent = 'AI';
  const typingInner = document.createElement('div'); typingInner.className = 'msg-inner';
  const typingBub = document.createElement('div'); typingBub.className = 'msg-bubble ai';
  typingBub.innerHTML = '<div style="display:flex;align-items:center;gap:10px"><div style="width:24px;height:24px;border:2.5px solid var(--primary);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0"></div><span style="font-size:13px;color:var(--text2)">🎨 جاري توليد الصورة... قد يستغرق 20-30 ثانية</span></div>';
  typingInner.appendChild(typingBub);
  typingRow.appendChild(typingAv); typingRow.appendChild(typingInner);
  typingW.appendChild(typingRow); ma.appendChild(typingW);
  scrollBot();

  try {
    const result = await safeImageHandler(text);

    typingW.remove();
    if (cid !== activeCid) {
      isStreaming = false;
      btn.disabled = false; inp.disabled = false;
      return;
    }

    let imgHtml;
    let plainText;

    if (result.success && result.url) {
      imgHtml = buildImageResponseHTML(text, result.url);
      plainText = `تم توليد صورة لـ: "${text}"`;
    } else {
      // Graceful fallback — never crash
      imgHtml = _buildImageFallbackHTML(text);
      plainText = `طلبك: "${text}" — تعذّر توليد الصورة حالياً، جرب لاحقاً.`;
      showToast('تعذّر توليد الصورة — تحقق من الإنترنت', 'warning');
    }

    const aiMsgId = uid();
    const am = { role: 'assistant', content: plainText, attachments: [], ts: now(), id: aiMsgId };
    chat.messages.push(am);
    save();

    const bub = addMsgDOM('assistant', plainText, [], true, am.ts, aiMsgId);
    bub.innerHTML = `<p style="font-size:13.5px;margin-bottom:4px;color:var(--text2)">🎨 <strong style="color:var(--text)">${text}</strong></p>` + imgHtml;

  } catch (e) {
    // Last resort — NEVER crash the chat
    console.error('[handleImageRequest]', e);
    if (typingW.parentNode) typingW.remove();
    const fallback = `عذراً، تعذّر توليد الصورة. تحقق من اتصالك بالإنترنت وحاول مجدداً.`;
    const fid = uid();
    chat.messages.push({ role: 'assistant', content: fallback, attachments: [], ts: now(), id: fid });
    save();
    addMsgDOM('assistant', fallback, [], true, now(), fid);
    showToast('تعذّر توليد الصورة', 'error');
  }

  isStreaming = false;
  btn.disabled = false; inp.disabled = false;
  inp.focus();
}

// Fallback UI when image generation fails completely
function _buildImageFallbackHTML(prompt) {
  return `
    <div style="margin-top:8px;border:1.5px dashed var(--border);border-radius:14px;padding:28px 20px;text-align:center;background:var(--surface2)">
      <div style="font-size:42px;margin-bottom:10px">🎨</div>
      <div style="font-size:13.5px;font-weight:700;color:var(--text);margin-bottom:6px">تعذّر توليد الصورة حالياً</div>
      <div style="font-size:12.5px;color:var(--text2);line-height:1.7;margin-bottom:14px">"${prompt.slice(0,80)}"</div>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        <a href="https://pollinations.ai" target="_blank" style="padding:6px 14px;background:var(--primary);color:#fff;border-radius:16px;font-size:12px;text-decoration:none;font-weight:600">Pollinations.ai</a>
        <a href="https://midjourney.com" target="_blank" style="padding:6px 14px;background:var(--surface3);color:var(--text2);border-radius:16px;font-size:12px;text-decoration:none;font-weight:600">Midjourney</a>
      </div>
    </div>`;
}

async function getAIResponse(chat, btn, inp, targetCid) {
  if (!btn) btn = document.getElementById('send-btn');
  if (!inp) inp = document.getElementById('msg-input');
  if (!targetCid) targetCid = cid;

  isStreaming = true;
  try { btn.disabled = true; inp.disabled = true; } catch {}

  const typing = showTyping();

  try {
    const aiText = await safeApiCall(
      () => callGroq(chat.messages),
      null // null = re-throw, let catch block handle it
    );

    try { typing.remove(); } catch {}

    if (cid !== targetCid) {
      try {
        const targetChat = chats.find(c => c.id === targetCid);
        if (targetChat && aiText) {
          const aiMsgId = uid();
          targetChat.messages.push({ role: 'assistant', content: aiText, attachments: [], ts: now(), id: aiMsgId });
          save();
        }
      } catch {}
      isStreaming = false;
      try { btn.disabled = false; inp.disabled = false; } catch {}
      return;
    }

    if (aiText) {
      const aiMsgId = uid();
      const am = { role: 'assistant', content: aiText, attachments: [], ts: now(), id: aiMsgId };
      chat.messages.push(am);
      save();
      addMsgDOM('assistant', aiText, [], true, am.ts, aiMsgId);
      generateFollowUps(aiText); // fire-and-forget, has its own try/catch
    }

  } catch (e) {
    try { typing.remove(); } catch {}
    console.error('[getAIResponse]', e);

    if (cid === targetCid) {
      const friendly = _friendlyError(e.message);
      const errId = uid();
      const em = { role: 'assistant', content: friendly, attachments: [], ts: now(), id: errId };
      try { chat.messages.push(em); save(); } catch {}
      addMsgDOM('assistant', friendly, [], true, now(), errId);
    }
  } finally {
    isStreaming = false;
    try { btn.disabled = false; inp.disabled = false; inp.focus(); } catch {}
  }
}

// Human-friendly error messages
function _friendlyError(msg = '') {
  if (msg.includes('401') || msg.includes('api key') || msg.includes('API key'))
    return '⚠️ مفتاح API غير صالح — تحقق من إعداداته.';
  if (msg.includes('429') || msg.includes('rate'))
    return '⚠️ تجاوزت الحد المسموح — انتظر لحظة ثم أعد المحاولة.';
  if (msg.includes('timeout'))
    return '⚠️ انتهى وقت الانتظار — جرب مرة أخرى.';
  if (msg.includes('fetch') || msg.includes('network') || msg.includes('Network'))
    return '⚠️ مشكلة في الاتصال — تحقق من الإنترنت.';
  if (msg.includes('500') || msg.includes('502') || msg.includes('503'))
    return '⚠️ الخادم غير متاح مؤقتاً — حاول بعد قليل.';
  return `⚠️ تعذّر الرد — ${msg.slice(0, 60) || 'خطأ غير متوقع'}`;
}

function showTyping() {
  const ma = document.getElementById('messages-area');
  ma.classList.remove('hidden');
  const w = document.createElement('div'); w.className = 'msg-wrapper';
  const row = document.createElement('div'); row.className = 'msg-row';
  const av = document.createElement('div'); av.className = 'avatar ai'; av.textContent = 'AI';
  const inner = document.createElement('div'); inner.className = 'msg-inner';
  const bub = document.createElement('div'); bub.className = 'msg-bubble ai';
  bub.innerHTML = '<div class="typing-indicator"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>';
  inner.appendChild(bub);
  row.appendChild(av); row.appendChild(inner);
  w.appendChild(row); ma.appendChild(w);
  scrollBot();
  return w;
}

// ===== FOLLOW-UP SUGGESTIONS =====
async function generateFollowUps(lastAiMsg) {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 120,
        temperature: 0.7,
        messages: [
          { role: 'system', content: 'Generate exactly 3 short follow-up questions in Arabic (each max 8 words) based on the AI response. Return ONLY a JSON array of strings. No explanation.' },
          { role: 'user', content: lastAiMsg.slice(0, 400) }
        ]
      })
    });
    if (!res.ok) return;
    const d = await res.json();
    const raw = d.choices?.[0]?.message?.content || '[]';
    let suggestions = [];
    try { suggestions = JSON.parse(raw.replace(/```json|```/g, '').trim()); } catch {}
    if (!Array.isArray(suggestions) || !suggestions.length) return;

    const area = document.getElementById('followup-area');
    const chips = document.getElementById('followup-chips');
    chips.innerHTML = suggestions.slice(0, 3).map(s =>
      `<button class="followup-chip" onclick="fillMsg(this.textContent.trim());document.getElementById('followup-area').classList.add('hidden')">${s}</button>`
    ).join('');
    area.classList.remove('hidden');
  } catch {}
}

// ===== GROQ API =====
async function callGroq(messages) {
  if (GROQ_KEY === 'YOUR_GROQ_API_KEY_HERE') {
    document.getElementById('api-notice').classList.remove('hidden');
    throw new Error('الرجاء إضافة Groq API Key في script.js');
  }

  const hasImages = messages.some(m => (m.attachments || []).some(a => a.type === 'image'));

  const apiMsgs = [];
  if (systemPrompt) {
    apiMsgs.push({ role: 'system', content: systemPrompt });
  }

  for (const m of messages) {
    const atts = m.attachments || [];
    const hasImg = atts.some(a => a.type === 'image');
    const hasFile = atts.some(a => a.type === 'file');

    try {
      if (hasImg && hasImages) {
        const parts = [];
        if (m.content) parts.push({ type: 'text', text: String(m.content) });
        for (const a of atts) {
          if (a.type === 'image') {
            if (a.data && a.data.startsWith('data:image/')) {
              parts.push({ type: 'image_url', image_url: { url: a.data } });
            } else {
              parts.push({ type: 'text', text: `[صورة: ${a.name}]` });
            }
          } else if (a.type === 'file') {
            const fileText = a.textContent ? `\n[محتوى الملف: ${a.name}]\n${a.textContent}` : `\n[ملف: ${a.name}]`;
            parts.push({ type: 'text', text: fileText });
          }
        }
        apiMsgs.push({ role: m.role, content: parts.length > 0 ? parts : (m.content || '') });
      } else {
        let textContent = String(m.content || '');
        
        // Include actual file text content when available
        for (const a of atts) {
          if (a.type === 'file' && a.textContent) {
            textContent += `\n\n[محتوى الملف "${a.name}"]:\n${a.textContent}`;
          } else if (a.type === 'file') {
            textContent += `\n[ملف: ${a.name}]`;
          } else if (a.type === 'image') {
            textContent += `\n[صورة مرفقة: ${a.name}]`;
          }
        }
        
        if (!textContent.trim()) textContent = '...';
        apiMsgs.push({ role: m.role, content: textContent });
      }
    } catch (buildErr) {
      apiMsgs.push({ role: m.role, content: String(m.content || '') });
    }
  }

  const chosenModel = hasImages ? VISION_MODEL : MODEL;

  let res, data;
  try {
    res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: chosenModel,
        messages: apiMsgs,
        max_tokens: 2048,
        temperature: 0.7
      })
    });
  } catch (networkErr) {
    throw new Error('فشل الاتصال بالشبكة. تحقق من اتصالك بالإنترنت.');
  }

  if (!res.ok) {
    let errMsg = `خطأ ${res.status}`;
    try {
      const e = await res.json();
      errMsg = e.error?.message || errMsg;
    } catch {}

    if (res.status >= 400 && hasImages) {
      return await callGroqTextOnly(messages);
    }
    throw new Error(errMsg);
  }

  try {
    data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('استجابة فارغة من API');
    return content;
  } catch (parseErr) {
    throw new Error('فشل في قراءة الاستجابة من API');
  }
}

async function callGroqTextOnly(messages) {
  const apiMsgs = [];
  if (systemPrompt) apiMsgs.push({ role: 'system', content: systemPrompt });

  for (const m of messages) {
    let text = String(m.content || '');
    (m.attachments || []).forEach(a => {
      if (a.textContent) {
        text += `\n[محتوى: ${a.name}]\n${a.textContent}`;
      } else {
        text += a.type === 'image' ? `\n[صورة: ${a.name}]` : `\n[ملف: ${a.name}]`;
      }
    });
    apiMsgs.push({ role: m.role, content: text.trim() || '...' });
  }

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({ model: MODEL, messages: apiMsgs, max_tokens: 2048, temperature: 0.7 })
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error?.message || `خطأ ${res.status} من API`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('استجابة فارغة من API');
  return content;
}

// ===== TEXT TO SPEECH =====
function speakText(text, btn) {
  if (currentTTS && window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    currentTTS = null;
    if (btn) { btn.innerHTML = '<i class="ti ti-volume"></i> استماع'; btn.classList.remove('active'); }
    return;
  }
  const clean = text.replace(/<[^>]+>/g, '').replace(/[#*`]/g, '');
  const utter = new SpeechSynthesisUtterance(clean);
  utter.lang = 'ar-SA';
  utter.rate = 0.9;
  utter.onend = () => {
    currentTTS = null;
    if (btn) { btn.innerHTML = '<i class="ti ti-volume"></i> استماع'; btn.classList.remove('active'); }
  };
  if (btn) { btn.innerHTML = '<i class="ti ti-volume-off"></i> إيقاف'; btn.classList.add('active'); }
  currentTTS = utter;
  window.speechSynthesis.speak(utter);
}

// ===== VOICE RECORDING (FIXED - continuous, no early stop) =====
function toggleRec() {
  const btn = document.getElementById('rec-btn');
  
  if (isRecording) {
    isRecording = false;
    btn.classList.remove('recording');
    btn.title = 'تسجيل صوت';
    if (recognition) { recognition.stop(); recognition = null; }
    showToast('تم إيقاف التسجيل', 'info');
    return;
  }
  
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    showToast('استخدم متصفح Chrome للتسجيل الصوتي', 'warning');
    return;
  }
  
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = 'ar-EG';
  recognition.continuous = true;       // FIXED: keep listening
  recognition.interimResults = true;   // FIXED: show interim results
  recognition.maxAlternatives = 1;
  
  let finalTranscript = '';
  let silenceTimer = null;
  
  recognition.onresult = e => {
    let interimTranscript = '';
    
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const transcript = e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        finalTranscript += transcript + ' ';
      } else {
        interimTranscript += transcript;
      }
    }
    
    // Show in input as user speaks
    const inp = document.getElementById('msg-input');
    inp.value = (finalTranscript + interimTranscript).trim();
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
    
    // Reset silence timer (FIXED: 4 second pause to auto-stop)
    if (silenceTimer) clearTimeout(silenceTimer);
    if (finalTranscript.trim()) {
      silenceTimer = setTimeout(() => {
        if (isRecording) {
          isRecording = false;
          btn.classList.remove('recording');
          btn.title = 'تسجيل صوت';
          recognition.stop();
          showToast('تم الانتهاء من التسجيل', 'success');
        }
      }, 4000);
    }
  };
  
  recognition.onerror = e => {
    if (e.error === 'no-speech') {
      // Don't stop on no-speech in continuous mode
      return;
    }
    isRecording = false;
    btn.classList.remove('recording');
    recognition = null;
    if (silenceTimer) clearTimeout(silenceTimer);
    
    const errMap = {
      'network': 'خطأ في الشبكة',
      'not-allowed': 'يرجى السماح بالوصول للميكروفون',
      'audio-capture': 'لا يمكن الوصول للميكروفون',
    };
    showToast(errMap[e.error] || `خطأ في التسجيل: ${e.error}`, 'error');
  };
  
  recognition.onend = () => {
    // Restart if still recording (continuous mode fix for Chrome)
    if (isRecording) {
      try { recognition.start(); } catch {}
    }
  };
  
  try {
    recognition.start();
    isRecording = true;
    btn.classList.add('recording');
    btn.title = 'انقر للإيقاف';
    showToast('جارٍ التسجيل... (اضغط مرة أخرى للإيقاف)', 'info');
  } catch (e) {
    showToast('فشل بدء التسجيل', 'error');
  }
}