package cloud115

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/rename"
	"github.com/little6neko/filebutler/internal/roots"
	"github.com/little6neko/filebutler/internal/superrename"
)

func sampleScan() cloudScan {
	return cloudScan{AccountID: "7", SelectedIDs: []string{"1", "2"}, Groups: []cloudGroup{{ID: "10", ParentID: "0", Name: "Album", Path: "Album", Entries: []cloudEntry{
		{ID: "1", ParentID: "10", Name: "2.jpg"}, {ID: "2", ParentID: "10", Name: "10.jpg"},
		{ID: "3", ParentID: "10", Name: "V.mp4"}, {ID: "4", ParentID: "10", Name: "nested", IsDirectory: true},
	}}}}
}

func TestCloudPowerUsesSharedNaturalNumberingAndRejectsMetadata(t *testing.T) {
	opts := rename.Options{Search: "^.*", Replace: "${start=1,padding=3}", UseRegex: true, NameOnly: true}
	plan, items, err := planPower(sampleScan(), opts)
	if err != nil || plan.HasConflict || len(items) != 2 || items[0].TargetName != "001.jpg" || items[1].TargetName != "002.jpg" {
		t.Fatalf("%+v %+v %v", plan, items, err)
	}
	opts.Replace = "${CAMERA_MODEL}"
	if _, _, err := planPower(sampleScan(), opts); err == nil {
		t.Fatal("metadata template allowed")
	}
}

func TestCloudPowerSkipsUnsafeUnselectedNamesButRejectsUnsafeTargets(t *testing.T) {
	scan := sampleScan()
	scan.Groups[0].Entries = append(scan.Groups[0].Entries, cloudEntry{ID: "99", ParentID: "10", Name: "无关/文件.txt"})
	opts := rename.Options{Search: "^.*", Replace: "${start=1,padding=3}", UseRegex: true, NameOnly: true}
	plan, items, err := planPower(scan, opts)
	if err != nil || plan.HasConflict || len(items) != 2 {
		t.Fatalf("%+v %v", plan, err)
	}
	opts.Replace = "new\\name"
	plan, _, err = planPower(scan, opts)
	if err == nil && !plan.HasConflict {
		t.Fatal("unsafe target accepted")
	}
	scan.SelectedIDs = append(scan.SelectedIDs, "99")
	if _, _, err := planPower(scan, opts); err == nil {
		t.Fatal("unsafe selected source accepted")
	}
}

func TestCloudSuperUsesSharedVideoAndNestedGroupRules(t *testing.T) {
	inventory := superInventory(sampleScan().Groups)
	group := inventory.Groups[0]
	if len(group.ChildDirectories) != 1 || len(group.Images) != 2 || len(group.Videos) != 1 {
		t.Fatalf("%+v", group)
	}
	plan, err := superrename.BuildPlan(inventory, []string{"Album/2.jpg", "Album/10.jpg", "Album/V.mp4"})
	if err != nil || plan.HasConflict {
		t.Fatalf("%+v %v", plan, err)
	}
	names := map[string]bool{}
	for _, item := range plan.Groups[0].Items {
		names[item.TargetName] = true
	}
	if !names["01.jpg"] || !names["02.jpg"] || !names["V01.mp4"] {
		t.Fatalf("%v", names)
	}
}

type batchProvider struct{ calls chan map[string]any }

func (p *batchProvider) Call(ctx context.Context, method string, args any, report jobs.Reporter) (json.RawMessage, error) {
	switch method {
	case "account":
		return json.RawMessage(`{"accountId":"7"}`), nil
	case "batch.scan":
		return json.Marshal(sampleScan())
	case "batch.execute":
		p.calls <- args.(map[string]any)
		return json.RawMessage(`{"ok":true}`), nil
	}
	return nil, nil
}

func TestCloudBatchPreviewOwnershipExpiryAndSingleUse(t *testing.T) {
	provider := &batchProvider{calls: make(chan map[string]any, 4)}
	s := NewService(provider, jobs.NewStore(), roots.NewResolver(nil))
	router := chi.NewRouter()
	router.Post("/{method}", s.Handler)
	request := func(method, body string, actor int64) *httptest.ResponseRecorder {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("POST", "/"+method, strings.NewReader(body)).WithContext(auth.ContextWithUser(context.Background(), auth.User{ID: actor})))
		return response
	}
	denied := request("power.preview", `{"ids":["1"],"options":{"readMetadata":true}}`, 1)
	if denied.Code != 400 {
		t.Fatal(denied.Body.String())
	}
	response := request("power.preview", `{"ids":["1","2"],"options":{"search":"^.*","replace":"${start=1,padding=3}","useRegex":true,"nameOnly":true}}`, 1)
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	var result struct {
		Data struct {
			PreviewToken string `json:"previewToken"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	token := result.Data.PreviewToken
	body := `{"previewToken":"` + token + `"}`
	if r := request("power.submit", body, 2); r.Code != 409 {
		t.Fatal("different user accepted")
	}
	if r := request("power.submit", body, 1); r.Code != 201 {
		t.Fatal(r.Body.String())
	}
	if r := request("power.submit", body, 1); r.Code != 409 {
		t.Fatal("preview replay accepted")
	}
	select {
	case params := <-provider.calls:
		items := params["items"].([]batchItem)
		if items[0].TargetName != "001.jpg" || items[1].TargetName != "002.jpg" {
			t.Fatalf("plan changed: %+v", items)
		}
	case <-time.After(time.Second):
		t.Fatal("background execution missing")
	}
	s.previews["expired"] = batchPreview{ActorID: 1, Kind: "power", Scope: "0", Expires: time.Now().Add(-time.Second)}
	if _, err := s.lookup("expired", 1, "power", "0"); err == nil {
		t.Fatal("expired preview accepted")
	}
}

func TestCloudSuperPreviewsAreConsumedPerGroup(t *testing.T) {
	provider := &batchProvider{calls: make(chan map[string]any, 4)}
	s := NewService(provider, jobs.NewStore(), roots.NewResolver(nil))
	scan := sampleScan()
	token := s.remember(batchPreview{ActorID: 1, Scope: "0", Kind: "super", Scan: scan})
	req := batchRequest{ParentID: "0", Paths: []string{"Album/V.mp4"}, Revisions: map[string]string{"Album": token}}
	response := httptest.NewRecorder()
	s.submitBatch(response, httptest.NewRequest("POST", "/", nil), "super.submit", req, 1)
	if response.Code != 201 {
		t.Fatal(response.Body.String())
	}
	response = httptest.NewRecorder()
	s.submitBatch(response, httptest.NewRequest("POST", "/", nil), "super.submit", req, 1)
	if response.Code != 409 {
		t.Fatal("same group submitted twice")
	}
	select {
	case <-provider.calls:
	case <-time.After(time.Second):
		t.Fatal("job missing")
	}
}
