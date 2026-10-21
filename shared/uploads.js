const megabyte = 1024 * 1024;
// The owner sets the per-message limit in Server settings; this applies until they do.
export const defaultUploadBytes = 5 * megabyte;
// Attachments travel as base64 JSON and are stored in SQLite, so the setting is capped.
export const uploadLimitCeiling = 100 * megabyte;
export const maxUploadFiles = 10;
// Limits are whole megabytes, which keeps every message about them exact.
export const isUploadLimit = (bytes) =>
    Number.isSafeInteger(bytes) &&
    bytes % megabyte === 0 &&
    bytes >= megabyte &&
    bytes <= uploadLimitCeiling;
export const formatUploadLimit = (bytes) => `${bytes / megabyte} MB`;
export function validateFileSelection(files, limit = defaultUploadBytes) {
    if (files.length > maxUploadFiles) throw new Error('Attach up to 10 files per message');
    if (files.some((file) => file.size > limit))
        throw new Error(`Files must be ${formatUploadLimit(limit)} or smaller`);
    if (files.reduce((total, file) => total + file.size, 0) > limit)
        throw new Error(`Attachments must total ${formatUploadLimit(limit)} or less per message`);
}
