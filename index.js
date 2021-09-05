require('@electron/remote/main').initialize()

// Requirements
const { app, BrowserWindow, ipcMain, Menu, Tray, dialog } = require('electron')
const { autoUpdater }               = require('@imjs/electron-differential-updater')
const ejse                          = require('ejs-electron')
const fs                            = require('fs')
const isDev                         = require('./app/assets/js/isdev')
const path                          = require('path')
const semver                        = require('semver')
const { pathToFileURL }             = require('url')
const url                           = require('url')
const child_process                 = require('child_process')
const DecompressZip = require('decompress-zip')


const redirectUriPrefix = 'https://login.microsoftonline.com/common/oauth2/nativeclient?'
const CLIENT_ID = 'd23ff5a0-2a35-43f5-b3e9-d26e37a913a7'
/*const unhandled                     = require('electron-unhandled')
const {openNewGitHubIssue, debugInfo} = require('electron-util')

unhandled({
    reportButton: error => {
        openNewGitHubIssue({
            user: 'Songs-of-War',
            repo: 'Songs-of-War-Launcher',
            body: `\`\`\`\n${error.stack}\n\`\`\`\n\n---\n\n${debugInfo()}`
        })
    },
    showDialog: true
})*/

let nextAppVersion = null

let myWindow = null

let updateWin

