import fs from 'node:fs'
import path from 'node:path'

import { expect, test } from '@jest/globals'
import { hardLinkDir } from '@pnpm/fs.hard-link-dir'
import { tempDir as createTempDir } from '@pnpm/prepare'

test('hardLinkDirectory()', () => {
  const tempDir = createTempDir()
  const srcDir = path.join(tempDir, 'source')
  const dest1Dir = path.join(tempDir, 'dest1')
  const dest2Dir = path.join(tempDir, 'dest2')

  fs.mkdirSync(srcDir, { recursive: true })
  fs.mkdirSync(dest1Dir, { recursive: true })
  fs.mkdirSync(path.join(srcDir, 'node_modules'), { recursive: true })
  fs.mkdirSync(path.join(srcDir, 'subdir'), { recursive: true })

  fs.writeFileSync(path.join(srcDir, 'file.txt'), 'Hello World')
  fs.writeFileSync(path.join(srcDir, 'subdir/file.txt'), 'Hello World')
  fs.writeFileSync(path.join(srcDir, 'node_modules/file.txt'), 'Hello World')

  hardLinkDir(srcDir, [dest1Dir, dest2Dir])

  // It should link the files from the root
  expect(fs.readFileSync(path.join(dest1Dir, 'file.txt'), 'utf8')).toBe('Hello World')
  expect(fs.readFileSync(path.join(dest2Dir, 'file.txt'), 'utf8')).toBe('Hello World')

  // It should link files from a subdirectory
  expect(fs.readFileSync(path.join(dest1Dir, 'subdir/file.txt'), 'utf8')).toBe('Hello World')
  expect(fs.readFileSync(path.join(dest2Dir, 'subdir/file.txt'), 'utf8')).toBe('Hello World')

  // It should not link files from node_modules
  expect(fs.existsSync(path.join(dest1Dir, 'node_modules/file.txt'))).toBe(false)
  expect(fs.existsSync(path.join(dest2Dir, 'node_modules/file.txt'))).toBe(false)
})

test("don't fail on missing source and dest directories", () => {
  const tempDir = createTempDir()
  const missingDirSrc = path.join(tempDir, 'missing_source')
  const missingDirDest = path.join(tempDir, 'missing_dest')

  hardLinkDir(missingDirSrc, [missingDirDest])

  // It should create an empty dest dir if src does not exist
  expect(fs.existsSync(missingDirSrc)).toBe(false)
  expect(fs.existsSync(missingDirDest)).toBe(true)
})

// A concurrent backfill can move a shared ancestor (and our staged temp dir
// with it) aside between staging and the commit rename, so the rename sees no
// source to move. An empty source reproduces that state deterministically: it
// stages no temp directory, so the commit rename is asked to move a path that
// does not exist. The commit must recover instead of letting ERR_PNPM_ENOENT
// escape the unguarded loop (https://github.com/pnpm/pnpm/issues/10179).
test('commit recovers when the staged source is gone', () => {
  const tempDir = createTempDir()
  const srcDir = path.join(tempDir, 'source')
  const destDir = path.join(tempDir, 'nested/dest')

  // An existing source dir with nothing to link stages no temp directory.
  fs.mkdirSync(srcDir, { recursive: true })

  expect(() => hardLinkDir(srcDir, [destDir])).not.toThrow()
  expect(fs.existsSync(destDir)).toBe(true)
})
