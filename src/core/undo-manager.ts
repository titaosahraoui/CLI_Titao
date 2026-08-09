import { readFile, writeFile, rm } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

export interface FileSnapshot {
  filePath: string;
  existed: boolean;
  previousContent: string | null;
  timestamp: number;
}

/**
 * Manages file edit snapshots and provides /undo capability.
 */
export class UndoManager {
  private history: FileSnapshot[] = [];

  /** Record a backup of a file before it is written or edited. */
  async backupFile(targetPath: string): Promise<void> {
    const absolutePath = path.resolve(targetPath);
    const existed = existsSync(absolutePath);
    let previousContent: string | null = null;

    if (existed) {
      try {
        previousContent = await readFile(absolutePath, 'utf-8');
      } catch {
        previousContent = null;
      }
    }

    this.history.push({
      filePath: absolutePath,
      existed,
      previousContent,
      timestamp: Date.now(),
    });
  }

  /**
   * Undo the most recent file edit/write operation.
   */
  async undo(): Promise<{ success: boolean; message: string }> {
    if (this.history.length === 0) {
      return { success: false, message: 'No file edits in history to undo.' };
    }

    const snapshot = this.history.pop()!;

    try {
      if (snapshot.existed && snapshot.previousContent !== null) {
        await writeFile(snapshot.filePath, snapshot.previousContent, 'utf-8');
        return {
          success: true,
          message: `Restored ${path.basename(snapshot.filePath)} to its previous state before edit.`,
        };
      } else if (!snapshot.existed) {
        if (existsSync(snapshot.filePath)) {
          await rm(snapshot.filePath, { force: true });
        }
        return {
          success: true,
          message: `Deleted newly created file ${path.basename(snapshot.filePath)}.`,
        };
      } else {
        return { success: false, message: 'Could not restore previous file state.' };
      }
    } catch (err: any) {
      return { success: false, message: `Undo failed: ${err.message}` };
    }
  }

  /** Get current number of undo steps available. */
  getHistoryLength(): number {
    return this.history.length;
  }

  /** Clear undo history. */
  clear(): void {
    this.history = [];
  }
}
