import { describe, expect, it } from 'vitest';
import { parseDiff } from '../src/diff.js';

const modified = `diff --git a/pkg/tenant/record.go b/pkg/tenant/record.go
index 1111111..2222222 100644
--- a/pkg/tenant/record.go
+++ b/pkg/tenant/record.go
@@ -12,5 +12,7 @@ func (s *Service) Update(id string) error {
 	if id == "" {
-		return ErrMissingID
+		return fmt.Errorf("id is required")
+	}
+	if s == nil {
 		return nil
 	}
 	return s.store.Save(id)
`;

describe('parseDiff on a modified file', () => {
  const files = parseDiff(modified);

  it('reads one file with one hunk', () => {
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe('pkg/tenant/record.go');
    expect(files[0]?.status).toBe('modified');
    expect(files[0]?.previousPath).toBeNull();
    expect(files[0]?.binary).toBe(false);
    expect(files[0]?.hunks).toHaveLength(1);
  });

  it('keeps the hunk header git wrote', () => {
    expect(files[0]?.hunks[0]?.header).toBe('func (s *Service) Update(id string) error {');
    expect(files[0]?.hunks[0]?.oldStart).toBe(12);
    expect(files[0]?.hunks[0]?.oldLines).toBe(5);
    expect(files[0]?.hunks[0]?.newStart).toBe(12);
    expect(files[0]?.hunks[0]?.newLines).toBe(7);
  });

  it('numbers each side and leaves the other side null', () => {
    const lines = files[0]?.hunks[0]?.lines ?? [];
    expect(lines).toEqual([
      { type: 'context', oldNo: 12, newNo: 12, text: '\tif id == "" {' },
      { type: 'del', oldNo: 13, newNo: null, text: '\t\treturn ErrMissingID' },
      { type: 'add', oldNo: null, newNo: 13, text: '\t\treturn fmt.Errorf("id is required")' },
      { type: 'add', oldNo: null, newNo: 14, text: '\t}' },
      { type: 'add', oldNo: null, newNo: 15, text: '\tif s == nil {' },
      { type: 'context', oldNo: 14, newNo: 16, text: '\t\treturn nil' },
      { type: 'context', oldNo: 15, newNo: 17, text: '\t}' },
      { type: 'context', oldNo: 16, newNo: 18, text: '\treturn s.store.Save(id)' },
    ]);
  });

  it('counts additions and deletions from the lines', () => {
    expect(files[0]?.additions).toBe(3);
    expect(files[0]?.deletions).toBe(1);
  });

  it('agrees with the line counts in the hunk header', () => {
    const hunk = files[0]?.hunks[0];
    const lines = hunk?.lines ?? [];
    const context = lines.filter((line) => line.type === 'context').length;
    expect(hunk?.oldLines).toBe(context + lines.filter((line) => line.type === 'del').length);
    expect(hunk?.newLines).toBe(context + lines.filter((line) => line.type === 'add').length);
  });
});

