import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hunk, lowRisk, risk } from './lib.ts';
import type { HunkSpec } from './lib.ts';
import {
  grpcClientHunk,
  grpcServerHunk,
  mockHunk,
  pbDescriptorHunk,
  pbGettersHunk,
  pbRegistrationHunk,
  pbStructHunk,
  pbTypesHunk,
  sqlcGetHunk,
  sqlcListHunk,
  sqlcUpdateHunk,
} from './content-generated.ts';
import type {
  Check,
  Comment,
  FileSignals,
  Graph,
  Group,
  PathStep,
  ReviewDocument,
  ReviewFile,
  Summary,
} from '../packages/cockpit/src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));

const HEAD_SHA = 'd4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3';
const BASE_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const GENERATED_AT = '2026-09-08T12:34:56Z';

function signals(over: Partial<FileSignals> = {}): FileSignals {
  return {
    churnCommits90d: 3,
    bugfixCommits: 0,
    authorPriorCommits: 4,
    fanIn: 2,
    fanOut: 3,
    fanSource: 'grep',
    complexityBefore: 4,
    complexityAfter: 5,
    sensitivePath: { match: false, rule: null },
    testFile: false,
    coverageDelta: null,
    ...over,
  };
}

interface FileSpec {
  id: string;
  path: string;
  status?: ReviewFile['status'];
  previousPath?: string;
  language: string;
  generated?: string;
  signals: FileSignals;
  hunks: HunkSpec[];
}

function buildFile(spec: FileSpec): ReviewFile {
  const hunks = spec.hunks.map((h, i) => hunk(spec.id, i + 1, h));
  const additions = hunks.reduce(
    (n, h) => n + h.lines.filter((l) => l.type === 'add').length,
    0,
  );
  const deletions = hunks.reduce(
    (n, h) => n + h.lines.filter((l) => l.type === 'del').length,
    0,
  );
  return {
    id: spec.id,
    path: spec.path,
    previousPath: spec.previousPath ?? null,
    status: spec.status ?? 'modified',
    language: spec.language,
    binary: false,
    generated: spec.generated ? { is: true, rule: spec.generated } : { is: false, rule: null },
    additions,
    deletions,
    signals: spec.signals,
    hunks,
  };
}

const renameFactors = [
  { signal: 'identifierRename', contribution: 0.05, detail: 'single identifier replaced' },
  { signal: 'fanIn', contribution: 0.04, detail: '2 callers' },
];

function renameFile(
  id: string,
  path: string,
  language: string,
  bodies: Array<{ oldStart: number; newStart: number; header: string; symbols: string[]; body: string }>,
): ReviewFile {
  return buildFile({
    id,
    path,
    language,
    signals: signals({ fanIn: 6, fanOut: 4 }),
    hunks: bodies.map((b) => ({
      oldStart: b.oldStart,
      newStart: b.newStart,
      header: b.header,
      symbols: b.symbols,
      kind: 'code',
      risk: lowRisk(0.12, renameFactors),
      body: b.body,
    })),
  });
}

