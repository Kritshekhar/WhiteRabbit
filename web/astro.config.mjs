// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// Static site for GitHub Pages, served under /WhiteRabbit/. Every page is
// prerendered from db/whiterabbit.sqlite at build time.
export default defineConfig({
  site: 'https://kritshekhar.github.io',
  base: '/WhiteRabbit/',
  trailingSlash: 'always',
  output: 'static',
  build: { format: 'directory' },
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    ssr: { external: ['better-sqlite3'] },
  },
});
