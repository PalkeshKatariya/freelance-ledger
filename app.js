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
    theme: "light"
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
    meta.setAttribute("content", t === "dark" ? "#0c1017" : "#ff5722");
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
  const strokeColor = isPositive ? "#ff5722" : "#8c9ba8";
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
  const totalBalance = Math.max(0, income - expenses);
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
            <span class="hero-balance-label">Cash on Hand &middot; Total Balance</span>
            <div class="hero-balance-amount">${currency(totalBalance)}</div>
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
          <span class="hero-pill-badge" style="background:var(--accent-orange-dim); color:var(--accent-orange); border-color:rgba(255,87,34,0.2);">Live</span>
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
                <div class="hero-badge-icon" style="width:36px; height:36px; font-size:16px; background:#fff1eb; color:#ff5722; border:1px solid #ffd8c4;">📄</div>
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
              <span class="imc-issued">Issued ${dateText(i.issueDate)}</span>
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

  return `
    ${heading("Payments Received", "Track incoming payments, UPI transfers, and bank deposits.", `
      <button class="pill-btn pill-btn-white" data-action="new-payment">
        <span class="btn-icon">↓</span>
        <span>Record Deposit</span>
      </button>
    `)}

    <div class="toolbar">
      <div class="help">Lifetime revenue received: <strong style="color:var(--accent-orange);">${currency(totalReceived)}</strong></div>
      <button class="pill-btn pill-btn-ghost pill-btn-sm" data-action="export-report">Export Log</button>
    </div>

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
                <span>${dateText(p.date)}</span>
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
      <button class="pill-btn pill-btn-neon" data-action="new-client">
        <span class="btn-icon">+</span>
        <span>Add Client</span>
      </button>
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
              const outstanding = data.invoices.filter(i => i.clientId === c.id && !i.draft).reduce((s,i) => s + balance(i), 0);
              return `
                <tr>
                  <td>
                    <div class="primary-text">${escape(c.name)}</div>
                    <div class="secondary-text">${escape(c.address || "")}</div>
                  </td>
                  <td>
                    <div class="primary-text">${escape(c.email || "—")}</div>
                    <div class="secondary-text">${escape(c.phone || "")} ${c.contact ? `&middot; ${escape(c.contact)}` : ""}</div>
                  </td>
                  <td>${escape(c.gstin || "—")}</td>
                  <td class="money">${currency(outstanding)}</td>
                  <td style="text-align:right;">
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
          const outstanding = data.invoices.filter(i => i.clientId === c.id && !i.draft).reduce((s,i) => s + balance(i), 0);
          return `
            <article class="client-mobile-card">
              <div class="imc-top">
                <div class="imc-left">
                  <div class="imc-number">${escape(c.name)}</div>
                  <div class="imc-client">${escape(c.email || c.phone || "No contact info")}</div>
                </div>
                <div class="imc-right">
                  <div class="imc-amount money">${currency(outstanding)}</div>
                  <div class="secondary-text" style="font-size:10.5px;">Due</div>
                </div>
              </div>
              <div class="imc-bottom">
                <span>GST: ${escape(c.gstin || "—")}</span>
                <button class="pill-btn pill-btn-ghost pill-btn-sm" data-action="edit-client" data-id="${c.id}">Edit</button>
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
  const netSurplus = received - spent;
  const unpaid = data.invoices.reduce((s,i) => s + balance(i), 0);

  const byClient = data.clients.map(c => ({
    name: c.name,
    paid: data.invoices.filter(i => i.clientId === c.id).reduce((sum,i) => sum + paidAmount(i.id), 0),
    due: data.invoices.filter(i => i.clientId === c.id).reduce((sum,i) => sum + balance(i), 0)
  })).filter(x => x.paid || x.due).sort((a,b) => b.paid - a.paid);

  return `
    ${heading("Financial Analytics", "Six-month cashflow velocity and client profitability.", `
      <button class="pill-btn pill-btn-ghost" data-action="export-report">
        <span>Export Summary</span>
      </button>
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
        <div class="metric-note">Net profits generated</div>
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
function showModal(title, content) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-content").innerHTML = content;
  document.getElementById("modal-backdrop").hidden = false;
  setTimeout(() => document.querySelector("#modal-content input, #modal-content select")?.focus(), 25);
}

function closeModal() {
  document.getElementById("modal-backdrop").hidden = true;
}

function optionClients(selected = "", blank = "Choose a client") {
  return `<option value="">${blank}</option>${data.clients.map(c => `<option value="${c.id}" ${c.id===selected?"selected":""}>${escape(c.name)}</option>`).join("")}`;
}

function optionProjects(selected = "") {
  return `<option value="">No project</option>${data.projects.map(p => `<option value="${p.id}" ${p.id===selected?"selected":""}>${escape(p.name)}</option>`).join("")}`;
}

function invoiceForm() {
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
  showModal("Create Invoice", `
    <form class="form" id="invoice-form">
      <div class="form-grid">
        <div class="field">
          <label>Invoice Number</label>
          <input name="number" value="${escape(invoiceNumber())}" required />
        </div>
        <div class="field">
          <label>Client</label>
          <select name="clientId" required>${optionClients()}</select>
        </div>
        <div class="field">
          <label>Project <span class="help">optional</span></label>
          <select name="projectId">${optionProjects()}</select>
        </div>
        <div class="field">
          <label>Amount before GST (INR)</label>
          <input name="amount" type="number" min="0" step="0.01" placeholder="0.00" required />
        </div>
        <div class="field">
          <label>Invoice Date</label>
          <input name="issueDate" type="date" value="${today()}" required />
        </div>
        <div class="field">
          <label>Due Date</label>
          <input name="dueDate" type="date" value="${plusDays(Number(data.settings.defaultDueDays)||15)}" required />
        </div>
        <div class="field">
          <label>GST Rate <span class="help">optional</span></label>
          <select name="gstRate">
            <option value="0">No GST (0%)</option>
            <option value="5">5%</option>
            <option value="12">12%</option>
            <option value="18" selected>18%</option>
            <option value="28">28%</option>
          </select>
        </div>
        <div class="field">
          <label>Reference / PO #</label>
          <input name="reference" placeholder="PO number or note" />
        </div>
        <div class="field full">
          <label>Project Scope & Notes</label>
          <textarea name="notes" placeholder="Deliverables, scope notes, or payment instructions"></textarea>
        </div>
      </div>
      <div class="form-actions">
        <span></span>
        <div class="form-actions-right">
          <button type="button" class="pill-btn pill-btn-ghost" data-action="close-modal">Cancel</button>
          <button class="pill-btn pill-btn-white" name="draft" value="1">Save Draft</button>
          <button class="pill-btn pill-btn-neon">Issue Invoice</button>
        </div>
      </div>
    </form>
  `);
}

function paymentForm(invoiceId = "") {
  const available = data.invoices.filter(i => !i.draft && balance(i) > 0.005);
  if (!available.length) {
    notify("Create an unpaid invoice before recording a payment.");
    return;
  }
  const selected = available.find(i => i.id === invoiceId) || available[0];
  showModal("Record Deposit", `
    <form class="form" id="payment-form">
      <div class="form-grid">
        <div class="field full">
          <label>Target Invoice</label>
          <select name="invoiceId" required>
            ${available.map(i => `
              <option value="${i.id}" ${i.id === selected.id ? "selected" : ""}>
                ${escape(i.number)} &middot; ${escape(clientName(i.clientId))} (${currency(balance(i))} due)
              </option>
            `).join("")}
          </select>
        </div>
        <div class="field">
          <label>Amount Received (INR)</label>
          <input name="amount" type="number" min="0.01" step="0.01" max="${balance(selected)}" value="${balance(selected).toFixed(2)}" required />
        </div>
        <div class="field">
          <label>Deposit Date</label>
          <input name="date" type="date" value="${today()}" required />
        </div>
        <div class="field">
          <label>Payment Method</label>
          <select name="mode">
            <option>UPI</option>
            <option>Bank transfer</option>
            <option>Cash</option>
            <option>Card</option>
            <option>Cheque</option>
            <option>Other</option>
          </select>
        </div>
        <div class="field">
          <label>Reference / UTR #</label>
          <input name="reference" placeholder="UTR or transaction ID" />
        </div>
        <div class="field full">
          <label>Deposit Notes</label>
          <input name="notes" placeholder="Any useful context or memo" />
        </div>
      </div>
      <div class="form-actions">
        <span></span>
        <div class="form-actions-right">
          <button type="button" class="pill-btn pill-btn-ghost" data-action="close-modal">Cancel</button>
          <button class="pill-btn pill-btn-neon">Save Deposit</button>
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
        <button class="pill-btn pill-btn-danger" data-action="delete-invoice" data-id="${i.id}">Delete Invoice</button>
        <div class="form-actions-right">
          <button class="pill-btn pill-btn-ghost" data-action="print">Print</button>
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
  else if (action === "new-payment") paymentForm(id);
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

  if (form.id === "auth-form") {
    handleAuthSubmit(form);
    return;
  }

  const values = formObject(form);

  if (form.id === "invoice-form") {
    const isDraft = new FormData(form).get("draft") === "1";
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

  if (form.id === "payment-form") {
    const invoice = data.invoices.find(i => i.id === values.invoiceId);
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

  if (form.id === "expense-form") {
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

  if (form.id === "client-form") {
    const id = form.dataset.id;
    if (id) {
      Object.assign(data.clients.find(c => c.id === id), values);
    } else {
      data.clients.push({ id: uid(), ...values });
    }
    save();
    closeModal();
    render();
    notify("Client profile saved.");
  }

  if (form.id === "project-form") {
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

  if (form.id === "settings-form") {
    data.settings = {
      ...data.settings,
      ...values,
      nextInvoice: Number(values.nextInvoice),
      defaultDueDays: Number(values.defaultDueDays)
    };
    save();
    render();
    notify("Business details updated.");
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
