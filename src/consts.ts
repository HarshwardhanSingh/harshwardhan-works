// ─────────────────────────────────────────────────────────────────────────────
// Site-wide config. Edit everything about "you" here — it flows to every page.
// ─────────────────────────────────────────────────────────────────────────────

export const SITE_TITLE = "Harshwardhan Singh";
export const SITE_DESCRIPTION =
	"Harshwardhan Singh — web engineer writing about web performance, frontend architecture, AI, and security.";

// Short line shown under your name on the home page.
export const SITE_TAGLINE =
	"Web engineer. I write about performance, frontend architecture, and what I'm learning in AI and security.";

export const AUTHOR = "Harshwardhan Singh";

// Social / contact links shown in the header and footer.
// Leave a value as "" to hide that link. Fill these in with your real handles.
export const SOCIALS = {
	github: "https://github.com/", // TODO: add your username, e.g. https://github.com/harshwardhan
	twitter: "https://twitter.com/", // TODO: add your handle, e.g. https://twitter.com/handle
	linkedin: "https://www.linkedin.com/in/", // TODO: add your profile slug
	email: "mailto:harsh.rathore14@gmail.com",
};

// Main navigation. `href` must match a route under src/pages/.
export const NAV_LINKS = [
	{ href: "/", label: "Home" },
	{ href: "/blog", label: "Writing" },
];
