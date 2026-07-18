import type { AssignmentDomain } from "@/domain/contracts";
import { buildDiagnosisPrompt } from "@/server/openai/diagnosis-prompt";

export const STUDENT_PAGE_DIAGNOSIS_PROMPT_VERSION = "2.1.0";

type PageProblem = {
  position: number;
  exerciseLabel: string;
  questionLabel: string;
  prompt: string;
  correctAnswer: string;
  answerFormat: string;
  inTaxonomyScope: boolean;
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
    "This request contains one student-work image or PDF document and an ordered list of assignment problems.",
    "Inspect the whole page once. Identify which supplied questions have student work visibly associated with them, then return one visibleProblems entry per safely matched work block.",
    "Match primarily from the student's own exercise and question cues, including forms such as `1.1`, `Ex 7 Q3`, or a copied exercise title. Use nearby printed prompts, spatial layout, and mathematical content only as corroborating evidence.",
    "For every matched block, copy exerciseLabel and questionLabel exactly from the supplied problem list and return the corresponding problemPosition. Never invent a label, duplicate a position, or return work that is not visible.",
    "Printed worksheet text helps segmentation but is not student transcription. Each nested diagnosis.transcription and its steps must contain only the student's marks for that problem.",
    "For each visible problem, return region as the smallest practical bounding rectangle around that problem's student work, using normalized page coordinates from 0 to 1 with origin at the top-left: {x, y, width, height}. If the work cannot be localized confidently, set region to null. Region is display metadata only and must never change or suppress a diagnosis.",
    "For every visible problem, copy that list entry's prompt exactly into diagnosis.observedPrompt and diagnose against that entry's correctAnswer.",
    "Correct every safely matched problem, whatever its subject. For a problem with inTaxonomyScope false, choose CORRECT when all visible work is correct or INCORRECT when a readable step or answer is wrong. In that correction-only case misconceptionId must be null, candidates must be empty, observedTransformation and strategyVariant must be null, and the errorNote must explain the mistake in the language of the problem. Never apply the algebra/fractions taxonomy to it.",
    "If a work block is ambiguous, lacks a reliable label cue, conflicts with the supplied exercise/question pair, or cannot be matched safely, omit it and explain the uncertainty in segmentationReviewNote. Never guess it into the closest slot. If nothing is readable, return visibleProblems [] and a non-null segmentationReviewNote.",
    "pageTranscriptionConfidence measures both segmentation and whole-page legibility. If it is below 0.72, every visible nested diagnosis must abstain with LOW_TRANSCRIPTION_CONFIDENCE.",
  ].join("\n");

  return {
    instructions,
    inputText: JSON.stringify({
      assignmentDomain: input.assignmentDomain,
      inputKind: "FULL_PAGE_DOCUMENT",
      problems: input.problems,
      task:
        "Segment the attached student-work image or PDF against this problem list, then diagnose every visible problem.",
    }),
  };
}
