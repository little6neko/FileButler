package cloud115

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/natsort"
	"github.com/little6neko/filebutler/internal/rename"
	"github.com/little6neko/filebutler/internal/superrename"
)

type cloudEntry struct {
	ID          string `json:"id"`
	ParentID    string `json:"parentId"`
	Name        string `json:"name"`
	IsDirectory bool   `json:"isDirectory"`
}
type cloudGroup struct {
	ID           string       `json:"id"`
	ParentID     string       `json:"parentId"`
	Name         string       `json:"name"`
	Path         string       `json:"path"`
	Entries      []cloudEntry `json:"entries"`
	VideoID      string       `json:"videoId"`
	VideoEntries []cloudEntry `json:"videoEntries"`
}
type cloudScan struct {
	AccountID   string       `json:"accountId"`
	Groups      []cloudGroup `json:"groups"`
	SelectedIDs []string     `json:"selectedIds"`
}
type batchItem struct {
	ID            string `json:"id"`
	ParentID      string `json:"parentId"`
	Name          string `json:"name"`
	TargetName    string `json:"targetName"`
	DestID        string `json:"destId"`
	VideoParentID string `json:"videoParentId,omitempty"`
}
type batchPreview struct {
	ActorID    int64
	Expires    time.Time
	Scope      string
	Kind       string
	Scan       cloudScan
	Power      []batchItem
	Conflict   bool
	UsedGroups map[string]bool
}
type batchRequest struct {
	ParentID     string            `json:"parentId"`
	IDs          []string          `json:"ids"`
	Path         string            `json:"path"`
	Paths        []string          `json:"paths"`
	Options      rename.Options    `json:"options"`
	PreviewToken string            `json:"previewToken"`
	Revisions    map[string]string `json:"revisions"`
}

func (s *Service) remember(preview batchPreview) string {
	now := time.Now()
	for id, value := range s.previews {
		if now.After(value.Expires) {
			delete(s.previews, id)
		}
	}
	if len(s.previews) >= 256 {
		oldest := ""
		for id, value := range s.previews {
			if oldest == "" || value.Expires.Before(s.previews[oldest].Expires) {
				oldest = id
			}
		}
		delete(s.previews, oldest)
	}
	id := jobs.NewID()
	preview.Expires = now.Add(30 * time.Minute)
	s.previews[id] = preview
	return id
}

