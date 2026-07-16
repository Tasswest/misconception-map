"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import {
  AlertIcon,
  ArrowIcon,
  CheckIcon,
  ChevronIcon,
  ClipboardIcon,
  PlusIcon,
  SpinnerIcon,
  UploadIcon,
  UsersIcon,
} from "@/components/icons";
import { AssignmentStepper } from "@/components/assignment-stepper";
import type {
  AssignmentOption,
  ClassWorkspaceOption,
  StudentOption,
} from "@/components/diagnosis/types";
import type { DraftWorksheetSetup } from "@/server/repositories/worksheet";

type SetupWorkspaceProps = {
  initialClasses: ClassWorkspaceOption[];
  initialDraft: DraftWorksheetSetup | null;
};

type ApiValue = Record<string, unknown>;

type ExtractedQuestion = {
  questionLabel: string;
  problemStatement: string;
  domain: "ALGEBRA" | "FRACTIONS";
  answerKind: "EXPRESSION" | "NUMBER" | "FRACTION" | "MULTIPLE_CHOICE" | "SHORT_TEXT";
  expectedAnswer: string;
  extractionConfidence: number;
  answerConfidence: number;
  reviewNote: string | null;
};

type ExtractedExercise = {
  exerciseLabel: string;
  sharedContext: string | null;
  questions: ExtractedQuestion[];
};

type WorksheetReview = {
  assignmentId: string;
  overallConfidence: number;
  needsReview: boolean;
  exercises: ExtractedExercise[];
};

const gradeOptions = [
  ["GRADE_5", "Grade 5"],
  ["GRADE_6", "Grade 6"],
  ["GRADE_7", "Grade 7"],
  ["GRADE_8", "Grade 8"],
  ["MIXED_5_8", "Mixed grades 5–8"],
] as const;

const fieldClass =
  "mt-2 w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm text-[var(--ink)] outline-none transition placeholder:text-[var(--muted)]/55 focus:border-[var(--sage)] focus:ring-4 focus:ring-[var(--mint)]/25";

