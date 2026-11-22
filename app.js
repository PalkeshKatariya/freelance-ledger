/* Total Berries · Freelance Ledger with Real-time Supabase Cloud Sync */
const KEY = "total-berries-clean-v1";
const SUPABASE_URL = "https://pnonyubkhhubujlyemam.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBub255dWJraGh1YnVqbHllbWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1ODUyOTAsImV4cCI6MjExMDE2MTI5MH0.B6Emq3wAnyApqwyobvtND3qvActeEfi_ooYfq-kAi1Y";

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = days => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const emptyData = () => ({
  version: 1,
  settings: {
    businessName: "Total Berries",
    gstin: "",
    invoicePrefix: "TB",
    nextInvoice: 1,
    defaultDueDays: 15,
    theme: "light",
    cashOpeningBalance: 0,
    cashOpeningDate: "",
    cashOpeningNotes: ""
  },
  clients: [],
  projects: [],
  invoices: [],
  payments: [],
  expenses: []
});

function applyTheme(theme) {
  const t = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("theme", t);
  if (data && data.settings) {
    data.settings.theme = t;
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", t === "dark" ? "#090d16" : "#0066ff");
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || data.settings?.theme || "light";
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  save();
  render();
  notify(`Switched to ${next === "dark" ? "Dark Mode 🌙" : "Light Mode ☀️"}`);
}

let data = load();
let currentView = (location.hash.slice(1) && !location.hash.includes("access_token")) ? location.hash.slice(1) : "dashboard";
let searchText = "";
let selectedTimeframe = "1M";
let toastTimer;

let sbClient = null;
let currentUser = null;
let isSyncing = false;

function getSupabase() {
  if (!sbClient && window.supabase && window.supabase.createClient) {
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return sbClient;
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!saved) return emptyData();
    return { ...emptyData(), ...saved, settings: { ...emptyData().settings, ...saved.settings } };
  } catch {
    return emptyData();
  }
}

function save() {
  localStorage.setItem(KEY, JSON.stringify(data));
  if (currentUser) {
    pushToSupabase();
  }
}

function currency(value) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value || 0));
}

function dateText(value) {
  return value ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`)) : "—";
}

function escape(text = "") {
  return String(text).replace(/[&<>'"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[c]);
}

function invoiceAmount(invoice) {
  return Number(invoice.amount || 0) * (1 + Number(invoice.gstRate || 0) / 100);
}

function paidAmount(invoiceId) {
  return data.payments.filter(p => p.invoiceId === invoiceId).reduce((sum, p) => sum + Number(p.amount || 0), 0);
}

function balance(invoice) {
  return Math.max(0, invoiceAmount(invoice) - paidAmount(invoice.id));
}

function invoiceStatus(invoice) {
  if (invoice.draft) return "Draft";
  if (balance(invoice) < 0.01) return "Paid";
  return invoice.dueDate && invoice.dueDate < today() ? "Overdue" : "Due";
}

function clientName(id) {
  return data.clients.find(c => c.id === id)?.name || "Direct Client";
}

function projectName(id) {
  return data.projects.find(p => p.id === id)?.name || "General Work";
}

function invoiceNumber() {
  const n = String(data.settings.nextInvoice || 1).padStart(3, "0");
  return `${data.settings.invoicePrefix || "TB"}-${n}`;
}

function paymentsInRange(start, end) {
  return data.payments.filter(p => p.date >= start && p.date <= end).reduce((s, p) => s + Number(p.amount), 0);
}

function expensesInRange(start, end) {
  return data.expenses.filter(e => e.date >= start && e.date <= end).reduce((s, e) => s + Number(e.amount), 0);
}

function monthRange(offset = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset, 1);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    label: start.toLocaleDateString("en-IN", { month: "short" })
  };
}

function notify(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("visible"), 3200);
}

/* ==========================================================================
   SUPABASE CLOUD SYNC & AUTH
   ========================================================================== */
async function initAuth() {
  const sb = getSupabase();
  if (!sb) return;
  try {
    const { data: { session } } = await sb.auth.getSession();
    currentUser = session?.user || null;
    updateSyncIndicator();
    if (currentUser) {
      if (location.hash && location.hash.includes("access_token")) {
        history.replaceState(null, "", location.pathname + "#dashboard");
        currentView = "dashboard";
        render();
      }
      await pullFromSupabase();
    }
    sb.auth.onAuthStateChange(async (event, session) => {
      currentUser = session?.user || null;
      updateSyncIndicator();
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && currentUser) {
        if (location.hash && location.hash.includes("access_token")) {
          history.replaceState(null, "", location.pathname + "#dashboard");
          currentView = "dashboard";
          render();
        }
        await pullFromSupabase();
      }
    });
  } catch (e) {
    console.warn("Supabase init error:", e);
  }
}

function updateSyncIndicator() {
  const btnText = document.getElementById("sync-button-text");
  const btnIcon = document.getElementById("sync-button-icon");
  const btn = document.getElementById("sync-button");
  if (!btnText) return;
  if (currentUser) {
    const name = currentUser.email ? currentUser.email.split("@")[0] : "Synced";
    btnText.textContent = name;
    if (btnIcon) btnIcon.innerHTML = `<span class="sync-dot"></span>`;
    btn?.setAttribute("title", `Connected as ${currentUser.email} (Real-time Cloud Sync active)`);
  } else {
    btnText.textContent = "Cloud Sync";
    if (btnIcon) btnIcon.textContent = "☁";
    btn?.setAttribute("title", "Sign in to sync across desktop and mobile");
  }
}

async function pullFromSupabase() {
  const sb = getSupabase();
  if (!sb || !currentUser) return;
  try {
    isSyncing = true;
    const { data: row, error } = await sb
      .from("ledger_records")
      .select("data, updated_at")
      .eq("user_id", currentUser.id)
      .maybeSingle();

    if (error) throw error;
    if (row && row.data && typeof row.data === "object" && Array.isArray(row.data.invoices)) {
      data = { ...emptyData(), ...row.data, settings: { ...emptyData().settings, ...row.data.settings } };
      localStorage.setItem(KEY, JSON.stringify(data));
      if (data.settings?.theme) {
        applyTheme(data.settings.theme);
      }
      render();
      updateSyncIndicator();
    } else if (data.clients.length || data.invoices.length || data.expenses.length) {
      // Local has records but cloud is empty, upload to cloud
      await pushToSupabase();
    }
  } catch (e) {
    console.warn("Pull error:", e);
  } finally {
    isSyncing = false;
  }
}

async function pushToSupabase() {
  const sb = getSupabase();
  if (!sb || !currentUser) return;
  try {
    const { error } = await sb
      .from("ledger_records")
      .upsert({
        user_id: currentUser.id,
        data: data,
        updated_at: new Date().toISOString()
      });
    if (error) throw error;
  } catch (e) {
    console.warn("Cloud push error:", e);
  }
}

async function syncNow() {
  if (!currentUser) return;
  notify("Syncing with Supabase cloud...");
  await pushToSupabase();
  await pullFromSupabase();
  closeModal();
  notify("Records synchronized with cloud!");
}

async function signOut() {
  const sb = getSupabase();
  if (sb) {
    await sb.auth.signOut();
  }
  currentUser = null;
  updateSyncIndicator();
  closeModal();
  notify("Signed out of Supabase.");
}

function authModal(mode = "signin") {
  if (currentUser) {
    showModal("Cloud Sync & Account", `
      <div class="form">
        <div class="auth-status-card">
          <span class="sync-dot"></span>
          <div>
            <div style="font-weight:800; color:var(--text-primary); font-size:15px;">Connected to Supabase</div>
            <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">${escape(currentUser.email)}</div>
          </div>
        </div>

        <p class="help" style="margin-bottom:18px;">
          Your invoices, payments, and clients sync automatically. Sign into this same account on your mobile browser (<strong>https://total-berries.vercel.app</strong>) to access and manage your records anywhere.
        </p>

        <div class="form-actions">
          <button type="button" class="pill-btn pill-btn-danger" data-action="sign-out">Sign Out</button>
          <div class="form-actions-right">
            <button type="button" class="pill-btn pill-btn-ghost" data-action="close-modal">Close</button>
            <button type="button" class="pill-btn pill-btn-neon" data-action="sync-now">Sync Now</button>
          </div>
        </div>
      </div>
    `);
    return;
  }

  showModal("Cross-Device Cloud Sync", `
    <form class="form" id="auth-form" data-mode="${mode}">
      <div class="auth-tabs">
        <button type="button" class="auth-tab-btn ${mode === "signin" ? "active" : ""}" data-action="auth-tab" data-id="signin">Sign In</button>
        <button type="button" class="auth-tab-btn ${mode === "signup" ? "active" : ""}" data-action="auth-tab" data-id="signup">Create Account</button>
      </div>

      <p class="help" style="margin-bottom:16px;">
        ${mode === "signin" 
          ? "Sign in to access and sync your records across desktop and mobile in real-time." 
          : "Create an account to securely access your ledger on both your laptop and phone."}
      </p>

      <div class="form-grid">
        <div class="field full">
          <label>Email Address</label>
          <input name="email" type="email" placeholder="you@example.com" required autocomplete="email" />
        </div>
        <div class="field full">
          <label>Password</label>
          <input name="password" type="password" placeholder="••••••••" required autocomplete="current-password" minlength="6" />
        </div>
      </div>

      <div class="form-actions">
        <button type="button" class="pill-btn pill-btn-ghost pill-btn-sm" data-action="magic-link" title="Passwordless login link sent to your email">
          Magic Link
        </button>
        <div class="form-actions-right">
          <button type="button" class="pill-btn pill-btn-ghost" data-action="close-modal">Cancel</button>
          <button class="pill-btn pill-btn-neon">
            ${mode === "signin" ? "Sign In" : "Create Account"}
          </button>
        </div>
      </div>
    </form>
  `);
}

async function handleAuthSubmit(form) {
  const sb = getSupabase();
  if (!sb) return notify("Connecting to Supabase... Please try again.");

  const mode = form.dataset.mode || "signin";
  const { email, password } = formObject(form);

  if (!email || !password) return notify("Please enter your email and password.");

  notify("Authenticating with Supabase...");
  try {
    if (mode === "signup") {
      const redirectUrl = window.location.origin;
      const { data: res, error } = await sb.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectUrl }
      });
      if (error) throw error;
      if (res.user && !res.session) {
        closeModal();
        notify("Account created! Check your email to confirm, then sign in.");
      } else if (res.session) {
        currentUser = res.user;
        updateSyncIndicator();
        closeModal();
        notify("Account connected! Cloud sync active.");
        await pushToSupabase();
      }
    } else {
      const { data: res, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      currentUser = res.user;
      updateSyncIndicator();
      closeModal();
      notify("Signed in! Syncing records...");
      await pullFromSupabase();
    }
  } catch (err) {
    notify(`Auth error: ${err.message || "Failed to authenticate."}`);
  }
}

async function sendMagicLink() {
  const sb = getSupabase();
  const emailInput = document.querySelector("#auth-form input[name='email']");
  const email = emailInput?.value?.trim();
  if (!email) return notify("Enter your email address to receive a magic link.");

  notify("Sending login link...");
  try {
    const redirectUrl = window.location.origin;
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectUrl }
    });
    if (error) throw error;
    closeModal();
    notify("Check your email for the 1-click login link!");
  } catch (err) {
    notify(`Error: ${err.message || "Failed to send login link."}`);
  }
}

/* ==========================================================================
   SVG CHARTS & SPARKLINES HELPERS (Calculated from Real Data)
   ========================================================================== */
function sparklineSvg(points = [], isPositive = true, width = 64, height = 26) {
  if (!points.length || points.every(p => p === 0)) {
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">
      <line x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}" stroke="var(--border-card)" stroke-width="2" stroke-dasharray="3 3"/>
    </svg>`;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = width / (points.length - 1 || 1);
  const coords = points.map((p, i) => {
    const x = (i * step).toFixed(1);
    const y = (height - 4 - ((p - min) / range) * (height - 8)).toFixed(1);
    return `${x},${y}`;
  });
  const strokeColor = isPositive ? "#0066ff" : "#94a3b8";
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">
    <polyline points="${coords.join(" ")}" fill="none" stroke="${strokeColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function generateTrendChart(timeframe = "1M") {
  const width = 680;
  const height = 180;
  
  // Calculate real points from user recorded payments
  let points = [];
  let labels = [];

  if (timeframe === "24H") {
    labels = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"];
    const todayPayments = data.payments.filter(p => p.date === today()).reduce((s, p) => s + Number(p.amount), 0);
    points = todayPayments > 0 ? [0, todayPayments * 0.2, todayPayments * 0.4, todayPayments * 0.6, todayPayments * 0.8, todayPayments] : [0, 0, 0, 0, 0, 0];
  } else if (timeframe === "7D") {
    const days = [-6, -5, -4, -3, -2, -1, 0];
    labels = days.map(offset => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return d.toLocaleDateString("en-IN", { weekday: "short" });
    });
    points = days.map(offset => {
      const dStr = plusDays(offset);
      return data.payments.filter(p => p.date === dStr).reduce((s, p) => s + Number(p.amount), 0);
    });
  } else if (timeframe === "1M") {
    labels = ["Week 1", "Week 2", "Week 3", "Week 4"];
    const m = monthRange();
    points = [1, 2, 3, 4].map(w => {
      const startDay = (w - 1) * 7 + 1;
      const endDay = w === 4 ? 31 : w * 7;
      return data.payments.filter(p => {
        if (p.date < m.start || p.date > m.end) return false;
        const dayNum = parseInt(p.date.slice(8), 10);
        return dayNum >= startDay && dayNum <= endDay;
      }).reduce((s, p) => s + Number(p.amount), 0);
    });
  } else if (timeframe === "3M") {
    const months = [-2, -1, 0].map(monthRange);
    labels = months.map(m => m.label);
    points = months.map(m => paymentsInRange(m.start, m.end));
  } else if (timeframe === "1Y") {
    const months = [-11, -9, -7, -5, -3, -1].map(monthRange);
    labels = months.map(m => m.label);
    points = months.map(m => paymentsInRange(m.start, m.end));
  } else {
    // ALL
    const months = [-5, -4, -3, -2, -1, 0].map(monthRange);
    labels = months.map(m => m.label);
    points = months.map(m => paymentsInRange(m.start, m.end));
  }

  const max = Math.max(0, ...points);
  const min = Math.min(0, ...points);
  const range = max > 0 ? max - min : 1;
  const stepX = width / (points.length - 1 || 1);

  const coords = points.map((p, i) => ({
    x: i * stepX,
    y: max > 0 ? height - 30 - ((p - min) / range) * (height - 60) : height - 35
  }));

  // Build smooth cubic Bézier curve
  let pathD = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i === 0 ? 0 : i - 1];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 5;
    const cp1y = p1.y + (p2.y - p0.y) / 5;
    const cp2x = p2.x - (p3.x - p1.x) / 5;
    const cp2y = p2.y - (p3.y - p1.y) / 5;
    pathD += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  const areaD = `${pathD} L ${coords[coords.length - 1].x.toFixed(1)} ${height - 10} L 0 ${height - 10} Z`;
  const lastPoint = coords[coords.length - 1];

  return `
    <div class="chart-container">
      <div class="chart-tooltip-badge">
        <span style="color:var(--accent-orange)">●</span> High: ${currency(max)}
      </div>
      <svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="whiteAreaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.32" />
            <stop offset="100%" stop-color="#ffffff" stop-opacity="0.0" />
          </linearGradient>
        </defs>
        <!-- Horizontal grid guidelines -->
        <line x1="0" y1="${height - 25}" x2="${width}" y2="${height - 25}" class="chart-grid-line" />
        <line x1="0" y1="${(height - 25) * 0.5}" x2="${width}" y2="${(height - 25) * 0.5}" class="chart-grid-line" />
        <!-- Area fill under line -->
        <path d="${areaD}" class="chart-area" />
        <!-- Smooth line path -->
        <path d="${pathD}" class="chart-line" />
        <!-- Vertical dashed guide for latest point -->
        <line x1="${lastPoint.x}" y1="${lastPoint.y}" x2="${lastPoint.x}" y2="${height - 25}" stroke="rgba(255,255,255,0.7)" stroke-dasharray="3 3" />
        <!-- Active data point -->
        <circle cx="${lastPoint.x}" cy="${lastPoint.y}" r="5.5" class="chart-point" />
      </svg>
      <!-- X-axis labels -->
      <div style="display:flex; justify-content:space-between; padding-top:6px; color:rgba(255,255,255,0.85); font-size:11px; font-weight:700;">
        ${labels.map(l => `<span>${l}</span>`).join("")}
      </div>
    </div>
  `;
}

