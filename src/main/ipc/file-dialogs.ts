/**
 * Native open / save dialogs (modal to the requesting window) and bounded file reads.
 */
import { stat, readFile } from 'node:fs/promises'
import { app, dialog, type BrowserWindow, type FileFilter } from 'electron'
import { isAbsolute, join } from 'node:path'

export interface OpenDialogOptions {
  title?: string
  filters?: FileFilter[]
}

export interface SaveDialogOptions extends OpenDialogOptions {
  /** File name or path; bare names start in the Documents folder. */
  defaultPath?: string
}

/** Shows an open-file dialog; returns the chosen absolute path or `null` when cancelled. */
export async function chooseOpenPath(
  window: BrowserWindow | null,
  options: OpenDialogOptions
): Promise<string | null> {
  const dialogOptions: Electron.OpenDialogOptions = {
    title: options.title,
    filters: options.filters,
    properties: ['openFile']
  }
  const result = window
    ? await dialog.showOpenDialog(window, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
}

/** Shows a save dialog; returns the chosen path or `null` when cancelled. */
export async function chooseSavePath(
  window: BrowserWindow | null,
  options: SaveDialogOptions
): Promise<string | null> {
  const defaultPath = options.defaultPath
    ? isAbsolute(options.defaultPath)
      ? options.defaultPath
      : join(app.getPath('documents'), options.defaultPath)
    : undefined
  const dialogOptions: Electron.SaveDialogOptions = {
    title: options.title,
    defaultPath,
    filters: options.filters
  }
  const result = window
    ? await dialog.showSaveDialog(window, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions)
  return result.canceled || !result.filePath ? null : result.filePath
}

const MB = 1024 * 1024

/** Reads a regular file of at most `maxBytes`; throws a human error otherwise. */
export async function readFileWithLimit(path: string, maxBytes: number): Promise<Buffer> {
  const info = await stat(path)
  if (!info.isFile()) throw new Error('Not a regular file')
  if (info.size > maxBytes) {
    throw new Error(
      `File is too large (${(info.size / MB).toFixed(1)} MB, max ${Math.round(maxBytes / MB)} MB)`
    )
  }
  return readFile(path)
}
