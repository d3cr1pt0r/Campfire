export const permissionGroups: { name: string; permissions: [string, string][] }[];
export const permissionIds: string[];
export const memberPermissions: string[];
export function migratePermissions(permissions: string[]): string[];
export function hasRolePermission(role: string, permissions: string[], permission: string): boolean;
