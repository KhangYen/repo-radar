// RepoRadar data updater — runs daily in GitHub Actions (free cron).
// No dependencies; Node 20+ (global fetch).
//
// Strategy: GitHub has no official trending API, so we compute our own,
// ToS-clean, via the search API:
//   - "hot new": repos created in the last 14 days, most stars
//   - "rising": repos pushed in the last 3 days with strong star counts
// plus our own star-history snapshots (docs/history.json) which give real
// day-over-day deltas from the second run onward.
// Buzz signal: Hacker News mentions via the free Algolia HN API.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DOCS = path.join(ROOT, "docs");
const BADGES = path.join(DOCS, "badges");
const TOKEN = process.env.GITHUB_TOKEN || "";
const HEADERS = {
  "User-Agent": "RepoRadar (github.com/KhangYen/repo-radar)",
  Accept: "application/vnd.github+json",
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};
const HISTORY_KEEP = 30; // snapshots per repo
const TOP_N = 100;       // repos published
const HN_FOR = 40;       // how many top repos get an HN lookup

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gh(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (res.status === 403 || res.status === 429) {
    // secondary rate limit — one polite retry
    await sleep(30000);
    return gh(url);
  }
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function daysAgo(n) {
  return new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
}

async function searchRepos(q, perPage = 50) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${perPage}`;
  const data = await gh(url);
  await sleep(TOKEN ? 1000 : 7000); // stay well under search rate limits
  return data.items || [];
}

async function hnBuzz(fullName) {
  try {
    const res = await fetch(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(`"${fullName}"`)}&tags=story&hitsPerPage=3`,
      { headers: { "User-Agent": HEADERS["User-Agent"] } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const hits = (data.hits || []).filter(h => h.points > 2);
    if (!hits.length) return null;
    const top = hits.sort((a, b) => b.points - a.points)[0];
    return {
      count: data.nbHits,
      title: top.title,
      points: top.points,
      url: `https://news.ycombinator.com/item?id=${top.objectID}`,
    };
  } catch {
    return null;
  }
}

async function main() {
  fs.mkdirSync(BADGES, { recursive: true });

  // --- gather candidates ---
  const seen = new Map();
  const add = (items, bucket) => {
    for (const r of items) {
      if (r.fork || r.archived) continue;
      if (!seen.has(r.full_name)) seen.set(r.full_name, { r, bucket });
    }
  };

  add(await searchRepos(`created:>${daysAgo(14)} stars:>30`), "new");
  add(await searchRepos(`pushed:>${daysAgo(3)} stars:>500 created:>${daysAgo(365)}`), "rising");
  for (const lang of ["python", "typescript", "rust", "go"]) {
    add(await searchRepos(`language:${lang} created:>${daysAgo(14)} stars:>15`, 20), "new");
  }

  // --- star history / deltas ---
  const histPath = path.join(DOCS, "history.json");
  let history = {};
  try { history = JSON.parse(fs.readFileSync(histPath, "utf8")); } catch {}
  const today = new Date().toISOString().slice(0, 10);

  const repos = [];
  for (const { r, bucket } of seen.values()) {
    const h = history[r.full_name] || [];
    const prev = h.length ? h[h.length - 1].s : null;
    const delta = prev !== null ? r.stargazers_count - prev : null;
    if (!h.length || h[h.length - 1].d !== today) {
      h.push({ d: today, s: r.stargazers_count });
      while (h.length > HISTORY_KEEP) h.shift();
    } else {
      h[h.length - 1].s = r.stargazers_count;
    }
    history[r.full_name] = h;
    repos.push({
      full_name: r.full_name,
      url: r.html_url,
      description: (r.description || "").slice(0, 200),
      language: r.language,
      stars: r.stargazers_count,
      delta,           // null on a repo's first appearance
      bucket,          // "new" | "rising"
      created_at: r.created_at.slice(0, 10),
    });
  }

  // prune history entries for repos that fell out of view (cap file growth)
  const keep = new Set(repos.map(x => x.full_name));
  for (const k of Object.keys(history)) if (!keep.has(k)) delete history[k];

  // --- rank: known delta first (descending), then stars-per-day for the rest ---
  const age = x => Math.max(1, (Date.now() - Date.parse(x.created_at)) / 864e5);
  repos.sort((a, b) => {
    const da = a.delta ?? -1, db = b.delta ?? -1;
    if (da !== db) return db - da;
    return b.stars / age(b) - a.stars / age(a);
  });
  const top = repos.slice(0, TOP_N).map((x, i) => ({ ...x, rank: i + 1 }));

  // --- HN buzz for the head of the list ---
  for (const repo of top.slice(0, HN_FOR)) {
    repo.hn = await hnBuzz(repo.full_name);
    await sleep(400);
  }

  // --- shields.io endpoint badges for the top 50 ---
  for (const repo of top.slice(0, 50)) {
    const file = repo.full_name.replace("/", "--") + ".json";
    fs.writeFileSync(path.join(BADGES, file), JSON.stringify({
      schemaVersion: 1,
      label: "RepoRadar",
      message: `#${repo.rank} trending`,
      color: repo.rank <= 10 ? "orange" : "blue",
    }));
  }

  fs.writeFileSync(histPath, JSON.stringify(history));
  fs.writeFileSync(path.join(DOCS, "data.json"), JSON.stringify({
    generated: new Date().toISOString(),
    repos: top,
  }, null, 1));
  console.log(`Wrote ${top.length} repos (${top.filter(x => x.delta !== null).length} with deltas, ${top.filter(x => x.hn).length} with HN buzz).`);
}

main().catch(e => { console.error(e); process.exit(1); });
