/* 行動考場：載入 exams/index.json 列卷 → 應試（計時、不回饋）→ 交卷計分 → 匯出 */
const $app = document.getElementById("app");
const LS_KEY = "examweb.sessions.v1";

let exams = [];          // 卷清單（index.json）
let exam = null;         // 當前卷完整資料
let sess = null;         // 當前應試 session
let cur = 0;             // 當前題 index
let timerId = null;
let warned = false;

/* ---------- 儲存 ---------- */
function loadSessions() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
}
function saveSession() {
  const all = loadSessions();
  all[sess.examId] = sess;
  localStorage.setItem(LS_KEY, JSON.stringify(all));
}

/* ---------- 首頁 ---------- */
async function showHome() {
  clearInterval(timerId);
  const res = await fetch("exams/index.json", { cache: "no-store" });
  exams = await res.json();
  const all = loadSessions();
  $app.innerHTML = `
    <h1>行動考場</h1>
    <p class="muted">2026 郵政升等考模擬卷．作答中不顯示對錯，交卷後才解析</p>
    <h2>試卷</h2>
    ${exams.map(e => {
      const s = all[e.id];
      const status = !s ? "" : s.finished
        ? `<span class="tag ok">已完卷 ${s.scoreText || ""}</span>`
        : `<span class="tag pend">進行中</span>`;
      return `<div class="card tappable" onclick="openExam('${e.id}')">
        <strong>${e.title}</strong> ${status}
        <div class="muted">${e.subject}．限時 ${e.minutes} 分鐘．${e.summary}</div>
      </div>`;
    }).join("")}
    <p class="muted" style="margin-top:20px">題庫由 Claude 依出題硬規則預先生成；申論題交卷後匯出，回家由 AI 批改並入 Notion。</p>`;
}

async function openExam(id) {
  const meta = exams.find(e => e.id === id);
  const res = await fetch(`exams/${meta.file}`, { cache: "no-store" });
  exam = await res.json();
  exam.id = id;
  const existing = loadSessions()[id];
  if (existing && existing.finished) { sess = existing; return showResult(); }
  if (existing) {
    sess = existing;
    cur = sess.answers.findIndex(a => a === null);
    if (cur < 0) cur = 0;
    return showQuestion();
  }
  // 開卷確認頁
  $app.innerHTML = `
    <h1>${exam.title}</h1>
    <div class="card">
      <p><strong>${exam.subject}</strong>．限時 ${exam.minutes} 分鐘</p>
      <p class="muted">${exam.sections.map(s => `${s.name} ${s.count} 題 × ${s.points} 分`).join("．")}（滿分 ${fullScore()} 分）</p>
      <div class="notice">按下開始即計時。作答中不顯示對錯、可跳題；剩 10 分鐘會提醒一次。</div>
      <div class="btn-row">
        <button onclick="startExam()">開始作答</button>
        <button class="ghost" onclick="showHome()">返回</button>
      </div>
    </div>`;
}

function fullScore() {
  return exam.sections.reduce((t, s) => t + s.count * s.points, 0);
}

function startExam() {
  sess = {
    examId: exam.id,
    started: Date.now(),
    answers: exam.questions.map(() => null),
    finished: false,
  };
  cur = 0;
  warned = false;
  saveSession();
  showQuestion();
}

/* ---------- 應試 ---------- */
function remainSec() {
  return exam.minutes * 60 - Math.floor((Date.now() - sess.started) / 1000);
}
function fmt(sec) {
  const m = Math.floor(Math.abs(sec) / 60), s = Math.abs(sec) % 60;
  return `${sec < 0 ? "-" : ""}${m}:${String(s).padStart(2, "0")}`;
}
function tick() {
  const el = document.getElementById("timer");
  if (!el) return;
  const r = remainSec();
  el.textContent = fmt(r);
  if (r <= 600) el.classList.add("warn");
  if (r <= 600 && !warned) {
    warned = true;
    toast("剩 10 分鐘");
  }
}

