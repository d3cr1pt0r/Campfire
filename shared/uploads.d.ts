export const defaultUploadBytes: number;
export const uploadLimitCeiling: number;
export const maxUploadFiles: number;
export function isUploadLimit(bytes: unknown): bytes is number;
export function formatUploadLimit(bytes: number): string;
export function validateFileSelection(files: { size: number }[], limit?: number): void;
