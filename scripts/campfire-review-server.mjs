// Isolated visual fixtures. This server never reads or writes the user's chat database.
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';
import { permissionIds } from '../shared/permissions.js';
const baseline = 'f7e55c1027027e97da01994285c0988fcc3055a4';
const baselineName = JSON.parse(
    execFileSync('git', ['show', `${baseline}:package.json`], { encoding: 'utf8' }),
).name;
const users = [
    { id: 'alex', username: 'alex', nickname: 'Alex', role: 'owner', status: 'online' },
    { id: 'mia', username: 'mia', nickname: 'Mia', role: 'member', status: 'online' },
    { id: 'sam', username: 'sam', nickname: 'Sam', role: 'member', status: 'idle' },
    { id: 'jo', username: 'jo', nickname: 'Jo', role: 'member', status: 'online' },
];
const state = {
    me: users[0],
    name: 'The Fireside',
    users,
    roles: [
        { id: 'owner', name: 'Owner', color: '#e7b979', permissions: permissionIds },
        { id: 'member', name: 'Member', color: '#9fb6a0', permissions: permissionIds },
        { id: 'regular', name: 'Regulars', color: '#de966f', permissions: permissionIds },
    ],
    channels: [
        {
            id: 'general',
            name: 'general',
            kind: 'text',
            description: 'Good company. No last orders.',
            protected: true,
            access: 'full',
        },
        {
            id: 'beer-talk',
            name: 'beer-talk',
            kind: 'text',
            description: 'What’s everyone drinking?',
            protected: false,
            access: 'full',
        },
        {
            id: 'weekend',
            name: 'weekend-plans',
            kind: 'text',
            description: 'Make a little time for your people.',
            protected: false,
            access: 'full',
        },
        {
            id: 'fireside',
            name: 'Around the fire',
            kind: 'voice',
            description: '',
            protected: true,
            access: 'full',
        },
    ],
    channelPermissions: [],
    friends: [
        { sender: 'alex', recipient: 'mia', accepted: 1 },
        { sender: 'alex', recipient: 'sam', accepted: 1 },
        { sender: 'jo', recipient: 'alex', accepted: 0 },
    ],
    online: ['alex', 'mia', 'sam', 'jo'],
    presence: { alex: 'online', mia: 'online', sam: 'idle', jo: 'online' },
    calls: [
        { socket: 'mia-socket', user: 'mia', channel: 'fireside' },
        { socket: 'sam-socket', user: 'sam', channel: 'fireside' },
    ],
    directCalls: [],
    emojis: [],
    iceServers: [],
};
const now = new Date('2026-10-17T18:00:00Z').getTime();
const messages = [
    ['mia', 'Anyone tried that little brewery by the river? 🍻'],
    ['sam', 'Their amber ale is dangerously good. Bringing a few on Saturday.'],
    ['alex', 'Sold. I’ll get the fire going. Someone bring the terrible stories.'],
    ['jo', 'I have at least three. And absolutely no shame.'],
    ['mia', 'Same spot, sunset? I’m bringing the snacks.'],
].map(([author, body], i) => ({
    id: `m${i}`,
    room: 'general',
    author,
    body,
    created: now + i * 90000,
    edited: null,
    pinned: i === 2 ? 1 : 0,
    attachments: [],
    reactions:
        i === 2
            ? [
                  { user: 'mia', emoji: '🔥' },
                  { user: 'sam', emoji: '🔥' },
              ]
            : [],
    replyCount: i === 2 ? 3 : 0,
}));
const replies = [
    {
        ...messages[0],
        id: 'reply',
        thread: 'm2',
        body: 'I’ll bring the bottle opener. Learned that lesson last time.',
    },
];
for (const [theme, port] of [
    ['before', 5181],
    ['after', 5182],
]) {
    const server = await createServer({
        configFile: false,
        server: { host: '127.0.0.1', port, strictPort: true },
        plugins: [
            {
                name: 'isolated-campfire-review',
                enforce: 'pre',
                resolveId(id) {
                    if (id.startsWith('/@review/')) return '\0' + id;
                },
                load(id) {
                    if (id === '\0/@review/socket')
                        return `export function io(){const s={connected:true,id:'review',on(e,f){if(e==='connect')queueMicrotask(f);return s},off(){return s},emit(){return s},disconnect(){},removeAllListeners(){}};return s}`;
                    if (id === '\0/@review/fixture')
                        return `export const state=${JSON.stringify(state)};export const messages=${JSON.stringify(messages)};`;
                    if (
                        theme === 'before' &&
                        id.startsWith(process.cwd() + '/src/') &&
                        /\.(tsx?|css)$/.test(id)
                    ) {
                        try {
                            return execFileSync(
                                'git',
                                ['show', `${baseline}:${id.slice(process.cwd().length + 1)}`],
                                { encoding: 'utf8' },
                            ).replace(new RegExp(baselineName, 'gi'), (name) =>
                                name === name.toUpperCase()
                                    ? 'CAMPFIRE'
                                    : name[0] === name[0].toUpperCase()
                                      ? 'Campfire'
                                      : 'campfire',
                            );
                        } catch {
                            return null;
                        }
                    }
                },
                transform(code, id) {
                    if (!id.endsWith('/src/main.tsx')) return;
                    code = code.replace("from 'socket.io-client'", "from '/@review/socket'");
                    code = code.replace(
                        'initialPreferences.theme = themePreference(initialPreferences.theme);',
                        `initialPreferences.theme = themePreference(initialPreferences.theme); if(new URLSearchParams(location.search).has('theme')) initialPreferences.theme = new URLSearchParams(location.search).get('theme') === 'canvas' ? 'light' : 'dark';`,
                    );
                    code = code.replace(
                        'const showError = error && (',
                        `if(new URLSearchParams(location.search).get('theme') === 'forest') requestAnimationFrame(()=>document.documentElement.dataset.theme='forest'); const showError = error && (`,
                    );

                    code = code.replace(
                        'const defaultServerUrl =',
                        'const defaultServerUrl = window.location.origin; const unusedDefaultServerUrl =',
                    );
                    code = code.replace(
                        'const speaking = useSpeaking',
                        'Object.assign(call, (window as any).__reviewCall || {});\n    const speaking = useSpeaking',
                    );
                    code = code.replace(
                        'const showError = error && (',
                        `(window as any).__review = {setModal,resetModals,setSettingsTab,setView,setPins,setSearch,setThread,setRoom,setRegister,setToken,setState,setError,setEdit,setConnected,setBusy,setPrefs,setServerInfo,setInfoError,setAttachments,call};\n    const showError = error && (`,
                    );
                    code =
                        `import {state as fixtureState,messages as fixtureMessages} from '/@review/fixture';\nimport {AvatarCropper as ReviewCropper} from './AvatarCropper';\nimport {ExpandedViewer as ReviewViewer} from './ExpandedViewer';\n` +
                        code;
                    code += `\nconst extraRoot = createRoot(document.body.appendChild(document.createElement('div')));\n(window as any).__fixture={state:fixtureState,messages:fixtureMessages};\n(window as any).__extra=async(kind:string)=>{\nif(!kind){extraRoot.render(null);return;}\nif(kind==='crop'){const blob=await (await fetch('/assets/campfire/icon-512.png')).blob();extraRoot.render(<ReviewCropper file={new File([blob],'avatar.png',{type:'image/png'})} onSave={async()=>{}} onClose={()=>extraRoot.render(null)}/>);return;}\nextraRoot.render(<ReviewViewer name={kind==='image'?'Saturday by the fire':'Mia’s screen'} label={'Expanded '+kind} kind={kind==='image'?'image':'video'} onClose={()=>extraRoot.render(null)} subtitle={kind==='image'?'Shared in #general':'Screen share · sample preview'}>{()=>kind==='image'?<img src='/assets/campfire/icon-512.png' style={{height:'75%',objectFit:'contain'}}/>:<div style={{padding:60,textAlign:'center'}}><h1>Saturday’s playlist</h1><p>A little music. A little conversation.</p><p>Sample shared-screen content</p></div>}</ReviewViewer>);};`;
                    return { code, map: null };
                },
                transformIndexHtml(html) {
                    return html.replace(
                        '<head>',
                        '<head><script>document.documentElement.dataset.theme=new URLSearchParams(location.search).get("theme")||"ember";localStorage.setItem("connection",JSON.stringify({url:location.origin,token:"review-fixture"}));</script>',
                    );
                },
                configureServer(s) {
                    s.middlewares.use((req, res, next) => {
                        if (!req.url.startsWith('/api/')) return next();
                        const url = new URL(req.url, 'http://localhost');
                        let data = {};
                        if (url.pathname === '/api/state') data = state;
                        else if (url.pathname === '/api/info')
                            data = { registrationMode: 'invite', setupRequired: false };
                        else if (url.pathname === '/api/registration')
                            data = {
                                mode: 'invite',
                                invitations: [
                                    {
                                        id: 'invite1',
                                        label: 'Saturday crew',
                                        created: now,
                                        expires: now + 86400000,
                                        usedBy: null,
                                        revoked: 0,
                                    },
                                ],
                            };
                        else if (url.pathname.startsWith('/api/messages/'))
                            data =
                                messages.find((m) => m.id === url.pathname.split('/').at(-1)) ||
                                messages[2];
                        else if (url.pathname === '/api/messages')
                            data = {
                                messages: url.searchParams.has('thread')
                                    ? replies
                                    : messages.filter(
                                          (m) =>
                                              (!url.searchParams.has('pinned') || m.pinned) &&
                                              (!url.searchParams.has('search') ||
                                                  m.body
                                                      .toLowerCase()
                                                      .includes(
                                                          url.searchParams
                                                              .get('search')
                                                              .toLowerCase(),
                                                      )),
                                      ),
                                next: null,
                            };
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify(data));
                    });
                },
            },
            (await import('@vitejs/plugin-react')).default(),
        ],
    });
    await server.listen();
    console.log(`${theme}: http://127.0.0.1:${port}`);
}
