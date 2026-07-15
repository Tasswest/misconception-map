"use client";

import Link from "next/link";
import type { ChangeEvent, DragEvent, FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertIcon,
  ArrowIcon,
  CheckIcon,
  FileTextIcon,
  ImageIcon,
  PlusIcon,
  RefreshIcon,
  SpinnerIcon,
  UploadIcon,
  XIcon,
} from "@/components/icons";
import type {
  DiagnosisStep,
  DiagnosisSummary,
  PersistedDiagnosisQueueItem,
  StudentOption,
} from "@/components/diagnosis/types";

const MAX_PHOTOS = 20;
const MAX_TYPED_RESPONSES = 20;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BATCH_BYTES = 80 * 1024 * 1024;
const REVIEW_CONFIDENCE_THRESHOLD = 0.72;
const acceptedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const selectClass =
  "w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--sage)] focus:ring-4 focus:ring-[var(--mint)]/25 disabled:cursor-not-allowed disabled:bg-black/[0.03] disabled:text-[var(--muted)]";

type AssignmentContext = {
  id: string;
  classId: string;
  className: string;
  title: string;
  description: string | null;
  domain: "ALGEBRA" | "FRACTIONS" | "MIXED";
  items: Array<{
    id: string;
    position: number;
    prompt: string;
    correctAnswer: string;
    answerFormat: string;
  }>;
};

type QueueStatus =
  | "READY"
  | "SAVED"
  | "SAVING"
  | "WAITING"
  | "DIAGNOSING"
  | "COMPLETE"
  | "REVIEW"
  | "FAILED";

type QueueBase = {
  clientId: string;
  membershipId: string;
  scopeKind: "SINGLE_PROBLEM" | "FULL_PAGE";
  assignmentItemId: string | null;
  status: QueueStatus;
  createdAt: number;
  submissionId?: string;
  result?: DiagnosisSummary;
  error?: string;
};

type PhotoQueueItem = QueueBase & {
  kind: "PHOTO";
  filename: string;
  file: File | null;
  previewUrl: string | null;
  byteSize: number | null;
};

type TypedQueueItem = QueueBase & {
  kind: "TYPED";
  responseText: string;
};

type QueueItem = PhotoQueueItem | TypedQueueItem;

type IntakeItem = {
  clientId: string;
  submissionId: string;
  filename?: string;
};

type DiagnosisJob = {
  clientId: string;
  submissionId: string;
};

type ApiRecord = Record<string, unknown>;

