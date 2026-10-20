export const permissionGroups = [
    {
        name: 'Messaging',
        permissions: [
            ['channels.view', 'View channels'],
            ['messages.send', 'Send channel messages'],
            ['files.attach', 'Attach files and images'],
            ['reactions.add', 'Add reactions'],
            ['threads.create', 'Create threads'],
            ['threads.reply', 'Reply in threads'],
        ],
    },
    {
        name: 'Message moderation',
        permissions: [
            ['messages.pin', 'Pin and unpin channel messages'],
            ['messages.deleteOthers', 'Delete other members’ channel messages'],
        ],
    },
    {
        name: 'Calls',
        permissions: [
            ['calls.join', 'Join calls'],
            ['calls.start', 'Start private calls and add participants'],
            ['calls.speak', 'Speak in calls'],
            ['calls.camera', 'Publish camera video'],
            ['calls.share', 'Share screen and audio'],
        ],
    },
    {
        name: 'Channels',
        permissions: [
            ['channels.edit', 'Edit channel names and descriptions'],
            ['channels.create', 'Create channels'],
            ['channels.reorder', 'Reorder channels'],
            ['channels.delete', 'Delete channels'],
            ['channels.access', 'Manage channel permission overrides'],
        ],
    },
    {
        name: 'Roles and members',
        permissions: [
            ['roles.assign', 'Assign lower roles'],
            ['roles.manage', 'Create, edit and order lower roles'],
            ['members.ban', 'Ban lower members'],
            ['members.restore', 'Restore lower members’ access'],
            ['members.delete', 'Permanently delete lower members’ accounts'],
            ['members.resetPassword', 'Generate password reset tokens for lower members'],
        ],
    },
    {
        name: 'Invitations',
        permissions: [
            ['invitations.create', 'Create invitations'],
            ['invitations.manage', 'View and revoke invitations'],
        ],
    },
    {
        name: 'Custom emojis',
        permissions: [
            ['emojis.upload', 'Upload custom emojis'],
            ['emojis.deleteOthers', 'Remove other members’ emojis'],
        ],
    },
    { name: 'Server', permissions: [['server.edit', 'Edit general server settings']] },
];
export const permissionIds = permissionGroups.flatMap((group) =>
    group.permissions.map(([id]) => id),
);
export const memberPermissions = [
    'channels.view',
    'messages.send',
    'files.attach',
    'reactions.add',
    'threads.create',
    'threads.reply',
    'calls.join',
    'calls.start',
    'calls.speak',
    'calls.camera',
    'calls.share',
    'emojis.upload',
];
export const channelPermissionIds = (kind) =>
    kind === 'voice'
        ? ['channels.view', 'calls.join', 'calls.speak', 'calls.camera', 'calls.share']
        : [
              'channels.view',
              'messages.send',
              'files.attach',
              'reactions.add',
              'threads.create',
              'threads.reply',
              'messages.pin',
              'messages.deleteOthers',
          ];
export function effectiveRoleIds(assigned = []) {
    return assigned.length ? assigned : ['everyone'];
}
export function rolePermissions(user, roles) {
    if (!user) return [];
    if (user.owner) return permissionIds;
    return [
        ...new Set(
            roles
                .filter((role) => effectiveRoleIds(user.roles).includes(role.id))
                .flatMap((role) => role.permissions),
        ),
    ];
}
export function hasPermission(user, roles, permission, channel) {
    if (!user || !permissionIds.includes(permission)) return false;
    return (
        user.owner ||
        (channel ? channel.permissions : rolePermissions(user, roles)).includes(permission)
    );
}
export function highestPosition(user, roles) {
    return user?.owner
        ? Infinity
        : Math.max(
              0,
              ...roles
                  .filter((role) => user?.roles?.includes(role.id))
                  .map((role) => role.position),
          );
}
export function canManageRole(user, roles, role) {
    return (
        !!user &&
        !!role &&
        (user.owner || (role.id !== 'everyone' && highestPosition(user, roles) > role.position))
    );
}
export function roleColor(user, roles) {
    if (!user) return undefined;
    return (
        roles
            .filter((role) => effectiveRoleIds(user?.roles).includes(role.id) && role.color)
            .sort((a, b) => b.position - a.position)[0]?.color || undefined
    );
}
