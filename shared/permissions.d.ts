import type { User, Role, Channel } from './contracts';
export const permissionGroups: { name: string; permissions: [string, string][] }[];
export const permissionIds: string[];
export const memberPermissions: string[];
export function channelPermissionIds(kind: string): string[];
export function migratePermissions(permissions: string[]): string[];
export function rolePermissions(user: User | undefined, roles: Role[]): string[];
export function hasPermission(
    user: User | undefined,
    roles: Role[],
    permission: string,
    channel?: Channel,
): boolean;
export function highestPosition(user: User | undefined, roles: Role[]): number;
export function canManageRole(user: User | undefined, roles: Role[], role: Role): boolean;
export function roleColor(user: User | undefined, roles: Role[]): string | undefined;

export function effectiveRoleIds(assigned?: string[]): string[];
