const base = 'https://deepseekweb-production.up.railway.app'
const email = 'tenant-check-1794410530757@wiseai.example'
const password = 'tenant-check-password-1'

async function call(cookie, method, args) {
  const response = await fetch(`${base}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: `probe-${method}`, method, payload: { args } }),
  })
  return { status: response.status, text: await response.text() }
}

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
    const sessionId = `session-${crypto.randomUUID()}`
    const create = await call(cookie, 'session/create', { request: { cwd: '/tmp/tenant-space-a', sessionId } })
    const created = create.text.includes('"ok":true')
    const dir = await call(cookie, 'directoryPicker/list', { request: {} })
    console.log(`${new Date().toISOString()} create=${create.status} ok=${created} dirPickerDenied=${dir.text.includes('remote-access/denied')}`)
    if (created) {
      const list = await call(cookie, 'session/list', { _request: {} })
      console.log('list:', list.text.slice(0, 240))
    }
    return created
  } catch (error) {
    console.log(`${new Date().toISOString()} ERROR ${error.message}`)
    return false
  }
}

for (let attempt = 0; attempt < 24; attempt += 1) {
  if (await check()) break
  await new Promise(resolve => setTimeout(resolve, 45_000))
}
