import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
const dir = 'Docs/campfire-review';
const manifest = JSON.parse(await fs.readFile(`${dir}/manifest.json`, 'utf8'));
const themes = [
    ['after', 'Ember', 'Charcoal, timber, and glowing amber. The selected Campfire direction.'],
    ['canvas', 'Canvas', 'Cream paper, burnt sienna, and a dark timber sidebar.'],
    ['forest', 'Forest', 'Deep pine green, sage, and golden firelight.'],
];
await sharp(execFileSync('git', ['show', `${manifest.baseline}:electron/icons/icon.png`]))
    .resize(128)
    .png()
    .toFile(`${dir}/campfire-icon.png`);
const labels = Buffer.from(
    `<svg width="2880" height="64"><rect width="2880" height="64" fill="#151715"/><g fill="#eee4d1" font-family="sans-serif" font-size="22"><text x="28" y="41">BEFORE · CAMPFIRE</text><text x="1468" y="41">AFTER · CAMPFIRE / EMBER</text></g></svg>`,
);
for (const id of [
    'chat',
    'auth-login',
    'friends',
    'call',
    'thread',
    'settings-account',
    'settings-roles',
]) {
    await sharp({ create: { width: 2880, height: 1024, channels: 3, background: '#151715' } })
        .composite([
            { input: labels, top: 0, left: 0 },
            { input: `${dir}/before/${id}.png`, top: 64, left: 0 },
            { input: `${dir}/after/${id}.png`, top: 64, left: 1440 },
        ])
        .png()
        .toFile(`${dir}/compare-${id}.png`);
}
const titles = { after: 'EMBER', canvas: 'CANVAS', forest: 'FOREST' };
let comps = [];
for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++) {
        const [theme] = themes[col],
            id = ['chat', 'auth-login', 'friends'][row];
        const thumb = await sharp(`${dir}/${theme}/${id}.png`).resize(720, 480).toBuffer();
        const label = Buffer.from(
            `<svg width="720" height="42"><rect width="720" height="42" fill="#151715"/><text x="18" y="28" font-family="sans-serif" fill="#efb66f" font-size="17">${titles[theme]} · ${['Chat', 'Welcome', 'Friends'][row]}</text></svg>`,
        );
        comps.push(
            { input: label, left: col * 720, top: row * 522 },
            { input: thumb, left: col * 720, top: row * 522 + 42 },
        );
    }
