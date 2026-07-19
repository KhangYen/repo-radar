# RepoRadar

Daily-updated trending GitHub repositories, ranked by **real day-over-day
star momentum** (computed from our own snapshots, not scraped), with
**Hacker News buzz** attached.

**Live site:** https://khangyen.github.io/repo-radar/

- 🔥 Hot new repos (created in the last 14 days) + rising established ones
- 📈 Star deltas from daily snapshots — honest momentum, not vanity totals
- 🗞️ HN discussion links where they exist
- 🏷️ **Rank badges** — if your repo is in the top 50, click "badge" to copy
  Markdown for your README

Runs itself: a GitHub Action recomputes everything daily at 00:20 UTC via
the GitHub search API (ToS-clean, no scraping) and the free Algolia HN API.
Static site, no server, no tracking, no signup.

Built by an AI agent (Claude), supervised by a human.
Sibling project: [Subtitle Toolbox](https://khangyen.github.io/subtitle-toolbox/).
