#!/usr/bin/env node
/**
 * Draws the GitHub stats cards shown in README.md and saves them in assets/stats/.
 * Runs daily in .github/workflows/update-readme.yml with the workflow's GITHUB_TOKEN,
 * so the numbers are always current and no outside image service is involved.
 *
 * Cards (radical colours):
 *   profile-details.svg     contributions over the last year, repos, followers, join date
 *   stats.svg               stars, commits, pull requests, issues, repos contributed to
 *   repos-per-language.svg  main language of each public repo
 *   commits-per-language.svg  where last year's commits went, by language
 *   streak.svg              all-time contributions, current streak, longest streak
 *
 * Usage: GITHUB_TOKEN=... node scripts/stats-cards.mjs
 *        STATS_FIXTURE=data.json node scripts/stats-cards.mjs   (draw from saved data)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";

const OWNER = process.env.GITHUB_OWNER || "anubrata-de";
const OUT = new URL("../assets/stats/", import.meta.url);

const C = {
  bg: "#141321",
  title: "#fe428e",
  text: "#a9fef7",
  accent: "#f8d847",
  muted: "#6e6a8a",
  fire: "#eb8c30",
};
const FONT = "'Segoe UI', Ubuntu, 'Helvetica Neue', Sans-Serif";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n) => n.toLocaleString("en-US");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso) => new Date(`${iso}T00:00:00Z`);
const shortDate = (iso, withYear = true) => {
  const d = day(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}${withYear ? `, ${d.getUTCFullYear()}` : ""}`;
};

const card = (w, h, title, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="6" fill="${C.bg}"/>
${body}
</svg>
`;

// ---------- data ----------

async function graphql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": `${OWNER}-stats-cards`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors || json).slice(0, 400)}`);
  return json.data;
}

const MAIN_QUERY = `query($login: String!) {
  user(login: $login) {
    login name createdAt
    followers { totalCount }
    repositories(ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false, first: 100) {
      totalCount
      nodes { name stargazerCount primaryLanguage { name color } }
    }
    contributionsCollection {
      totalCommitContributions totalPullRequestContributions totalIssueContributions
      totalRepositoriesWithContributedCommits
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
      commitContributionsByRepository(maxRepositories: 100) {
        repository { primaryLanguage { name color } }
        contributions { totalCount }
      }
    }
  }
}`;

const YEAR_QUERY = `query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar { weeks { contributionDays { date contributionCount } } }
    }
  }
}`;

async function fetchData() {
  const { user } = await graphql(MAIN_QUERY, { login: OWNER });
  const col = user.contributionsCollection;

  // Every day since the account was created, one year at a time, for the streak card.
  const allDays = new Map();
  const now = new Date();
  for (let year = new Date(user.createdAt).getUTCFullYear(); year <= now.getUTCFullYear(); year++) {
    const from = new Date(Date.UTC(year, 0, 1));
    const to = year === now.getUTCFullYear() ? now : new Date(Date.UTC(year, 11, 31, 23, 59, 59));
    const data = await graphql(YEAR_QUERY, { login: OWNER, from: from.toISOString(), to: to.toISOString() });
    for (const w of data.user.contributionsCollection.contributionCalendar.weeks)
      for (const d of w.contributionDays) allDays.set(d.date, d.contributionCount);
  }

  const repoLangs = {};
  for (const r of user.repositories.nodes) {
    if (!r.primaryLanguage) continue;
    const l = (repoLangs[r.primaryLanguage.name] ||= { count: 0, color: r.primaryLanguage.color });
    l.count++;
  }
  const commitLangs = {};
  for (const c of col.commitContributionsByRepository) {
    const lang = c.repository.primaryLanguage;
    if (!lang) continue;
    const l = (commitLangs[lang.name] ||= { count: 0, color: lang.color });
    l.count += c.contributions.totalCount;
  }

  return {
    login: user.login,
    name: user.name,
    createdAt: user.createdAt,
    followers: user.followers.totalCount,
    repos: user.repositories.totalCount,
    stars: user.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0),
    commits: col.totalCommitContributions,
    pullRequests: col.totalPullRequestContributions,
    issues: col.totalIssueContributions,
    contributedTo: col.totalRepositoriesWithContributedCommits,
    yearTotal: col.contributionCalendar.totalContributions,
    yearDays: col.contributionCalendar.weeks.flatMap((w) => w.contributionDays),
    allDays: [...allDays].sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count })),
    repoLangs,
    commitLangs,
  };
}

// ---------- cards ----------

function profileDetails(d) {
  const w = 700;
  const h = 200;
  // Weekly totals for the last year, drawn as a filled line.
  const weeks = [];
  for (let i = 0; i < d.yearDays.length; i += 7) {
    const slice = d.yearDays.slice(i, i + 7);
    weeks.push({ date: slice[0].date, total: slice.reduce((s, x) => s + x.contributionCount, 0) });
  }
  const cx = 40;
  const cw = 360;
  const cy = 60;
  const ch = 100;
  const max = Math.max(1, ...weeks.map((x) => x.total));
  const pts = weeks.map((x, i) => [cx + (i / Math.max(1, weeks.length - 1)) * cw, cy + ch - (x.total / max) * ch]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${cx + cw} ${cy + ch} L${cx} ${cy + ch} Z`;
  const months = [];
  let last = -1;
  weeks.forEach((x, i) => {
    const m = day(x.date).getUTCMonth();
    if (m !== last && i % 4 === 0) {
      last = m;
      months.push(`<text x="${pts[i][0].toFixed(1)}" y="${cy + ch + 18}" font-family="${FONT}" font-size="11" fill="${C.text}" text-anchor="middle">${MONTHS[m]}</text>`);
    }
  });
  const joined = new Date(d.createdAt);
  const info = [
    [`${fmt(d.yearTotal)} contributions in the last year`],
    [`${fmt(d.repos)} public repos`],
    [`Joined GitHub ${MONTHS[joined.getUTCMonth()]} ${joined.getUTCFullYear()}`],
    [`${fmt(d.followers)} follower${d.followers === 1 ? "" : "s"}`],
  ];
  const list = info
    .map(
      ([t], i) => `<circle cx="436" cy="${78 + i * 28}" r="4" fill="${C.accent}"/>
<text x="449" y="${82 + i * 28}" font-family="${FONT}" font-size="14" fill="${C.text}">${esc(t)}</text>`,
    )
    .join("\n");
  const title = d.name ? `${d.login} (${d.name})` : d.login;
  return card(
    w,
    h,
    title,
    `<defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.title}" stop-opacity="0.45"/><stop offset="1" stop-color="${C.title}" stop-opacity="0"/></linearGradient></defs>
<text x="25" y="35" font-family="${FONT}" font-size="18" font-weight="600" fill="${C.title}">${esc(title)}</text>
<path d="M${cx} ${cy + ch} H${cx + cw}" stroke="${C.muted}" stroke-width="1"/>
<path d="${area}" fill="url(#fill)"/>
<path d="${line}" fill="none" stroke="${C.title}" stroke-width="2" stroke-linejoin="round"/>
${months.join("\n")}
${list}`,
  );
}

function statsCard(d) {
  const rows = [
    ["Total stars", d.stars],
    ["Commits in the last year", d.commits],
    ["Pull requests", d.pullRequests],
    ["Issues", d.issues],
    ["Repos contributed to", d.contributedTo],
  ];
  const body = rows
    .map(
      ([label, value], i) => `<circle cx="32" cy="${70 + i * 25}" r="4" fill="${C.accent}"/>
<text x="46" y="${75 + i * 25}" font-family="${FONT}" font-size="14" fill="${C.text}">${esc(label)}</text>
<text x="315" y="${75 + i * 25}" font-family="${FONT}" font-size="14" font-weight="700" fill="${C.text}" text-anchor="end">${fmt(value)}</text>`,
    )
    .join("\n");
  return card(340, 200, "Stats", `<text x="25" y="35" font-family="${FONT}" font-size="18" font-weight="600" fill="${C.title}">Stats</text>\n${body}`);
}

function donutCard(title, langs) {
  const entries = Object.entries(langs)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);
  const total = entries.reduce((s, [, l]) => s + l.count, 0);
  const cx = 282;
  const cy = 112;
  const r = 40;
  const sw = 14;
  let angle = -Math.PI / 2;
  const arcs = entries.map(([, l]) => {
    const portion = total ? l.count / total : 0;
    const a0 = angle;
    const a1 = angle + portion * Math.PI * 2;
    angle = a1;
    if (portion >= 0.9999) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${l.color || C.muted}" stroke-width="${sw}"/>`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
    const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
    return `<path d="M${p0[0].toFixed(2)} ${p0[1].toFixed(2)} A${r} ${r} 0 ${large} 1 ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}" fill="none" stroke="${l.color || C.muted}" stroke-width="${sw}"/>`;
  });
  const legend = entries
    .map(
      ([name, l], i) => `<rect x="25" y="${60 + i * 25}" width="12" height="12" rx="2" fill="${l.color || C.muted}"/>
<text x="45" y="${71 + i * 25}" font-family="${FONT}" font-size="12.5" fill="${C.text}">${esc(name)} <tspan fill="${C.muted}">${l.count}</tspan></text>`,
    )
    .join("\n");
  const empty = total ? "" : `<text x="${cx}" y="${cy + 4}" font-family="${FONT}" font-size="12" fill="${C.muted}" text-anchor="middle">no data yet</text>`;
  return card(340, 200, title, `<text x="25" y="35" font-family="${FONT}" font-size="18" font-weight="600" fill="${C.title}">${esc(title)}</text>\n${legend}\n${arcs.join("\n")}${empty}`);
}

export function streakStats(days) {
  const active = days.filter((x) => x.count > 0);
  const total = days.reduce((s, x) => s + x.count, 0);
  let longest = { length: 0, start: null, end: null };
  let run = { length: 0, start: null };
  for (const x of days) {
    if (x.count > 0) {
      run = run.length ? { length: run.length + 1, start: run.start } : { length: 1, start: x.date };
      if (run.length > longest.length) longest = { length: run.length, start: run.start, end: x.date };
    } else run = { length: 0, start: null };
  }
  // A streak is still alive if today simply has no activity yet.
  let i = days.length - 1;
  if (i >= 0 && days[i].count === 0) i--;
  let end = i >= 0 ? days[i].date : null;
  let length = 0;
  for (; i >= 0 && days[i].count > 0; i--) length++;
  const current = { length, start: length ? days[i + 1].date : null, end: length ? end : null };
  return { total, first: active[0]?.date || days[0]?.date, last: days[days.length - 1]?.date, longest, current };
}

function streakCard(d) {
  const s = streakStats(d.allDays);
  const range = (a, b) => (a && b ? (a === b ? shortDate(a) : `${shortDate(a, false)}, ${day(a).getUTCFullYear()} - ${shortDate(b)}`) : "");
  const col = (x, number, label, dates, color, labelColor) => `<text x="${x}" y="88" font-family="${FONT}" font-size="28" font-weight="700" fill="${color}" text-anchor="middle">${fmt(number)}</text>
<text x="${x}" y="122" font-family="${FONT}" font-size="14" fill="${labelColor}" text-anchor="middle">${esc(label)}</text>
<text x="${x}" y="146" font-family="${FONT}" font-size="12" fill="${C.text}" text-anchor="middle">${esc(dates)}</text>`;
  const ring = `<circle cx="247.5" cy="71" r="40" fill="none" stroke="${C.title}" stroke-width="5"/>
<path d="M247.5 19 c 5 7 9 10 9 16 a 9 9 0 0 1 -18 0 c 0 -4 2 -7 4 -9 c 0 4 2 6 4 6 c 0 -5 -2 -9 1 -13 z" fill="${C.fire}"/>
<text x="247.5" y="81" font-family="${FONT}" font-size="28" font-weight="700" fill="${C.accent}" text-anchor="middle">${fmt(s.current.length)}</text>
<text x="247.5" y="140" font-family="${FONT}" font-size="14" font-weight="700" fill="${C.accent}" text-anchor="middle">Current Streak</text>
<text x="247.5" y="164" font-family="${FONT}" font-size="12" fill="${C.text}" text-anchor="middle">${esc(range(s.current.start, s.current.end) || "Start a new one today")}</text>`;
  const body = `${col(82.5, s.total, "Total Contributions", range(s.first, s.last), C.title, C.title)}
<path d="M165 28 V170 M330 28 V170" stroke="#e4e2e2" stroke-opacity="0.25" stroke-width="1"/>
${ring}
${col(412.5, s.longest.length, "Longest Streak", range(s.longest.start, s.longest.end), C.title, C.title)}`;
  return card(495, 195, "Contribution streak", body);
}

// ---------- main ----------

async function main() {
  const d = process.env.STATS_FIXTURE ? JSON.parse(await readFile(process.env.STATS_FIXTURE, "utf8")) : await fetchData();
  await mkdir(OUT, { recursive: true });
  const files = {
    "profile-details.svg": profileDetails(d),
    "stats.svg": statsCard(d),
    "repos-per-language.svg": donutCard("Top languages by repo", d.repoLangs),
    "commits-per-language.svg": donutCard("Top languages by commit", d.commitLangs),
    "streak.svg": streakCard(d),
  };
  for (const [name, svg] of Object.entries(files)) await writeFile(new URL(name, OUT), svg);
  console.log(`Drew ${Object.keys(files).length} cards for ${d.login}.`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
