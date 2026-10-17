export const maxUploadBytes = 5 * 1024 * 1024;
export const maxUploadFiles = 10;
export function validateFileSelection(files) {
    if (files.length > maxUploadFiles) throw new Error('Attach up to 10 files per message');
    if (files.some((file) => file.size > maxUploadBytes))
        throw new Error('Files must be 5 MB or smaller');
    if (files.reduce((total, file) => total + file.size, 0) > maxUploadBytes)
        throw new Error('Attachments must total 5 MB or less per message');
}
