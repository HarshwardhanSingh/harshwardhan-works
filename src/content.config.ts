import { glob } from "astro/loaders";
import { defineCollection } from "astro:content";
import { z } from "astro/zod";

const blog = defineCollection({
	// Load Markdown and MDX files in the `src/content/blog/` directory.
	loader: glob({ base: "./src/content/blog", pattern: "**/*.{md,mdx}" }),
	// Type-check frontmatter using a schema.
	schema: z.object({
		title: z.string(),
		description: z.string(),
		pubDate: z.coerce.date(),
		updatedDate: z.coerce.date().optional(),
		heroImage: z.string().optional(),
		// Optional topic tags, e.g. ["ai", "security"]. Not yet surfaced as
		// filter pages, but stored so you can add /tags/* later without a migration.
		tags: z.array(z.string()).default([]),
		// Set `draft: true` to hide a post from listings and feeds.
		draft: z.boolean().default(false),
	}),
});

export const collections = { blog };
