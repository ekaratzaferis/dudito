#!/usr/bin/env node

// Fills a Google Photos album with X random photos from selections.json.
// Clear the album manually in the Google Photos app before each run.
//
// Usage:
//   node gphoto-bucket.js <count>
//
// First-time setup:
//   1. Go to https://console.cloud.google.com → create a project
//   2. APIs & Services → Enable "Photos Library API"
//   3. APIs & Services → Credentials → Create OAuth 2.0 Client ID → Desktop app
//   4. Copy client_id and client_secret into gphoto-config.json:
//        { "clientId": "...", "clientSecret": "..." }
//   5. Run this script — it will open an auth URL, paste the code back when prompted

import fs from 'fs'
import path from 'path'
import http from 'http'
import https from 'https'
import { fileURLToPath } from 'url'
import { OAuth2Client } from 'google-auth-library'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const CONFIG_PATH   = path.join(__dirname, 'gphoto-config.json')
const TOKEN_PATH    = path.join(__dirname, '.gphoto-token.json')
const SELECTIONS_PATH = path.join(__dirname, '../../portfolio/selections.json')
const TEMP_DIR      = '/tmp/dudito-bucket'

const GPHOTO_BASE   = 'https://photoslibrary.googleapis.com/v1'
const SCOPE         = 'https://www.googleapis.com/auth/photoslibrary.appendonly'

const ACCOUNT    = '0aa2ddec4f3d4206b464662e22cc690f'
const LR_BASE    = `https://lightroom.adobe.com/v2/spaces/${ACCOUNT}`
const LR_HEADERS = { 'X-Api-Key': 'photoshop_ux' }

// ── Args ──────────────────────────────────────────

const count = parseInt(process.argv[2], 10)
if (!count || count < 1) {
  console.error('Usage: node gphoto-bucket.js <count>')
  process.exit(1)
}

// ── Config ────────────────────────────────────────

if (!fs.existsSync(CONFIG_PATH)) {
  console.error(`Missing gphoto-config.json. Create it at:\n  ${CONFIG_PATH}\nwith:\n  { "clientId": "...", "clientSecret": "..." }`)
  process.exit(1)
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))

if (!config.clientId || config.clientId === 'YOUR_CLIENT_ID') {
  console.error('Fill in clientId and clientSecret in gphoto-config.json first.')
  process.exit(1)
}

// ── Auth ──────────────────────────────────────────

const REDIRECT_PORT = 4242
const REDIRECT_URI  = `http://localhost:${REDIRECT_PORT}`

const oauth2 = new OAuth2Client(config.clientId, config.clientSecret, REDIRECT_URI)

async function getAccessToken() {
  if (fs.existsSync(TOKEN_PATH)) {
    const saved = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'))
    oauth2.setCredentials(saved)
    // Refresh if expired (or within 60s of expiry)
    if (saved.expiry_date && saved.expiry_date - Date.now() < 60_000) {
      const { credentials } = await oauth2.refreshAccessToken()
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(credentials, null, 2))
      oauth2.setCredentials(credentials)
    }
    return oauth2.credentials.access_token
  }

  // Spin up a temporary local server to catch the OAuth redirect
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI)
      const code = url.searchParams.get('code')
      const err  = url.searchParams.get('error')
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body><h2>Auth complete — you can close this tab.</h2></body></html>')
      server.close()
      if (err) reject(new Error(`OAuth error: ${err}`))
      else resolve(code)
    })
    server.listen(REDIRECT_PORT, () => {
      const authUrl = oauth2.generateAuthUrl({ scope: SCOPE, access_type: 'offline', prompt: 'consent' })
      console.log('\nOpening browser for Google auth...')
      import('child_process').then(({ execSync }) => execSync(`open "${authUrl}"`))
    })
  })

  const { tokens } = await oauth2.getToken(code)
  oauth2.setCredentials(tokens)
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2))
  return tokens.access_token
}

// ── Google Photos API ─────────────────────────────

async function gphotos(method, endpoint, body) {
  const url = GPHOTO_BASE + endpoint
  const res = await oauth2.request({
    url,
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { data: JSON.stringify(body) } : {})
  })
  return res.data
}

async function uploadBytes(filePath) {
  const fileData = fs.readFileSync(filePath)
  const res = await oauth2.request({
    url: 'https://photoslibrary.googleapis.com/v1/uploads',
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Goog-Upload-Protocol': 'raw',
    },
    data: fileData,
    responseType: 'text'
  })
  return typeof res.data === 'string' ? res.data.trim() : res.data
}

// ── Lightroom Helpers ─────────────────────────────