export function DiagnosisWorkbench({
  assignment,
  initialItems,
  students,
  liveAiReady,
}: {
  assignment: AssignmentContext;
  initialItems: PersistedDiagnosisQueueItem[];
  students: StudentOption[];
  liveAiReady: boolean;
}) {
  const [activeTab, setActiveTab] = useState<"PHOTOS" | "TYPED">("PHOTOS");
  const [photoItems, setPhotoItems] = useState<PhotoQueueItem[]>(() =>
    initialItems
      .map(queueItemFromPersisted)
      .filter((item): item is PhotoQueueItem => item.kind === "PHOTO"),
  );
  const [typedItems, setTypedItems] = useState<TypedQueueItem[]>(() =>
    initialItems
      .map(queueItemFromPersisted)
      .filter((item): item is TypedQueueItem => item.kind === "TYPED"),
  );
  const [typedStudentId, setTypedStudentId] = useState(
    students.length === 1 ? students[0].membershipId : "",
  );
  const [typedAssignmentItemId, setTypedAssignmentItemId] = useState(
    assignment.items.length === 1 ? assignment.items[0].id : "",
  );
  const [typedResponse, setTypedResponse] = useState("");
  const [dragging, setDragging] = useState(false);
  const [intakeErrors, setIntakeErrors] = useState<string[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [workDeidentificationConfirmed, setWorkDeidentificationConfirmed] =
    useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrls = useRef(new Set<string>());
  const queueSequence = useRef(0);

  const allItems = useMemo(
    () =>
      [...photoItems, ...typedItems].sort(
        (left, right) => left.createdAt - right.createdAt,
      ),
    [photoItems, typedItems],
  );
  const counts = useMemo(() => summarizeQueue(allItems), [allItems]);
  const processing = counts.processing > 0;
  const actionableItems = allItems.filter(
    (item) => item.status === "READY" || item.status === "SAVED",
  );
  const unsavedActionableItems = actionableItems.filter(
    (item) => !item.submissionId,
  );
  const readyWithMissingStudent = actionableItems.some(
    (item) => !item.membershipId,
  );
  const readyWithMissingProblem = actionableItems.some(
    (item) => item.scopeKind === "SINGLE_PROBLEM" && !item.assignmentItemId,
  );
  const workAttestationMissing =
    unsavedActionableItems.length > 0 && !workDeidentificationConfirmed;
  const queuedPhotoCount = photoItems.filter(
    (item) => !item.submissionId,
  ).length;
  const queuedTypedCount = typedItems.filter(
    (item) => !item.submissionId,
  ).length;
  const processingSubmissionKey = allItems
    .filter((item) => item.status === "DIAGNOSING" && item.submissionId)
    .map((item) => item.submissionId)
    .sort()
    .join("|");

  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  useEffect(() => {
    if (!processingSubmissionKey) return;

    let cancelled = false;
    let inFlight = false;
    const refreshPersistedQueue = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const payload = await requestJson(
          `/api/assignments/${encodeURIComponent(assignment.id)}/diagnosis-queue`,
        );
        if (cancelled) return;
        const hydrated = parsePersistedQueueItems(payload).map(
          queueItemFromPersisted,
        );
        setPhotoItems((current) =>
          mergePersistedQueueItems(
            current,
            hydrated.filter(
              (item): item is PhotoQueueItem => item.kind === "PHOTO",
            ),
          ),
        );
        setTypedItems((current) =>
          mergePersistedQueueItems(
            current,
            hydrated.filter(
              (item): item is TypedQueueItem => item.kind === "TYPED",
            ),
          ),
        );
      } catch {
        // Keep the current progress state; the next local poll can recover.
      } finally {
        inFlight = false;
      }
    };

    void refreshPersistedQueue();
    const interval = window.setInterval(refreshPersistedQueue, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [assignment.id, processingSubmissionKey]);

  function updateItem(clientId: string, patch: Partial<QueueBase>) {
    setPhotoItems((current) =>
      current.map((item) =>
        item.clientId === clientId ? { ...item, ...patch } : item,
      ),
    );
    setTypedItems((current) =>
      current.map((item) =>
        item.clientId === clientId ? { ...item, ...patch } : item,
      ),
    );
  }

  function updateTypedResponse(clientId: string, responseText: string) {
    setWorkDeidentificationConfirmed(false);
    setTypedItems((current) =>
      current.map((item) =>
        item.clientId === clientId ? { ...item, responseText } : item,
      ),
    );
  }

  function addFiles(files: File[]) {
    if (processing || files.length === 0) return;

    const errors: string[] = [];
    const knownSignatures = new Set(
      photoItems.flatMap((item) =>
        item.file ? [fileSignature(item.file)] : [],
      ),
    );
    const additions: PhotoQueueItem[] = [];
    let remainingSlots = MAX_PHOTOS - queuedPhotoCount;
    let queuedBytes = photoItems.reduce(
      (total, item) => total + (item.file?.size ?? 0),
      0,
    );

    for (const file of files) {
      if (remainingSlots <= 0) {
        errors.push(`Only ${MAX_PHOTOS} photos can be added at once.`);
        break;
      }
      if (file.size === 0) {
        errors.push(`${file.name || "Unnamed file"} is empty.`);
        continue;
      }
      if (!acceptedImageTypes.has(file.type)) {
        errors.push(`${file.name} is not a JPEG, PNG, or WebP image.`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        errors.push(`${file.name} is larger than 10 MB.`);
        continue;
      }
      if (queuedBytes + file.size > MAX_BATCH_BYTES) {
        errors.push("This photo queue would exceed the 80 MB batch limit.");
        continue;
      }

      const signature = fileSignature(file);
      if (knownSignatures.has(signature)) {
        errors.push(`${file.name} is already in this queue.`);
        continue;
      }

      const previewUrl = URL.createObjectURL(file);
      previewUrls.current.add(previewUrl);
      knownSignatures.add(signature);
      queueSequence.current += 1;
      additions.push({
        clientId: createClientId(),
        kind: "PHOTO",
        file,
        filename: file.name,
        previewUrl,
        byteSize: file.size,
        membershipId: students.length === 1 ? students[0].membershipId : "",
        scopeKind:
          assignment.items.length > 1 ? "FULL_PAGE" : "SINGLE_PROBLEM",
        assignmentItemId:
          assignment.items.length === 1 ? assignment.items[0].id : null,
        status: "READY",
        createdAt: queueSequence.current,
      });
      remainingSlots -= 1;
      queuedBytes += file.size;
    }

    setPhotoItems((current) => [...current, ...additions]);
    if (additions.length > 0) setWorkDeidentificationConfirmed(false);
    setIntakeErrors(Array.from(new Set(errors)));
    setRunError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function onFileInput(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files ?? []));
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  }

  function addTypedItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (processing) return;

    if (queuedTypedCount >= MAX_TYPED_RESPONSES) {
      setIntakeErrors([`Only ${MAX_TYPED_RESPONSES} typed responses can be added at once.`]);
      return;
    }

    const cleanResponse = typedResponse.trim();
    if (!cleanResponse) {
      setIntakeErrors(["Enter the student response before adding it."]);
      return;
    }

    queueSequence.current += 1;
    setTypedItems((current) => [
      ...current,
      {
        clientId: createClientId(),
        kind: "TYPED",
        responseText: cleanResponse,
        membershipId: typedStudentId,
        scopeKind: "SINGLE_PROBLEM",
        assignmentItemId: typedAssignmentItemId,
        status: "READY",
        createdAt: queueSequence.current,
      },
    ]);
    setTypedResponse("");
    setIntakeErrors([]);
    setRunError(null);
    setWorkDeidentificationConfirmed(false);
  }

  function removeItem(item: QueueItem) {
    if (processing || item.submissionId) return;
    if (item.kind === "PHOTO") {
      if (item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
        previewUrls.current.delete(item.previewUrl);
      }
      setPhotoItems((current) =>
        current.filter((candidate) => candidate.clientId !== item.clientId),
      );
    } else {
      setTypedItems((current) =>
        current.filter((candidate) => candidate.clientId !== item.clientId),
      );
    }
  }

  async function persistPhotos(items: PhotoQueueItem[]): Promise<DiagnosisJob[]> {
    if (items.length === 0) return [];
    const uploadableItems = items.filter(
      (item): item is PhotoQueueItem & { file: File } => item.file !== null,
    );
    if (uploadableItems.length !== items.length) {
      items.forEach((item) =>
        updateItem(item.clientId, {
          status: "FAILED",
          error: "This saved photo could not be prepared for upload.",
        }),
      );
      return [];
    }
    items.forEach((item) =>
      updateItem(item.clientId, { status: "SAVING", error: undefined }),
    );

    try {
      const formData = new FormData();
      for (const item of uploadableItems) {
        formData.append("files", item.file, item.file.name);
      }
      formData.append(
        "metadata",
        JSON.stringify({
          deidentified: true,
          items: uploadableItems.map((item) => ({
            clientId: item.clientId,
            membershipId: item.membershipId,
            scopeKind: item.scopeKind,
            assignmentItemId: item.assignmentItemId,
          })),
        }),
      );

      const payload = await requestJson(
        `/api/assignments/${encodeURIComponent(assignment.id)}/upload-batches`,
        { method: "POST", body: formData },
      );
      const savedItems = parseIntakeItems(payload);
      const savedByClientId = new Map(
        savedItems.map((item) => [item.clientId, item]),
      );

      return uploadableItems.flatMap((item) => {
        const saved = savedByClientId.get(item.clientId);
        if (!saved) {
          updateItem(item.clientId, {
            status: "FAILED",
            error: "The photo was not returned by the local save step.",
          });
          return [];
        }
        updateItem(item.clientId, {
          status: "WAITING",
          submissionId: saved.submissionId,
          error: undefined,
        });
        return [{ clientId: item.clientId, submissionId: saved.submissionId }];
      });
    } catch (error) {
      const message = messageFromError(error);
      items.forEach((item) =>
        updateItem(item.clientId, { status: "FAILED", error: message }),
      );
      return [];
    }
  }

  async function persistTyped(items: TypedQueueItem[]): Promise<DiagnosisJob[]> {
    if (items.length === 0) return [];
    items.forEach((item) =>
      updateItem(item.clientId, { status: "SAVING", error: undefined }),
    );

    try {
      const payload = await requestJson(
        `/api/assignments/${encodeURIComponent(assignment.id)}/typed-submissions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deidentified: true,
            items: items.map((item) => ({
              clientId: item.clientId,
              membershipId: item.membershipId,
              assignmentItemId: item.assignmentItemId,
              responseText: item.responseText,
            })),
          }),
        },
      );
      const savedItems = parseIntakeItems(payload);
      const savedByClientId = new Map(
        savedItems.map((item) => [item.clientId, item]),
      );

      return items.flatMap((item) => {
        const saved = savedByClientId.get(item.clientId);
        if (!saved) {
          updateItem(item.clientId, {
            status: "FAILED",
            error: "The response was not returned by the local save step.",
          });
          return [];
        }
        updateItem(item.clientId, {
          status: "WAITING",
          submissionId: saved.submissionId,
          error: undefined,
        });
        return [{ clientId: item.clientId, submissionId: saved.submissionId }];
      });
    } catch (error) {
      const message = messageFromError(error);
      items.forEach((item) =>
        updateItem(item.clientId, { status: "FAILED", error: message }),
      );
      return [];
    }
  }

  async function diagnoseSubmission(job: DiagnosisJob) {
    updateItem(job.clientId, { status: "DIAGNOSING", error: undefined });
    try {
      const payload = await requestJson(
        `/api/submissions/${encodeURIComponent(job.submissionId)}/diagnose`,
        { method: "POST" },
      );
      const result = parseDiagnosis(payload, job.submissionId);
      updateItem(job.clientId, {
        status: diagnosisNeedsReview(result) ? "REVIEW" : "COMPLETE",
        result,
        error: undefined,
      });
    } catch (error) {
      updateItem(job.clientId, {
        status: "FAILED",
        error: messageFromError(error),
      });
    }
  }

  async function persistAndDiagnose(items: QueueItem[]) {
    if (!liveAiReady || items.length === 0) return;
    if (
      items.some(
        (item) =>
          !item.membershipId ||
          (item.scopeKind === "SINGLE_PROBLEM" && !item.assignmentItemId),
      )
    ) {
      setRunError(
        "Choose a student and worksheet problem for every queued item before diagnosing.",
      );
      return;
    }
    const unsavedItems = items.filter((item) => !item.submissionId);
    if (unsavedItems.length > 0 && !workDeidentificationConfirmed) {
      setRunError(
        "Confirm that student names were removed or covered in every queued response before diagnosing.",
      );
      return;
    }

    setRunError(null);
    const savedJobs = items.flatMap((item) =>
      item.submissionId
        ? [{ clientId: item.clientId, submissionId: item.submissionId }]
        : [],
    );
    const [photoJobs, typedJobs] = await Promise.all([
      persistPhotos(
        unsavedItems.filter(
          (item): item is PhotoQueueItem => item.kind === "PHOTO",
        ),
      ),
      persistTyped(
        unsavedItems.filter(
          (item): item is TypedQueueItem => item.kind === "TYPED",
        ),
      ),
    ]);
    await runWithConcurrency(
      [...savedJobs, ...photoJobs, ...typedJobs],
      2,
      diagnoseSubmission,
    );
  }

  async function retryItem(item: QueueItem) {
    if (!liveAiReady || processing) return;
    if (item.submissionId) {
      await diagnoseSubmission({
        clientId: item.clientId,
        submissionId: item.submissionId,
      });
      return;
    }
    await persistAndDiagnose([item]);
  }

  function clearFinished() {
    if (processing) return;
    const finishedIds = new Set(
      allItems
        .filter((item) => item.status === "COMPLETE" || item.status === "REVIEW")
        .map((item) => item.clientId),
    );
    for (const item of photoItems) {
      if (finishedIds.has(item.clientId) && item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
        previewUrls.current.delete(item.previewUrl);
      }
    }
    setPhotoItems((current) =>
      current.filter((item) => !finishedIds.has(item.clientId)),
    );
    setTypedItems((current) =>
      current.filter((item) => !finishedIds.has(item.clientId)),
    );
  }

  return (
    <div className="mx-auto max-w-[1380px] px-5 py-7 md:px-8 lg:px-10 lg:py-9">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--muted)]">
            <Link className="transition hover:text-[var(--ink)]" href="/diagnose">
              Classes
            </Link>
            <span aria-hidden="true">/</span>
            <span>{assignment.className}</span>
            <span aria-hidden="true">/</span>
            <span className="text-[var(--sage)]">Add work</span>
          </div>
          <h1 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.04em] md:text-4xl">
            {assignment.title}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Match each piece of work to a student, then diagnose two submissions at a time.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          <Link
            className="rounded-full border border-black/[0.08] bg-white px-3.5 py-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--paper)]"
            href={`/assignments/${assignment.id}/dashboard`}
          >
            View heatmap
          </Link>
          <div className="flex items-center gap-2 rounded-full border border-black/[0.07] bg-white/65 px-3 py-2 text-xs font-semibold text-[var(--muted)]">
            <span
              className={`size-2 rounded-full ${liveAiReady ? "bg-[var(--sage)]" : "bg-[var(--amber)]"}`}
            />
            {liveAiReady ? "Live diagnosis ready" : "Setup required for live diagnosis"}
          </div>
        </div>
      </div>

      <div className="mt-7 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 space-y-5">
          {!liveAiReady ? (
            <div className="flex items-start gap-3 rounded-2xl border border-[var(--amber)]/35 bg-[var(--amber)]/15 px-4 py-3.5 text-sm leading-6 text-[#765725]">
              <AlertIcon className="mt-1 size-4 shrink-0" />
              <p>
                Add <code className="rounded bg-white/60 px-1.5 py-0.5 text-xs">OPENAI_API_KEY</code> to your local environment and restart the app to run live diagnosis. You can still prepare the queue now.
              </p>
            </div>
          ) : null}

          <article className="overflow-hidden rounded-[24px] border border-black/[0.06] bg-[var(--paper)] shadow-[0_18px_45px_rgba(35,51,46,0.05)]">
            <div className="flex border-b border-black/[0.06] px-5 pt-4 md:px-6">
              <TabButton
                active={activeTab === "PHOTOS"}
                icon={<ImageIcon className="size-4" />}
                label="Photos"
                onClick={() => setActiveTab("PHOTOS")}
              />
              <TabButton
                active={activeTab === "TYPED"}
                icon={<FileTextIcon className="size-4" />}
                label="Typed answers"
                onClick={() => setActiveTab("TYPED")}
              />
            </div>

            <div className="p-5 md:p-6">
              {activeTab === "PHOTOS" ? (
                <div
                  className={`relative grid min-h-56 place-items-center rounded-[20px] border-2 border-dashed p-7 text-center transition ${
                    dragging
                      ? "border-[var(--sage)] bg-[var(--soft-mint)]"
                      : "border-black/10 bg-white/55 hover:border-[var(--sage)]/45 hover:bg-[var(--soft-mint)]/35"
                  } ${processing || queuedPhotoCount >= MAX_PHOTOS ? "pointer-events-none opacity-60" : ""}`}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setDragging(false);
                    }
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={onDrop}
                >
                  <input
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    disabled={processing || queuedPhotoCount >= MAX_PHOTOS}
                    id="student-work-files"
                    multiple
                    onChange={onFileInput}
                    ref={inputRef}
                    type="file"
                  />
                  <div>
                    <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--soft-mint)] text-[var(--sidebar)]">
                      <UploadIcon className="size-5" />
                    </span>
                    <h2 className="mt-4 text-base font-semibold">
                      {queuedPhotoCount >= MAX_PHOTOS
                        ? "Photo limit reached"
                        : dragging
                          ? "Drop photos here"
                          : "Drop handwritten work here"}
                    </h2>
                    <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">
                      JPEG, PNG, or WebP · up to 10 MB each · {MAX_PHOTOS} photos per queue
                    </p>
                    <label
                      className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold shadow-sm transition hover:bg-[var(--canvas)]"
                      htmlFor="student-work-files"
                    >
                      <PlusIcon className="size-4" /> Choose photos
                    </label>
                  </div>
                </div>
              ) : (
                <form className="space-y-4" onSubmit={addTypedItem}>
                  <div className="grid gap-4 md:grid-cols-[240px_1fr]">
                    <div className="space-y-4">
                      <label className="block text-sm font-semibold">
                        Student
                        <select
                          className={selectClass + " mt-2"}
                          disabled={processing}
                          onChange={(event) => setTypedStudentId(event.target.value)}
                          value={typedStudentId}
                        >
                          <option value="">Choose a student</option>
                          {students.map((student) => (
                            <option key={student.membershipId} value={student.membershipId}>
                              {student.displayName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-sm font-semibold">
                        Worksheet problem
                        <select
                          className={selectClass + " mt-2"}
                          disabled={processing}
                          onChange={(event) => setTypedAssignmentItemId(event.target.value)}
                          value={typedAssignmentItemId}
                        >
                          <option value="">Choose a problem</option>
                          {assignment.items.map((problem) => (
                            <option key={problem.id} value={problem.id}>
                              {problem.position}. {problem.prompt}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="block text-sm font-semibold">
                      Student response
                      <textarea
                        className="mt-2 min-h-36 w-full resize-y rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm leading-6 text-[var(--ink)] outline-none transition placeholder:text-[var(--muted)]/55 focus:border-[var(--sage)] focus:ring-4 focus:ring-[var(--mint)]/25"
                        disabled={processing}
                        maxLength={8_000}
                        onChange={(event) => setTypedResponse(event.target.value)}
                        placeholder={"−3(x + 4) + 2x\n= −3x + 12 + 2x\n= −x + 12"}
                        value={typedResponse}
                      />
                    </label>
                  </div>
                  <div className="flex justify-end">
                    <button
                      className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--canvas)] disabled:cursor-not-allowed disabled:opacity-45"
                      disabled={
                        processing ||
                        !typedResponse.trim() ||
                        !typedStudentId ||
                        !typedAssignmentItemId ||
                        queuedTypedCount >= MAX_TYPED_RESPONSES
                      }
                      type="submit"
                    >
                      <PlusIcon className="size-4" />
                      {queuedTypedCount >= MAX_TYPED_RESPONSES
                        ? "Typed response limit reached"
                        : "Add typed response"}
                    </button>
                  </div>
                </form>
              )}

              {intakeErrors.length ? (
                <div className="mt-4 rounded-2xl border border-[var(--coral)]/25 bg-[var(--soft-coral)] px-4 py-3 text-sm text-[#8e402d]" role="alert">
                  <div className="flex items-start gap-2">
                    <AlertIcon className="mt-0.5 size-4 shrink-0" />
                    <div>
                      <p className="font-semibold">Some work was not added</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-5">
                        {intakeErrors.map((message) => (
                          <li key={message}>{message}</li>
                        ))}
                      </ul>
                    </div>
                    <button
                      aria-label="Dismiss validation messages"
                      className="ml-auto rounded-lg p-1 transition hover:bg-white/50"
                      onClick={() => setIntakeErrors([])}
                      type="button"
                    >
                      <XIcon className="size-4" />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </article>

          <article className="rounded-[24px] border border-black/[0.06] bg-[var(--paper)] p-5 shadow-[0_18px_45px_rgba(35,51,46,0.05)] md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.13em] text-[var(--sage)]">
                  Diagnosis queue
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-[-0.025em]">
                  {queueHeadline(counts)}
                </h2>
              </div>
              {counts.finished > 0 && !processing ? (
                <button
                  className="text-xs font-semibold text-[var(--muted)] transition hover:text-[var(--ink)]"
                  onClick={clearFinished}
                  type="button"
                >
                  Clear finished
                </button>
              ) : null}
            </div>

            {allItems.length === 0 ? (
              <div className="mt-5 grid min-h-48 place-items-center rounded-2xl border border-black/[0.06] bg-white/50 px-5 text-center">
                <div>
                  <span className="mx-auto grid size-10 place-items-center rounded-xl bg-[var(--canvas)] text-[var(--muted)]">
                    <ImageIcon className="size-5" />
                  </span>
                  <p className="mt-3 text-sm font-semibold">No student work queued</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                    Add one full worksheet page per student, or add typed responses by problem.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {allItems.map((item) => (
                  <QueueCard
                    item={item}
                    key={item.clientId}
                    onMembershipChange={(membershipId) =>
                      updateItem(item.clientId, { membershipId })
                    }
                    onProblemChange={(selection) =>
                      updateItem(
                        item.clientId,
                        selection === "__FULL_PAGE__"
                          ? { scopeKind: "FULL_PAGE", assignmentItemId: null }
                          : {
                              scopeKind: "SINGLE_PROBLEM",
                              assignmentItemId: selection || null,
                            },
                      )
                    }
                    onRemove={() => removeItem(item)}
                    onResponseChange={(responseText) =>
                      updateTypedResponse(item.clientId, responseText)
                    }
                    onRetry={() => void retryItem(item)}
                    processing={processing}
                    problems={assignment.items}
                    studentName={
                      students.find(
                        (student) => student.membershipId === item.membershipId,
                      )?.displayName ?? "Unassigned"
                    }
                    students={students}
                  />
                ))}
              </div>
            )}

            {runError ? (
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-[var(--soft-coral)] px-4 py-3 text-sm text-[#8e402d]" role="alert">
                <AlertIcon className="mt-0.5 size-4 shrink-0" /> {runError}
              </p>
            ) : null}
            {readyWithMissingStudent ? (
              <p className="mt-4 text-xs font-medium text-[#8e6328]">
                Choose a student for each ready item to enable diagnosis.
              </p>
            ) : null}
            {readyWithMissingProblem ? (
              <p className="mt-2 text-xs font-medium text-[#8e6328]">
                Match each ready item to the worksheet problem it answers.
              </p>
            ) : null}
            {unsavedActionableItems.length > 0 ? (
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--sage)]/20 bg-[var(--soft-mint)]/70 px-4 py-3 text-xs leading-5 text-[var(--ink)]">
                <input
                  checked={workDeidentificationConfirmed}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--sidebar)]"
                  disabled={processing}
                  onChange={(event) =>
                    setWorkDeidentificationConfirmed(event.target.checked)
                  }
                  type="checkbox"
                />
                <span>
                  I checked this work and removed or covered every student name
                  in the response content.
                </span>
              </label>
            ) : null}

            <div className="mt-5 flex flex-col gap-3 border-t border-black/[0.06] pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-md text-xs leading-5 text-[var(--muted)]" aria-live="polite">
                {queueProgressCopy(counts)}
              </p>
              <button
                className="inline-flex min-w-48 items-center justify-center gap-2 rounded-xl bg-[var(--sidebar)] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#244b42] disabled:cursor-not-allowed disabled:opacity-45"
                disabled={
                  processing ||
                  !liveAiReady ||
                  actionableItems.length === 0 ||
                  readyWithMissingStudent ||
                  readyWithMissingProblem ||
                  workAttestationMissing
                }
                onClick={() => void persistAndDiagnose(actionableItems)}
                type="button"
              >
                {processing ? (
                  <SpinnerIcon className="size-4 animate-spin" />
                ) : (
                  <ArrowIcon className="size-4" />
                )}
                {processing
                  ? "Diagnosing two at a time…"
                  : `Diagnose ${actionableItems.length || "queued"} ${actionableItems.length === 1 ? "response" : "responses"}`}
              </button>
            </div>
          </article>
        </section>

        <aside className="space-y-5 xl:sticky xl:top-6">
          <article className="rounded-[24px] border border-black/[0.06] bg-[var(--paper)] p-6 shadow-[0_18px_45px_rgba(35,51,46,0.05)]">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-[0.13em] text-[var(--sage)]">
                Assignment context
              </p>
              <span className="rounded-full bg-[var(--soft-mint)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--sidebar)]">
                {domainLabel(assignment.domain)}
              </span>
            </div>
            <h2 className="mt-4 text-lg font-semibold">Extracted worksheet</h2>
            <div className="mt-3 max-h-[440px] space-y-3 overflow-y-auto pr-1">
              {assignment.items.map((problem) => (
                <div
                  className="rounded-2xl border border-black/[0.06] bg-white/65 p-4"
                  key={problem.id}
                >
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--sage)]">
                    Problem {problem.position}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap font-mono text-sm leading-6 text-[var(--ink)]">
                    {problem.prompt}
                  </p>
                  <p className="mt-3 rounded-xl bg-[var(--soft-mint)] px-3 py-2 font-mono text-xs font-semibold text-[var(--sidebar)]">
                    Expected: {problem.correctAnswer}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-5 text-xs leading-5 text-[var(--muted)]">
              This shared context helps the model separate a calculation slip from a consistent misconception.
            </p>
          </article>

          <article className="rounded-[20px] border border-[var(--sage)]/20 bg-[var(--soft-mint)] p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--sidebar)]">
              <CheckIcon className="size-4" /> Local-first intake
            </div>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              Work is saved locally first. Roster names and filenames are never
              sent to OpenAI, and image metadata is removed. Every upload and
              typed response requires an explicit check that names in the work
              content were removed or covered.
            </p>
          </article>
        </aside>
      </div>
    </div>
  );
}

function TabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-selected={active}
      className={`relative flex items-center gap-2 px-4 py-3 text-sm font-semibold transition ${
        active ? "text-[var(--sidebar)]" : "text-[var(--muted)] hover:text-[var(--ink)]"
      }`}
      onClick={onClick}
      role="tab"
      type="button"
    >
      {icon} {label}
      {active ? (
        <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[var(--sage)]" />
      ) : null}
    </button>
  );
}

function QueueCard({
  item,
  students,
  problems,
  studentName,
  processing,
  onMembershipChange,
  onProblemChange,
  onResponseChange,
  onRemove,
  onRetry,
}: {
  item: QueueItem;
  students: StudentOption[];
  problems: AssignmentContext["items"];
  studentName: string;
  processing: boolean;
  onMembershipChange: (membershipId: string) => void;
  onProblemChange: (assignmentItemId: string) => void;
  onResponseChange: (responseText: string) => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const canEdit =
    item.status === "READY" || (item.status === "FAILED" && !item.submissionId);
  const status = statusPresentation(item);

  return (
    <div className="overflow-hidden rounded-2xl border border-black/[0.07] bg-white/65">
      <div className="grid gap-4 p-4 md:grid-cols-[64px_minmax(0,1fr)_250px] md:items-center">
        {item.kind === "PHOTO" && item.previewUrl ? (
          <div
            aria-label={`Preview of ${item.filename}`}
            className="size-16 rounded-xl border border-black/10 bg-[var(--preview)] bg-cover bg-center"
            role="img"
            style={{ backgroundImage: `url(${JSON.stringify(item.previewUrl)})` }}
          />
        ) : item.kind === "PHOTO" ? (
          <span
            aria-label={`Saved photo ${item.filename}`}
            className="grid size-16 place-items-center rounded-xl border border-black/[0.06] bg-[var(--soft-mint)] text-[var(--sidebar)]"
            role="img"
          >
            <ImageIcon className="size-6" />
          </span>
        ) : (
          <span className="grid size-16 place-items-center rounded-xl border border-black/[0.06] bg-[var(--soft-mint)] text-[var(--sidebar)]">
            <FileTextIcon className="size-6" />
          </span>
        )}

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold">
              {item.kind === "PHOTO" ? item.filename : "Typed response"}
            </p>
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
          </div>
          {item.kind === "PHOTO" ? (
            <p className="mt-1 text-xs text-[var(--muted)]">
              {item.byteSize !== null
                ? `${formatFileSize(item.byteSize)} · `
                : ""}
              {studentName}
            </p>
          ) : canEdit ? (
            <textarea
              aria-label="Edit typed student response"
              className="mt-2 min-h-20 w-full resize-y rounded-xl border border-black/[0.08] bg-white px-3 py-2 text-sm leading-5 outline-none focus:border-[var(--sage)]"
              maxLength={8_000}
              onChange={(event) => onResponseChange(event.target.value)}
              value={item.responseText}
            />
          ) : (
            <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-[var(--muted)]">
              {item.responseText}
            </p>
          )}
          <p className={`mt-2 text-xs leading-5 ${status.textClass}`}>
            {status.copy}
          </p>
        </div>

        <div className="flex items-center gap-2 md:justify-end">
          <div className="min-w-0 flex-1 space-y-2 md:max-w-[210px]">
            <label className="block">
              <span className="sr-only">Student for this submission</span>
              <select
                aria-label={`Student for ${item.kind === "PHOTO" ? item.filename : "typed response"}`}
                className={selectClass}
                disabled={!canEdit || processing}
                onChange={(event) => onMembershipChange(event.target.value)}
                value={item.membershipId}
              >
                <option value="">Choose student</option>
                {students.map((student) => (
                  <option key={student.membershipId} value={student.membershipId}>
                    {student.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="sr-only">Worksheet scope for this submission</span>
              <select
                aria-label={`Worksheet problem for ${item.kind === "PHOTO" ? item.filename : "typed response"}`}
                className={selectClass}
                disabled={!canEdit || processing}
                onChange={(event) => onProblemChange(event.target.value)}
                value={
                  item.scopeKind === "FULL_PAGE"
                    ? "__FULL_PAGE__"
                    : item.assignmentItemId ?? ""
                }
              >
                <option value="">Choose problem</option>
                {item.kind === "PHOTO" && problems.length > 1 ? (
                  <option value="__FULL_PAGE__">
                    Full worksheet page · auto-detect problems
                  </option>
                ) : null}
                {problems.map((problem) => (
                  <option key={problem.id} value={problem.id}>
                    Problem {problem.position}: {problem.prompt}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {item.status === "FAILED" ? (
            <button
              aria-label="Retry this submission"
              className="grid size-10 shrink-0 place-items-center rounded-xl border border-black/10 bg-white text-[var(--ink)] transition hover:bg-[var(--canvas)] disabled:opacity-45"
              disabled={processing}
              onClick={onRetry}
              title="Retry"
              type="button"
            >
              <RefreshIcon className="size-4" />
            </button>
          ) : !item.submissionId ? (
            <button
              aria-label="Remove from queue"
              className="grid size-10 shrink-0 place-items-center rounded-xl text-[var(--muted)] transition hover:bg-[var(--soft-coral)] hover:text-[#8e402d] disabled:opacity-45"
              disabled={processing}
              onClick={onRemove}
              title="Remove"
              type="button"
            >
              <XIcon className="size-4" />
            </button>
          ) : null}
        </div>
      </div>

      {item.result && (item.status === "COMPLETE" || item.status === "REVIEW") ? (
        <DiagnosisResult result={item.result} review={item.status === "REVIEW"} />
      ) : null}
    </div>
  );
}

function DiagnosisResult({
  result,
  review,
}: {
  result: DiagnosisSummary;
  review: boolean;
}) {
  const isCorrect = result.outcome === "CORRECT" && !review;
  const title = review
    ? "Teacher review needed"
    : isCorrect
      ? "Reasoning checks out"
      : result.misconception?.shortLabel ?? "Misconception found";

  return (
    <div
      className={`border-t px-4 py-4 md:px-5 ${
        review
          ? "border-[var(--amber)]/25 bg-[var(--amber)]/10"
          : isCorrect
            ? "border-[var(--sage)]/15 bg-[var(--soft-mint)]/65"
            : "border-[var(--coral)]/20 bg-[var(--soft-coral)]/45"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${
              review
                ? "bg-[var(--amber)]/25 text-[#765725]"
                : isCorrect
                  ? "bg-[var(--sage)]/15 text-[var(--sidebar)]"
                  : "bg-[var(--coral)]/15 text-[#8e402d]"
            }`}
          >
            {review ? (
              <AlertIcon className="size-3.5" />
            ) : (
              <CheckIcon className="size-3.5" />
            )}
          </span>
          <div>
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--muted)]">
              {review
                ? reviewReasonCopy(result.reviewReason) ||
                  "The evidence is not strong enough to assign a misconception safely."
                : result.evidenceQuote
                  ? `Evidence: “${result.evidenceQuote}”`
                  : isCorrect
                    ? "The submitted steps are consistent with the expected solution."
                    : "The first invalid step is captured in the transcription below."}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
          {typeof result.segmentedProblemCount === "number" ? (
            <span className="rounded-full border border-black/[0.07] bg-white/55 px-2.5 py-1">
              {result.segmentedProblemCount} problems found
            </span>
          ) : null}
          <span className="rounded-full border border-black/[0.07] bg-white/55 px-2.5 py-1">
            {Math.round(result.confidence * 100)}% confidence
          </span>
          {!review && !isCorrect ? (
            <span className="rounded-full border border-black/[0.07] bg-white/55 px-2.5 py-1">
              Severity {result.severity}
            </span>
          ) : null}
        </div>
      </div>

      {(result.transcription || result.steps.length) ? (
        <details className="mt-3 rounded-xl border border-black/[0.06] bg-white/50 px-3.5 py-2.5">
          <summary className="cursor-pointer text-xs font-semibold text-[var(--ink)]">
            View transcription and step check
          </summary>
          {result.transcription ? (
            <p className="mt-3 whitespace-pre-wrap rounded-lg bg-white/65 p-3 font-mono text-xs leading-6 text-[var(--ink)]">
              {result.transcription}
            </p>
          ) : null}
          {result.steps.length ? (
            <ol className="mt-3 space-y-2">
              {result.steps.map((step, index) => (
                <li
                  className={`rounded-lg border px-3 py-2 text-xs leading-5 ${
                    stepIsIncorrect(step)
                      ? "border-[var(--coral)]/25 bg-[var(--soft-coral)]/60"
                      : "border-black/[0.05] bg-white/55"
                  }`}
                  key={`${step.position ?? index}-${step.step}`}
                >
                  <span className="font-semibold">Step {step.position ?? index + 1}:</span>{" "}
                  <span className="font-mono">{step.step}</span>
                  {step.errorNote ? (
                    <span className="mt-1 block text-[#8e402d]">{step.errorNote}</span>
                  ) : null}
                  {step.correctNote ? (
                    <span className="mt-1 block text-[#426d5b]">{step.correctNote}</span>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

function StatusPill({
  tone,
  children,
}: {
  tone: "neutral" | "working" | "success" | "review" | "error";
  children: React.ReactNode;
}) {
  const tones = {
    neutral: "bg-black/[0.05] text-[var(--muted)]",
    working: "bg-[var(--soft-mint)] text-[var(--sidebar)]",
    success: "bg-[var(--sage)]/12 text-[var(--sidebar)]",
    review: "bg-[var(--amber)]/20 text-[#765725]",
    error: "bg-[var(--soft-coral)] text-[#8e402d]",
  };
  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] ${tones[tone]}`}>
      {children}
    </span>
  );
}

function statusPresentation(item: QueueItem): {
  label: string;
  copy: string;
  tone: "neutral" | "working" | "success" | "review" | "error";
  textClass: string;
} {
  switch (item.status) {
    case "SAVED":
      return {
        label: "Saved",
        copy: "Saved locally · ready to diagnose",
        tone: "neutral",
        textClass: "text-[var(--muted)]",
      };
    case "SAVING":
      return {
        label: "Saving",
        copy: item.kind === "PHOTO" ? "Saving photo locally…" : "Saving response locally…",
        tone: "working",
        textClass: "text-[var(--sage)]",
      };
    case "WAITING":
      return {
        label: "Waiting",
        copy: "Saved locally · waiting for a diagnosis slot",
        tone: "working",
        textClass: "text-[var(--sage)]",
      };
    case "DIAGNOSING":
      return {
        label: "Reading work",
        copy: "Transcribing the work and checking each step…",
        tone: "working",
        textClass: "text-[var(--sage)]",
      };
    case "COMPLETE":
      return {
        label: item.result?.outcome === "CORRECT" ? "Correct" : "Pattern found",
        copy: "Diagnosis saved",
        tone: "success",
        textClass: "text-[var(--sage)]",
      };
    case "REVIEW":
      return {
        label: "Needs review",
        copy: "Saved without forcing a low-confidence label",
        tone: "review",
        textClass: "text-[#765725]",
      };
    case "FAILED":
      return {
        label: "Could not finish",
        copy: item.error || "Try this submission again.",
        tone: "error",
        textClass: "text-[#8e402d]",
      };
    default:
      return {
        label: "Ready",
        copy: item.membershipId ? "Ready to diagnose" : "Choose a student to continue",
        tone: "neutral",
        textClass: "text-[var(--muted)]",
      };
  }
}

function summarizeQueue(items: QueueItem[]) {
  const processing = items.filter((item) =>
    ["SAVING", "WAITING", "DIAGNOSING"].includes(item.status),
  ).length;
  const ready = items.filter(
    (item) => item.status === "READY" || item.status === "SAVED",
  ).length;
  const complete = items.filter((item) => item.status === "COMPLETE").length;
  const review = items.filter((item) => item.status === "REVIEW").length;
  const failed = items.filter((item) => item.status === "FAILED").length;
  return {
    total: items.length,
    processing,
    ready,
    complete,
    review,
    failed,
    finished: complete + review,
  };
}

function queueHeadline(counts: ReturnType<typeof summarizeQueue>) {
  if (counts.total === 0) return "Ready for student work";
  if (counts.processing > 0) return `Working on ${counts.processing} ${counts.processing === 1 ? "submission" : "submissions"}`;
  if (counts.finished > 0 && counts.ready === 0 && counts.failed === 0) {
    return `${counts.finished} ${counts.finished === 1 ? "diagnosis" : "diagnoses"} ready`;
  }
  return `${counts.total} ${counts.total === 1 ? "item" : "items"} in this queue`;
}

function queueProgressCopy(counts: ReturnType<typeof summarizeQueue>) {
  if (counts.processing > 0) {
    return `${counts.processing} active or waiting · ${counts.finished} finished. Diagnosis calls run two at a time.`;
  }
  if (counts.review > 0) {
    return `${counts.complete} complete · ${counts.review} ${counts.review === 1 ? "needs" : "need"} teacher review${counts.failed ? ` · ${counts.failed} failed` : ""}.`;
  }
  if (counts.finished > 0) {
    return `${counts.complete} complete${counts.failed ? ` · ${counts.failed} failed` : ""}. Results are saved locally.`;
  }
  if (counts.failed > 0) {
    return `${counts.failed} ${counts.failed === 1 ? "submission needs" : "submissions need"} another try.`;
  }
  if (counts.ready > 0) {
    return `${counts.ready} ready. Work is saved locally before live diagnosis begins.`;
  }
  return "Add photos or typed responses to begin.";
}

function queueItemFromPersisted(item: PersistedDiagnosisQueueItem): QueueItem {
  let status: QueueStatus;
  let error = item.sanitizedErrorMessage ?? undefined;
  let result = item.diagnosis ?? undefined;

  switch (item.status) {
    case "UPLOADED":
      status = "SAVED";
      break;
    case "PROCESSING":
      status = "DIAGNOSING";
      break;
    case "DIAGNOSED":
      status = result ? "COMPLETE" : "FAILED";
      if (!result) error = "The saved diagnosis could not be loaded.";
      break;
    case "NEEDS_REVIEW":
      status = "REVIEW";
      if (!result) {
        error ||= "No problem block could be matched safely; inspect the page manually.";
      }
      break;
    default:
      status = "FAILED";
      error ||= "The saved work is ready to retry.";
      result = undefined;
  }

  const parsedCreatedAt = Date.parse(item.createdAt);
  const base: QueueBase = {
    clientId: item.submissionId,
    submissionId: item.submissionId,
    membershipId: item.membershipId,
    scopeKind: item.scopeKind,
    assignmentItemId: item.assignmentItemId,
    status,
    createdAt: Number.isFinite(parsedCreatedAt) ? parsedCreatedAt : Date.now(),
    result,
    error,
  };

  if (item.inputKind === "IMAGE") {
    return {
      ...base,
      kind: "PHOTO",
      filename: item.filename ?? "Saved photo",
      file: null,
      previewUrl: null,
      byteSize: null,
    };
  }

  return {
    ...base,
    kind: "TYPED",
    responseText: item.responseText ?? "Saved typed response",
  };
}

function mergePersistedQueueItems<T extends PhotoQueueItem | TypedQueueItem>(
  current: T[],
  incoming: T[],
): T[] {
  const incomingBySubmission = new Map(
    incoming.map((item) => [item.submissionId, item]),
  );
  const seen = new Set<string>();
  const merged = current.map((item) => {
    if (!item.submissionId) return item;
    const replacement = incomingBySubmission.get(item.submissionId);
    if (!replacement) return item;
    seen.add(item.submissionId);

    const localIsActive = ["SAVING", "WAITING", "DIAGNOSING"].includes(
      item.status,
    );
    const incomingIsTerminal = ["COMPLETE", "REVIEW", "FAILED"].includes(
      replacement.status,
    );
    if (localIsActive && !incomingIsTerminal) {
      // A queue GET can land just before the diagnosis POST claims the saved
      // submission. Never downgrade an in-flight local item back to SAVED.
      return item;
    }

    if (
      item.kind === "PHOTO" &&
      replacement.kind === "PHOTO" &&
      item.previewUrl
    ) {
      return {
        ...replacement,
        filename: item.filename,
        file: item.file,
        previewUrl: item.previewUrl,
        byteSize: item.byteSize,
      } as T;
    }
    return replacement;
  });

  return [
    ...merged,
    ...incoming.filter(
      (item) => !item.submissionId || !seen.has(item.submissionId),
    ),
  ];
}

async function requestJson(url: string, init?: RequestInit): Promise<ApiRecord> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as ApiRecord;
  if (!response.ok) {
    const error = isRecord(payload.error) ? payload.error : null;
    const message =
      readString(error, "message") ||
      readString(payload, "message") ||
      "The request could not be completed. Please try again.";
    throw new Error(message);
  }
  return payload;
}

function parsePersistedQueueItems(
  payload: ApiRecord,
): PersistedDiagnosisQueueItem[] {
  const data = isRecord(payload.data) ? payload.data : payload;
  const rawItems = Array.isArray(data.items) ? data.items : [];

  return rawItems.flatMap((value) => {
    if (!isRecord(value)) return [];
    const submissionId = readString(value, "submissionId");
    const membershipId = readString(value, "membershipId");
    const assignmentItemId = readString(value, "assignmentItemId") || null;
    const scopeKindValue = readString(value, "scopeKind");
    const scopeKind =
      scopeKindValue === "FULL_PAGE" ? "FULL_PAGE" : "SINGLE_PROBLEM";
    const inputKind = readString(value, "inputKind");
    const status = readString(value, "status");
    const createdAt = readString(value, "createdAt");
    if (
      !submissionId ||
      !membershipId ||
      (scopeKind === "SINGLE_PROBLEM" && !assignmentItemId) ||
      (inputKind !== "IMAGE" && inputKind !== "TYPED") ||
      ![
        "UPLOADED",
        "PROCESSING",
        "DIAGNOSED",
        "NEEDS_REVIEW",
        "FAILED",
      ].includes(status) ||
      !createdAt
    ) {
      return [];
    }

    return [
      {
        submissionId,
        membershipId,
        scopeKind,
        assignmentItemId,
        inputKind,
        status: status as PersistedDiagnosisQueueItem["status"],
        filename: readString(value, "filename") || null,
        responseText: readString(value, "responseText") || null,
        sanitizedErrorMessage:
          readString(value, "sanitizedErrorMessage") || null,
        createdAt,
        diagnosis: isRecord(value.diagnosis)
          ? parseDiagnosis(value.diagnosis, submissionId)
          : null,
      },
    ];
  });
}

function parseIntakeItems(payload: ApiRecord): IntakeItem[] {
  const data = isRecord(payload.data) ? payload.data : payload;
  const rawItems = Array.isArray(data.items)
    ? data.items
    : Array.isArray(payload.items)
      ? payload.items
      : [];
  return rawItems.flatMap((rawItem) => {
    if (!isRecord(rawItem)) return [];
    const clientId = readString(rawItem, "clientId");
    const submissionId = readString(rawItem, "submissionId");
    if (!clientId || !submissionId) return [];
    return [{
      clientId,
      submissionId,
      filename: readString(rawItem, "filename") || undefined,
    }];
  });
}

function parseDiagnosis(payload: ApiRecord, fallbackSubmissionId: string): DiagnosisSummary {
  const data = isRecord(payload.data) ? payload.data : payload;
  const record = isRecord(data.diagnosis)
    ? data.diagnosis
    : isRecord(data.summary)
      ? data.summary
      : data;
  const outcome = parseOutcome(record);
  const confidence = clampNumber(readNumber(record, "confidence", 0));
  const rawMisconception = isRecord(record.misconception)
    ? record.misconception
    : null;
  const misconceptionId =
    readString(rawMisconception, "id") || readString(record, "misconceptionId");
  const misconceptionLabel =
    readString(rawMisconception, "shortLabel") ||
    readString(rawMisconception, "label") ||
    readString(record, "misconceptionLabel") ||
    misconceptionId;
  const rawSteps = Array.isArray(record.steps)
    ? record.steps
    : Array.isArray(data.steps)
      ? data.steps
      : [];

  return {
    submissionId:
      readString(record, "submissionId") ||
      readString(data, "submissionId") ||
      fallbackSubmissionId,
    outcome,
    confidence,
    severity: parseSeverity(record.severity),
    misconception:
      misconceptionId && outcome === "MISCONCEPTION"
        ? {
            id: misconceptionId,
            shortLabel: misconceptionLabel,
            label: readString(rawMisconception, "label") || undefined,
          }
        : null,
    reviewReason:
      readString(record, "reviewReason") ||
      readString(record, "review_reason") ||
      null,
    transcription: readString(record, "transcription"),
    evidenceQuote:
      readString(record, "evidenceQuote") ||
      readString(record, "evidence_quote") ||
      null,
    steps: rawSteps.flatMap(parseDiagnosisStep),
    segmentedProblemCount:
      typeof record.segmentedProblemCount === "number"
        ? record.segmentedProblemCount
        : undefined,
  };
}

function parseDiagnosisStep(value: unknown, index: number): DiagnosisStep[] {
  if (!isRecord(value)) return [];
  const step = readString(value, "step") || readString(value, "studentWork");
  if (!step) return [];
  const correctness = readString(value, "correctness");
  const stepKind = readString(value, "stepKind");
  return [{
    position: readNumber(value, "position", index + 1),
    step,
    normalizedMath: readString(value, "normalizedMath") || null,
    stepKind:
      stepKind === "EQUATION" ||
      stepKind === "EXPRESSION" ||
      stepKind === "ANSWER" ||
      stepKind === "ANNOTATION" ||
      stepKind === "UNPARSEABLE"
        ? stepKind
        : undefined,
    parseIssue: readString(value, "parseIssue") || null,
    correctness:
      correctness === "CORRECT" ||
      correctness === "INCORRECT" ||
      correctness === "UNCLEAR"
        ? correctness
        : undefined,
    correct: typeof value.correct === "boolean" ? value.correct : undefined,
    correctNote: readString(value, "correctNote") || null,
    errorNote: readString(value, "errorNote") || null,
    evidenceQuote: readString(value, "evidenceQuote") || null,
  }];
}

function parseOutcome(record: ApiRecord): DiagnosisSummary["outcome"] {
  const value = readString(record, "outcome");
  if (
    value === "CORRECT" ||
    value === "MISCONCEPTION" ||
    value === "NEEDS_REVIEW" ||
    value === "INSUFFICIENT_EVIDENCE" ||
    value === "MULTIPLE_PLAUSIBLE"
  ) {
    return value;
  }
  if (record.needsTeacherReview === true) return "NEEDS_REVIEW";
  if (record.isCorrect === true) return "CORRECT";
  return "MISCONCEPTION";
}

function parseSeverity(value: unknown): 0 | 1 | 2 | 3 {
  if (typeof value === "number") {
    if (value >= 3) return 3;
    if (value >= 2) return 2;
    if (value >= 1) return 1;
    return 0;
  }
  if (value === "HIGH") return 3;
  if (value === "MEDIUM") return 2;
  if (value === "LOW") return 1;
  return 0;
}

function diagnosisNeedsReview(result: DiagnosisSummary) {
  return (
    result.outcome === "NEEDS_REVIEW" ||
    result.outcome === "INSUFFICIENT_EVIDENCE" ||
    result.outcome === "MULTIPLE_PLAUSIBLE" ||
    (result.outcome === "MISCONCEPTION" &&
      result.confidence < REVIEW_CONFIDENCE_THRESHOLD)
  );
}

function stepIsIncorrect(step: DiagnosisStep) {
  return step.correctness === "INCORRECT" || step.correct === false;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await worker(items[index]);
      }
    },
  );
  await Promise.all(workers);
}