func (s *Service) batchHandler(w http.ResponseWriter, r *http.Request, method string) {
	if method != "power.preview" && method != "power.submit" && method != "super.preview" && method != "super.group" && method != "super.submit" {
		respond(w, 404, nil, "unknown 115 operation")
		return
	}
	user, ok := auth.CurrentUser(r.Context())
	if !ok {
		respond(w, 401, nil, "authentication required")
		return
	}
	var req batchRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<20))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&req) != nil {
		respond(w, 400, nil, "invalid request")
		return
	}
	if req.ParentID == "" {
		req.ParentID = "0"
	}
	if !numericID.MatchString(req.ParentID) || len(req.IDs) > 10000 || len(req.Paths) > 10000 || len(req.Revisions) > 1000 {
		respond(w, 400, nil, "invalid selection")
		return
	}
	for _, id := range req.IDs {
		if !numericID.MatchString(id) || id == "0" {
			respond(w, 400, nil, "invalid file ID")
			return
		}
	}
	if req.Options.ReadMetadata {
		respond(w, 400, nil, "115不支持读取文件属性")
		return
	}
	if method == "power.submit" || method == "super.submit" {
		s.submitBatch(w, r, method, req, user.ID)
		return
	}
	params := map[string]any{"kind": "super", "parentId": req.ParentID}
	if method == "power.preview" {
		if len(req.IDs) == 0 {
			respond(w, 400, nil, "请选择需要重命名的项目")
			return
		}
		params["kind"] = "power"
		params["ids"] = req.IDs
		params["recursive"] = req.Options.IncludeSubfolders && !req.Options.ExcludeSubfolders
	} else if method == "super.group" {
		if !validGroupPath(req.Path) {
			respond(w, 400, nil, "invalid group path")
			return
		}
		params["paths"] = []string{req.Path}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	raw, err := s.Provider.Call(ctx, "batch.scan", params, nil)
	if err != nil {
		respond(w, 502, nil, err.Error())
		return
	}
	var scan cloudScan
	if json.Unmarshal(raw, &scan) != nil || scan.AccountID == "" {
		respond(w, 502, nil, "invalid cloud snapshot")
		return
	}
	preview := batchPreview{ActorID: user.ID, Scope: req.ParentID, Kind: "super", Scan: scan}
	if method == "power.preview" {
		plan, items, err := planPower(scan, req.Options)
		if err != nil {
			respond(w, 400, nil, err.Error())
			return
		}
		preview.Kind = "power"
		preview.Power = items
		preview.Conflict = plan.HasConflict
		token := s.remember(preview)
		respond(w, 200, map[string]any{"items": plan.Items, "hasConflict": plan.HasConflict, "previewToken": token}, "")
		return
	}
	inventory := superInventory(scan.Groups)
	token := s.remember(preview)
	if method == "super.group" {
		if len(inventory.Groups) != 1 {
			respond(w, 502, nil, "invalid group snapshot")
			return
		}
		respond(w, 200, struct {
			superrename.InventoryGroup
			Revision string `json:"revision"`
		}{inventory.Groups[0], token}, "")
		return
	}
	respond(w, 200, struct {
		superrename.Inventory
		Revision string `json:"revision"`
	}{inventory, token}, "")
}

func validGroupPath(value string) bool {
	if value == "" || strings.ContainsAny(value, "\\\x00") {
		return false
	}
	for index, part := range strings.Split(value, "/") {
		if part == "" || part == "." || part == ".." || strings.HasPrefix(part, ".filebutler-") || index > 0 && part == "视频" {
			return false
		}
	}
	return true
}

func planPower(scan cloudScan, options rename.Options) (rename.PlanResult, []batchItem, error) {
	opts := rename.OptionsForPlan(options)
	selected := map[string]bool{}
	for _, id := range scan.SelectedIDs {
		selected[id] = true
	}
	inputs := []rename.InputItem{}
	sources := map[string]cloudEntry{}
	occupied := map[string]bool{}
	for _, group := range scan.Groups {
		for _, entry := range group.Entries {
			if entry.Name == "" || entry.Name == "." || entry.Name == ".." || strings.ContainsAny(entry.Name, "/\\\x00") {
				if selected[entry.ID] {
					return rename.PlanResult{}, nil, fmt.Errorf("选中条目 %s 的原名称无法用于批量路径预览：%q", entry.ID, entry.Name)
				}
				continue
			}
			key := path.Join(group.Path, entry.Name)
			occupied[key] = true
			if selected[entry.ID] && !(entry.IsDirectory && opts.ExcludeFolders || !entry.IsDirectory && opts.ExcludeFiles) {
				inputs = append(inputs, rename.InputItem{RelativePath: key, IsDir: entry.IsDirectory})
				sources[key] = entry
			}
		}
	}
	plan, err := rename.PowerRenamePlan(inputs, opts, func(key string) bool { _, moving := sources[key]; return occupied[key] && !moving })
	if err != nil {
		return plan, nil, err
	}
	items := []batchItem{}
	for i, item := range plan.Items {
		if item.NewName == "" || item.NewName == "." || item.NewName == ".." || strings.ContainsAny(item.NewName, "/\\\x00") {
			plan.Items[i].Conflict = true
			plan.Items[i].ErrorText = "目标名称无效"
			plan.HasConflict = true
		}
		if item.Changed {
			source := sources[item.SourcePath]
			items = append(items, batchItem{ID: source.ID, ParentID: source.ParentID, Name: source.Name, TargetName: item.NewName, DestID: source.ParentID})
		}
	}
	return plan, items, nil
}

