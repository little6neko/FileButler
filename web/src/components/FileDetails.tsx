import { useEffect, useRef, useState } from "react";
import { File, Folder } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { copyText } from "../copyText";
import { entryTypeLabel } from "../entryType";
import { mediaKindForPath } from "../media";
import { detailsTitle, detailSize, detailDuration, readDetails, type DetailsTarget, type DetailItem, type DetailTotals, type DetailMedia } from "../fileDetails";
import type { UIStrings } from "../i18n";

export function FileDetails({ target, labels }: { target: DetailsTarget; labels: UIStrings }) {
  const text = labels.details;
  const [items, setItems] = useState<DetailItem[]>([]);
  const [totals, setTotals] = useState<DetailTotals | null>(null);
  const [statsPending, setStatsPending] = useState(false);
  const [media, setMedia] = useState<DetailMedia | null>(null);
  const [hash, setHash] = useState("");
  const [hashPending, setHashPending] = useState(false);
  const [error, setError] = useState("");
  const [accountChanged, setAccountChanged] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const request = new AbortController(); controller.current = request;
    function failed(e: unknown) { if (!request.signal.aborted) setError(String(e)); }
    void readDetails<DetailItem[]>(target, "basic", request.signal).then((next) => {
      if (request.signal.aborted) return;
      setItems(next); setHash(next[0]?.sha1 || "");
      if (next.some((item) => item.warning)) setError(next.find((item) => item.warning)!.warning!);
      if (next.length > 1 || next[0]?.type === "directory") {
        setStatsPending(true);
        void readDetails<DetailTotals>(target, "stats", request.signal).then((result) => { if (!request.signal.aborted) setTotals(result); }).catch(failed).finally(() => { if (!request.signal.aborted) setStatsPending(false); });
      }
      if (next.length === 1 && next[0].type === "file" && mediaKindForPath(next[0].name)) {
        void readDetails<DetailMedia>(target, "media", request.signal).then((result) => { if (!request.signal.aborted) setMedia(result); }).catch(failed);
      }
    }).catch(failed);
    const changed = () => { if (target.rootId === "@115") { request.abort(); setAccountChanged(true); setItems([]); setTotals(null); setHash(""); setMedia(null); setStatsPending(false); setHashPending(false); } };
    window.addEventListener("cloud115-account-changed", changed);
    return () => { request.abort(); window.removeEventListener("cloud115-account-changed", changed); };
  }, [target]);
  async function refreshHash() {
    const request = controller.current;
    if (!request || request.signal.aborted || hashPending) return;
    setHashPending(true); setHash(""); setError("");
    try {
      const result = await readDetails<{ sha1: string; warning?: string }>(target, "hash", request.signal);
      if (!request.signal.aborted) { setHash(result.sha1); if (result.warning) setError(result.warning); }
    } catch (e) { if (!request.signal.aborted) setError(String(e)); }
    finally { if (!request.signal.aborted) setHashPending(false); }
  }
  const first = items[0], multiple = target.paths.length > 1;
  const directory = first?.type === "directory";
  const mediaKind = !multiple && first?.type === "file" ? mediaKindForPath(first.name) : null;
  const types = new Set(items.map((item) => entryTypeLabel(item, labels)));
  const location = items.length ? items.every((item) => item.location === first.location) ? first.location : null : undefined;
  const isRoot = first?.path === (target.rootId === "@115" ? "0" : ".");
  const copyPath = location && first && !multiple && !isRoot
    ? `${location.endsWith("/") ? location : `${location}/`}${first.name}`
    : location;
  const computing = !accountChanged && (statsPending || !first && !error);
  const size = multiple || directory ? totals?.size : first?.size;
  const allocated = multiple || directory ? totals?.allocated : first?.allocated;
  const date = (unix: number | null | undefined) => {
    if (unix == null) return "--";
    const value = new Date(unix * 1000);
    if (!Number.isFinite(value.getTime())) return "--";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
  };
  return <div className="file-details" data-testid="file-details">
    <div className="file-details-heading">{directory ? <Folder className="text-blue-500" /> : <File className="text-blue-500" />}<strong>{detailsTitle(target, text)}</strong></div>
    <hr />
    <dl>
      <dt>{labels.type}</dt><dd>{types.size > 1 ? text.mixed : [...types][0] || "--"}</dd>
      {mediaKind ? <><dt>{text.resolution}</dt><dd>{media?.width && media.height ? `${media.width} * ${media.height}` : "--"}</dd></> : null}
      {mediaKind === "video" ? <><dt>{text.duration}</dt><dd>{detailDuration(media?.duration)}</dd></> : null}
      <dt>{text.size}</dt><dd>{computing ? text.calculating : detailSize(size, text.bytes)}</dd>
      <dt>{text.allocated}</dt><dd>{target.rootId !== "@115" && computing ? text.calculating : detailSize(allocated, text.bytes)}</dd>
      {multiple || directory ? <><dt>{text.contains}</dt><dd>{computing ? text.calculating : totals ? `${totals.files.toLocaleString("en-US")}${text.files}，${totals.folders.toLocaleString("en-US")}${text.folders}` : "--"}</dd></> : null}
      <dt>{text.location}</dt><dd className="file-details-inline"><span>{location === null ? text.multipleLocations : location || "--"}</span><Button size="sm" variant="outline" disabled={!copyPath || accountChanged} onClick={() => { if (copyPath) void copyText(copyPath).then(() => toast.success(text.copied)).catch((e: unknown) => toast.error(String(e))); }}>{text.copy}</Button></dd>
      {!multiple ? <>
        <dt>{text.modified}</dt><dd>{date(first?.modifiedUnix)}</dd>
        <dt>{text.created}</dt><dd>{date(first?.createdUnix)}</dd>
        <dt>SHA1</dt><dd className="file-details-inline"><span className="font-mono">{hashPending ? text.calculating : hash || "--"}</span><Button size="sm" variant="outline" disabled={hashPending || !first || first.type !== "file" || accountChanged} onClick={() => void refreshHash()}>{text.refresh}</Button></dd>
      </> : null}
    </dl>
    {accountChanged || error ? <p role="alert" className="text-destructive">{accountChanged ? text.accountChanged : error}</p> : null}
  </div>;
}
