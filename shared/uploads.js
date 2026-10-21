const megabyte = 1024 * 1024;
export const gigabyte = 1024 * megabyte;
// The owner sets the per-message limit in Server settings; this applies until they do.
export const defaultUploadBytes = 5 * megabyte;
// Uploads are read into server memory and stored in SQLite, so the setting is capped.
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
// The owner sets total attachment storage in whole gigabytes; 0 turns off new attachments.
export const storageQuotaCeiling = 1_000_000 * gigabyte;
export const isStorageQuota = (bytes) =>
    Number.isSafeInteger(bytes) &&
    bytes % gigabyte === 0 &&
    bytes >= 0 &&
    bytes <= storageQuotaCeiling;
export const formatStorageQuota = (bytes) => `${(bytes / gigabyte).toLocaleString('en-US')} GB`;
const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
export function formatBytes(bytes) {
    let value = bytes,
        unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    if (!unit) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
    return `${value < 10 ? value.toFixed(1).replace(/\.0$/, '') : Math.round(value)} ${units[unit]}`;
}
