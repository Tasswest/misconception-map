# Misconception Map

Misconception Map is a teacher-facing diagnostic workspace for middle-school algebra and fractions. It turns student work into evidence-backed misconception hypotheses, targeted practice, and predictions that can be tested against later answers.

The project is being built for the Education category of OpenAI Build Week. It is intentionally local-first: the web app and SQLite database run on one machine, while live diagnosis and generation use the OpenAI API.

## Setup

Prerequisites:

- Node.js 24 is recommended; Node.js 20.9 or newer is required.
- An OpenAI API key is required only for live AI features.

~~~bash
npm install
cp .env.example .env.local
npm run dev
~~~

Add your API key to .env.local:

~~~dotenv
OPENAI_API_KEY=your_key_here
~~~

The development command applies local SQLite migrations before starting the app. Open [http://localhost:3000](http://localhost:3000).

## Commands

- **npm run dev** — migrate the local database and start development mode.
- **npm run db:migrate** — apply pending SQL migrations.
- **npm run db:check** — verify database integrity and required bootstrap tables.
- **npm run lint** — run ESLint.
- **npm run typecheck** — run TypeScript without emitting files.
- **npm run build** — create a production build.
- **npm run check** — run lint, typecheck, and the production build.

The npm run seed command will be added with the deterministic demo dataset and synthetic student-work images.

## Architecture

- Next.js App Router and React Server Components for database-backed pages.
- Small client-side islands for uploads, progress, interactive heatmap cells, and print controls.
- SQLite through better-sqlite3, with versioned SQL migrations stored in db/migrations.
- Node.js Route Handlers for local file processing and OpenAI calls.
- OpenAI Responses API with gpt-5.6, vision inputs, and strict structured outputs.
- Local seeded content remains usable without an API key; live AI actions report configuration status explicitly.

## Misconception taxonomy

The taxonomy is limited to recurring middle-school algebra and fraction misconceptions. Each stable identifier will include diagnostic signals, counter-evidence, a repair move, and a verified citation-style source note. Diagnosis state such as CORRECT or NEEDS_REVIEW is kept separate from misconception identity.

## Student Model and Prediction Lab

A Student Model is a versioned, testable hypothesis about the strategy visible in a student's work. Predictions are stored before actual answers arrive and are evaluated with their denominator and coverage visible. The product does not present these models as fixed beliefs, ability labels, grades, or placement decisions.

## Privacy

Seed data and sample work are synthetic. Student display names remain in the local database and are not sent in OpenAI prompts. Teachers must de-identify live work before sending it for diagnosis. This hackathon build is not a substitute for an institution's student-data, consent, retention, or child-safety compliance review.

## How Codex and GPT-5.6 were used

This section is reserved for the project author to document the final build process, key decisions, Codex session details, and the exact GPT-5.6 workflows demonstrated in the submission.

## License

MIT
