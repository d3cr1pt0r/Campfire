// Keep installer identity stable so later versions upgrade the same app.
module.exports = {
  appId: 'org.driskord.desktop',
  productName: 'Driskord',
  directories: { output: 'release' },
  files: ['dist/**/*', 'electron/**/*', 'package.json'],
  asar: true,
  npmRebuild: false, // The desktop shell uses only Electron/Node built-ins.
  publish: null,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: 'Driskord-${version}-${arch}-Setup.${ext}',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false,
  },
};
