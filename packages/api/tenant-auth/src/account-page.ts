/**
 * Server-rendered account page for a signed-in tenant account: profile,
 * password, email, team entry point, and billing summary. The page is served
 * by the tenant auth plugin at `/account`; all data comes from `/account/api/*`.
 * @module @deepseek-ai/dsh-api-tenant-auth/account-page
 */

/**
 * Render the complete account page document.
 * @returns one self-contained HTML document with inline styles and script.
 */
export function renderAccountPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Account — WiseAI</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0d0e0d;color:#e8e6e1;font:15px/1.5 system-ui,sans-serif}
main{max-width:56rem;margin:0 auto;padding:2.5rem 1.25rem 4rem}
header{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:2rem}
h1{font-size:1.6rem;margin:0}h2{font-size:1.05rem;margin:0 0 .75rem;color:#f3a26f}
section{background:#151613;border:1px solid #2c2e28;border-radius:12px;padding:1.25rem;margin-bottom:1rem}
label{display:block;font-size:.82rem;color:#a8a69f;margin:.6rem 0 .25rem}
input{width:100%;padding:.65rem .75rem;border-radius:8px;border:1px solid #3d403a;background:#0f100e;color:#e8e6e1;font:inherit}
button{font:inherit;padding:.6rem 1rem;border-radius:8px;border:1px solid #4a4d45;background:#22241f;color:#e8e6e1;cursor:pointer}
button.primary{background:#eb6c2c;border-color:#eb6c2c;color:#180f0a;font-weight:600}
button.ghost{background:transparent}
.row{display:flex;gap:.75rem;flex-wrap:wrap;align-items:center}
.muted{color:#8f8d86;font-size:.9rem}
.status{min-height:1.4em;font-size:.9rem}.status.ok{color:#9fd07a}.status.bad{color:#ff9f8f}
table{width:100%;border-collapse:collapse}td{padding:.4rem 0;border-bottom:1px solid #24261f}td:last-child{text-align:right;color:#d8d5cd}
</style></head><body><main>
<header><h1>Account</h1><div class="row"><button id="account" class="ghost">Admin</button><button id="signout" class="ghost">Sign out</button></div></header>
<section><h2>Profile</h2><table>
<tr><td>Email</td><td id="email">—</td></tr>
<tr><td>Role</td><td id="role">—</td></tr>
<tr><td>Workspace</td><td id="tenant">—</td></tr></table>
<label for="emailInput">New email</label><input id="emailInput" type="email" autocomplete="email">
<label for="emailPassword">Current password</label><input id="emailPassword" type="password" autocomplete="current-password">
<div class="row" style="margin-top:.75rem"><button id="saveEmail" class="primary">Update email</button><span id="emailStatus" class="status"></span></div>
</section>
<section><h2>Password</h2>
<label for="currentPassword">Current password</label><input id="currentPassword" type="password" autocomplete="current-password">
<label for="newPassword">New password (at least 12 characters)</label><input id="newPassword" type="password" autocomplete="new-password">
<div class="row" style="margin-top:.75rem"><button id="savePassword" class="primary">Change password</button><span id="passwordStatus" class="status"></span></div>
</section>
<section><h2>Team</h2><p class="muted" id="teamText">Manage who can access this workspace from the admin console.</p>
<div class="row" style="margin-top:.75rem"><button id="team" class="primary">Manage team</button></div></section>
<section><h2>Billing</h2><table>
<tr><td>Plan</td><td id="plan">—</td></tr>
<tr><td>Status</td><td id="status">—</td></tr>
<tr><td>Access until</td><td id="accessUntil">—</td></tr></table>
<p class="muted">Invoices and payment methods are managed in the admin console.</p>
<div class="row" style="margin-top:.75rem"><button id="invoices" class="primary">View invoices</button></div></section>
</main><script>
const $=id=>document.getElementById(id);
const server=t=>t===null?'—':new Date(t).toLocaleDateString();
async function api(path,body){const r=await fetch('/account/api/'+path,{method:body===undefined?'GET':'POST',credentials:'include',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(r.status===401){location.assign('/login?next=/account');throw new Error('unauthenticated')}const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||('http '+r.status));return data}
async function load(){const me=await api('me');$('email').textContent=me.user.email;$('emailInput').value=me.user.email;$('role').textContent=me.user.platformAdmin?'Platform operator':me.user.role;$('tenant').textContent=me.tenant.name||'—';$('plan').textContent=me.tenant.plan;$('status').textContent=me.tenant.status;$('accessUntil').textContent=server(me.tenant.accessUntil);const admin=me.user.platformAdmin||me.user.role==='admin';$('teamText').textContent=admin?'Manage members, roles, and workspace access in the admin console.':'Only a workspace administrator can manage team access.';$('team').style.display=admin?'':'none';$('invoices').style.display=admin?'':'none';$('account').style.display=admin?'':'none'}
function say(el,text,ok){const n=$(el);n.textContent=text;n.className='status '+(ok?'ok':'bad')}
$('saveEmail').addEventListener('click',async()=>{try{const r=await api('email',{password:$('emailPassword').value,email:$('emailInput').value});$('email').textContent=r.email;say('emailStatus','Email updated',true)}catch(e){say('emailStatus',e.message,false)}});
$('savePassword').addEventListener('click',async()=>{try{await api('password',{currentPassword:$('currentPassword').value,newPassword:$('newPassword').value});$('currentPassword').value='';$('newPassword').value='';say('passwordStatus','Password changed',true)}catch(e){say('passwordStatus',e.message,false)}});
$('team').addEventListener('click',()=>{location.assign('/admin')});
$('invoices').addEventListener('click',()=>{location.assign('/admin')});
$('account').addEventListener('click',()=>{location.assign('/admin')});
$('signout').addEventListener('click',async()=>{await fetch('/auth/logout',{method:'POST',credentials:'include'});location.assign('/login')});
load().catch(e=>say('emailStatus',e.message,false));
</script></body></html>`
}
