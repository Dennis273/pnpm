import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'

import gfs from '@pnpm/fs.graceful-fs'
import { globalWarn } from '@pnpm/logger'
import { pathTemp } from 'path-temp'
import { renameOverwriteSync } from 'rename-overwrite'

export function hardLinkDir (src: string, destDirs: string[]): void {
  if (destDirs.length === 0) return
  const filteredDestDirs: string[] = []
  const tempDestDirs: string[] = []
  for (const destDir of destDirs) {
    if (path.relative(destDir, src) === '') {
      // Don't try to hard link the source directory to itself
      continue
    }
    filteredDestDirs.push(destDir)
    tempDestDirs.push(pathTemp(path.dirname(destDir)))
  }
  _hardLinkDir(src, tempDestDirs, true)
  for (let i = 0; i < filteredDestDirs.length; i++) {
    commitDir(src, tempDestDirs[i], filteredDestDirs[i])
  }
}

/**
 * Move a staged directory onto its final hoisted location.
 *
 * Backfills of different built packages run concurrently (see the build
 * `finally` in `@pnpm/building.during-install`) and stage their temp directories
 * under shared parents. While we commit, another worker can move a common
 * ancestor directory aside — `rename-overwrite` swaps the existing target out
 * of the way before renaming into it — carrying our staged `tempDestDir`, and
 * possibly `destDir` itself, with it. The rename then fails with ENOENT (the
 * staged source vanished) or EEXIST/ENOTEMPTY/ENOTDIR (the destination is being
 * contended). All concurrent writers of one built package copy byte-identical
 * content, so losing this race is safe: re-link the still-intact `src` straight
 * into `destDir`. This mirrors the ENOENT/EXDEV fallbacks already guarding every
 * file-level operation in this module, keeping the commit loop from leaking an
 * uncaught ERR_PNPM_ENOENT.
 */
function commitDir (src: string, tempDestDir: string, destDir: string): void {
  try {
    renameOverwriteSync(tempDestDir, destDir)
  } catch (err: unknown) {
    if (
      !util.types.isNativeError(err) || !('code' in err) ||
      (err.code !== 'ENOENT' && err.code !== 'EEXIST' && err.code !== 'ENOTEMPTY' && err.code !== 'ENOTDIR')
    ) {
      throw err
    }
    fs.rmSync(tempDestDir, { recursive: true, force: true })
    gfs.mkdirSync(destDir, { recursive: true })
    _hardLinkDir(src, [destDir], true)
  }
}

function _hardLinkDir (src: string, destDirs: string[], isRoot?: boolean) {
  let files: string[] = []
  try {
    files = fs.readdirSync(src)
  } catch (err: unknown) {
    if (!isRoot || !((util.types.isNativeError(err) && 'code' in err && err.code === 'ENOENT'))) throw err
    globalWarn(`Source directory not found when creating hardLinks for: ${src}. Creating destinations as empty: ${destDirs.join(', ')}`)
    for (const dir of destDirs) {
      gfs.mkdirSync(dir, { recursive: true })
    }
    return
  }
  for (const file of files) {
    if (file === 'node_modules') continue
    const srcFile = path.join(src, file)
    if (fs.lstatSync(srcFile).isDirectory()) {
      const destSubdirs = destDirs.map((destDir) => {
        const destSubdir = path.join(destDir, file)
        try {
          gfs.mkdirSync(destSubdir, { recursive: true })
        } catch (err: unknown) {
          if (!(util.types.isNativeError(err) && 'code' in err && err.code === 'EEXIST')) throw err
        }
        return destSubdir
      })
      _hardLinkDir(srcFile, destSubdirs)
      continue
    }
    for (const destDir of destDirs) {
      const destFile = path.join(destDir, file)
      try {
        linkOrCopyFile(srcFile, destFile)
      } catch (err: unknown) {
        if (util.types.isNativeError(err) && 'code' in err && err.code === 'ENOENT') {
          // Ignore broken symlinks
          continue
        }
        throw err
      }
    }
  }
}

function linkOrCopyFile (srcFile: string, destFile: string): void {
  try {
    linkOrCopy(srcFile, destFile)
  } catch (err: unknown) {
    assert(util.types.isNativeError(err))
    if ('code' in err && err.code === 'ENOENT') {
      gfs.mkdirSync(path.dirname(destFile), { recursive: true })
      linkOrCopy(srcFile, destFile)
      return
    }
    if (!('code' in err && err.code === 'EEXIST')) {
      throw err
    }
  }
}

/*
 * This function could be optimized because we don't really need to try linking again
 * if linking failed once.
 */
function linkOrCopy (srcFile: string, destFile: string): void {
  try {
    gfs.linkSync(srcFile, destFile)
  } catch (err: unknown) {
    // In some container environments (OverlayFS), linkSync throws ENOENT
    // instead of EXDEV when linking across layers. We must fallback to copy in this case too.
    if (util.types.isNativeError(err) && 'code' in err && (err.code === 'EXDEV' || err.code === 'ENOENT')) {
      gfs.copyFileSync(srcFile, destFile)
    } else {
      throw err
    }
  }
}
