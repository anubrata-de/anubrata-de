#!/usr/bin/env node
/**
 * Rebuilds the Projects section of README.md from the same data the portfolio
 * site uses, so the profile and the website always list the same projects with
 * the same names.
 *
 * Source: github-projects.json in the Portfolio repo, which is itself generated
 * daily from every public repo on this account (see anubrata-de/Portfolio,
 * scripts/sync-projects.mjs).
 *
 * Only the part of README.md between the PROJECTS:START and PROJECTS:END markers
 * is replaced. Everything else in the README is left as written.
 *
 * Usage: node scripts/build-readme.mjs [path-or-url-to-json]
 */
import { readFile, writeFile } from "node:fs/promises";

const SOURCE =
  process.argv[2] || "https://raw.githubusercontent.com/anubrata-de/Portfolio/main/src/data/github-projects.json";
const README = new URL("../README.md", import.meta.url);
const START = "<!-- PROJECTS:START -->";
const END = "<!-- PROJECTS:END -->";

/** One look per category, so every card in a section matches. */
const STYLE = {
  "LLM agents and apps": { icon: "🤖", color: "7C3AED" },
  "Full-stack apps": { icon: "🌐", color: "059669" },
  "Machine learning": { icon: "🧠", color: "2563EB" },
  "Business and data analysis": { icon: "📊", color: "DC2626" },
  "Other projects": { icon: "🧩", color: "475569" },
};

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const badgeText = (s) => encodeURIComponent(s.replace(/-/g, "--").replace(/_/g, "__"));
const tag = (label, color) =>
  `<img src="https://img.shields.io/badge/${badgeText(label)}-${color}?style=flat-square" alt="${escapeHtml(label)}" />`;
const button = (label, href, color, logo) =>
  `<a href="${href}"><img src="https://img.shields.io/badge/${badgeText(label)}-${color}?style=for-the-badge${logo ? `&logo=${logo}&logoColor=white` : ""}" alt="${escapeHtml(label)}" /></a>`;

function card(p, color) {
  const site = `https://anubrata.vercel.app/projects/${p.slug}`;
  return `<td width="50%" valign="top">

<h3>${escapeHtml(p.title)}</h3>
${p.tagline ? `\n<em>${escapeHtml(p.tagline)}</em>\n` : ""}
${escapeHtml(p.summary)}

<p>
${p.tags.map((t) => tag(t, color)).join("\n")}
</p>

${button("Repository", p.url, color, "github")}
${button("Details", site, "1D1B22")}${p.homepage ? `\n${button("Live", p.homepage, "1D1B22", "vercel")}` : ""}

</td>`;
}

function section(category, projects) {
  const { icon, color } = STYLE[category] || STYLE["Other projects"];
  const rows = [];
  for (let i = 0; i < projects.length; i += 2) {
    const pair = projects.slice(i, i + 2).map((p) => card(p, color));
    if (pair.length === 1) pair.push(`<td width="50%" valign="top"></td>`);
    rows.push(`<tr>\n\n${pair.join("\n\n")}\n\n</tr>`);
  }
  return `### ${icon} ${category}\n\n<table>\n${rows.join("\n\n")}\n</table>`;
}

async function load(source) {
  if (/^https?:/.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Couldn't fetch ${source}: ${res.status}`);
    return res.json();
  }
  return JSON.parse(await readFile(source, "utf8"));
}

async function main() {
  const data = await load(SOURCE);
  const sections = data.categories
    .map((c) => [c, data.projects.filter((p) => p.category === c)])
    .filter(([, list]) => list.length)
    .map(([c, list]) => section(c, list));

  const block = `${START}
## 🧩 Projects

<sub>${data.projects.length} projects, updated automatically from my repositories. Details for each are on <a href="https://anubrata.vercel.app/projects">my portfolio</a>.</sub>

${sections.join("\n\n")}
${END}`;

  const readme = await readFile(README, "utf8");
  const a = readme.indexOf(START);
  const b = readme.indexOf(END);
  if (a === -1 || b === -1) throw new Error("README.md is missing the PROJECTS:START / PROJECTS:END markers.");
  const next = readme.slice(0, a) + block + readme.slice(b + END.length);
  if (next === readme) {
    console.log("No changes.");
    return;
  }
  await writeFile(README, next);
  console.log(`Wrote ${data.projects.length} projects to README.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
