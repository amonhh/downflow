export interface SegmentStorage {
  prepare(downloadId: string, indexes: Array<{ index: number; expectedSize: number }>): Promise<number[]>;
  append(downloadId: string, index: number, chunk: Uint8Array): Promise<void>;
  size(downloadId: string, index: number): Promise<number>;
  resetSegment(downloadId: string, index: number): Promise<void>;
  assemble(downloadId: string, indexes: number[], mime: string): Promise<{ blob: Blob; totalBytes: number }>;
  remove(downloadId: string): Promise<void>;
  clearAll(): Promise<void>;
}

const ROOT_DIRECTORY = 'downflow-segments-v1';

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
}

function segmentFilename(index: number): string {
  return `segment-${String(index).padStart(4, '0')}.part`;
}

function asArrayBufferView(chunk: Uint8Array): Uint8Array<ArrayBuffer> {
  if (chunk.buffer instanceof ArrayBuffer) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  return new Uint8Array(chunk);
}

export class OpfsSegmentStorage implements SegmentStorage {
  private rootPromise: Promise<FileSystemDirectoryHandle> | null = null;

  private async root(): Promise<FileSystemDirectoryHandle> {
    if (!this.rootPromise) {
      this.rootPromise = navigator.storage.getDirectory().then((root) =>
        root.getDirectoryHandle(ROOT_DIRECTORY, { create: true }),
      );
    }
    return this.rootPromise;
  }

  private async directory(downloadId: string, create = true): Promise<FileSystemDirectoryHandle> {
    const root = await this.root();
    return root.getDirectoryHandle(safeId(downloadId), { create });
  }

  private async file(downloadId: string, index: number, create = true): Promise<FileSystemFileHandle> {
    const directory = await this.directory(downloadId, create);
    return directory.getFileHandle(segmentFilename(index), { create });
  }

  async prepare(
    downloadId: string,
    indexes: Array<{ index: number; expectedSize: number }>,
  ): Promise<number[]> {
    const directory = await this.directory(downloadId, true);
    const sizes: number[] = [];
    for (const { index, expectedSize } of indexes) {
      try {
        const handle = await directory.getFileHandle(segmentFilename(index), { create: true });
        const file = await handle.getFile();
        if (file.size > expectedSize) {
          await directory.removeEntry(segmentFilename(index));
          await directory.getFileHandle(segmentFilename(index), { create: true });
          sizes.push(0);
        } else {
          sizes.push(file.size);
        }
      } catch {
        sizes.push(0);
      }
    }
    return sizes;
  }

  async append(downloadId: string, index: number, chunk: Uint8Array): Promise<void> {
    const handle = await this.file(downloadId, index, true);
    const existing = await handle.getFile();
    const writable = await handle.createWritable({ keepExistingData: true });
    try {
      await writable.seek(existing.size);
      await writable.write(asArrayBufferView(chunk));
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
  }

  async size(downloadId: string, index: number): Promise<number> {
    try {
      const file = await (await this.file(downloadId, index, false)).getFile();
      return file.size;
    } catch {
      return 0;
    }
  }

  async resetSegment(downloadId: string, index: number): Promise<void> {
    try {
      const directory = await this.directory(downloadId, false);
      await directory.removeEntry(segmentFilename(index));
    } catch {
      // Missing segment is already reset.
    }
  }

  async assemble(downloadId: string, indexes: number[], mime: string): Promise<{ blob: Blob; totalBytes: number }> {
    const directory = await this.directory(downloadId, false);
    const parts: Blob[] = [];
    let totalBytes = 0;
    for (const index of indexes) {
      const handle = await directory.getFileHandle(segmentFilename(index));
      const file = await handle.getFile();
      parts.push(file);
      totalBytes += file.size;
    }
    return { blob: new Blob(parts, { type: mime || 'application/octet-stream' }), totalBytes };
  }

  async remove(downloadId: string): Promise<void> {
    try {
      const root = await this.root();
      await root.removeEntry(safeId(downloadId), { recursive: true });
    } catch {
      // Nothing to remove.
    }
  }

  async clearAll(): Promise<void> {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(ROOT_DIRECTORY, { recursive: true });
      this.rootPromise = null;
    } catch {
      // Nothing to remove.
    }
  }
}

export class MemorySegmentStorage implements SegmentStorage {
  private readonly data = new Map<string, Map<number, Uint8Array[]>>();

  async prepare(
    downloadId: string,
    indexes: Array<{ index: number; expectedSize: number }>,
  ): Promise<number[]> {
    if (!this.data.has(downloadId)) this.data.set(downloadId, new Map());
    const files = this.data.get(downloadId)!;
    return indexes.map(({ index, expectedSize }) => {
      const chunks = files.get(index) ?? [];
      const currentSize = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      if (currentSize > expectedSize) {
        files.delete(index);
        return 0;
      }
      return currentSize;
    });
  }

  async append(downloadId: string, index: number, chunk: Uint8Array): Promise<void> {
    if (!this.data.has(downloadId)) this.data.set(downloadId, new Map());
    const files = this.data.get(downloadId)!;
    const chunks = files.get(index) ?? [];
    chunks.push(chunk.slice());
    files.set(index, chunks);
  }

  async size(downloadId: string, index: number): Promise<number> {
    return (this.data.get(downloadId)?.get(index) ?? []).reduce((sum, chunk) => sum + chunk.byteLength, 0);
  }

  async resetSegment(downloadId: string, index: number): Promise<void> {
    this.data.get(downloadId)?.delete(index);
  }

  async assemble(downloadId: string, indexes: number[], mime: string): Promise<{ blob: Blob; totalBytes: number }> {
    const files = this.data.get(downloadId);
    const parts: Blob[] = [];
    let totalBytes = 0;
    for (const index of indexes) {
      const chunks = files?.get(index) ?? [];
      for (const chunk of chunks) {
        parts.push(new Blob([asArrayBufferView(chunk)]));
        totalBytes += chunk.byteLength;
      }
    }
    return { blob: new Blob(parts, { type: mime || 'application/octet-stream' }), totalBytes };
  }

  async remove(downloadId: string): Promise<void> {
    this.data.delete(downloadId);
  }

  async clearAll(): Promise<void> {
    this.data.clear();
  }
}

export async function opfsAvailable(): Promise<boolean> {
  try {
    return typeof navigator !== 'undefined' && Boolean(navigator.storage?.getDirectory);
  } catch {
    return false;
  }
}
