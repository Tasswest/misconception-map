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
  UsersIcon,
} from "@/components/icons";
import type {
  AssignmentOption,
  ClassWorkspaceOption,
  StudentOption,
} from "@/components/diagnosis/types";

type SetupWorkspaceProps = {
  initialClasses: ClassWorkspaceOption[];
};

type ApiValue = Record<string, unknown>;

const gradeOptions = [
  ["GRADE_5", "Grade 5"],
  ["GRADE_6", "Grade 6"],
  ["GRADE_7", "Grade 7"],
  ["GRADE_8", "Grade 8"],
  ["MIXED_5_8", "Mixed grades 5–8"],
] as const;

const fieldClass =
  "mt-2 w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm text-[var(--ink)] outline-none transition placeholder:text-[var(--muted)]/55 focus:border-[var(--sage)] focus:ring-4 focus:ring-[var(--mint)]/25";

export function SetupWorkspace({ initialClasses }: SetupWorkspaceProps) {
  const [classes, setClasses] = useState(initialClasses);
  const [selectedClassId, setSelectedClassId] = useState(
    initialClasses.at(0)?.id ?? "",
  );
  const [className, setClassName] = useState("");
  const [gradeBand, setGradeBand] = useState<ClassWorkspaceOption["gradeBand"]>(
    "GRADE_7",
  );
  const [schoolYear, setSchoolYear] = useState("");
  const [studentNames, setStudentNames] = useState("");
  const [assignmentTitle, setAssignmentTitle] = useState("");
  const [domain, setDomain] = useState<AssignmentOption["domain"]>("ALGEBRA");
  const [problemPrompt, setProblemPrompt] = useState("");
  const [correctAnswer, setCorrectAnswer] = useState("");
  const [busy, setBusy] = useState<"class" | "students" | "assignment" | null>(
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
      !problemPrompt.trim() ||
      !correctAnswer.trim() ||
      busy
    ) {
      return;
    }

    setBusy("assignment");
    setError(null);
    setNotice(null);

    try {
      const payload = await postJson(
        `/api/classes/${encodeURIComponent(selectedClass.id)}/assignments`,
        {
          title: assignmentTitle.trim(),
          description: null,
          domain,
          problemPrompt: problemPrompt.trim(),
          correctAnswer: correctAnswer.trim(),
          answerFormat: domain === "FRACTIONS" ? "FRACTION" : "EXPRESSION",
        },
      );
      const record = unwrapRecord(payload, "assignment");
      const assignmentId = readString(record, "id");
      window.location.assign(`/assignments/${encodeURIComponent(assignmentId)}/diagnose`);
    } catch (caught) {
      setError(messageFromError(caught));
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-[1240px] px-5 py-8 md:px-8 lg:px-10 lg:py-10">
      <div className="max-w-3xl">
        <div className="inline-flex items-center gap-2 rounded-full bg-[var(--soft-mint)] px-3 py-1.5 text-xs font-semibold text-[var(--sidebar)]">
          <PlusIcon className="size-3.5" /> New diagnostic
        </div>
        <h1 className="mt-5 text-balance text-3xl font-semibold tracking-[-0.04em] md:text-5xl">
          Set up the class context, then add student work.
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--muted)]">
          The problem and expected answer anchor every diagnosis. Student names stay
          in your local workspace and are used only to organize the evidence.
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

          <form className="mt-5 space-y-5" onSubmit={createAssignment}>
            <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
              <label className="block text-sm font-semibold">
                Assignment title
                <input
                  className={fieldClass}
                  disabled={!selectedClass}
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
                  disabled={!selectedClass}
                  onChange={(event) => setDomain(event.target.value as AssignmentOption["domain"])}
                  value={domain}
                >
                  <option value="ALGEBRA">Algebra</option>
                  <option value="FRACTIONS">Fractions</option>
                </select>
              </label>
            </div>

            <label className="block text-sm font-semibold">
              Problem students answered
              <textarea
                className={fieldClass + " min-h-32 resize-y text-base leading-7"}
                disabled={!selectedClass}
                maxLength={2_000}
                onChange={(event) => setProblemPrompt(event.target.value)}
                placeholder="Expand and simplify: −3(x + 4) + 2x"
                required
                value={problemPrompt}
              />
              <span className="mt-2 block text-xs font-normal leading-5 text-[var(--muted)]">
                Include the exact prompt so the diagnosis can locate the first invalid step.
              </span>
            </label>

            <label className="block text-sm font-semibold">
              Expected answer
              <input
                className={fieldClass + " font-mono"}
                disabled={!selectedClass}
                maxLength={500}
                onChange={(event) => setCorrectAnswer(event.target.value)}
                placeholder="−x − 12"
                required
                value={correctAnswer}
              />
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

            <button
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--sidebar)] px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#244b42] disabled:cursor-not-allowed disabled:opacity-45"
              disabled={
                busy !== null ||
                !selectedClass ||
                selectedClass.students.length === 0 ||
                !assignmentTitle.trim() ||
                !problemPrompt.trim() ||
                !correctAnswer.trim()
              }
              type="submit"
            >
              {busy === "assignment" ? (
                <SpinnerIcon className="size-4 animate-spin" />
              ) : (
                <ArrowIcon className="size-4" />
              )}
              {busy === "assignment" ? "Preparing workspace…" : "Create and add student work"}
            </button>
          </form>
        </article>
      </section>
    </div>
  );
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