let isOnMainUpdateScreen = false

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
    app.quit()
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, we should focus our window.
        if (myWindow) {
            if (myWindow.isMinimized()) myWindow.restore()
            myWindow.focus()
        }
    })

    // Start checking for updates screen

    app.on('ready', async () => {
        updateWin = new BrowserWindow({
            darkTheme: true,
            width: 400,
            height: 300,
            icon: getPlatformIcon('SealCircle'),
            frame: false,
            resizable: true,
            fullscreenable: false,
            simpleFullscreen: false,
            fullscreen: false,
            maximizable: false,
            closable: false,
            webPreferences: {
                devTools: false,
                nodeIntegration: true,
                contextIsolation: false,
                enableRemoteModule: true,
                worldSafeExecuteJavaScript: true,

            },
            backgroundColor: '#171614'
        })

        updateWin.loadURL(url.format({
            pathname: path.join(__dirname, 'app', 'updatecheck.ejs'),
            protocol: 'file:',
            slashes: true
        }))


        ipcMain.on('updateDownloadStatusUpdate', async (event, args) => {
            if(args === 'readyToStartUpdate') {
                console.log('Ready for update')

                // Setup events

                // https://github.com/lucasboss45/Songs-Of-War-Launcher/releases/download/v${info.version}/Songs-of-War-Launcher-setup-${info.version}.dmg

                // Shitty mac "support", I am not paying apple for a certificate
                /*autoUpdater.on('update-available', (info) => {
                    if(process.platform === 'darwin') {
                        dialog.showMessageBox(updateWin, {
                            title: 'An update is available but...',
                            detail: 'The program cannot automatically update on MacOS (unless we pay money to apple), please do so manually. \n\nPressing "OK" will open a browser tab to download it.',
                            type: 'error'
                        }).then(buttonid => {
                            shell.openExternal(`https://github.com/Songs-of-War/Songs-Of-War-Launcher/releases/download/v${info.version}/Songs-of-War-Game-mac-${info.version}.dmg`)
                            app.exit()
                        })
                    }
                })*/

                autoUpdater.on('update-available', update => {
                    console.log('New update: ' + update.version)
                    nextAppVersion = update.version
                })

                autoUpdater.on('download-progress', (progress) => {
                    console.log('Downloading progress ' + progress.percent)
                    event.sender.send('updateDownloadStatusUpdate', 'downloading', progress.percent)
                })

                autoUpdater.on('update-not-available', (info) => {
                    if(isOnMainUpdateScreen) {
                        createWindow()
                        createMenu()
                        autoUpdater.removeAllListeners(event)
                        isOnMainUpdateScreen = false
                        updateWin.destroy()
                    }
                })

                autoUpdater.on('update-downloaded', (info) => {
                    if (isOnMainUpdateScreen) {
                        autoUpdater.quitAndInstall(false, true)
                        app.exit(0)
                    }
                })

                autoUpdater.on('error', args => {
                    // Our CI is still generating artifacts for this platform, we have to wait that this is done before forcing an update
                    if(/Error: could not find .*\.\w in the latest release artifacts/gm.test(args.toString())) {
                        if(isOnMainUpdateScreen) {
                            // Here we just launch the program if the update on the CI isn't complete yet
                            createWindow()
                            createMenu()
                            autoUpdater.removeAllListeners(event)
                            isOnMainUpdateScreen = false
                            updateWin.destroy()
                        }
                    } else if(args == 'Configuring update for differential download. Please try after some time') {
                        setTimeout(async () => {
                            await autoUpdater.checkForUpdates()
                        }, 2000)
                        return
                    } else if(args == 'Error: Could not get code signature for running application') {
                        // We just ignore that error and use my own install script
                        if(isOnMainUpdateScreen) {
                            if(process.platform === 'darwin') {
                                process.noAsar = true // https://stackoverflow.com/a/44611396

                                let file = `${autoUpdater.getAppSupportCacheDir()}/../Caches/Songs of War Game/pending/Songs-of-War-Game-mac-${nextAppVersion}.zip`
                                let extractPath = '/Applications/SoWTempInstall'

                                const fs = require('fs')
                                fs.rmdirSync(extractPath, {
                                    force: true,
                                    recursive: true,
                                })

                                const unzip = new DecompressZip(file)

                                unzip.on('progress', (index, files) => {
                                    console.log(`${index} / ${files} - ${(index/files)*100}`)
                                    event.sender.send('updateDownloadStatusUpdate', 'extracting', (index / files) * 100)
                                })

                                unzip.on('error', e => {
                                    console.error(e)
                                })

                                // When it's done extracting
                                unzip.on('extract', async () => {
                                    process.noAsar = false
                                    //const sudoprompt = require('sudo-prompt')

                                    // Just as a precaution
                                    child_process.execSync('chmod +x "' + path.join(__dirname, 'app', 'assets', 'updateMac.sh') + '"')
                                    // Shitty shell script to install the new version on Mac
                                    child_process.spawn(`${path.join(__dirname, 'app', 'assets', 'updateMac.sh')}`, { detached: true }, function(err, stdout, stderr) {
                                        console.log(stdout)
                                    })

                                    app.exit(0)

                                })

                                unzip.extract({
                                    path: extractPath,
                                    restrict: false
                                })

                                return
                            }
                        }
                        return
                    }

                    dialog.showMessageBox(updateWin, {
                        title: 'Update check failed',
                        detail: 'The update checking failed, the program cannot proceed, please check your network connection.\n\n' + args.toString(),
                        type: 'error',
                        cancelId: 0,
                        defaultId: 0,
                    }).then(buttonPressed => {
                        app.exit()
                    })
                })


                // Check the updates after the events have been registered


                await autoUpdater.checkForUpdates()
            }

        })

        isOnMainUpdateScreen = true

    })



    // Create myWindow, load the rest of the app, etc...
    //app.on('ready', createWindow)
    //app.on('ready', createMenu)
}

