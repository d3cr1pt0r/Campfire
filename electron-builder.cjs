// Use the Campfire identity consistently across desktop builds.
module.exports = {
    appId: 'org.campfire.desktop',
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
        executableName: 'campfire',
        category: 'Network',
        artifactName: 'Campfire-${version}-linux-${arch}.${ext}',
    },
    win: {
        icon: 'electron/icons/campfire.ico',
        target: [{ target: 'portable', arch: ['x64'] }],
        artifactName: 'Campfire-${version}-${arch}-Portable.${ext}',
    },
};
