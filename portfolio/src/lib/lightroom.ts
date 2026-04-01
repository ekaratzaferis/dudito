import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const ACCOUNT = '0aa2ddec4f3d4206b464662e22cc690f'
const BASE = `https://lightroom.adobe.com/v2/spaces/${ACCOUNT}`
const LR_HEADERS = { 'X-Api-Key': 'photoshop_ux' }

async function fetchLR(url: string) {
  const res = await fetch(url, { headers: LR_HEADERS })
  if (!res.ok) throw new Error(`Lightroom API ${res.status}: ${url}`)
  const text = await res.text()
  return JSON.parse(text.replace(/^while\s*\(1\)\s*\{\}\s*/, '').trim())
}

// ── Types ─────────────────────────────────────────

export interface AlbumMeta {
  id: string
  name: string
  coverUrl: string
  year: string
}

export interface PhotoAsset {
  id: string
  thumbnailUrl: string
  url2048: string
  captureDate: string
  xmp: {
    tiff?: Record<string, any>
    exif?: Record<string, any>
    aux?: Record<string, any>
    iptcCore?: Record<string, any>
  }
  importSource?: {
    fileName?: string
    fileSize?: number
    originalWidth?: number
    originalHeight?: number
    contentType?: string
  }
  location?: {
    latitude?: number
    longitude?: number
    city?: string
    state?: string
    country?: string
  }
}

// ── Helpers ───────────────────────────────────────

function resolveHref(base: string, href: string): string {
  if (!href) return ''
  if (href.startsWith('http')) return href
  return base + href
}

function rendition(links: Record<string, any>, size: string, base = ''): string {
  const href = links?.[`/rels/rendition_type/${size}`]?.href || ''
  return resolveHref(base, href)
}

export function extractYear(name: string): string {
  const m = name.match(/^(\d{4})-\d{2}/)
  return m ? m[1] : ''
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// ── Image download (build-time) ───────────────────

const PHOTOS_DIR = resolve(process.cwd(), 'public/photos')

async function downloadImage(remoteUrl: string, localPath: string): Promise<void> {
  if (!remoteUrl) return
  if (existsSync(localPath)) return  // skip if already cached
  try {
    const r = await fetch(remoteUrl, { headers: LR_HEADERS })
    if (!r.ok) return
    const buf = await r.arrayBuffer()
    mkdirSync(dirname(localPath), { recursive: true })
    writeFileSync(localPath, Buffer.from(buf))
  } catch {
    // silently skip failed downloads — page still builds, img just 404s
  }
}

// ── API ───────────────────────────────────────────

export async function fetchResources(): Promise<AlbumMeta[]> {
  const data = await fetchLR(`${BASE}/resources`)
  const base: string = data.base || ''

  const albums: AlbumMeta[] = (data.resources || [])
    .filter((r: any) => r.type === 'album')
    .map((r: any) => {
      const links = r.links || {}
      return {
        id: r.id,
        name: r.payload?.name || r.id,
        coverUrl:
          rendition(links, 'thumbnail2x', base) ||
          rendition(links, '640', base) ||
          rendition(links, '1280', base),
        year: extractYear(r.payload?.name || ''),
      }
    })

  // Download cover images
  await Promise.all(
    albums.map(async album => {
      if (!album.coverUrl) return
      const localPath = resolve(PHOTOS_DIR, `${album.id}/cover.jpg`)
      await downloadImage(album.coverUrl, localPath)
      album.coverUrl = `/photos/${album.id}/cover.jpg`
    })
  )

  return albums
}

export async function fetchAlbumAssets(albumId: string): Promise<PhotoAsset[]> {
  const url =
    `${BASE}/albums/${albumId}/assets` +
    `?embed=asset%3Bself&order_after=-&exclude=incomplete&subtype=image%3Bvideo%3Blayout_segment`
  const data = await fetchLR(url)
  const base: string = data.base || ''

  const assets: PhotoAsset[] = (data.resources || []).map((resource: any) => {
    const assetLinks = resource.asset?.links || {}
    const assetPayload = resource.asset?.payload || {}
    const assetId = resource.asset?.id || resource.id

    return {
      id: assetId,
      thumbnailUrl: rendition(assetLinks, 'thumbnail2x', base) || rendition(assetLinks, '640', base),
      url2048: rendition(assetLinks, '2048', base) || rendition(assetLinks, '1280', base),
      captureDate: assetPayload.captureDate || '',
      xmp: assetPayload.xmp || {},
      importSource: assetPayload.importSource,
      location: assetPayload.location,
    }
  })

  // Download images in parallel (max 5 at a time to avoid overwhelming)
  const chunk = 5
  for (let i = 0; i < assets.length; i += chunk) {
    await Promise.all(
      assets.slice(i, i + chunk).map(async asset => {
        const thumbPath = resolve(PHOTOS_DIR, `${asset.id}/thumb.jpg`)
        const fullPath  = resolve(PHOTOS_DIR, `${asset.id}/full.jpg`)

        await Promise.all([
          downloadImage(asset.thumbnailUrl, thumbPath),
          downloadImage(asset.url2048,      fullPath),
        ])

        asset.thumbnailUrl = `/photos/${asset.id}/thumb.jpg`
        asset.url2048      = `/photos/${asset.id}/full.jpg`
      })
    )
  }

  return assets
}
