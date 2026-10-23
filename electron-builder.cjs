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
    npmRebuild: false, // Packaged desktop dependencies do not need native rebuilding.
    publish: { provider: 'github', owner: 'd3cr1pt0r', repo: 'Campfire', releaseType: 'draft' },
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
    nsis: { oneClick: true, perMachine: false, deleteAppDataOnUninstall: false },
    portable: { artifactName: 'Campfire-${version}-${arch}-Portable.${ext}' },
    win: {
        icon: 'electron/icons/campfire.ico',
        target: [
            { target: 'nsis', arch: ['x64'] },
            { target: 'portable', arch: ['x64'] },
        ],
        artifactName: 'Campfire-${version}-${arch}-Setup.${ext}',
    },
};
