#!/usr/bin/env node
/**
 * Rebuilds the generated parts of README.md every day:
 *
 *   PROJECTS  every project, from the same data the portfolio site uses
 *   STACK     tools and areas, collected from the projects' tags and languages
 *
 * Project data: github-projects.json in the Portfolio repo, itself generated daily
 * from every public repo on this account (anubrata-de/Portfolio, scripts/sync-projects.mjs).
 *
 * Only the text between each START/END marker pair is replaced.
 *
 * Usage: node scripts/build-readme.mjs [path-or-url-to-projects-json]
 */
import { readFile, writeFile } from "node:fs/promises";

const OWNER = process.env.GITHUB_OWNER || "anubrata-de";
const SOURCE =
  process.argv[2] || `https://raw.githubusercontent.com/${OWNER}/Portfolio/main/src/data/github-projects.json`;
const ROOT = new URL("../", import.meta.url);
const README = new URL("README.md", ROOT);
const SITE = "https://anubrata.vercel.app";

// ---------- shared helpers ----------

const escapeHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const badgeText = (s) => encodeURIComponent(s.replace(/-/g, "--").replace(/_/g, "__"));

function replaceBlock(readme, name, content) {
  const start = `<!-- ${name}:START -->`;
  const end = `<!-- ${name}:END -->`;
  const a = readme.indexOf(start);
  const b = readme.indexOf(end);
  if (a === -1 || b === -1) throw new Error(`README.md is missing the ${name}:START / ${name}:END markers.`);
  return `${readme.slice(0, a)}${start}\n${content}\n${end}${readme.slice(b + end.length)}`;
}

async function loadJson(source) {
  if (/^https?:/.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Couldn't fetch ${source}: ${res.status}`);
    return res.json();
  }
  return JSON.parse(await readFile(source, "utf8"));
}

// ---------- PROJECTS ----------

/** One look per category, so every card in a section matches. */
const CATEGORY_STYLE = {
  "LLM agents and apps": { icon: "🤖", color: "7C3AED" },
  "Full-stack apps": { icon: "🌐", color: "059669" },
  "Machine learning": { icon: "🧠", color: "2563EB" },
  "Business and data analysis": { icon: "📊", color: "DC2626" },
  "Other projects": { icon: "🧩", color: "475569" },
};

const smallBadge = (label, color) =>
  `<img src="https://img.shields.io/badge/${badgeText(label)}-${color}?style=flat-square" alt="${escapeHtml(label)}" />`;
const button = (label, href, color, logo) =>
  `<a href="${href}"><img src="https://img.shields.io/badge/${badgeText(label)}-${color}?style=for-the-badge${logo ? `&logo=${logo}&logoColor=white` : ""}" alt="${escapeHtml(label)}" /></a>`;

function card(p, color) {
  return `<td width="50%" valign="top">

<h3>${escapeHtml(p.title)}</h3>
${p.tagline ? `\n<em>${escapeHtml(p.tagline)}</em>\n` : ""}
${escapeHtml(p.summary)}

<p>
${p.tags.map((t) => smallBadge(t, color)).join("\n")}
</p>

${button("Repository", p.url, color, "github")}
${button("Details", `${SITE}/projects/${p.slug}`, "1D1B22")}${p.homepage ? `\n${button("Live", p.homepage, "1D1B22", "vercel")}` : ""}

</td>`;
}

function projectsBlock(data) {
  const sections = data.categories
    .map((c) => [c, data.projects.filter((p) => p.category === c)])
    .filter(([, list]) => list.length)
    .map(([category, list]) => {
      const { icon, color } = CATEGORY_STYLE[category] || CATEGORY_STYLE["Other projects"];
      const rows = [];
      for (let i = 0; i < list.length; i += 2) {
        const pair = list.slice(i, i + 2).map((p) => card(p, color));
        if (pair.length === 1) pair.push(`<td width="50%" valign="top"></td>`);
        rows.push(`<tr>\n\n${pair.join("\n\n")}\n\n</tr>`);
      }
      return `### ${icon} ${category}\n\n<table>\n${rows.join("\n\n")}\n</table>`;
    });
  return `## 🧩 Projects

<sub>${data.projects.length} projects, updated automatically from my repositories. Details for each are on <a href="${SITE}/projects">my portfolio</a>.</sub>

${sections.join("\n\n")}`;
}

