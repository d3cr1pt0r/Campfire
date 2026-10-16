export function rememberedDevice(devices: Pick<MediaDeviceInfo,'deviceId'|'kind'|'label'>[], kind: MediaDeviceKind, id: string, label = '') {
    if (!id || id === 'default' || devices.some(device => device.kind === kind && device.deviceId === id)) return id;
    const matches = devices.filter(device => device.kind === kind && device.label === label && label && !['default','communications'].includes(device.deviceId));
    return matches.length === 1 ? matches[0].deviceId : id;
}