// Setup auto updater.
function initAutoUpdater(event, data) {


    autoUpdater.allowPrerelease = false
    autoUpdater.autoInstallOnAppQuit = false
    
    if(isDev){
        autoUpdater.autoInstallOnAppQuit = false
        autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml')
    }
    if (process.platform === 'darwin') {
        autoUpdater.autoDownload = false
        autoUpdater.autoInstallOnAppQuit = false
    }
    autoUpdater.on('update-available', (info) => {
        event.sender.send('autoUpdateNotification', 'update-available', info)
        if(process.platform === 'win32') {
            console.log('New update available, sending Balloon');
            (async () => {
                const TrayBallon = new Tray(path.join(__dirname, '/app/assets/images/icon.png'))
                console.log('Waiting 5 seconds')
                setTimeout(function() {
                    TrayBallon.displayBalloon({
                        title: 'New update available for download',
                        content: 'A new update for the launcher is available! You should download it!',
                        icon: path.join(__dirname, '/app/assets/images/icon.png')
                    })
                    console.log('Sent balloon notification')
                    TrayBallon.once('balloon-closed', () => {
                        TrayBallon.destroy()
                    })
                }, 5000)
            })()

            /*TrayBallon.on('balloon-closed', () => {
                TrayBallon.destroy()
            })*/
        }
    })

    autoUpdater.on('download-progress', (progress) => {
        event.sender.send('updateDownloadStatusUpdate', 'downloading', progress.percent)
    })

    autoUpdater.on('update-downloaded', (info) => {
        event.sender.send('autoUpdateNotification', 'update-downloaded', info)
        if(process.platform === 'win32') {
            console.log('New update ready, sending Balloon');
            (async () => {
                const TrayBallon = new Tray(path.join(__dirname, '/app/assets/images/icon.png'))
                console.log('Waiting 5 seconds')
                setTimeout(function() {
                    TrayBallon.displayBalloon({
                        title: 'New update ready',
                        content: 'A new update for the launcher is ready for installation!',
                        icon: path.join(__dirname, '/app/assets/images/icon.png')
                    })
                    console.log('Sent balloon notification')
                    TrayBallon.once('balloon-closed', () => {
                        TrayBallon.destroy()
                    })
                }, 5000)
            })()
        }
    })
    autoUpdater.on('update-not-available', (info) => {
        if(isOnMainUpdateScreen) {
            createWindow()
            createMenu()
            isOnMainUpdateScreen = false
            updateWin.destroy()
        }
        event.sender.send('autoUpdateNotification', 'update-not-available', info)
    })
    autoUpdater.on('checking-for-update', () => {
        event.sender.send('autoUpdateNotification', 'checking-for-update')
    })
    autoUpdater.on('error', (err) => {
        event.sender.send('autoUpdateNotification', 'realerror', err)
    })
}

// Open channel to listen for update actions.
ipcMain.on('autoUpdateAction', (event, arg, data) => {
    switch (arg) {
        case 'initAutoUpdater':
            console.log('Initializing auto updater.')
            initAutoUpdater(event, data)
            event.sender.send('autoUpdateNotification', 'ready')
            break
        case 'checkForUpdate':
            autoUpdater.checkForUpdates()
                .catch(err => {
                    event.sender.send('autoUpdateNotification', 'realerror', err)
                })
            break
        case 'allowPrereleaseChange':
            if (!data) {
                const preRelComp = semver.prerelease(app.getVersion())
                if(preRelComp != null && preRelComp.length > 0){
                    autoUpdater.allowPrerelease = false
                } else {
                    autoUpdater.allowPrerelease = data
                }
            } else {
                autoUpdater.allowPrerelease = data
            }
            break
        case 'installUpdateNow':
            autoUpdater.quitAndInstall()
            break
        default:
            console.log('Unknown argument', arg)
            break
    }
})
// Redirect distribution index event from preloader to renderer.
ipcMain.on('distributionIndexDone', (event, res) => {
    event.sender.send('distributionIndexDone', res)
})

// Disable hardware acceleration.
// https://electronjs.org/docs/tutorial/offscreen-rendering
app.disableHardwareAcceleration()

let MSALoginWindow

// Open the Microsoft Account Login window
ipcMain.on('openMSALoginWindow', (ipcEvent) => {
    if (MSALoginWindow) {
        ipcEvent.reply('MSALoginWindowReply', 'error', 'AlreadyOpenException')
        return
    }
    MSALoginWindow = new BrowserWindow({
        title: 'Microsoft Login',
        backgroundColor: '#222222',
        width: 520,
        height: 600,
        frame: true,
        icon: getPlatformIcon('SealCircle')
    })

    MSALoginWindow.on('closed', () => {
        MSALoginWindow = undefined
    })

    MSALoginWindow.on('close', () => {
        ipcEvent.reply('MSALoginWindowReply', 'error', 'AuthNotFinished')
    })

    MSALoginWindow.webContents.on('did-navigate', (_, uri) => {
        if (uri.startsWith(redirectUriPrefix)) {
            let queries = uri.substring(redirectUriPrefix.length).split('#', 1).toString().split('&')
            let queryMap = new Map()

            queries.forEach(query => {
                const [name, value] = query.split('=')
                queryMap.set(name, decodeURI(value))
            })

            ipcEvent.reply('MSALoginWindowReply', queryMap)

            MSALoginWindow.close()
            MSALoginWindow = null
        }
    })

    MSALoginWindow.removeMenu()
    MSALoginWindow.loadURL('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?prompt=select_account&client_id=' + CLIENT_ID + '&response_type=code&scope=XboxLive.signin%20offline_access&redirect_uri=https://login.microsoftonline.com/common/oauth2/nativeclient')
})

