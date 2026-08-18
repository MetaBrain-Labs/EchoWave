/** Keeps document-block emphasis choices shared for the current app session. */
const importantBlockIds = new Set<string>(['block-process']);

export function getImportantBlockIds() {
  return new Set(importantBlockIds);
}

export function setBlockImportant(blockId: string, important: boolean) {
  if (important) {
    importantBlockIds.add(blockId);
    return;
  }

  importantBlockIds.delete(blockId);
}

export function resetImportantBlockIds(ids: readonly string[] = ['block-process']) {
  importantBlockIds.clear();
  ids.forEach((id) => importantBlockIds.add(id));
}
