# Captain context

- Treat `tilt up` as the default local orchestration surface. Start and observe long-running services through Tilt instead of ad hoc background servers when practical. If encountering OOM issues, use `TILT_PROFILE=lean tilt up` to run a reduced stack.
- For narrow work, prefer resource filtering: `tilt up -- web api usage-record frontend-api` (positional args after `--`); useful resources include `web`, `mission-control`, `api`, `video-api`, `embeddings-api`, `rerank-api`, `usage-record`, `auth`, `tts-api`, and `stt-api`.
- Interactive auth may require a human or existing session: Infisical, Google Cloud, 1Password, Clerk, Stripe, Speakeasy, and similar CLIs should not be assumed available in automation.
- Main ports: web 3000, mission-control 3001, cfw-api 8787, video-api 8788, embeddings-api 8789, rerank-api 8790, tts-api 8791, stt-api 8792, usage-record 8801, auth 8802, ClickHouse Play 8123, RustFS Console 9001, Temporal UI 8233.
- Primary references: `AGENTS.md` (root and nested), `README.md`, `Tiltfile`, and `scripts/infisical/INFISICAL.md`.
