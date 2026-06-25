import fs from 'node:fs'
import path from 'node:path'

import { expect, jest, test } from '@jest/globals'
import { tempDir as createTempDir } from '@pnpm/prepare'

// Force the commit rename to fail the way a concurrent backfill makes it fail:
// the staged source is no longer where the rename expects it. The package must
// still reach its destination through the recovery path that re-links src
// directly (https://github.com/pnpm/pnpm/issues/10179).
jest.unstable_mockModule('rename-overwrite', () => ({
  renameOverwriteSync: jest.fn(() => {
    const err: NodeJS.ErrnoException = new Error('ENOENT: simulated concurrent ancestor move')
    err.code = 'ENOENT'
    throw err
  }),
}))

const { hardLinkDir } = await import('@pnpm/fs.hard-link-dir')

test('re-links src content into the destination when the commit rename fails', () => {
  const tempDir = createTempDir()
  const srcDir = path.join(tempDir, 'source')
  const destDir = path.join(tempDir, 'nested/dest')

  fs.mkdirSync(path.join(srcDir, 'subdir'), { recursive: true })
  fs.writeFileSync(path.join(srcDir, 'file.txt'), 'built output')
  fs.writeFileSync(path.join(srcDir, 'subdir/nested.txt'), 'nested built output')

  expect(() => hardLinkDir(srcDir, [destDir])).not.toThrow()

  expect(fs.readFileSync(path.join(destDir, 'file.txt'), 'utf8')).toBe('built output')
  expect(fs.readFileSync(path.join(destDir, 'subdir/nested.txt'), 'utf8')).toBe('nested built output')
})