export function SetupWorkspace({
  initialClasses,
  initialDraft,
}: SetupWorkspaceProps) {
  const [classes, setClasses] = useState(initialClasses);
  const [selectedClassId, setSelectedClassId] = useState(
    initialDraft?.classId ?? initialClasses.at(0)?.id ?? "",
  );
  const [className, setClassName] = useState("");
  const [gradeBand, setGradeBand] = useState<ClassWorkspaceOption["gradeBand"]>(
    "GRADE_7",
  );
  const [schoolYear, setSchoolYear] = useState("");
  const [studentNames, setStudentNames] = useState("");
  const [assignmentTitle, setAssignmentTitle] = useState(
    initialDraft?.title ?? "",
  );
  const [domain, setDomain] = useState<AssignmentOption["domain"]>(
    initialDraft?.domain ?? "ALGEBRA",
  );
  const [worksheetSourceKind, setWorksheetSourceKind] = useState<"TYPED" | "IMAGE">("TYPED");
  const [worksheetText, setWorksheetText] = useState("");
  const [worksheetFile, setWorksheetFile] = useState<File | null>(null);
  const [worksheetDeidentified, setWorksheetDeidentified] = useState(false);
  const [worksheetReview, setWorksheetReview] = useState<WorksheetReview | null>(
    initialDraft?.review ?? null,
  );
  const [busy, setBusy] = useState<"class" | "students" | "assignment" | "confirm" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedClass = useMemo(
    () => classes.find((classroom) => classroom.id === selectedClassId) ?? null,
    [classes, selectedClassId],
  );

  const parsedStudentNames = useMemo(
    () =>
      Array.from(
        new Set(
          studentNames
            .split(/[\n,]/)
            .map((name) => name.trim())
            .filter(Boolean),
        ),
      ),
    [studentNames],
  );

  const extractionBlocker = !selectedClass
    ? "Create or select a class first."
    : selectedClass.students.length === 0
      ? "Add at least one student to the class first."
      : !assignmentTitle.trim()
        ? "Enter an assignment title to continue."
        : worksheetSourceKind === "TYPED" && !worksheetText.trim()
          ? "Paste the worksheet text to continue."
          : worksheetSourceKind === "IMAGE" && !worksheetFile
            ? "Choose a worksheet photo or PDF to continue."
            : !worksheetDeidentified
              ? "Confirm that this is a blank teacher copy to continue."
              : null;

  async function createClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!className.trim() || busy) return;

    setBusy("class");
    setError(null);
    setNotice(null);

    try {
      const payload = await postJson("/api/classes", {
        name: className.trim(),
        gradeBand,
        schoolYear: schoolYear.trim() || null,
      });
      const record = unwrapRecord(payload, "class");
      const classroom: ClassWorkspaceOption = {
        id: readString(record, "id"),
        name: readString(record, "name", className.trim()),
        gradeBand: readString(record, "gradeBand", gradeBand) as ClassWorkspaceOption["gradeBand"],
        schoolYear: readNullableString(record, "schoolYear"),
        students: [],
        assignments: [],
      };

      setClasses((current) => [...current, classroom]);
      setSelectedClassId(classroom.id);
      setClassName("");
      setNotice(`${classroom.name} is ready. Add the students you want to diagnose.`);
    } catch (caught) {
      setError(messageFromError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function addStudents(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedClass || parsedStudentNames.length === 0 || busy) return;

    setBusy("students");
    setError(null);
    setNotice(null);

    try {
      const created: StudentOption[] = [];
      for (const displayName of parsedStudentNames) {
        const payload = await postJson(
          `/api/classes/${encodeURIComponent(selectedClass.id)}/students`,
          { displayName },
        );
        const record = unwrapRecord(payload, "student", "membership");
        created.push({
          membershipId: readString(record, "membershipId", readString(record, "id")),
          displayName: readString(record, "displayName", displayName),
        });
      }

      setClasses((current) =>
        current.map((classroom) =>
          classroom.id === selectedClass.id
            ? { ...classroom, students: [...classroom.students, ...created] }
            : classroom,
        ),
      );
      setStudentNames("");
      setNotice(
        `${created.length} ${created.length === 1 ? "student" : "students"} added to ${selectedClass.name}.`,
      );
    } catch (caught) {
      setError(messageFromError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function createAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !selectedClass ||
      selectedClass.students.length === 0 ||
      !assignmentTitle.trim() ||
      !worksheetDeidentified ||
      (worksheetSourceKind === "TYPED" ? !worksheetText.trim() : !worksheetFile) ||
      busy
    ) {
      return;
    }

    setBusy("assignment");
    setError(null);
    setNotice(null);

    try {
      let assignmentId = initialDraft?.id ?? null;
      if (!assignmentId) {
        const payload = await postJson(
          `/api/classes/${encodeURIComponent(selectedClass.id)}/assignments`,
          {
            title: assignmentTitle.trim(),
            description: null,
            domain,
          },
        );
        const record = unwrapRecord(payload, "assignment");
        assignmentId = readString(record, "id");
      }
      const formData = new FormData();
      formData.set("sourceKind", worksheetSourceKind);
      formData.set("deidentified", "true");
      if (worksheetSourceKind === "TYPED") {
        formData.set("sourceText", worksheetText.trim());
      } else if (worksheetFile) {
        formData.set("sourceFile", worksheetFile, worksheetFile.name);
      }
      const extractionPayload = await postForm(
        `/api/assignments/${encodeURIComponent(assignmentId)}/worksheet`,
        formData,
      );
      const extraction = unwrapRecord(extractionPayload, "data");
      const exercises = readExtractedExercises(extraction.exercises);
      const questionCount = countExtractedQuestions(exercises);
      if (questionCount === 0) {
        throw new Error("No worksheet questions were returned for review.");
      }
      setWorksheetReview({
        assignmentId,
        overallConfidence: readNumber(extraction, "overallConfidence"),
        needsReview: extraction.needsReview === true,
        exercises,
      });
      setNotice(
        `${exercises.length} ${exercises.length === 1 ? "exercise" : "exercises"} and ${questionCount} ${questionCount === 1 ? "question" : "questions"} extracted. Check the structure, wording, and expected answers.`,
      );
      setBusy(null);
    } catch (caught) {
      setError(messageFromError(caught));
      setBusy(null);
    }
  }

  async function confirmWorksheet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!worksheetReview || busy) return;
    if (
      worksheetReview.exercises.some(
        (exercise) =>
          !exercise.exerciseLabel.trim() ||
          exercise.questions.some(
            (question) =>
              !question.questionLabel.trim() ||
              !question.problemStatement.trim() ||
              !question.expectedAnswer.trim(),
          ),
      )
    ) {
      setError("Every exercise and question needs a label, statement, and expected answer.");
      return;
    }

    setBusy("confirm");
    setError(null);
    try {
      await putJson(
        `/api/assignments/${encodeURIComponent(worksheetReview.assignmentId)}/worksheet`,
        { exercises: worksheetReview.exercises },
      );
      window.location.assign(
        `/assignments/${encodeURIComponent(worksheetReview.assignmentId)}/diagnose`,
      );
    } catch (caught) {
      setError(messageFromError(caught));
      setBusy(null);
    }
  }

  function updateExtractedExercise(
    exerciseIndex: number,
    patch: Partial<Omit<ExtractedExercise, "questions">>,
  ) {
    setWorksheetReview((current) =>
      current
        ? {
            ...current,
            exercises: current.exercises.map((exercise, index) =>
              index === exerciseIndex ? { ...exercise, ...patch } : exercise,
            ),
          }
        : current,
    );
  }

  function updateExtractedQuestion(
    exerciseIndex: number,
    questionIndex: number,
    patch: Partial<ExtractedQuestion>,
  ) {
    setWorksheetReview((current) =>
      current
        ? {
            ...current,
            exercises: current.exercises.map((exercise, index) =>
              index === exerciseIndex
                ? {
                    ...exercise,
                    questions: exercise.questions.map((question, nestedIndex) =>
                      nestedIndex === questionIndex
                        ? { ...question, ...patch }
                        : question,
                    ),
                  }
                : exercise,
            ),
          }
        : current,
    );
  }

  return (
    <div className="mx-auto max-w-[1240px] px-5 py-8 md:px-8 lg:px-10 lg:py-10">
      <AssignmentStepper className="mb-7" currentStep={1} />
      <div className="max-w-3xl">
        <div className="inline-flex items-center gap-2 rounded-full bg-[var(--soft-mint)] px-3 py-1.5 text-xs font-semibold text-[var(--sidebar)]">
          <PlusIcon className="size-3.5" /> New diagnostic
        </div>
        <h1 className="mt-5 text-balance text-3xl font-semibold tracking-[-0.04em] md:text-5xl">
          Set up the class context, then add student work.
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--muted)]">
          Add the exam or worksheet once, then confirm its extracted problems and
          expected answers. Student names stay in your local workspace and are used
          only to organize the evidence.
        </p>
      </div>

      <div aria-live="polite" className="mt-6 space-y-3">
        {error ? (
          <div className="flex items-start gap-3 rounded-2xl border border-[var(--coral)]/25 bg-[var(--soft-coral)] px-4 py-3 text-sm text-[#8e402d]">
            <AlertIcon className="mt-0.5 size-4 shrink-0" />
            <p>{error}</p>
          </div>
        ) : null}
        {notice ? (
          <div className="flex items-start gap-3 rounded-2xl border border-[var(--sage)]/20 bg-[var(--soft-mint)] px-4 py-3 text-sm text-[var(--sidebar)]">
            <CheckIcon className="mt-0.5 size-4 shrink-0" />
            <p>{notice}</p>
          </div>
        ) : null}
      </div>

      <section className="mt-7 grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="space-y-5">
          <article className="rounded-[24px] border border-black/[0.06] bg-[var(--paper)] p-6 shadow-[0_18px_45px_rgba(35,51,46,0.05)]">
            <StepHeading
              icon={<UsersIcon className="size-5" />}
              number="1"
              title={classes.length ? "Choose a class" : "Create a class"}
            />

            {classes.length ? (
              <label className="mt-5 block text-sm font-semibold">
                Class
                <select
                  className={fieldClass}
                  disabled={initialDraft !== null}
                  onChange={(event) => {
                    setSelectedClassId(event.target.value);
                    setError(null);
                    setNotice(null);
                  }}
                  value={selectedClassId}
                >
                  {classes.map((classroom) => (
                    <option key={classroom.id} value={classroom.id}>
                      {classroom.name} · {gradeLabel(classroom.gradeBand)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <details className="mt-5 rounded-2xl border border-black/[0.07] bg-white/65 p-4" open={!classes.length}>
              <summary className="cursor-pointer list-none text-sm font-semibold">
                {classes.length ? "Create another class" : "Class details"}
              </summary>
              <form className="mt-4 space-y-4" onSubmit={createClass}>
                <label className="block text-sm font-semibold">
                  Class name
                  <input
                    className={fieldClass}
                    maxLength={120}
                    onChange={(event) => setClassName(event.target.value)}
                    placeholder="Grade 7 Algebra"
                    required
                    value={className}
                  />
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-semibold">
                    Grade
                    <select
                      className={fieldClass}
                      onChange={(event) =>
                        setGradeBand(event.target.value as ClassWorkspaceOption["gradeBand"])
                      }
                      value={gradeBand}
                    >
                      {gradeOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-semibold">
                    School year <span className="font-normal text-[var(--muted)]">(optional)</span>
                    <input
                      className={fieldClass}
                      maxLength={20}
                      onChange={(event) => setSchoolYear(event.target.value)}
                      placeholder="2026–27"
                      value={schoolYear}
                    />
                  </label>
                </div>
                <PrimaryButton busy={busy === "class"} label="Create class" />
              </form>
            </details>
          </article>

          <article className="rounded-[24px] border border-black/[0.06] bg-[var(--paper)] p-6 shadow-[0_18px_45px_rgba(35,51,46,0.05)]">
            <StepHeading
              icon={<UsersIcon className="size-5" />}
              number="2"
              title="Add students"
            />
            {selectedClass ? (
              <>
                {selectedClass.students.length ? (
                  <div className="mt-5 flex flex-wrap gap-2">
                    {selectedClass.students.map((student) => (
                      <span
                        className="rounded-full border border-[var(--sage)]/15 bg-[var(--soft-mint)] px-3 py-1.5 text-xs font-semibold text-[var(--sidebar)]"
                        key={student.membershipId}
                      >
                        {student.displayName}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 rounded-xl bg-[var(--canvas)] px-4 py-3 text-sm text-[var(--muted)]">
                    No students yet. Add one name per line below.
                  </p>
                )}
                <form className="mt-5" onSubmit={addStudents}>
                  <label className="block text-sm font-semibold">
                    Student names
                    <textarea
                      className={fieldClass + " min-h-28 resize-y"}
                      onChange={(event) => setStudentNames(event.target.value)}
                      placeholder={"Amara M.\nJonas L.\nSofia K."}
                      value={studentNames}
                    />
                  </label>
                  <button
                    className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--canvas)] disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={busy !== null || parsedStudentNames.length === 0}
                    type="submit"
                  >
                    {busy === "students" ? (
                      <SpinnerIcon className="size-4 animate-spin" />
                    ) : (
                      <PlusIcon className="size-4" />
                    )}
                    Add {parsedStudentNames.length || ""} {parsedStudentNames.length === 1 ? "student" : "students"}
                  </button>
                </form>
              </>
            ) : (
              <p className="mt-4 text-sm text-[var(--muted)]">Create a class first.</p>
            )}
          </article>
        </div>

        <article
          className="rounded-[24px] border border-black/[0.06] bg-[var(--paper)] p-6 shadow-[0_18px_45px_rgba(35,51,46,0.05)] md:p-7"
          id="assignments"
        >
          <StepHeading
            icon={<ClipboardIcon className="size-5" />}
            number="3"
            title="Create a diagnostic assignment"
          />

          {selectedClass?.assignments.length ? (
            <div className="mt-5 space-y-2 border-b border-black/[0.06] pb-5">
              <p className="text-xs font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
                Continue an assignment
              </p>
              {selectedClass.assignments.map((assignment) => (
                <Link
                  className="group flex items-center justify-between rounded-xl border border-black/[0.07] bg-white/70 px-4 py-3 transition hover:border-[var(--sage)]/25 hover:bg-[var(--soft-mint)]"
                  href={`/assignments/${assignment.id}/diagnose`}
                  key={assignment.id}
                >
                  <span>
                    <span className="block text-sm font-semibold">{assignment.title}</span>
                    <span className="mt-0.5 block text-xs text-[var(--muted)]">
                      {domainLabel(assignment.domain)}
                    </span>
                  </span>
                  <ChevronIcon className="size-4 transition group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          ) : null}

          {worksheetReview ? (
            <form className="mt-5 space-y-5" onSubmit={confirmWorksheet}>
              <div className="rounded-2xl border border-[var(--sage)]/20 bg-[var(--soft-mint)]/70 p-4">
                <p className="text-sm font-semibold text-[var(--sidebar)]">
                  Check the extracted worksheet
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  GPT extracted {worksheetReview.exercises.length} {worksheetReview.exercises.length === 1 ? "exercise" : "exercises"} and {countExtractedQuestions(worksheetReview.exercises)} questions at {Math.round(worksheetReview.overallConfidence * 100)}% overall confidence. Your confirmation makes this structure the shared reference for every student submission.
                </p>
              </div>

              <div className="max-h-[680px] space-y-5 overflow-y-auto pr-1">
                {worksheetReview.exercises.map((exercise, exerciseIndex) => (
                  <section
                    className="overflow-hidden rounded-2xl border border-[var(--sage)]/20 bg-white/70"
                    key={`${exercise.exerciseLabel}-${exerciseIndex}`}
                  >
                    <div className="border-b border-[var(--sage)]/12 bg-[var(--soft-mint)]/55 p-4">
                      <label className="block text-xs font-bold uppercase tracking-[0.11em] text-[var(--sage)]">
                        Exercise label
                        <input
                          className={fieldClass + " text-sm normal-case tracking-normal"}
                          maxLength={200}
                          onChange={(event) =>
                            updateExtractedExercise(exerciseIndex, {
                              exerciseLabel: event.target.value,
                            })
                          }
                          required
                          value={exercise.exerciseLabel}
                        />
                      </label>
                      <label className="mt-3 block text-xs font-semibold text-[var(--muted)]">
                        Shared context <span className="font-normal">(shown once for the exercise)</span>
                        <textarea
                          className={fieldClass + " min-h-20 resize-y leading-6"}
                          maxLength={8_000}
                          onChange={(event) =>
                            updateExtractedExercise(exerciseIndex, {
                              sharedContext: event.target.value.trim()
                                ? event.target.value
                                : null,
                            })
                          }
                          placeholder="No shared context"
                          value={exercise.sharedContext ?? ""}
                        />
                      </label>
                    </div>

                    <div className="space-y-3 p-3">
                      {exercise.questions.map((question, questionIndex) => (
                        <article
                          className="rounded-xl border border-black/[0.07] bg-[var(--paper)] p-4"
                          key={`${question.questionLabel}-${questionIndex}`}
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                            <label className="block max-w-[220px] text-xs font-bold uppercase tracking-[0.11em] text-[var(--sage)]">
                              Question label
                              <input
                                className={fieldClass + " text-sm normal-case tracking-normal"}
                                maxLength={120}
                                onChange={(event) =>
                                  updateExtractedQuestion(exerciseIndex, questionIndex, {
                                    questionLabel: event.target.value,
                                  })
                                }
                                required
                                value={question.questionLabel}
                              />
                            </label>
                            <span className="pb-1 text-[10px] font-semibold text-[var(--muted)]">
                              Text {Math.round(question.extractionConfidence * 100)}% · answer {Math.round(question.answerConfidence * 100)}%
                            </span>
                          </div>
                          {question.reviewNote ? (
                            <p className="mt-3 rounded-xl bg-[var(--amber)]/15 px-3 py-2 text-xs leading-5 text-[#765725]">
                              {question.reviewNote}
                            </p>
                          ) : null}
                          <label className="mt-3 block text-sm font-semibold">
                            Self-contained problem statement
                            <textarea
                              className={fieldClass + " min-h-24 resize-y font-mono leading-6"}
                              maxLength={4_000}
                              onChange={(event) =>
                                updateExtractedQuestion(exerciseIndex, questionIndex, {
                                  problemStatement: event.target.value,
                                })
                              }
                              required
                              value={question.problemStatement}
                            />
                          </label>
                          <div className="mt-3 grid gap-3 sm:grid-cols-[150px_1fr]">
                            <label className="block text-sm font-semibold">
                              Domain
                              <select
                                className={fieldClass}
                                onChange={(event) =>
                                  updateExtractedQuestion(exerciseIndex, questionIndex, {
                                    domain: event.target.value as ExtractedQuestion["domain"],
                                  })
                                }
                                value={question.domain}
                              >
                                <option value="ALGEBRA">Algebra</option>
                                <option value="FRACTIONS">Fractions</option>
                              </select>
                            </label>
                            <label className="block text-sm font-semibold">
                              Expected answer
                              <input
                                className={fieldClass + " font-mono"}
                                maxLength={1_000}
                                onChange={(event) =>
                                  updateExtractedQuestion(exerciseIndex, questionIndex, {
                                    expectedAnswer: event.target.value,
                                  })
                                }
                                required
                                value={question.expectedAnswer}
                              />
                            </label>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>

              <button
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--sidebar)] px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#244b42] disabled:cursor-not-allowed disabled:opacity-45"
                disabled={busy !== null}
                type="submit"
              >
                {busy === "confirm" ? (
                  <SpinnerIcon className="size-4 animate-spin" />
                ) : (
                  <CheckIcon className="size-4" />
                )}
                {busy === "confirm"
                  ? "Confirming worksheet…"
                  : "Confirm worksheet and add student work"}
              </button>
            </form>
          ) : (
          <form className="mt-5 space-y-5" onSubmit={createAssignment}>
            <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
              <label className="block text-sm font-semibold">
                Assignment title
                <input
                  className={fieldClass}
                  disabled={!selectedClass || initialDraft !== null}
                  maxLength={160}
                  onChange={(event) => setAssignmentTitle(event.target.value)}
                  placeholder="Distributing negatives check"
                  required
                  value={assignmentTitle}
                />
              </label>
              <label className="block text-sm font-semibold">
                Domain
                <select
                  className={fieldClass}
                  disabled={!selectedClass || initialDraft !== null}
                  onChange={(event) => setDomain(event.target.value as AssignmentOption["domain"])}
                  value={domain}
                >
                  <option value="ALGEBRA">Algebra</option>
                  <option value="FRACTIONS">Fractions</option>
                </select>
              </label>
            </div>

            <fieldset>
              <legend className="text-sm font-semibold">Exam or worksheet</legend>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                Add the source once. Problems and expected answers will be extracted for review and reused across all student work.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-[var(--canvas)] p-1">
                {(["TYPED", "IMAGE"] as const).map((kind) => (
                  <button
                    className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${worksheetSourceKind === kind ? "bg-white text-[var(--sidebar)] shadow-sm" : "text-[var(--muted)]"}`}
                    key={kind}
                    onClick={() => {
                      setWorksheetSourceKind(kind);
                      setError(null);
                    }}
                    type="button"
                  >
                    {kind === "TYPED"
                      ? "Paste worksheet text"
                      : "Upload photo or PDF"}
                  </button>
                ))}
              </div>
            </fieldset>

            {worksheetSourceKind === "TYPED" ? (
              <label className="block text-sm font-semibold">
                Worksheet text
                <textarea
                  className={fieldClass + " min-h-48 resize-y font-mono text-sm leading-6"}
                  disabled={!selectedClass}
                  maxLength={30_000}
                  onChange={(event) => setWorksheetText(event.target.value)}
                  placeholder={"1. Solve −3(x + 4) = 0 for x.\n2. Add 1/2 + 1/3.\n\nAnswer key: 1. x = −4; 2. 5/6"}
                  required
                  value={worksheetText}
                />
              </label>
            ) : (
              <label className="block rounded-2xl border-2 border-dashed border-black/10 bg-white/55 p-6 text-center text-sm font-semibold">
                <UploadIcon className="mx-auto size-5 text-[var(--sage)]" />
                <span className="mt-2 block">
                  {worksheetFile
                    ? worksheetFile.name
                    : "Choose one worksheet photo or PDF"}
                </span>
                <span className="mt-1 block text-xs font-normal text-[var(--muted)]">
                  JPEG, PNG, WebP, or PDF · up to 15 MB
                </span>
                <input
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="mt-4 block w-full text-xs font-normal"
                  disabled={!selectedClass}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setWorksheetFile(file);
                    if (file && !assignmentTitle.trim()) {
                      setAssignmentTitle(titleFromFilename(file.name));
                    }
                  }}
                  required
                  type="file"
                />
              </label>
            )}

            <label className="flex items-start gap-3 rounded-xl border border-black/[0.07] bg-[var(--soft-mint)]/55 px-4 py-3 text-xs leading-5 text-[var(--muted)]">
              <input
                checked={worksheetDeidentified}
                className="mt-0.5 size-4 accent-[var(--sidebar)]"
                onChange={(event) => setWorksheetDeidentified(event.target.checked)}
                required
                type="checkbox"
              />
              <span>
                I’m using a blank teacher copy. It contains no student names or other student-identifying information.
              </span>
            </label>

            {!selectedClass ? (
              <p className="rounded-xl bg-[var(--canvas)] px-4 py-3 text-sm text-[var(--muted)]">
                Create or select a class to continue.
              </p>
            ) : selectedClass.students.length === 0 ? (
              <p className="flex items-start gap-2 rounded-xl bg-[var(--amber)]/15 px-4 py-3 text-sm text-[#765725]">
                <AlertIcon className="mt-0.5 size-4 shrink-0" /> Add at least one student before creating the assignment.
              </p>
            ) : null}

            {extractionBlocker && selectedClass?.students.length ? (
              <p
                className="flex items-start gap-2 rounded-xl border border-[var(--amber)]/25 bg-[var(--amber)]/10 px-4 py-3 text-sm font-medium text-[#765725]"
                id="extraction-blocker"
              >
                <AlertIcon className="mt-0.5 size-4 shrink-0" />
                {extractionBlocker}
              </p>
            ) : null}

            <button
              aria-describedby={extractionBlocker ? "extraction-blocker" : undefined}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--sidebar)] px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#244b42] disabled:cursor-not-allowed disabled:opacity-45"
              disabled={
                busy !== null ||
                !selectedClass ||
                selectedClass.students.length === 0 ||
                !assignmentTitle.trim() ||
                !worksheetDeidentified ||
                (worksheetSourceKind === "TYPED"
                  ? !worksheetText.trim()
                  : !worksheetFile)
              }
              type="submit"
            >
              {busy === "assignment" ? (
                <SpinnerIcon className="size-4 animate-spin" />
              ) : (
                <ArrowIcon className="size-4" />
              )}
              {busy === "assignment" ? "Extracting worksheet…" : "Extract problems for review"}
            </button>
          </form>
          )}
        </article>
      </section>
    </div>
  );
}

function titleFromFilename(filename: string) {
  const withoutExtension = filename.replace(/\.[^.]+$/u, "");
  const readable = withoutExtension
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return (readable || "Diagnostic assignment").slice(0, 160);
}

function StepHeading({
  number,
  title,
  icon,
}: {
  number: string;
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-9 place-items-center rounded-xl bg-[var(--soft-mint)] text-[var(--sidebar)]">
        {icon}
      </span>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--sage)]">
          Step {number}
        </p>
        <h2 className="mt-0.5 text-lg font-semibold tracking-[-0.02em]">{title}</h2>
      </div>
    </div>
  );
}

function PrimaryButton({ busy, label }: { busy: boolean; label: string }) {
  return (
    <button
      className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--sidebar)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#244b42] disabled:cursor-not-allowed disabled:opacity-45"
      disabled={busy}
      type="submit"
    >
      {busy ? <SpinnerIcon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
      {busy ? "Saving…" : label}
    </button>
  );
}

async function postJson(url: string, body: unknown): Promise<ApiValue> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as ApiValue;
  if (!response.ok) {
    const error = payload.error;
    const message =
      typeof error === "object" && error !== null && "message" in error
        ? String((error as ApiValue).message)
        : typeof payload.message === "string"
          ? payload.message
          : "The workspace could not be saved. Please try again.";
    throw new Error(message);
  }
  return payload;
}

async function putJson(url: string, body: unknown): Promise<ApiValue> {
  return requestApi(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postForm(url: string, body: FormData): Promise<ApiValue> {
  return requestApi(url, { method: "POST", body });
}

async function requestApi(url: string, init: RequestInit): Promise<ApiValue> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as ApiValue;
  if (!response.ok) {
    const error = payload.error;
    const message =
      typeof error === "object" && error !== null && "message" in error
        ? String((error as ApiValue).message)
        : typeof payload.message === "string"
          ? payload.message
          : "The workspace could not be saved. Please try again.";
    throw new Error(message);
  }
  return payload;
}

function unwrapRecord(payload: ApiValue, ...keys: string[]): ApiValue {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as ApiValue;
    }
  }
  if (typeof payload.data === "object" && payload.data !== null && !Array.isArray(payload.data)) {
    return payload.data as ApiValue;
  }
  return payload;
}

function readString(record: ApiValue, key: string, fallback = ""): string {
  const value = record[key];
  return typeof value === "string" && value ? value : fallback;
}

function readNullableString(record: ApiValue, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value ? value : null;
}

function readNumber(record: ApiValue, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readExtractedExercises(value: unknown): ExtractedExercise[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((exercise) => {
    if (typeof exercise !== "object" || exercise === null || Array.isArray(exercise)) {
      return [];
    }
    const record = exercise as ApiValue;
    const exerciseLabel = readString(record, "exerciseLabel");
    const questionsValue = record.questions;
    if (!exerciseLabel || !Array.isArray(questionsValue)) return [];
    const questions = questionsValue.flatMap((question) => {
      if (typeof question !== "object" || question === null || Array.isArray(question)) {
        return [];
      }
      const questionRecord = question as ApiValue;
      const questionLabel = readString(questionRecord, "questionLabel");
      const problemStatement = readString(questionRecord, "problemStatement");
      const domain = readString(questionRecord, "domain");
      const answerKind = readString(questionRecord, "answerKind");
      const expectedAnswer = readString(questionRecord, "expectedAnswer");
      if (
        !questionLabel ||
        !problemStatement ||
        (domain !== "ALGEBRA" && domain !== "FRACTIONS") ||
        ![
          "EXPRESSION",
          "NUMBER",
          "FRACTION",
          "MULTIPLE_CHOICE",
          "SHORT_TEXT",
        ].includes(answerKind) ||
        !expectedAnswer
      ) {
        return [];
      }
      return [{
        questionLabel,
        problemStatement,
        domain: domain as ExtractedQuestion["domain"],
        answerKind: answerKind as ExtractedQuestion["answerKind"],
        expectedAnswer,
        extractionConfidence: readNumber(questionRecord, "extractionConfidence"),
        answerConfidence: readNumber(questionRecord, "answerConfidence"),
        reviewNote: readNullableString(questionRecord, "reviewNote"),
      }];
    });
    if (questions.length === 0) return [];
    return [
      {
        exerciseLabel,
        sharedContext: readNullableString(record, "sharedContext"),
        questions,
      },
    ];
  });
}

function countExtractedQuestions(exercises: ExtractedExercise[]) {
  return exercises.reduce(
    (count, exercise) => count + exercise.questions.length,
    0,
  );
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function gradeLabel(gradeBand: ClassWorkspaceOption["gradeBand"]) {
  return gradeOptions.find(([value]) => value === gradeBand)?.[1] ?? gradeBand;
}

function domainLabel(domain: AssignmentOption["domain"]) {
  if (domain === "MIXED") return "Algebra + fractions";
  return domain === "ALGEBRA" ? "Algebra" : "Fractions";
}
