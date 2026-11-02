# Changelog

## 1.0.0 - 2026-11-02

- Initial command-line scorer for pasted job posts.
- Rule-based scores for skill match, budget versus the hourly floor, client signals, scope clarity, and scam safety.
- Ranked Markdown and JSON reports with reasons for every score.
- Optional `--llm` note from an OpenAI-compatible endpoint. Scores stay on the rules.
- Fictional fixtures and offline `node:test` coverage. No job-board access.
