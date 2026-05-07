import { ENV } from "./env";

const BASE = ENV.gatewayBaseUrl.replace(/\/$/, "");
const TOKEN = ENV.gatewayApiKey;

interface GatewayTask {
  taskId: number;
  serviceName: string;
  status: "PROCESSING" | "SUCCESS" | "FAILED";
  resultUrl: string | null;
  errorMessage: string | null;
}

interface ForwardResult {
  success: boolean;
  data: {
    taskId: number;
    consumedPoints: number;
    remainingBalance: number;
  };
}

export async function submitGatewayTask(
  serviceName: string,
  params: Record<string, unknown>
): Promise<ForwardResult> {
  const resp = await fetch(`${BASE}/api/gateway/forward`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ serviceName, params }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`网关返回错误 ${resp.status}: ${text}`);
  }

  return resp.json();
}

export async function getGatewayTask(taskId: number): Promise<{ success: boolean; data: GatewayTask }> {
  const resp = await fetch(`${BASE}/api/gateway/task/${taskId}`, {
    headers: { "Authorization": `Bearer ${TOKEN}` },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`网关返回错误 ${resp.status}: ${text}`);
  }

  return resp.json();
}

export async function waitForGatewayTask(
  taskId: number,
  maxWaitMs = 300000,
  pollIntervalMs = 3000
): Promise<GatewayTask> {
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const result = await getGatewayTask(taskId);
    if (!result.success) throw new Error("查询网关任务失败");

    const task = result.data;
    if (task.status === "SUCCESS") return task;
    if (task.status === "FAILED") throw new Error(task.errorMessage || "网关任务失败");

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error("网关任务超时");
}
