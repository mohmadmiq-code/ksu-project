const API_URL = (window.API_URL || '').trim() || 'https://ksu-stat102-ai.mohmadmiq.workers.dev/api/ask';

const chatLog = document.getElementById('chatLog');
const qEl = document.getElementById('q');
const sendBtn = document.getElementById('send');
const errEl = document.getElementById('err');

const imgInput = document.getElementById('imgInput');
const btnUseImage = document.getElementById('btnUseImage');

const chips = document.getElementById('chips');

function nowTime(){
  const d = new Date();
  return d.toLocaleTimeString('ar-SA', {hour:'2-digit', minute:'2-digit'});
}

function escapeHtml(s){
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function addMsg(role, bodyHtml, meta){
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  wrap.innerHTML = `
    <div class="meta">${escapeHtml(meta || (role === 'user' ? 'أنت' : 'المساعد'))} • ${nowTime()}</div>
    <div class="body">${bodyHtml}</div>
  `;
  chatLog.appendChild(wrap);
  chatLog.scrollTop = chatLog.scrollHeight;
  return wrap.querySelector('.body');
}

function createChartPlaceholder(chartData) {
  try {
    const d = typeof chartData === 'string' ? JSON.parse(chartData.trim()) : chartData;
    if (!d || !d.type || !d.data) return null;
    const chartType = (d.type === 'polygon' || d.type === 'freq_polygon' || d.type === 'ogive') ? 'line' : (d.type === 'hist' ? 'bar' : d.type);
    const wrap = document.createElement('div');
    wrap.className = 'msg-chart-wrap chart-placeholder';
    wrap.setAttribute('data-chart', JSON.stringify({ ...d, _chartType: chartType }));
    const canvas = document.createElement('canvas');
    canvas.width = 380;
    canvas.height = 200;
    wrap.appendChild(canvas);
    return wrap;
  } catch (e) { return null; }
}

function initChartsInElement(el) {
  if (!el) return;
  el.querySelectorAll('.chart-placeholder').forEach(wrap => {
    try {
      const json = wrap.getAttribute('data-chart');
      if (!json) return;
      const d = JSON.parse(json);
      const canvas = wrap.querySelector('canvas');
      if (!canvas) return;
      const isPolygon = d.type === 'polygon' || d.type === 'freq_polygon' || d.type === 'ogive';
      const isHist = d.type === 'hist';
      const chartType = d._chartType || (isPolygon ? 'line' : (isHist ? 'bar' : d.type));
      const cfg = {
        type: chartType,
        data: { labels: d.labels || [], datasets: [{ label: 'القيم', data: d.data, ...(isPolygon && { fill: false, tension: 0, pointRadius: 4 }) }] },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: { legend: { display: d.type === 'pie' } }
        }
      };
      if (isHist) {
        cfg.options.scales = { x: { display: true }, y: { display: true } };
        cfg.data.datasets[0].barPercentage = 1;
        cfg.data.datasets[0].categoryPercentage = 1;
      }
      new Chart(canvas, cfg);
      wrap.classList.remove('chart-placeholder');
    } catch (e) { /* ignore */ }
  });
}

const KX_L = '<!--KX_L-->', KX_R = '<!--KX_R-->', KX_DL = '<!--KX_DL-->', KX_DR = '<!--KX_DR-->';

