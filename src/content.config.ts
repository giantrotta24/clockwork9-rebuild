import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/*
  Blog posts migrated from the WordPress scrape. One folder per post:
  src/content/blog/<slug>/index.md with the post's images beside it.
  URL shape preserved from the live site: /blog/<category>/<slug>/
*/
const blog = defineCollection({
  loader: glob({ pattern: '**/index.md', base: './src/content/blog' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string().min(20), // meta description — every post gets one (audit fix)
      date: z.coerce.date(),
      author: z.string(),
      category: z.enum(['creative', 'marketing', 'news', 'press', 'product-reviews', 'tutorials']),
      hero: image().optional(),
      heroAlt: z.string().default(''),
      excerpt: z.string().min(10), // card text on index/archive pages
    }),
});

export const collections = { blog };