const files: ReviewFile[] = [
  renameFile('f1', 'api/http/tenant.go', 'go', [
    {
      oldStart: 44,
      newStart: 44,
      header: 'func (h *Handler) PatchTenant(w http.ResponseWriter, r *http.Request) {',
      symbols: ['Handler.PatchTenant'],
      body: `
 func (h *Handler) PatchTenant(w http.ResponseWriter, r *http.Request) {
-\tvar body tenantRecordBody
+\tvar body tenantProfileBody
 \tif err := json.NewDecoder(r.Body).Decode(&body); err != nil {
 \t\twriteError(w, http.StatusBadRequest, err)
 \t\treturn
 \t}
`,
    },
    {
      oldStart: 112,
      newStart: 112,
      header: 'func (h *Handler) PatchTenant(w http.ResponseWriter, r *http.Request) {',
      symbols: ['Handler.PatchTenant'],
      body: `
-\trec, err := h.tenants.UpdateRecord(r.Context(), &tenantv1.UpdateRecordRequest{
-\t\tRecord: body.toProto(),
+\trec, err := h.tenants.UpdateTenantProfile(r.Context(), &tenantv1.UpdateTenantProfileRequest{
+\t\tProfile: body.toProto(),
 \t})
 \tif err != nil {
 \t\twriteError(w, http.StatusInternalServerError, err)
`,
    },
  ]),

  buildFile({
    id: 'f2',
    path: 'api/proto/tenant/v1/tenant.pb.go',
    language: 'go',
    generated: '**/*.pb.go',
    signals: signals({ churnCommits90d: 9, fanIn: null, fanOut: null, complexityBefore: null, complexityAfter: null }),
    hunks: [
      {
        oldStart: 26,
        newStart: 26,
        header: 'const (',
        symbols: [],
        kind: 'code',
        risk: lowRisk(0.02, [{ signal: 'generated', contribution: 0, detail: 'matches **/*.pb.go' }]),
        body: pbStructHunk,
      },
      {
        oldStart: 120,
        newStart: 148,
        header: 'type TenantProfile struct {',
        symbols: ['TenantProfile'],
        kind: 'code',
        risk: lowRisk(0.02, [{ signal: 'generated', contribution: 0, detail: 'matches **/*.pb.go' }]),
        body: pbGettersHunk,
      },
      {
        oldStart: 420,
        newStart: 640,
        header: 'var file_api_proto_tenant_v1_tenant_proto_rawDesc = []byte{',
        symbols: [],
        kind: 'code',
        risk: lowRisk(0.02, [{ signal: 'generated', contribution: 0, detail: 'matches **/*.pb.go' }]),
        body: pbDescriptorHunk,
      },
      {
        oldStart: 560,
        newStart: 940,
        header: 'func file_api_proto_tenant_v1_tenant_proto_rawDescGZIP() []byte {',
        symbols: [],
        kind: 'code',
        risk: lowRisk(0.02, [{ signal: 'generated', contribution: 0, detail: 'matches **/*.pb.go' }]),
        body: pbTypesHunk,
      },
      {
        oldStart: 604,
        newStart: 1020,
        header: 'func file_api_proto_tenant_v1_tenant_proto_init() {',
        symbols: ['file_api_proto_tenant_v1_tenant_proto_init'],
        kind: 'code',
        risk: lowRisk(0.02, [{ signal: 'generated', contribution: 0, detail: 'matches **/*.pb.go' }]),
        body: pbRegistrationHunk,
      },
    ],
  }),

  buildFile({
    id: 'f3',
    path: 'api/proto/tenant/v1/tenant.proto',
    language: 'proto',
    signals: signals({ churnCommits90d: 6, bugfixCommits: 1, fanIn: 12, fanOut: null, complexityBefore: null, complexityAfter: null }),
    hunks: [
      {
        oldStart: 1,
        newStart: 1,
        header: '',
        symbols: [],
        kind: 'code',
        risk: risk({
          floor: 'medium',
          score: 0.44,
          factors: [
            { signal: 'apiSurface', contribution: 0.26, detail: 'protobuf message and service definition' },
            { signal: 'fanIn', contribution: 0.12, detail: '12 callers of the generated types' },
            { signal: 'churnCommits90d', contribution: 0.06, detail: '6 commits in 90 days' },
          ],
          reason:
            'The wire contract changes: TenantRecord becomes TenantProfile and four RPCs are renamed. Any client built against the old service name breaks.',
        }),
        body: `
 syntax = "proto3";

 package tenant.v1;

 import "google/protobuf/field_mask.proto";
 import "google/protobuf/timestamp.proto";

 option go_package = "github.com/northwind-labs/tenant-platform/api/proto/tenant/v1;tenantv1";

-message TenantRecord {
-  string id = 1;
-  string tenant_id = 2;
-  string display_name = 3;
-}
+enum TenantTier {
+  TENANT_TIER_UNSPECIFIED = 0;
+  TENANT_TIER_FREE = 1;
+  TENANT_TIER_STANDARD = 2;
+  TENANT_TIER_ENTERPRISE = 3;
+}
+
+message TenantProfile {
+  string id = 1;
+  string tenant_id = 2;
+  string display_name = 3;
+  string region = 4;
+  TenantTier tier = 5;
+  int32 retention_days = 6;
+  string owner_email = 7;
+  map<string, bool> feature_flags = 8;
+  repeated string labels = 9;
+  google.protobuf.Timestamp created_at = 10;
+  google.protobuf.Timestamp updated_at = 11;
+  google.protobuf.Timestamp deleted_at = 12;
+}
+
+message UpdateTenantProfileRequest {
+  TenantProfile profile = 1;
+  google.protobuf.FieldMask update_mask = 2;
+  string if_match = 3;
+  bool dry_run = 4;
+}

 service TenantService {
-  rpc UpdateRecord(UpdateRecordRequest) returns (Record);
+  rpc UpdateTenantProfile(UpdateTenantProfileRequest) returns (UpdateTenantProfileResponse);
+  rpc GetTenantProfile(GetTenantProfileRequest) returns (GetTenantProfileResponse);
+  rpc ListTenantProfiles(ListTenantProfilesRequest) returns (ListTenantProfilesResponse);
+  rpc DeleteTenantProfile(DeleteTenantProfileRequest) returns (DeleteTenantProfileResponse);
 }
`,
      },
    ],
  }),

  buildFile({
    id: 'f4',
    path: 'api/proto/tenant/v1/tenant_grpc.pb.go',
    language: 'go',
    generated: '**/*_grpc.pb.go',
    signals: signals({ fanIn: null, fanOut: null, complexityBefore: null, complexityAfter: null }),
    hunks: [
      {
        oldStart: 18,
        newStart: 18,
        header: 'const (',
        symbols: [],
        kind: 'code',
        risk: lowRisk(0.02, [{ signal: 'generated', contribution: 0, detail: 'matches **/*_grpc.pb.go' }]),
        body: grpcClientHunk,
      },
      {
        oldStart: 96,
        newStart: 152,
        header: 'type TenantServiceServer interface {',
        symbols: [],
        kind: 'code',
        risk: lowRisk(0.02, [{ signal: 'generated', contribution: 0, detail: 'matches **/*_grpc.pb.go' }]),
        body: grpcServerHunk,
      },
    ],
  }),

  renameFile('f5', 'api/service/tenant/convert.go', 'go', [
    {
      oldStart: 12,
      newStart: 12,
      header: 'func toProto(row gen.TenantProfile) *pb.TenantProfile {',
      symbols: ['toProto'],
      body: `
-func toProto(row gen.TenantRecord) *pb.TenantRecord {
-\treturn &pb.TenantRecord{
+func toProto(row gen.TenantProfile) *pb.TenantProfile {
+\treturn &pb.TenantProfile{
 \t\tId:          row.ID,
 \t\tTenantId:    row.TenantID,
 \t\tDisplayName: row.DisplayName,
`,
    },
    {
      oldStart: 30,
      newStart: 30,
      header: 'func fromProto(p *pb.TenantProfile) gen.TenantProfile {',
      symbols: ['fromProto'],
      body: `
-func fromProto(p *pb.TenantRecord) gen.TenantRecord {
-\treturn gen.TenantRecord{
+func fromProto(p *pb.TenantProfile) gen.TenantProfile {
+\treturn gen.TenantProfile{
 \t\tID:          p.GetId(),
 \t\tTenantID:    p.GetTenantId(),
 \t\tDisplayName: p.GetDisplayName(),
`,
    },
  ]),

  renameFile('f6', 'api/service/tenant/list.go', 'go', [
    {
      oldStart: 18,
      newStart: 18,
      header: 'func (s *Service) ListRecords(ctx context.Context, req *pb.ListTenantProfilesRequest) (*pb.ListTenantProfilesResponse, error) {',
      symbols: ['Service.ListRecords'],
      body: `
-func (s *Service) ListRecords(ctx context.Context, req *pb.ListRecordsRequest) (*pb.ListRecordsResponse, error) {
-\trows, err := s.store.ListTenantRecords(ctx, req.GetTenantId())
+func (s *Service) ListRecords(ctx context.Context, req *pb.ListTenantProfilesRequest) (*pb.ListTenantProfilesResponse, error) {
+\trows, err := s.store.ListTenantProfiles(ctx, listParams(req))
 \tif err != nil {
 \t\treturn nil, err
 \t}
`,
    },
    {
      oldStart: 34,
      newStart: 34,
      header: 'func (s *Service) ListRecords(ctx context.Context, req *pb.ListTenantProfilesRequest) (*pb.ListTenantProfilesResponse, error) {',
      symbols: ['Service.ListRecords'],
      body: `
-\tout := make([]*pb.TenantRecord, 0, len(rows))
+\tout := make([]*pb.TenantProfile, 0, len(rows))
 \tfor _, row := range rows {
 \t\tout = append(out, toProto(row))
 \t}
-\treturn &pb.ListRecordsResponse{Records: out}, nil
+\treturn &pb.ListTenantProfilesResponse{Profiles: out}, nil
 }
`,
    },
  ]),

  buildFile({
    id: 'f7',
    path: 'api/service/tenant/record.go',
    language: 'go',
    signals: signals({
      churnCommits90d: 14,
      bugfixCommits: 5,
      authorPriorCommits: 0,
      fanIn: 23,
      fanOut: 7,
      complexityBefore: 18,
      complexityAfter: 27,
      sensitivePath: { match: true, rule: '**/api/service/**' },
    }),
    hunks: [
      {
        oldStart: 3,
        newStart: 3,
        header: 'import (',
        symbols: [],
        kind: 'import',
        risk: lowRisk(0.08, [
          { signal: 'kind', contribution: 0, detail: 'import block only' },
        ]),
        body: `
 import (
 \t"context"
 \t"database/sql"
 \t"errors"
 \t"fmt"
+\t"time"

 \tpb "github.com/northwind-labs/tenant-platform/api/proto/tenant/v1"
 \t"github.com/northwind-labs/tenant-platform/db/gen"
+\t"github.com/northwind-labs/tenant-platform/internal/store"
+\t"google.golang.org/grpc/codes"
+\t"google.golang.org/grpc/status"
 )
`,
      },
      {
        oldStart: 88,
        newStart: 91,
        header: 'func (s *Service) UpdateRecord(ctx context.Context, req *pb.UpdateTenantProfileRequest) (*pb.UpdateTenantProfileResponse, error) {',
        symbols: ['Service.UpdateRecord'],
        kind: 'code',
        risk: risk({
          floor: 'high',
          score: 0.82,
          factors: [
            { signal: 'sensitivePath', contribution: 0.3, detail: 'matches **/api/service/**' },
            { signal: 'fanIn', contribution: 0.22, detail: '23 callers' },
            { signal: 'bugfixCommits', contribution: 0.18, detail: '5 fix commits in 90 days' },
            { signal: 'complexityDelta', contribution: 0.12, detail: 'complexity 18 to 27' },
          ],
          reason:
            'Changes the error contract of UpdateRecord. Callers matching on ErrMissingID will silently stop matching, and the new If-Match branch reads the row before writing it.',
        }),
        body: `
 func (s *Service) UpdateRecord(ctx context.Context, req *pb.UpdateTenantProfileRequest) (*pb.UpdateTenantProfileResponse, error) {
 \tif req.GetProfile() == nil {
-\t\treturn nil, ErrMissingProfile
+\t\treturn nil, status.Error(codes.InvalidArgument, "profile is required")
 \t}
 \tif req.GetProfile().GetId() == "" {
-\t\treturn nil, ErrMissingID
+\t\treturn nil, status.Error(codes.InvalidArgument, "id is required")
 \t}
-\tif err := s.validate(req.GetProfile()); err != nil {
-\t\treturn nil, err
+\tif err := s.validate(ctx, req.GetProfile(), req.GetUpdateMask()); err != nil {
+\t\treturn nil, status.Error(codes.InvalidArgument, err.Error())
 \t}
+\tif req.GetIfMatch() != "" {
+\t\tcurrent, err := s.store.GetTenantProfile(ctx, req.GetProfile().GetId())
+\t\tif err != nil {
+\t\t\treturn nil, toStatus(err)
+\t\t}
+\t\tif etag(current) != req.GetIfMatch() {
+\t\t\treturn nil, status.Error(codes.Aborted, "profile changed since it was read")
+\t\t}
+\t}
+\tif req.GetDryRun() {
+\t\treturn &pb.UpdateTenantProfileResponse{Profile: req.GetProfile()}, nil
+\t}
 \tupdated, err := s.store.UpdateTenantProfile(ctx, gen.UpdateTenantProfileParams{
 \t\tID:          req.GetProfile().GetId(),
 \t\tDisplayName: req.GetProfile().GetDisplayName(),
+\t\tRegion:        req.GetProfile().GetRegion(),
+\t\tTier:          req.GetProfile().GetTier().String(),
+\t\tRetentionDays: req.GetProfile().GetRetentionDays(),
+\t\tOwnerEmail:    nullString(req.GetProfile().GetOwnerEmail()),
 \t})
 \tif err != nil {
-\t\treturn nil, err
+\t\treturn nil, toStatus(err)
 \t}
+\ts.audit.RecordProfileChange(ctx, updated.ID, time.Now().UTC())
 \treturn &pb.UpdateTenantProfileResponse{Profile: toProto(updated)}, nil
 }
`,
      },
      {
        oldStart: 152,
        newStart: 176,
        header: 'func (s *Service) GetRecord(ctx context.Context, req *pb.GetTenantProfileRequest) (*pb.GetTenantProfileResponse, error) {',
        symbols: ['Service.GetRecord', 'toStatus'],
        kind: 'code',
        risk: risk({
          floor: 'medium',
          score: 0.51,
          factors: [
            { signal: 'sensitivePath', contribution: 0.3, detail: 'matches **/api/service/**' },
            { signal: 'fanIn', contribution: 0.14, detail: '23 callers' },
            { signal: 'errorHandling', contribution: 0.07, detail: 'error mapping moved into a helper' },
          ],
          reason:
            'GetRecord now hides soft-deleted rows. A caller that relied on reading a deleted profile gets NotFound instead.',
        }),
        body: `
 func (s *Service) GetRecord(ctx context.Context, req *pb.GetTenantProfileRequest) (*pb.GetTenantProfileResponse, error) {
 \tif req.GetId() == "" {
-\t\treturn nil, ErrMissingID
+\t\treturn nil, status.Error(codes.InvalidArgument, "id is required")
 \t}
 \trow, err := s.store.GetTenantProfile(ctx, req.GetId())
 \tif err != nil {
-\t\tif errors.Is(err, sql.ErrNoRows) {
-\t\t\treturn nil, ErrNotFound
-\t\t}
-\t\treturn nil, err
+\t\treturn nil, toStatus(err)
 \t}
+\tif row.DeletedAt.Valid {
+\t\treturn nil, status.Error(codes.NotFound, "profile not found")
+\t}
 \treturn &pb.GetTenantProfileResponse{Profile: toProto(row)}, nil
 }
+
+func toStatus(err error) error {
+\tswitch {
+\tcase errors.Is(err, sql.ErrNoRows):
+\t\treturn status.Error(codes.NotFound, "profile not found")
+\tcase errors.Is(err, store.ErrConflict):
+\t\treturn status.Error(codes.Aborted, "profile changed since it was read")
+\tdefault:
+\t\treturn status.Errorf(codes.Internal, "update profile: %v", err)
+\t}
+}
`,
      },
    ],
  }),

  buildFile({
    id: 'f8',
    path: 'api/service/tenant/record_test.go',
    language: 'go',
    signals: signals({ testFile: true, fanIn: 0, fanOut: 9, complexityBefore: 6, complexityAfter: 11 }),
    hunks: [
      {
        oldStart: 1,
        newStart: 1,
        header: '',
        symbols: [],
        kind: 'test',
        risk: lowRisk(0.1, [{ signal: 'testFile', contribution: 0, detail: 'test file' }]),
        body: `
 package tenant

 import (
 \t"context"
+\t"database/sql"
+\t"errors"
 \t"testing"
+\t"time"

 \tpb "github.com/northwind-labs/tenant-platform/api/proto/tenant/v1"
 \t"github.com/northwind-labs/tenant-platform/db/gen"
+\t"go.uber.org/mock/gomock"
+\t"google.golang.org/grpc/codes"
+\t"google.golang.org/grpc/status"
+\t"google.golang.org/protobuf/types/known/fieldmaskpb"
 )

-func TestUpdateRecordMissingID(t *testing.T) {
-\ts := NewService(newFakeStore(), nopAuditor{})
-\t_, err := s.UpdateRecord(context.Background(), &pb.UpdateRecordRequest{
-\t\tRecord: &pb.TenantRecord{},
-\t})
-\tif !errors.Is(err, ErrMissingID) {
-\t\tt.Fatalf("want ErrMissingID, got %v", err)
-\t}
-}
+func TestUpdateRecordInvalidArgument(t *testing.T) {
+\tt.Parallel()
+
+\tcases := []struct {
+\t\tname string
+\t\treq  *pb.UpdateTenantProfileRequest
+\t\twant string
+\t}{
+\t\t{
+\t\t\tname: "no profile",
+\t\t\treq:  &pb.UpdateTenantProfileRequest{},
+\t\t\twant: "profile is required",
+\t\t},
+\t\t{
+\t\t\tname: "no id",
+\t\t\treq:  &pb.UpdateTenantProfileRequest{Profile: &pb.TenantProfile{}},
+\t\t\twant: "id is required",
+\t\t},
+\t\t{
+\t\t\tname: "unknown mask path",
+\t\t\treq: &pb.UpdateTenantProfileRequest{
+\t\t\t\tProfile:    &pb.TenantProfile{Id: "t-1", DisplayName: "acme"},
+\t\t\t\tUpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"nope"}},
+\t\t\t},
+\t\t\twant: "unknown field",
+\t\t},
+\t}
+
+\tfor _, tc := range cases {
+\t\tt.Run(tc.name, func(t *testing.T) {
+\t\t\ts := NewService(newFakeStore(), nopAuditor{})
+\t\t\t_, err := s.UpdateRecord(context.Background(), tc.req)
+\t\t\tif status.Code(err) != codes.InvalidArgument {
+\t\t\t\tt.Fatalf("want InvalidArgument, got %v", err)
+\t\t\t}
+\t\t\tif !strings.Contains(status.Convert(err).Message(), tc.want) {
+\t\t\t\tt.Fatalf("want message containing %q, got %q", tc.want, status.Convert(err).Message())
+\t\t\t}
+\t\t})
+\t}
+}
`,
      },
      {
        oldStart: 58,
        newStart: 104,
        header: 'func TestUpdateRecordIfMatch(t *testing.T) {',
        symbols: ['TestUpdateRecordIfMatch', 'TestGetRecordSoftDeleted'],
        kind: 'test',
        risk: lowRisk(0.14, [{ signal: 'testFile', contribution: 0, detail: 'test file' }]),
        body: `
 func newFakeStore() *fakeStore {
 \treturn &fakeStore{rows: map[string]gen.TenantProfile{}}
 }

+func TestUpdateRecordIfMatch(t *testing.T) {
+\tt.Parallel()
+
+\tctrl := gomock.NewController(t)
+\tstore := NewMockTenantStore(ctrl)
+\tstore.EXPECT().
+\t\tGetTenantProfile(gomock.Any(), "t-1").
+\t\tReturn(gen.TenantProfile{ID: "t-1", UpdatedAt: time.Unix(1700000000, 0)}, nil)
+
+\ts := NewService(store, nopAuditor{})
+\t_, err := s.UpdateRecord(context.Background(), &pb.UpdateTenantProfileRequest{
+\t\tProfile: &pb.TenantProfile{Id: "t-1", DisplayName: "acme", Region: "us-east-1"},
+\t\tIfMatch: "stale-etag",
+\t})
+\tif status.Code(err) != codes.Aborted {
+\t\tt.Fatalf("want Aborted, got %v", err)
+\t}
+}
+
+func TestGetRecordSoftDeleted(t *testing.T) {
+\tt.Parallel()
+
+\tctrl := gomock.NewController(t)
+\tstore := NewMockTenantStore(ctrl)
+\tstore.EXPECT().
+\t\tGetTenantProfile(gomock.Any(), "t-2").
+\t\tReturn(gen.TenantProfile{ID: "t-2", DeletedAt: sql.NullTime{Valid: true, Time: time.Now()}}, nil)
+
+\ts := NewService(store, nopAuditor{})
+\t_, err := s.GetRecord(context.Background(), &pb.GetTenantProfileRequest{Id: "t-2"})
+\tif status.Code(err) != codes.NotFound {
+\t\tt.Fatalf("want NotFound, got %v", err)
+\t}
+}
+
+func TestToStatusUnknownError(t *testing.T) {
+\tt.Parallel()
+
+\tif got := status.Code(toStatus(errors.New("boom"))); got != codes.Internal {
+\t\tt.Fatalf("want Internal, got %v", got)
+\t}
+}
+
 type nopAuditor struct{}

 func (nopAuditor) RecordProfileChange(context.Context, string, time.Time) {}
`,
      },
    ],
  }),

  buildFile({
    id: 'f9',
    path: 'api/service/tenant/validate.go',
    language: 'go',
    signals: signals({
      churnCommits90d: 7,
      bugfixCommits: 2,
      fanIn: 9,
      fanOut: 5,
      complexityBefore: 9,
      complexityAfter: 16,
      sensitivePath: { match: true, rule: '**/api/service/**' },
    }),
    hunks: [
      {
        oldStart: 20,
        newStart: 20,
        header: 'func (s *Service) validate(ctx context.Context, p *pb.TenantProfile, mask *fieldmaskpb.FieldMask) error {',
        symbols: ['Service.validate', 'profileValidators'],
        kind: 'code',
        risk: risk({
          floor: 'medium',
          level: 'high',
          score: 0.58,
          factors: [
            { signal: 'sensitivePath', contribution: 0.3, detail: 'matches **/api/service/**' },
            { signal: 'complexityDelta', contribution: 0.16, detail: 'complexity 9 to 16' },
            { signal: 'fanIn', contribution: 0.12, detail: '9 callers' },
          ],
          reason:
            'Validation becomes field-mask driven, so a request with an empty mask now validates every field. An update that used to pass can start failing.',
          adjustedBy: {
            from: 'medium',
            to: 'high',
            why: 'An empty update_mask silently switches the request from partial to full validation.',
          },
        }),
        body: `
-func (s *Service) validate(p *pb.TenantProfile) error {
-\tif p.GetDisplayName() == "" {
-\t\treturn fmt.Errorf("display_name is required")
+func (s *Service) validate(ctx context.Context, p *pb.TenantProfile, mask *fieldmaskpb.FieldMask) error {
+\tpaths := mask.GetPaths()
+\tif len(paths) == 0 {
+\t\tpaths = allProfilePaths
+\t}
+\tfor _, path := range paths {
+\t\tcheck, ok := profileValidators[path]
+\t\tif !ok {
+\t\t\treturn fmt.Errorf("unknown field %q in update_mask", path)
+\t\t}
+\t\tif err := check(ctx, p); err != nil {
+\t\t\treturn err
+\t\t}
 \t}
-\tif len(p.GetDisplayName()) > 64 {
-\t\treturn fmt.Errorf("display_name is too long")
-\t}
 \treturn nil
 }
+
+var allProfilePaths = []string{"display_name", "region", "tier", "retention_days"}
+
+var profileValidators = map[string]func(context.Context, *pb.TenantProfile) error{
+\t"display_name": func(_ context.Context, p *pb.TenantProfile) error {
+\t\tif p.GetDisplayName() == "" {
+\t\t\treturn fmt.Errorf("display_name is required")
+\t\t}
+\t\tif len(p.GetDisplayName()) > 64 {
+\t\t\treturn fmt.Errorf("display_name is too long")
+\t\t}
+\t\treturn nil
+\t},
+\t"region": validateRegion,
+\t"tier": func(_ context.Context, p *pb.TenantProfile) error {
+\t\tif p.GetTier() == pb.TenantTier_TENANT_TIER_UNSPECIFIED {
+\t\t\treturn fmt.Errorf("tier is required")
+\t\t}
+\t\treturn nil
+\t},
+\t"retention_days": func(_ context.Context, p *pb.TenantProfile) error {
+\t\tif p.GetRetentionDays() < 1 || p.GetRetentionDays() > 3650 {
+\t\t\treturn fmt.Errorf("retention_days must be between 1 and 3650")
+\t\t}
+\t\treturn nil
+\t},
+}
`,
      },
      {
        oldStart: 96,
        newStart: 132,
        header: 'func normalizeName(s string) string {',
        symbols: ['normalizeName'],
        kind: 'whitespace-only',
        risk: lowRisk(0.03, [
          { signal: 'kind', contribution: 0, detail: 'whitespace only: spaces replaced by tabs' },
        ]),
        body: `
 func normalizeName(s string) string {
-    s = strings.TrimSpace(s)
-    return strings.ToLower(s)
+\ts = strings.TrimSpace(s)
+\treturn strings.ToLower(s)
 }
`,
      },
    ],
  }),

  renameFile('f10', 'cmd/api/main.go', 'go', [
    {
      oldStart: 58,
      newStart: 58,
      header: 'func main() {',
      symbols: ['main'],
      body: `
-\ttenants := store.NewTenantRecordStore(db)
+\ttenants := store.NewTenantProfileStore(db)
 \tsvc := tenant.NewService(tenants, auditor)
 \ttenantv1.RegisterTenantServiceServer(grpcServer, svc)
`,
    },
    {
      oldStart: 96,
      newStart: 96,
      header: 'func main() {',
      symbols: ['main'],
      body: `
-\tlog.Printf("tenant record api listening on %s", addr)
+\tlog.Printf("tenant profile api listening on %s", addr)
 \tif err := grpcServer.Serve(lis); err != nil {
 \t\tlog.Fatalf("serve: %v", err)
 \t}
`,
    },
  ]),

  renameFile('f11', 'cmd/worker/sync.go', 'go', [
    {
      oldStart: 40,
      newStart: 40,
      header: 'func syncTenants(ctx context.Context, c tenantv1.TenantServiceClient) error {',
      symbols: ['syncTenants'],
      body: `
 func syncTenants(ctx context.Context, c tenantv1.TenantServiceClient) error {
-\tresp, err := c.ListRecords(ctx, &tenantv1.ListRecordsRequest{TenantId: id})
+\tresp, err := c.ListTenantProfiles(ctx, &tenantv1.ListTenantProfilesRequest{TenantId: id})
 \tif err != nil {
 \t\treturn err
 \t}
`,
    },
    {
      oldStart: 62,
      newStart: 62,
      header: 'func syncTenants(ctx context.Context, c tenantv1.TenantServiceClient) error {',
      symbols: ['syncTenants'],
      body: `
-\tfor _, rec := range resp.GetRecords() {
-\t\tif err := upsert(ctx, rec); err != nil {
+\tfor _, profile := range resp.GetProfiles() {
+\t\tif err := upsert(ctx, profile); err != nil {
 \t\t\treturn err
 \t\t}
 \t}
`,
    },
  ]),

  buildFile({
    id: 'f12',
    path: 'db/gen/tenant.sql.go',
    language: 'go',
    generated: '**/db/gen/**',
    signals: signals({ fanIn: null, fanOut: null, complexityBefore: null, complexityAfter: null }),
    hunks: [
      {
        oldStart: 1,
        newStart: 1,
        header: '',
        symbols: [],
        kind: 'code',
        risk: lowRisk(0.02, [{ signal: 'generated', contribution: 0, detail: 'sqlc output under db/gen' }]),
        body: sqlcUpdateHunk,
      },
      {
        oldStart: 70,
        newStart: 118,
        header: 'const listTenantProfiles = `-- name: ListTenantProfiles :many',
        symbols: [],
        kind: 'code',
        risk: lowRisk(0.02, [{ signal: 'generated', contribution: 0, detail: 'sqlc output under db/gen' }]),
        body: sqlcListHunk,
      },
      {
        oldStart: 140,
        newStart: 232,
        header: 'const getTenantProfile = `-- name: GetTenantProfile :one',
        symbols: [],
        kind: 'code',
        risk: lowRisk(0.02, [{ signal: 'generated', contribution: 0, detail: 'sqlc output under db/gen' }]),
        body: sqlcGetHunk,
      },
    ],
  }),

  buildFile({
    id: 'f13',
    path: 'db/migrations/0042_tenant_profile_region.sql',
    status: 'added',
    language: 'other',
    signals: signals({
      churnCommits90d: 0,
      bugfixCommits: 0,
      authorPriorCommits: 0,
      fanIn: null,
      fanOut: null,
      fanSource: null,
      complexityBefore: null,
      complexityAfter: null,
      sensitivePath: { match: true, rule: '**/db/migrations/**' },
    }),
    hunks: [
      {
        oldStart: 0,
        newStart: 1,
        header: '',
        symbols: [],
        kind: 'code',
        risk: risk({
          floor: 'high',
          score: 0.76,
          factors: [
            { signal: 'sensitivePath', contribution: 0.35, detail: 'matches **/db/migrations/**' },
            { signal: 'schemaChange', contribution: 0.25, detail: 'ALTER TABLE with NOT NULL column' },
            { signal: 'irreversible', contribution: 0.16, detail: 'down migration drops columns' },
          ],
          reason:
            'Adds region as NOT NULL with no default, so the migration fails on any table that already has rows. The backfill runs after the column is added, which is too late.',
        }),
        body: `
+-- +migrate Up
+ALTER TABLE tenant_profiles
+    ADD COLUMN region text NOT NULL,
+    ADD COLUMN tier text NOT NULL DEFAULT 'TENANT_TIER_STANDARD',
+    ADD COLUMN retention_days integer NOT NULL DEFAULT 30,
+    ADD COLUMN owner_email text,
+    ADD COLUMN deleted_at timestamptz;
+
+CREATE INDEX tenant_profiles_tenant_id_region_idx
+    ON tenant_profiles (tenant_id, region)
+    WHERE deleted_at IS NULL;
+
+UPDATE tenant_profiles SET region = 'us-east-1' WHERE region = '';
+
+-- +migrate Down
+DROP INDEX tenant_profiles_tenant_id_region_idx;
+ALTER TABLE tenant_profiles
+    DROP COLUMN region,
+    DROP COLUMN tier,
+    DROP COLUMN retention_days,
+    DROP COLUMN owner_email,
+    DROP COLUMN deleted_at;
`,
      },
    ],
  }),

  buildFile({
    id: 'f14',
    path: 'db/queries/tenant.sql',
    language: 'other',
    signals: signals({ churnCommits90d: 5, fanIn: null, fanOut: null, fanSource: null, complexityBefore: null, complexityAfter: null }),
    hunks: [
      {
        oldStart: 1,
        newStart: 1,
        header: '',
        symbols: [],
        kind: 'code',
        risk: risk({
          floor: 'medium',
          score: 0.41,
          factors: [
            { signal: 'schemaChange', contribution: 0.22, detail: 'query shape drives generated types' },
            { signal: 'churnCommits90d', contribution: 0.09, detail: '5 commits in 90 days' },
          ],
          reason: null,
        }),
        body: `
--- name: UpdateTenantRecord :one
-UPDATE tenant_records
-SET display_name = $2, updated_at = now()
-WHERE id = $1
-RETURNING id, tenant_id, display_name, created_at, updated_at;
+-- name: UpdateTenantProfile :one
+UPDATE tenant_profiles
+SET display_name = $2,
+    region = $3,
+    tier = $4,
+    retention_days = $5,
+    owner_email = $6,
+    updated_at = now()
+WHERE id = $1
+  AND deleted_at IS NULL
+RETURNING id, tenant_id, display_name, region, tier, retention_days, owner_email, created_at, updated_at, deleted_at;

--- name: ListTenantRecords :many
-SELECT id, tenant_id, display_name, created_at, updated_at FROM tenant_records
-WHERE tenant_id = $1
-ORDER BY created_at DESC;
+-- name: ListTenantProfiles :many
+SELECT id, tenant_id, display_name, region, tier, retention_days, owner_email, created_at, updated_at, deleted_at FROM tenant_profiles
+WHERE tenant_id = $1
+  AND deleted_at IS NULL
+  AND ($2::text = '' OR region = $2)
+ORDER BY created_at DESC
+LIMIT $3 OFFSET $4;
+
+-- name: DeleteTenantProfile :exec
+UPDATE tenant_profiles SET deleted_at = now() WHERE id = $1;
`,
      },
    ],
  }),

  renameFile('f15', 'internal/audit/tenant_events.go', 'go', [
    {
      oldStart: 24,
      newStart: 24,
      header: 'func (r *Recorder) RecordProfileChange(ctx context.Context, id string, at time.Time) {',
      symbols: ['Recorder.RecordProfileChange'],
      body: `
-func (r *Recorder) RecordRecordChange(ctx context.Context, id string, at time.Time) {
+func (r *Recorder) RecordProfileChange(ctx context.Context, id string, at time.Time) {
 \tr.queue <- event{
-\t\tKind: "tenant_record.updated",
+\t\tKind: "tenant_profile.updated",
 \t\tID:   id,
 \t\tAt:   at,
 \t}
`,
    },
    {
      oldStart: 58,
      newStart: 58,
      header: 'func (r *Recorder) flush(ctx context.Context) error {',
      symbols: ['Recorder.flush'],
      body: `
 func (r *Recorder) flush(ctx context.Context) error {
-\tconst stmt = \`INSERT INTO audit_events (kind, tenant_record_id, at) VALUES ($1, $2, $3)\`
+\tconst stmt = \`INSERT INTO audit_events (kind, tenant_profile_id, at) VALUES ($1, $2, $3)\`
 \tfor _, e := range r.buffered {
 \t\tif _, err := r.db.ExecContext(ctx, stmt, e.Kind, e.ID, e.At); err != nil {
 \t\t\treturn err
 \t\t}
`,
    },
  ]),

  buildFile({
    id: 'f16',
    path: 'internal/mocks/tenant_store_mock.go',
    language: 'go',
    generated: '**/mocks/*_mock.go',
    signals: signals({ fanIn: null, fanOut: null, testFile: false, complexityBefore: null, complexityAfter: null }),
    hunks: [
      {
        oldStart: 22,
        newStart: 22,
        header: 'type MockTenantStoreMockRecorder struct {',
        symbols: [],
        kind: 'code',
        risk: lowRisk(0.02, [{ signal: 'generated', contribution: 0, detail: 'mockgen output' }]),
        body: mockHunk,
      },
    ],
  }),

  renameFile('f17', 'internal/store/query_builder.go', 'go', [
    {
      oldStart: 30,
      newStart: 30,
      header: 'func (b *builder) tenantProfiles() *builder {',
      symbols: ['builder.tenantProfiles'],
      body: `
-func (b *builder) tenantRecords() *builder {
-\tb.table = "tenant_records"
+func (b *builder) tenantProfiles() *builder {
+\tb.table = "tenant_profiles"
 \treturn b
 }
`,
    },
    {
      oldStart: 74,
      newStart: 74,
      header: 'func (b *builder) buildWhere() (string, []any) {',
      symbols: ['builder.buildWhere'],
      body: `
 func (b *builder) buildWhere() (string, []any) {
-\tif b.table == "tenant_records" && b.tenantID != "" {
+\tif b.table == "tenant_profiles" && b.tenantID != "" {
 \t\tb.clauses = append(b.clauses, "tenant_id = ?")
 \t\tb.args = append(b.args, b.tenantID)
 \t}
`,
    },
  ]),

  renameFile('f18', 'internal/store/tenant.go', 'go', [
    {
      oldStart: 16,
      newStart: 16,
      header: 'type TenantProfileStore struct {',
      symbols: ['TenantProfileStore'],
      body: `
-type TenantRecordStore struct {
+type TenantProfileStore struct {
 \tq  *gen.Queries
 \tdb *sql.DB
 }
`,
    },
    {
      oldStart: 38,
      newStart: 38,
      header: 'func (s *TenantProfileStore) UpdateTenantProfile(ctx context.Context, arg gen.UpdateTenantProfileParams) (gen.TenantProfile, error) {',
      symbols: ['TenantProfileStore.UpdateTenantProfile'],
      body: `
-func (s *TenantRecordStore) UpdateTenantRecord(ctx context.Context, arg gen.UpdateTenantRecordParams) (gen.TenantRecord, error) {
-\treturn s.q.UpdateTenantRecord(ctx, arg)
+func (s *TenantProfileStore) UpdateTenantProfile(ctx context.Context, arg gen.UpdateTenantProfileParams) (gen.TenantProfile, error) {
+\treturn s.q.UpdateTenantProfile(ctx, arg)
 }
`,
    },
  ]),

  renameFile('f19', 'internal/store/tenant_cache.go', 'go', [
    {
      oldStart: 20,
      newStart: 20,
      header: 'type profileCache struct {',
      symbols: ['profileCache'],
      body: `
-type recordCache struct {
-\tentries map[string]gen.TenantRecord
+type profileCache struct {
+\tentries map[string]gen.TenantProfile
 \tmu      sync.RWMutex
 }
`,
    },
    {
      oldStart: 52,
      newStart: 52,
      header: 'func (c *profileCache) invalidate(id string) {',
      symbols: ['profileCache.invalidate'],
      body: `
-func (c *recordCache) invalidate(id string) {
+func (c *profileCache) invalidate(id string) {
 \tc.mu.Lock()
 \tdefer c.mu.Unlock()
 \tdelete(c.entries, id)
 }
`,
    },
  ]),

  buildFile({
    id: 'f20',
    path: 'internal/store/tenant_test.go',
    language: 'go',
    signals: signals({ testFile: true, fanIn: 0, fanOut: 6, complexityBefore: 4, complexityAfter: 8 }),
    hunks: [
      {
        oldStart: 30,
        newStart: 30,
        header: 'func TestUpdateTenantProfile(t *testing.T) {',
        symbols: ['TestUpdateTenantProfile', 'TestListTenantProfilesFiltersRegion'],
        kind: 'test',
        risk: lowRisk(0.11, [{ signal: 'testFile', contribution: 0, detail: 'test file' }]),
        body: `
 func TestUpdateTenantProfile(t *testing.T) {
 \tdb := testDB(t)
-\ts := NewTenantRecordStore(db)
+\ts := NewTenantProfileStore(db)

-\trow, err := s.UpdateTenantRecord(context.Background(), gen.UpdateTenantRecordParams{
-\t\tID:          seedRecord(t, db).ID,
-\t\tDisplayName: "acme",
+\trow, err := s.UpdateTenantProfile(context.Background(), gen.UpdateTenantProfileParams{
+\t\tID:            seedProfile(t, db).ID,
+\t\tDisplayName:   "acme",
+\t\tRegion:        "eu-west-1",
+\t\tTier:          "TENANT_TIER_STANDARD",
+\t\tRetentionDays: 90,
 \t})
 \tif err != nil {
 \t\tt.Fatalf("update: %v", err)
 \t}
 \tif row.DisplayName != "acme" {
 \t\tt.Fatalf("display_name = %q", row.DisplayName)
 \t}
+\tif row.Region != "eu-west-1" {
+\t\tt.Fatalf("region = %q", row.Region)
+\t}
+}
+
+func TestListTenantProfilesFiltersRegion(t *testing.T) {
+\tdb := testDB(t)
+\ts := NewTenantProfileStore(db)
+\ttenant := seedProfile(t, db)
+
+\trows, err := s.ListTenantProfiles(context.Background(), gen.ListTenantProfilesParams{
+\t\tTenantID: tenant.TenantID,
+\t\tRegion:   "eu-west-1",
+\t\tLimit:    10,
+\t\tOffset:   0,
+\t})
+\tif err != nil {
+\t\tt.Fatalf("list: %v", err)
+\t}
+\tif len(rows) != 0 {
+\t\tt.Fatalf("want no rows for an unused region, got %d", len(rows))
+\t}
+}
+
+func TestListTenantProfilesSkipsDeleted(t *testing.T) {
+\tdb := testDB(t)
+\ts := NewTenantProfileStore(db)
+\ttenant := seedProfile(t, db)
+\tsoftDelete(t, db, tenant.ID)
+
+\trows, err := s.ListTenantProfiles(context.Background(), gen.ListTenantProfilesParams{
+\t\tTenantID: tenant.TenantID,
+\t\tLimit:    10,
+\t})
+\tif err != nil {
+\t\tt.Fatalf("list: %v", err)
+\t}
+\tfor _, row := range rows {
+\t\tif row.ID == tenant.ID {
+\t\t\tt.Fatal("soft-deleted profile was listed")
+\t\t}
+\t}
 }
`,
      },
    ],
  }),
];

