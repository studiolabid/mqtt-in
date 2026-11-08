/**
 * `dialog.*` — pick a path, read a file, save content to a file. Saved files join the known
 * files (`app.showItemInFolder` may reveal them).
 */
import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { LIMITS } from '@shared/defaults'
import { IPC } from '@shared/ipc'
import type { OpenFileResult } from '@shared/models'
import { knownFiles } from '../services/known-files'
import { toOwnedBytes } from '../utils/bytes'
import { chooseOpenPath, chooseSavePath, readFileWithLimit } from './file-dialogs'
import type { RegisterHandler } from './handle'
import { parsePickFileOptions, parseSaveFileOptions } from './validate'

/** Registers `dialog.pickFile`, `dialog.openFile` (max 32 MB) and `dialog.saveFile`. */
export function registerDialogIpc(register: RegisterHandler): void {
  register(IPC.dialogPickFile, ({ window }, options) =>
    chooseOpenPath(window, parsePickFileOptions(options))
  )

  register(IPC.dialogOpenFile, async ({ window }, options): Promise<OpenFileResult | null> => {
    const path = await chooseOpenPath(window, parsePickFileOptions(options))
    if (!path) return null
    const data = toOwnedBytes(await readFileWithLimit(path, LIMITS.maxOpenFileBytes))
    return { path, name: basename(path), size: data.byteLength, data }
  })

  register(IPC.dialogSaveFile, async ({ window }, rawOptions): Promise<string | null> => {
    const { content, ...options } = parseSaveFileOptions(rawOptions)
    const path = await chooseSavePath(window, options)
    if (!path) return null
    if (typeof content === 'string') await writeFile(path, content, 'utf8')
    else await writeFile(path, content)
    knownFiles.remember(path)
    return path
  })
}