await sharp({ create: { width: 2160, height: 1566, channels: 3, background: '#151715' } })
    .composite(comps)
    .png()
    .toFile(`${dir}/design-directions.png`);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Campfire — Design review</title><link rel="icon" href="../../assets/campfire/icon-512.png"><style>
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#151715;color:#f2eadb;font:15px/1.6 system-ui,sans-serif}button,input,select{font:inherit}a{color:#efb66f;text-underline-offset:4px}button{cursor:pointer}header,main,footer{max-width:1720px;margin:auto;padding:36px 48px}header{padding-top:64px}.brand{display:flex;align-items:center;gap:16px}.brand img{width:64px;border-radius:18px}.eyebrow{font-size:11px;letter-spacing:3px;color:#efb66f;text-transform:uppercase}.hero{display:grid;grid-template-columns:1.3fr 1fr;gap:60px;margin:40px 0}h1,h2,h3{font-family:Georgia,serif;font-weight:400}h1{font-size:clamp(42px,5vw,76px);line-height:1.06;letter-spacing:-2px;margin:0 0 25px}h1 em{font-style:normal;color:#efb66f}.hero p{max-width:630px;color:#b6b6a8}.spec{padding:24px;border:1px solid #dfd5ba21;border-radius:20px;background:#232624;align-self:center}.swatches{display:flex;gap:8px;margin:20px 0}.swatches i{height:35px;flex:1;border-radius:8px}.spec strong{font-size:13px}.spec p{font-size:13px;margin:8px 0}.pills{display:flex;gap:10px;flex-wrap:wrap;margin:24px 0}.pills span{border:1px solid #dfd5ba21;border-radius:30px;padding:6px 14px;font-size:12px;color:#c3c3b3}.directions{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}.direction{background:#232624;border:1px solid #dfd5ba21;border-radius:16px;overflow:hidden}.direction button{background:none;border:0;text-align:left;color:inherit;width:100%;padding:0}.direction img{display:block;width:100%}.direction .copy{padding:20px}.direction h3{font-size:27px;margin:0}.direction p{font-size:13px;color:#b6b6a8;margin:8px 0}.direction[aria-current=true]{border-color:#efb66f}.toolbar{position:sticky;top:0;background:#151715f5;backdrop-filter:blur(16px);z-index:4;display:flex;align-items:center;gap:16px;padding:16px 0;margin:48px 0 12px;border-bottom:1px solid #dfd5ba21;flex-wrap:wrap}.tabs{display:flex;background:#232624;border-radius:12px;padding:4px;gap:4px}.tabs button{background:transparent;border:0;color:#b6b6a8;padding:9px 22px;border-radius:9px}.tabs button[aria-pressed=true]{background:#efb66f;color:#261b10}.toolbar input{margin-left:auto;background:#232624;border:1px solid #dfd5ba21;color:#eee4d1;padding:10px 16px;border-radius:10px;min-width:220px}.toolbar select{background:#232624;color:#eee4d1;border:1px solid #dfd5ba21;padding:10px;border-radius:10px}.screen{margin:30px 0 50px;scroll-margin-top:110px}.screen h3{font-size:28px;margin:0}.screen-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.screen-head small{color:#999e90}.pair{display:grid;grid-template-columns:1fr 1fr;gap:14px}.shot{margin:0;border:1px solid #dfd5ba21;border-radius:12px;overflow:hidden;background:#232624}.shot figcaption{font-size:11px;letter-spacing:1.5px;padding:10px 15px;display:flex;justify-content:space-between}.shot a{color:inherit;text-decoration:none}.shot img{display:block;width:100%;aspect-ratio:3/2;object-fit:contain}.note{color:#b6b6a8;font-size:13px}.gallery-intro{max-width:850px}h2{font-size:37px;line-height:1.2;margin-bottom:16px}footer{border-top:1px solid #dfd5ba21;color:#b6b6a8;font-size:12px}.icon-row{display:flex;align-items:center;gap:28px;margin-top:28px}.icon-row img{height:90px;width:90px;object-fit:contain}.icon-row span{font-size:24px;color:#8b9280}.empty{padding:50px;text-align:center;color:#b6b6a8}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #efb66f;outline-offset:4px} @media(max-width:850px){header,main,footer{padding:24px}.hero{grid-template-columns:1fr;gap:12px}.directions{grid-template-columns:1fr}.pair{grid-template-columns:1fr}.toolbar{position:static}.toolbar input{width:100%}}@media print{.toolbar{position:static}.screen{break-inside:avoid}body{background:white;color:black}.shot{border-color:#ccc}}
</style></head><body><header><div class="brand"><img src="../../assets/campfire/icon-512.png" alt="Campfire flame icon"><div><div class="eyebrow">Campfire / design study</div><strong>A place for your people.</strong></div></div><div class="hero"><div><h1>Good company.<br><em>After dark.</em></h1><p>A warm corner of the internet for cold beers, long stories, and the friends who stay for one more. Campfire brings a quieter palette, cream typography, timber accents, and a little firelight.</p><div class="pills"><span>${manifest.screens.length} screen states</span><span>3 complete design directions</span><span>Actual React components</span><span>1440 × 960 captures</span></div><a href="#comparison">Explore the side-by-side comparisons ↓</a></div><aside class="spec"><div class="eyebrow">Selected direction / Ember</div><h2 style="margin-top:12px">Firelight, with room to breathe.</h2><div class="swatches"><i style="background:#1d1f1e"></i><i style="background:#26231f"></i><i style="background:#efb66f"></i><i style="background:#f3eddf"></i><i style="background:#9fb6a0"></i></div><p>Charcoal keeps the chat readable. Timber gives navigation warmth. Amber marks the moments that matter. Serif headings add the feel of an old pub sign.</p><div class="icon-row"><img src="campfire-icon.png" alt="Old Campfire icon"><span>→</span><a href="../../assets/campfire/icon-512.png" download><img src="../../assets/campfire/icon-512.png" alt="Download Campfire icon, 512 by 512"></a><div><strong>The new mark</strong><p>Flame, conversation, company.<br>512 × 512 PNG + desktop ICO.</p></div></div></aside></div></header><main><div class="eyebrow">More ways to gather</div><h2>Three distinct moods. One Campfire.</h2><p class="note">Ember is implemented as the main theme. Canvas and Forest are alternative studies. Choose any direction below to compare every screen with Campfire.</p><div class="directions">${themes.map(([id, title, desc]) => `<article class="direction" data-direction="${id}" aria-current="${id === 'after'}"><button data-theme="${id}"><img src="${id}/chat.png" alt="${title} chat design"><div class="copy"><h3>${title}</h3><p>${desc}</p></div></button></article>`).join('')}</div><p><a href="design-directions.png">Open the nine-example design board</a> · <a href="compare-chat.png">Full-size Ember chat comparison</a> · <a href="compare-auth-login.png">Full-size welcome comparison</a></p><section id="comparison"><h2>Every room, side by side.</h2><p class="note gallery-intro">The same sample people, messages, and window dimensions in every capture. Click an image to inspect it at full resolution. Calls and media use staged content to review their UI.</p><div class="toolbar"><div class="tabs" role="group" aria-label="Design direction">${themes.map(([id, title]) => `<button data-theme="${id}" aria-pressed="${id === 'after'}">${title}</button>`).join('')}</div><select id="group" aria-label="Screen category"><option value="all">All screens</option><option value="chat">Chat & friends</option><option value="settings">Settings & administration</option><option value="dialogs">Dialogs</option><option value="media">Calls & media</option><option value="auth">Welcome & sign-in</option></select><input id="filter" type="search" placeholder="Find a screen…" aria-label="Find a screen"><small id="count"></small></div><div id="screens"></div></section></main><footer><p>Captured from the application with an isolated in-memory API fixture. Original source: ${manifest.baseline}. Browser viewport: 1440 × 960. No personal conversations or production database were used.</p><p>These captures validate appearance. Live camera, screen sharing, audio transport, packaged installers, and OS-native file/source pickers are outside this visual review. Native operating-system dialogs retain the operating system’s appearance.</p></footer><script>
const screens=${JSON.stringify(manifest.screens)},names={after:'Ember',canvas:'Canvas',forest:'Forest'};let theme='after';
function category(id){if(id.startsWith('auth'))return 'auth';if(['call','image','video','crop','invite-call'].includes(id))return 'media';if(id.startsWith('settings')||['registration','channel-editor','channel-delete','role-delete','role-access','account-profile','audio-advanced'].includes(id))return 'settings';if(['chat','attachments','pins','search','thread','dm','friends','requests','friends-empty','toast'].includes(id))return 'chat';return 'dialogs'}
function render(){const q=document.querySelector('#filter').value.toLowerCase(),group=document.querySelector('#group').value;const shown=screens.filter(s=>(!q||s.title.toLowerCase().includes(q))&&(group==='all'||category(s.id)===group));document.querySelector('#count').textContent=shown.length+' / '+screens.length;document.querySelector('#screens').innerHTML=shown.map((s,i)=>'<article class="screen" id="screen-'+s.id+'"><div class="screen-head"><h3>'+s.title+'</h3><small>'+String(i+1).padStart(2,'0')+'</small></div><div class="pair"><figure class="shot"><figcaption><span>BEFORE / CAMPFIRE</span><span>↗ FULL SIZE</span></figcaption><a href="before/'+s.id+'.png" target="_blank"><img loading="lazy" src="before/'+s.id+'.png" alt="Campfire: '+s.title+'"></a></figure><figure class="shot"><figcaption><span>AFTER / CAMPFIRE · '+names[theme].toUpperCase()+'</span><span>↗ FULL SIZE</span></figcaption><a href="'+theme+'/'+s.id+'.png" target="_blank"><img loading="lazy" src="'+theme+'/'+s.id+'.png" alt="Campfire '+names[theme]+': '+s.title+'"></a></figure></div></article>').join('')||'<p class="empty">No matching screens.</p>';document.querySelectorAll('button[data-theme]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.theme===theme)));document.querySelectorAll('[data-direction]').forEach(b=>b.setAttribute('aria-current',String(b.dataset.direction===theme)))}
document.querySelectorAll('button[data-theme]').forEach(b=>b.addEventListener('click',()=>{theme=b.dataset.theme;render()}));document.querySelector('#filter').addEventListener('input',render);document.querySelector('#group').addEventListener('change',render);render();
</script></body></html>`;
await fs.writeFile(`${dir}/index.html`, html);
console.log(
    `Gallery: ${manifest.screens.length} screen states × 3 directions; ${manifest.errors.length} renderer errors.`,
);