const groups: Group[] = [
  {
    id: 'g1',
    kind: 'generated',
    title: 'Generated code',
    description:
      'Protobuf, sqlc and mockgen output regenerated from the proto and query changes. Nothing here was hand-edited.',
    hunkIds: ['f2.h1', 'f2.h2', 'f2.h3', 'f2.h4', 'f2.h5', 'f4.h1', 'f4.h2', 'f12.h1', 'f12.h2', 'f12.h3', 'f16.h1'],
    mode: 'skim',
    collapsedByDefault: true,
    producedBy: 'stage1',
  },
  {
    id: 'g2',
    kind: 'mechanical-rename',
    title: 'Rename TenantRecord to TenantProfile',
    description:
      'The same identifier replaced across 9 files: type, constructor, cache and audit event name. No logic change.',
    hunkIds: [
      'f1.h1',
      'f1.h2',
      'f5.h1',
      'f5.h2',
      'f6.h1',
      'f6.h2',
      'f10.h1',
      'f10.h2',
      'f11.h1',
      'f11.h2',
      'f15.h1',
      'f15.h2',
      'f17.h1',
      'f17.h2',
      'f18.h1',
      'f18.h2',
      'f19.h1',
      'f19.h2',
    ],
    mode: 'skim',
    collapsedByDefault: true,
    producedBy: 'stage2',
  },
];

