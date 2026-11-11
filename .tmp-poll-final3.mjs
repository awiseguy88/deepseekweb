const sha = '1c1d24437b600a3b3bc59aa700c8947351490a15'

async function state() {
  const response = await fetch(`https://api.github.com/repos/awiseguy88/deepseekweb/commits/${sha}/status`, { headers: { 'user-agent': 'dsh' } })
  const body = await response.json()
  return String(body.state)
}

for (let attempt = 0; attempt < 30; attempt += 1) {
  const current = await state()
  console.log(`${new Date().toISOString()} deployment=${current}`)
  if (current === 'success' || current === 'failure' || current === 'error') break
  await new Promise(resolve => setTimeout(resolve, 30_000))
}
