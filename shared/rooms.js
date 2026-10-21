// A DM has one identity regardless of which participant opens it first.
export function canonicalRoom(room) {
    if (typeof room !== 'string') return '';
    const parts = room.split(':');
    return parts.length === 3 && parts[0] === 'dm' ? `dm:${parts.slice(1).sort().join(':')}` : room;
}

// The other endpoint is the same account for a personal DM.
export function dmParticipant(room, userId) {
    if (typeof room !== 'string') return null;
    const parts = room.split(':');
    if (parts.length !== 3 || parts[0] !== 'dm' || !parts[1] || !parts[2]) return null;
    return parts[1] === userId ? parts[2] : parts[2] === userId ? parts[1] : null;
}
