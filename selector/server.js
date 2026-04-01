import express from 'express'
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SELECTIONS_PATH = resolve(__dirname, '../portfolio/selections.json')

const app = express()
app.use(express.json())
app.use(express.static(__dirname))

function parseLR(text) {
  return JSON.parse(text.replace(/^while\s*\(1\)\s*\{\}\s*/, '').trim())
}

app.get('/api/lr/resources', async (req, res) => {
  const { account } = req.query
  if (!account) return res.status(400).json({ error: 'account required' })
  const url = `https://lightroom.adobe.com/v2/spaces/${account}/resources`
  const r = await fetch(url)
  const text = await r.text()
  res.json(parseLR(text))
})

app.get('/api/lr/assets', async (req, res) => {
  const { account, album } = req.query
  if (!account || !album) return res.status(400).json({ error: 'account and album required' })

  let allResources = []
  let base = ''
  let url = `https://lightroom.adobe.com/v2/spaces/${account}/albums/${album}/assets?embed=asset%3Bself&order_after=-&exclude=incomplete&subtype=image%3Bvideo%3Blayout_segment`

  while (url) {
    const r = await fetch(url)
    const data = parseLR(await r.text())
    if (!base) base = data.base || ''
    allResources = allResources.concat(data.resources || [])
    const nextHref = data.links?.next?.href
    url = nextHref ? (nextHref.startsWith('http') ? nextHref : base + nextHref) : null
  }

  res.json({ resources: allResources, base })
})

app.get('/api/img', async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).end()
  try {
    const r = await fetch(url, { headers: { 'X-Api-Key': 'photoshop_ux' } })
    if (!r.ok) return res.status(r.status).end()
    const ct = r.headers.get('content-type') || 'image/jpeg'
    res.setHeader('Content-Type', ct)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    const buf = await r.arrayBuffer()
    res.send(Buffer.from(buf))
  } catch {
    res.status(500).end()
  }
})

app.get('/api/selections', (req, res) => {
  try {
    const content = readFileSync(SELECTIONS_PATH, 'utf8').trim()
    res.json(content ? JSON.parse(content) : {})
  } catch {
    res.json({})
  }
})

app.post('/api/save', (req, res) => {
  const { albumId, slug, photos } = req.body
  if (!albumId || !slug || !Array.isArray(photos)) {
    return res.status(400).json({ error: 'albumId, slug, photos required' })
  }
  let selections = {}
  try {
    const content = readFileSync(SELECTIONS_PATH, 'utf8').trim()
    if (content) selections = JSON.parse(content)
  } catch {}
  selections[albumId] = { slug, photos }
  writeFileSync(SELECTIONS_PATH, JSON.stringify(selections, null, 2))
  res.json({ ok: true })
})

app.listen(3000, () => console.log('Selector running at http://localhost:3000'))
