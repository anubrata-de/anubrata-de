#!/usr/bin/env node
/**
 * Rebuilds the generated parts of README.md every day:
 *
 *   PROJECTS  every project, from the same data the portfolio site uses
 *   STACK     tools and areas, collected from the projects' tags and languages
 *   STATS     cards drawn from live GitHub data and saved in assets/
 *
 * Project data: github-projects.json in the Portfolio repo, itself generated daily
 * from every public repo on this account (anubrata-de/Portfolio, scripts/sync-projects.mjs).
 * Stats: GitHub's REST API, using the workflow's GITHUB_TOKEN.
 *
 * Only the text between each START/END marker pair is replaced.
 *
 * Usage: node scripts/build-readme.mjs [path-or-url-to-projects-json]
 *        STATS_FIXTURE=stats.json skips the API calls (for local testing).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";

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

// ---------- STATS ----------

const PAPER = "#fbfaf7";
const INK = "#1d1b22";
const INK2 = "#4f4c58";
const SHU = "#e2442f";
const FONT = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const LANG_COLORS = {
  Python: "#3572A5",
  JavaScript: "#f1e05a",
  "Jupyter Notebook": "#DA5B0B",
  HTML: "#e34c26",
  CSS: "#563d7c",
  TypeScript: "#3178c6",
  Vue: "#41b883",
  Shell: "#89e051",
};

const frame = (w, h, body, title) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(title)}">
<title>${escapeHtml(title)}</title>
<defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#e4e9f0" stroke-width="1"/></pattern></defs>
<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="14" fill="${PAPER}"/>
<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="14" fill="url(#grid)"/>
<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="14" fill="none" stroke="${INK}" stroke-width="2"/>
${body}
</svg>
`;

async function gh(path, token) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": `${OWNER}-readme`, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
  return res.json();
}

async function fetchStats(token) {
  const repos = [];
  for (let page = 1; ; page++) {
    const batch = await gh(`/users/${OWNER}/repos?type=owner&per_page=100&page=${page}`, token);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  const own = repos.filter((r) => !r.fork && !r.private);
  const stats = {
    repos: own.length,
    stars: own.reduce((s, r) => s + r.stargazers_count, 0),
    languages: {},
  };
  for (const r of own) if (r.language) stats.languages[r.language] = (stats.languages[r.language] || 0) + 1;

  return stats;
}

function overviewSvg(data, stats) {
  const items = [
    [data.projects.length, "projects"],
    [stats.repos, "public repositories"],
    [Object.keys(stats.languages).length, "languages"],
    [usage(data).filter(([n]) => TOOLS[n]).length, "tools and libraries"],
  ];
  const w = 840;
  const col = (w - 60) / items.length;
  const body = items
    .map(
      ([n, label, note], i) => `<g transform="translate(${30 + i * col} 0)">
<text x="${col / 2}" y="92" text-anchor="middle" font-family="${FONT}" font-size="44" font-weight="700" fill="${i === 0 ? SHU : INK}">${n}</text>
<text x="${col / 2}" y="122" text-anchor="middle" font-family="${FONT}" font-size="15" fill="${INK2}">${escapeHtml(label)}</text>${
        note ? `\n<text x="${col / 2}" y="142" text-anchor="middle" font-family="${FONT}" font-size="13" fill="${SHU}">${escapeHtml(note)}</text>` : ""
      }
</g>`,
    )
    .join("\n");
  const title = `<text x="30" y="40" font-family="${FONT}" font-size="15" font-weight="600" fill="${INK2}">GitHub at a glance</text>`;
  return frame(w, 166, `${title}\n${body}`, "GitHub at a glance");
}

function languagesSvg(stats) {
  const entries = Object.entries(stats.languages).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0) || 1;
  const w = 840;
  const barW = w - 60;
  let x = 30;
  const segments = entries
    .map(([lang, n]) => {
      const width = (n / total) * barW;
      const seg = `<rect x="${x.toFixed(1)}" y="58" width="${Math.max(width - 2, 1).toFixed(1)}" height="18" fill="${LANG_COLORS[lang] || "#8b949e"}" stroke="${INK}" stroke-width="1"/>`;
      x += width;
      return seg;
    })
    .join("\n");
  const legend = entries
    .map(([lang, n], i) => {
      const lx = 30 + (i % 4) * (barW / 4);
      const ly = 106 + Math.floor(i / 4) * 26;
      return `<circle cx="${lx + 6}" cy="${ly - 5}" r="6" fill="${LANG_COLORS[lang] || "#8b949e"}" stroke="${INK}" stroke-width="1"/>
<text x="${lx + 18}" y="${ly}" font-family="${FONT}" font-size="14" fill="${INK}">${escapeHtml(lang)} <tspan fill="${INK2}">${n} repo${n === 1 ? "" : "s"}</tspan></text>`;
    })
    .join("\n");
  const h = 106 + Math.ceil(entries.length / 4) * 26 + 6;
  const title = `<text x="30" y="40" font-family="${FONT}" font-size="15" font-weight="600" fill="${INK2}">Main language of each repository</text>`;
  return frame(w, h, `${title}\n${segments}\n${legend}`, "Main language of each repository");
}

async function statsBlock(data) {
  const token = process.env.GITHUB_TOKEN;
  const stats = process.env.STATS_FIXTURE
    ? JSON.parse(await readFile(process.env.STATS_FIXTURE, "utf8"))
    : await fetchStats(token);
  const assets = new URL("assets/", ROOT);
  await mkdir(assets, { recursive: true });
  await writeFile(new URL("stats-overview.svg", assets), overviewSvg(data, stats));
  await writeFile(new URL("stats-languages.svg", assets), languagesSvg(stats));
  const lines = [
    `## 📊 GitHub Stats`,
    ``,
    `<sub>Drawn from my GitHub data every day by this repository's workflow.</sub>`,
    ``,
    `<p align="center"><img src="./assets/stats-overview.svg" alt="GitHub at a glance" width="100%" /></p>`,
    `<p align="center"><img src="./assets/stats-languages.svg" alt="Main language of each repository" width="100%" /></p>`,
  ];
  return lines.join("\n");
}

// ---------- main ----------

async function main() {
  const data = await loadJson(SOURCE);
  const readme = await readFile(README, "utf8");
  let next = replaceBlock(readme, "PROJECTS", projectsBlock(data));
  next = replaceBlock(next, "STACK", stackBlock(data));
  next = replaceBlock(next, "STATS", await statsBlock(data));
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
