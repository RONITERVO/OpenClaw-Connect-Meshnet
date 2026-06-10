import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { startServer } from "./lib/app.mjs";

export {
  createAutomatorServer,
  handleApi,
  startServer,
} from "./lib/app.mjs";
export {
  parseJson,
} from "./lib/utils.mjs";
export {
  buildWorkflowIntake,
  workflowIntakeCreateRequestTemplate,
  workflowIntakeDocs,
  workflowIntakeDraftHash,
  workflowIntakeSchema,
} from "./lib/workflow-intake.mjs";

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await startServer();
}
