import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const COLORS = {
  background: "#0d1117",
  panel: "#161b22",
  border: "#30363d",
  primary: "#58a6ff",
  green: "#7ee787",
  purple: "#a371f7",
  orange: "#ffa657",
  text: "#f0f6fc",
  muted: "#8b949e",
};

// ponytail: 100 covers the current public inventory; paginate after it exceeds 100 owned repos.
const QUERY = `
  query ProfileWidgets($login: String!) {
    user(login: $login) {
      createdAt
      followers { totalCount }
      repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC) {
        nodes { isArchived isFork stargazerCount }
      }
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount } }
        }
        totalPullRequestContributions
        totalPullRequestReviewContributions
      }
    }
  }
`;

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function calculateStreaks(days) {
  const activity = days
    .flat()
    .sort((left, right) => left.date.localeCompare(right.date))
    .map(({ contributionCount }) => contributionCount > 0);

  let longest = 0;
  let running = 0;
  for (const active of activity) {
    running = active ? running + 1 : 0;
    longest = Math.max(longest, running);
  }

  let index = activity.length - 1;
  if (index >= 0 && !activity[index]) index -= 1;
  let current = 0;
  while (index >= 0 && activity[index]) {
    current += 1;
    index -= 1;
  }
  return { current, longest };
}

function normalize(user) {
  const repositories = user.repositories.nodes.filter((repo) => !repo.isFork);
  const contributions = user.contributionsCollection;
  const streaks = calculateStreaks(contributions.contributionCalendar.weeks.map(({ contributionDays }) => contributionDays));

  return {
    since: new Date(user.createdAt).getUTCFullYear(),
    followers: user.followers.totalCount,
    repositories: repositories.length,
    activeRepositories: repositories.filter((repo) => !repo.isArchived).length,
    stars: repositories.reduce((total, repo) => total + repo.stargazerCount, 0),
    contributions: contributions.contributionCalendar.totalContributions,
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    pullRequests: contributions.totalPullRequestContributions,
    reviews: contributions.totalPullRequestReviewContributions,
  };
}

function renderStreak(username, stats) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="230" viewBox="0 0 800 230" role="img" aria-label="${escapeXml(username)} GitHub contribution streak">
  <rect width="800" height="230" rx="16" fill="${COLORS.background}" stroke="${COLORS.border}"/>
  <text x="30" y="39" fill="${COLORS.green}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="20" font-weight="700">$ git streak --visible</text>
  <text x="30" y="66" fill="${COLORS.muted}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="13">generated daily from the GitHub contribution calendar</text>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">
    ${statCard({ x: 30, label: "current streak", value: stats.currentStreak, color: COLORS.green, width: 222 })}
    ${statCard({ x: 267, label: "longest streak", value: stats.longestStreak, color: COLORS.orange, width: 222 })}
    ${statCard({ x: 504, label: "contributions / 12mo", value: stats.contributions, color: COLORS.primary, width: 266 })}
  </g>
</svg>`;
}

function statCard({ x, label, value, color, width = 142 }) {
  const center = width / 2;
  return `
    <g transform="translate(${x} 92)">
      <rect width="${width}" height="105" rx="12" fill="${COLORS.panel}" stroke="${COLORS.border}"/>
      <rect width="${width}" height="4" rx="2" fill="${color}"/>
      <text x="${center}" y="50" text-anchor="middle" fill="${COLORS.text}" font-size="29" font-weight="700">${escapeXml(compact.format(value))}</text>
      <text x="${center}" y="78" text-anchor="middle" fill="${COLORS.muted}" font-size="13">${escapeXml(label)}</text>
    </g>`;
}

function renderStats(username, stats) {
  const cards = [
    ["contributions / 12mo", stats.contributions, COLORS.green],
    ["public repos", stats.repositories, COLORS.primary],
    ["stars earned", stats.stars, COLORS.orange],
    ["pull requests", stats.pullRequests, COLORS.purple],
    ["code reviews", stats.reviews, COLORS.green],
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="230" viewBox="0 0 800 230" role="img" aria-label="${escapeXml(username)} GitHub statistics">
  <rect width="800" height="230" rx="16" fill="${COLORS.background}" stroke="${COLORS.border}"/>
  <text x="30" y="39" fill="${COLORS.primary}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="20" font-weight="700">$ github nerd-stats --visible</text>
  <text x="30" y="66" fill="${COLORS.muted}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="13">GitHub since ${stats.since} · ${stats.activeRepositories} active original repositories · generated from GitHub GraphQL</text>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">
    ${cards.map(([label, value, color], index) => statCard({ x: 30 + index * 153, label, value, color })).join("")}
  </g>
</svg>`;
}

