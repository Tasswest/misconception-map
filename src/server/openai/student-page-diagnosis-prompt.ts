import type { AssignmentDomain } from "@/domain/contracts";
import { buildDiagnosisPrompt } from "@/server/openai/diagnosis-prompt";

export const STUDENT_PAGE_DIAGNOSIS_PROMPT_VERSION = "1.0.0";

type PageProblem = {
  position: number;
  prompt: string;
  correctAnswer: string;
  answerFormat: string;
};

export function buildStudentPageDiagnosisPrompt(input: {
  assignmentDomain: AssignmentDomain;
  problems: PageProblem[];
}) {
  const firstProblem = input.problems[0];
  const base = buildDiagnosisPrompt({
    assignmentDomain: input.assignmentDomain,
    inputKind: "IMAGE",
    observedPrompt: firstProblem.prompt,
    correctAnswer: firstProblem.correctAnswer,
    typedResponse: null,
  });
  const instructions = [
    base.instructions,
    "This request contains one full student page and an ordered list of assignment problems.",
    "Inspect the whole page once. Identify which supplied problems have student work visibly associated with them, then return one visibleProblems entry per visible work block.",
    "Match by printed problem number, nearby printed prompt, spatial layout, and mathematical content. problemPosition must be a position from the supplied list. Never invent a problem, duplicate a position, or return work that is not visible.",
    "Printed worksheet text helps segmentation but is not student transcription. Each nested diagnosis.transcription and its steps must contain only the student's marks for that problem.",
    "For every visible problem, copy that list entry's prompt exactly into diagnosis.observedPrompt and diagnose against that entry's correctAnswer.",
    "If a work block cannot be matched safely, omit it and explain the uncertainty in segmentationReviewNote. If nothing is readable, return visibleProblems [] and a non-null segmentationReviewNote.",
    "pageTranscriptionConfidence measures both segmentation and whole-page legibility. If it is below 0.72, every visible nested diagnosis must abstain with LOW_TRANSCRIPTION_CONFIDENCE.",
  ].join("\n");

  return {
    instructions,
    inputText: JSON.stringify({
      assignmentDomain: input.assignmentDomain,
      inputKind: "FULL_PAGE_IMAGE",
      problems: input.problems,
      task:
        "Segment the attached full student page against this problem list, then diagnose every visible problem.",
    }),
  };
}