const path: PathStep[] = [
  {
    step: 1,
    ref: { kind: 'hunk', id: 'f3.h1' },
    phase: 'models',
    note: 'The new wire contract: TenantProfile with region, tier and retention, and four renamed RPCs.',
  },
  {
    step: 2,
    ref: { kind: 'hunk', id: 'f13.h1' },
    phase: 'models',
    note: 'Migration 0042. Read the NOT NULL column and the order of the backfill.',
  },
  {
    step: 3,
    ref: { kind: 'hunk', id: 'f14.h1' },
    phase: 'models',
    note: 'The sqlc queries behind the new columns and the soft-delete filter.',
  },
  {
    step: 4,
    ref: { kind: 'hunk', id: 'f7.h1' },
    phase: 'core',
    note: 'Imports only: grpc status codes and the store package arrive here.',
  },
  {
    step: 5,
    ref: { kind: 'hunk', id: 'f7.h2' },
    phase: 'core',
    note: 'UpdateRecord now validates the id and returns a gRPC status instead of a sentinel error.',
  },
  {
    step: 6,
    ref: { kind: 'hunk', id: 'f9.h1' },
    phase: 'core',
    note: 'Validation is now driven by the update mask. Check what an empty mask does.',
  },
  {
    step: 7,
    ref: { kind: 'hunk', id: 'f7.h3' },
    phase: 'core',
    note: 'GetRecord hides soft-deleted rows and shares the new error mapping.',
  },
  {
    step: 8,
    ref: { kind: 'hunk', id: 'f9.h2' },
    phase: 'core',
    note: null,
  },
  {
    step: 9,
    ref: { kind: 'group', id: 'g2' },
    phase: 'callsites',
    note: 'Mechanical rename, 9 files. Skim for anything that is not the identifier.',
  },
  {
    step: 10,
    ref: { kind: 'hunk', id: 'f8.h1' },
    phase: 'tests',
    note: 'The sentinel-error test becomes a table of InvalidArgument cases.',
  },
  {
    step: 11,
    ref: { kind: 'hunk', id: 'f8.h2' },
    phase: 'tests',
    note: 'New tests for If-Match and for the soft-delete path.',
  },
  {
    step: 12,
    ref: { kind: 'hunk', id: 'f20.h1' },
    phase: 'tests',
    note: 'Store tests cover the region filter and the deleted-row filter.',
  },
];

