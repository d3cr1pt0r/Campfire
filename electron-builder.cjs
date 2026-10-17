// Keep app identity stable so replacing the portable EXE retains the same user profile.
module.exports = {
    appId: 'org.driskord.desktop',
    productName: 'Driskord',
    directories: { output: 'release' },
    files: ['dist/**/*', 'electron/**/*', 'package.json'],
    asar: true,
    npmRebuild: false, // The desktop shell uses only Electron/Node built-ins.
    publish: null,
    win: {
        target: [{ target: 'portable', arch: ['x64'] }],
        artifactName: 'Driskord-${version}-${arch}-Portable.${ext}',
    },
};
