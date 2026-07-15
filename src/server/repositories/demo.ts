import "server-only";

import { getDatabase } from "@/lib/db";
import { seedDemoDatabase } from "@/server/demo/seed-database.mjs";

export function loadDemoClassroom() {
  return seedDemoDatabase(getDatabase());
}
