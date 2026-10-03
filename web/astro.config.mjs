// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// Static site on whiterabbitai.org (Cloudflare, web/wrangler.toml). Every page
// is prerendered from db/whiterabbit.sqlite at build time.
export default defineConfig({
  site: 'https://whiterabbitai.org',
  base: '/',
  trailingSlash: 'always',
  output: 'static',
  build: { format: 'directory' },
  // the sitemap lists pages only; feeds, images and the 404 page stay out
  integrations: [react(), sitemap({ filter: (page) => !page.includes('/404') })],
  vite: {
    plugins: [tailwindcss()],
    ssr: { external: ['better-sqlite3'] },
  },
});
