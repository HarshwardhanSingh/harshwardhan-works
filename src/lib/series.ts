// Series definitions. A post belongs to a series when its slug appears in one
// of the lists below; the BlogPost layout then renders the left-rail nav.
// Keeping this in one place means the series order lives in exactly one spot,
// instead of a hand-maintained blockquote repeated in every post.

export interface SeriesPost {
	slug: string;
	label: string;
}

export interface Series {
	id: string;
	title: string;
	posts: SeriesPost[];
}

export const SERIES: Series[] = [
	{
		id: "cited-rag",
		title: "A welfare-scheme assistant, built to be right",
		posts: [
			{ slug: "building-a-cited-rag-1-introduction", label: "What we're building, and why" },
			{ slug: "building-a-cited-rag-vector-databases", label: "What is a vector database?" },
			{ slug: "building-a-cited-rag-2-chunking-embeddings-vectors", label: "Chunking, embeddings & the vector DB" },
			{ slug: "building-a-cited-rag-3-retrieval-streaming-citations", label: "Retrieval → a streaming, cited answer" },
			{ slug: "building-a-cited-rag-4-battle-hardening", label: "Making it battle-hardened" },
			{ slug: "building-a-cited-rag-5-deployment", label: "Deployment" },
		],
	},
];

// The series containing `slug` plus the 0-based position within it, or null.
export function findSeries(slug: string): { series: Series; index: number } | null {
	for (const series of SERIES) {
		const index = series.posts.findIndex((p) => p.slug === slug);
		if (index !== -1) return { series, index };
	}
	return null;
}
