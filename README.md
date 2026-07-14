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
- **npm run verify:phase1** — test taxonomy invariants, schema constraints, model versioning, and frozen-prediction behavior in an isolated temporary database.
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

The SQLite model is intentionally append-oriented. Answer corrections, diagnoses, Student Models, and prediction outcomes create new versions instead of rewriting prior evidence. A Student Model starts provisional and becomes supported only through an append-only finalization that snapshots linked evidence from at least two distinct problems. A prediction is then tied to that exact supported model version and a specific future assignment item before the student responds.

The main data graph covers rosters, reusable problems, assignments, upload batches, submission assets, answer versions, diagnosis steps and candidates, Student Model evidence, frozen predictions, worksheets, teaching briefs, AI provenance, and redacted audit events. Composite foreign keys and scoped triggers prevent a student, assignment, problem, or generated artifact from crossing class boundaries accidentally.

## Misconception taxonomy

The taxonomy is limited to recurring middle-school algebra and fraction misconceptions. Each stable identifier includes diagnostic signals, counter-evidence, a repair move, a discriminating prediction probe, and a verified citation-style source note. Diagnosis states such as `CORRECT`, `NEEDS_REVIEW`, and `INSUFFICIENT_EVIDENCE` are deliberately kept separate from misconception identity.

| Domain | Stable identifier | Diagnostic distinction | Research anchors |
| --- | --- | --- | --- |
| Algebra | `EQUALITY_AS_OPERATOR` | Reads `=` as “calculate/write the answer next,” not equivalence. | Kieran (1981); Knuth et al. (2006) |
| Algebra | `VARIABLE_AS_LABEL` | Treats a letter as an object label instead of a numerical quantity. | Küchemann (1978); Booth (1984) |
| Algebra | `COEFFICIENT_EXPONENT_CONFUSION` | Uses exponent notation where a coefficient or repeated addition is intended. | MacGregor & Stacey (1997); Lim (2010) |
| Algebra | `UNLIKE_TERMS_CONJOINED` | Forces unlike terms into one combined term. | MacGregor & Stacey (1997); Lim (2010) |
| Algebra | `DISTRIBUTION_ONE_TERM_ONLY` | Applies an outside factor to only one term. | Lim (2010); Sleeman (1984) |
| Algebra | `SIGN_ERROR_DISTRIBUTION` | Expands a negative factor while changing only some enclosed signs. | Vlassis (2004); Lim (2010) |
| Algebra | `INVERSE_OPERATION_CONFUSION` | Performs a transformation that does not preserve equation equivalence. | Steinberg et al. (1991); Kieran (1981) |
| Algebra | `NEGATIVE_SIGN_ROLE_CONFUSION` | Conflates subtraction, negative number, and unary opposite roles. | Vlassis (2004) |
| Algebra | `ORDER_OF_OPERATIONS_FLAT` | Ignores grouping or operation precedence and evaluates left to right. | Linchevski & Livneh (1999); Lim (2010) |
| Fractions | `FRACTION_AS_TWO_NUMBERS` | Treats numerator and denominator as independent whole numbers. | Stafylidou & Vosniadou (2004); Ni & Zhou (2005) |
| Fractions | `FRACTION_COMPONENTWISE_ADD_SUBTRACT` | Adds or subtracts numerator and denominator independently. | Siegler & Pyke (2013); Ni & Zhou (2005) |
| Fractions | `DENOMINATOR_MAGNITUDE_REVERSAL` | Assumes a larger denominator means a larger fraction. | Stafylidou & Vosniadou (2004); Ni & Zhou (2005) |
| Fractions | `FRACTION_EQUIVALENCE_ADDITIVE` | Records an explicit or repeated same-addend transformation when generating an equivalent fraction. | Ni (2001); Kamii & Clark (1995), as conceptual anchors |
| Fractions | `COMMON_DENOMINATOR_OVERGENERALIZATION` | Transfers a common-denominator rule to multiplication or division. | Siegler & Pyke (2013); Newton et al. (2014) |
| Fractions | `FRACTION_DIVISION_RECIPROCAL_ERROR` | Misapplies a reciprocal procedure, such as inverting the dividend. | Siegler & Pyke (2013); Newton et al. (2014) |
| Fractions | `UNIT_WHOLE_IGNORED` | Loses track of the referent whole or unit. | Behr et al. (1983); Yoshida & Sawano (2002) |

The code-authored taxonomy is validated with Zod and synchronized into immutable, versioned SQLite snapshots. Historical diagnoses therefore keep the exact label, definition, and citations they were created against. Full bibliographic metadata and source links live in `src/domain/research-sources.mjs`.

These categories describe observable error patterns, not hidden or fixed beliefs. One response can create only a provisional working hypothesis. A Student Model becomes supported only with repeated, structurally varied evidence, and contradictory evidence remains attached rather than being discarded.

## Student Model and Prediction Lab

A Student Model is a versioned, testable hypothesis about the strategy visible in a student's work. Predictions are stored against future assignment items before actual answers arrive and are evaluated with their denominator and coverage visible. If older work is imported after a prediction was locked, that prediction is retained but invalidated and excluded from accuracy. The product does not present these models as fixed beliefs, ability labels, grades, or placement decisions.

## Privacy

Seed data and sample work are synthetic. Student display names remain in the local database and are not sent in OpenAI prompts. Teachers must de-identify live work before sending it for diagnosis. This hackathon build is not a substitute for an institution's student-data, consent, retention, or child-safety compliance review.

## How Codex and GPT-5.6 were used

This section is reserved for the project author to document the final build process, key decisions, Codex session details, and the exact GPT-5.6 workflows demonstrated in the submission.

## License

MIT
