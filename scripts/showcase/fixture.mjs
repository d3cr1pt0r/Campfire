import { permissionIds } from '../../shared/permissions.js';

export const scenario = {
    id: 'community-call-and-thread-v1',
    width: 1600,
    height: 1100,
    timezone: 'UTC',
    callHeight: 308,
    thread: 'm5',
};

const people = [
    ['alex', 'Alex', 'owner', 'online', ['#f6c975', '#a16743', '#634535']],
    ['mia', 'Mia', 'member', 'online', ['#e4a6a5', '#93728f', '#514d6a']],
    ['sam', 'Sam', 'member', 'idle', ['#a9c9b4', '#609695', '#355c6c']],
    ['jo', 'Jo', 'member', 'online', ['#aaaee2', '#747cac', '#4b526d']],
    ['priya', 'Priya', 'member', 'online', ['#a4d3dd', '#619eaf', '#3a677d']],
    ['leo', 'Leo', 'member', 'idle', ['#d6b6df', '#9d82ad', '#675b7c']],
];

export const users = people.map(([id, nickname, role, status]) => ({
    id,
    username: id,
    nickname,
    role,
    status,
    avatar: `demo-${id}`,
}));

export const state = {
    me: users[0],
    name: 'The Fireside',
    users,
    roles: [
        { id: 'owner', name: 'Owner', color: '#e7b979', permissions: permissionIds },
        { id: 'member', name: 'Member', color: '#9fb6a0', permissions: permissionIds },
    ],
    channels: [
        ['general', 'general', 'text', 'A little conversation. A little company.'],
        ['projects', 'projects', 'text', 'Share what you are working on.'],
        ['screenshots', 'screenshots', 'text', 'A few things worth sharing.'],
        ['weekend-plans', 'weekend-plans', 'text', 'Make time for your people.'],
        ['fireside', 'Around the fire', 'voice', ''],
        ['gaming', 'Gaming', 'voice', ''],
    ].map(([id, name, kind, description]) => ({
        id,
        name,
        kind,
        description,
        protected: id === 'general' || id === 'fireside',
        access: 'full',
    })),
    channelPermissions: [],
    friends: ['mia', 'sam', 'priya'].map((recipient) => ({
        sender: 'alex',
        recipient,
        accepted: 1,
    })),
    online: users.map((user) => user.id),
    presence: Object.fromEntries(users.map((user) => [user.id, user.status])),
    calls: [
        { socket: 'alex-socket', user: 'alex', channel: 'fireside', muted: false, deafened: false },
        { socket: 'mia-socket', user: 'mia', channel: 'fireside', muted: true, deafened: false },
        {
            socket: 'sam-socket',
            user: 'sam',
            channel: 'fireside',
            muted: false,
            deafened: false,
            shareId: 'demo-share',
        },
    ],
    directCalls: [],
    emojis: [],
    iceServers: [],
};

const start = Date.parse('2026-10-18T18:00:00Z');
function message(id, author, body, minute, extra = {}) {
    return {
        id,
        room: 'general',
        author,
        body,
        created: start + minute * 60000,
        edited: null,
        pinned: 0,
        attachments: [],
        reactions: [],
        ...extra,
    };
}

export const messages = [
    message('m0', 'mia', 'Anyone around for a relaxed game night later? 🎮', 0, {
        reactions: [
            { user: 'alex', emoji: '🎮' },
            { user: 'sam', emoji: '🎮' },
            { user: 'priya', emoji: '🙌' },
        ],
    }),
    message(
        'm1',
        'sam',
        'Absolutely. Something co-op, preferably with very little coordination required.',
        1,
    ),
    message('m2', 'jo', 'So… our usual level of coordination.', 2),
    message('m3', 'alex', 'I’m in! Jump into Around the fire whenever you’re ready.', 3, {
        pinned: 1,
    }),
    message('m4', 'priya', 'I’ll bring the playlist. Taking requests in #weekend-plans 🎵', 4),
    message(
        'm5',
        'sam',
        'A little progress on the game I’ve been making. What do you think of the new lighting?',
        5,
        {
            replyCount: 4,
            reactions: [
                { user: 'alex', emoji: '🔥' },
                { user: 'mia', emoji: '🔥' },
                { user: 'priya', emoji: '🌲' },
            ],
        },
    ),
    message('m6', 'mia', 'That looks so good! Are you sharing your screen?', 6),
    message('m7', 'sam', 'Yep, it’s up now. Come have a look!', 7),
    message(
        'm8',
        'jo',
        'Games, side projects, and good company. This is exactly why I love this place.',
        8,
    ),
    message('m9', 'alex', 'Make yourself at home. There’s always room around the fire. 🔥', 9, {
        reactions: ['mia', 'sam', 'priya'].map((user) => ({ user, emoji: '❤️' })),
    }),
];