func superInventory(groups []cloudGroup) superrename.Inventory {
	inventory := superrename.Inventory{RootID: "@115", DirectoryPath: ".", GeneratedAtUnix: time.Now().Unix(), Groups: []superrename.InventoryGroup{}}
	for _, raw := range groups {
		group := superrename.InventoryGroup{Path: raw.Path, Name: raw.Name, Images: []superrename.Candidate{}, Videos: []superrename.Candidate{}, Unmatched: []superrename.Unmatched{}, ChildDirectories: []superrename.DirectoryRef{}, DirectOccupiedPaths: []string{}, RecoveryResidues: []string{}, VideoDirectory: superrename.VideoDirectory{Path: path.Join(raw.Path, "视频"), Status: superrename.VideoDirectoryMissing, OccupiedPaths: []string{}}}
		for _, entry := range raw.Entries {
			key := path.Join(raw.Path, entry.Name)
			group.DirectOccupiedPaths = append(group.DirectOccupiedPaths, key)
			if strings.HasPrefix(entry.Name, ".filebutler-") {
				group.RecoveryResidues = append(group.RecoveryResidues, key)
				continue
			}
			if entry.Name == "视频" {
				if entry.IsDirectory {
					group.VideoDirectory.Status = superrename.VideoDirectoryPresent
				} else {
					group.VideoDirectory.Status = superrename.VideoDirectoryBlockingEntry
				}
				continue
			}
			if entry.IsDirectory {
				group.ChildDirectories = append(group.ChildDirectories, superrename.DirectoryRef{Path: key, Name: entry.Name})
				group.Unmatched = append(group.Unmatched, superrename.Unmatched{Path: key, Name: entry.Name, Kind: superrename.EntryKindDirectory, Reason: superrename.UnmatchedNestedDirectory})
				continue
			}
			kind, ext, ok := superrename.ClassifyMedia(entry.Name)
			if !ok {
				group.Unmatched = append(group.Unmatched, superrename.Unmatched{Path: key, Name: entry.Name, Kind: superrename.EntryKindFile, Reason: superrename.UnmatchedUnsupportedExtension})
				continue
			}
			candidate := superrename.Candidate{SourcePath: key, Name: entry.Name, Extension: ext, MediaKind: kind}
			if kind == superrename.MediaKindImage {
				group.Images = append(group.Images, candidate)
			} else {
				group.Videos = append(group.Videos, candidate)
			}
		}
		for _, entry := range raw.VideoEntries {
			group.VideoDirectory.OccupiedPaths = append(group.VideoDirectory.OccupiedPaths, path.Join(raw.Path, "视频", entry.Name))
		}
		inventory.Groups = append(inventory.Groups, group)
	}
	sort.SliceStable(inventory.Groups, func(i, j int) bool { return natsort.Less(inventory.Groups[i].Path, inventory.Groups[j].Path) })
	return inventory
}

func (s *Service) lookup(token string, actor int64, kind, scope string) (batchPreview, error) {
	value, ok := s.previews[token]
	if !ok || value.ActorID != actor || value.Kind != kind || value.Scope != scope || time.Now().After(value.Expires) {
		return batchPreview{}, errors.New("预览已过期或不属于当前窗口，请刷新预览")
	}
	return value, nil
}