function showQuestion() {
  clearInterval(timerId);
  timerId = setInterval(tick, 1000);
  const q = exam.questions[cur];
  const answered = sess.answers.filter(a => a !== null && a !== "").length;
  $app.innerHTML = `
    <div class="exam-top">
      <button class="small ghost" onclick="showGridView()">題目一覽</button>
      <span class="muted">${answered}/${exam.questions.length} 已答</span>
      <span class="timer" id="timer"></span>
    </div>
    <div class="q-num">第 ${cur + 1} 題／${q.section}${q.essay ? `（${q.points} 分）` : ""}</div>
    <div class="q-stem">${q.stem}</div>
    ${q.essay ? essayBox(q) : q.options.map((opt, i) => {
      const label = "ABCD"[i];
      return `<button class="opt ${sess.answers[cur] === label ? "picked" : ""}"
        onclick="pick('${label}')">（${label}）${opt}</button>`;
    }).join("")}
    <div class="btn-row">
      <button class="ghost" onclick="nav(-1)" ${cur === 0 ? "disabled" : ""}>上一題</button>
      ${cur === exam.questions.length - 1
        ? `<button onclick="confirmSubmit()">交卷</button>`
        : `<button onclick="nav(1)">下一題</button>`}
    </div>`;
  tick();
}

function essayBox(q) {
  const val = sess.answers[cur] || "";
  return `<p class="muted">申論題：車上可先打大綱，回家再補全文；交卷後匯出由 AI 批改。</p>
    <textarea id="essay" placeholder="輸入你的答案或大綱…">${escapeHtml(val)}</textarea>
    <div class="btn-row"><button class="small ghost" onclick="saveEssay()">暫存</button></div>`;
}
function saveEssay() {
  sess.answers[cur] = document.getElementById("essay").value;
  saveSession();
  toast("已暫存");
  showQuestion();
}

function pick(label) {
  sess.answers[cur] = label;
  saveSession();
  // 短暫顯示選取後自動下一題（最後一題停留）
  if (cur < exam.questions.length - 1) {
    showQuestion();
    setTimeout(() => nav(1), 200);
  } else {
    showQuestion();
  }
}

function nav(d) {
  const q = exam.questions[cur];
  if (q.essay) {
    const el = document.getElementById("essay");
    if (el) { sess.answers[cur] = el.value; saveSession(); }
  }
  cur = Math.max(0, Math.min(exam.questions.length - 1, cur + d));
  showQuestion();
}

function showGridView() {
  const q = exam.questions[cur];
  if (q.essay) {
    const el = document.getElementById("essay");
    if (el) { sess.answers[cur] = el.value; saveSession(); }
  }
  $app.innerHTML = `
    <div class="exam-top">
      <strong>題目一覽</strong>
      <span class="timer" id="timer"></span>
    </div>
    <div class="q-grid">
      ${exam.questions.map((qq, i) => `
        <button class="q-dot ${sess.answers[i] !== null && sess.answers[i] !== "" ? "answered" : ""} ${i === cur ? "current" : ""}"
          onclick="cur=${i};showQuestion()">${i + 1}</button>`).join("")}
    </div>
    <p class="muted">綠底＝已作答。點題號跳題。</p>
    <div class="btn-row">
      <button class="ghost" onclick="showQuestion()">回到題目</button>
      <button onclick="confirmSubmit()">交卷</button>
    </div>`;
  tick();
}

function confirmSubmit() {
  const blank = sess.answers.filter(a => a === null || a === "").length;
  const over = remainSec() < 0;
  $app.innerHTML = `
    <div class="card">
      <h2>確定交卷？</h2>
      <p>${blank > 0 ? `還有 <strong>${blank}</strong> 題未作答。` : "全部題目皆已作答。"}
      ${over ? "（已超過時限）" : ""}</p>
      <div class="btn-row">
        <button class="ghost" onclick="showQuestion()">再檢查</button>
        <button onclick="grade()">交卷</button>
      </div>
    </div>`;
}