export const replies = [
    message('r0', 'alex', 'The warm light through the trees is lovely.', 6, { thread: 'm5' }),
    message('r1', 'mia', 'Love the colors. That would make a great place to explore. 🌲', 7, {
        thread: 'm5',
    }),
    message('r2', 'sam', 'Thanks! I added a little campsite by the water, too.', 8, {
        thread: 'm5',
    }),
    message('r3', 'priya', 'Co-op camping when? I volunteer as the snack coordinator. 🍿', 9, {
        thread: 'm5',
    }),
];

export const avatarSources = Object.fromEntries(
    people.map(([id, , , , [background, middle, foreground]]) => [
        `demo-${id}`,
        `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
            <rect width="128" height="128" fill="${background}"/>
            <circle cx="88" cy="35" r="20" fill="#fff0cc"/>
            <path d="M-16 107Q28 9 80 83L153 150H-16Z" fill="${middle}"/>
            <path d="M-12 128Q32 65 86 120L139 146H-12Z" fill="${foreground}"/>
        </svg>`,
    ]),
);

// A synthetic shared frame, not a capture of the user's screen or another application.
export const sharedFrame = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
    <defs>
        <linearGradient id="sky" x2="0" y2="1"><stop stop-color="#8ca6a5"/><stop offset="1" stop-color="#ebcc96"/></linearGradient>
        <linearGradient id="water" x2="0" y2="1"><stop stop-color="#6d9b94"/><stop offset="1" stop-color="#264c4a"/></linearGradient>
        <linearGradient id="land" x2="0" y2="1"><stop stop-color="#4f7059"/><stop offset="1" stop-color="#233f32"/></linearGradient>
    </defs>
    <path fill="url(#sky)" d="M0 0H1280V720H0Z"/>
    <circle cx="872" cy="174" r="67" fill="#ffe3a9"/>
    <path d="M0 384 207 144 370 297 554 114 778 329 994 170 1280 405V720H0Z" fill="#6b8980"/>
    <path d="m0 416 260-159 221 206 261-201 213 181 325-211V720H0Z" fill="#486c61"/>
    <path d="M0 447Q320 359 640 458T1280 424V720H0Z" fill="url(#water)"/>
    <path d="M0 403Q217 399 337 543T785 720H0Z" fill="url(#land)"/>
    <path d="M1280 414Q1089 418 1066 554T907 720H1280Z" fill="#294d3c"/>
    ${[45, 140, 264, 1050, 1161, 1255]
        .map((x, i) => {
            const height = [330, 268, 214, 236, 300, 359][i];
            return `<path d="M${x - 8} 572h16v-140h-16Z" fill="#594b3a"/><path d="m${x} ${572 - height} ${height / 3} ${height * 0.8}h-${(height * 2) / 3}Z" fill="${i < 3 ? '#264b3b' : '#1e4033'}"/>`;
        })
        .join('')}
    <path d="m277 612 111-121 112 121Z" fill="#d6a567"/>
    <path d="m388 491 112 121h-97Z" fill="#a86f48"/>
    <path d="m388 533-35 79h50Z" fill="#4d3d31"/>
    <ellipse cx="535" cy="633" rx="47" ry="15" fill="#1c3028"/>
    <path d="m510 633 49-10m-45 0 40 12" stroke="#896649" stroke-width="12" stroke-linecap="round"/>
    <path d="M521 626q-10-28 12-47-1 17 10 20 8-13 9-25 26 39-6 54Z" fill="#f2b76e"/>
    <path d="M533 629q-9-17 8-29 14 22-1 30Z" fill="#ffe1a0"/>
    <g stroke="#a8c0a7" stroke-width="3" opacity=".45"><path d="M650 524h142m55 23h164m-306 53h149m30-118h170"/></g>
</svg>`;