func (s *Service) submitBatch(w http.ResponseWriter, r *http.Request, method string, req batchRequest, actor int64) {
	var account string
	groups := [][]batchItem{}
	guards := [][]cloudGroup{}
	if method == "power.submit" {
		value, err := s.lookup(req.PreviewToken, actor, "power", req.ParentID)
		if err != nil {
			respond(w, 409, nil, err.Error())
			return
		}
		if value.Conflict || len(value.Power) == 0 {
			respond(w, 409, nil, "没有可执行的无冲突改名计划")
			return
		}
		account = value.Scan.AccountID
		groups = append(groups, value.Power)
		guards = append(guards, value.Scan.Groups)
	} else {
		needed := map[string]bool{}
		for _, source := range req.Paths {
			needed[path.Dir(source)] = true
		}
		if len(needed) == 0 {
			respond(w, 400, nil, "请选择文件")
			return
		}
		rawGroups := []cloudGroup{}
		for groupPath := range needed {
			if !validGroupPath(groupPath) {
				respond(w, 400, nil, "invalid group path")
				return
			}
			value, err := s.lookup(req.Revisions[groupPath], actor, "super", req.ParentID)
			if err != nil || value.UsedGroups[groupPath] {
				respond(w, 409, nil, "分组预览已过期或已提交，请重新预览")
				return
			}
			if account != "" && account != value.Scan.AccountID {
				respond(w, 409, nil, "账号已变化，请重新预览")
				return
			}
			account = value.Scan.AccountID
			found := false
			for _, group := range value.Scan.Groups {
				if group.Path == groupPath {
					rawGroups = append(rawGroups, group)
					found = true
					break
				}
			}
			if !found {
				respond(w, 409, nil, "分组预览已失效")
				return
			}
		}
		plan, err := superrename.BuildPlan(superInventory(rawGroups), req.Paths)
		if err != nil || plan.HasConflict {
			respond(w, 409, nil, "存在冲突或选择已过期，请重新预览")
			return
		}
		for _, groupPlan := range plan.Groups {
			var raw cloudGroup
			for _, candidate := range rawGroups {
				if candidate.Path == groupPlan.Path {
					raw = candidate
					break
				}
			}
			byPath := map[string]cloudEntry{}
			for _, entry := range raw.Entries {
				byPath[path.Join(raw.Path, entry.Name)] = entry
			}
			items := []batchItem{}
			for _, item := range groupPlan.Items {
				if item.Changed {
					source := byPath[item.SourcePath]
					dest := raw.ID
					videoParent := ""
					if item.MediaKind == superrename.MediaKindVideo {
						dest = raw.VideoID
						if dest == "" {
							videoParent = raw.ID
						}
					}
					items = append(items, batchItem{ID: source.ID, ParentID: raw.ID, Name: source.Name, TargetName: item.TargetName, DestID: dest, VideoParentID: videoParent})
				}
			}
			groups = append(groups, items)
			guards = append(guards, []cloudGroup{raw})
		}
	}
	// Account check is read-only; do not fetch optional profile fields here.
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	raw, err := s.Provider.Call(ctx, "account", nil, nil)
	var identity struct {
		AccountID string `json:"accountId"`
	}
	if err != nil || json.Unmarshal(raw, &identity) != nil || identity.AccountID != account {
		respond(w, 409, nil, "115账号已变化或不可用，请重新预览")
		return
	}
	id := jobs.NewID()
	kind := "power_rename"
	if method == "super.submit" {
		kind = "super_rename"
	}
	if err := s.Store.Create(r.Context(), jobs.Job{ID: id, Type: kind, ActorID: actor, SourceRootID: "@115", DestRootID: "@115", ProgressTotal: len(groups)}); err != nil {
		respond(w, 500, nil, err.Error())
		return
	}
	if method == "power.submit" {
		delete(s.previews, req.PreviewToken)
	} else {
		for _, source := range req.Paths {
			group := path.Dir(source)
			token := req.Revisions[group]
			value := s.previews[token]
			if value.UsedGroups == nil {
				value.UsedGroups = map[string]bool{}
			}
			value.UsedGroups[group] = true
			s.previews[token] = value
		}
	}
	items := make([]map[string]any, 0, len(groups))
	for index, group := range groups {
		items = append(items, map[string]any{"items": group, "guards": guards[index]})
	}
	go s.run(id, "batch.execute", map[string]any{"accountId": account}, items)
	respond(w, 201, map[string]string{"id": id}, "")
}
