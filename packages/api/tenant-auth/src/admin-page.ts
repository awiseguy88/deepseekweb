/**
 * Self-contained HTML document for the hosted WiseAI operator console.
 *
 * The document inlines its CSS and vanilla-JavaScript client; it references no
 * external script, stylesheet, font, or image. The client reads and mutates the
 * same-origin `/admin/api/*` JSON endpoints with the session cookie, redirects
 * to `/login` on a `401`, and renders every server-supplied value through
 * `textContent` or `createElement` so tenant, user, support, and Stripe text
 * cannot inject markup. It reads `/admin/api/me` first: a tenant administrator
 * gets the workspace view (its own users, sessions, and support), while the
 * platform operator keeps the global customer console.
 *
 * @returns The complete `text/html` document served for `GET /admin`. Repeated
 * calls return byte-identical output.
 */
export function renderAdminPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex, nofollow">
<title>WiseAI admin</title>
<style>
*,*::before,*::after{box-sizing:border-box}
:root{--bg:#0d0e0d;--panel:#131412;--panel-2:#191b18;--panel-3:#20231f;--line:#2c302a;--line-soft:#23261f;--text:#eceee7;--muted:#9aa094;--dim:#6f756a;--accent:#eb6c2c;--accent-strong:#ff7f3f;--accent-soft:rgba(235,108,44,.14);--ok:#63b76a;--ok-soft:rgba(99,183,106,.14);--warn:#d9a13b;--warn-soft:rgba(217,161,59,.14);--danger:#e0533d;--danger-soft:rgba(224,83,61,.14);--info:#5aa9d6;--info-soft:rgba(90,169,214,.14);--radius:12px;--radius-sm:8px;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;--sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
html{color-scheme:dark}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font:15px/1.5 var(--sans);-webkit-font-smoothing:antialiased}
a{color:var(--accent-strong)}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.skip{position:absolute;left:-999px;top:0;z-index:50;background:var(--accent);color:#150b06;padding:.6rem 1rem;border-radius:0 0 var(--radius-sm) 0;font-weight:600}
.skip:focus{left:0}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.75rem clamp(1rem,3vw,2rem);background:rgba(13,14,13,.92);border-bottom:1px solid var(--line);backdrop-filter:blur(8px)}
.brand{display:flex;align-items:center;gap:.6rem;font-weight:650;letter-spacing:.01em}
.mark{display:inline-flex;align-items:center;justify-content:center;width:1.8rem;height:1.8rem;border-radius:7px;background:var(--accent);color:#170d07;font-weight:800;font-family:var(--mono)}
.tag{font-family:var(--mono);font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;color:var(--accent-strong);border:1px solid var(--accent);border-radius:999px;padding:.12rem .5rem}
.topbar-actions{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;justify-content:flex-end}
.tabs{display:flex;gap:.25rem;overflow-x:auto;padding:.5rem clamp(1rem,3vw,2rem) 0;border-bottom:1px solid var(--line);background:var(--bg)}
.tab{appearance:none;border:1px solid transparent;border-bottom:none;background:transparent;color:var(--muted);font:inherit;font-weight:600;padding:.6rem 1rem;border-radius:var(--radius-sm) var(--radius-sm) 0 0;cursor:pointer;white-space:nowrap}
.tab:hover{color:var(--text);background:var(--panel-2)}
.tab.active,.tab[aria-selected="true"]{color:var(--text);background:var(--panel);border-color:var(--line)}
main{padding:clamp(1rem,3vw,2rem);max-width:84rem;margin:0 auto}
.workspace-heading{margin:0 0 1rem;font-size:1.3rem;letter-spacing:-.01em}
.panel:focus{outline:none}
.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:1rem}
.panel-head h2{margin:0 0 .15rem;font-size:1.45rem;letter-spacing:-.01em}
.panel-head p{margin:0}
.panel-actions{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
h3{font-size:1rem;margin:0 0 .65rem}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr));gap:.75rem;margin-bottom:1.25rem}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:1rem}
.stat-label{display:block;font-family:var(--mono);font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.stat-value{display:block;font-size:1.9rem;line-height:1.15;margin:.35rem 0 .15rem;font-variant-numeric:tabular-nums}
.stat-hint{display:block;color:var(--dim);font-size:.78rem}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:1rem;margin-bottom:1.25rem}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.75rem}
.card-head h3{margin:0}
.state{margin:.25rem 0 1rem;color:var(--muted);font-size:.9rem}
.state.error{color:var(--danger)}
.empty{margin:.5rem 0;color:var(--dim);font-size:.9rem}
.mono{font-family:var(--mono)}
.muted{color:var(--muted)}
.small{font-size:.82rem}
.table-wrap{overflow-x:auto;border:1px solid var(--line-soft);border-radius:var(--radius-sm)}
table{width:100%;border-collapse:collapse;font-size:.9rem}
th,td{text-align:left;padding:.6rem .75rem;border-bottom:1px solid var(--line-soft);vertical-align:middle}
th{font-family:var(--mono);font-size:.68rem;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);background:var(--panel-2);position:sticky;top:0}
tbody tr:last-child td{border-bottom:none}
tbody tr:hover{background:var(--panel-2)}
.stack{display:flex;flex-direction:column;gap:.1rem;min-width:0}
.stack strong{font-weight:600;overflow-wrap:anywhere}
.row-badges{display:flex;gap:.3rem;flex-wrap:wrap}
.badge{display:inline-flex;align-items:center;border-radius:999px;padding:.1rem .5rem;font-family:var(--mono);font-size:.68rem;letter-spacing:.03em;text-transform:lowercase;border:1px solid transparent;white-space:nowrap}
.badge.ok{color:var(--ok);background:var(--ok-soft);border-color:rgba(99,183,106,.4)}
.badge.warn{color:var(--warn);background:var(--warn-soft);border-color:rgba(217,161,59,.4)}
.badge.danger{color:var(--danger);background:var(--danger-soft);border-color:rgba(224,83,61,.4)}
.badge.info{color:var(--info);background:var(--info-soft);border-color:rgba(90,169,214,.4)}
.badge.neutral{color:var(--muted);background:var(--panel-3);border-color:var(--line)}
.btn{appearance:none;font:inherit;font-weight:600;border-radius:var(--radius-sm);border:1px solid var(--line);background:var(--panel-2);color:var(--text);padding:.5rem .9rem;cursor:pointer;transition:background .12s ease,border-color .12s ease}
.btn:hover{background:var(--panel-3);border-color:var(--dim)}
.btn:disabled{opacity:.55;cursor:not-allowed}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#170d07}
.btn.primary:hover{background:var(--accent-strong);border-color:var(--accent-strong)}
.btn.ghost{background:transparent}
.btn.danger{color:var(--danger);border-color:rgba(224,83,61,.5);background:var(--danger-soft)}
.btn.small{padding:.28rem .6rem;font-size:.8rem}
.search input{min-width:15rem}
input,select,textarea{font:inherit;color:var(--text);background:var(--panel-2);border:1px solid var(--line);border-radius:var(--radius-sm);padding:.5rem .65rem;width:100%}
input[type="search"]{appearance:none}
input:disabled,select:disabled,textarea:disabled{opacity:.6}
textarea{resize:vertical}
.field{display:flex;flex-direction:column;gap:.3rem;font-size:.82rem;color:var(--muted);font-weight:600}
.field input,.field select,.field textarea{font-weight:400}
.field-wide{grid-column:1/-1}
.field-hint{color:var(--dim);font-weight:400;font-size:.78rem}
.form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));gap:.85rem}
.form-actions{display:flex;gap:.5rem;justify-content:flex-end;flex-wrap:wrap;margin-top:.35rem}
.inline-form{display:flex;align-items:flex-end;gap:.5rem;flex-wrap:wrap}
.inline-form .field{min-width:12rem}
.detail-section{margin-top:1.5rem}
.section-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.65rem}
.section-head h3{margin:0}
.message-body{margin:.75rem 0;padding:.85rem 1rem;border-left:3px solid var(--accent);background:var(--panel-2);border-radius:0 var(--radius-sm) var(--radius-sm) 0;white-space:pre-wrap;overflow-wrap:anywhere}
.warning{display:flex;flex-direction:column;gap:.5rem;border:1px solid rgba(217,161,59,.5);background:var(--warn-soft);border-radius:var(--radius);padding:1rem;margin-bottom:1.25rem}
.warning strong{color:var(--warn)}
.warning p{margin:0;color:var(--text);font-size:.9rem}
.link{color:var(--accent-strong);font-weight:600}
dialog{border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);color:var(--text);padding:1.25rem;width:min(34rem,calc(100vw - 2rem));max-height:calc(100vh - 4rem);overflow-y:auto}
dialog.wide{width:min(62rem,calc(100vw - 2rem))}
dialog::backdrop{background:rgba(4,5,4,.72);backdrop-filter:blur(2px)}
.dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:.75rem}
.dialog-head h2{margin:0 0 .15rem;font-size:1.2rem}
.dialog-form{display:flex;flex-direction:column;gap:.85rem}
.toast{position:fixed;right:1rem;bottom:1rem;z-index:60;display:flex;flex-direction:column;gap:.5rem;max-width:min(24rem,calc(100vw - 2rem))}
.toast-item{padding:.65rem .9rem;border-radius:var(--radius-sm);border:1px solid var(--line);background:var(--panel-3);box-shadow:0 8px 24px rgba(0,0,0,.45);font-size:.88rem}
.toast-item.ok{border-color:rgba(99,183,106,.55)}
.toast-item.error{border-color:rgba(224,83,61,.65);color:#ffd5ce}
.noscript{margin:1rem;padding:1rem;border:1px solid var(--warn);border-radius:var(--radius);color:var(--warn)}
@media (max-width:760px){
  .topbar{flex-wrap:wrap}
  .panel-head{flex-direction:column;align-items:stretch}
  .panel-actions{justify-content:flex-start}
  .search input{min-width:0;width:100%}
  td,th{padding:.5rem .55rem}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important;scroll-behavior:auto!important}}
