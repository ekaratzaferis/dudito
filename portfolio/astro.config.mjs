import { defineConfig } from 'astro/config'

// BASE_PATH env var lets CI override this:
//   GitHub Pages (no custom domain): /dudito/portfolio
//   After adding dudito.com custom domain: /portfolio
const base = process.env.BASE_PATH ?? '/dudito/portfolio'

export default defineConfig({
  output: 'static',
  base,
  trailingSlash: 'always',
})
