import { api } from "./api/client";
import type { OpsRequest, PlanItem } from "./api/types";
import { cloudCall } from "./cloud115";

export type OperationPlan = { items: PlanItem[]; hasConflict: boolean; previewToken?: string };
export function isCloudOperation(request: OpsRequest) {
  return request.sourceRoot === "@115" || request.destRoot === "@115";
}
export const operationClient = {
  preview(request: OpsRequest, signal?: AbortSignal): Promise<OperationPlan> {
    return isCloudOperation(request) ? cloudCall("ops.preview", request, signal) : api.opsDryRun(request, signal);
  },
  create(request: OpsRequest, previewToken?: string): Promise<{ id: string }> {
    if (!isCloudOperation(request)) return api.opsCreateJob(request);
    if (!previewToken) return Promise.reject(new Error("请先完成操作预览"));
    return cloudCall("ops.create", { previewToken, accountId: request.accountId });
  },
};

export function transferWarning(request: OpsRequest) {
  if (request.type !== "move") return null;
  if (request.sourceRoot === "@115" && request.destRoot !== "@115") return "下载成功后将删除115上的源文件。";
  if (request.sourceRoot !== "@115" && request.destRoot === "@115") return "上传成功后将删除本地源文件。";
  return null;
}
