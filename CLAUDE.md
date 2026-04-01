# Dudito — Project Context

## Monorepo Structure

```
dudito/
├── selector/        # Local-only curator tool (Node.js + vanilla JS)
├── portfolio/       # Public Astro.js static site
└── selections.json  # Curated photo selections (written by selector, read by portfolio)
```

---

## Account

Adobe Lightroom account ID (hardcoded): `0aa2ddec4f3d4206b464662e22cc690f`

---

## Adobe Lightroom API

All API responses are prefixed with `while (1) {}` — strip before `JSON.parse`.
All rendition `href` values are **relative paths** — prepend `data.base` from the response.
Renditions live in `resource.asset.links`, NOT the top-level `resource.links`.
`data.base` from the API returns `https://photos.adobe.io/v2/...` but working rendition URLs use `https://lightroom.adobe.com/v2c/...` — replace domain+version before constructing URLs.
The header `X-Api-Key: photoshop_ux` is required for rendition URLs.

### URLs

| Purpose | URL |
|---|---|
| Gallery URL (user-facing) | `https://lightroom.adobe.com/gallery/ACCOUNT/albums/ALBUM/assets` |
| All albums metadata | `https://lightroom.adobe.com/v2/spaces/ACCOUNT/resources` |
| Album assets | `https://lightroom.adobe.com/v2/spaces/ACCOUNT/albums/ALBUM/assets?embed=asset%3Bself&order_after=-&exclude=incomplete&subtype=image%3Bvideo%3Blayout_segment` |

### Resources API response shape (`/resources`)
```json
{
  "resources": [{
    "id": "ALBUM_ID",
    "payload": { "name": "2024-03 Tokyo", "cover": "ASSET_ID" },
    "links": { "/rels/rendition_type/thumbnail2x": { "href": "relative/path" } }
  }],
  "base": "https://photos.adobe.io/v2/spaces/ACCOUNT/"
}
```

### Assets API response shape (`/albums/ALBUM/assets`)
```json
{
  "resources": [{
    "id": "RESOURCE_ID",
    "asset": {
      "id": "ASSET_ID",
      "links": { "/rels/rendition_type/thumbnail2x": { "href": "relative/path" } },
      "payload": {
        "captureDate": "ISO timestamp",
        "xmp": {
          "tiff": { "Make": "...", "Model": "..." },
          "exif": {
            "ISOSpeedRatings": 100,
            "FocalLength": [50, 1],
            "FNumber": [9, 1],
            "ExposureTime": [1, 50]
          },
          "aux": { "Lens": "..." },
          "Iptc4xmpCore": { "Location": "..." }
        },
        "importSource": { "fileName": "img.ORF", "originalWidth": 4608, "originalHeight": 3456, "fileSize": 12345678, "contentType": "image/x-olympus-orf" },
        "location": { "latitude": 37.9, "longitude": 23.7, "city": "Athens", "country": "Greece" }
      }
    }
  }],
  "base": "https://photos.adobe.io/v2/spaces/ACCOUNT/"
}
```

### EXIF rational values
FocalLength, FNumber, ExposureTime are arrays `[numerator, denominator]`:
- Focal: `FocalLength[0] / FocalLength[1]` → mm
- F-stop: `FNumber[0] / FNumber[1]` → `f / 9`
- Shutter: display as `ExposureTime[0] / ExposureTime[1] sec`
- ISO: plain integer

---

## Selector Tool (`./selector`)

Local Node.js/Express app, never deployed.

```
cd selector && npm install && node server.js
# Opens at http://localhost:3000
```

**Workflow:** paste a Lightroom gallery URL → photos load → click to select → Save → writes to `../portfolio/selections.json`

**Endpoints:**
- `GET /api/lr/resources?account=` — proxies Lightroom resources API
- `GET /api/lr/assets?account=&album=` — proxies album assets API
- `GET /api/img?url=` — image proxy (adds `X-Api-Key: photoshop_ux` header)
- `GET /api/selections` — reads selections.json
- `POST /api/save` — merges `{ albumId, slug, photos }` into selections.json

---

## Portfolio Site (`./portfolio`)

Astro.js static site. Reads `selections.json` at build time, fetches metadata from the Lightroom API. Images are served directly from Adobe CDN URLs (no local caching).

```
cd portfolio && npm install && npm run dev    # dev server
cd portfolio && npm run build                # static build → dist/
```

**Deployment:** GitHub Pages under `/portfolio` path (custom domain: `customdomain.com/portfolio`).

### `selections.json` format
```json
{
  "ALBUM_ID": {
    "slug": "2024-03-tokyo",
    "photos": ["PHOTO_ID_1", "PHOTO_ID_2"]
  }
}
```

### Pages
| Route | File | Description |
|---|---|---|
| `/` | `index.astro` | Album grid with cover images |
| `/albums/[slug]/` | `albums/[slug]/index.astro` | Photo grid for one album |
| `/albums/[slug]/[photoId]/` | `albums/[slug]/[photoId].astro` | Full photo viewer |

### Key components
- `LeftPanel.astro` — collapsible sidebar (thin 56px / wide 240px), year accordion, persists state via `sessionStorage` key `panel-thin`
- `BaseLayout.astro` — wraps all pages, includes `<ViewTransitions />`

### ViewTransitions gotcha
Scripts run once across navigations. All interactive page scripts must be wrapped in:
```js
document.addEventListener('astro:page-load', initFn)
```
Use `AbortController` + `astro:before-swap` to clean up event listeners on navigation away.

### Design system (`global.css`)
```
--font-sm:  14px   small — labels, captions, metadata
--font-md:  18px   medium — body text, navigation
--font-lg:  26px   large — headings, titles

--color-bg:         #111111
--color-surface:    #1C1C1C
--color-surface-2:  #262626
--color-border:     #333333
--color-text:       #FFFFFF
--color-text-muted: #909090
--color-accent:     #FFFFFF

--panel-width:       240px
--panel-width-thin:   56px
--right-panel-w:     380px
--right-panel-thin-w: 48px

Font: Roboto Condensed (Google Fonts)
```

### Photo page specifics
- Right panel state persisted via `sessionStorage` key `photo-panel-open` — stays open when browsing prev/next
- Mini map: Leaflet.js from CDN, CartoDB Dark Matter tiles, custom blue teardrop pin icon
- Reverse geocoding: Nominatim API (client-side, async)
- Zoom: CSS `transform: scale()` on mouse wheel / pinch
- Autoplay: `requestFullscreen()` + shuffled slideshow every 5s


## Local Alias
+dudito() {                                                                                                                   
(cd /Users/ekaratzaferis/Documents/dev/dudito/selector && npm start &)                                                     
  sleep 1 && open http://localhost:3000                                                                                      
}  