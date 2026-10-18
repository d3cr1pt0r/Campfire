import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { MediaTile } from '../src/MediaTile';
import '../src/style.css';
import '../src/campfire-theme.css';

const streams = ['#d2824b', '#417d91'].map((color, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d')!;
    let frame = 0;
    setInterval(() => {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1280, 720);
        ctx.fillStyle = '#fff';
        ctx.font = '48px sans-serif';
        ctx.fillText(`Participant ${index + 1} · frame ${++frame}`, 80, 360);
    }, 50);
    return canvas.captureStream(20);
});
function Fixture() {
    const [members, setMembers] = useState([true, true]);
    const [sharing, setSharing] = useState([true, true]);
    const [watching, setWatching] = useState([false, false]);
    Object.assign(window, { fixture: { setMembers, setSharing } });
    return (
        <div style={{ display: 'flex', gap: 20, padding: 40 }}>
            {members.map(
                (present, i) =>
                    present && (
                        <div key={i} style={{ width: 440, height: 300 }}>
                            <MediaTile
                                stream={streams[i]}
                                name={`Participant ${i + 1}`}
                                sharing={sharing[i]}
                                watching={watching[i]}
                                onWatch={(enabled) =>
                                    setWatching((old) => old.map((v, n) => (n === i ? enabled : v)))
                                }
                            />
                        </div>
                    ),
            )}
        </div>
    );
}
document.documentElement.dataset.theme = 'ember';
createRoot(document.getElementById('root')!).render(<Fixture />);
