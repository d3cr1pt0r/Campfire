// A DM has one identity regardless of which participant opens it first.
export function canonicalRoom(room) {
    if (typeof room !== 'string') return '';
    const parts = room.split(':');
    return parts.length === 3 && parts[0] === 'dm' ? `dm:${parts.slice(1).sort().join(':')}` : room;
}
