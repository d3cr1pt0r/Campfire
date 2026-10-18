export const permissionGroups = [
    {
        name: 'Messaging',
        permissions: [
            ['messages.send', 'Send messages'],
            ['files.attach', 'Attach files and images'],
            ['reactions.add', 'Add reactions'],
            ['threads.create', 'Create threads'],
            ['threads.reply', 'Reply in threads'],
            ['messages.editOwn', 'Edit own messages'],
            ['messages.deleteOwn', 'Delete own messages'],
        ],
    },
    {
        name: 'Message moderation',
        permissions: [
            ['messages.pin', 'Pin and unpin messages'],
            ['messages.deleteOthers', 'Delete other members’ channel messages'],
        ],
    },
    {
        name: 'Calls',
        permissions: [
            ['calls.join', 'Join calls'],
            ['calls.start', 'Start direct calls and invite members'],
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
            ['channels.access', 'Change role access to channels'],
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
    'messages.send',
    'files.attach',
    'reactions.add',
    'threads.create',
    'threads.reply',
    'messages.editOwn',
    'messages.deleteOwn',
    'calls.join',
    'calls.start',
    'calls.speak',
    'calls.camera',
    'calls.share',
    'emojis.upload',
];
// Used only for upgrading persisted roles and legacy test fixtures, never API input.
export function migratePermissions(permissions) {
    const expanded = permissions.flatMap((p) =>
        p === 'send'
            ? [
                  'messages.send',
                  'files.attach',
                  'reactions.add',
                  'threads.create',
                  'threads.reply',
                  'messages.editOwn',
                  'emojis.upload',
              ]
            : p === 'voice'
              ? ['calls.join', 'calls.start', 'calls.speak', 'calls.camera', 'calls.share']
              : p === 'manage'
                ? [
                      'messages.pin',
                      'messages.deleteOthers',
                      'channels.edit',
                      'channels.create',
                      'channels.reorder',
                      'channels.delete',
                      'channels.access',
                      'emojis.deleteOthers',
                      'server.edit',
                  ]
                : [p],
    );
    // Own-message deletion was previously available without send permission.
    return [
        ...new Set([...expanded.filter((p) => permissionIds.includes(p)), 'messages.deleteOwn']),
    ];
}
export function hasRolePermission(role, permissions, permission) {
    return (
        permissionIds.includes(permission) && (role === 'owner' || permissions.includes(permission))
    );
}