</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<h1 class="sr-only">WiseAI admin console</h1>
<header class="topbar">
  <div class="brand"><span class="mark" aria-hidden="true">W</span><span>WiseAI</span><span class="tag">Admin</span></div>
  <div class="topbar-actions"><span class="muted small" id="console-role">Platform operator</span><button type="button" class="btn ghost small" id="signout">Sign out</button></div>
</header>
<nav class="tabs" role="tablist" aria-label="Admin sections">
  <button type="button" class="tab" id="tab-overview" role="tab" aria-controls="panel-overview" aria-selected="true" tabindex="0" data-tab="overview">Overview</button>
  <button type="button" class="tab" id="tab-customers" role="tab" aria-controls="panel-customers" aria-selected="false" tabindex="-1" data-tab="customers">Customers</button>
  <button type="button" class="tab" id="tab-users" role="tab" aria-controls="panel-users" aria-selected="false" tabindex="-1" data-tab="users" hidden>Users</button>
  <button type="button" class="tab" id="tab-support" role="tab" aria-controls="panel-support" aria-selected="false" tabindex="-1" data-tab="support">Support</button>
  <button type="button" class="tab" id="tab-sessions" role="tab" aria-controls="panel-sessions" aria-selected="false" tabindex="-1" data-tab="sessions">Sessions</button>
  <button type="button" class="tab" id="tab-sales" role="tab" aria-controls="panel-sales" aria-selected="false" tabindex="-1" data-tab="sales">Sales</button>
