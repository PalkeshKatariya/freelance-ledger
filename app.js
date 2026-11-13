/* Freelance Ledger: all records remain in this browser unless exported by the user. */
const KEY = "freelance-ledger-v1";
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = days => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
const emptyData = () => ({
  version: 1,
  settings: { businessName: "My Freelance Business", gstin: "", invoicePrefix: "INV", nextInvoice: 1, defaultDueDays: 15 },
  clients: [], projects: [], invoices: [], payments: [], expenses: []
});
let data = load();
let currentView = location.hash.slice(1) || "dashboard";
let searchText = "";
let toastTimer;

function load() { try { return { ...emptyData(), ...JSON.parse(localStorage.getItem(KEY) || "null") }; } catch { return emptyData(); } }
function save() { localStorage.setItem(KEY, JSON.stringify(data)); }
function currency(value) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value || 0)); }
function dateText(value) { return value ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`)) : "—"; }
function escape(text = "") { return String(text).replace(/[&<>'"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[c]); }
function invoiceAmount(invoice) { return Number(invoice.amount || 0) * (1 + Number(invoice.gstRate || 0) / 100); }
function paidAmount(invoiceId) { return data.payments.filter(p => p.invoiceId === invoiceId).reduce((sum, p) => sum + Number(p.amount || 0), 0); }
function balance(invoice) { return Math.max(0, invoiceAmount(invoice) - paidAmount(invoice.id)); }
function invoiceStatus(invoice) {
  if (invoice.draft) return "Draft";
  if (balance(invoice) < .01) return "Paid";
  return invoice.dueDate && invoice.dueDate < today() ? "Overdue" : "Due";
}
function clientName(id) { return data.clients.find(c => c.id === id)?.name || "Deleted client"; }
function projectName(id) { return data.projects.find(p => p.id === id)?.name || "—"; }
function invoiceNumber() { const n = String(data.settings.nextInvoice || 1).padStart(3, "0"); return `${data.settings.invoicePrefix || "INV"}-${n}`; }
function paymentsInRange(start, end) { return data.payments.filter(p => p.date >= start && p.date <= end).reduce((s, p) => s + Number(p.amount), 0); }
function expensesInRange(start, end) { return data.expenses.filter(e => e.date >= start && e.date <= end).reduce((s, e) => s + Number(e.amount), 0); }
function monthRange(offset = 0) { const d = new Date(); d.setMonth(d.getMonth() + offset, 1); const start = new Date(d.getFullYear(), d.getMonth(), 1); const end = new Date(d.getFullYear(), d.getMonth() + 1, 0); return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), label: start.toLocaleDateString("en-IN", { month: "short" }) }; }
function notify(message) { const el = document.getElementById("toast"); el.textContent = message; el.classList.add("visible"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("visible"), 2700); }

function render() {
  if (currentView === "more") currentView = "clients";
  const content = document.getElementById("content");
  const views = { dashboard, invoices, payments, expenses, clients, projects, reports, settings };
  content.innerHTML = (views[currentView] || dashboard)();
  document.querySelectorAll("[data-view]").forEach(a => a.classList.toggle("active", a.dataset.view === currentView || (a.dataset.view === "more" && ["clients", "projects", "reports", "settings"].includes(currentView))));
}
function heading(title, subtitle, action = "") { return `<div class="view-heading"><div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${action}</div>`; }
function noRows(message, actionText, action) { return `<div class="empty"><strong>${message}</strong>${actionText ? `<button class="button button-primary button-sm" data-action="${action}">${actionText}</button>` : ""}</div>`; }
function statusPill(status) { return `<span class="status status-${status.toLowerCase()}">${status}</span>`; }

function dashboard() {
  const month = monthRange(); const income = paymentsInRange(month.start, month.end); const expenses = expensesInRange(month.start, month.end);
  const outstanding = data.invoices.filter(i => !i.draft).reduce((sum, i) => sum + balance(i), 0);
  const overdue = data.invoices.filter(i => invoiceStatus(i) === "Overdue").reduce((sum, i) => sum + balance(i), 0);
  const due = [...data.invoices].filter(i => !i.draft && balance(i) > 0).sort((a,b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999")).slice(0, 5);
  const latest = [...data.payments].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 5);
  return `${heading("Good to see you", `A clear view of your freelance money for ${new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" })}.`, `<button class="button button-primary" data-action="new-invoice">+ New invoice</button>`)}
  <section class="metrics">
    <article class="card metric"><div class="metric-label">Income received</div><div class="metric-value">${currency(income)}</div><div class="metric-note">This month</div></article>
    <article class="card metric"><div class="metric-label">Expenses</div><div class="metric-value">${currency(expenses)}</div><div class="metric-note">This month</div></article>
    <article class="card metric"><div class="metric-label">Outstanding</div><div class="metric-value">${currency(outstanding)}</div><div class="metric-note">Across unpaid invoices</div></article>
    <article class="card metric"><div class="metric-label">Overdue</div><div class="metric-value">${currency(overdue)}</div><div class="metric-note">Needs a follow-up</div></article>
  </section>
  <section class="grid-2">
    <article class="card panel"><div class="panel-head"><h2>Invoices to follow up</h2><a href="#invoices">See all</a></div>
      <div class="list">${due.length ? due.map(i => `<div class="list-row"><div><div class="primary-text">${escape(i.number)}</div><div class="secondary-text">${escape(clientName(i.clientId))} · Due ${dateText(i.dueDate)}</div></div><div><div class="money">${currency(balance(i))}</div><div>${statusPill(invoiceStatus(i))}</div></div></div>`).join("") : noRows("Nothing awaiting payment", "Create an invoice", "new-invoice")}</div>
    </article>
    <article class="card panel"><div class="panel-head"><h2>Recent payments</h2><a href="#payments">See all</a></div>
      <div class="list">${latest.length ? latest.map(p => `<div class="list-row"><div><div class="primary-text">${escape(p.invoiceNumber || "Payment")}</div><div class="secondary-text">${dateText(p.date)} · ${escape(p.mode)}</div></div><div class="money positive">+${currency(p.amount)}</div></div>`).join("") : noRows("No payments recorded yet", "Record a payment", "new-payment")}</div>
    </article>
  </section>`;
}

function invoices() {
  const q = searchText.toLowerCase(); const rows = [...data.invoices].filter(i => `${i.number} ${clientName(i.clientId)}`.toLowerCase().includes(q)).sort((a,b) => b.issueDate.localeCompare(a.issueDate));
  return `${heading("Invoices", "Create invoices and keep track of what clients owe you.", `<button class="button button-primary" data-action="new-invoice">+ New invoice</button>`)}
  <div class="toolbar"><input class="search" data-search="invoices" value="${escape(searchText)}" placeholder="Search invoices or clients" /><div class="toolbar-group"><span class="help">${rows.length} invoice${rows.length === 1 ? "" : "s"}</span></div></div>
  <div class="table-wrap">${rows.length ? `<table><thead><tr><th>Invoice</th><th>Client</th><th>Issued</th><th>Due</th><th>Status</th><th class="money">Balance</th></tr></thead><tbody>${rows.map(i => `<tr class="clickable" data-action="invoice-detail" data-id="${i.id}"><td><div class="primary-text">${escape(i.number)}</div><div class="secondary-text">${escape(projectName(i.projectId))}</div></td><td>${escape(clientName(i.clientId))}</td><td>${dateText(i.issueDate)}</td><td>${dateText(i.dueDate)}</td><td>${statusPill(invoiceStatus(i))}</td><td class="money">${currency(balance(i))}</td></tr>`).join("")}</tbody></table>` : noRows("No invoices yet", "Create your first invoice", "new-invoice")}</div>`;
}

function payments() {
  const rows = [...data.payments].sort((a,b) => b.date.localeCompare(a.date));
  return `${heading("Payments", "Record money received, including partial payments.", `<button class="button button-primary" data-action="new-payment">+ Record payment</button>`)}
  <div class="table-wrap">${rows.length ? `<table><thead><tr><th>Date</th><th>Invoice</th><th>Client</th><th>Mode</th><th>Reference</th><th class="money">Amount</th></tr></thead><tbody>${rows.map(p => { const inv = data.invoices.find(i => i.id === p.invoiceId); return `<tr><td>${dateText(p.date)}</td><td class="primary-text">${escape(inv?.number || p.invoiceNumber || "—")}</td><td>${escape(inv ? clientName(inv.clientId) : "—")}</td><td>${escape(p.mode)}</td><td>${escape(p.reference || "—")}</td><td class="money positive">${currency(p.amount)}</td></tr>`; }).join("")}</tbody></table>` : noRows("No payments recorded yet", "Record a payment", "new-payment")}</div>`;
}

function expenses() {
  const rows = [...data.expenses].sort((a,b) => b.date.localeCompare(a.date)); const total = rows.reduce((s,e) => s + Number(e.amount), 0);
  return `${heading("Expenses", "Track business spending. Keep receipts separately for your records.", `<button class="button button-primary" data-action="new-expense">+ Add expense</button>`)}
  <div class="toolbar"><div class="help">Total recorded: <strong>${currency(total)}</strong></div><button class="button button-sm" data-action="export-expenses">Export CSV</button></div>
  <div class="table-wrap">${rows.length ? `<table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Mode</th><th class="money">Amount</th></tr></thead><tbody>${rows.map(e => `<tr><td>${dateText(e.date)}</td><td>${escape(e.category)}</td><td>${escape(e.description || "—")}</td><td>${escape(e.mode)}</td><td class="money negative">${currency(e.amount)}</td></tr>`).join("")}</tbody></table>` : noRows("No expenses recorded yet", "Add an expense", "new-expense")}</div>`;
}

function clients() {
  const rows = [...data.clients].sort((a,b) => a.name.localeCompare(b.name));
  return `${heading("Clients", "Keep your customer details in one place.", `<button class="button button-primary" data-action="new-client">+ Add client</button>`)}
  <div class="table-wrap">${rows.length ? `<table><thead><tr><th>Client</th><th>Contact</th><th>GSTIN</th><th>Outstanding</th><th></th></tr></thead><tbody>${rows.map(c => { const outstanding = data.invoices.filter(i => i.clientId === c.id && !i.draft).reduce((s,i) => s + balance(i), 0); return `<tr><td><div class="primary-text">${escape(c.name)}</div><div class="secondary-text">${escape(c.address || "")}</div></td><td>${escape(c.email || "—")}<div class="secondary-text">${escape(c.phone || "")}</div></td><td>${escape(c.gstin || "—")}</td><td class="money">${currency(outstanding)}</td><td><button class="button button-sm" data-action="edit-client" data-id="${c.id}">Edit</button></td></tr>`; }).join("")}</tbody></table>` : noRows("No clients yet", "Add your first client", "new-client")}</div>`;
}

function projects() {
  const rows = [...data.projects].sort((a,b) => a.name.localeCompare(b.name));
  return `${heading("Projects", "Optional: link work and invoices to a project.", `<button class="button button-primary" data-action="new-project">+ Add project</button>`)}
  <div class="table-wrap">${rows.length ? `<table><thead><tr><th>Project</th><th>Client</th><th>Status</th><th>Notes</th><th></th></tr></thead><tbody>${rows.map(p => `<tr><td class="primary-text">${escape(p.name)}</td><td>${escape(clientName(p.clientId))}</td><td>${escape(p.status || "Active")}</td><td>${escape(p.notes || "—")}</td><td><button class="button button-sm" data-action="edit-project" data-id="${p.id}">Edit</button></td></tr>`).join("")}</tbody></table>` : noRows("No projects yet", "Add a project", "new-project")}</div>`;
}

function reports() {
  const months = [-5,-4,-3,-2,-1,0].map(monthRange); const values = months.map(m => ({ ...m, income: paymentsInRange(m.start, m.end), expense: expensesInRange(m.start, m.end) })); const max = Math.max(1, ...values.flatMap(v => [v.income, v.expense]));
  const received = values.reduce((s,v) => s + v.income, 0), spent = values.reduce((s,v) => s + v.expense, 0);
  const byClient = data.clients.map(c => ({ name: c.name, paid: data.invoices.filter(i => i.clientId === c.id).reduce((sum,i) => sum + paidAmount(i.id), 0), due: data.invoices.filter(i => i.clientId === c.id).reduce((sum,i) => sum + balance(i), 0) })).filter(x => x.paid || x.due).sort((a,b) => b.paid - a.paid);
  return `${heading("Reports", "A simple six-month picture of your cash flow.", `<button class="button" data-action="export-report">Export summary</button>`)}
  <section class="metrics"><article class="card metric"><div class="metric-label">Received</div><div class="metric-value">${currency(received)}</div><div class="metric-note">Last six months</div></article><article class="card metric"><div class="metric-label">Expenses</div><div class="metric-value">${currency(spent)}</div><div class="metric-note">Last six months</div></article><article class="card metric"><div class="metric-label">Cash surplus</div><div class="metric-value">${currency(received-spent)}</div><div class="metric-note">Received minus expenses</div></article><article class="card metric"><div class="metric-label">Unpaid invoices</div><div class="metric-value">${currency(data.invoices.reduce((s,i)=>s+balance(i),0))}</div><div class="metric-note">Current outstanding</div></article></section>
  <section class="grid-2"><article class="card panel"><div class="panel-head"><h2>Income vs expenses</h2><span class="help">Monthly</span></div><div class="bar-chart">${values.map(v => `<div class="bar-group" title="${v.label}: received ${currency(v.income)}, expenses ${currency(v.expense)}"><div class="bar income" style="height:${Math.max(2, v.income / max * 100)}%"></div><div class="bar expense" style="height:${Math.max(2, v.expense / max * 100)}%"></div><span class="bar-label">${v.label}</span></div>`).join("")}</div><div class="legend"><span><i style="background:#0b6b5f"></i>Received</span><span><i style="background:#e7aa58"></i>Expenses</span></div></article>
  <article class="card panel"><div class="panel-head"><h2>Client balances</h2></div><div class="list">${byClient.length ? byClient.slice(0,5).map(c => `<div class="list-row"><div class="primary-text">${escape(c.name)}</div><div><div class="money">${currency(c.paid)}</div><div class="secondary-text">${currency(c.due)} due</div></div></div>`).join("") : noRows("No client data yet")}</div></article></section>`;
}

function settings() { const s = data.settings; return `${heading("Settings & backup", "Your records are private to this browser unless you export them.")}
  <div class="grid-2"><article class="card panel"><div class="panel-head"><h2>Business details</h2></div><form id="settings-form" class="form" style="padding:0"><div class="form-grid"><div class="field full"><label>Business / display name</label><input name="businessName" value="${escape(s.businessName)}" required /></div><div class="field"><label>GSTIN <span class="help">optional</span></label><input name="gstin" value="${escape(s.gstin)}" /></div><div class="field"><label>Invoice prefix</label><input name="invoicePrefix" value="${escape(s.invoicePrefix)}" placeholder="INV" /></div><div class="field"><label>Next invoice number</label><input name="nextInvoice" type="number" min="1" value="${Number(s.nextInvoice)||1}" /></div><div class="field"><label>Default payment terms</label><select name="defaultDueDays"><option value="7" ${s.defaultDueDays==7?"selected":""}>7 days</option><option value="15" ${s.defaultDueDays==15?"selected":""}>15 days</option><option value="30" ${s.defaultDueDays==30?"selected":""}>30 days</option><option value="45" ${s.defaultDueDays==45?"selected":""}>45 days</option></select></div></div><div class="form-actions"><span></span><button class="button button-primary">Save details</button></div></form></article>
  <article class="card panel"><div class="panel-head"><h2>Your data</h2></div><div class="settings-list"><div class="settings-row"><div><div class="primary-text">Export backup</div><p class="help">Download all clients, invoices, payments, and expenses as a private JSON file.</p></div><button class="button" data-action="export-backup">Export</button></div><div class="settings-row"><div><div class="primary-text">Import backup</div><p class="help">Replace this device’s data with a backup made by Freelance Ledger.</p></div><button class="button" data-action="import-backup">Import</button></div><div class="settings-row"><div><div class="primary-text">Clear all data</div><p class="help">Permanently removes records only from this browser. Export a backup first.</p></div><button class="button button-danger" data-action="clear-data">Clear data</button></div></div></article></div><p class="notice" style="margin-top:18px">GST fields are provided for record-keeping convenience only. This tool does not calculate taxes or provide tax advice.</p>`; }

function showModal(title, content) { document.getElementById("modal-title").textContent = title; document.getElementById("modal-content").innerHTML = content; document.getElementById("modal-backdrop").hidden = false; setTimeout(() => document.querySelector("#modal-content input, #modal-content select")?.focus(), 20); }
function closeModal() { document.getElementById("modal-backdrop").hidden = true; }
function optionClients(selected = "", blank = "Choose a client") { return `<option value="">${blank}</option>${data.clients.map(c => `<option value="${c.id}" ${c.id===selected?"selected":""}>${escape(c.name)}</option>`).join("")}`; }
function optionProjects(selected = "") { return `<option value="">No project</option>${data.projects.map(p => `<option value="${p.id}" ${p.id===selected?"selected":""}>${escape(p.name)}</option>`).join("")}`; }
function invoiceForm() {
  if (!data.clients.length) { showModal("Add a client first", `<form class="form" id="client-form"><p class="notice">Invoices need a client. Add one now, then create the invoice.</p>${clientFields()}<div class="form-actions"><span></span><div class="form-actions-right"><button type="button" class="button" data-action="close-modal">Cancel</button><button class="button button-primary">Save client</button></div></div></form>`); return; }
  showModal("New invoice", `<form class="form" id="invoice-form"><div class="form-grid"><div class="field"><label>Invoice number</label><input name="number" value="${escape(invoiceNumber())}" required /></div><div class="field"><label>Client</label><select name="clientId" required>${optionClients()}</select></div><div class="field"><label>Project <span class="help">optional</span></label><select name="projectId">${optionProjects()}</select></div><div class="field"><label>Amount before GST</label><input name="amount" type="number" min="0" step="0.01" placeholder="0.00" required /></div><div class="field"><label>Invoice date</label><input name="issueDate" type="date" value="${today()}" required /></div><div class="field"><label>Due date</label><input name="dueDate" type="date" value="${plusDays(Number(data.settings.defaultDueDays)||15)}" required /></div><div class="field"><label>GST rate <span class="help">optional</span></label><select name="gstRate"><option value="0">No GST</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option><option value="28">28%</option></select></div><div class="field"><label>Reference / PO <span class="help">optional</span></label><input name="reference" placeholder="PO number or note" /></div><div class="field full"><label>Notes <span class="help">optional</span></label><textarea name="notes" placeholder="Scope, payment instructions, or a short note"></textarea></div></div><p class="notice">GST fields are optional record-keeping fields only; confirm tax treatment with a qualified professional.</p><div class="form-actions"><span></span><div class="form-actions-right"><button type="button" class="button" data-action="close-modal">Cancel</button><button class="button" name="draft" value="1">Save draft</button><button class="button button-primary">Save invoice</button></div></div></form>`);
}
function paymentForm(invoiceId = "") { const available = data.invoices.filter(i => !i.draft && balance(i) > .005); if (!available.length) { notify("Create an unpaid invoice before recording a payment."); return; } const selected = available.find(i=>i.id===invoiceId) || available[0]; showModal("Record payment", `<form class="form" id="payment-form"><div class="form-grid"><div class="field full"><label>Invoice</label><select name="invoiceId" required>${available.map(i => `<option value="${i.id}" ${i.id===selected.id?"selected":""}>${escape(i.number)} — ${escape(clientName(i.clientId))} (${currency(balance(i))} due)</option>`).join("")}</select></div><div class="field"><label>Amount received</label><input name="amount" type="number" min="0.01" step="0.01" max="${balance(selected)}" value="${balance(selected).toFixed(2)}" required /></div><div class="field"><label>Date received</label><input name="date" type="date" value="${today()}" required /></div><div class="field"><label>Payment mode</label><select name="mode"><option>UPI</option><option>Bank transfer</option><option>Cash</option><option>Cheque</option><option>Card</option><option>Other</option></select></div><div class="field"><label>Reference <span class="help">optional</span></label><input name="reference" placeholder="UTR / cheque number" /></div><div class="field full"><label>Notes <span class="help">optional</span></label><input name="notes" placeholder="Any useful detail" /></div></div><div class="form-actions"><span></span><div class="form-actions-right"><button type="button" class="button" data-action="close-modal">Cancel</button><button class="button button-primary">Save payment</button></div></div></form>`); }
function expenseForm() { showModal("Add expense", `<form class="form" id="expense-form"><div class="form-grid"><div class="field"><label>Amount</label><input name="amount" type="number" min="0.01" step="0.01" required /></div><div class="field"><label>Date</label><input name="date" type="date" value="${today()}" required /></div><div class="field"><label>Category</label><select name="category"><option>Software & subscriptions</option><option>Travel</option><option>Internet & phone</option><option>Equipment</option><option>Office supplies</option><option>Professional services</option><option>Marketing</option><option>Other</option></select></div><div class="field"><label>Payment mode</label><select name="mode"><option>UPI</option><option>Bank transfer</option><option>Cash</option><option>Card</option><option>Other</option></select></div><div class="field full"><label>Description <span class="help">optional</span></label><input name="description" placeholder="What was this for?" /></div></div><div class="form-actions"><span></span><div class="form-actions-right"><button type="button" class="button" data-action="close-modal">Cancel</button><button class="button button-primary">Save expense</button></div></div></form>`); }
function clientFields(c = {}) { return `<div class="form-grid"><div class="field full"><label>Client name</label><input name="name" value="${escape(c.name)}" required /></div><div class="field"><label>Email <span class="help">optional</span></label><input name="email" type="email" value="${escape(c.email)}" /></div><div class="field"><label>Phone <span class="help">optional</span></label><input name="phone" value="${escape(c.phone)}" /></div><div class="field"><label>GSTIN <span class="help">optional</span></label><input name="gstin" value="${escape(c.gstin)}" /></div><div class="field"><label>Contact person <span class="help">optional</span></label><input name="contact" value="${escape(c.contact)}" /></div><div class="field full"><label>Billing address <span class="help">optional</span></label><textarea name="address">${escape(c.address)}</textarea></div></div>`; }
function clientForm(id = "") { const c = data.clients.find(x=>x.id===id) || {}; showModal(id ? "Edit client" : "Add client", `<form class="form" id="client-form" data-id="${id}">${clientFields(c)}<div class="form-actions">${id?`<button type="button" class="button button-danger" data-action="delete-client" data-id="${id}">Delete</button>`:"<span></span>"}<div class="form-actions-right"><button type="button" class="button" data-action="close-modal">Cancel</button><button class="button button-primary">Save client</button></div></div></form>`); }
function projectForm(id = "") { if (!data.clients.length) { notify("Add a client before adding a project."); return; } const p = data.projects.find(x=>x.id===id) || {}; showModal(id ? "Edit project" : "Add project", `<form class="form" id="project-form" data-id="${id}"><div class="form-grid"><div class="field full"><label>Project name</label><input name="name" value="${escape(p.name)}" required /></div><div class="field"><label>Client</label><select name="clientId" required>${optionClients(p.clientId)}</select></div><div class="field"><label>Status</label><select name="status"><option ${p.status==="Active"?"selected":""}>Active</option><option ${p.status==="Completed"?"selected":""}>Completed</option><option ${p.status==="On hold"?"selected":""}>On hold</option></select></div><div class="field full"><label>Notes <span class="help">optional</span></label><textarea name="notes">${escape(p.notes)}</textarea></div></div><div class="form-actions"><span></span><div class="form-actions-right"><button type="button" class="button" data-action="close-modal">Cancel</button><button class="button button-primary">Save project</button></div></div></form>`); }
function invoiceDetail(id) { const i = data.invoices.find(x=>x.id===id); if (!i) return; const payments = data.payments.filter(p=>p.invoiceId===id).sort((a,b)=>b.date.localeCompare(a.date)); showModal(i.number, `<div class="form"><div class="invoice-summary"><div><span>Client</span><strong>${escape(clientName(i.clientId))}</strong></div><div><span>Invoice date</span><span>${dateText(i.issueDate)}</span></div><div><span>Due date</span><span>${dateText(i.dueDate)}</span></div><div><span>Subtotal</span><span>${currency(i.amount)}</span></div>${Number(i.gstRate)?`<div><span>GST (${i.gstRate}%)</span><span>${currency(Number(i.amount)*Number(i.gstRate)/100)}</span></div>`:""}<div><strong>Total</strong><strong>${currency(invoiceAmount(i))}</strong></div><div><strong>Balance due</strong><strong>${currency(balance(i))}</strong></div></div>${i.notes?`<p class="help" style="margin-top:13px">${escape(i.notes)}</p>`:""}<div class="panel-head" style="margin-top:21px"><h2 style="font-size:16px">Payments</h2>${balance(i)>.005&&!i.draft?`<button class="button button-primary button-sm" data-action="new-payment" data-id="${i.id}">Record payment</button>`:""}</div><div class="list">${payments.length?payments.map(p=>`<div class="list-row"><div><div class="primary-text">${currency(p.amount)}</div><div class="secondary-text">${dateText(p.date)} · ${escape(p.mode)} ${p.reference?`· ${escape(p.reference)}`:""}</div></div><button class="button button-sm" data-action="delete-payment" data-id="${p.id}">Remove</button></div>`).join(""):"<p class=\"help\">No payments recorded.</p>"}</div><div class="form-actions"><button class="button button-danger" data-action="delete-invoice" data-id="${i.id}">Delete invoice</button><div class="form-actions-right"><button class="button" data-action="print">Print</button><button class="button button-primary" data-action="close-modal">Done</button></div></div></div>`); }

function formObject(form) { return Object.fromEntries(new FormData(form).entries()); }
function download(filename, content, type="application/json") { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = filename; a.click(); URL.revokeObjectURL(a.href); }
function exportBackup() { download(`freelance-ledger-backup-${today()}.json`, JSON.stringify(data, null, 2)); notify("Backup downloaded."); }
function exportExpenses() { const csv = ["Date,Category,Description,Payment mode,Amount INR", ...data.expenses.map(e=>[e.date,e.category,e.description,e.mode,e.amount].map(v=>`"${String(v||"").replaceAll('"','""')}"`).join(","))].join("\n"); download(`expenses-${today()}.csv`, csv, "text/csv"); }
function exportReport() { const lines = ["Freelance Ledger summary", `Generated: ${today()}`, "", "Invoice number,Client,Invoice total INR,Paid INR,Balance INR,Status", ...data.invoices.map(i => [i.number,clientName(i.clientId),invoiceAmount(i),paidAmount(i.id),balance(i),invoiceStatus(i)].map(v=>`"${String(v).replaceAll('"','""')}"`).join(","))]; download(`ledger-summary-${today()}.csv`, lines.join("\n"), "text/csv"); }

document.addEventListener("click", event => {
  const target = event.target.closest("[data-action]"); if (!target) return; const { action, id } = target.dataset;
  if (action === "new-invoice") invoiceForm();
  else if (action === "new-payment") paymentForm(id);
  else if (action === "new-expense") expenseForm();
  else if (action === "new-client") clientForm();
  else if (action === "edit-client") clientForm(id);
  else if (action === "new-project") projectForm();
  else if (action === "edit-project") projectForm(id);
  else if (action === "invoice-detail") invoiceDetail(id);
  else if (action === "close-modal") closeModal();
  else if (action === "export-backup") exportBackup();
  else if (action === "import-backup") document.getElementById("import-file").click();
  else if (action === "export-expenses") exportExpenses();
  else if (action === "export-report") exportReport();
  else if (action === "print") window.print();
  else if (action === "clear-data") { if (confirm("Clear every record from this device? This cannot be undone.")) { data = emptyData(); save(); closeModal(); render(); notify("All local data cleared."); } }
  else if (action === "delete-client") { if (data.invoices.some(i=>i.clientId===id) || data.projects.some(p=>p.clientId===id)) return notify("Keep this client because records are linked to it."); if(confirm("Delete this client?")) { data.clients = data.clients.filter(c=>c.id!==id); save(); closeModal(); render(); } }
  else if (action === "delete-invoice") { if(confirm("Delete this invoice and its payment records?")) { data.invoices=data.invoices.filter(i=>i.id!==id); data.payments=data.payments.filter(p=>p.invoiceId!==id); save(); closeModal(); render(); notify("Invoice deleted."); } }
  else if (action === "delete-payment") { const payment = data.payments.find(p => p.id === id); if(confirm("Remove this payment?") && payment) { const invoiceId = payment.invoiceId; data.payments=data.payments.filter(p=>p.id!==id); save(); render(); invoiceDetail(invoiceId); } }
});
document.addEventListener("submit", event => {
  const form = event.target; event.preventDefault(); const values = formObject(form);
  if (form.id === "invoice-form") { const isDraft = new FormData(form).get("draft") === "1"; data.invoices.push({ id:uid(), ...values, amount:Number(values.amount), gstRate:Number(values.gstRate), draft:isDraft }); data.settings.nextInvoice = Number(data.settings.nextInvoice || 1) + 1; save(); closeModal(); render(); notify(isDraft ? "Invoice draft saved." : "Invoice saved."); }
  if (form.id === "payment-form") { const invoice = data.invoices.find(i=>i.id===values.invoiceId); if (!invoice || Number(values.amount) > balance(invoice) + .01) return notify("Payment cannot exceed the balance due."); data.payments.push({ id:uid(), ...values, amount:Number(values.amount), invoiceNumber:invoice.number }); save(); closeModal(); render(); notify("Payment recorded."); }
  if (form.id === "expense-form") { data.expenses.push({ id:uid(), ...values, amount:Number(values.amount) }); save(); closeModal(); render(); notify("Expense recorded."); }
  if (form.id === "client-form") { const id = form.dataset.id; if (id) Object.assign(data.clients.find(c=>c.id===id), values); else data.clients.push({id:uid(), ...values}); save(); closeModal(); render(); notify("Client saved."); }
  if (form.id === "project-form") { const id = form.dataset.id; if (id) Object.assign(data.projects.find(p=>p.id===id), values); else data.projects.push({id:uid(), ...values}); save(); closeModal(); render(); notify("Project saved."); }
  if (form.id === "settings-form") { data.settings = { ...data.settings, ...values, nextInvoice:Number(values.nextInvoice), defaultDueDays:Number(values.defaultDueDays) }; save(); render(); notify("Business details saved."); }
});
document.addEventListener("input", event => { if (event.target.matches("[data-search]")) { searchText = event.target.value; render(); const input=document.querySelector("[data-search]"); input?.focus(); input?.setSelectionRange(searchText.length,searchText.length); } });
document.getElementById("modal-backdrop").addEventListener("click", e => { if(e.target.id === "modal-backdrop") closeModal(); });
document.getElementById("backup-button").addEventListener("click", exportBackup);
document.getElementById("import-file").addEventListener("change", async event => { const file = event.target.files[0]; if (!file) return; try { const imported = JSON.parse(await file.text()); if (!imported || !Array.isArray(imported.invoices) || !Array.isArray(imported.clients)) throw new Error(); if (!confirm("Replace all data on this device with this backup?")) return; data = { ...emptyData(), ...imported, settings:{...emptyData().settings,...imported.settings} }; save(); render(); notify("Backup imported."); } catch { notify("That file is not a valid Freelance Ledger backup."); } finally { event.target.value = ""; } });
window.addEventListener("hashchange", () => { currentView = location.hash.slice(1) || "dashboard"; searchText = ""; render(); });
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(()=>{}));
render();