const comments: Comment[] = [
  {
    id: 'c17',
    source: { kind: 'bot', name: 'Cursor Bugbot' },
    author: 'cursor[bot]',
    path: 'api/service/tenant/record.go',
    line: 93,
    side: 'RIGHT',
    hunkId: 'f7.h2',
    body: '**status.Error drops the sentinel.** Callers in `api/http` and `cmd/worker` compare against `ErrMissingProfile` with `errors.Is`. After this change the comparison always fails and both call sites fall through to their 500 branch.\n\nConsider wrapping the sentinel: `status.Error(codes.InvalidArgument, ...)` loses it, `fmt.Errorf("%w: %v", ErrMissingProfile, err)` keeps it.',
    url: 'https://github.com/northwind-labs/tenant-platform/pull/1234#discussion_r1990001',
    createdAt: '2026-09-08T10:00:00Z',
    resolved: false,
    severity: 'medium',
  },
  {
    id: 'c18',
    source: { kind: 'human', name: 'GitHub' },
    author: 'danat',
    path: 'api/service/tenant/record.go',
    line: 101,
    side: 'RIGHT',
    hunkId: 'f7.h2',
    body: 'The If-Match read happens outside the transaction that writes, so two concurrent updates can both pass the etag check. Do we need `SELECT ... FOR UPDATE` here, or is last-write-wins acceptable for profiles?',
    url: 'https://github.com/northwind-labs/tenant-platform/pull/1234#discussion_r1990002',
    createdAt: '2026-09-08T10:22:00Z',
    resolved: false,
    severity: null,
  },
  {
    id: 'c19',
    source: { kind: 'human', name: 'GitHub' },
    author: 'jdoe',
    path: 'db/migrations/0042_tenant_profile_region.sql',
    line: 3,
    side: 'RIGHT',
    hunkId: 'f13.h1',
    body: 'Needs a default or a two-step migration. The staging table has 41k rows, so `ADD COLUMN region text NOT NULL` fails before the backfill on line 13 ever runs.',
    url: 'https://github.com/northwind-labs/tenant-platform/pull/1234#discussion_r1990003',
    createdAt: '2026-09-08T10:31:00Z',
    resolved: false,
    severity: null,
  },
  {
    id: 'c20',
    source: { kind: 'bot', name: 'Cursor Bugbot' },
    author: 'cursor[bot]',
    path: 'api/service/tenant/validate.go',
    line: 22,
    side: 'RIGHT',
    hunkId: 'f9.h1',
    body: 'An empty `update_mask` validates every path, which turns a partial update into a full one. Was that intended?',
    url: 'https://github.com/northwind-labs/tenant-platform/pull/1234#discussion_r1990004',
    createdAt: '2026-09-07T16:10:00Z',
    resolved: true,
    severity: 'low',
  },
  {
    id: 'c21',
    source: { kind: 'bot', name: 'Cursor Bugbot' },
    author: 'cursor[bot]',
    path: 'api/service/tenant/list.go',
    line: 62,
    side: 'RIGHT',
    hunkId: null,
    body: '`listParams` does not clamp the page size, so a client can ask for the whole table in one call.',
    url: 'https://github.com/northwind-labs/tenant-platform/pull/1234#discussion_r1989004',
    createdAt: '2026-09-06T09:12:00Z',
    resolved: false,
    severity: 'low',
  },
];