/* ---------- 交卷與成績 ---------- */
function grade() {
  clearInterval(timerId);
  sess.finished = true;
  sess.submitted = Date.now();
  let got = 0, mcTotal = 0, mcRight = 0, essayFull = 0;
  exam.questions.forEach((q, i) => {
    if (q.essay) { essayFull += q.points; return; }
    mcTotal++;
    if (sess.answers[i] === q.answer) { got += q.points; mcRight++; }
  });
  sess.scoreText = `選擇 ${got}/${fullScore() - essayFull}`;
  sess.mcRight = mcRight;
  sess.mcTotal = mcTotal;
  sess.mcScore = got;
  saveSession();
  showResult();
}

function showResult() {
  clearInterval(timerId);
  const essayQs = exam.questions.filter(q => q.essay);
  const essayFull = essayQs.reduce((t, q) => t + q.points, 0);
  const usedMin = Math.round((sess.submitted - sess.started) / 60000);
  $app.innerHTML = `
    <h1>${exam.title}．成績</h1>
    <div class="card">
      <div class="score-big">${sess.mcScore}<span class="muted" style="font-size:1rem"> / ${fullScore() - essayFull} 選擇題得分</span></div>
      <p>選擇題答對 ${sess.mcRight}/${sess.mcTotal} 題．作答 ${usedMin} 分鐘</p>
      ${essayFull ? `<p class="muted">申論 ${essayQs.length} 題（${essayFull} 分）待 AI 批改——按下方「匯出作答紀錄」貼給 Claude。</p>` : ""}
      <div class="btn-row">
        <button onclick="exportResult()">匯出作答紀錄</button>
        <button class="ghost" onclick="showHome()">回首頁</button>
      </div>
    </div>
    <h2>逐題解析</h2>
    ${exam.questions.map((q, i) => resultRow(q, i)).join("")}`;
}

function resultRow(q, i) {
  const user = sess.answers[i];
  if (q.essay) {
    return `<div class="result-q">
      <div class="q-num">第 ${i + 1} 題．申論 <span class="tag pend">待批改</span></div>
      <div class="q-stem">${q.stem}</div>
      <div class="explain">你的作答：\n${user ? escapeHtml(user) : "（未作答）"}</div>
    </div>`;
  }
  const right = user === q.answer;
  return `<div class="result-q">
    <div class="q-num">第 ${i + 1} 題．${q.point || q.section}
      <span class="tag ${right ? "ok" : "bad"}">${right ? "答對" : user ? `答錯（你選 ${user}）` : "未作答"}</span></div>
    <div class="q-stem">${q.stem}</div>
    ${q.options.map((opt, j) => {
      const label = "ABCD"[j];
      let cls = "opt";
      if (label === q.answer) cls += " correct";
      else if (label === user) cls += " wrong";
      return `<div class="${cls}">（${label}）${opt}</div>`;
    }).join("")}
    <div class="explain">${q.explain}</div>
  </div>`;
}

/* ---------- 匯出 ---------- */
function exportResult() {
  const out = {
    exam: exam.title,
    subject: exam.subject,
    date: new Date(sess.submitted).toISOString().slice(0, 10),
    usedMinutes: Math.round((sess.submitted - sess.started) / 60000),
    mcScore: sess.mcScore,
    mcRight: `${sess.mcRight}/${sess.mcTotal}`,
    wrong: exam.questions
      .map((q, i) => (!q.essay && sess.answers[i] !== q.answer)
        ? { n: i + 1, point: q.point, user: sess.answers[i] || "未作答", answer: q.answer, stem: q.stem }
        : null)
      .filter(Boolean),
    essays: exam.questions
      .map((q, i) => q.essay ? { n: i + 1, stem: q.stem, answer: sess.answers[i] || "" } : null)
      .filter(Boolean),
  };
  const text = "【模考作答紀錄，請依模擬考流程批改申論並將錯題入庫】\n" + JSON.stringify(out, null, 1);
  navigator.clipboard.writeText(text)
    .then(() => toast("已複製，回家貼給 Claude 即可"))
    .catch(() => {
      // iOS 舊版 fallback：顯示文字讓使用者手動複製
      $app.insertAdjacentHTML("beforeend",
        `<div class="card"><p class="muted">自動複製失敗，請長按全選複製：</p><textarea readonly>${escapeHtml(text)}</textarea></div>`);
    });
}

/* ---------- 工具 ---------- */
function toast(msg) {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* PWA */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

showHome();
