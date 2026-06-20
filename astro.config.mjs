// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

import cloudflare from "@astrojs/cloudflare";

/**
 * Zero-dependency remark plugin: counts words in a post and exposes a
 * `minutesRead` string on the frontmatter (read via remarkPluginFrontmatter).
 */
function remarkReadingTime() {
	return function (tree, file) {
		const count = (node) => {
			if (typeof node.value === "string") {
				return node.value.trim().split(/\s+/).filter(Boolean).length;
			}
			return (node.children ?? []).reduce((sum, c) => sum + count(c), 0);
		};
		const words = count(tree);
		const minutes = Math.max(1, Math.round(words / 200));
		file.data.astro.frontmatter.minutesRead = `${minutes} min read`;
	};
}

// https://astro.build/config
export default defineConfig({
	// TODO: set this to your real deployed URL (used for canonical links,
	// sitemap, RSS, and Open Graph). Cloudflare gives you a *.workers.dev URL,
	// or use your custom domain once it's connected.
	site: "https://harshwardhan.works",
	integrations: [mdx(), sitemap()],
	markdown: {
		remarkPlugins: [remarkReadingTime],
		shikiConfig: {
			// Dual theme — the stylesheet swaps colors based on [data-theme].
			themes: {
				light: "github-light",
				dark: "github-dark",
			},
			defaultColor: false,
			wrap: false,
		},
	},
	adapter: cloudflare({
		platformProxy: {
			enabled: true,
		},
	}),
});
