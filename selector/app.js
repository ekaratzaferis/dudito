const $ = id => document.getElementById(id)

let state = {
  account: null,
  albumId: null,
  slug: null,
  photos: [],         // raw resources from API
  base: '',           // base URL prefix for relative rendition hrefs
  selected: new Set(),
}

let existingSelections = {}

// ── Init ──────────────────────────────────────────

async function init() {
  try {
    existingSelections = await fetch('/api/selections').then(r => r.json())
  } catch {}

  $('load-btn').addEventListener('click', loadAlbum)
  $('url-input').addEventListener('keydown', e => { if (e.key === 'Enter') loadAlbum() })
  $('save-btn').addEventListener('click', save)
}

// ── URL Parsing ───────────────────────────────────

function parseGalleryUrl(url) {
  // https://lightroom.adobe.com/gallery/ACCOUNT/albums/ALBUM/assets
  const match = url.trim().match(/\/gallery\/([^/?#]+)\/albums\/([^/?#]+)/)
  if (!match) throw new Error('Unrecognized URL. Expected: lightroom.adobe.com/gallery/ACCOUNT/albums/ALBUM/assets')
  return { account: match[1], album: match[2] }
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// ── Photo ID / Thumbnail ──────────────────────────

function getPhotoId(resource) {
  return resource.asset?.id || resource.id
}

// Rendition URLs live in asset.links and are relative — prepend base from response
function fullUrl(base, href) {
  if (!href) return null
  if (href.startsWith('http')) return href
  return base + href
}

function getThumbnail(resource, base) {
  const links = resource.asset?.links || {}
  const href =
    links['/rels/rendition_type/thumbnail2x']?.href ||
    links['/rels/rendition_type/640']?.href ||
    links['/rels/rendition_type/1280']?.href
  const url = fullUrl(base, href)
  if (!url) return null
  return `/api/img?url=${encodeURIComponent(url)}`
}

// ── Load Album ────────────────────────────────────

async function loadAlbum() {
  const rawUrl = $('url-input').value.trim()
  if (!rawUrl) return

  let account, album
  try {
    ;({ account, album } = parseGalleryUrl(rawUrl))
  } catch (err) {
    showToast(err.message)
    return
  }

  state.account = account
  state.albumId = album

  $('grid').innerHTML = '<div class="loading">Loading album…</div>'
  $('empty-state').classList.add('hidden')
  $('album-info').classList.add('hidden')
  $('save-bar').classList.add('hidden')
  $('load-btn').disabled = true

  try {
    // Fetch album name from resources
    const resourcesData = await fetch(`/api/lr/resources?account=${account}`).then(r => r.json())
    const albumResource = (resourcesData.resources || []).find(r => r.id === album)
    const albumName = albumResource?.payload?.name || album
    state.slug = slugify(albumName)

    $('album-name').textContent = albumName
    $('album-slug').textContent = `slug: ${state.slug}`
    $('album-info').classList.remove('hidden')

    // Pre-load any existing selection for this album
    state.selected = new Set(existingSelections[album]?.photos || [])

    // Fetch photos
    const assetsData = await fetch(`/api/lr/assets?account=${account}&album=${album}`).then(r => r.json())
    state.photos = assetsData.resources || []
    state.base = (assetsData.base || '').replace('https://photos.adobe.io/v2/', 'https://lightroom.adobe.com/v2c/')

    renderGrid()
    updateCount()
    $('save-bar').classList.remove('hidden')
  } catch (err) {
    $('grid').innerHTML = `<div class="loading">Error: ${err.message}</div>`
  } finally {
    $('load-btn').disabled = false
  }
}

// ── Grid Rendering ────────────────────────────────

function renderGrid() {
  const grid = $('grid')
  grid.innerHTML = ''

  if (!state.photos.length) {
    grid.innerHTML = '<div class="loading">No photos found in this album.</div>'
    return
  }

  for (const resource of state.photos) {
    const id = getPhotoId(resource)
    const thumb = getThumbnail(resource, state.base)
    if (!thumb) continue

    const card = document.createElement('div')
    card.className = 'photo-card' + (state.selected.has(id) ? ' selected' : '')
    card.dataset.id = id
    card.innerHTML = `
      <img src="${thumb}" loading="lazy" alt="" draggable="false" />
      <div class="check">✓</div>
    `
    card.addEventListener('click', () => togglePhoto(id, card))
    grid.appendChild(card)
  }
}

function togglePhoto(id, card) {
  if (state.selected.has(id)) {
    state.selected.delete(id)
    card.classList.remove('selected')
  } else {
    state.selected.add(id)
    card.classList.add('selected')
  }
  updateCount()
}

function updateCount() {
  const n = state.selected.size
  $('selection-count').textContent = `${n} selected`
  const name = $('album-name').textContent
  $('save-info').textContent = `${n} photo${n !== 1 ? 's' : ''} selected · "${name}"`
}

// ── Save ──────────────────────────────────────────

async function save() {
  if (!state.albumId || !state.slug) return

  $('save-btn').disabled = true
  try {
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        albumId: state.albumId,
        slug: state.slug,
        photos: [...state.selected],
      }),
    })
    if (!res.ok) throw new Error('Server error')
    existingSelections[state.albumId] = { slug: state.slug, photos: [...state.selected] }
    showToast('Saved to selections.json')
  } catch (err) {
    showToast('Error: ' + err.message)
  } finally {
    $('save-btn').disabled = false
  }
}

// ── Toast ─────────────────────────────────────────

function showToast(msg) {
  const toast = $('toast')
  toast.textContent = msg
  toast.classList.add('show')
  setTimeout(() => toast.classList.remove('show'), 2800)
}

// ── Boot ──────────────────────────────────────────

init()
