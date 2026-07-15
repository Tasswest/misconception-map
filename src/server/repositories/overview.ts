import "server-only";

import { getHeatmapDashboard } from "@/server/repositories/dashboard";
import {
  listManagedAssignments,
  listManagedClasses,
} from "@/server/repositories/management";
import { getDatabase } from "@/lib/db";

export function getOverviewSummary() {
  const classes = listManagedClasses();
  const assignments = listManagedAssignments().filter(
    (assignment) => assignment.status === "READY",
  );
  const latestAssignment = assignments[0] ?? null;
  const latestDashboard = latestAssignment
    ? getHeatmapDashboard(latestAssignment.id)
    : null;
  const metrics = getDatabase()
    .prepare(
      `
        SELECT
          coalesce(sum(metric.valid_predictions), 0) AS valid,
          coalesce(sum(metric.attempted_predictions), 0) AS attempted,
          coalesce(sum(metric.scorable_predictions), 0) AS scorable,
          coalesce(sum(metric.matched_predictions), 0) AS matched
        FROM student_prediction_metrics AS metric
        JOIN class_memberships AS membership ON membership.id = metric.membership_id
        JOIN classes AS class ON class.id = membership.class_id
        WHERE class.archived_at IS NULL AND membership.archived_at IS NULL
      `,
    )
    .get() as {
    valid: number;
    attempted: number;
    scorable: number;
    matched: number;
  };

  return {
    hasWorkspace: classes.length > 0,
    classCount: classes.length,
    studentCount: classes.reduce(
      (sum, classroom) => sum + classroom.studentCount,
      0,
    ),
    assignmentCount: assignments.length,
    needsReviewCount: assignments.reduce(
      (sum, assignment) => sum + assignment.needsReviewCount,
      0,
    ),
    latestAssignment,
    dominantCluster: latestDashboard?.largestCluster ?? null,
    prediction: {
      valid: metrics.valid,
      attempted: metrics.attempted,
      scorable: metrics.scorable,
      matched: metrics.matched,
      accuracy: metrics.scorable ? metrics.matched / metrics.scorable : null,
      coverage: metrics.valid ? metrics.attempted / metrics.valid : null,
    },
    recentAssignments: assignments.slice(0, 4),
  };
}

export type OverviewSummary = ReturnType<typeof getOverviewSummary>;
