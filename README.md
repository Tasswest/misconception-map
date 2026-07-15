# Misconception Map

Misconception Map is a teacher-facing diagnostic workspace for middle-school algebra and fractions. The complete product turns student work into evidence-backed misconception hypotheses, targeted practice, and predictions that can be tested against later answers. The app implements worksheet-aware assignment setup, local work intake, live diagnosis, a recoverable diagnosis queue, a clustered class misconception heatmap, printable corrected exams, targeted micro-practice, a Teach This Tomorrow brief, a deterministic 20-learner demo classroom, and the complete Prediction Lab signature flow.

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

The development command applies local SQLite migrations before starting the app. Open [http://localhost:3000](http://localhost:3000). Development and production servers bind to `127.0.0.1`; page and API boundaries also reject non-loopback `Host` headers, and state-changing API requests reject cross-origin browser calls. This phase has no user accounts because it is a single-teacher, single-machine workspace—do not expose it through a LAN binding or public reverse proxy.

For an isolated database, provide `MISCONCEPTION_MAP_DB_PATH` in the shell so both migration scripts and Next.js receive it; the standalone migration scripts do not load that override from `.env.local`:

~~~bash
MISCONCEPTION_MAP_DB_PATH=/tmp/misconception-map-smoke.db npm run dev
~~~

## Commands

- **npm run dev** — migrate the local database and start development mode.
- **npm start** — migrate the local database and serve a completed production build on loopback.
- **npm run db:migrate** — apply pending SQL migrations.
- **npm run seed** — idempotently load or restore the 20-learner synthetic demo class, two assignments, 200 diagnoses, targeted practice, a teaching brief, and provenance-valid held-out prediction history. No API key is required.
- **npm run sample-work** — regenerate eight synthetic handwritten-style JPEG fixtures in `sample-work/` using Sharp.
- **npm run db:check** — verify database integrity and required bootstrap tables.
- **npm run verify:phase1** — test taxonomy invariants, schema constraints, model versioning, frozen predictions, outcome matching, and model-update invalidation in an isolated temporary database.
- **npm run verify:phase2** — test the strict model-facing schema plus evidence grounding, domain, confidence, and abstention policies without calling the API.
- **npm run verify:images** — verify the exact handwriting regression fixture and the earlier algebra/fraction samples retain their complete, high-detail ink regions.
- **npm run verify:phase4** — verify Student Model output, the exact five-problem difficulty ramp, discrepant answers, the one-paragraph brief, final-answer extraction, and prediction/abstention contracts without calling the API.
- **npm run lint** — run ESLint.
- **npm run typecheck** — run TypeScript without emitting files.
- **npm run build** — create a production build.
- **npm run check** — run lint, typecheck, all deterministic verifiers, and the production build.

The same deterministic seed is available from the visible **Load demo classroom** button on Overview. It is safe to run repeatedly and restores an archived demo without duplicating rows. Eight name-free, synthetic handwritten-style images in `sample-work/` let judges exercise the photo upload flow without using real student work.

## Architecture

- Next.js App Router and React Server Components for database-backed pages.
- Small client-side islands for the upload queue, progress, worksheet review, interactive heatmap evidence drawer, generation actions, and browser print control.
- SQLite through better-sqlite3, with versioned SQL migrations stored in db/migrations.
- Node.js Route Handlers for local file processing and OpenAI calls.
- OpenAI Responses API with gpt-5.6, vision inputs, and strict structured outputs.
- Class and assignment setup, saved diagnoses, heatmaps, corrected exams, prediction history, and seeded artifacts remain usable without an API key; only new live AI actions require it.

### Live diagnosis path

1. A teacher creates a class and roster, then pastes or photographs a blank exam/worksheet once for an assignment. `gpt-5.6` extracts its problem statements and expected answers into a strict schema; the teacher reviews and confirms them before any student work is accepted.
2. A teacher can upload one full worksheet page per student and let the model match every visible work block to the confirmed assignment problem list. A single-problem photo or typed response can still target one item explicitly. Every path requires confirmation that student names were removed or covered.
3. Single-problem images are auto-oriented and cropped to a line-aware ink region. Full student pages deliberately skip pixel cropping. Both use adaptive local-contrast normalization with a soft noise floor, and each saved image also keeps a full-resolution, full-frame, metadata-stripped rendition for one low-confidence OCR retry.
4. The server sends only the assignment problem context and deidentified work—not the roster name or local filename—to `gpt-5.6` through the Responses API with `store: false` and original-detail vision input. A full page is sent once with the complete problem list so GPT performs semantic segmentation and diagnosis together.
5. The problem-aware prompt warns that handwritten equals signs can resemble short dashes and requires every line to be classified as an equation, expression, answer, annotation, or unparseable fragment. A strict root-object schema captures the exact transcription, observable steps, evidence quote, misconception candidate, confidence, severity, and review signals.
6. A separate deterministic policy rejects ungrounded quotes, cross-domain labels, poor transcriptions, and definitive diagnoses below `0.72`. For algebra images, an implausible final variable-bearing fragment that is not an equation caps transcription confidence below the review threshold instead of allowing a guessed label.
7. The successful API run, matched worksheet targets, immutable answer versions, preprocessing provenance, diagnosis, per-step `correctNote`/`errorNote`, ranked candidates, and OCR-attempt hashes, token use, latency, and selected rendition are committed atomically. Transport failures retain the local work in a safe retry state.

Saved queue items reload after navigation or refresh. In-flight jobs are polled by submission ID every two seconds, and runs left stale for three minutes become explicitly retryable. OpenAI calls time out after 85 seconds with no hidden SDK retry. Exact image re-uploads or repeated diagnosis requests replay the persisted result instead of creating duplicate work or duplicate API calls.

A wrong final answer alone never earns a misconception label. A definitive label requires an exact evidence quote, a transcription-grounded incorrect step, a distinct observed transformation tied to that step, and confidence of at least `0.72`; ambiguous, illegible, weakly grounded, or conflicting work is saved for teacher review instead.

### Heatmap dashboard

The assignment dashboard uses each problem answer’s latest diagnosis, including every answer segmented from a full page. Misconception columns are sorted by affected-student count, signal frequency, and severity; students in the largest cluster are sorted to the top so the dominant block starts at the upper left. Cells distinguish clear evidence, emerging/strong misconception evidence, teacher review, and not assessed. Opening an evidence cell shows the matched worksheet problem, exact transcription, evidence quote, and the flawed step highlighted in context. Each student row also opens a printable corrected-exam page with per-step ✓/✕ feedback, why-correct notes, and expected answers beside the targeted practice worksheet.

### Accessibility

Heatmap cells are native buttons with descriptive `aria-label` text that includes the student, misconception, signal state, severity, frequency, and evidence availability. Keyboard focus states are visible throughout the sidebar, entity lists, evidence drawer, corrected-exam links, and generation actions. Color is never the only signal: heatmap cells also use icons, numbers, labels, and tooltips, while printable corrected exams pair ✓/✕ marks with explicit “why this is right” or “why this needs revision” copy.

### Instructional support path

The dashboard can turn a supported misconception cell into targeted practice. On the first request for that student and misconception, `gpt-5.6` synthesizes a provisional, falsifiable rule hypothesis from the diagnosed transformation and exact evidence—not from the student’s name. The hypothesis records a human-readable action rule, a formal input/transformation/predicted-output pattern, scope limits, confidence, and its evidence link. It remains provisional after one response and is stored as an append-oriented Student Model version.

The practice generator uses that exact model version to create five structurally varied problems whose difficulty and position ramp from 1 through 5. Every item stores both the correct answer and the answer the provisional rule predicts; the schema rejects an item when those answers are the same. The printable two-page A4 view includes a student worksheet and teacher answer key with hints, misconception-specific explanations, and the visible mismatch. This is a **discrepant event**: the learner can compare the rule’s prediction with mathematical evidence, creating a concrete reason to revise the rule instead of merely being told it is wrong.

Teach This Tomorrow uses the assignment’s current largest supported cluster, aggregate evidence, and taxonomy repair move to create one paragraph: what the misconception is, a non-blaming account of why it can form, and a timed ten-minute intervention. A worked example is also stored as a generated problem and rendered separately for the board. Each brief freezes its cluster count, diagnosed-student denominator, evidence cutoff, and diagnosis links so the teacher can see which evidence snapshot it summarized.

Both flows use the Responses API with `gpt-5.6`, strict Structured Outputs, `store: false`, bounded inputs, explicit prompt/schema versions, hashes, response identifiers, token counts, and latency provenance. Student display names are added only when the saved worksheet is rendered locally; they are never part of model synthesis, practice, or brief payloads.

Intake accepts JPEG, PNG, and WebP images. Limits are 10 MB per photo, 20 photos and 80 MB per upload queue, 20 typed responses, and 8,000 characters per typed response. Programmatic API clients must send `Content-Length` for request bodies.

The implementation follows OpenAI's official [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) and [image input](https://developers.openai.com/api/docs/guides/images-vision) guidance. The model-facing schema is deliberately a strict object rather than the app's discriminated union because Structured Outputs requires an object root and required fields.

The SQLite model is intentionally append-oriented. Answer corrections, diagnoses, Student Models, and prediction outcomes create new versions instead of rewriting prior evidence. A Student Model starts provisional and becomes supported only through an append-only finalization that snapshots linked evidence from at least two distinct problems. A prediction is then tied to that exact supported model version and a specific future assignment item before the student responds.

The main data graph covers rosters, reusable problems, assignments, upload batches, submission assets, answer versions, diagnosis steps and candidates, Student Model evidence, frozen predictions, worksheets, teaching briefs, AI provenance, and redacted audit events. Composite foreign keys and scoped triggers prevent a student, assignment, problem, or generated artifact from crossing class boundaries accidentally.

## Misconception taxonomy

The taxonomy is limited to recurring middle-school algebra and fraction misconceptions. Each stable identifier includes diagnostic signals, counter-evidence, a repair move, a discriminating prediction probe, and a citation-style source note. Source records have verified bibliographic metadata; taxonomy mappings explicitly label indirect or conceptual support where direct evidence was not verified. Diagnosis states such as `CORRECT`, `NEEDS_REVIEW`, and `INSUFFICIENT_EVIDENCE` are deliberately kept separate from misconception identity.

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

A Student Model is a versioned, testable hypothesis about the strategy visible in a student's work. The first diagnosed response creates a provisional version tied to exact evidence. A model becomes `SUPPORTED` only after the database can link at least two responses on two distinct problem fingerprints with no contradiction. The Prediction Lab then applies that exact version to unseen problem content. The OpenAI request receives the formal flawed rule and target problem, but not the student name or correct answer.

Every prediction is locked and timestamped before student work exists. It freezes the Student Model version, target problem, predicted answer or explicit abstention, confidence, an auditable transformation trace, and AI provenance. Once held-out work is diagnosed, the app extracts the student's grounded final step locally and appends a deterministic outcome version. The visible score is stated as `3 of 4 matched`; accuracy uses only current, observed `MATCH`/`MISMATCH` trials. Coverage is rule-applied predictions divided by all current valid locks, so abstentions remain visible rather than disappearing from the denominator.

Predictions and outcomes are append-only. A later answer correction creates a new outcome version. Prior work discovered after locking, a withdrawn target, teacher invalidation, or a Student Model update keeps the original claim in history but marks it invalid and excludes it from accuracy and coverage. Superseding a model automatically invalidates every lock tied to the older version; trials never migrate silently to the new hypothesis.

### Test the Prediction Lab

1. Open [http://localhost:3000/prediction-lab](http://localhost:3000/prediction-lab) and select a class. A diagnosed misconception is listed as a candidate. Build or refresh its Student Model; prediction controls unlock only after two distinct supporting problems make it `SUPPORTED`.
2. Choose an unseen assignment problem, or expand **Create a typed held-out probe**. Enter the problem and expected answer, then click **Predict and lock** or **Create, predict, and lock**. The new history card shows its model version and lock time before any actual work is present.
3. Follow **Collect work on…**, enter or upload that student's held-out response, and run diagnosis. Return to Prediction Lab and click **Compare new work** if the automatic post-diagnosis reconciliation has not already refreshed the page. The card shows predicted, actual, and correct answers together; the student header shows `N of M matched`.
4. Create an out-of-scope probe to test abstention. It remains a valid locked trial, increases the abstention count, and lowers coverage without affecting accuracy.
5. Diagnose later work that adds evidence for the same misconception, then click **Check for model updates**. A new Student Model version is created. Every older lock remains visible as **Invalidated · excluded**, the reason is `model updated`, and current metrics reset until the new version has its own trials.

Matching is intentionally conservative and syntactic rather than computer-algebra-based. Whitespace, Unicode minus signs, and common multiplication/division glyphs normalize deterministically; nonidentical equivalent forms stay visible for later teacher review instead of being silently counted as matches. The product does not present Student Models as fixed beliefs, ability labels, grades, or placement decisions.

## Privacy

All seeded records are synthetic and use obvious labels such as `Demo learner 01`; they never reuse live roster names. The live regression fixture under `fixtures/student-work/` contains mathematical work only and no student name. Student display names remain in the local database and are not sent in OpenAI prompts. Teachers must use a blank, deidentified worksheet source and de-identify live work before saving it for diagnosis; the server requires those confirmations for both typed and photographed content. Before worksheet extraction or diagnosis, typed content is also blocked if it contains an exact roster name or a roster-name component of two or more characters. This roster check is not general personal-data detection. This hackathon build is not a substitute for an institution's student-data, consent, retention, or child-safety compliance review.

Roster labels and original filenames are used only to organize local work. They are excluded from request hashes and OpenAI payloads. De-identification is teacher-attested, not automatic: this phase strips image metadata but does not OCR, detect, blur, or redact names inside image pixels. Anything visible in a submitted photo is sent to OpenAI, so the upload screen requires the teacher to cover or remove names first. The local SQLite database, filenames, and normalized uploads persist on disk; the app does not encrypt or automatically purge them. Live diagnosis sends the teacher-attested work and assignment context to the OpenAI API with response storage disabled.

## How Codex and GPT-5.6 were used

This section is reserved for the project author to document the final build process, key decisions, Codex session details, and the exact GPT-5.6 workflows demonstrated in the submission.

## License

MIT