async function fetchLR(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: LR_HEADERS }, (res) => {
      let body = ''
      res.on('data', chunk => body += chunk)
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`LR API ${res.statusCode}: ${url}`))
        const clean = body.replace(/^while\s*\(1\)\s*\{\}\s*/, '').trim()
        resolve(JSON.parse(clean))
      })
    })
    req.on('error', reject)
  })
}

function rendition(links, size, base = '') {
  const href = links?.[`/rels/rendition_type/${size}`]?.href || ''
  if (!href) return ''
  if (href.startsWith('http')) return href
  return base + href
}

function fixBase(raw) {
  return (raw || '').replace('https://photos.adobe.io/v2/', 'https://lightroom.adobe.com/v2c/')
}

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const get = (u) => {
      https.get(u, { headers: LR_HEADERS }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close()
          fs.unlinkSync(dest)
          return get(res.headers.location)
        }
        if (res.statusCode !== 200) return reject(new Error(`Download failed ${res.statusCode}: ${u}`))
        res.pipe(file)
        file.on('finish', () => file.close(resolve))
      }).on('error', reject)
    }
    get(url)
  })
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// ── Main ──────────────────────────────────────────

await getAccessToken()
console.log('Authenticated.')

// Ensure bucket album exists
let albumId = config.albumId
if (!albumId) {
  process.stdout.write('Creating "Dudito Bucket" album...')
  const album = await gphotos('POST', '/albums', { album: { title: 'Dudito Bucket' } })
  albumId = album.id
  config.albumId = albumId
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
  console.log(` created (${albumId})`)
} else {
  console.log(`Using album: ${albumId}`)
}

// Pick random photos from selections.json
const selections = JSON.parse(fs.readFileSync(SELECTIONS_PATH, 'utf8'))
const all = []
for (const [lrAlbumId, { photos }] of Object.entries(selections)) {
  for (const photoId of photos) all.push({ lrAlbumId, photoId })
}

if (count > all.length) {
  console.error(`Requested ${count} but only ${all.length} photos in selections.`)
  process.exit(1)
}

shuffle(all)
const picked = all.slice(0, count)

// Group by LR album to minimise API calls
const byAlbum = {}
for (const { lrAlbumId, photoId } of picked) {
  if (!byAlbum[lrAlbumId]) byAlbum[lrAlbumId] = []
  byAlbum[lrAlbumId].push(photoId)
}

// Download from Lightroom
fs.rmSync(TEMP_DIR, { recursive: true, force: true })
fs.mkdirSync(TEMP_DIR, { recursive: true })

const localFiles = []
let downloaded = 0

for (const [lrAlbumId, photoIds] of Object.entries(byAlbum)) {
  const url =
    `${LR_BASE}/albums/${lrAlbumId}/assets` +
    `?embed=asset%3Bself&order_after=-&exclude=incomplete&subtype=image%3Bvideo%3Blayout_segment`

  process.stdout.write(`Fetching LR album ${lrAlbumId}...`)
  const data = await fetchLR(url)
  const base = fixBase(data.base)
  const wantSet = new Set(photoIds)
  console.log(` ${data.resources?.length ?? 0} assets`)

  for (const resource of (data.resources || [])) {
    const assetId = resource.asset?.id || resource.id
    if (!wantSet.has(assetId)) continue

    const links = resource.asset?.links || {}
    const imgUrl = rendition(links, '2048', base) || rendition(links, '1280', base)
    if (!imgUrl) { console.warn(`  No URL for ${assetId}, skipping.`); continue }

    const dest = path.join(TEMP_DIR, `${assetId}.jpg`)
    process.stdout.write(`  Downloading ${assetId}...`)
    await downloadFile(imgUrl, dest)
    localFiles.push(dest)
    downloaded++
    console.log(` done (${downloaded}/${count})`)
  }
}

// Upload to Google Photos
console.log(`\nUploading ${localFiles.length} photo(s) to Google Photos...`)
const uploadTokens = []
for (const [i, filePath] of localFiles.entries()) {
  process.stdout.write(`  Uploading ${path.basename(filePath)}...`)
  const uploadToken = await uploadBytes(filePath)
  uploadTokens.push(uploadToken)
  console.log(` done (${i + 1}/${localFiles.length})`)
}

// Create media items in batches of 50
for (let i = 0; i < uploadTokens.length; i += 50) {
  const batch = uploadTokens.slice(i, i + 50)
  const newMediaItems = batch.map(ut => ({ simpleMediaItem: { uploadToken: ut } }))
  await gphotos('POST', '/mediaItems:batchCreate', { albumId, newMediaItems })
}

console.log(`\nAdded ${uploadTokens.length} photo(s) to album.`)

// Clean up
fs.rmSync(TEMP_DIR, { recursive: true, force: true })
console.log('Done.')
