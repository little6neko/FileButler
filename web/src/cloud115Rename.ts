import { APIError, api } from "./api/client";
import type { RenameRequest, SuperRenameInventory, SuperRenameInventoryGroup } from "./api/types";
import { cloudCall } from "./cloud115";
import type { SuperRenameClient } from "./superRenameManager";

export type PowerRenameClient = Pick<typeof api, "renamePreview" | "renameCreateJob">;

export function cloudPowerRenameClient(parentId: string, accountId: string): PowerRenameClient {
  let generation = 0;
  let ready: { token: string; key: string } | null = null;
  const key = (request: RenameRequest) => JSON.stringify({ ids: request.paths, options: { ...request.options, readMetadata: false } });
  return {
    async renamePreview(request) {
      const current = ++generation;
      ready = null;
      const plan = await cloudCall<Awaited<ReturnType<typeof api.renamePreview>> & { previewToken: string }>("power.preview", { accountId, parentId, ids: request.paths, options: { ...request.options, readMetadata: false } });
      if (current === generation) ready = { token: plan.previewToken, key: key(request) };
      return plan;
    },
    async renameCreateJob(request) {
      if (!ready || ready.key !== key(request)) throw new APIError("stale_preview", "请先检查任务面板，再修改条件或重新打开预览；不能重复提交旧预览", 409);
      const { token } = ready;
      ready = null;
      return cloudCall<{ id: string }>("power.submit", { accountId, parentId, previewToken: token });
    },
  };
}

export function cloudSuperRenameClient(parentId: string, accountId: string): SuperRenameClient {
  const revisions: Record<string, string> = {};
  let generation = 0;
  const groupVersions = new Map<string, number>();
  return {
    completeGroupOnTerminal: true,
    async superRenamePreview() {
      const current = ++generation;
      groupVersions.clear();
      const inventory = await cloudCall<SuperRenameInventory & { revision: string }>("super.preview", { accountId, parentId });
      if (current !== generation) return inventory;
      for (const key of Object.keys(revisions)) delete revisions[key];
      for (const group of inventory.groups) revisions[group.path] = inventory.revision;
      return inventory;
    },
    async superRenameGroupPreview(request) {
      const current = generation;
      const version = (groupVersions.get(request.groupPath) ?? 0) + 1;
      groupVersions.set(request.groupPath, version);
      const group = await cloudCall<SuperRenameInventoryGroup & { revision: string }>("super.group", { accountId, parentId, path: request.groupPath });
      if (current === generation && version === groupVersions.get(request.groupPath)) revisions[group.path] = group.revision;
      return group;
    },
    async superRenameCreateJob(request) {
      const needed: Record<string, string> = {};
      for (const source of request.selectedPaths) {
        const group = source.slice(0, source.lastIndexOf("/"));
        if (!revisions[group]) throw new APIError("stale_preview", "请重新加载分组预览", 409);
        needed[group] = revisions[group];
      }
      const job = await cloudCall<{ id: string }>("super.submit", { accountId, parentId, paths: request.selectedPaths, revisions: needed });
      for (const group of Object.keys(needed)) if (revisions[group] === needed[group]) delete revisions[group];
      return job;
    },
  };
}