const checks: Check[] = [
  {
    name: 'lint-and-test',
    app: 'github-actions',
    status: 'success',
    url: 'https://github.com/northwind-labs/tenant-platform/pull/1234/checks?check_run_id=41001',
    completedAt: '2026-09-08T11:02:00Z',
  },
  {
    name: 'Wiz',
    app: 'wiz-io',
    status: 'success',
    url: 'https://github.com/northwind-labs/tenant-platform/pull/1234/checks?check_run_id=41002',
    completedAt: '2026-09-08T11:04:00Z',
  },
  {
    name: 'Socket',
    app: 'socket-security',
    status: 'success',
    url: 'https://github.com/northwind-labs/tenant-platform/pull/1234/checks?check_run_id=41003',
    completedAt: '2026-09-08T11:05:00Z',
  },
  {
    name: 'Analyze',
    app: 'github-code-scanning',
    status: 'failure',
    url: 'https://github.com/northwind-labs/tenant-platform/pull/1234/checks?check_run_id=41004',
    completedAt: '2026-09-08T11:09:00Z',
  },
  {
    name: 'app-client',
    app: 'buildkite',
    status: 'pending',
    url: 'https://buildkite.com/northwind/app-client/builds/8821',
    completedAt: null,
  },
];

interface NodeSpec {
  id: string;
  label: string;
  file: string | null;
  changed: boolean;
  hunkIds?: string[];
  kind?: 'function' | 'file' | 'package';
}