function renderMarkdown(md){
  let text = md || '';
  text = text.replace(/\\\(/g, KX_L).replace(/\\\)/g, KX_R)
    .replace(/\\\[/g, KX_DL).replace(/\\\]/g, KX_DR);
  text = text.replace(/(\d+(?:\.\d+)?)\\100(?!\d)/g, '$1\\%')
    .replace(/\(frac\s*\{/g, KX_L + ' \\frac{')
    .replace(/\(%\s*times/g, KX_L + ' 100 \\times')
    .replace(/\\frac\{([^{}]+)\}\{([^{}]*)\}/g, KX_L + ' \\frac{$1}{$2} ' + KX_R)
    .replace(/\[\s*m\s*=\s*\\frac\s*\{L\s*\+\s*U\}\s*\{2\}\s*\]/g, KX_DL + ' m = \\frac{L+U}{2} ' + KX_DR)
    .replace(/\[\s*([^[\]]*\\[a-zA-Z{}]+[^[\]]*)\s*\]/g, KX_DL + ' $1 ' + KX_DR)
    .replace(/\\Rightarrow/g, KX_L + ' \\Rightarrow ' + KX_R)
    .replace(/\\approx/g, KX_L + ' \\approx ' + KX_R)
    .replace(/\\times/g, KX_L + ' \\times ' + KX_R);
  let html = marked.parse(text);
  html = html.split(KX_L).join('\\(').split(KX_R).join('\\)')
    .split(KX_DL).join('\\[').split(KX_DR).join('\\]');
  const container = document.createElement('div');
  container.innerHTML = html;

  container.querySelectorAll('pre > code').forEach(code => {
    const txt = (code.textContent || '').trim();
    if (/^\s*\{\s*"type"\s*:/.test(txt) && /"labels"|"data"/.test(txt)) {
      const chartEl = createChartPlaceholder(txt);
      if (chartEl) code.closest('pre').replaceWith(chartEl);
    }
  });

  renderMathInElement(container, {
    delimiters: [
      {left: "$$", right: "$$", display: true},
      {left: "\\[", right: "\\]", display: true},
      {left: "$", right: "$", display: false},
      {left: "\\(", right: "\\)", display: false}
    ],
    throwOnError: false
  });

  return container.innerHTML;
}

async function typeInto(el, html){
  // type-like: progressively reveal text (strip tags for typing, then replace with final)
  const temp = document.createElement('div');
  temp.innerHTML = html;
  const text = temp.textContent || temp.innerText || '';
  el.textContent = '';
  const speed = 9;
  for (let i=0; i<text.length; i++){
    el.textContent += text[i];
    if (i % speed === 0) await new Promise(r=>setTimeout(r, 8));
  }
  el.innerHTML = html;
}

let currentAbortController = null;

async function ask(message, imageDataUrl=null){
  errEl.hidden = true;
  sendBtn.disabled = true;
  qEl.disabled = true;
  if (chips) chips.querySelectorAll('button').forEach(b=>b.disabled=true);
  if (btnUseImage) btnUseImage.disabled = true;

  addMsg('user', `<div>${escapeHtml(message || '📷 (سؤال من صورة)')}</div>`, 'أنت');

  const holder = addMsg('assistant', `<div class="loading-wrap"><span class="loading-dots">جاري المعالجة</span> <button type="button" class="btn-cancel" aria-label="إلغاء">إلغاء</button></div>`, 'المساعد');
  holder.closest('.msg').classList.add('loading');
  const controller = new AbortController();
  currentAbortController = controller;
  const cancelBtn = holder.querySelector('.btn-cancel');
  cancelBtn.onclick = () => controller.abort();

  try{
    const timeout = setTimeout(() => controller.abort(), 35000);
    const res = await fetch(API_URL, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ message, history: [], imageDataUrl }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    currentAbortController = null;
    sendBtn.disabled = false;
    qEl.disabled = false;
    if (chips) chips.querySelectorAll('button').forEach(b=>b.disabled=false);
    if (btnUseImage) btnUseImage.disabled = false;
    const data = await res.json();
    if(!res.ok || !data.ok){
      clearTimeout(timeout);
      const errMap = {
        missing_message: 'أدخل سؤالك أولاً',
        missing_api_key: 'أضف OPENAI_API_KEY في Cloudflare (Settings → Variables and Secrets)',
        missing_api_key_for_image: 'مفتاح OpenAI غير مُفعّل — فعّل OPENAI_API_KEY في Cloudflare',
        invalid_json: 'خطأ في البيانات المُرسلة',
        openai_error: 'خطأ في الاتصال بـ OpenAI — تحقق من المفتاح عبر /api/check'
      };
      throw new Error(data.message || errMap[data.error] || data.error || 'فشل الاتصال بالخادم');
    }
    holder.closest('.msg').classList.remove('loading');
    const html = renderMarkdown(data.text || '');
    await typeInto(holder, html);
    initChartsInElement(holder);
  }catch(e){
    currentAbortController = null;
    sendBtn.disabled = false;
    qEl.disabled = false;
    if (chips) chips.querySelectorAll('button').forEach(b=>b.disabled=false);
    if (btnUseImage) btnUseImage.disabled = false;
    holder.closest('.msg')?.classList.remove('loading');
    holder.innerHTML = '';
    errEl.hidden = false;
    let msg = e.message;
    if (msg === 'Failed to fetch') {
      msg = 'فشل الاتصال. جرّب: الاتصال بالإنترنت، تحديث الصفحة، أو استخدام شبكة أخرى (قد يُحظر workers.dev في بعض الشبكات)';
    }
    if (e.name === 'AbortError' || msg.includes('abort')) {
      msg = 'تم الإلغاء أو انتهت المهلة (35 ثانية). جرّب سؤالاً أقصر أو تحقق من اتصالك.';
    }
    errEl.textContent = 'خطأ: ' + msg;
  }
}

sendBtn.addEventListener('click', async ()=>{
  const m = (qEl.value || '').trim();
  const file = imgInput?.files?.[0];
  if(!m && !file) {
    errEl.hidden = false;
    errEl.textContent = 'اكتب سؤالك أو اختر صورة ثم اضغط "استخدام الصورة"';
    return;
  }
  errEl.hidden = true;
  qEl.value = '';
  const dataUrl = file ? await fileToDataUrl(file) : null;
  if (file) imgInput.value = '';
  ask(m || (dataUrl ? 'حل السؤال من الصورة' : ''), dataUrl);
});

qEl.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter' && !e.shiftKey){
    e.preventDefault();
    sendBtn.click();
  }
});

if (chips) chips.addEventListener('click', (e)=>{
  const b = e.target.closest('button[data-q]');
  if(!b) return;
  ask(b.getAttribute('data-q'));
});

function fileToDataUrl(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=> resolve(reader.result);
    reader.onerror = ()=> reject(new Error('file_read_failed'));
    reader.readAsDataURL(file);
  });
}

