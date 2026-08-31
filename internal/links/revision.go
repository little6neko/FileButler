package links

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
)

const revisionVersion = 1

type revisionInput struct {
	Version    int
	Type       LinkType
	SourceRoot string
	DestRoot   string
	DestPath   string
	Groups     []revisionGroup
}

type revisionGroup struct {
	SourcePath          string
	DestPath            string
	SourceKind          SourceKind
	SourceIdentity      FileIdentity
	DestinationIdentity FileIdentity
	Counts              Counts
	Conflict            bool
	ErrorCode           ErrorCode
	Target              revisionTarget
	Steps               []revisionStep
}

type revisionTarget struct {
	Occupied bool
	Kind     SourceKind
	Identity FileIdentity
}

type revisionStep struct {
	Action           ActionKind
	RelativePath     string
	SourceIdentity   FileIdentity
	Mode             uint32
	ModifiedUnixNano int64
	OriginalTarget   string
	TargetText       string
	Mapping          LinkMappingKind
}

func computeRevision(preview Preview, groups []PlanGroup) (string, error) {
	input := revisionInput{
		Version:    revisionVersion,
		Type:       preview.Type,
		SourceRoot: preview.SourceRoot,
		DestRoot:   preview.DestRoot,
		DestPath:   preview.DestPath,
		Groups:     make([]revisionGroup, len(groups)),
	}
	for index, group := range groups {
		item := preview.Items[index]
		revisionGroup := revisionGroup{
			SourcePath:          item.SourcePath,
			DestPath:            item.DestPath,
			SourceKind:          item.SourceKind,
			SourceIdentity:      group.SourceIdentity,
			DestinationIdentity: group.DestinationIdentity,
			Counts:              item.Counts,
			Conflict:            item.Conflict,
			ErrorCode:           item.ErrorCode,
			Target: revisionTarget{
				Occupied: group.target.Occupied,
				Kind:     group.target.Kind,
				Identity: group.target.Identity,
			},
			Steps: make([]revisionStep, len(group.Steps)),
		}
		for stepIndex, step := range group.Steps {
			revisionGroup.Steps[stepIndex] = revisionStep{
				Action:           step.Action,
				RelativePath:     step.RelativePath,
				SourceIdentity:   step.SourceIdentity,
				Mode:             uint32(step.Mode.Perm()),
				ModifiedUnixNano: step.ModifiedUnixNano,
				OriginalTarget:   step.OriginalTarget,
				TargetText:       step.TargetText,
				Mapping:          step.Mapping,
			}
		}
		input.Groups[index] = revisionGroup
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(encoded)
	return "sha256:" + hex.EncodeToString(digest[:]), nil
}
