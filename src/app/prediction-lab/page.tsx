import { AppShell } from "@/components/app-shell";
import { PredictionLab } from "@/components/prediction/prediction-lab";
import { FreshDatabaseState } from "@/components/readiness-states";
import { isOpenAIConfigured } from "@/lib/config";
import {
  getPredictionLabData,
  listPredictionLabClasses,
} from "@/server/repositories/prediction-lab";

export const dynamic = "force-dynamic";

export default async function PredictionLabPage({
  searchParams,
}: {
  searchParams: Promise<{ classId?: string }>;
}) {
  const classes = listPredictionLabClasses();
  const requestedClassId = (await searchParams).classId;
  const activeClass =
    classes.find((classRecord) => classRecord.id === requestedClassId) ??
    classes[0] ??
    null;
  const data = activeClass ? getPredictionLabData(activeClass.id) : null;
  const liveAiReady = isOpenAIConfigured();

  return (
    <AppShell activeNav="Prediction Lab" liveAiReady={liveAiReady}>
      {classes.length === 0 ? (
        <div className="px-5 py-8 md:px-8 lg:px-10">
          <FreshDatabaseState title="No Prediction Lab evidence is loaded" />
        </div>
      ) : (
        <PredictionLab
          classes={classes.map((classRecord) => ({
            id: classRecord.id,
            name: classRecord.name,
            studentCount: classRecord.student_count,
          }))}
          data={data}
          liveAiReady={liveAiReady}
        />
      )}
    </AppShell>
  );
}