if (btnUseImage) btnUseImage.addEventListener('click', async ()=>{
  const file = imgInput.files && imgInput.files[0];
  if(!file) return;
  const dataUrl = await fileToDataUrl(file);
  ask('', dataUrl);
});

// ---------- إدخال صوتي ----------
const btnMic = document.getElementById('btnMic');
if (btnMic) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = SpeechRecognition ? new SpeechRecognition() : null;
  if (recognition) {
    recognition.lang = 'ar-SA';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (e) => {
      const t = e.results[0][0].transcript;
      if (t && qEl) qEl.value = (qEl.value + ' ' + t).trim();
    };
    recognition.onerror = () => { btnMic.classList.remove('recording'); };
    recognition.onend = () => { btnMic.classList.remove('recording'); };
    btnMic.onclick = () => {
      if (btnMic.classList.contains('recording')) {
        recognition.stop();
        return;
      }
      try {
        recognition.start();
        btnMic.classList.add('recording');
      } catch (err) {
        errEl.hidden = false;
        errEl.textContent = 'خطأ: المتصفح لا يدعم التعرف على الصوت أو ميكروفون غير متاح';
      }
    };
  } else {
    btnMic.style.display = 'none';
  }
}

// Initial greeting
addMsg('assistant', renderMarkdown('مرحبًا. أنا مساعد **إحص 102** — ملتزم بالمنهاج. اسأل عن الجداول التكرارية، التمثيل بالأعمدة والقطاعات، التوزيع التكراري، المدرج والمضلع التكراري والمضلع التكراري المتجمع الصاعد — أو استخدم “الموضوعات السريعة”.'), 'المساعد');