describe('parseDiff on the other file statuses', () => {
  it('reads an added file', () => {
    const files = parseDiff(`diff --git a/pkg/tenant/new.go b/pkg/tenant/new.go
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/pkg/tenant/new.go
@@ -0,0 +1,2 @@
+package tenant
+
`);
    expect(files[0]?.status).toBe('added');
    expect(files[0]?.path).toBe('pkg/tenant/new.go');
    expect(files[0]?.hunks[0]?.oldStart).toBe(0);
    expect(files[0]?.hunks[0]?.oldLines).toBe(0);
    expect(files[0]?.additions).toBe(2);
  });

  it('reads a deleted file under its base path', () => {
    const files = parseDiff(`diff --git a/pkg/tenant/old.go b/pkg/tenant/old.go
deleted file mode 100644
index 3333333..0000000
--- a/pkg/tenant/old.go
+++ /dev/null
@@ -1,2 +0,0 @@
-package tenant
-
`);
    expect(files[0]?.status).toBe('deleted');
    expect(files[0]?.path).toBe('pkg/tenant/old.go');
    expect(files[0]?.deletions).toBe(2);
  });

  it('reads a rename and keeps the previous path', () => {
    const files = parseDiff(`diff --git a/pkg/tenant/record.go b/pkg/tenant/profile.go
similarity index 94%
rename from pkg/tenant/record.go
rename to pkg/tenant/profile.go
index 1111111..2222222 100644
--- a/pkg/tenant/record.go
+++ b/pkg/tenant/profile.go
@@ -1,3 +1,3 @@
 package tenant
-type Record struct{}
+type Profile struct{}
`);
    expect(files[0]?.status).toBe('renamed');
    expect(files[0]?.path).toBe('pkg/tenant/profile.go');
    expect(files[0]?.previousPath).toBe('pkg/tenant/record.go');
  });

  it('reads a pure rename with no hunks', () => {
    const files = parseDiff(`diff --git a/a.go b/b.go
similarity index 100%
rename from a.go
rename to b.go
`);
    expect(files[0]?.status).toBe('renamed');
    expect(files[0]?.hunks).toEqual([]);
    expect(files[0]?.additions).toBe(0);
  });

  it('marks a binary file and gives it no hunks', () => {
    const files = parseDiff(`diff --git a/logo.png b/logo.png
index 4444444..5555555 100644
Binary files a/logo.png and b/logo.png differ
`);
    expect(files[0]?.binary).toBe(true);
    expect(files[0]?.hunks).toEqual([]);
  });

  it('reads several files in one diff, in the order git printed them', () => {
    const files = parseDiff(`${modified}diff --git a/README.md b/README.md
index 6666666..7777777 100644
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-# old
+# new
`);
    expect(files.map((file) => file.path)).toEqual(['pkg/tenant/record.go', 'README.md']);
    expect(files[1]?.hunks[0]?.oldLines).toBe(1);
    expect(files[1]?.hunks[0]?.newLines).toBe(1);
  });
});

describe('parseDiff edge cases', () => {
  it('drops the no-newline marker without counting it as a line', () => {
    const files = parseDiff(`diff --git a/a.txt b/a.txt
index 1..2 100644
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-one
\\ No newline at end of file
+two
\\ No newline at end of file
`);
    expect(files[0]?.hunks[0]?.lines.map((line) => line.text)).toEqual(['one', 'two']);
  });

  it('keeps a blank context line', () => {
    const files = parseDiff(`diff --git a/a.txt b/a.txt
index 1..2 100644
--- a/a.txt
+++ b/a.txt
@@ -1,3 +1,3 @@
 one

-two
+three
`);
    const lines = files[0]?.hunks[0]?.lines ?? [];
    expect(lines[1]).toEqual({ type: 'context', oldNo: 2, newNo: 2, text: '' });
    expect(lines).toHaveLength(4);
  });

  it('does not read diff-looking content inside a hunk as a new file', () => {
    const files = parseDiff(`diff --git a/fixture.txt b/fixture.txt
index 1..2 100644
--- a/fixture.txt
+++ b/fixture.txt
@@ -1,2 +1,2 @@
-+++ b/other
++++ b/another
 tail
`);
    expect(files).toHaveLength(1);
    expect(files[0]?.hunks[0]?.lines).toHaveLength(3);
  });

  it('unquotes a path git had to quote', () => {
    const files = parseDiff(`diff --git "a/pkg/caf\\303\\251.go" "b/pkg/caf\\303\\251.go"
index 1..2 100644
--- "a/pkg/caf\\303\\251.go"
+++ "b/pkg/caf\\303\\251.go"
@@ -1 +1 @@
-a
+b
`);
    expect(files[0]?.path).toBe('pkg/café.go');
  });

  it('reads several hunks in one file and numbers them from their headers', () => {
    const files = parseDiff(`diff --git a/a.go b/a.go
index 1..2 100644
--- a/a.go
+++ b/a.go
@@ -1,2 +1,2 @@
-one
+two
 tail
@@ -40,2 +40,3 @@ func B() {
 head
+added
 tail2
`);
    expect(files[0]?.hunks).toHaveLength(2);
    expect(files[0]?.hunks[1]?.newStart).toBe(40);
    expect(files[0]?.hunks[1]?.header).toBe('func B() {');
  });

  it('reads an empty diff as no files', () => {
    expect(parseDiff('')).toEqual([]);
  });
});
