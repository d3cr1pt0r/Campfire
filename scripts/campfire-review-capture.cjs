// Run with Electron after starting campfire-review-server.mjs.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.setPath('userData', '/tmp/campfire-review-electron');
app.commandLine.appendSwitch('disable-gpu');
const output = path.resolve('Docs/campfire-review');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const screens = [
    ['chat', 'Chat & members', ''],
    [
        'attachments',
        'Attachment composer',
        "r.setAttachments([new File(['sample'],'Saturday-playlist.txt',{type:'text/plain'})])",
    ],
    [
        'friends-empty',
        'Friends · empty state',
        "r.setState({...f.state,friends:[]});r.setView('friends')",
    ],
    [
        'account-profile',
        'Profile & avatar settings',
        "r.setModal('settings');r.setSettingsTab('account')",
        "document.querySelector('.settings-content').scrollTop=10000",
    ],
    [
        'audio-advanced',
        'Advanced voice & video settings',
        "r.setModal('settings');r.setSettingsTab('audio')",
        "document.querySelector('.settings-content').scrollTop=10000",
    ],
    [
        'auth-open',
        'Open registration',
        "r.setToken('');r.setState(null);r.setRegister(true)",
        "window.__review.setServerInfo({registrationMode:'open',setupRequired:false})",
    ],

    ['pins', 'Pinned messages', 'r.setPins(true)'],
    ['search', 'Search messages', "r.setSearch('brewery')"],
    ['thread', 'Thread replies', 'r.setThread(f.messages[2])'],
    ['dm', 'Direct messages', "r.setRoom('dm:alex:mia')"],
    ['friends', 'Friends', "r.setView('friends')"],
    [
        'requests',
        'Friend requests',
        "r.setView('friends')",
        "[...document.querySelectorAll('.friend-filters button')].find(b=>b.textContent.includes('Requests'))?.click()",
    ],
    ...['account', 'audio', 'notifications', 'server', 'roles', 'channels', 'emojis'].map((t) => [
        `settings-${t}`,
        `Settings · ${t}`,
        `r.setModal('settings');r.setSettingsTab('${t}')`,
    ]),
    [
        'registration',
        'Registration & invitations',
        "r.setModal('settings');r.setSettingsTab('server')",
        "document.querySelector('.registration-settings')?.scrollIntoView({block:'start'})",
    ],
    [
        'channel-editor',
        'Channel editor',
        "r.setModal('settings');r.setSettingsTab('channels')",
        "document.querySelectorAll('.channel-settings-expand')[1]?.click()",
    ],
    [
        'channel-delete',
        'Delete channel confirmation',
        "r.setModal('settings');r.setSettingsTab('channels')",
        "document.querySelectorAll('.channel-settings-expand')[1]?.click()",
        "[...document.querySelectorAll('button')].find(b=>b.textContent==='Delete channel')?.click()",
    ],
    [
        'role-delete',
        'Delete role confirmation',
        "r.setModal('settings');r.setSettingsTab('roles')",
        'document.querySelector(\'[aria-label="Delete Regulars role"]\')?.click()',
    ],
    ...[
        ['switch', 'Connect to another server'],
        ['friend', 'Add friend'],
        ['channel:text', 'Create text channel'],
        ['channel:voice', 'Create voice channel'],
        ['edit', 'Edit message'],
        ['role:new', 'Create role'],
        ['role:regular', 'Edit role'],
        ['emoji', 'Emoji picker'],
        ['reaction:m2', 'Reaction picker'],
        ['delete:m2', 'Delete message'],
        ['remove:mia', 'Remove friend'],
        ['remove:jo', 'Decline friend request'],
        ['invite-call', 'Invite to call'],
    ].map(([m, title]) => [
        m.replace(':', '-'),
        title,
        `r.setEdit(f.messages[2]);r.setModal('${m}')`,
    ]),
    [
        'role-access',
        'Role channel permissions',
        "r.setModal('role:regular')",
        "document.querySelector('.role-channel-access')?.scrollIntoView({block:'end'})",
    ],
    [
        'call',
        'Voice call & stream subscription',
        "window.__reviewCall={channel:'fireside',panelOpen:true,remote:[{id:'remote',user:'mia',stream:new MediaStream(),streamAudio:new MediaStream(),sharing:true,camera:false,watching:false,watchPending:false}]};r.setPrefs(p=>({...p}))",
    ],
    ['image', 'Expanded image viewer', "window.__extra('image')"],
    ['video', 'Expanded screen / video viewer', "window.__extra('video')"],
    [
        'crop',
        'Avatar cropper',
        "r.setModal('settings');r.setSettingsTab('account');window.__extra('crop')",
    ],
    [
        'toast',
        'Notification / error toast',
        "r.setError('You’re back by the fire. Connection restored.')",
    ],
    ['auth-register', 'Create account', "r.setToken('');r.setState(null);r.setRegister(true)"],
    ['auth-login', 'Sign in', "r.setToken('');r.setState(null);r.setRegister(false)"],
    [
        'auth-setup',
        'First owner setup',
        "r.setToken('');r.setState(null);r.setRegister(true)",
        "window.__review.setServerInfo({registrationMode:'open',setupRequired:true})",
    ],
    [
        'auth-error',
        'Connection error',
        "r.setToken('');r.setState(null);r.setRegister(false)",
        "window.__review.setInfoError('Could not reach this server. Check the address and try again.')",
    ],
];
app.whenReady()
    .then(async () => {
        const win = new BrowserWindow({
            width: 1440,
            height: 960,
            useContentSize: true,
            show: true,
            paintWhenInitiallyHidden: true,
            webPreferences: {
                backgroundThrottling: false,
                contextIsolation: true,
                nodeIntegration: false,
            },
        });
        const errors = [];
        win.webContents.on('console-message', (event) => {
            const { level, message } = event;
            if (level === 'error') {
                errors.push(message);
                console.log('renderer:', message);
            }
        });
        for (const [theme, port] of [
            ['before', 5181],
            ['after', 5182],
            ['canvas', 5182],
            ['forest', 5182],
        ].filter(([theme]) => !process.env.REVIEW_THEME || theme === process.env.REVIEW_THEME)) {
            fs.mkdirSync(path.join(output, theme), { recursive: true });
            for (const [id, title, setup, then, finallyStep] of screens) {
                console.log('loading', theme, id);
                await win.loadURL(`http://127.0.0.1:${port}?theme=${theme}`);
                console.log('loaded');
                for (let i = 0; i < 50; i++) {
                    if (
                        await win.webContents.executeJavaScript(
                            '!!window.__review && !!document.querySelector(".app-shell")',
                        )
                    )
                        break;
                    await pause(100);
                }
                if (!(await win.webContents.executeJavaScript('!!window.__review')))
                    throw new Error('Review app did not mount');
                await win.webContents.executeJavaScript(
                    `{const r=window.__review,f=window.__fixture;${setup};}`,
                );
                await pause(500);
                if (then) {
                    await win.webContents.executeJavaScript(then);
                    await pause(180);
                }
                if (finallyStep) {
                    await win.webContents.executeJavaScript(finallyStep);
                    await pause(180);
                }
                if (
                    id === 'role-delete' &&
                    !(await win.webContents.executeJavaScript(
                        '!!document.querySelector(".role-delete-confirm")',
                    ))
                )
                    throw Error('Role delete confirmation missing');
                if (
                    id === 'thread' &&
                    !(await win.webContents.executeJavaScript(
                        '!!document.querySelector(".thread-panel")',
                    ))
                )
                    throw Error('Thread missing');
                console.log('capturing');
                const image = await win.webContents.capturePage();
                fs.writeFileSync(path.join(output, theme, `${id}.png`), image.toPNG());
                console.log(`${theme} ${id}`);
            }
        }
        fs.writeFileSync(
            path.join(output, 'manifest.json'),
            JSON.stringify(
                {
                    baseline: 'f7e55c1027027e97da01994285c0988fcc3055a4',
                    viewport: { width: 1440, height: 960 },
                    screens: screens.map(([id, title]) => ({ id, title })),
                    errors: [...new Set(errors)],
                },
                null,
                2,
            ),
        );
        win.destroy();
        app.quit();
    })
    .catch((e) => {
        console.error(e);
        app.exit(1);
    });
