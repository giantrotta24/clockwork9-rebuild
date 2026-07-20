// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://clockwork9.com',
  redirects: {
    // The live site 301s this old slug (WP slug rename) and the old homepage
    // grid links through it — preserve the redirect for any external links.
    '/work/found-surface-cavs/': '/work/cavs-cleveland-art-museum/',
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
