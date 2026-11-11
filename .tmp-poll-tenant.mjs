const base = 'https://deepseekweb-production.up.railway.app'
const email = 'tenant-check-1794410530757@wiseai.example'
const password = 'tenant-check-password-1'

async function check() {
  try {
    const login = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const cookie = login.headers.get('set-cookie')?.split(';', 1)[0]
    if (cookie === undefined) {
      console.log(`${new Date().toISOString()} login=${login.status} no cookie`)
      return false
    }
    const response = await fetch(base + '/api/session/list', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: 'deploy-probe', method: 'session/list', payload: { args: { _request: {} } } }),
    })
    const text = await response.text()
    const allowed = text.includes('"ok":true')
    console.log(`${new Date().toISOString()} session/list=${response.status} allowed=${allowed} ${text.slice(0, 160)}`)
    return allowed
  } catch (error) {
    console.log(`${new Date().toISOString()} ERROR ${error.message}`)
    return false
  }
}

for (let attempt = 0; attempt < 24; attempt += 1) {
  if (await check()) break
  await new Promise(resolve => setTimeout(resolve, 45_000))
}