</nav>
<main id="main">
  <h2 class="workspace-heading" id="workspace-heading" hidden></h2>
  <section class="panel" id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" tabindex="0">
    <div class="panel-head">
      <div><h2>Overview</h2><p class="muted">Deployment health at a glance.</p></div>
      <div class="panel-actions">
        <button type="button" class="btn ghost" id="overview-refresh">Refresh</button>
      </div>
    </div>
    <p class="state" id="overview-status" role="status"></p>
    <div class="stats" id="overview-stats"></div>
    <section class="card" aria-labelledby="overview-support-title">
      <div class="card-head"><h3 id="overview-support-title">Recent support</h3><button type="button" class="btn ghost small" id="overview-support-more">Open inbox</button></div>
      <div id="overview-support"></div>
    </section>
  </section>
  <section class="panel" id="panel-customers" role="tabpanel" aria-labelledby="tab-customers" tabindex="0" hidden>
    <div class="panel-head">
      <div><h2>Customers</h2><p class="muted">Tenants, plans, and access.</p></div>
      <div class="panel-actions">
        <label class="search"><span class="sr-only">Search customers</span><input id="customer-search" type="search" placeholder="Search name, tenant, plan" autocomplete="off"></label>
        <button type="button" class="btn ghost" id="customers-refresh">Refresh</button>
        <button type="button" class="btn primary" id="new-customer-open">New customer</button>
      </div>
    </div>
    <p class="state" id="customers-status" role="status"></p>
    <p class="muted small" id="customers-summary"></p>
    <div class="card"><div id="customers-table"></div></div>
  </section>
  <section class="panel" id="panel-users" role="tabpanel" aria-labelledby="tab-users" tabindex="0" hidden>
    <div class="panel-head">
      <div><h2>Users</h2><p class="muted">Accounts in your workspace.</p></div>
      <div class="panel-actions">
        <button type="button" class="btn ghost" id="users-refresh">Refresh</button>
        <button type="button" class="btn primary" id="users-add">Add user</button>
      </div>
    </div>
    <p class="state" id="users-status" role="status"></p>
    <p class="muted small" id="users-summary"></p>
    <div class="card"><div id="users-table"></div></div>
  </section>
  <section class="panel" id="panel-support" role="tabpanel" aria-labelledby="tab-support" tabindex="0" hidden>
    <div class="panel-head">
      <div><h2>Support</h2><p class="muted">Requests raised from the in-app Need Help control.</p></div>
      <div class="panel-actions">
        <label class="field"><span>Status</span><select id="support-filter"><option value="">All statuses</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="closed">Closed</option></select></label>
        <button type="button" class="btn ghost" id="support-refresh">Refresh</button>
      </div>
    </div>
    <p class="state" id="support-status" role="status"></p>
    <p class="muted small" id="support-summary"></p>
    <div class="card"><div id="support-table"></div></div>
  </section>
  <section class="panel" id="panel-sessions" role="tabpanel" aria-labelledby="tab-sessions" tabindex="0" hidden>
    <div class="panel-head">
      <div><h2>Sessions</h2><p class="muted">Active and revoked sessions across every tenant.</p></div>
      <div class="panel-actions">
        <form class="inline-form" id="sessions-search">
          <label class="field"><span>Tenant</span><input id="session-tenant" type="search" placeholder="Filter by tenant id" autocomplete="off"></label>
          <button type="submit" class="btn ghost">Filter</button>
        </form>
        <button type="button" class="btn ghost" id="sessions-refresh">Refresh</button>
        <button type="button" class="btn danger" id="sessions-purge">Remove dead sessions</button>
        <button type="button" class="btn danger" id="sessions-revoke-all">Revoke all</button>
      </div>
    </div>
    <p class="state" id="sessions-status" role="status"></p>
    <p class="muted small" id="sessions-summary"></p>
    <div class="card"><div id="sessions-table"></div></div>
  </section>
  <section class="panel" id="panel-sales" role="tabpanel" aria-labelledby="tab-sales" tabindex="0" hidden>
    <div class="panel-head">
      <div><h2>Sales</h2><p class="muted">Stripe subscription webhook ledger.</p></div>
      <button type="button" class="btn ghost" id="sales-refresh">Refresh</button>
    </div>
    <p class="state" id="sales-status" role="status"></p>
    <div class="warning" id="sales-warning" hidden></div>
    <p class="muted small" id="sales-summary"></p>
    <div class="card"><div id="sales-events"></div></div>
  </section>
</main>
<dialog id="new-customer-dialog" class="dialog" aria-labelledby="new-customer-title">
  <form class="dialog-form" id="new-customer-form">
    <header class="dialog-head">
      <div><h2 id="new-customer-title">New customer</h2><p class="muted small">Creates a tenant and its first administrator.</p></div>
      <button type="button" class="btn ghost small" data-close="new-customer-dialog" aria-label="Close dialog">Close</button>
    </header>
    <label class="field"><span>Customer name</span><input id="new-customer-name" required autocomplete="organization"></label>
    <label class="field"><span>Plan</span><input id="new-customer-plan" value="pro" required></label>
    <label class="field"><span>Admin email</span><input id="new-customer-email" type="email" required autocomplete="off"></label>
    <label class="field"><span>Temporary password</span><input id="new-customer-password" type="password" minlength="12" required autocomplete="new-password"><span class="field-hint">At least 12 characters.</span></label>
    <div class="form-actions">
      <button type="button" class="btn ghost" data-close="new-customer-dialog">Cancel</button>
      <button type="submit" class="btn primary" id="new-customer-submit">Create customer</button>
    </div>
  </form>
</dialog>
<dialog id="customer-dialog" class="dialog wide" aria-labelledby="customer-dialog-title">
  <header class="dialog-head">
    <div><h2 id="customer-dialog-title">Customer</h2><p class="mono small muted" id="customer-dialog-subtitle"></p></div>
    <button type="button" class="btn ghost small" data-close="customer-dialog" aria-label="Close dialog">Close</button>
  </header>
  <p class="state" id="customer-detail-status" role="status"></p>
  <div id="customer-detail-body" hidden>
    <section class="detail-section" aria-labelledby="customer-profile-title">
      <h3 id="customer-profile-title">Profile</h3>
      <form class="form-grid" id="customer-profile-form">
        <label class="field"><span>Name</span><input id="customer-profile-name" required></label>
        <label class="field"><span>Plan</span><input id="customer-profile-plan" required></label>
        <label class="field"><span>Status</span><select id="customer-profile-status"><option value="active">active</option><option value="trialing">trialing</option><option value="past_due">past_due</option><option value="canceled">canceled</option><option value="disabled">disabled</option></select></label>
        <label class="field"><span>Access until</span><input id="customer-profile-access" type="datetime-local"><span class="field-hint">Empty means no expiry.</span></label>
        <label class="field field-wide"><span>Notes</span><textarea id="customer-profile-notes" rows="3"></textarea></label>
        <p class="mono small muted field-wide" id="customer-profile-meta"></p>
        <div class="form-actions field-wide"><button type="submit" class="btn primary" id="customer-profile-submit">Save profile</button><button type="button" class="btn danger" id="customer-delete">Delete customer</button></div>
      </form>
    </section>
    <section class="detail-section" aria-labelledby="customer-users-title">
      <div class="section-head"><h3 id="customer-users-title">Users</h3><button type="button" class="btn ghost small" id="add-user-open">Add user</button></div>
      <div id="customer-users"></div>
    </section>
    <section class="detail-section" aria-labelledby="customer-sessions-title">
      <h3 id="customer-sessions-title">Sessions</h3>
      <div id="customer-sessions"></div>
    </section>
  </div>
</dialog>
<dialog id="add-user-dialog" class="dialog" aria-labelledby="add-user-title">
  <form class="dialog-form" id="add-user-form">
    <header class="dialog-head">
      <div><h2 id="add-user-title">Add user</h2><p class="muted small">Creates an account inside the selected tenant.</p></div>
      <button type="button" class="btn ghost small" data-close="add-user-dialog" aria-label="Close dialog">Close</button>
    </header>
    <label class="field"><span>Email</span><input id="add-user-email" type="email" required autocomplete="off"></label>
    <label class="field"><span>Password</span><input id="add-user-password" type="password" minlength="12" required autocomplete="new-password"><span class="field-hint">At least 12 characters.</span></label>
    <label class="field"><span>Role</span><select id="add-user-role"><option value="member">member</option><option value="admin">admin</option></select></label>
    <div class="form-actions">
      <button type="button" class="btn ghost" data-close="add-user-dialog">Cancel</button>
      <button type="submit" class="btn primary" id="add-user-submit">Add user</button>
    </div>
  </form>