const nodeSpecs: NodeSpec[] = [
  { id: 'n1', label: 'Service.UpdateRecord', file: 'api/service/tenant/record.go', changed: true, hunkIds: ['f7.h2', 'f7.h1'] },
  { id: 'n2', label: 'Service.GetRecord', file: 'api/service/tenant/record.go', changed: true, hunkIds: ['f7.h3'] },
  { id: 'n3', label: 'toStatus', file: 'api/service/tenant/record.go', changed: true, hunkIds: ['f7.h3'] },
  { id: 'n4', label: 'Service.validate', file: 'api/service/tenant/validate.go', changed: true, hunkIds: ['f9.h1'] },
  { id: 'n5', label: 'validateRegion', file: 'api/service/tenant/validate.go', changed: false },
  { id: 'n6', label: 'normalizeName', file: 'api/service/tenant/validate.go', changed: true, hunkIds: ['f9.h2'] },
  { id: 'n7', label: 'Service.ListRecords', file: 'api/service/tenant/list.go', changed: true, hunkIds: ['f6.h1', 'f6.h2'] },
  { id: 'n8', label: 'toProto', file: 'api/service/tenant/convert.go', changed: true, hunkIds: ['f5.h1'] },
  { id: 'n9', label: 'fromProto', file: 'api/service/tenant/convert.go', changed: true, hunkIds: ['f5.h2'] },
  { id: 'n10', label: 'etag', file: 'api/service/tenant/record.go', changed: false },

  { id: 'n11', label: 'Handler.PatchTenant', file: 'api/http/tenant.go', changed: true, hunkIds: ['f1.h1', 'f1.h2'] },
  { id: 'n12', label: 'Handler.GetTenant', file: 'api/http/tenant.go', changed: false },
  { id: 'n13', label: 'Handler.ListTenants', file: 'api/http/tenant.go', changed: false },
  { id: 'n14', label: 'writeError', file: 'api/http/errors.go', changed: false },

  { id: 'n15', label: 'TenantProfileStore.UpdateTenantProfile', file: 'internal/store/tenant.go', changed: true, hunkIds: ['f18.h2'] },
  { id: 'n16', label: 'TenantProfileStore.GetTenantProfile', file: 'internal/store/tenant.go', changed: false },
  { id: 'n17', label: 'TenantProfileStore.ListTenantProfiles', file: 'internal/store/tenant.go', changed: false },
  { id: 'n18', label: 'builder.buildWhere', file: 'internal/store/query_builder.go', changed: true, hunkIds: ['f17.h2'] },
  { id: 'n19', label: 'builder.tenantProfiles', file: 'internal/store/query_builder.go', changed: true, hunkIds: ['f17.h1'] },
  { id: 'n20', label: 'profileCache.invalidate', file: 'internal/store/tenant_cache.go', changed: true, hunkIds: ['f19.h2'] },

  { id: 'n21', label: 'Queries.UpdateTenantProfile', file: 'db/gen/tenant.sql.go', changed: true, hunkIds: ['f12.h1'] },
  { id: 'n22', label: 'Queries.ListTenantProfiles', file: 'db/gen/tenant.sql.go', changed: true, hunkIds: ['f12.h2'] },
  { id: 'n23', label: 'Queries.GetTenantProfile', file: 'db/gen/tenant.sql.go', changed: false },

  { id: 'n24', label: 'syncTenants', file: 'cmd/worker/sync.go', changed: true, hunkIds: ['f11.h1', 'f11.h2'] },
  { id: 'n25', label: 'reconcile', file: 'cmd/worker/reconcile.go', changed: false },

  { id: 'n26', label: 'main', file: 'cmd/api/main.go', changed: true, hunkIds: ['f10.h1'] },
  { id: 'n27', label: 'registerServices', file: 'cmd/api/register.go', changed: false },

  { id: 'n28', label: 'Recorder.RecordProfileChange', file: 'internal/audit/tenant_events.go', changed: true, hunkIds: ['f15.h1'] },
  { id: 'n29', label: 'Recorder.flush', file: 'internal/audit/tenant_events.go', changed: true, hunkIds: ['f15.h2'] },

  { id: 'n30', label: 'Server.UpdateTenantProfile', file: 'api/grpc/server.go', changed: false },
  { id: 'n31', label: 'Metrics.Observe', file: 'internal/telemetry/metrics.go', changed: false },

  { id: 'n32', kind: 'package', label: 'google.golang.org/grpc/status', file: null, changed: false },
  { id: 'n33', kind: 'package', label: 'api/proto/tenant/v1', file: null, changed: true, hunkIds: ['f2.h1', 'f4.h1'] },
  { id: 'n34', kind: 'package', label: 'internal/mocks', file: null, changed: true, hunkIds: ['f16.h1'] },
];

