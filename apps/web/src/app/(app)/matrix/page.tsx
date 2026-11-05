import { agentOverview } from "@/lib/services/oversight";
import { MatrixClient } from "./matrix-client";

export const dynamic = "force-dynamic";

export default function MatrixPage() {
  const data = agentOverview();
  return <MatrixClient initial={JSON.parse(JSON.stringify(data))} />;
}
