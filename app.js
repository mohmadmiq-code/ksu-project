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

function renderMarkdown(md){
  const html = marked.parse(md || '');
  const container = document.createElement('div');
  container.innerHTML = html;

  // KaTeX render
  renderMathInElement(container, {
    delimiters: [
      {left: "\\[", right: "\\]", display: true},
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

async function ask(message, imageDataUrl=null){
  errEl.hidden = true;

  addMsg('user', `<div>${escapeHtml(message || '📷 (سؤال من صورة)')}</div>`, 'أنت');

  const holder = addMsg('assistant', `<div>...</div>`, 'المساعد');
  try{
    const res = await fetch(API_URL, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ message, history: [], imageDataUrl })
    });
    const data = await res.json();
    if(!res.ok || !data.ok){
      const errMap = {
        missing_message: 'أدخل سؤالك أولاً',
        missing_api_key_for_image: 'مفتاح OpenAI غير مُفعّل — فعّل OPENAI_API_KEY في Cloudflare',
        invalid_json: 'خطأ في البيانات المُرسلة'
      };
      throw new Error(errMap[data.error] || data.error || 'فشل الاتصال بالخادم');
    }
    const html = renderMarkdown(data.text || '');
    await typeInto(holder, html);
  }catch(e){
    holder.innerHTML = '';
    errEl.hidden = false;
    errEl.textContent = 'خطأ: ' + e.message;
  }
}

sendBtn.addEventListener('click', ()=>{
  const m = (qEl.value || '').trim();
  if(!m) return;
  qEl.value = '';
  ask(m);
});

qEl.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter' && !e.shiftKey){
    e.preventDefault();
    sendBtn.click();
  }
});

chips.addEventListener('click', (e)=>{
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

btnUseImage.addEventListener('click', async ()=>{
  const file = imgInput.files && imgInput.files[0];
  if(!file) return;
  const dataUrl = await fileToDataUrl(file);
  ask('', dataUrl);
});


// ---------- CSV + Charts ----------
const csvInput = document.getElementById('csvInput');
const colSelect = document.getElementById('colSelect');
const chartType = document.getElementById('chartType');
const drawBtn = document.getElementById('draw');
const tableHost = document.getElementById('tableHost');
const canvas = document.getElementById('chart');

let parsedRows = [];
let chart = null;

function buildTable(rows, maxRows=12){
  if(!rows || !rows.length) return;
  const cols = Object.keys(rows[0] || {});
  const head = `<tr>${cols.map(c=>`<th>${escapeHtml(c)}</th>`).join('')}</tr>`;
  const body = rows.slice(0,maxRows).map(r=>{
    return `<tr>${cols.map(c=>`<td>${escapeHtml(String(r[c] ?? ''))}</td>`).join('')}</tr>`;
  }).join('');
  tableHost.innerHTML = `<table>${head}${body}</table>`;
}

function fillColumns(rows){
  const cols = Object.keys(rows[0] || {});
  colSelect.innerHTML = cols.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  colSelect.disabled = false;
  chartType.disabled = false;
  drawBtn.disabled = false;
}

function freqCounts(values){
  const m = new Map();
  for(const v of values){
    const key = (v ?? '').toString().trim();
    if(!key) continue;
    m.set(key, (m.get(key)||0)+1);
  }
  const labels = Array.from(m.keys());
  const counts = labels.map(k=>m.get(k));
  return {labels, counts};
}

function histogramBins(nums, k=8){
  const clean = nums.filter(x=>Number.isFinite(x));
  if(clean.length===0) return {labels:[], counts:[]};

  const min = Math.min(...clean), max = Math.max(...clean);
  const range = max - min || 1;
  const width = range / k;
  const counts = new Array(k).fill(0);

  for(const x of clean){
    let idx = Math.floor((x - min) / width);
    if(idx === k) idx = k-1;
    counts[idx] += 1;
  }
  const labels = counts.map((_,i)=>{
    const a = min + i*width;
    const b = min + (i+1)*width;
    return `${a.toFixed(2)} – ${b.toFixed(2)}`;
  });
  return {labels, counts};
}

function dotPlot(nums){
  const clean = nums.filter(x=>Number.isFinite(x)).sort((a,b)=>a-b);
  const labels = clean.map((_,i)=>`${i+1}`);
  const counts = clean.map(x=>x);
  return {labels, counts};
}

function drawChart(type, labels, data){
  if(chart) chart.destroy();
  const cfg = {
    type: (type==='hist' || type==='dot') ? 'bar' : type,
    data: {
      labels,
      datasets: [{ label: 'القيم', data }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: type !== 'hist' && type !== 'dot' } }
    }
  };
  chart = new Chart(canvas, cfg);
}

csvInput.addEventListener('change', ()=>{
  const file = csvInput.files && csvInput.files[0];
  if(!file) return;
  Papa.parse(file, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: true,
    complete: (res)=>{
      parsedRows = res.data || [];
      buildTable(parsedRows);
      if(parsedRows.length) fillColumns(parsedRows);
    }
  });
});

drawBtn.addEventListener('click', ()=>{
  if(!parsedRows.length) return;
  const col = colSelect.value;
  const type = chartType.value;

  const values = parsedRows.map(r=>r[col]);
  if(type === 'hist'){
    const nums = values.map(v=>Number(v)).filter(v=>Number.isFinite(v));
    const {labels, counts} = histogramBins(nums, 8);
    drawChart('hist', labels, counts);
    return;
  }
  if(type === 'dot'){
    const nums = values.map(v=>Number(v)).filter(v=>Number.isFinite(v));
    const {labels, counts} = dotPlot(nums);
    drawChart('dot', labels, counts);
    return;
  }

  const {labels, counts} = freqCounts(values);
  drawChart(type, labels, counts);
});

// Initial greeting
addMsg('assistant', renderMarkdown('مرحبًا. أنا مساعد **إحص 102** — ملتزم بالمنهاج. اسأل عن الجداول التكرارية، التمثيل بالأعمدة والقطاعات، التوزيع التكراري، المدرج والمضلع والمنحنى التراكمي — أو استخدم “الموضوعات السريعة”.'), 'المساعد');