</dialog>
<dialog id="password-dialog" class="dialog" aria-labelledby="password-title">
  <form class="dialog-form" id="password-form">
    <header class="dialog-head">
      <div><h2 id="password-title">Set password</h2><p class="muted small" id="password-user-label"></p></div>
      <button type="button" class="btn ghost small" data-close="password-dialog" aria-label="Close dialog">Close</button>
    </header>
    <label class="field"><span>New password</span><input id="password-value" type="password" minlength="12" required autocomplete="new-password"><span class="field-hint">At least 12 characters.</span></label>
    <div class="form-actions">
      <button type="button" class="btn ghost" data-close="password-dialog">Cancel</button>
      <button type="submit" class="btn primary" id="password-submit">Set password</button>
    </div>
  </form>
</dialog>
<dialog id="support-dialog" class="dialog wide" aria-labelledby="support-dialog-title">
  <header class="dialog-head">
    <div><h2 id="support-dialog-title">Support request</h2><p class="mono small muted" id="support-detail-subject"></p></div>
    <button type="button" class="btn ghost small" data-close="support-dialog" aria-label="Close dialog">Close</button>
  </header>
  <p class="small" id="support-detail-meta"></p>
  <p class="small muted" id="support-detail-created"></p>
  <p class="mono small" id="support-detail-page"></p>
  <blockquote class="message-body" id="support-detail-message"></blockquote>
  <form class="form-grid" id="support-form">
    <label class="field"><span>Status</span><select id="support-detail-status"><option value="open">open</option><option value="in_progress">in_progress</option><option value="closed">closed</option></select></label>
    <label class="field"><span>Priority</span><select id="support-detail-priority"><option value="low">low</option><option value="normal">normal</option><option value="high">high</option></select></label>
    <label class="field field-wide"><span>Admin note</span><textarea id="support-detail-note" rows="4"></textarea></label>
    <div class="form-actions field-wide">
      <button type="button" class="btn ghost" data-close="support-dialog">Cancel</button>
      <button type="submit" class="btn primary" id="support-submit">Save request</button>
    </div>
  </form>