function render() {
  if (currentView === "more") currentView = "clients";
  const content = document.getElementById("content");
  const views = { dashboard, invoices, payments, expenses, clients, projects, reports, settings };
  content.innerHTML = (views[currentView] || dashboard)();
  
  // Update desktop sidebar and mobile navigation active states
  document.querySelectorAll("[data-view]").forEach(a => {
    const isMatch = a.dataset.view === currentView || (a.dataset.view === "more" && ["clients", "projects", "reports", "settings"].includes(currentView));
    a.classList.toggle("active", isMatch);
  });
  updateSyncIndicator();
}

function heading(title, subtitle, action = "") {
  return `<div class="view-heading"><div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${action}</div>`;
}

function noRows(message, actionText, action) {
  return `<div class="empty"><strong>${message}</strong>${actionText ? `<button class="pill-btn pill-btn-neon pill-btn-sm" data-action="${action}"><span class="btn-icon">+</span> ${actionText}</button>` : ""}</div>`;
}

function statusPill(status) {
  return `<span class="status status-${status.toLowerCase()}">${status}</span>`;
}

/* ==========================================================================
   VIEW: DASHBOARD (Calculated 100% From User Real Data)
   ========================================================================== */
function dashboard() {
  const month = monthRange();
  const income = paymentsInRange(month.start, month.end);
  const expenses = expensesInRange(month.start, month.end);
  const openingCash = Number(data.settings?.cashOpeningBalance || 0);
  const allTimeIncome = data.payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const allTimeExpenses = data.expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalBalance = openingCash + allTimeIncome - allTimeExpenses;
  const outstanding = data.invoices.filter(i => !i.draft).reduce((sum, i) => sum + balance(i), 0);
  const overdue = data.invoices.filter(i => invoiceStatus(i) === "Overdue").reduce((sum, i) => sum + balance(i), 0);
  const due = [...data.invoices].filter(i => !i.draft && balance(i) > 0).sort((a,b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999")).slice(0, 5);
  const latest = [...data.payments].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 5);

  // Past 7 days real numbers
  const weekDays = [-6, -5, -4, -3, -2, -1, 0].map(offset => {
    const dStr = plusDays(offset);
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const inc = data.payments.filter(p => p.date === dStr).reduce((s, p) => s + Number(p.amount), 0);
    const exp = data.expenses.filter(e => e.date === dStr).reduce((s, e) => s + Number(e.amount), 0);
    return { label: d.toLocaleDateString("en-IN", { weekday: "narrow" }), inc, exp, date: dStr };
  });
  const maxDayVal = Math.max(1, ...weekDays.flatMap(d => [d.inc, d.exp]));

  // Find top client if any
  const topClient = data.clients.length ? data.clients.map(c => ({
    ...c,
    revenue: data.invoices.filter(i => i.clientId === c.id).reduce((s, i) => s + invoiceAmount(i), 0)
  })).sort((a, b) => b.revenue - a.revenue)[0] : null;

  return `
    <!-- Hero Financial Overview Card -->
    <section class="hero-card">
      <div class="hero-top">
        <div class="hero-balance-group">
          <div class="hero-badge-icon">₹</div>
          <div class="hero-balance-meta">
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="hero-balance-label">Cash on Hand &middot; Total Balance</span>
              <button type="button" class="hero-edit-balance-btn" data-action="edit-cash-opening" title="Edit Opening Balance in Cash">
                ✏️ ${openingCash > 0 ? "Edit Opening" : "Add Opening"}
              </button>
            </div>
            <div class="hero-balance-amount">${currency(totalBalance)}</div>
            ${openingCash > 0 ? `
              <div class="hero-balance-sub">
                <span>Opening Cash: <strong>${currency(openingCash)}</strong></span>
                ${data.settings.cashOpeningDate ? `<span style="opacity:0.8;">(as of ${dateText(data.settings.cashOpeningDate)})</span>` : ""}
              </div>
            ` : `
              <div class="hero-balance-sub" style="opacity:0.85;">
                <span>No opening cash set &middot; <a href="javascript:void(0)" data-action="edit-cash-opening" style="color:#ffffff; text-decoration:underline;">+ Add opening balance</a></span>
              </div>
            `}
          </div>
        </div>
        <div class="hero-pill-badge">
          <span class="hero-pill-dot"></span>
          <span>${data.invoices.length ? `${data.invoices.length} active invoice${data.invoices.length === 1 ? "" : "s"}` : "Ready &middot; Clean slate"}</span>
        </div>
      </div>

      <!-- Timeframe Pills (24H, 7D, 1M, 3M, 1Y, ALL) -->
      <div class="timeframe-pills">
        ${["24H", "7D", "1M", "3M", "1Y", "ALL"].map(tf => `
          <button class="timeframe-pill ${tf === selectedTimeframe ? "active" : ""}" data-timeframe="${tf}">${tf}</button>
        `).join("")}
      </div>

      <!-- Dynamic SVG Bézier Curve Graph -->
      ${generateTrendChart(selectedTimeframe)}

      <!-- Hero Action Buttons (Calfo Navy + White Pills) -->
      <div class="hero-actions">
        <button class="pill-btn pill-btn-navy" data-action="new-invoice">
          <span class="btn-icon">+</span>
          <span>Invoice</span>
        </button>
        <button class="pill-btn pill-btn-white" data-action="new-payment">
          <span class="btn-icon">↓</span>
          <span>Deposit</span>
        </button>
        <button class="pill-btn pill-btn-ghost" data-action="new-expense">
          <span class="btn-icon">↗</span>
          <span>Expense</span>
        </button>
      </div>
    </section>

    <!-- Metrics Grid (4-Cards with Sparklines) -->
    <section class="metrics">
      <article class="metric-card">
        <div class="metric-header">
          <span class="metric-label">Income Received</span>
          <div class="metric-sparkline">${sparklineSvg(weekDays.map(w => w.inc), true)}</div>
        </div>
        <div>
          <div class="metric-value">${currency(income)}</div>
          <div class="metric-note">This current month</div>
        </div>
      </article>

      <article class="metric-card">
        <div class="metric-header">
          <span class="metric-label">Expenses</span>
          <div class="metric-sparkline">${sparklineSvg(weekDays.map(w => w.exp), false)}</div>
        </div>
        <div>
          <div class="metric-value">${currency(expenses)}</div>
          <div class="metric-note">Operating spending</div>
        </div>
      </article>

      <article class="metric-card">
        <div class="metric-header">
          <span class="metric-label">Outstanding</span>
          <div class="metric-sparkline">${sparklineSvg(data.invoices.map(i => balance(i)), true)}</div>
        </div>
        <div>
          <div class="metric-value">${currency(outstanding)}</div>
          <div class="metric-note">Across unpaid invoices</div>
        </div>
      </article>

      <article class="metric-card">
        <div class="metric-header">
          <span class="metric-label">Overdue</span>
          <div class="metric-sparkline">${sparklineSvg(data.invoices.filter(i => invoiceStatus(i) === "Overdue").map(i => balance(i)), false)}</div>
        </div>
        <div>
          <div class="metric-value" style="${overdue > 0 ? "color:var(--color-overdue);" : ""}">${currency(overdue)}</div>
          <div class="metric-note">Needs client follow-up</div>
        </div>
      </article>
    </section>

    <!-- Top Retainer / Quick Starter Card -->
    ${topClient && topClient.revenue > 0 ? `
      <section class="featured-card-orange">
        <div class="featured-card-left">
          <div class="featured-avatar">⚡</div>
          <div>
            <div class="featured-title">${escape(topClient.name)}</div>
            <div class="featured-sub">Primary Revenue Partner</div>
          </div>
        </div>
        <div class="featured-card-right">
          <div class="featured-value">${currency(topClient.revenue)}</div>
          <span class="featured-badge">Invoiced Total</span>
        </div>
        <svg class="featured-sparkline-bg" viewBox="0 0 200 60" preserveAspectRatio="none">
          <path d="M0 45 C 50 15, 100 50, 150 20 L 200 10 L 200 60 L 0 60 Z" fill="#ffffff" />
        </svg>
      </section>
    ` : `
      <section class="featured-card-orange">
        <div class="featured-card-left">
          <div class="featured-avatar">💼</div>
          <div>
            <div class="featured-title">Start by adding your first client</div>
            <div class="featured-sub">Records sync across your phone and laptop with Supabase</div>
          </div>
        </div>
        <div class="featured-card-right">
          <button class="pill-btn pill-btn-white pill-btn-sm" data-action="new-client">+ Add Client</button>
        </div>
      </section>
    `}

    <!-- 2-Column Dashboard Grid: Weekly Bar Chart & Action Lists -->
    <section class="grid-2">
      <!-- Inflow vs Outflow Dual-Tone Bar Chart -->
      <article class="card bar-chart-card">
        <div class="panel-head">
          <div>
            <h2>Weekly Cashflow</h2>
            <p class="subtitle">${income === 0 && expenses === 0 ? "No cashflow recorded this week yet" : "Inflow vs Outflow comparison"}</p>
          </div>
          <span class="hero-pill-badge" style="background:var(--accent-orange-dim); color:var(--accent-orange); border-color:rgba(0,102,255,0.2);">Live</span>
        </div>

        <div class="bar-chart-wrap">
          ${weekDays.map(d => `
            <div class="bar-column">
              <div class="bar-pair">
                <div class="bar-pill income" style="height:${d.inc > 0 ? Math.max(8, (d.inc / maxDayVal) * 100) : 4}%;" title="${d.date} Inflow: ${currency(d.inc)}"></div>
                <div class="bar-pill expense" style="height:${d.exp > 0 ? Math.max(8, (d.exp / maxDayVal) * 100) : 4}%;" title="${d.date} Outflow: ${currency(d.exp)}"></div>
              </div>
              <span class="bar-day-label">${d.label}</span>
            </div>
          `).join("")}
        </div>

        <div class="chart-legend">
          <span><i class="legend-dot orange"></i>Income Received</span>
          <span><i class="legend-dot navy"></i>Expenses</span>
        </div>
      </article>

      <!-- Invoices to Follow Up & Recent Transactions -->
      <article class="card panel">
        <div class="panel-head">
          <h2>Pending Invoices</h2>
          <a href="#invoices">View all →</a>
        </div>
        <div class="list">
          ${due.length ? due.map(i => `
            <div class="list-row clickable" data-action="invoice-detail" data-id="${i.id}">
              <div style="display:flex; align-items:center; gap:12px;">
                <div class="hero-badge-icon" style="width:36px; height:36px; font-size:16px; background:#eff6ff; color:#0066ff; border:1px solid #bfdbfe;">📄</div>
                <div>
                  <div class="primary-text">${escape(i.number)}</div>
                  <div class="secondary-text">${escape(clientName(i.clientId))} &middot; Due ${dateText(i.dueDate)}</div>
                </div>
              </div>
              <div style="text-align:right;">
                <div class="money">${currency(balance(i))}</div>
                <div style="margin-top:3px;">${statusPill(invoiceStatus(i))}</div>
              </div>
            </div>
          `).join("") : noRows("Nothing awaiting payment", "Create an invoice", "new-invoice")}
        </div>
      </article>
    </section>
  `;
}

/* ==========================================================================
   VIEW: INVOICES
   ========================================================================== */
function invoices() {
  const q = searchText.toLowerCase();
  const rows = [...data.invoices].filter(i => `${i.number} ${clientName(i.clientId)}`.toLowerCase().includes(q)).sort((a,b) => b.issueDate.localeCompare(a.issueDate));
  
  return `
    ${heading("Invoices", "Create invoices and keep track of what clients owe you.", `
      <button class="pill-btn pill-btn-neon" data-action="new-invoice">
        <span class="btn-icon">+</span>
        <span>New Invoice</span>
      </button>
    `)}
    
    <div class="toolbar">
      <input class="search" data-search="invoices" value="${escape(searchText)}" placeholder="Search invoices, clients, numbers..." />
      <div class="toolbar-group">
        <span class="help">${rows.length} invoice${rows.length === 1 ? "" : "s"}</span>
      </div>
    </div>

    ${rows.length ? `
      <!-- Desktop Table View -->
      <div class="table-wrap desktop-only">
        <table>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Client</th>
              <th>Issued</th>
              <th>Due</th>
              <th>Status</th>
              <th class="money">Balance Due</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(i => `
              <tr class="clickable" data-action="invoice-detail" data-id="${i.id}">
                <td>
                  <div class="primary-text">${escape(i.number)}</div>
                  <div class="secondary-text">${escape(projectName(i.projectId))}</div>
                </td>
                <td>
                  <div class="primary-text">${escape(clientName(i.clientId))}</div>
                </td>
                <td>${dateText(i.issueDate)}</td>
                <td>${dateText(i.dueDate)}</td>
                <td>${statusPill(invoiceStatus(i))}</td>
                <td class="money">${currency(balance(i))}</td>
                <td style="text-align:right; white-space:nowrap;" onclick="event.stopPropagation()">
                  <button class="pill-btn pill-btn-ghost pill-btn-sm" data-action="edit-invoice" data-id="${i.id}">Edit</button>
                  <button class="pill-btn pill-btn-ghost pill-btn-sm" data-action="print-invoice" data-id="${i.id}">🖨️</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <!-- Mobile Touch-Optimized Cards -->
      <div class="mobile-cards-list mobile-only">
        ${rows.map(i => `
          <article class="invoice-mobile-card clickable" data-action="invoice-detail" data-id="${i.id}">
            <div class="imc-top">
              <div class="imc-left">
                <div class="imc-number">${escape(i.number)}</div>
                <div class="imc-client">${escape(clientName(i.clientId))}</div>
                ${i.projectId ? `<div class="imc-project">${escape(projectName(i.projectId))}</div>` : ""}
              </div>
              <div class="imc-right">
                <div class="imc-amount money">${currency(balance(i))}</div>
                <div class="imc-status">${statusPill(invoiceStatus(i))}</div>
              </div>
            </div>
            <div class="imc-bottom">
              <span class="imc-due">📅 Due ${dateText(i.dueDate)}</span>
              <div style="display:flex; gap:6px;" onclick="event.stopPropagation()">
                <button class="pill-btn pill-btn-ghost pill-btn-sm" data-action="edit-invoice" data-id="${i.id}">Edit</button>
                <button class="pill-btn pill-btn-ghost pill-btn-sm" data-action="print-invoice" data-id="${i.id}">🖨️</button>
              </div>
            </div>
          </article>
        `).join("")}
      </div>
    ` : noRows("No invoices yet", "Create your first invoice", "new-invoice")}
  `;
}

/* ==========================================================================
   VIEW: PAYMENTS
   ========================================================================== */
function payments() {
  const rows = [...data.payments].sort((a,b) => b.date.localeCompare(a.date));
  const totalReceived = rows.reduce((s, p) => s + Number(p.amount), 0);
  const openingCash = Number(data.settings?.cashOpeningBalance || 0);

  return `
    ${heading("Payments Received", "Track incoming payments, UPI transfers, and bank deposits.", `
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="pill-btn pill-btn-ghost" data-action="edit-cash-opening" title="Set or edit opening cash balance">
          <span>💵 Opening Cash</span>
        </button>
        <button class="pill-btn pill-btn-white" data-action="new-payment">
          <span class="btn-icon">↓</span>
          <span>Record Deposit</span>
        </button>
      </div>
    `)}

    <div class="toolbar">
      <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
        <div class="help">Lifetime revenue received: <strong style="color:var(--accent-orange);">${currency(totalReceived)}</strong></div>
        <div class="help" style="border-left:1px solid var(--border-card); padding-left:12px;">
          Opening Cash: <strong style="color:var(--text-primary);">${currency(openingCash)}</strong>
          <button type="button" class="pill-btn pill-btn-ghost pill-btn-xs" data-action="edit-cash-opening" style="margin-left:6px;" title="Edit cash opening balance">✏️ Edit</button>
        </div>
      </div>
      <button class="pill-btn pill-btn-ghost pill-btn-sm" data-action="export-report">Export Log</button>
    </div>

    ${openingCash > 0 && !rows.length ? `
      <div style="margin-bottom:16px; padding:14px 16px; background:var(--bg-card); border:1px solid var(--border-card); border-radius:var(--radius-md); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div>
          <div style="font-weight:750; color:var(--text-primary); font-size:14px;">💵 Cash on Hand Opening Balance: ${currency(openingCash)}</div>
          <div class="help" style="margin-top:2px;">Initial cash recorded ${data.settings.cashOpeningDate ? `as of ${dateText(data.settings.cashOpeningDate)}` : ""}</div>
        </div>
        <button class="pill-btn pill-btn-ghost pill-btn-sm" data-action="edit-cash-opening">✏️ Edit Opening Cash</button>
      </div>
    ` : ""}

    ${rows.length ? `
      <!-- Desktop Table View -->
      <div class="table-wrap desktop-only">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Invoice</th>
              <th>Client</th>
              <th>Mode</th>
              <th>Reference / UTR</th>
              <th class="money">Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(p => {
              const inv = data.invoices.find(i => i.id === p.invoiceId);
              return `
                <tr>
                  <td>${dateText(p.date)}</td>
                  <td class="primary-text">${escape(inv?.number || p.invoiceNumber || "—")}</td>
                  <td>${escape(inv ? clientName(inv.clientId) : "—")}</td>
                  <td><span class="status status-paid">${escape(p.mode)}</span></td>
                  <td>${escape(p.reference || "—")}</td>
                  <td class="money positive">+${currency(p.amount)}</td>
                  <td style="text-align:right; white-space:nowrap;">
                    <button class="pill-btn pill-btn-ghost pill-btn-sm" data-action="edit-payment" data-id="${p.id}" title="Edit deposit">Edit</button>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>

      <!-- Mobile Touch-Optimized Cards -->
      <div class="mobile-cards-list mobile-only">
        ${rows.map(p => {
          const inv = data.invoices.find(i => i.id === p.invoiceId);
          return `
            <article class="payment-mobile-card">
              <div class="imc-top">
                <div class="imc-left">
                  <div class="imc-number">${escape(inv?.number || p.invoiceNumber || "Direct Deposit")}</div>
                  <div class="imc-client">${escape(inv ? clientName(inv.clientId) : "Payment")}</div>
                </div>
                <div class="imc-right">
                  <div class="imc-amount money positive">+${currency(p.amount)}</div>
                  <div class="imc-status"><span class="status status-paid">${escape(p.mode)}</span></div>
                </div>
              </div>
              <div class="imc-bottom">
                <span>Ref: ${escape(p.reference || "—")}</span>
                <div style="display:flex; gap:8px; align-items:center;">
                  <span>${dateText(p.date)}</span>
                  <button class="pill-btn pill-btn-ghost pill-btn-sm" data-action="edit-payment" data-id="${p.id}" style="padding:2px 8px; font-size:11px;">Edit</button>
                </div>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    ` : noRows("No payments recorded yet", "Record a deposit", "new-payment")}
  `;
}

/* ==========================================================================
   VIEW: EXPENSES
   ========================================================================== */
function expenses() {
  const rows = [...data.expenses].sort((a,b) => b.date.localeCompare(a.date));
  const total = rows.reduce((s,e) => s + Number(e.amount), 0);

  return `
    ${heading("Expenses", "Track business spending, tools, equipment, and subscriptions.", `
      <button class="pill-btn pill-btn-neon" data-action="new-expense">
        <span class="btn-icon">+</span>
        <span>Add Expense</span>
      </button>
    `)}

    <div class="toolbar">
      <div class="help">Total business expenses: <strong style="color:var(--text-primary);">${currency(total)}</strong></div>
      <button class="pill-btn pill-btn-ghost pill-btn-sm" data-action="export-expenses">Export CSV</button>
    </div>

    ${rows.length ? `
      <!-- Desktop Table View -->
      <div class="table-wrap desktop-only">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Category</th>
              <th>Description</th>
              <th>Mode</th>
              <th class="money">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(e => `
              <tr>
                <td>${dateText(e.date)}</td>
                <td><span class="status status-draft">${escape(e.category)}</span></td>
                <td class="primary-text">${escape(e.description || "—")}</td>
                <td>${escape(e.mode)}</td>
                <td class="money negative">-${currency(e.amount)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <!-- Mobile Touch-Optimized Cards -->
      <div class="mobile-cards-list mobile-only">
        ${rows.map(e => `
          <article class="expense-mobile-card">
            <div class="imc-top">
              <div class="imc-left">
                <div class="imc-number">${escape(e.description || e.category)}</div>
                <div class="imc-client"><span class="status status-draft">${escape(e.category)}</span> &middot; ${escape(e.mode)}</div>
              </div>
              <div class="imc-right">
                <div class="imc-amount money negative">-${currency(e.amount)}</div>
              </div>
            </div>
            <div class="imc-bottom">
              <span>${dateText(e.date)}</span>
              <span class="secondary-text" style="font-size:11px;">${escape(e.mode)}</span>
            </div>
          </article>
        `).join("")}
      </div>
    ` : noRows("No expenses recorded yet", "Add an expense", "new-expense")}
  `;
}

/* ==========================================================================
   VIEW: CLIENTS
   ========================================================================== */
function clients() {
  const rows = [...data.clients].sort((a,b) => a.name.localeCompare(b.name));

  return `
    ${heading("Clients & Partners", "Manage client contact information, GST numbers, and payment history.", `
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="pill-btn pill-btn-ghost" data-action="client-ledger" title="Print Ledger for any client">
          <span class="btn-icon">🖨️</span>
          <span>Client Ledger</span>
        </button>
        <button class="pill-btn pill-btn-neon" data-action="new-client">
          <span class="btn-icon">+</span>
          <span>Add Client</span>
        </button>
      </div>
    `)}

    ${rows.length ? `
      <!-- Desktop Table View -->
      <div class="table-wrap desktop-only">
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Contact Details</th>
              <th>GSTIN</th>
              <th class="money">Outstanding</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(c => {
              const outstanding = Number(c.openingBalance || 0) + data.invoices.filter(i => i.clientId === c.id && !i.draft).reduce((s,i) => s + balance(i), 0);
              return `
                <tr>
                  <td>
                    <div class="primary-text">${escape(c.name)}</div>
                    <div class="secondary-text">${escape(c.address || "")}</div>
                    ${Number(c.openingBalance) > 0 ? `<div style="font-size:11px; color:var(--accent-orange); margin-top:2px;">Opening: ${currency(c.openingBalance)} (${escape(c.openingBalanceMode || "Cash")})</div>` : ""}
                  </td>
                  <td>
                    <div class="primary-text">${escape(c.email || "—")}</div>
                    <div class="secondary-text">${escape(c.phone || "")} ${c.contact ? `&middot; ${escape(c.contact)}` : ""}</div>
                  </td>
                  <td>${escape(c.gstin || "—")}</td>
                  <td class="money">${currency(outstanding)}</td>
                  <td style="text-align:right; white-space:nowrap;">
                    <button class="pill-btn pill-btn-ghost pill-btn-sm" data-action="client-ledger" data-id="${c.id}" title="View and print statement">🖨️ Ledger</button>
                    <button class="pill-btn pill-btn-ghost pill-btn-sm" data-action="edit-client" data-id="${c.id}">Edit</button>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>

      <!-- Mobile Touch-Optimized Cards -->
      <div class="mobile-cards-list mobile-only">
        ${rows.map(c => {
          const outstanding = Number(c.openingBalance || 0) + data.invoices.filter(i => i.clientId === c.id && !i.draft).reduce((s,i) => s + balance(i), 0);
          return `
            <article class="client-mobile-card">
              <div class="imc-top">
                <div class="imc-left">
                  <div class="imc-number">${escape(c.name)}</div>
                  <div class="imc-client">${escape(c.email || c.phone || "No contact info")}</div>
                  ${Number(c.openingBalance) > 0 ? `<div style="font-size:10.5px; color:var(--accent-orange); margin-top:2px;">Opening: ${currency(c.openingBalance)} (${escape(c.openingBalanceMode || "Cash")})</div>` : ""}
                </div>
                <div class="imc-right">
                  <div class="imc-amount money">${currency(outstanding)}</div>
                  <div class="secondary-text" style="font-size:10.5px;">Due</div>
                </div>
              </div>
              <div class="imc-bottom">
                <span>GST: ${escape(c.gstin || "—")}</span>
                <div style="display:flex; gap:6px;">
                  <button class="pill-btn pill-btn-ghost pill-btn-sm" data-action="client-ledger" data-id="${c.id}">🖨️ Ledger</button>
                  <button class="pill-btn pill-btn-ghost pill-btn-sm" data-action="edit-client" data-id="${c.id}">Edit</button>
                </div>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    ` : noRows("No clients yet", "Add your first client", "new-client")}
  `;
}

/* ==========================================================================
   VIEW: PROJECTS
   ========================================================================== */
function projects() {
  const rows = [...data.projects].sort((a,b) => a.name.localeCompare(b.name));

  return `
    ${heading("Projects", "Link client deliverables and milestone invoices.", `
      <button class="pill-btn pill-btn-neon" data-action="new-project">
        <span class="btn-icon">+</span>
        <span>Add Project</span>
      </button>
    `)}

    <div class="table-wrap">
      ${rows.length ? `
        <table>
          <thead>
            <tr>
              <th>Project Name</th>
              <th>Client</th>
              <th>Status</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(p => `
              <tr>
                <td class="primary-text">${escape(p.name)}</td>
                <td>${escape(clientName(p.clientId))}</td>
                <td><span class="status status-paid">${escape(p.status || "Active")}</span></td>
                <td class="secondary-text">${escape(p.notes || "—")}</td>
                <td style="text-align:right;">
                  <button class="pill-btn pill-btn-ghost pill-btn-sm" data-action="edit-project" data-id="${p.id}">Edit</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : noRows("No projects yet", "Add a project", "new-project")}
    </div>
  `;
}

/* ==========================================================================
   VIEW: REPORTS & ANALYTICS
   ========================================================================== */
function reports() {
  const months = [-5,-4,-3,-2,-1,0].map(monthRange);
  const values = months.map(m => ({
    ...m,
    income: paymentsInRange(m.start, m.end),
    expense: expensesInRange(m.start, m.end)
  }));
  const max = Math.max(1, ...values.flatMap(v => [v.income, v.expense]));
  const received = values.reduce((s,v) => s + v.income, 0);
  const spent = values.reduce((s,v) => s + v.expense, 0);
  const openingCash = Number(data.settings?.cashOpeningBalance || 0);
  const netSurplus = openingCash + received - spent;
  const unpaid = data.invoices.reduce((s,i) => s + balance(i), 0);

  const byClient = data.clients.map(c => ({
    name: c.name,
    paid: data.invoices.filter(i => i.clientId === c.id).reduce((sum,i) => sum + paidAmount(i.id), 0),
    due: data.invoices.filter(i => i.clientId === c.id).reduce((sum,i) => sum + balance(i), 0)
  })).filter(x => x.paid || x.due).sort((a,b) => b.paid - a.paid);

  return `
    ${heading("Financial Analytics", "Six-month cashflow velocity and client profitability.", `
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="pill-btn pill-btn-ghost" data-action="edit-cash-opening">
          <span>💵 Opening Cash</span>
        </button>
        <button class="pill-btn pill-btn-ghost" data-action="export-report">
          <span>Export Summary</span>
        </button>
      </div>
    `)}

    <section class="metrics">
      <article class="metric-card">
        <div class="metric-label">6-Mo Inflow</div>
        <div class="metric-value" style="color:var(--accent-orange);">${currency(received)}</div>
        <div class="metric-note">Total payments received</div>
      </article>
      <article class="metric-card">
        <div class="metric-label">6-Mo Outflow</div>
        <div class="metric-value">${currency(spent)}</div>
        <div class="metric-note">Total business expenses</div>
      </article>
      <article class="metric-card">
        <div class="metric-label">Cash Surplus</div>
        <div class="metric-value">${currency(netSurplus)}</div>
        <div class="metric-note">${openingCash > 0 ? `Includes ${currency(openingCash)} opening cash` : "Net profits generated"} &middot; <a href="javascript:void(0)" data-action="edit-cash-opening" style="color:var(--accent-orange); font-weight:700;">Edit</a></div>
      </article>
      <article class="metric-card">
        <div class="metric-label">Unpaid Receivables</div>
        <div class="metric-value">${currency(unpaid)}</div>
        <div class="metric-note">Pending collection</div>
      </article>
    </section>

    <section class="grid-2">
      <!-- 6-Month Income vs Expenses Bar Chart -->
      <article class="card bar-chart-card">
        <div class="panel-head">
          <h2>Income vs Expenses</h2>
          <span class="help">Monthly comparison</span>
        </div>
        <div class="bar-chart-wrap" style="height:210px;">
          ${values.map(v => `
            <div class="bar-column">
              <div class="bar-pair">
                <div class="bar-pill income" style="height:${v.income > 0 ? Math.max(6, (v.income / max) * 100) : 4}%;" title="${v.label} Received: ${currency(v.income)}"></div>
                <div class="bar-pill expense" style="height:${v.expense > 0 ? Math.max(6, (v.expense / max) * 100) : 4}%;" title="${v.label} Spent: ${currency(v.expense)}"></div>
              </div>
              <span class="bar-day-label">${v.label}</span>
            </div>
          `).join("")}
        </div>
        <div class="chart-legend">
          <span><i class="legend-dot orange"></i>Received</span>
          <span><i class="legend-dot navy"></i>Expenses</span>
        </div>
      </article>

      <!-- Client Balances -->
      <article class="card panel">
        <div class="panel-head">
          <h2>Client Inflow Share</h2>
        </div>
        <div class="list">
          ${byClient.length ? byClient.slice(0, 5).map(c => `
            <div class="list-row">
              <div class="primary-text">${escape(c.name)}</div>
              <div style="text-align:right;">
                <div class="money positive">${currency(c.paid)}</div>
                <div class="secondary-text">${currency(c.due)} due</div>
              </div>
            </div>
          `).join("") : noRows("No client revenue data recorded yet")}
        </div>
      </article>
    </section>
  `;
}

/* ==========================================================================
   VIEW: SETTINGS
   ========================================================================== */
function settings() {
  const s = data.settings;
  return `
    ${heading("Settings & Vault", "Manage your business details, Supabase sync, and local backups.")}

    <div class="mobile-quick-nav">
      <a href="#clients" class="pill-btn pill-btn-ghost pill-btn-sm">👥 Clients (${data.clients.length})</a>
      <a href="#projects" class="pill-btn pill-btn-ghost pill-btn-sm">📁 Projects (${data.projects.length})</a>
      <a href="#expenses" class="pill-btn pill-btn-ghost pill-btn-sm">💳 Expenses (${data.expenses.length})</a>
    </div>

    <div class="grid-2">
      <article class="card panel">
        <div class="panel-head">
          <h2>Business Profile</h2>
        </div>
        <form id="settings-form" class="form" style="padding:0">
          <div class="form-grid">
            <div class="field full">
              <label>Business / Brand Name</label>
              <input name="businessName" value="${escape(s.businessName)}" required />
            </div>
            <div class="field">
              <label>GSTIN <span class="help">optional</span></label>
              <input name="gstin" value="${escape(s.gstin)}" placeholder="27AAPFU0912K1Z5" />
            </div>
            <div class="field">
              <label>Invoice Prefix</label>
              <input name="invoicePrefix" value="${escape(s.invoicePrefix)}" placeholder="TB" />
            </div>
            <div class="field">
              <label>Next Invoice #</label>
              <input name="nextInvoice" type="number" min="1" value="${Number(s.nextInvoice)||1}" />
            </div>
            <div class="field">
              <label>Payment Terms</label>
              <select name="defaultDueDays">
                <option value="7" ${s.defaultDueDays==7?"selected":""}>7 days</option>
                <option value="15" ${s.defaultDueDays==15?"selected":""}>15 days</option>
                <option value="30" ${s.defaultDueDays==30?"selected":""}>30 days</option>
                <option value="45" ${s.defaultDueDays==45?"selected":""}>45 days</option>
              </select>
            </div>
            <div class="field">
              <label>Cash Opening Balance (INR)</label>
              <div style="display:flex; gap:6px;">
                <input name="cashOpeningBalance" type="number" min="0" step="0.01" value="${Number(s.cashOpeningBalance) || ""}" placeholder="0.00" style="flex:1;" />
                <button type="button" class="pill-btn pill-btn-ghost pill-btn-sm" data-action="edit-cash-opening" title="Open detailed editor" style="white-space:nowrap;">✏️ Edit</button>
              </div>
            </div>
            <div class="field">
              <label>Cash Opening Date</label>
              <input name="cashOpeningDate" type="date" value="${s.cashOpeningDate || ""}" />
            </div>
            <div class="field full">
              <label>Cash Opening Notes <span class="help">optional</span></label>
              <input name="cashOpeningNotes" value="${escape(s.cashOpeningNotes || "")}" placeholder="E.g., Starting physical cash in drawer, register, or safe" />
            </div>
          </div>
          <div class="form-actions">
            <span></span>
            <button class="pill-btn pill-btn-neon">Save Profile</button>
          </div>
        </form>
      </article>

      <article class="card panel">
        <div class="panel-head">
          <h2>Cloud Sync & Local Vault</h2>
        </div>
        <div class="settings-list">
          <div class="settings-row">
            <div>
              <div class="primary-text">Appearance & Theme</div>
              <p class="help">
                Active: <strong style="color:var(--accent-orange);">${(document.documentElement.getAttribute("data-theme") === "dark" || data.settings?.theme === "dark") ? "Dark Mode 🌙" : "Light Mode ☀️"}</strong>
              </p>
            </div>
            <button class="pill-btn ${(document.documentElement.getAttribute("data-theme") === "dark" || data.settings?.theme === "dark") ? "pill-btn-neon" : "pill-btn-navy"} pill-btn-sm" data-action="toggle-theme">
              ${(document.documentElement.getAttribute("data-theme") === "dark" || data.settings?.theme === "dark") ? "☀️ Switch to Light" : "🌙 Switch to Dark"}
            </button>
          </div>
          <div class="settings-row">
            <div>
              <div class="primary-text">Supabase Cross-Device Sync</div>
              <p class="help">
                ${currentUser ? `Active: <strong style="color:var(--color-positive);">${escape(currentUser.email)}</strong>` : "Sign in to synchronize invoices & payments between your phone and laptop in real-time."}
              </p>
            </div>
            <button class="pill-btn ${currentUser ? "pill-btn-white" : "pill-btn-neon"} pill-btn-sm" data-action="open-auth">
              ${currentUser ? "Manage Account" : "Connect"}
            </button>
          </div>
          <div class="settings-row">
            <div>
              <div class="primary-text">Export Backup</div>
              <p class="help">Download your clients, invoices, and expenses as a private JSON file.</p>
            </div>
            <button class="pill-btn pill-btn-ghost pill-btn-sm" data-action="export-backup">Export JSON</button>
          </div>
          <div class="settings-row">
            <div>
              <div class="primary-text">Import Backup</div>
              <p class="help">Restore your records from a previously downloaded JSON file.</p>
            </div>
            <button class="pill-btn pill-btn-ghost pill-btn-sm" data-action="import-backup">Import JSON</button>
          </div>
          <div class="settings-row">
            <div>
              <div class="primary-text">Erase Local Device Data</div>
              <p class="help">Permanently wipe all records saved in this browser.</p>
            </div>
            <button class="pill-btn pill-btn-danger pill-btn-sm" data-action="clear-data">Clear All</button>
          </div>
        </div>
      </article>
    </div>

    <p class="notice" style="margin-top:20px;">
      🔒 <strong>End-to-End Privacy:</strong> All your financial data is secured with Supabase Row Level Security (RLS) and encrypted in transit. Only your authenticated account has access to your records.
    </p>
  `;
}

/* ==========================================================================
   MODAL DIALOGS & FORMS
   ========================================================================== */
function showModal(title, content, isLarge = false) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-content").innerHTML = content;
  const modalEl = document.querySelector(".modal");
  if (modalEl) {
    if (isLarge) modalEl.classList.add("modal-lg");
    else modalEl.classList.remove("modal-lg");
  }
  document.getElementById("modal-backdrop").hidden = false;
  setTimeout(() => document.querySelector("#modal-content input, #modal-content select")?.focus(), 25);
}

function closeModal() {
  document.getElementById("modal-backdrop").hidden = true;
  document.querySelector(".modal")?.classList.remove("modal-lg");
}

function optionClients(selected = "", blank = "Choose a client") {
  return `<option value="">${blank}</option>${data.clients.map(c => `<option value="${c.id}" ${c.id===selected?"selected":""}>${escape(c.name)}</option>`).join("")}`;
}

function optionProjects(selected = "") {
  return `<option value="">No project</option>${data.projects.map(p => `<option value="${p.id}" ${p.id===selected?"selected":""}>${escape(p.name)}</option>`).join("")}`;
}

function invoiceForm(id = "") {
  if (!data.clients.length) {
    showModal("Add a client first", `
      <form class="form" id="client-form">
        <p class="notice">Invoices require a registered client. Please add one first.</p>
        ${clientFields()}
        <div class="form-actions">
          <span></span>
          <div class="form-actions-right">
            <button type="button" class="pill-btn pill-btn-ghost" data-action="close-modal">Cancel</button>
            <button class="pill-btn pill-btn-neon">Save Client</button>
          </div>
        </div>
      </form>
    `);
    return;
  }

  const isEdit = Boolean(id);
  const inv = isEdit ? (data.invoices.find(x => x.id === id) || {}) : {};
  const currentGst = isEdit ? Number(inv.gstRate ?? 18) : 18;

  showModal(isEdit ? `Edit Invoice · ${escape(inv.number)}` : "Create Invoice", `
    <form class="form" id="invoice-form" data-id="${escape(id)}">
      ${isEdit ? `<input type="hidden" name="invoiceId" value="${escape(id)}" />` : ""}
      <div class="form-grid">
        <div class="field">
          <label>Invoice Number</label>
          <input name="number" value="${escape(isEdit ? inv.number : invoiceNumber())}" required />
        </div>
        <div class="field">
          <label>Client</label>
          <select name="clientId" required>${optionClients(inv.clientId)}</select>
        </div>
        <div class="field">
          <label>Project <span class="help">optional</span></label>
          <select name="projectId">${optionProjects(inv.projectId)}</select>
        </div>
        <div class="field">
          <label>Amount before GST (INR)</label>
          <input name="amount" type="number" min="0" step="0.01" placeholder="0.00" value="${inv.amount !== undefined ? inv.amount : ""}" required />
        </div>
        <div class="field">
          <label>Invoice Date</label>
          <input name="issueDate" type="date" value="${inv.issueDate || today()}" required />
        </div>
        <div class="field">
          <label>Due Date</label>
          <input name="dueDate" type="date" value="${inv.dueDate || plusDays(Number(data.settings.defaultDueDays)||15)}" required />
        </div>
        <div class="field">
          <label>GST Rate <span class="help">optional</span></label>
          <select name="gstRate">
            <option value="0" ${currentGst === 0 ? "selected" : ""}>No GST (0%)</option>
            <option value="5" ${currentGst === 5 ? "selected" : ""}>5%</option>
            <option value="12" ${currentGst === 12 ? "selected" : ""}>12%</option>
            <option value="18" ${currentGst === 18 ? "selected" : ""}>18%</option>
            <option value="28" ${currentGst === 28 ? "selected" : ""}>28%</option>
          </select>
        </div>
        <div class="field">
          <label>Reference / PO #</label>
          <input name="reference" value="${escape(inv.reference || "")}" placeholder="PO number or note" />
        </div>
        <div class="field full">
          <label>Project Scope & Notes</label>
          <textarea name="notes" placeholder="Deliverables, scope notes, or payment instructions">${escape(inv.notes || "")}</textarea>
        </div>
      </div>
      <div class="form-actions">
        ${isEdit ? `<button type="button" class="pill-btn pill-btn-danger" data-action="delete-invoice" data-id="${id}">Delete</button>` : "<span></span>"}
        <div class="form-actions-right">
          <button type="button" class="pill-btn pill-btn-ghost" data-action="close-modal">Cancel</button>
          ${!isEdit ? `<button class="pill-btn pill-btn-white" name="draft" value="1">Save Draft</button>` : (inv.draft ? `<button class="pill-btn pill-btn-white" name="draft" value="1">Keep as Draft</button>` : "")}
          <button class="pill-btn pill-btn-neon">${isEdit ? "Save Changes" : "Issue Invoice"}</button>
        </div>
      </div>
    </form>
  `);
}

function paymentForm(invoiceId = "", paymentId = "") {
  const isEdit = Boolean(paymentId);
  const pmt = isEdit ? (data.payments.find(x => x.id === paymentId) || {}) : {};
  const currentInvoiceId = isEdit ? pmt.invoiceId : invoiceId;

  const available = data.invoices.filter(i => (!i.draft && balance(i) > 0.005) || (isEdit && i.id === currentInvoiceId));
  if (!available.length && !isEdit) {
    notify("Create an unpaid invoice before recording a payment.");
    return;
  }
  const selected = isEdit 
    ? (data.invoices.find(i => i.id === currentInvoiceId) || available[0])
    : (available.find(i => i.id === invoiceId) || available[0]);

  const maxAllowed = isEdit
    ? (selected ? balance(selected) + Number(pmt.amount || 0) : 99999999)
    : (selected ? balance(selected) : 0);

  const currentMode = isEdit ? (pmt.mode || "Cash") : "Cash";

  showModal(isEdit ? "Edit Deposit / Payment" : "Record Deposit", `
    <form class="form" id="payment-form" ${isEdit ? `data-payment-id="${escape(paymentId)}"` : ""}>
      ${isEdit ? `<input type="hidden" name="paymentId" value="${escape(paymentId)}" />` : ""}
      <div class="form-grid">
        <div class="field full">
          <label>Target Invoice</label>
          <select name="invoiceId" required>
            ${available.map(i => `
              <option value="${i.id}" ${i.id === (selected ? selected.id : "") ? "selected" : ""}>
                ${escape(i.number)} &middot; ${escape(clientName(i.clientId))} (${currency(isEdit && i.id === currentInvoiceId ? balance(i) + Number(pmt.amount || 0) : balance(i))} due)
              </option>
            `).join("")}
          </select>
        </div>
        <div class="field">
          <label>Amount Received (INR)</label>
          <input name="amount" type="number" min="0.01" step="0.01" max="${maxAllowed.toFixed(2)}" value="${isEdit ? pmt.amount : (selected ? balance(selected).toFixed(2) : "")}" required />
        </div>
        <div class="field">
          <label>Deposit Date</label>
          <input name="date" type="date" value="${isEdit ? pmt.date : today()}" required />
        </div>
        <div class="field">
          <label>Payment Method</label>
          <select name="mode">
            <option ${currentMode === "UPI" ? "selected" : ""}>UPI</option>
            <option ${currentMode === "Bank transfer" ? "selected" : ""}>Bank transfer</option>
            <option ${currentMode === "Cash" ? "selected" : ""}>Cash</option>
            <option ${currentMode === "Card" ? "selected" : ""}>Card</option>
            <option ${currentMode === "Cheque" ? "selected" : ""}>Cheque</option>
            <option ${currentMode === "Other" ? "selected" : ""}>Other</option>
          </select>
        </div>
        <div class="field">
          <label>Reference / UTR #</label>
          <input name="reference" value="${escape(isEdit ? (pmt.reference || "") : "")}" placeholder="UTR or transaction ID" />
        </div>
        <div class="field full">
          <label>Deposit Notes</label>
          <input name="notes" value="${escape(isEdit ? (pmt.notes || "") : "")}" placeholder="Any useful context or memo" />
        </div>
      </div>
      <div class="form-actions">
        ${isEdit ? `<button type="button" class="pill-btn pill-btn-danger" data-action="delete-payment" data-id="${escape(paymentId)}">Delete</button>` : "<span></span>"}
        <div class="form-actions-right">
          <button type="button" class="pill-btn pill-btn-ghost" data-action="close-modal">Cancel</button>
          <button class="pill-btn pill-btn-neon">${isEdit ? "Update Deposit" : "Save Deposit"}</button>
        </div>
      </div>
    </form>
  `);
}

function cashOpeningBalanceModal() {
  const current = Number(data.settings?.cashOpeningBalance || 0);
  const currentDate = data.settings?.cashOpeningDate || today();
  const currentNotes = data.settings?.cashOpeningNotes || "";
  const isSet = current > 0;

  showModal(isSet ? "Edit Opening Balance in Cash" : "Add Opening Balance in Cash", `
    <form class="form" id="cash-opening-form">
      <div style="background:var(--bg-canvas); border:1px solid var(--border-card); border-radius:var(--radius-md); padding:14px; margin-bottom:16px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:36px; height:36px; border-radius:50%; background:var(--accent-orange-dim); color:var(--accent-orange); display:grid; place-items:center; font-size:18px; font-weight:800;">💵</div>
          <div>
            <div style="font-weight:750; color:var(--text-primary); font-size:14px;">Cash on Hand &middot; Opening Balance</div>
            <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">
              Set or update your starting physical cash before recorded invoices and expenses. This is fully editable at any time.
            </div>
          </div>
        </div>
      </div>

      <div class="form-grid">
        <div class="field full">
          <label>Cash Opening Balance (INR)</label>
          <input name="cashOpeningBalance" type="number" min="0" step="0.01" value="${current || ""}" placeholder="0.00" required autofocus />
        </div>
        <div class="field">
          <label>As-of Date</label>
          <input name="cashOpeningDate" type="date" value="${currentDate}" required />
        </div>
        <div class="field">
          <label>Account Mode</label>
          <input value="Cash (Physical Cash in Hand)" readonly style="background:var(--bg-canvas); cursor:not-allowed;" />
        </div>
        <div class="field full">
          <label>Notes / Memo <span class="help">optional</span></label>
          <input name="cashOpeningNotes" value="${escape(currentNotes)}" placeholder="E.g., Starting cash in drawer, register, or safe" />
        </div>
      </div>

      <div class="form-actions">
        ${isSet ? `<button type="button" class="pill-btn pill-btn-danger" data-action="reset-cash-opening">Reset to ₹0</button>` : `<span></span>`}
        <div class="form-actions-right">
          <button type="button" class="pill-btn pill-btn-ghost" data-action="close-modal">Cancel</button>
          <button class="pill-btn pill-btn-neon">${isSet ? "Update Opening Balance" : "Save Opening Balance"}</button>
        </div>
      </div>
    </form>
  `);
}

function expenseForm() {
  showModal("Add Expense", `
    <form class="form" id="expense-form">
      <div class="form-grid">
        <div class="field">
          <label>Amount (INR)</label>
          <input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" required />
        </div>
        <div class="field">
          <label>Date</label>
          <input name="date" type="date" value="${today()}" required />
        </div>
        <div class="field">
          <label>Category</label>
          <select name="category">
            <option>Software & subscriptions</option>
            <option>Travel & commute</option>
            <option>Internet & phone</option>
            <option>Equipment</option>
            <option>Office supplies</option>
            <option>Professional services</option>
            <option>Marketing</option>
            <option>Other</option>
          </select>
        </div>
        <div class="field">
          <label>Payment Mode</label>
          <select name="mode">
            <option>UPI</option>
            <option>Bank transfer</option>
            <option>Card</option>
            <option>Cash</option>
            <option>Other</option>
          </select>
        </div>
        <div class="field full">
          <label>Description</label>
          <input name="description" placeholder="E.g., Cloud Hosting or Office Supplies" required />
        </div>
      </div>
      <div class="form-actions">
        <span></span>
        <div class="form-actions-right">
          <button type="button" class="pill-btn pill-btn-ghost" data-action="close-modal">Cancel</button>
          <button class="pill-btn pill-btn-neon">Save Expense</button>
        </div>
      </div>
    </form>
  `);
}

function clientFields(c = {}) {
  return `
    <div class="form-grid">
      <div class="field full">
        <label>Client Name / Entity</label>
        <input name="name" value="${escape(c.name)}" placeholder="Company or Client Name" required />
      </div>
      <div class="field">
        <label>Email Address</label>
        <input name="email" type="email" value="${escape(c.email)}" placeholder="finance@company.com" />
      </div>
      <div class="field">
        <label>Phone Number</label>
        <input name="phone" value="${escape(c.phone)}" placeholder="+91 98200 00000" />
      </div>
      <div class="field">
        <label>GSTIN</label>
        <input name="gstin" value="${escape(c.gstin)}" placeholder="27AAAAA0000A1Z5" />
      </div>
      <div class="field">
        <label>Contact Person</label>
        <input name="contact" value="${escape(c.contact)}" placeholder="Accounts Manager" />
      </div>
      <div class="field">
        <label>Opening Balance (INR) <span class="help">optional</span></label>
        <input name="openingBalance" type="number" step="0.01" value="${c.openingBalance !== undefined ? c.openingBalance : ""}" placeholder="0.00" />
      </div>
      <div class="field">
        <label>Opening Balance Mode <span class="help">optional</span></label>
        <select name="openingBalanceMode">
          <option value="Cash" ${(!c.openingBalanceMode || c.openingBalanceMode === "Cash") ? "selected" : ""}>Cash</option>
          <option value="Bank transfer" ${c.openingBalanceMode === "Bank transfer" ? "selected" : ""}>Bank transfer</option>
          <option value="UPI" ${c.openingBalanceMode === "UPI" ? "selected" : ""}>UPI</option>
          <option value="Other" ${c.openingBalanceMode === "Other" ? "selected" : ""}>Other</option>
        </select>
      </div>
      <div class="field full">
        <label>Billing Address</label>
        <textarea name="address" placeholder="Registered office address">${escape(c.address)}</textarea>
      </div>
    </div>
  `;
}

function clientForm(id = "") {
  const c = data.clients.find(x => x.id === id) || {};
  showModal(id ? "Edit Client" : "Add Client", `
    <form class="form" id="client-form" data-id="${id}">
      ${clientFields(c)}
      <div class="form-actions">
        ${id ? `<button type="button" class="pill-btn pill-btn-danger" data-action="delete-client" data-id="${id}">Delete</button>` : "<span></span>"}
        <div class="form-actions-right">
          <button type="button" class="pill-btn pill-btn-ghost" data-action="close-modal">Cancel</button>
          <button class="pill-btn pill-btn-neon">Save Client</button>
        </div>
      </div>
    </form>
  `);
}

function projectForm(id = "") {
  if (!data.clients.length) {
    notify("Add a client before adding a project.");
    return;
  }
  const p = data.projects.find(x => x.id === id) || {};
  showModal(id ? "Edit Project" : "Add Project", `
    <form class="form" id="project-form" data-id="${id}">
      <div class="form-grid">
        <div class="field full">
          <label>Project Title</label>
          <input name="name" value="${escape(p.name)}" placeholder="E.g. Web App Redesign" required />
        </div>
        <div class="field">
          <label>Client</label>
          <select name="clientId" required>${optionClients(p.clientId)}</select>
        </div>
        <div class="field">
          <label>Status</label>
          <select name="status">
            <option ${p.status==="Active"?"selected":""}>Active</option>
            <option ${p.status==="Completed"?"selected":""}>Completed</option>
            <option ${p.status==="On hold"?"selected":""}>On hold</option>
          </select>
        </div>
        <div class="field full">
          <label>Project Notes</label>
          <textarea name="notes" placeholder="Scope details, milestones, or deliverables">${escape(p.notes)}</textarea>
        </div>
      </div>
      <div class="form-actions">
        <span></span>
        <div class="form-actions-right">
          <button type="button" class="pill-btn pill-btn-ghost" data-action="close-modal">Cancel</button>
          <button class="pill-btn pill-btn-neon">Save Project</button>
        </div>
      </div>
    </form>
  `);
}

function invoiceDetail(id) {
  const i = data.invoices.find(x => x.id === id);
  if (!i) return;
  const payments = data.payments.filter(p => p.invoiceId === id).sort((a,b) => b.date.localeCompare(a.date));
  
  showModal(i.number, `
    <div class="form">
      <div class="invoice-summary">
        <div><span>Client</span><strong style="color:var(--text-primary);">${escape(clientName(i.clientId))}</strong></div>
        <div><span>Invoice Date</span><span>${dateText(i.issueDate)}</span></div>
        <div><span>Due Date</span><span>${dateText(i.dueDate)}</span></div>
        <div><span>Subtotal</span><span>${currency(i.amount)}</span></div>
        ${Number(i.gstRate) ? `<div><span>GST (${i.gstRate}%)</span><span>${currency(Number(i.amount) * Number(i.gstRate) / 100)}</span></div>` : ""}
        <div style="border-top:1px solid var(--border-card); margin-top:8px; padding-top:8px;">
          <strong style="color:var(--text-primary);">Total Invoiced</strong>
          <strong style="color:var(--accent-orange);">${currency(invoiceAmount(i))}</strong>
        </div>
        <div>
          <span>Balance Outstanding</span>
          <strong style="${balance(i) > 0 ? "color:var(--color-due);" : "color:var(--accent-orange);"}">${currency(balance(i))}</strong>
        </div>
      </div>
      
      ${i.notes ? `<p class="help" style="margin-top:14px;">${escape(i.notes)}</p>` : ""}

      <div class="panel-head" style="margin-top:22px;">
        <h2 style="font-size:15px;">Recorded Payments</h2>
        ${balance(i) > 0.005 && !i.draft ? `<button class="pill-btn pill-btn-neon pill-btn-sm" data-action="new-payment" data-id="${i.id}">+ Record Payment</button>` : ""}
      </div>

      <div class="list">
        ${payments.length ? payments.map(p => `
          <div class="list-row">
            <div>
              <div class="primary-text" style="color:var(--accent-orange);">${currency(p.amount)}</div>
              <div class="secondary-text">${dateText(p.date)} &middot; ${escape(p.mode)} ${p.reference ? `&middot; ${escape(p.reference)}` : ""}</div>
            </div>
            <button class="pill-btn pill-btn-ghost pill-btn-sm" data-action="delete-payment" data-id="${p.id}">Remove</button>
          </div>
        `).join("") : "<p class=\"help\">No payments recorded yet.</p>"}
      </div>

      <div class="form-actions">
        <button class="pill-btn pill-btn-danger" data-action="delete-invoice" data-id="${i.id}">Delete</button>
        <div class="form-actions-right">
          <button class="pill-btn pill-btn-ghost" data-action="edit-invoice" data-id="${i.id}">✏️ Edit</button>
          <button class="pill-btn pill-btn-ghost" data-action="print-invoice" data-id="${i.id}">🖨️ Print</button>
          <button class="pill-btn pill-btn-neon" data-action="close-modal">Done</button>
        </div>
      </div>
    </div>
  `);
}

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function download(filename, content, type = "application/json") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportBackup() {
  download(`total-berries-backup-${today()}.json`, JSON.stringify(data, null, 2));
  notify("Vault backup downloaded successfully.");
}

function exportExpenses() {
  const csv = [
    "Date,Category,Description,Payment mode,Amount INR",
    ...data.expenses.map(e => [e.date, e.category, e.description, e.mode, e.amount].map(v => `"${String(v||"").replaceAll('"','""')}"`).join(","))
  ].join("\n");
  download(`expenses-${today()}.csv`, csv, "text/csv");
}

function exportReport() {
  const lines = [
    "Total Berries Financial Summary",
    `Generated: ${today()}`,
    "",
    "Invoice Number,Client,Invoice Total INR,Paid INR,Balance INR,Status",
    ...data.invoices.map(i => [i.number, clientName(i.clientId), invoiceAmount(i), paidAmount(i.id), balance(i), invoiceStatus(i)].map(v => `"${String(v).replaceAll('"','""')}"`).join(","))
  ];
  download(`financial-summary-${today()}.csv`, lines.join("\n"), "text/csv");
}

/* ==========================================================================
   CLIENT LEDGER & ADVANCED PRINT ENGINE
   ========================================================================== */
function getLedgerData(clientId, startDate = "", endDate = "") {
  const client = data.clients.find(c => c.id === clientId) || data.clients[0];
  if (!client) return null;

  const invs = data.invoices.filter(i => i.clientId === client.id && !i.draft);
  const invIds = new Set(invs.map(i => i.id));
  const pmts = data.payments.filter(p => invIds.has(p.invoiceId));

  const allTx = [];

  if (Number(client.openingBalance) > 0) {
    allTx.push({
      id: "op-" + client.id,
      date: client.createdDate || "2000-01-01",
      type: "OPENING",
      number: "OP-BAL",
      particulars: `Opening Balance (${escape(client.openingBalanceMode || "Cash")})`,
      reference: "Initial Balance",
      debit: Number(client.openingBalance),
      credit: 0
    });
  }

  invs.forEach(i => {
    allTx.push({
      id: i.id,
      date: i.issueDate,
      type: "INVOICE",
      number: i.number,
      particulars: `Invoice ${i.number}${i.notes ? ` &middot; ${escape(i.notes)}` : ""}`,
      reference: i.reference || "—",
      debit: invoiceAmount(i),
      credit: 0
    });
  });

  pmts.forEach(p => {
    allTx.push({
      id: p.id,
      date: p.date,
      type: "PAYMENT",
      number: p.invoiceNumber || "",
      particulars: `Deposit / Payment for ${escape(p.invoiceNumber || "Invoice")} (${escape(p.mode)})`,
      reference: p.reference || escape(p.mode) || "—",
      debit: 0,
      credit: Number(p.amount)
    });
  });

  allTx.sort((a,b) => a.date.localeCompare(b.date) || (a.type === "INVOICE" ? -1 : 1));

  let openingBalance = 0;
  const periodTx = [];

  allTx.forEach(t => {
    if (startDate && t.date < startDate) {
      openingBalance += (t.debit - t.credit);
    } else if (!endDate || t.date <= endDate) {
      periodTx.push(t);
    }
  });

  let running = openingBalance;
  let totalPeriodBilled = 0;
  let totalPeriodPaid = 0;

  periodTx.forEach(t => {
    running += (t.debit - t.credit);
    t.runningBalance = running;
    totalPeriodBilled += t.debit;
    totalPeriodPaid += t.credit;
  });

  const closingBalance = running;
  const totalLifetimeOutstanding = Number(client.openingBalance || 0) + invs.reduce((s,i) => s + balance(i), 0);

  return {
    client,
    startDate,
    endDate,
    openingBalance,
    periodTx,
    totalPeriodBilled,
    totalPeriodPaid,
    closingBalance,
    totalLifetimeOutstanding
  };
}

function clientLedger(clientId = "", startDate = "", endDate = "", activePreset = "all") {
  if (!data.clients.length) {
    notify("Please add a client first.");
    return;
  }
  clientId = clientId || data.clients[0].id;

  const now = new Date();
  if (activePreset === "this-month") {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  } else if (activePreset === "last-month") {
    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
    endDate = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);
  } else if (activePreset === "this-quarter") {
    const qMonth = Math.floor(now.getMonth() / 3) * 3;
    startDate = new Date(now.getFullYear(), qMonth, 1).toISOString().slice(0, 10);
    endDate = new Date(now.getFullYear(), qMonth + 3, 0).toISOString().slice(0, 10);
  } else if (activePreset === "fy") {
    const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    startDate = `${fyYear}-04-01`;
    endDate = `${fyYear + 1}-03-31`;
  } else if (activePreset === "all") {
    startDate = "";
    endDate = "";
  }

  const ledger = getLedgerData(clientId, startDate, endDate);
  if (!ledger) return;

  const { client, openingBalance, periodTx, totalPeriodBilled, totalPeriodPaid, closingBalance } = ledger;

  showModal(`Client Ledger · ${escape(client.name)}`, `
    <div class="form" style="padding-top:16px;">
      <!-- Filters and Controls -->
      <div style="display:flex; flex-wrap:wrap; gap:12px; justify-content:space-between; align-items:flex-end; margin-bottom:14px;">
        <div style="flex:1; min-width:200px;">
          <label style="font-size:11.5px; font-weight:700; color:var(--text-secondary); text-transform:uppercase; display:block; margin-bottom:4px;">Client Account</label>
          <select id="ledger-client-select" data-action="change-ledger-client" style="width:100%; height:40px;">
            ${data.clients.map(c => `<option value="${c.id}" ${c.id === clientId ? "selected" : ""}>${escape(c.name)}</option>`).join("")}
          </select>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
          <button type="button" class="date-preset-pill ${activePreset === 'all' ? 'active' : ''}" data-action="ledger-preset" data-preset="all" data-id="${clientId}">All Time</button>
          <button type="button" class="date-preset-pill ${activePreset === 'this-month' ? 'active' : ''}" data-action="ledger-preset" data-preset="this-month" data-id="${clientId}">This Month</button>
          <button type="button" class="date-preset-pill ${activePreset === 'last-month' ? 'active' : ''}" data-action="ledger-preset" data-preset="last-month" data-id="${clientId}">Last Month</button>
          <button type="button" class="date-preset-pill ${activePreset === 'this-quarter' ? 'active' : ''}" data-action="ledger-preset" data-preset="this-quarter" data-id="${clientId}">This Quarter</button>
          <button type="button" class="date-preset-pill ${activePreset === 'fy' ? 'active' : ''}" data-action="ledger-preset" data-preset="fy" data-id="${clientId}">This FY</button>
        </div>
      </div>

      <!-- Custom Date Duration Selection -->
      <div style="background:var(--bg-canvas); border:1px solid var(--border-card); border-radius:var(--radius-md); padding:10px 14px; margin-bottom:14px; display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
        <span style="font-size:12px; font-weight:700; color:var(--text-secondary);">Duration:</span>
        <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:240px;">
          <input type="date" id="ledger-start" value="${startDate || ""}" style="flex:1; height:36px; padding:4px 8px; font-size:12.5px;" />
          <span style="color:var(--text-muted); font-size:12px;">to</span>
          <input type="date" id="ledger-end" value="${endDate || ""}" style="flex:1; height:36px; padding:4px 8px; font-size:12.5px;" />
        </div>
        <button type="button" class="pill-btn pill-btn-ghost pill-btn-sm" data-action="apply-ledger-dates" data-id="${clientId}" style="height:36px;">Filter Range</button>
      </div>

      <!-- Financial KPI Summary Bar -->
      <div class="ledger-kpi-grid">
        <div class="ledger-kpi-card">
          <div class="ledger-kpi-label">Opening Balance</div>
          <div class="ledger-kpi-val">${currency(openingBalance)}</div>
        </div>
        <div class="ledger-kpi-card">
          <div class="ledger-kpi-label">Billed in Period</div>
          <div class="ledger-kpi-val" style="color:var(--text-primary);">${currency(totalPeriodBilled)}</div>
        </div>
        <div class="ledger-kpi-card">
          <div class="ledger-kpi-label">Received in Period</div>
          <div class="ledger-kpi-val" style="color:var(--color-positive);">${currency(totalPeriodPaid)}</div>
        </div>
        <div class="ledger-kpi-card" style="border-color:rgba(0,102,255,0.3); background:var(--accent-orange-dim);">
          <div class="ledger-kpi-label" style="color:var(--accent-orange);">Net Due / Balance</div>
          <div class="ledger-kpi-val" style="color:var(--accent-orange);">${currency(closingBalance)}</div>
        </div>
      </div>

      <!-- Transactions Preview Table -->
      <div class="table-wrap" style="max-height:300px; overflow-y:auto; border:1px solid var(--border-card); border-radius:var(--radius-md); margin-bottom:18px;">
        <table style="font-size:12.5px; width:100%; border-collapse:collapse;">
          <thead>
            <tr>
              <th style="padding:8px 10px;">Date</th>
              <th style="padding:8px 10px;">Particulars</th>
              <th style="padding:8px 10px;">Ref #</th>
              <th class="money" style="padding:8px 10px;">Billed (Dr)</th>
              <th class="money" style="padding:8px 10px;">Received (Cr)</th>
              <th class="money" style="padding:8px 10px;">Balance</th>
            </tr>
          </thead>
          <tbody>
            ${startDate ? `
              <tr style="background:var(--bg-canvas); font-style:italic;">
                <td style="padding:7px 10px; color:var(--text-muted);">${dateText(startDate)}</td>
                <td style="padding:7px 10px;" colspan="2"><em>Opening Balance</em></td>
                <td class="money" style="padding:7px 10px;">—</td>
                <td class="money" style="padding:7px 10px;">—</td>
                <td class="money" style="padding:7px 10px; font-weight:700;">${currency(openingBalance)}</td>
              </tr>
            ` : ""}
            ${periodTx.length ? periodTx.map(t => `
              <tr>
                <td style="padding:7px 10px; white-space:nowrap;">${dateText(t.date)}</td>
                <td style="padding:7px 10px;">
                  <div style="font-weight:600; color:var(--text-primary);">${t.particulars}</div>
                </td>
                <td style="padding:7px 10px; color:var(--text-secondary);">${escape(t.reference)}</td>
                <td class="money" style="padding:7px 10px; color:${t.debit > 0 ? "var(--text-primary)" : "var(--text-muted)"};">${t.debit > 0 ? currency(t.debit) : "—"}</td>
                <td class="money" style="padding:7px 10px; color:${t.credit > 0 ? "var(--color-positive)" : "var(--text-muted)"};">${t.credit > 0 ? currency(t.credit) : "—"}</td>
                <td class="money" style="padding:7px 10px; font-weight:700; color:${t.runningBalance > 0 ? "var(--color-due)" : "var(--text-primary)"};">${currency(t.runningBalance)}</td>
              </tr>
            `).join("") : `
              <tr>
                <td colspan="6" style="padding:24px 10px; text-align:center; color:var(--text-muted);">
                  No transactions recorded for this client in the selected duration.
                </td>
              </tr>
            `}
          </tbody>
          <tfoot>
            <tr style="font-weight:800; background:var(--bg-canvas); border-top:2px solid var(--border-card);">
              <td colspan="3" style="padding:10px;">Closing Balance</td>
              <td class="money" style="padding:10px;">${currency(totalPeriodBilled)}</td>
              <td class="money" style="padding:10px; color:var(--color-positive);">${currency(totalPeriodPaid)}</td>
              <td class="money" style="padding:10px; color:var(--accent-orange); font-size:14px;">${currency(closingBalance)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- Action Footer -->
      <div class="form-actions">
        <button type="button" class="pill-btn pill-btn-ghost" data-action="close-modal">Close</button>
        <div class="form-actions-right">
          <button type="button" class="pill-btn pill-btn-neon" data-action="print-client-ledger" data-id="${clientId}" data-start="${startDate || ""}" data-end="${endDate || ""}">
            <span class="btn-icon">🖨️</span>
            <span>Print Ledger</span>
          </button>
        </div>
      </div>
    </div>
  `, true);
}

function printClientLedger(clientId, startDate, endDate) {
  const ledger = getLedgerData(clientId, startDate, endDate);
  if (!ledger) return;

  const { client, openingBalance, periodTx, totalPeriodBilled, totalPeriodPaid, closingBalance } = ledger;

  const printArea = document.getElementById("print-area");
  if (!printArea) return;

  const durationText = (startDate || endDate) 
    ? `${startDate ? dateText(startDate) : "Inception"} to ${endDate ? dateText(endDate) : dateText(today())}`
    : "All Recorded Transactions";

  printArea.innerHTML = `
    <div class="print-statement">
      <div class="statement-header">
        <div class="statement-brand">
          <h1>${escape(data.settings.businessName || "Total Berries")}</h1>
          <p style="margin:2px 0; color:#475569; font-weight:600;">Freelance Ledger &middot; Client Statement of Account</p>
          ${data.settings.gstin ? `<p style="margin:2px 0; color:#64748b; font-size:11px;">GSTIN: ${escape(data.settings.gstin)}</p>` : ""}
        </div>
        <div class="statement-meta">
          <h2>STATEMENT OF ACCOUNT</h2>
          <p style="margin:2px 0;"><strong>Date:</strong> ${dateText(today())}</p>
          <p style="margin:2px 0;"><strong>Duration:</strong> ${durationText}</p>
        </div>
      </div>

      <div class="statement-parties">
        <div class="party-box">
          <div class="party-title">CLIENT ACCOUNT DETAILS</div>
          <div class="party-name">${escape(client.name)}</div>
          ${client.contact ? `<div style="font-size:12px; margin-top:2px;"><strong>Attn:</strong> ${escape(client.contact)}</div>` : ""}
          ${client.email ? `<div style="font-size:12px; color:#475569;">${escape(client.email)}</div>` : ""}
          ${client.phone ? `<div style="font-size:12px; color:#475569;">${escape(client.phone)}</div>` : ""}
          ${client.address ? `<div style="font-size:11px; margin-top:4px; color:#64748b;">${escape(client.address)}</div>` : ""}
          ${client.gstin ? `<div style="font-size:11px; margin-top:4px; font-weight:600;">GSTIN: ${escape(client.gstin)}</div>` : ""}
        </div>
        <div class="statement-summary-box">
          <div class="summary-line"><span>Opening Balance:</span> <strong>${currency(openingBalance)}</strong></div>
          <div class="summary-line"><span>Total Billed:</span> <strong>${currency(totalPeriodBilled)}</strong></div>
          <div class="summary-line"><span>Total Received:</span> <strong>${currency(totalPeriodPaid)}</strong></div>
          <div class="summary-line highlight"><span>Net Outstanding Due:</span> <strong>${currency(closingBalance)}</strong></div>
        </div>
      </div>

      <table class="statement-table">
        <thead>
          <tr>
            <th style="width:14%;">Date</th>
            <th style="width:40%;">Particulars / Description</th>
            <th style="width:14%;">Reference</th>
            <th class="money" style="width:11%;">Billed (Dr)</th>
            <th class="money" style="width:11%;">Paid (Cr)</th>
            <th class="money" style="width:10%;">Balance</th>
          </tr>
        </thead>
        <tbody>
          ${startDate ? `
            <tr style="background:#f8fafc; font-style:italic;">
              <td>${dateText(startDate)}</td>
              <td colspan="2">Opening Balance as of ${dateText(startDate)}</td>
              <td class="money">—</td>
              <td class="money">—</td>
              <td class="money" style="font-weight:700;">${currency(openingBalance)}</td>
            </tr>
          ` : ""}
          ${periodTx.length ? periodTx.map(t => `
            <tr>
              <td>${dateText(t.date)}</td>
              <td><strong>${t.particulars}</strong></td>
              <td>${escape(t.reference)}</td>
              <td class="money">${t.debit > 0 ? currency(t.debit) : "—"}</td>
              <td class="money">${t.credit > 0 ? currency(t.credit) : "—"}</td>
              <td class="money" style="font-weight:700;">${currency(t.runningBalance)}</td>
            </tr>
          `).join("") : `
            <tr>
              <td colspan="6" style="text-align:center; padding:30px; color:#64748b;">
                No financial transactions recorded for this client in the selected duration.
              </td>
            </tr>
          `}
        </tbody>
        <tfoot>
          <tr class="statement-total-row">
            <td colspan="3"><strong>Total Statement Activity</strong></td>
            <td class="money"><strong>${currency(totalPeriodBilled)}</strong></td>
            <td class="money"><strong>${currency(totalPeriodPaid)}</strong></td>
            <td class="money highlight-balance"><strong>${currency(closingBalance)}</strong></td>
          </tr>
        </tfoot>
      </table>

      <div class="statement-footer">
        <p>This statement of accounts reflects all transactions recorded up to ${dateText(today())}.</p>
        <p>Thank you for partnering with <strong>${escape(data.settings.businessName || "Total Berries")}</strong>.</p>
      </div>
    </div>
  `;

  window.print();
}

function printInvoice(invoiceId) {
  const i = data.invoices.find(x => x.id === invoiceId);
  if (!i) return;

  const client = data.clients.find(c => c.id === i.clientId) || {};
  const project = data.projects.find(p => p.id === i.projectId) || {};
  const payments = data.payments.filter(p => p.invoiceId === i.id);
  const gstAmount = Number(i.gstRate) ? (Number(i.amount) * Number(i.gstRate) / 100) : 0;
  const total = invoiceAmount(i);
  const due = balance(i);

  const printArea = document.getElementById("print-area");
  if (!printArea) return;

  printArea.innerHTML = `
    <div class="print-invoice">
      <div class="invoice-print-header">
        <div>
          <h1>${escape(data.settings.businessName || "Total Berries")}</h1>
          <p style="margin:2px 0; color:#475569; font-weight:600;">Tax Invoice</p>
          ${data.settings.gstin ? `<p style="margin:2px 0; color:#64748b; font-size:11px;">GSTIN: ${escape(data.settings.gstin)}</p>` : ""}
        </div>
        <div class="invoice-print-meta">
          <h2>INVOICE</h2>
          <p style="margin:2px 0;"><strong>Invoice #:</strong> ${escape(i.number)}</p>
          <p style="margin:2px 0;"><strong>Invoice Date:</strong> ${dateText(i.issueDate)}</p>
          <p style="margin:2px 0;"><strong>Due Date:</strong> ${dateText(i.dueDate)}</p>
          <p style="margin:2px 0;"><strong>Status:</strong> ${invoiceStatus(i).toUpperCase()}</p>
        </div>
      </div>

      <div class="statement-parties">
        <div class="party-box">
          <div class="party-title">BILLED TO</div>
          <div class="party-name">${escape(client.name || "Client")}</div>
          ${client.contact ? `<div style="font-size:12px;">Attn: ${escape(client.contact)}</div>` : ""}
          ${client.email ? `<div style="font-size:12px; color:#475569;">${escape(client.email)}</div>` : ""}
          ${client.phone ? `<div style="font-size:12px; color:#475569;">${escape(client.phone)}</div>` : ""}
          ${client.address ? `<div style="font-size:11px; margin-top:4px; color:#64748b;">${escape(client.address)}</div>` : ""}
          ${client.gstin ? `<div style="font-size:11px; margin-top:4px; font-weight:600;">GSTIN: ${escape(client.gstin)}</div>` : ""}
        </div>
        ${project.name || i.reference ? `
          <div class="party-box" style="max-width:280px;">
            <div class="party-title">PROJECT &amp; REFERENCE</div>
            ${project.name ? `<div><strong>Project:</strong> ${escape(project.name)}</div>` : ""}
            ${i.reference ? `<div><strong>PO / Ref:</strong> ${escape(i.reference)}</div>` : ""}
          </div>
        ` : ""}
      </div>

      <table class="invoice-print-table">
        <thead>
          <tr>
            <th style="width:50%;">Description / Scope of Work</th>
            <th class="money" style="width:20%;">Amount (INR)</th>
            <th class="money" style="width:15%;">GST Rate</th>
            <th class="money" style="width:15%;">Total (INR)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>${escape(project.name || `Services for ${client.name}`)}</strong>
              ${i.notes ? `<div style="font-size:11px; color:#475569; margin-top:4px;">${escape(i.notes)}</div>` : ""}
            </td>
            <td class="money">${currency(i.amount)}</td>
            <td class="money">${Number(i.gstRate) ? `${i.gstRate}%` : "0%"}</td>
            <td class="money">${currency(i.amount)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3" class="money" style="border-top:2px solid #cbd5e1;">Subtotal:</td>
            <td class="money" style="border-top:2px solid #cbd5e1;"><strong>${currency(i.amount)}</strong></td>
          </tr>
          ${Number(i.gstRate) ? `
            <tr>
              <td colspan="3" class="money">GST (${i.gstRate}%):</td>
              <td class="money"><strong>${currency(gstAmount)}</strong></td>
            </tr>
          ` : ""}
          <tr style="font-size:14px; background:#f8fafc;">
            <td colspan="3" class="money" style="border-top:2px solid #0f172a;"><strong>Invoice Total:</strong></td>
            <td class="money" style="border-top:2px solid #0f172a; color:#0066ff;"><strong>${currency(total)}</strong></td>
          </tr>
          ${payments.length ? `
            <tr>
              <td colspan="3" class="money">Total Paid:</td>
              <td class="money" style="color:#10b981;"><strong>${currency(paidAmount(i.id))}</strong></td>
            </tr>
            <tr style="font-size:14px; background:#eff6ff;">
              <td colspan="3" class="money" style="border-top:1.5px solid #bfdbfe;"><strong>Balance Due:</strong></td>
              <td class="money" style="border-top:1.5px solid #bfdbfe; color:#0066ff;"><strong>${currency(due)}</strong></td>
            </tr>
          ` : ""}
        </tfoot>
      </table>

      ${payments.length ? `
        <div style="margin-top:20px;">
          <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:#64748b; margin-bottom:6px;">Payment History</div>
          <table class="statement-table" style="font-size:11px;">
            <thead>
              <tr><th>Date</th><th>Mode</th><th>Reference</th><th class="money">Amount Paid</th></tr>
            </thead>
            <tbody>
              ${payments.map(p => `
                <tr>
                  <td>${dateText(p.date)}</td>
                  <td>${escape(p.mode)}</td>
                  <td>${escape(p.reference || "—")}</td>
                  <td class="money" style="font-weight:700;">${currency(p.amount)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : ""}

      <div class="invoice-print-footer">
        <p>Thank you for your business!</p>
        <p style="font-size:10px; color:#94a3b8;">Generated by Total Berries Freelance Ledger &middot; ${dateText(today())}</p>
      </div>
    </div>
  `;

  window.print();
}

/* ==========================================================================
   EVENT LISTENERS & DISPATCHERS
   ========================================================================== */
document.addEventListener("click", event => {
  // Timeframe selector buttons
  const tfBtn = event.target.closest("[data-timeframe]");
  if (tfBtn) {
    selectedTimeframe = tfBtn.dataset.timeframe;
    render();
    return;
  }

  const target = event.target.closest("[data-action]");
  if (!target) return;
  const { action, id } = target.dataset;

  if (action === "new-invoice") invoiceForm();
  else if (action === "edit-invoice") invoiceForm(id);
  else if (action === "print-invoice") printInvoice(id);
  else if (action === "client-ledger") clientLedger(id);
  else if (action === "ledger-preset") clientLedger(id, "", "", target.dataset.preset);
  else if (action === "apply-ledger-dates") {
    const s = document.getElementById("ledger-start")?.value;
    const e = document.getElementById("ledger-end")?.value;
    clientLedger(id, s, e, "custom");
  }
  else if (action === "print-client-ledger") {
    printClientLedger(target.dataset.id, target.dataset.start, target.dataset.end);
  }
  else if (action === "edit-cash-opening") cashOpeningBalanceModal();
  else if (action === "reset-cash-opening") {
    if (confirm("Reset cash opening balance to ₹0?")) {
      data.settings.cashOpeningBalance = 0;
      data.settings.cashOpeningNotes = "";
      save();
      closeModal();
      render();
      notify("Cash opening balance reset to ₹0.");
    }
  }
  else if (action === "new-payment") paymentForm(id);
  else if (action === "edit-payment") paymentForm("", id);
  else if (action === "new-expense") expenseForm();
  else if (action === "new-client") clientForm();
  else if (action === "edit-client") clientForm(id);
  else if (action === "new-project") projectForm();
  else if (action === "edit-project") projectForm(id);
  else if (action === "invoice-detail") invoiceDetail(id);
  else if (action === "close-modal") closeModal();
  else if (action === "open-auth") authModal();
  else if (action === "auth-tab") authModal(id);
  else if (action === "sync-now") syncNow();
  else if (action === "sign-out") signOut();
  else if (action === "magic-link") sendMagicLink();
  else if (action === "export-backup") exportBackup();
  else if (action === "import-backup") document.getElementById("import-file").click();
  else if (action === "export-expenses") exportExpenses();
  else if (action === "export-report") exportReport();
  else if (action === "toggle-theme") toggleTheme();
  else if (action === "print") window.print();
  else if (action === "clear-data") {
    if (confirm("Clear every record from this device? This cannot be undone.")) {
      data = emptyData();
      save();
      closeModal();
      render();
      notify("All local records cleared.");
    }
  }
  else if (action === "delete-client") {
    if (data.invoices.some(i => i.clientId === id) || data.projects.some(p => p.clientId === id)) {
      return notify("Keep this client because records are linked to it.");
    }
    if (confirm("Delete this client?")) {
      data.clients = data.clients.filter(c => c.id !== id);
      save();
      closeModal();
      render();
      notify("Client removed.");
    }
  }
  else if (action === "delete-invoice") {
    if (confirm("Delete this invoice and its payment records?")) {
      data.invoices = data.invoices.filter(i => i.id !== id);
      data.payments = data.payments.filter(p => p.invoiceId !== id);
      save();
      closeModal();
      render();
      notify("Invoice deleted.");
    }
  }
  else if (action === "delete-payment") {
    const payment = data.payments.find(p => p.id === id);
    if (confirm("Remove this payment entry?") && payment) {
      const invoiceId = payment.invoiceId;
      data.payments = data.payments.filter(p => p.id !== id);
      save();
      render();
      invoiceDetail(invoiceId);
      notify("Payment removed.");
    }
  }
});

document.addEventListener("submit", event => {
  const form = event.target;
  event.preventDefault();
  const formId = form.getAttribute("id");

  if (formId === "auth-form") {
    handleAuthSubmit(form);
    return;
  }

  const values = formObject(form);

  if (formId === "invoice-form") {
    const id = form.dataset.id || values.invoiceId || values.id;
    const isDraft = new FormData(form).get("draft") === "1";

    if (id) {
      const existing = data.invoices.find(x => x.id === id);
      if (existing) {
        const prevNumber = existing.number;
        Object.assign(existing, {
          ...values,
          amount: Number(values.amount),
          gstRate: Number(values.gstRate),
          draft: isDraft
        });
        delete existing.invoiceId;
        if (prevNumber !== values.number) {
          data.payments.forEach(p => {
            if (p.invoiceId === id) p.invoiceNumber = values.number;
          });
        }
        save();
        closeModal();
        render();
        notify(`Invoice ${values.number} updated.`);
        return;
      }
    }

    data.invoices.push({
      id: uid(),
      ...values,
      amount: Number(values.amount),
      gstRate: Number(values.gstRate),
      draft: isDraft
    });
    data.settings.nextInvoice = Number(data.settings.nextInvoice || 1) + 1;
    save();
    closeModal();
    render();
    notify(isDraft ? "Draft invoice saved." : "Invoice issued successfully.");
  }

  if (formId === "cash-opening-form") {
    data.settings.cashOpeningBalance = parseFloat(values.cashOpeningBalance) || 0;
    data.settings.cashOpeningDate = values.cashOpeningDate || today();
    data.settings.cashOpeningNotes = values.cashOpeningNotes || "";
    save();
    closeModal();
    render();
    notify("Opening balance in cash updated! 💵");
    return;
  }

  if (formId === "payment-form") {
    const paymentId = form.dataset.paymentId || values.paymentId;
    const invoice = data.invoices.find(i => i.id === values.invoiceId);
    
    if (paymentId) {
      const existing = data.payments.find(p => p.id === paymentId);
      if (existing) {
        Object.assign(existing, {
          ...values,
          amount: Number(values.amount),
          invoiceNumber: invoice ? invoice.number : existing.invoiceNumber
        });
        delete existing.paymentId;
        save();
        closeModal();
        render();
        notify("Deposit updated successfully.");
        return;
      }
    }

    if (!invoice || Number(values.amount) > balance(invoice) + 0.01) {
      return notify("Deposit cannot exceed the outstanding balance.");
    }
    data.payments.push({
      id: uid(),
      ...values,
      amount: Number(values.amount),
      invoiceNumber: invoice.number
    });
    save();
    closeModal();
    render();
    notify("Deposit recorded successfully.");
  }

  if (formId === "expense-form") {
    data.expenses.push({
      id: uid(),
      ...values,
      amount: Number(values.amount)
    });
    save();
    closeModal();
    render();
    notify("Expense recorded.");
  }

  if (formId === "client-form") {
    const id = form.dataset.id;
    const clientPayload = {
      ...values,
      openingBalance: parseFloat(values.openingBalance) || 0,
      openingBalanceMode: values.openingBalanceMode || "Cash"
    };
    if (id) {
      Object.assign(data.clients.find(c => c.id === id), clientPayload);
    } else {
      data.clients.push({ id: uid(), createdDate: today(), ...clientPayload });
    }
    save();
    closeModal();
    render();
    notify("Client profile saved.");
  }

  if (formId === "project-form") {
    const id = form.dataset.id;
    if (id) {
      Object.assign(data.projects.find(p => p.id === id), values);
    } else {
      data.projects.push({ id: uid(), ...values });
    }
    save();
    closeModal();
    render();
    notify("Project updated.");
  }

  if (formId === "settings-form" || form.getAttribute("id") === "settings-form") {
    data.settings = {
      ...data.settings,
      ...values,
      nextInvoice: Number(values.nextInvoice),
      defaultDueDays: Number(values.defaultDueDays),
      cashOpeningBalance: parseFloat(values.cashOpeningBalance) || 0,
      cashOpeningDate: values.cashOpeningDate || "",
      cashOpeningNotes: values.cashOpeningNotes || ""
    };
    save();
    render();
    notify("Business profile and cash settings updated.");
  }
});

document.addEventListener("input", event => {
  if (event.target.matches("[data-search]")) {
    searchText = event.target.value;
    render();
    const input = document.querySelector("[data-search]");
    input?.focus();
    input?.setSelectionRange(searchText.length, searchText.length);
  }
});

document.getElementById("modal-backdrop").addEventListener("click", e => {
  if (e.target.id === "modal-backdrop") closeModal();
});

document.addEventListener("change", event => {
  if (event.target.id === "ledger-client-select") {
    const s = document.getElementById("ledger-start")?.value;
    const e = document.getElementById("ledger-end")?.value;
    clientLedger(event.target.value, s, e, "custom");
  } else if (event.target.id === "ledger-start" || event.target.id === "ledger-end") {
    const cId = document.getElementById("ledger-client-select")?.value;
    const s = document.getElementById("ledger-start")?.value;
    const e = document.getElementById("ledger-end")?.value;
    clientLedger(cId, s, e, "custom");
  }
});

document.getElementById("backup-button")?.addEventListener("click", exportBackup);

document.getElementById("import-file").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!imported || !Array.isArray(imported.invoices) || !Array.isArray(imported.clients)) {
      throw new Error();
    }
    if (!confirm("Replace current data on this device with this backup?")) return;
    data = {
      ...emptyData(),
      ...imported,
      settings: { ...emptyData().settings, ...imported.settings }
    };
    save();
    render();
    notify("Backup imported successfully.");
  } catch {
    notify("Invalid file format. Please upload a valid JSON backup.");
  } finally {
    event.target.value = "";
  }
});

window.addEventListener("hashchange", () => {
  currentView = location.hash.slice(1) || "dashboard";
  searchText = "";
  render();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

// Initial theme, render & Supabase Auth check
applyTheme(data.settings?.theme || localStorage.getItem("theme") || "light");
render();
initAuth();