const graph: Graph = {
  nodes: nodeSpecs.map((n) => ({
    id: n.id,
    kind: n.kind ?? 'function',
    label: n.label,
    file: n.file,
    changed: n.changed,
    hunkIds: n.hunkIds ?? [],
  })),
  edges: [
    { from: 'n11', to: 'n1', kind: 'calls' },
    { from: 'n11', to: 'n14', kind: 'calls' },
    { from: 'n12', to: 'n2', kind: 'calls' },
    { from: 'n13', to: 'n7', kind: 'calls' },
    { from: 'n30', to: 'n1', kind: 'calls' },
    { from: 'n30', to: 'n2', kind: 'calls' },
    { from: 'n24', to: 'n7', kind: 'calls' },
    { from: 'n25', to: 'n7', kind: 'calls' },
    { from: 'n26', to: 'n15', kind: 'calls' },
    { from: 'n27', to: 'n30', kind: 'calls' },
    { from: 'n1', to: 'n4', kind: 'calls' },
    { from: 'n1', to: 'n3', kind: 'calls' },
    { from: 'n1', to: 'n10', kind: 'calls' },
    { from: 'n1', to: 'n15', kind: 'calls' },
    { from: 'n1', to: 'n8', kind: 'calls' },
    { from: 'n1', to: 'n28', kind: 'calls' },
    { from: 'n1', to: 'n16', kind: 'calls' },
    { from: 'n2', to: 'n3', kind: 'calls' },
    { from: 'n2', to: 'n16', kind: 'calls' },
    { from: 'n2', to: 'n8', kind: 'calls' },
    { from: 'n4', to: 'n5', kind: 'calls' },
    { from: 'n4', to: 'n6', kind: 'calls' },
    { from: 'n7', to: 'n17', kind: 'calls' },
    { from: 'n7', to: 'n8', kind: 'calls' },
    { from: 'n9', to: 'n6', kind: 'calls' },
    { from: 'n15', to: 'n21', kind: 'calls' },
    { from: 'n15', to: 'n20', kind: 'calls' },
    { from: 'n16', to: 'n23', kind: 'calls' },
    { from: 'n17', to: 'n22', kind: 'calls' },
    { from: 'n17', to: 'n18', kind: 'calls' },
    { from: 'n19', to: 'n18', kind: 'calls' },
    { from: 'n28', to: 'n29', kind: 'calls' },
    { from: 'n29', to: 'n31', kind: 'calls' },
    { from: 'n3', to: 'n32', kind: 'imports' },
    { from: 'n1', to: 'n33', kind: 'imports' },
    { from: 'n8', to: 'n33', kind: 'imports' },
    { from: 'n11', to: 'n33', kind: 'imports' },
    { from: 'n24', to: 'n33', kind: 'imports' },
    { from: 'n34', to: 'n21', kind: 'imports' },
  ],
  truncated: false,
};

const allHunks = files.flatMap((f) => f.hunks);
const groupedHunkIds = new Set(groups.flatMap((g) => g.hunkIds));

const summary: Summary = {
  oneLiner:
    'Adds region, tier and retention to the tenant profile API with field-mask validation, and renames TenantRecord to TenantProfile across the service.',
  reviewFocus: [
    'UpdateRecord changes error semantics from sentinel errors to gRPC statuses; check every caller that compared against ErrMissingID or ErrMissingProfile.',
    'Migration 0042 adds region as NOT NULL with no default and backfills afterwards, which fails on a table that already has rows.',
    'validate now walks the update mask, so a request with an empty mask validates every field instead of the ones it sent.',
  ],
  counts: {
    hunks: allHunks.length,
    highRisk: allHunks.filter((h) => h.risk.level === 'high').length,
    skimmable: allHunks.filter((h) => h.risk.mode === 'skim').length,
  },
};

const ready = (updatedAt: string) => ({ state: 'ready' as const, updatedAt });
const pending = (updatedAt: string) => ({ state: 'pending' as const, updatedAt });

const stage1At = '2026-09-08T12:34:56Z';
const stage2At = '2026-09-08T12:36:10Z';
const stage3At = '2026-09-08T12:37:44Z';

const base: ReviewDocument = {
  schemaVersion: '1.0.0',
  generatedAt: GENERATED_AT,
  tool: { name: 'review-cockpit', version: '0.1.0' },
  pr: {
    owner: 'northwind-labs',
    repo: 'tenant-platform',
    number: 1234,
    url: 'https://github.com/northwind-labs/tenant-platform/pull/1234',
    title: 'Add tenant profile API',
    body: [
      '### What',
      '',
      'Replaces the thin `TenantRecord` message with `TenantProfile`: region, tier, retention and',
      'soft delete, plus field-mask driven validation on update.',
      '',
      '### Why',
      '',
      'TP-329. The console needs per-region profiles, and the worker needs to page through them.',
      '',
      '### Notes',
      '',
      '- Migration 0042 adds the new columns. Run it before deploying the API.',
      '- The rename is mechanical; the generated code is a straight regeneration from buf and sqlc.',
    ].join('\n'),
    author: 'jdoe',
    draft: false,
    labels: ['backend', 'needs-migration'],
    base: { ref: 'main', sha: BASE_SHA },
    head: { ref: 'TP-329-tenant-profile-api', sha: HEAD_SHA },
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
    changedFiles: files.length,
  },
  checkout: {
    mode: 'worktree',
    path: '/Users/me/.cache/review-cockpit/northwind-labs/tenant-platform/pr-1234/worktree',
    sourceRepo: '/Users/me/workspace/tenant-platform',
  },
  status: {
    files: ready(stage1At),
    comments: ready(stage1At),
    checks: ready(stage1At),
    groups: ready(stage2At),
    path: ready(stage2At),
    summary: ready(stage2At),
    graph: ready(stage3At),
  },
  files,
  comments,
  checks,
  groups,
  path,
  summary,
  graph,
};

const stage1: ReviewDocument = {
  ...base,
  status: {
    files: ready(stage1At),
    comments: ready(stage1At),
    checks: ready(stage1At),
    groups: pending(stage1At),
    path: pending(stage1At),
    summary: pending(stage1At),
    graph: pending(stage1At),
  },
  groups: [],
  path: [],
  summary: {},
  graph: { nodes: [], edges: [], truncated: false },
};

const graphFail: ReviewDocument = {
  ...base,
  status: {
    ...base.status,
    graph: {
      state: 'failed',
      updatedAt: stage3At,
      message: 'tree-sitter timed out after 120s while indexing 14 Go modules',
    },
  },
  graph: { nodes: [], edges: [], truncated: false },
};

const stage2Fail: ReviewDocument = {
  ...base,
  status: {
    files: ready(stage1At),
    comments: ready(stage1At),
    checks: ready(stage1At),
    groups: { state: 'failed', updatedAt: stage2At, message: 'judgment file failed validation twice' },
    path: { state: 'failed', updatedAt: stage2At, message: 'judgment file failed validation twice' },
    summary: { state: 'failed', updatedAt: stage2At, message: 'judgment file failed validation twice' },
    graph: ready(stage3At),
  },
  groups: groups.filter((g) => g.producedBy === 'stage1'),
  path: [],
  summary: {},
};

const emptyPr: ReviewDocument = {
  schemaVersion: '1.0.0',
  generatedAt: GENERATED_AT,
  tool: { name: 'review-cockpit', version: '0.1.0' },
  pr: {
    owner: 'northwind-labs',
    repo: 'tenant-platform',
    number: 1240,
    url: 'https://github.com/northwind-labs/tenant-platform/pull/1240',
    title: 'Merge main into release-2026-09',
    body: 'Merge commit only. No textual changes.',
    author: 'jdoe',
    draft: false,
    labels: [],
    base: { ref: 'release-2026-09', sha: BASE_SHA },
    head: { ref: 'main', sha: HEAD_SHA },
    additions: 0,
    deletions: 0,
    changedFiles: 0,
  },
  checkout: {
    mode: 'worktree',
    path: '/Users/me/.cache/review-cockpit/northwind-labs/tenant-platform/pr-1240/worktree',
    sourceRepo: '/Users/me/workspace/tenant-platform',
  },
  status: {
    files: ready(stage1At),
    comments: ready(stage1At),
    checks: ready(stage1At),
    groups: ready(stage2At),
    path: ready(stage2At),
    summary: ready(stage2At),
    graph: ready(stage3At),
  },
  files: [],
  comments: [],
  checks: [
    {
      name: 'lint-and-test',
      app: 'github-actions',
      status: 'success',
      url: 'https://github.com/northwind-labs/tenant-platform/pull/1240/checks?check_run_id=41100',
      completedAt: '2026-09-08T11:02:00Z',
    },
  ],
  groups: [],
  path: [],
  summary: {
    oneLiner: 'Merge of main into the release branch. No file content changed.',
    reviewFocus: [],
    counts: { hunks: 0, highRisk: 0, skimmable: 0 },
  },
  graph: { nodes: [], edges: [], truncated: false },
};

function write(name: string, doc: ReviewDocument): void {
  const file = resolve(here, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  const lines = doc.files.flatMap((f) => f.hunks).flatMap((h) => h.lines).length;
  console.log(`${name}.json  ${doc.files.length} files  ${lines} diff lines`);
}

write('pr-fake-1', base);
write('pr-fake-1.stage1', stage1);
write('pr-fake-1.graphfail', graphFail);
write('pr-fake-1.stage2fail', stage2Fail);
write('pr-fake-empty', emptyPr);

const ungrouped = allHunks.filter((h) => !groupedHunkIds.has(h.id));
console.log(
  `hunks ${allHunks.length}  ungrouped ${ungrouped.length}  high ${summary.counts.highRisk}  path steps ${path.length}  nodes ${graph.nodes.length}`,
);