</dialog>
<noscript><p class="noscript">The WiseAI admin console requires JavaScript.</p></noscript>
<div class="toast" id="toast" aria-live="polite" aria-atomic="false"></div>
<script>
(function () {
  'use strict';

  var TABS = ['overview', 'customers', 'users', 'support', 'sessions', 'sales'];
  var state = {
    tab: 'overview',
    me: null,
    customers: [],
    support: [],
    sessions: [],
    overview: null,
    sales: null,
    customerTenant: '',
    customerDetail: null,
    supportFilter: '',
    supportDetail: null,
    sessionTenant: '',
    passwordUserId: ''
  };

  function $(id) { return document.getElementById(id); }

  function make(tag, className, value) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined && value !== null) node.textContent = String(value);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function setStatus(id, message, tone) {
    var node = $(id);
    if (!node) return;
    node.textContent = message || '';
    node.className = 'state' + (tone ? ' ' + tone : '');
    node.hidden = !message;
  }

  function toast(message, tone) {
    var host = $('toast');
    var item = make('div', 'toast-item ' + (tone || 'ok'), message);
    host.appendChild(item);
    window.setTimeout(function () {
      if (item.parentNode) item.parentNode.removeChild(item);
    }, 4500);
  }

  function api(path, options) {
    var init = { credentials: 'same-origin', headers: {} };
    if (options && options.method) init.method = options.method;
    if (options && options.body !== undefined) {
      init.body = JSON.stringify(options.body);
      init.headers['content-type'] = 'application/json';
    }
    return fetch(path, init).then(function (response) {
      if (response.status === 401) {
        window.location.assign('/login');
        throw new Error('Your session expired. Redirecting to sign in.');
      }
      return response.text().then(function (body) {
        var payload = null;
        if (body) {
          try {
            payload = JSON.parse(body);
          } catch (parseFailure) {
            payload = null;
          }
        }
        if (!response.ok) {
          var message = payload && payload.error ? String(payload.error) : 'Request failed with status ' + response.status;
          throw new Error(message);
        }
        return payload;
      });
    });
  }

  function formatDate(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString();
  }

  function formatDay(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString();
  }

  function toDatetimeLocal(value) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    var pad = function (part) { return part < 10 ? '0' + part : String(part); };
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function formatMoney(amountTotal, currency) {
    if (amountTotal === null || amountTotal === undefined) return '—';
    var amount = Number(amountTotal);
    if (Number.isNaN(amount)) return '—';
    var code = currency ? String(currency).toUpperCase() : '';
    return (amount / 100).toFixed(2) + (code ? ' ' + code : '');
  }

  function badge(label, tone) {
    return make('span', 'badge ' + (tone || 'neutral'), label);
  }

  function toneFor(value) {
    if (value === 'active' || value === 'succeeded' || value === 'paid' || value === 'closed') return 'ok';
    if (value === 'trialing' || value === 'in_progress' || value === 'normal') return 'info';
    if (value === 'past_due' || value === 'open' || value === 'low') return 'warn';
    if (value === 'canceled' || value === 'failed' || value === 'disabled' || value === 'high') return 'danger';
    return 'neutral';
  }

  function actionButton(label, onClick, tone) {
    var button = make('button', 'btn small ' + (tone || 'ghost'), label);
    button.type = 'button';
    button.addEventListener('click', onClick);
    return button;
  }

  function buildTable(columns, rows, emptyMessage) {
    var wrap = make('div', 'table-wrap');
    if (!rows || rows.length === 0) {
      wrap.appendChild(make('p', 'empty', emptyMessage || 'Nothing to show yet.'));
      return wrap;
    }
    var table = make('table');
    var thead = make('thead');
    var headRow = make('tr');
    columns.forEach(function (column) {
      var th = make('th', null, column);
      th.scope = 'col';
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    var tbody = make('tbody');
    rows.forEach(function (cells) {
      var row = make('tr');
      cells.forEach(function (cell) {
        var td = make('td');
        if (cell && cell.nodeType === 1) td.appendChild(cell);
        else td.textContent = cell === null || cell === undefined ? '—' : String(cell);
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });
    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function beginLoad(panelId, statusId) {
    var panel = $(panelId);
    if (panel) panel.setAttribute('aria-busy', 'true');
    setStatus(statusId, 'Loading…');
  }

  function endLoad(panelId, statusId) {
    var panel = $(panelId);
    if (panel) panel.removeAttribute('aria-busy');
    setStatus(statusId, '');
  }

  function failLoad(statusId, error, retry) {
    var node = $(statusId);
    clear(node);
    node.hidden = false;
    node.className = 'state error';
    node.appendChild(make('span', null, 'Could not load: ' + (error && error.message ? error.message : 'unknown error')));
    node.appendChild(document.createTextNode(' '));
    node.appendChild(actionButton('Retry', retry, 'ghost'));
  }

  function openDialog(target) {
    var dialog = typeof target === 'string' ? $(target) : target;
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else {
      dialog.setAttribute('open', 'open');
      dialog.setAttribute('aria-hidden', 'false');
    }
  }

  function closeDialog(id) {
    var dialog = $(id);
    if (!dialog || !dialog.open) return;
    if (typeof dialog.close === 'function') dialog.close();
    else {
      dialog.removeAttribute('open');
      dialog.setAttribute('aria-hidden', 'true');
    }
  }

  function visibleTabs() {
    return TABS.filter(function (tab) {
      var button = $('tab-' + tab);
      return button !== null && !button.hidden;
    });
  }

  function activateTab(name) {
    if (TABS.indexOf(name) === -1) name = 'overview';
    state.tab = name;
    TABS.forEach(function (tab) {
      var button = $('tab-' + tab);
      var panel = $('panel-' + tab);
      var selected = tab === name;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
      button.classList.toggle('active', selected);
      panel.hidden = !selected;
    });
    loadTab(name);
  }

  function loadTab(name) {
    if (name === 'overview') loadOverview();
    else if (name === 'customers') loadCustomers();
    else if (name === 'users') loadUsers();
    else if (name === 'support') loadSupport();
    else if (name === 'sessions') loadSessions();
    else if (name === 'sales') loadSales();
  }

  function applyTenantAdmin(me) {
    var label = 'Workspace admin — ' + (me.tenantName || me.tenantId);
    $('console-role').textContent = label;
    var heading = $('workspace-heading');
    heading.textContent = label;
    heading.hidden = false;
    // A tenant administrator manages one workspace: no tenant creation, no
    // global customer table, and no platform sales ledger.
    $('tab-customers').hidden = true;
    $('panel-customers').hidden = true;
    $('new-customer-open').hidden = true;
    $('tab-sales').hidden = true;
    $('panel-sales').hidden = true;
    $('customer-delete').hidden = true;
    $('tab-users').hidden = false;
    state.customerTenant = me.tenantId;
  }

  function loadMe() {
    return api('/admin/api/me').then(function (me) {
      state.me = me;
      if (me && !me.platformAdmin) applyTenantAdmin(me);
    });
  }

  function loadUsers() {
    if (!state.me) return;
    beginLoad('panel-users', 'users-status');
    api('/admin/api/customers/' + encodeURIComponent(state.me.tenantId)).then(function (payload) {
      endLoad('panel-users', 'users-status');
      state.customerTenant = state.me.tenantId;
      state.customerDetail = payload;
      renderUsers(payload && payload.users ? payload.users : []);
    }).catch(function (error) {
      endLoad('panel-users', 'users-status');
      failLoad('users-status', error, loadUsers);
    });
  }

  function renderUsers(users) {
    var host = $('users-table');
    clear(host);
    $('users-summary').textContent = users.length + ' users.';
    var rows = users.map(function (user) {
      var access = make('div', 'row-badges');
      access.appendChild(badge(user.disabled ? 'disabled' : 'active', user.disabled ? 'danger' : 'ok'));
      if (user.platformAdmin) access.appendChild(badge('platform admin', 'info'));
      var role = document.createElement('select');
      role.className = 'select inline';
      role.setAttribute('aria-label', 'Role for ' + user.email);
      ['admin', 'member'].forEach(function (value) {
        var option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        option.selected = user.role === value;
        role.appendChild(option);
      });
      role.addEventListener('change', function () {
        updateUser(user.userId, { role: role.value }, 'Role updated.', loadUsers);
      });
      return [
        user.email,
        role,
        access,
        formatDate(user.lastSeenAt),
        actionButton(user.disabled ? 'Enable' : 'Disable', function () {
          updateUser(user.userId, { disabled: !user.disabled }, user.disabled ? 'User enabled.' : 'User disabled.', loadUsers);
        }, user.disabled ? 'ghost' : 'danger'),
        actionButton('Set password', function () { openPasswordDialog(user); }, 'ghost')
      ];
    });
    host.appendChild(buildTable(['Email', 'Role', 'Access', 'Last seen', '', ''], rows, 'No users in this workspace yet.'));
  }

  function loadOverview() {
    beginLoad('panel-overview', 'overview-status');
    Promise.all([
      api('/admin/api/overview'),
      api('/admin/api/support?status=open')
    ]).then(function (results) {
      endLoad('panel-overview', 'overview-status');
      renderOverview(results[0], results[1] && results[1].requests ? results[1].requests : []);
    }).catch(function (error) {
      endLoad('panel-overview', 'overview-status');
      clear($('overview-stats'));
      clear($('overview-support'));
      failLoad('overview-status', error, loadOverview);
    });
  }

  function renderOverview(overview, support) {
    state.overview = overview;
    var stats = [
      ['Customers', overview.customers, 'tenants provisioned'],
      ['Active customers', overview.activeCustomers, 'with active access'],
      ['Users', overview.users, 'accounts across tenants'],
      ['Open support', overview.openSupport, 'awaiting a reply'],
      ['Active sessions', overview.activeSessions, 'signed in now']
    ];
    var host = $('overview-stats');
    clear(host);
    stats.forEach(function (stat) {
      var card = make('div', 'stat');
      card.appendChild(make('span', 'stat-label', stat[0]));
      card.appendChild(make('strong', 'stat-value', stat[1] === null || stat[1] === undefined ? '—' : stat[1]));
      card.appendChild(make('span', 'stat-hint', stat[2]));
      host.appendChild(card);
    });
    var recent = $('overview-support');
    clear(recent);
    var rows = support.slice(0, 5).map(function (request) {
      return [
        formatDate(request.createdAt),
        request.tenantName,
        request.subject,
        badge(request.priority, toneFor(request.priority)),
        badge(request.status, toneFor(request.status)),
        actionButton('View', function () { openSupport(request); })
      ];
    });
    recent.appendChild(buildTable(['Opened', 'Customer', 'Subject', 'Priority', 'Status', ''], rows, 'No open support requests.'));
  }

  function loadCustomers() {
    beginLoad('panel-customers', 'customers-status');
    api('/admin/api/customers').then(function (payload) {
      endLoad('panel-customers', 'customers-status');
      state.customers = payload && payload.customers ? payload.customers : [];
      renderCustomers();
    }).catch(function (error) {
      endLoad('panel-customers', 'customers-status');
      failLoad('customers-status', error, loadCustomers);
    });
  }

  function renderCustomers() {
    var host = $('customers-table');
    clear(host);
    var query = $('customer-search').value.trim().toLowerCase();
    var rows = state.customers.filter(function (customer) {
      if (!query) return true;
      var haystack = [customer.name, customer.tenantId, customer.plan, customer.status].join(' ').toLowerCase();
      return haystack.indexOf(query) !== -1;
    });
    var summary = $('customers-summary');
    if (state.customers.length === 0) summary.textContent = 'No customers yet.';
    else summary.textContent = rows.length + ' of ' + state.customers.length + ' customers shown.';
    var tableRows = rows.map(function (customer) {
      var name = make('div', 'stack');
      name.appendChild(make('strong', null, customer.name));
      name.appendChild(make('span', 'mono small muted', customer.tenantId));
      var status = make('div', 'row-badges');
      status.appendChild(badge(customer.status, toneFor(customer.status)));
      if (customer.disabled) status.appendChild(badge('disabled', 'danger'));
      return [
        name,
        customer.plan,
        status,
        customer.userCount === null || customer.userCount === undefined ? '—' : customer.userCount,
        formatDay(customer.accessUntil),
        formatDate(customer.lastSeenAt),
        actionButton('Open', function () { openCustomer(customer.tenantId); }, 'primary')
      ];
    });
    host.appendChild(buildTable(['Customer', 'Plan', 'Status', 'Users', 'Access until', 'Last seen', ''], tableRows, query ? 'No customers match this search.' : 'No customers yet. Create the first one.'));
  }

  function createCustomer(event) {
    event.preventDefault();
    var submit = $('new-customer-submit');
    submit.disabled = true;
    api('/admin/api/customers', {
      method: 'POST',
      body: {
        name: $('new-customer-name').value.trim(),
        plan: $('new-customer-plan').value.trim(),
        adminEmail: $('new-customer-email').value.trim(),
        password: $('new-customer-password').value
      }
    }).then(function () {
      toast('Customer created.', 'ok');
      $('new-customer-form').reset();
      $('new-customer-plan').value = 'pro';
      closeDialog('new-customer-dialog');
      loadCustomers();
    }).catch(function (error) {
      toast('Could not create customer: ' + error.message, 'error');
    }).then(function () {
      submit.disabled = false;
    });
  }

  function openCustomer(tenantId) {
    state.customerTenant = tenantId;
    state.customerDetail = null;
    $('customer-dialog-title').textContent = 'Customer';
    $('customer-dialog-subtitle').textContent = tenantId;
    $('customer-detail-body').hidden = true;
    setStatus('customer-detail-status', 'Loading customer…');
    openDialog('customer-dialog');
    api('/admin/api/customers/' + encodeURIComponent(tenantId)).then(function (payload) {
      setStatus('customer-detail-status', '');
      state.customerDetail = payload;
      renderCustomerDetail(payload);
    }).catch(function (error) {
      setStatus('customer-detail-status', 'Could not load this customer: ' + error.message, 'error');
    });
  }

  function refreshCustomerDetail() {
    if (state.customerTenant) openCustomer(state.customerTenant);
  }

  function renderCustomerDetail(payload) {
    var customer = payload.customer;
    var users = payload.users || [];
    var sessions = payload.sessions || [];
    $('customer-dialog-title').textContent = customer.name;
    $('customer-dialog-subtitle').textContent = customer.tenantId + ' · ' + customer.plan + ' · ' + customer.status;
    $('customer-profile-name').value = customer.name || '';
    $('customer-profile-plan').value = customer.plan || '';
    $('customer-profile-status').value = customer.status || 'active';
    $('customer-profile-access').value = toDatetimeLocal(customer.accessUntil);
    $('customer-profile-notes').value = customer.notes || '';
    $('customer-profile-meta').textContent = 'Stripe customer ' + (customer.stripeCustomerId || 'not linked') + ' · subscription ' + (customer.stripeSubscriptionId || 'none') + ' · created ' + formatDate(customer.createdAt) + ' · updated ' + formatDate(customer.updatedAt);
    $('customer-detail-body').hidden = false;

    var userRows = users.map(function (user) {
      var access = make('div', 'row-badges');
      access.appendChild(badge(user.disabled ? 'disabled' : 'active', user.disabled ? 'danger' : 'ok'));
      if (user.platformAdmin) access.appendChild(badge('platform admin', 'info'));
      var role = document.createElement('select');
      role.className = 'select inline';
      role.setAttribute('aria-label', 'Role for ' + user.email);
      ['admin', 'member'].forEach(function (value) {
        var option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        option.selected = user.role === value;
        role.appendChild(option);
      });
      role.addEventListener('change', function () {
        updateUser(user.userId, { role: role.value }, 'Role updated.');
      });
      return [
        user.email,
        role,
        access,
        formatDate(user.lastSeenAt),
        actionButton(user.disabled ? 'Enable' : 'Disable', function () {
          updateUser(user.userId, { disabled: !user.disabled }, user.disabled ? 'User enabled.' : 'User disabled.');
        }, user.disabled ? 'ghost' : 'danger'),
        actionButton('Set password', function () { openPasswordDialog(user); }, 'ghost')
      ];
    });
    var usersHost = $('customer-users');
    clear(usersHost);
    usersHost.appendChild(buildTable(['Email', 'Role', 'Access', 'Last seen', '', ''], userRows, 'No users on this customer yet.'));

    var sessionRows = sessions.map(function (session) {
      var active = !session.revokedAt && new Date(session.expiresAt).getTime() > Date.now();
      return [
        make('span', 'mono small', session.sessionId),
        session.email,
        formatDate(session.createdAt),
        formatDate(session.expiresAt),
        badge(session.revokedAt ? 'revoked' : (active ? 'active' : 'expired'), session.revokedAt ? 'danger' : (active ? 'ok' : 'neutral')),
        session.revokedAt
          ? make('span', 'muted small', 'revoked ' + formatDate(session.revokedAt))
          : actionButton('Revoke', function () { revokeSession(session.sessionId, refreshCustomerDetail); }, 'danger')
      ];
    });
    var sessionsHost = $('customer-sessions');
    clear(sessionsHost);
    sessionsHost.appendChild(buildTable(['Session', 'User', 'Created', 'Expires', 'Status', ''], sessionRows, 'No sessions recorded for this customer.'));
  }

  function saveCustomerProfile(event) {
    event.preventDefault();
    if (!state.customerTenant) return;
    var access = $('customer-profile-access').value;
    var submit = $('customer-profile-submit');
    submit.disabled = true;
    api('/admin/api/customers/' + encodeURIComponent(state.customerTenant), {
      method: 'POST',
      body: {
        name: $('customer-profile-name').value.trim(),
        plan: $('customer-profile-plan').value.trim(),
        status: $('customer-profile-status').value,
        accessUntil: access ? new Date(access).toISOString() : null,
        notes: $('customer-profile-notes').value
      }
    }).then(function (payload) {
      toast('Customer profile saved.', 'ok');
      if (state.customerDetail && payload && payload.customer) {
        state.customerDetail.customer = payload.customer;
        renderCustomerDetail(state.customerDetail);
      }
      loadCustomers();
    }).catch(function (error) {
      toast('Could not save customer: ' + error.message, 'error');
    }).then(function () {
      submit.disabled = false;
    });
  }

  function updateUser(userId, patch, successMessage, after) {
    api('/admin/api/users/' + encodeURIComponent(userId), { method: 'POST', body: patch }).then(function () {
      toast(successMessage || 'User updated.', 'ok');
      if (after) after();
      else refreshCustomerDetail();
    }).catch(function (error) {
      toast('Could not update user: ' + error.message, 'error');
    });
  }

  function openAddUser() {
    if (!state.customerTenant) return;
    $('add-user-form').reset();
    $('add-user-role').value = 'member';
    openDialog('add-user-dialog');
  }

  function createUser(event) {
    event.preventDefault();
    if (!state.customerTenant) return;
    var submit = $('add-user-submit');
    submit.disabled = true;
    api('/admin/api/customers/' + encodeURIComponent(state.customerTenant) + '/users', {
      method: 'POST',
      body: {
        email: $('add-user-email').value.trim(),
        password: $('add-user-password').value,
        role: $('add-user-role').value
      }
    }).then(function () {
      toast('User added.', 'ok');
      closeDialog('add-user-dialog');
      if (state.me && !state.me.platformAdmin) loadUsers();
      else refreshCustomerDetail();
    }).catch(function (error) {
      toast('Could not add user: ' + error.message, 'error');
    }).then(function () {
      submit.disabled = false;
    });
  }

  function openPasswordDialog(user) {
    state.passwordUserId = user.userId;
    $('password-user-label').textContent = user.email;
    $('password-value').value = '';
    openDialog('password-dialog');
  }

  function savePassword(event) {
    event.preventDefault();
    if (!state.passwordUserId) return;
    var submit = $('password-submit');
    submit.disabled = true;
    api('/admin/api/users/' + encodeURIComponent(state.passwordUserId), {
      method: 'POST',
      body: { password: $('password-value').value }
    }).then(function () {
      toast('Password updated.', 'ok');
      closeDialog('password-dialog');
    }).catch(function (error) {
      toast('Could not set password: ' + error.message, 'error');
    }).then(function () {
      submit.disabled = false;
    });
  }

  function loadSupport() {
    beginLoad('panel-support', 'support-status');
    api('/admin/api/support?status=' + encodeURIComponent(state.supportFilter)).then(function (payload) {
      endLoad('panel-support', 'support-status');
      state.support = payload && payload.requests ? payload.requests : [];
      renderSupport();
    }).catch(function (error) {
      endLoad('panel-support', 'support-status');
      failLoad('support-status', error, loadSupport);
    });
  }

  function renderSupport() {
    var host = $('support-table');
    clear(host);
    $('support-summary').textContent = state.support.length + ' requests.';
    var rows = state.support.map(function (request) {
      return [
        formatDate(request.createdAt),
        request.tenantName,
        request.email,
        request.subject,
        badge(request.priority, toneFor(request.priority)),
        badge(request.status, toneFor(request.status)),
        actionButton('View', function () { openSupport(request); }, 'primary')
      ];
    });
    host.appendChild(buildTable(['Opened', 'Customer', 'From', 'Subject', 'Priority', 'Status', ''], rows, 'No support requests for this filter.'));
  }

  function openSupport(request) {
    state.supportDetail = request;
    $('support-detail-subject').textContent = request.subject;
    $('support-detail-meta').textContent = request.tenantName + ' · ' + request.email;
    $('support-detail-created').textContent = 'Opened ' + formatDate(request.createdAt) + ' · updated ' + formatDate(request.updatedAt);
    $('support-detail-page').textContent = request.pageUrl || 'No page recorded';
    $('support-detail-message').textContent = request.message;
    $('support-detail-status').value = request.status;
    $('support-detail-priority').value = request.priority;
    $('support-detail-note').value = request.adminNote || '';
    openDialog('support-dialog');
  }

  function saveSupport(event) {
    event.preventDefault();
    if (!state.supportDetail) return;
    var request = state.supportDetail;
    var submit = $('support-submit');
    submit.disabled = true;
    api('/admin/api/support/' + encodeURIComponent(request.requestId), {
      method: 'POST',
      body: {
        status: $('support-detail-status').value,
        priority: $('support-detail-priority').value,
        adminNote: $('support-detail-note').value
      }
    }).then(function (payload) {
      toast('Support request saved.', 'ok');
      state.supportDetail = payload && payload.request ? payload.request : request;
      closeDialog('support-dialog');
      loadSupport();
    }).catch(function (error) {
      toast('Could not save support request: ' + error.message, 'error');
    }).then(function () {
      submit.disabled = false;
    });
  }

  function loadSessions() {
    beginLoad('panel-sessions', 'sessions-status');
    api('/admin/api/sessions?tenantId=' + encodeURIComponent(state.sessionTenant)).then(function (payload) {
      endLoad('panel-sessions', 'sessions-status');
      state.sessions = payload && payload.sessions ? payload.sessions : [];
      renderSessions();
    }).catch(function (error) {
      endLoad('panel-sessions', 'sessions-status');
      failLoad('sessions-status', error, loadSessions);
    });
  }

  function renderSessions() {
    var host = $('sessions-table');
    clear(host);
    $('sessions-summary').textContent = state.sessions.length + ' sessions.';
    var rows = state.sessions.map(function (session) {
      var active = !session.revokedAt && new Date(session.expiresAt).getTime() > Date.now();
      return [
        make('span', 'mono small', session.sessionId),
        session.email,
        session.tenantName,
        formatDate(session.createdAt),
        formatDate(session.expiresAt),
        badge(session.revokedAt ? 'revoked' : (active ? 'active' : 'expired'), session.revokedAt ? 'danger' : (active ? 'ok' : 'neutral')),
        session.revokedAt ? make('span', 'muted small', 'revoked') : actionButton('Revoke', function () { revokeSession(session.sessionId); }, 'danger')
      ];
    });
    host.appendChild(buildTable(['Session', 'User', 'Tenant', 'Created', 'Expires', 'Status', ''], rows, 'No sessions match this filter.'));
  }

  function revokeSession(sessionId, after) {
    api('/admin/api/sessions/' + encodeURIComponent(sessionId) + '/revoke', { method: 'POST' }).then(function () {
      toast('Session revoked.', 'ok');
      if (after) after();
      else loadSessions();
    }).catch(function (error) {
      toast('Could not revoke session: ' + error.message, 'error');
    });
  }

  function revokeAllSessions() {
    if (!window.confirm('Revoke every live login session? Users must sign in again.')) return;
    api('/admin/api/sessions/revoke-all', { method: 'POST' }).then(function (payload) {
      toast('Revoked ' + String((payload && payload.revoked) || 0) + ' sessions.', 'ok');
      loadSessions();
    }).catch(function (error) {
      toast('Could not revoke sessions: ' + error.message, 'error');
    });
  }

  function purgeDeadSessions() {
    if (!window.confirm('Permanently delete every revoked session row?')) return;
    api('/admin/api/sessions/purge-revoked', { method: 'POST' }).then(function (payload) {
      toast('Removed ' + String((payload && payload.removed) || 0) + ' dead sessions.', 'ok');
      loadSessions();
      loadOverview();
    }).catch(function (error) {
      toast('Could not remove dead sessions: ' + error.message, 'error');
    });
  }

  function deleteCustomer() {
    var tenantId = state.customerTenant;
    if (!tenantId) return;
    if (!window.confirm('Delete this customer? Its accounts, login sessions, and support requests are removed.')) return;
    api('/admin/api/customers/' + encodeURIComponent(tenantId) + '/delete', { method: 'POST' }).then(function () {
      toast('Customer deleted.', 'ok');
      closeDialog('customer-dialog');
      loadCustomers();
    }).catch(function (error) {
      toast('Could not delete customer: ' + error.message, 'error');
    });
  }

  function loadSales() {
    beginLoad('panel-sales', 'sales-status');
    api('/admin/api/sales').then(function (payload) {
      endLoad('panel-sales', 'sales-status');
      renderSales(payload || {});
    }).catch(function (error) {
      endLoad('panel-sales', 'sales-status');
      failLoad('sales-status', error, loadSales);
    });
  }

  function renderSales(payload) {
    state.sales = payload;
    var warning = $('sales-warning');
    clear(warning);
    warning.hidden = payload.configured === true;
    if (payload.configured !== true) {
      warning.appendChild(make('strong', null, 'Stripe is not configured.'));
      warning.appendChild(make('p', null, 'Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and STRIPE_PRICE_ID in the deployment environment, then restart the server so subscription webhooks reach the ledger.'));
      var link = make('a', 'link', 'Open the Stripe dashboard');
      link.href = 'https://dashboard.stripe.com/';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      warning.appendChild(link);
    }
    var events = payload.events || [];
    $('sales-summary').textContent = events.length + ' events.';
    var rows = events.map(function (event) {
      var references = make('div', 'stack');
      references.appendChild(make('span', 'mono small muted', 'customer ' + (event.customerId || '—')));
      references.appendChild(make('span', 'mono small muted', 'subscription ' + (event.subscriptionId || '—')));
      references.appendChild(make('span', 'mono small muted', event.eventId));
      return [
        formatDate(event.createdAt),
        event.eventType,
        event.tenantId || '—',
        formatMoney(event.amountTotal, event.currency),
        event.status ? badge(event.status, toneFor(event.status)) : '—',
        references
      ];
    });
    var host = $('sales-events');
    clear(host);
    host.appendChild(buildTable(['Created', 'Event', 'Tenant', 'Amount', 'Status', 'References'], rows, 'No sales events recorded yet.'));
  }

  function signOut() {
    fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }).then(function () {
      window.location.assign('/login');
    }, function () {
      window.location.assign('/login');
    });
  }

  function init() {
    TABS.forEach(function (tab) {
      var button = $('tab-' + tab);
      button.addEventListener('click', function () { activateTab(tab); });
      button.addEventListener('keydown', function (event) {
        var tabs = visibleTabs();
        var index = tabs.indexOf(tab);
        if (index === -1) return;
        var next = -1;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        if (next !== -1) {
          event.preventDefault();
          $('tab-' + tabs[next]).focus();
          activateTab(tabs[next]);
        }
      });
    });
    $('signout').addEventListener('click', signOut);
    $('overview-refresh').addEventListener('click', loadOverview);
    $('overview-support-more').addEventListener('click', function () { activateTab('support'); });
    $('customer-search').addEventListener('input', renderCustomers);
    $('customers-refresh').addEventListener('click', loadCustomers);
    $('new-customer-open').addEventListener('click', function () { openDialog('new-customer-dialog'); });
    $('new-customer-form').addEventListener('submit', createCustomer);
    $('customer-profile-form').addEventListener('submit', saveCustomerProfile);
    $('add-user-open').addEventListener('click', openAddUser);
    $('users-add').addEventListener('click', openAddUser);
    $('users-refresh').addEventListener('click', loadUsers);
    $('add-user-form').addEventListener('submit', createUser);
    $('password-form').addEventListener('submit', savePassword);
    $('support-filter').addEventListener('change', function (event) {
      state.supportFilter = event.target.value;
      loadSupport();
    });
    $('support-refresh').addEventListener('click', loadSupport);
    $('support-form').addEventListener('submit', saveSupport);
    $('sessions-search').addEventListener('submit', function (event) {
      event.preventDefault();
      state.sessionTenant = $('session-tenant').value.trim();
      loadSessions();
    });
    $('sessions-refresh').addEventListener('click', function () {
      state.sessionTenant = $('session-tenant').value.trim();
      loadSessions();
    });
    $('sessions-revoke-all').addEventListener('click', revokeAllSessions);
    $('sessions-purge').addEventListener('click', purgeDeadSessions);
    $('customer-delete').addEventListener('click', deleteCustomer);
    $('sales-refresh').addEventListener('click', loadSales);
    Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (button) {
      button.addEventListener('click', function () { closeDialog(button.getAttribute('data-close')); });
    });
    loadMe().then(function () {
      activateTab('overview');
    }).catch(function (error) {
      failLoad('overview-status', error, function () { window.location.reload(); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
</script>
</body>
</html>`
}