// ---------- STACK ----------

/**
 * Known tools: which group they belong to and how their badge looks.
 * Any tag not listed here is treated as an area of work.
 */
const TOOLS = {
  Python: ["Languages", "3776AB", "python"],
  JavaScript: ["Languages", "F7DF1E", "javascript", "black"],
  SQL: ["Languages", "4479A1", "postgresql"],
  Jupyter: ["Languages", "F37626", "jupyter"],
  pandas: ["Data and ML", "150458", "pandas"],
  "scikit-learn": ["Data and ML", "F7931E", "scikitlearn"],
  XGBoost: ["Data and ML", "189FDD"],
  LightGBM: ["Data and ML", "02569B"],
  PyTorch: ["Data and ML", "EE4C2C", "pytorch"],
  librosa: ["Data and ML", "5A3E8E"],
  DuckDB: ["Data and ML", "FFF000", "duckdb", "black"],
  "LLM APIs": ["AI and LLMs", "7C3AED", "openai"],
  Embeddings: ["AI and LLMs", "6D28D9"],
  "Tool calling": ["AI and LLMs", "5B21B6"],
  FastAPI: ["Back end and front end", "009688", "fastapi"],
  Flask: ["Back end and front end", "000000", "flask"],
  "Vue.js": ["Back end and front end", "4FC08D", "vuedotjs"],
  Jinja2: ["Back end and front end", "B41717", "jinja"],
  Bootstrap: ["Back end and front end", "7952B3", "bootstrap"],
  SQLite: ["Back end and front end", "003B57", "sqlite"],
  Redis: ["Back end and front end", "DC382D", "redis"],
  Celery: ["Back end and front end", "37814A", "celery"],
  "python-pptx": ["Back end and front end", "B7472A"],
};
const ALIASES = { "jupyter notebook": "Jupyter", "vue": "Vue.js", "vue 3": "Vue.js", "sklearn": "scikit-learn", "torch": "PyTorch" };
const GROUPS = ["Languages", "Data and ML", "AI and LLMs", "Back end and front end"];

function canonical(tag) {
  const lower = tag.toLowerCase();
  if (ALIASES[lower]) return ALIASES[lower];
  return Object.keys(TOOLS).find((t) => t.toLowerCase() === lower) || tag;
}

/** Every tag and language across the projects, with how many projects use it, most used first. */
function usage(data) {
  const counts = new Map();
  for (const p of data.projects) {
    const names = new Set([...p.tags, p.language].filter(Boolean).map(canonical));
    for (const n of names) counts.set(n, (counts.get(n) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function stackBlock(data) {
  const byUse = usage(data);
  const plural = (n) => `${n} project${n === 1 ? "" : "s"}`;
  const badge = ([n, c]) => {
    const [, color, logo, logoColor = "white"] = TOOLS[n];
    const src = `https://img.shields.io/badge/${badgeText(n)}-${color}?style=flat-square${logo ? `&logo=${logo}&logoColor=${logoColor}` : ""}`;
    return `<img src="${src}" alt="${escapeHtml(n)}" title="Used in ${plural(c)}" />`;
  };
  const rows = GROUPS.map((g) => [g, byUse.filter(([n]) => TOOLS[n]?.[0] === g).map(badge).join(" ")]).filter(([, cells]) => cells);
  const areas = byUse.filter(([n]) => !TOOLS[n]).map(([n]) => `<code>${escapeHtml(n)}</code>`).join(" ");
  if (areas) rows.push(["Areas", areas]);
  return `## 🛠️ Tech Stack

<sub>Collected automatically from my projects, most used first.</sub>

<table>
${rows.map(([g, cells]) => `<tr><td><b>${g}</b></td><td>${cells}</td></tr>`).join("\n")}
</table>`;
}

// ---------- main ----------

async function main() {
  const data = await loadJson(SOURCE);
  const readme = await readFile(README, "utf8");
  let next = replaceBlock(readme, "PROJECTS", projectsBlock(data));
  next = replaceBlock(next, "STACK", stackBlock(data));
  if (next === readme) {
    console.log("README unchanged.");
  } else {
    await writeFile(README, next);
    console.log(`README updated: ${data.projects.length} projects.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
