# Misconception Map working agreement

## Product priorities

Misconception Map is a local, teacher-facing diagnostic tool for middle-school algebra and fractions. The Student Model and Prediction Lab are the signature feature, and deterministic demo data is required for every runnable handoff.

If schedule pressure requires cuts, cut in this order:

1. Teacher override editing
2. CSV import
3. Additional accessibility polish

Do not cut or reduce the Prediction Lab, prediction history, or seeded demo data.

## Technical constraints

- Next.js App Router, TypeScript, Tailwind CSS, and local SQLite through better-sqlite3.
- gpt-5.6 is the only OpenAI model used for live AI features.
- No external services other than the OpenAI API.
- Do not add dependencies without explicit user approval. Zod and Sharp are approved.
- Database and OpenAI modules are server-only and must run in the Node.js runtime.
- Raw student names must never be sent to OpenAI. Demo work must remain synthetic.
- Treat student rules as versioned hypotheses, not fixed attributes or ability labels.

## Verification

Run npm run lint, npm run typecheck, npm run build, and an app-level smoke test after each phase. Keep commits granular and descriptive. Flag any taxonomy citation that cannot be verified from a primary or stable scholarly source before it is added to code or documentation.
