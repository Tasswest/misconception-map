export function shortExerciseLabel(exerciseLabel: string) {
  const match = exerciseLabel.match(
    /^(?:ex(?:ercice)?\s*)?(?:n(?:[°º]|o)?\s*)?(\d+)/iu,
  );
  return match ? `Ex. ${match[1]}` : exerciseLabel;
}

export function exerciseQuestionReference(
  exerciseLabel: string,
  questionLabel: string,
) {
  const normalizedQuestion = questionLabel
    .replace(/^q(?:uestion)?\s*/iu, "")
    .replace(/\.$/u, "");
  return `${shortExerciseLabel(exerciseLabel)} · Q${normalizedQuestion}`;
}
