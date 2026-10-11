import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isAxiosError } from "axios";
import { downloadHttp, kaggleHttp } from "../lib/http";

export type PushJobPayload = {
  username: string;
  // Used as the job title; Kaggle derives the slug from it.
  title: string;
  // Python source of the job.
  code: string;
};

export type PushJobResponse = {
  ref?: string;
  url?: string;
  versionNumber?: number;
  error?: string;
};

export type JobStatus = "queued" | "running" | "complete" | "error" | "cancelled" | "unknown";

export type JobStatusResponse = {
  status: JobStatus;
  failureMessage: string | null;
};

export type JobOutputFile = {
  fileName: string;
  url: string;
};

export type JobOutputResponse = {
  files: JobOutputFile[];
  log: string;
};

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function describeError(error: unknown): Error {
  if (isAxiosError(error)) {
    const body = typeof error.response?.data === "string" ? error.response.data : JSON.stringify(error.response?.data);
    return new Error(`Kaggle API ${error.response?.status ?? error.code}: ${body?.slice(0, 500)}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

export async function pushJob(payload: PushJobPayload): Promise<PushJobResponse> {
  const slug = slugify(payload.title);
  try {
    const { data } = await kaggleHttp.post<PushJobResponse>("/kernels/push", {
      slug: `${payload.username}/${slug}`,
      newTitle: payload.title,
      text: payload.code,
      language: "python",
      kernelType: "script",
      isPrivate: true,
      enableGpu: true,
      enableInternet: true,
      machineShape: "NvidiaTeslaT4",
      datasetDataSources: [],
      competitionDataSources: [],
      kernelDataSources: [],
      modelDataSources: [],
      categoryIds: [],
    });
    if (data.error) throw new Error(`Kaggle rejected the job: ${data.error}`);
    return data;
  } catch (error) {
    throw describeError(error);
  }
}

function normalizeStatus(raw: unknown): JobStatus {
  const value = String(raw ?? "").toLowerCase();
  if (value.includes("queued")) return "queued";
  if (value.includes("running")) return "running";
  if (value.includes("complete")) return "complete";
  if (value.includes("error")) return "error";
  if (value.includes("cancel")) return "cancelled";
  return "unknown";
}

export async function getJobStatus(username: string, slug: string): Promise<JobStatusResponse> {
  try {
    const { data } = await kaggleHttp.get<{ status?: string; failureMessage?: string | null }>("/kernels/status", {
      params: { userName: username, kernelSlug: slug },
    });
    return { status: normalizeStatus(data.status), failureMessage: data.failureMessage || null };
  } catch (error) {
    throw describeError(error);
  }
}

export async function getJobOutput(username: string, slug: string): Promise<JobOutputResponse> {
  const files: JobOutputFile[] = [];
  let log = "";
  let pageToken: string | undefined;
  try {
    do {
      const { data } = await kaggleHttp.get<{
        files?: JobOutputFile[];
        log?: string;
        nextPageToken?: string;
      }>("/kernels/output", {
        params: { userName: username, kernelSlug: slug, pageToken },
      });
      files.push(...(data.files ?? []));
      if (data.log) log = data.log;
      pageToken = data.nextPageToken || undefined;
    } while (pageToken);
  } catch (error) {
    throw describeError(error);
  }
  return { files, log };
}

export async function downloadOutputFile(file: JobOutputFile, targetDir: string): Promise<string> {
  const target = join(targetDir, file.fileName);
  await mkdir(dirname(target), { recursive: true });
  const { data } = await downloadHttp.get<ArrayBuffer>(file.url, { responseType: "arraybuffer" });
  await Bun.write(target, data);
  return target;
}

// The job log arrives as a JSON array of stream chunks; fall back to raw text if it isn't.
export function formatJobLog(log: string): string {
  try {
    const entries = JSON.parse(log) as { data?: string }[];
    return entries.map((entry) => entry.data ?? "").join("");
  } catch {
    return log;
  }
}

export type GpuQuotaResponse = {
  usedSeconds: number;
  allowedSeconds: number;
  // ISO time when the weekly allowance resets.
  refreshesAt: string | null;
};

export async function getGpuQuota(): Promise<GpuQuotaResponse> {
  try {
    const { data } = await kaggleHttp.get<{
      quotaRefreshTime?: string;
      gpuQuota?: { timeUsed?: { seconds?: number }; totalTimeAllowed?: { seconds?: number } };
    }>("/kernels/quota");
    return {
      usedSeconds: Number(data.gpuQuota?.timeUsed?.seconds ?? 0),
      allowedSeconds: Number(data.gpuQuota?.totalTimeAllowed?.seconds ?? 0),
      refreshesAt: data.quotaRefreshTime ?? null,
    };
  } catch (error) {
    throw describeError(error);
  }
}
