// Keep app identity stable so replacing a desktop build retains the same user profile.
module.exports = {
    appId: 'org.driskord.desktop',
    productName: 'Campfire',
    directories: { output: 'release' },
    files: [
        'dist/**/*',
        'electron/**/*',
        'package.json',
        '!node_modules/sharp/**/*',
        '!node_modules/@img/**/*',
    ],
    asar: true,
    npmRebuild: false, // The desktop shell uses only Electron/Node built-ins.
    publish: null,
    linux: {
        icon: 'electron/icons/campfire.png',
        target: [
            { target: 'AppImage', arch: ['x64'] },
            { target: 'tar.gz', arch: ['x64'] },
        ],
        executableName: 'driskord',
        category: 'Network',
        artifactName: 'Campfire-${version}-linux-${arch}.${ext}',
    },
    win: {
        icon: 'electron/icons/campfire.ico',
        target: [{ target: 'portable', arch: ['x64'] }],
        artifactName: 'Campfire-${version}-${arch}-Portable.${ext}',
    },
};