function fileSignature(file: File) {
  return `${file.name.toLocaleLowerCase()}:${file.size}:${file.lastModified}`;
}

function createClientId() {
  return globalThis.crypto.randomUUID();
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function domainLabel(domain: AssignmentContext["domain"]) {
  if (domain === "FRACTIONS") return "Fractions";
  if (domain === "ALGEBRA") return "Algebra";
  return "Mixed";
}

function reviewReasonCopy(reason: string | null) {
  if (!reason) return "";
  const messages: Record<string, string> = {
    LOW_CONFIDENCE:
      "The evidence did not meet the confidence threshold for a safe label.",
    LOW_REASONING_CONFIDENCE:
      "The reasoning pattern is too uncertain to classify safely.",
    LOW_TRANSCRIPTION_CONFIDENCE:
      "Part of the student work may not have been transcribed reliably.",
    IMPLAUSIBLE_TRANSCRIPTION_STEP:
      "A transcribed line does not parse as a plausible step for this problem, so the work needs a teacher check.",
    POOR_IMAGE_QUALITY:
      "The image quality makes the student’s steps difficult to verify.",
    UNREADABLE_TRANSCRIPTION:
      "The submitted work is not readable enough for a safe diagnosis.",
    INSUFFICIENT_WORK_SHOWN:
      "There is not enough visible work to distinguish a misconception from a slip.",
    MULTIPLE_PLAUSIBLE_RULES:
      "More than one misconception could explain this work.",
    NO_TAXONOMY_MATCH:
      "The visible error does not match the current algebra and fractions taxonomy.",
    MISSING_EVIDENCE:
      "The response does not contain direct evidence for a misconception label.",
    DOMAIN_MISMATCH:
      "The response does not appear to match this assignment’s domain.",
  };
  return messages[reason] ?? "The diagnosis needs a teacher’s judgment before a label is assigned.";
}

function readString(record: ApiRecord | null, key: string) {
  if (!record) return "";
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function readNumber(record: ApiRecord, key: string, fallback: number) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: number) {
  return Math.min(1, Math.max(0, value));
}

function isRecord(value: unknown): value is ApiRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageFromError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request could not be completed. Please try again.";
}