let MSALogoutWindow

ipcMain.on('openMSALogoutWindow', (ipcEvent) => {
    if (!MSALogoutWindow) {
        MSALogoutWindow = new BrowserWindow({
            title: 'Microsoft Logout',
            backgroundColor: '#222222',
            width: 520,
            height: 600,
            frame: true,
            icon: getPlatformIcon('SealCircle')
        })
        MSALogoutWindow.removeMenu()
        MSALogoutWindow.loadURL('https://login.microsoftonline.com/common/oauth2/v2.0/logout')
        MSALogoutWindow.webContents.on('did-navigate', () => {
            setTimeout(() => {
                ipcEvent.reply('MSALogoutWindowReply')
            }, 5000)
        })
    }
})

// https://github.com/electron/electron/issues/18397
app.allowRendererProcessReuse = true

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win

async function createWindow() {


    win = new BrowserWindow({
        darkTheme: true,
        width: 980,
        height: 552,
        icon: getPlatformIcon('SealCircle'),
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'app', 'assets', 'js', 'preloader.js'),
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        },
        backgroundColor: '#171614'
    })

    //win.webContents.openDevTools();

    console.log(path.join(__dirname, 'app', 'assets', 'js', 'preloader.js').toString())

    myWindow = win

    ejse.data('bkid', Math.floor((Math.random() * fs.readdirSync(path.join(__dirname, 'app', 'assets', 'images', 'backgrounds')).length)))

    win.loadURL(pathToFileURL(path.join(__dirname, 'app', 'app.ejs')).toString())



    /*win.once('ready-to-show', () => {
        win.show()
    })*/

    win.removeMenu()

    win.resizable = true

    win.on('closed', () => {
        win = null
    })

}

// eslint-disable-next-line no-unused-vars
function createMenu() {

    if (process.platform === 'darwin') {

        // Extend default included application menu to continue support for quit keyboard shortcut
        let applicationSubMenu = {
            label: 'Application',
            submenu: [{
                label: 'About Application',
                selector: 'orderFrontStandardAboutPanel:'
            }, {
                type: 'separator'
            }, {
                label: 'Quit',
                accelerator: 'Command+Q',
                click: () => {
                    app.quit()
                }
            }]
        }

        // New edit menu adds support for text-editing keyboard shortcuts
        let editSubMenu = {
            label: 'Edit',
            submenu: [{
                label: 'Undo',
                accelerator: 'CmdOrCtrl+Z',
                selector: 'undo:'
            }, {
                label: 'Redo',
                accelerator: 'Shift+CmdOrCtrl+Z',
                selector: 'redo:'
            }, {
                type: 'separator'
            }, {
                label: 'Cut',
                accelerator: 'CmdOrCtrl+X',
                selector: 'cut:'
            }, {
                label: 'Copy',
                accelerator: 'CmdOrCtrl+C',
                selector: 'copy:'
            }, {
                label: 'Paste',
                accelerator: 'CmdOrCtrl+V',
                selector: 'paste:'
            }, {
                label: 'Select All',
                accelerator: 'CmdOrCtrl+A',
                selector: 'selectAll:'
            }]
        }

        // Bundle submenus into a single template and build a menu object with it
        let menuTemplate = [applicationSubMenu, editSubMenu]
        let menuObject = Menu.buildFromTemplate(menuTemplate)

        // Assign it to the application
        Menu.setApplicationMenu(menuObject)

    }

}

function getPlatformIcon(filename) {
    let ext
    switch (process.platform) {
        case 'win32':
            ext = 'ico'
            break
        case 'darwin':
        case 'linux':
        default:
            ext = 'png'
            break
    }

    return path.join(__dirname, 'app', 'assets', 'images', `${filename}.${ext}`)
}



app.on('window-all-closed', () => {
    app.quit()
})

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win === null) {
        createWindow()
    }
})