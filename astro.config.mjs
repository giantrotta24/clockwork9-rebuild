// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://clockwork9.com',
  redirects: {
    // Duplicate of cavs-cleveland-art-museum on the live site (same title +
    // gallery, different URL); linked from the old homepage grid.
    '/work/found-surface-cavs/': '/work/cavs-cleveland-art-museum/',
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