function trophy({ x, title, value, caption, color }) {
  return `
    <g transform="translate(${x} 68)">
      <rect width="222" height="112" rx="14" fill="${COLORS.panel}" stroke="${COLORS.border}"/>
      <circle cx="32" cy="31" r="12" fill="${color}" opacity="0.22"/>
      <circle cx="32" cy="31" r="6" fill="${color}"/>
      <text x="53" y="36" fill="${color}" font-size="13" font-weight="700">${escapeXml(title)}</text>
      <text x="22" y="76" fill="${COLORS.text}" font-size="25" font-weight="700">${escapeXml(value)}</text>
      <text x="22" y="98" fill="${COLORS.muted}" font-size="12">${escapeXml(caption)}</text>
    </g>`;
}

function renderTrophies(username, stats) {
  const trophies = [
    ["THE BUILDER", compact.format(stats.repositories), "original public repositories", COLORS.primary],
    ["THE CONSISTENT ONE", compact.format(stats.contributions), "visible contributions / 12mo", COLORS.green],
    ["THE COLLABORATOR", compact.format(stats.pullRequests + stats.reviews), "pull requests + reviews", COLORS.purple],
    ["THE FOLLOWED NERD", compact.format(stats.followers), "humans following along", COLORS.orange],
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="205" viewBox="0 0 1000 205" role="img" aria-label="${escapeXml(username)} GitHub trophy shelf">
  <rect width="1000" height="205" rx="16" fill="${COLORS.background}" stroke="${COLORS.border}"/>
  <text x="30" y="39" fill="${COLORS.text}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="20" font-weight="700">🏆 handmade trophy shelf</text>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">
    ${trophies.map(([title, value, caption, color], index) => trophy({ x: 30 + index * 238, title, value, caption, color })).join("")}
  </g>
</svg>`;
}

async function fetchProfile(username, token) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "nimesh-profile-widgets",
    },
    body: JSON.stringify({ query: QUERY, variables: { login: username } }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL returned ${response.status}`);
  }

  const payload = await response.json();
  if (payload.errors?.length || !payload.data?.user) {
    throw new Error(payload.errors?.map(({ message }) => message).join("; ") || "GitHub user not found");
  }

  return normalize(payload.data.user);
}

function selfTest() {
  const fixture = normalize({
    createdAt: "2020-03-19T00:00:00Z",
    followers: { totalCount: 27 },
    repositories: {
      nodes: [
        { isArchived: false, isFork: false, stargazerCount: 3 },
        { isArchived: false, isFork: true, stargazerCount: 99 },
      ],
    },
    contributionsCollection: {
      contributionCalendar: {
        totalContributions: 1234,
        weeks: [{
          contributionDays: [
            { date: "2026-08-10", contributionCount: 1 },
            { date: "2026-08-11", contributionCount: 1 },
            { date: "2026-08-12", contributionCount: 0 },
            { date: "2026-08-13", contributionCount: 2 },
            { date: "2026-08-14", contributionCount: 3 },
          ],
        }],
      },
      totalPullRequestContributions: 20,
      totalPullRequestReviewContributions: 30,
    },
  });

  assert.equal(fixture.repositories, 1);
  assert.equal(fixture.stars, 3);
  assert.deepEqual([fixture.currentStreak, fixture.longestStreak], [2, 2]);
  assert.match(renderStats("Nimesh & Co", fixture), /Nimesh &amp; Co/);
  assert.match(renderTrophies("Nimesh", fixture), /THE FOLLOWED NERD/);
  assert.match(renderStreak("Nimesh", fixture), /current streak/);
  console.log("profile widget self-test passed");
}

async function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }

  const username = process.env.PROFILE_USERNAME || process.env.GITHUB_REPOSITORY_OWNER;
  const token = process.env.GITHUB_TOKEN;
  const outputDirectory = process.env.OUTPUT_DIR || "dist";
  if (!username || !token) {
    throw new Error("PROFILE_USERNAME and GITHUB_TOKEN are required");
  }

  const stats = await fetchProfile(username, token);
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(`${outputDirectory}/github-stats.svg`, renderStats(username, stats)),
    writeFile(`${outputDirectory}/github-streak.svg`, renderStreak(username, stats)),
    writeFile(`${outputDirectory}/github-trophies.svg`, renderTrophies(username, stats)),
  ]);
  console.log(`generated profile widgets for ${username}`);
}

await main();
