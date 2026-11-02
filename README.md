# upwork-job-fit-scorer

Command-line scorer for a freelancer. Point it at job posts you pasted into text files and at a YAML skills profile. It ranks the posts and writes a Markdown report plus a JSON report, with a reason for every score.

The default mode is rules only. It does not log in to Upwork or any other site, and it does not open a network connection. An optional `--llm` flag can ask an OpenAI-compatible chat endpoint for a short note. That call is off unless you set the flag, and the rules still own the scores.

## Requirements

- Node.js 20 or newer
- npm

The only runtime dependency is [`yaml`](https://github.com/eemeli/yaml), which is pure JavaScript (no native addons).

## Install and run

```bash
npm install
npm run build
node dist/src/cli.js --help
node dist/src/cli.js --input fixtures/jobs --profile fixtures/profile.yaml --output job-fit-report
```

`npm test` builds the TypeScript and runs the offline test suite. You do not need an API key.

```bash
upwork-job-fit-scorer --input <file-or-dir> --profile <profile.yaml> [options]
```

| Flag | Meaning |
| --- | --- |
| `-i, --input <path>` | One job file, or a folder of `.txt` and `.md` files (not recursive) |
| `-p, --profile <path>` | YAML skills profile |
| `-o, --output <dir>` | Output directory. Default: `./job-fit-report` |
| `-f, --format <name>` | `both` (default), `md`, or `json` |
| `--min-score <n>` | Hide jobs whose overall score is below `n` (0–100) |
| `--llm` | Add a model note. Scores do not change |
| `-h, --help` | Show usage |
| `-v, --version` | Show the version |

A folder input reads only files in that folder. A single file input is accepted even if the name does not end in `.txt` or `.md`. Reports are `report.md` and `report.json` inside the output directory. Running again overwrites those two files. If you point `--output` at the same folder as `--input`, those generated report names are skipped on the next run. Other filenames are still read.

Exit codes: `0` report written, `2` bad arguments or input, `3` `--llm` was set and the model call is missing a key or failed, `1` unexpected error.

## Profile

```yaml
name: Jordan Hale
title: Full-stack TypeScript developer
skills:
  - name: TypeScript
    aliases: [ts]
  - Node.js
  - PostgreSQL
  - React
hourly_floor: 55          # required, major currency units, must be > 0
reference_hours: 10       # optional, used when a post only has a fixed budget
currency: USD             # optional, 3-letter code
red_flags:                # optional extra phrases
  - kindly do the needful
weights:                  # optional; if set, all five keys are required and must sum to 1
  skill_match: 0.30
  budget: 0.25
  client_signals: 0.15
  scope_clarity: 0.15
  scam_safety: 0.15
```

Unknown keys are rejected so a typo does not silently do nothing. Skill entries are strings, or `{ name, aliases }`.

List the skills you want a good post to mention. The skill score is the share of that list found in the post, so a long dump of every tool you have ever used lowers scores on focused work.

Built-in aliases cover common spellings such as `ts` for TypeScript, `node` / `nodejs` for Node.js, `postgres` for PostgreSQL, and `react.js` for React. Very short names that are also ordinary words (`Go`, `R`, `C`) match only in that capitalization, or via a longer alias such as `golang`.

The checked-in profile and job posts under `fixtures/` are fictional. They are not real clients, accounts, or personal data.

## How scoring works

Every dimension is an integer from 0 to 100. Higher is better, including scam safety (100 means the screen found no red flags). The overall score is the weighted sum, rounded to the nearest integer.

Default weights: skill match 0.30, budget 0.25, client signals 0.15, scope clarity 0.15, scam safety 0.15.

### Skill match

`round(100 * matched / listed)`. A skill matches if its name or an alias appears as its own word or phrase. Reasons list the matches and the skills that were not mentioned.

### Budget vs floor

The parser looks for an hourly rate (`$75-$95/hr`, `Hourly: $40`, or a standalone `Hourly` line under a dollar amount) and for a fixed budget (`Budget: $2200`, `Est. budget: $1,200`, or a standalone `Fixed-price` line). Amounts on client-spend lines such as `$25K+ spent` are not treated as the offer. If nothing is labeled, the first dollar amount is treated as a fixed budget and the reason says so.

The ratio is pay divided by your floor:

| Ratio | Score |
| --- | --- |
| 1.5 and above | 100 |
| 1.0 | 80 |
| 0.5 | 40 |
| 0 | 0 |

Between those points the score moves in a straight line. An hourly range uses the midpoint. A fixed budget that says `about 20 hours` (or a range such as `10-15 hours`) uses amount ÷ hours as the hourly rate. A fixed budget with no hour estimate is compared with `hourly_floor * reference_hours` (default 10 hours). If no pay figure is found, the score is 40.

### Client signals

Start at 50, because a paste often omits the usual badges. Then:

| Signal | Change |
| --- | --- |
| Payment method verified / not verified | +15 / −15 |
| Rating ≥ 4.8 / ≥ 4.5 / ≥ 4.0 / below 4.0 | +15 / +10 / +5 / −15 |
| Spend ≥ 10000 / ≥ 1000 | +10 / +5 |
| Hires ≥ 5 / ≥ 1 / 0 | +8 / +4 / −8 |
| Member for ≥ 3 years / ≥ 1 year | +7 / +3 |
| "Long-term" or "ongoing" | +5 |

The result is clamped to 0–100. Years use the UTC year of the run.

### Scope clarity

Start at 20. Add 20 for a description of at least 600 characters, or 12 for at least 280. Subtract 8 when it is under 140 characters. Add 18 for three or more bullets (8 for one or two), 16 when the post mentions deliverables or acceptance criteria, 16 for a timeline, and 12 for responsibilities or requirements. Subtract 12 for hype such as "rockstar", "ninja", or "quick task". Clamp to 0–100.

### Scam safety

Start at 100. Each category counts once, even if several phrases in that category match:

| Category | Penalty |
| --- | --- |
| Move off-platform (including email-me or Skype) | 35 |
| Pay to start (fee before work, gift card, buy a laptop, "you will be reimbursed") | 40 |
| Telegram | 30 |
| WhatsApp | 30 |
| Crypto payment wording | 25 |
| Fake check or overpayment | 40 |
| Unpaid work or "for exposure" | 20 |
| Each profile `red_flags` phrase | 15 |

This is a keyword screen, not a legal finding. It is biased toward caution: a genuine crypto contract still takes the crypto penalty, and a normal milestone that is funded in escrow does not. Words such as "cryptography", "check-ins", and the name Beth are not treated as hits. Profile phrases stack on top of the built-in categories, so you do not need to repeat "telegram" in `red_flags`.

### Rank and recommendation

- **Apply** — overall ≥ 75 and scam safety is 100.
- **Review** — overall ≥ 55, scam safety ≥ 50, and the post is not an Apply. A single caution phrase blocks Apply.
- **Skip** — everything else, including any post with scam safety below 50.

Posts below 50 scam safety are listed after the safer posts, even when their weighted overall looks high. Within each group, higher overall comes first.

## Reports

`report.md` is the reading copy: rank, recommendation, pay line, skill line, a score table, and the reasons under each dimension. `report.json` is the same result for scripts. It includes the rubric thresholds, the profile, extracted pay and client facts, matched skills, scam hits, and `llmSummary` (`null` in rules mode).

## LLM note

Set the flag and the environment variables:

```bash
export OPENAI_BASE_URL=https://api.openai.com/v1   # optional
export OPENAI_API_KEY=sk-...                       # required with --llm
export OPENAI_MODEL=gpt-4o-mini                    # optional
node dist/src/cli.js -i ./jobs -p ./profile.yaml --llm
```

The client sends one `POST` to `{OPENAI_BASE_URL}/chat/completions` and asks for a JSON object `{"summary":"..."}`. If `OPENAI_API_KEY` is missing, the process exits with code 3 and does not send a request. A failed call also exits 3 and does not write a report. The summary is stored as a note. It cannot change scores.

The base URL must be `http` or `https`. Redirects are not followed.

## Tests

```bash
npm test
```

Tests use `node:test`. They do not read API keys and they do not contact the network. The LLM client is exercised with a stub `fetch`. Fixtures under `fixtures/` are invented posts about invented studios (Northwind Studio, Brightlane Analytics, Maple and Co., Harbor Parcel Co.) and a fictional freelancer, Jordan Hale.

## License

MIT. See [LICENSE](LICENSE).
