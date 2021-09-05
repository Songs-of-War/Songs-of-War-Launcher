/**
 * Script for landing.ejs
 */
// Requirements
const cp                      = require('child_process')
const crypto                  = require('crypto')
const {URL}                   = require('url')
const fs                      = require('fs')
const got = require('got')
const { app, ipcMain, electron, Main} = require('electron')

// Internal Requirements
const DiscordWrapper          = require('./assets/js/discordwrapper')
const Mojang                  = require('./assets/js/mojang')
const ProcessBuilder          = require('./assets/js/processbuilder')
const ServerStatus            = require('./assets/js/serverstatus')
// Launch Elements
const launch_content          = document.getElementById('launch_content')
const launch_details          = document.getElementById('launch_details')
const launch_progress         = document.getElementById('launch_progress')
const launch_progress_label   = document.getElementById('launch_progress_label')
const launch_details_text     = document.getElementById('launch_details_text')
const server_selection_button = document.getElementById('server_selection_button')
const user_text               = document.getElementById('user_text')

// Variable for checking if the user joined the server
let joinedServer = false

// Variable for checking if people launched the game
let GameInstanceStarted = false

let TrayObject

let WindowHidden = false

const loggerLanding = LoggerUtil('%c[Landing]', 'color: #000668; font-weight: bold')

/* Launch Progress Wrapper Functions */

/**
 * Show/hide the loading area.
 * 
 * @param {boolean} loading True if the loading area should be shown, otherwise false.
 */
function toggleLaunchArea(loading){
    if(loading){
        launch_details.style.display = 'flex'
        launch_content.style.display = 'none'
    } else {
        launch_details.style.display = 'none'
        launch_content.style.display = 'inline-flex'
    }
}

/**
 * Set the details text of the loading area.
 * 
 * @param {string} details The new text for the loading details.
 */
function setLaunchDetails(details){
    launch_details_text.innerHTML = details
}

/**
 * Set the value of the loading progress bar and display that value.
 * 
 * @param {number} value The progress value.
 * @param {number} max The total size.
 * @param {number|string} percent Optional. The percentage to display on the progress label.
 */
function setLaunchPercentage(value, max, percent = ((value/max)*100)){
    launch_progress.setAttribute('max', max)
    launch_progress.setAttribute('value', value)
    launch_progress_label.innerHTML = percent + '%'
}

/**
 * Set the value of the OS progress bar and display that on the UI.
 * 
 * @param {number} value The progress value.
 * @param {number} max The total download size.
 * @param {number|string} percent Optional. The percentage to display on the progress label.
 */
function setDownloadPercentage(value, max, percent = ((value/max)*100)){
    remote.getCurrentWindow().setProgressBar(value/max)
    setLaunchPercentage(value, max, percent)
}

/**
 * Enable or disable the launch button.
 * 
 * @param {boolean} val True to enable, false to disable.
 */
function setLaunchEnabled(val){
    document.getElementById('launch_button').disabled = !val
    document.getElementById('server_selection_button').disabled = !val
}

// Bind launch button
document.getElementById('launch_button').addEventListener('click', function(e){
    loggerLanding.log('Launching game..')
    DiscordWrapper.updateDetails('Preparing to launch...', new Date().getTime())


    const mcVersion = DistroManager.getDistribution().getServer(ConfigManager.getSelectedServer()).getMinecraftVersion()
    const jExe = ConfigManager.getJavaExecutable()
    if(jExe == null){
        asyncSystemScan(mcVersion)
    } else {

        setLaunchDetails(Lang.queryJS('landing.launch.pleaseWait'))
        toggleLaunchArea(true)
        setLaunchPercentage(0, 100)

        const jg = new JavaGuard(mcVersion)
        jg._validateJavaBinary(jExe).then((v) => {
            loggerLanding.log('Java version meta', v)
            if(v.valid){
                dlAsync()
            } else {
                asyncSystemScan(mcVersion)
            }
        })
    }
})

// Bind settings button
document.getElementById('settingsMediaButton').onclick = (e) => {
    prepareSettings()
    switchView(getCurrentView(), VIEWS.settings)
}

// Bind screnshots button
document.getElementById('screenshotsMediaButton').onclick = (e) => {
    const screenshotsPath = path.join(ConfigManager.getInstanceDirectory(), DistroManager.getDistribution().getServer(ConfigManager.getSelectedServer()).getID(), 'screenshots')

    if(fs.existsSync(screenshotsPath)) {
        shell.openPath(screenshotsPath)
    } else {
        setOverlayContent(
            'File Error',
            'The screenshots folder could not be found. Try taking your first screenshot before attempting to open it.',
            'Okay'
        )
        setOverlayHandler(null)
        toggleOverlay(true)
    }
}


// Bind avatar overlay button.
document.getElementById('avatarOverlay').onclick = (e) => {
    prepareSettings()
    switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {
        settingsNavItemListener(document.getElementById('settingsNavAccount'), false)
    })
}

// Bind selected account
function updateSelectedAccount(authUser){
    let username = 'No Account Selected'
    if(authUser != null){
        if(authUser.displayName != null){
            username = authUser.displayName
        }
        if(authUser.uuid != null){
            document.getElementById('avatarContainer').style.backgroundImage = `url('https://crafatar.com/renders/body/${authUser.uuid}?overlay')`
        }
    }
    user_text.innerHTML = username
}
updateSelectedAccount(ConfigManager.getSelectedAccount())

// Bind selected server
function updateSelectedServer(serv){
    if(getCurrentView() === VIEWS.settings){
        saveAllModConfigurations()
    }
    ConfigManager.setSelectedServer(serv != null ? serv.getID() : null)
    ConfigManager.save()
    server_selection_button.innerHTML = '\u2022 ' + (serv != null ? serv.getName() : 'No Server Selected')
    if(getCurrentView() === VIEWS.settings){
        animateModsTabRefresh()
    }
    setLaunchEnabled(serv != null)
}
// Real text is set in uibinder.js on distributionIndexDone.
server_selection_button.innerHTML = '\u2022 Loading..'
server_selection_button.onclick = (e) => {
    e.target.blur()
    toggleServerSelection(true)
}

// Update Mojang Status Color
const refreshMojangStatuses = async function(){
    loggerLanding.log('Refreshing Mojang Statuses..')

    let status = 'grey'
    let tooltipEssentialHTML = ''
    let tooltipNonEssentialHTML = ''

    try {
        const statuses = await Mojang.status()
        greenCount = 0
        greyCount = 0

        for(let i=0; i<statuses.length; i++){
            const service = statuses[i]

            if(service.essential){
                tooltipEssentialHTML += `<div class="mojangStatusContainer">
                    <span class="mojangStatusIcon" style="color: ${Mojang.statusToHex(service.status)};">&#8226;</span>
                    <span class="mojangStatusName">${service.name}</span>
                </div>`
            } else {
                tooltipNonEssentialHTML += `<div class="mojangStatusContainer">
                    <span class="mojangStatusIcon" style="color: ${Mojang.statusToHex(service.status)};">&#8226;</span>
                    <span class="mojangStatusName">${service.name}</span>
                </div>`
            }

            if(service.status === 'yellow' && status !== 'red'){
                status = 'yellow'
            } else if(service.status === 'red'){
                status = 'red'
            } else {
                if(service.status === 'grey'){
                    ++greyCount
                }
                ++greenCount
            }

        }

        if(greenCount === statuses.length){
            if(greyCount === statuses.length){
                status = 'grey'
            } else {
                status = 'green'
            }
        }

    } catch (err) {
        loggerLanding.warn('Unable to refresh Mojang service status.')
        loggerLanding.debug(err)
    }
    
    document.getElementById('mojangStatusEssentialContainer').innerHTML = tooltipEssentialHTML
    document.getElementById('mojangStatusNonEssentialContainer').innerHTML = tooltipNonEssentialHTML
    document.getElementById('mojang_status_icon').style.color = Mojang.statusToHex(status)
}

const refreshServerStatus = async function(fade = false){
    loggerLanding.log('Refreshing Server Status')
    const serv = DistroManager.getDistribution().getServer(ConfigManager.getSelectedServer())

    let pLabel = 'SERVER'
    let pVal = 'OFFLINE'

    try {
        const serverURL = new URL('my://' + serv.getAddress())
        const servStat = await ServerStatus.getStatus(serverURL.hostname, serverURL.port)
        if(servStat.online){
            pLabel = 'PLAYERS'
            pVal = servStat.onlinePlayers + '/' + servStat.maxPlayers
            DiscordWrapper.updatePartySize(parseInt(servStat.onlinePlayers), parseInt(servStat.maxPlayers))
        }

    } catch (err) {
        loggerLanding.warn('Unable to refresh server status, assuming offline. ' + err)
    }
    if(fade){
        $('#server_status_wrapper').fadeOut(250, () => {
            document.getElementById('landingPlayerLabel').innerHTML = pLabel
            document.getElementById('player_count').innerHTML = pVal
            $('#server_status_wrapper').fadeIn(500)
        })
    } else {
        document.getElementById('landingPlayerLabel').innerHTML = pLabel
        document.getElementById('player_count').innerHTML = pVal
    }
    
}


let responsecache
const refreshRPC = async function() {

    if(!joinedServer) return


    // Grab hyphenated UUID
    let uuid = ConfigManager.getSelectedAccount().uuid
    uuid = uuid.substring(0, 8) + '-' + uuid.substring(8, 12) + '-' + uuid.substring(12, 16) + '-' + uuid.substring(16, 20) + '-' + uuid.substring(20, 32)
    if(uuid.length !== 36) {return}

    try {
        // Call API
        let response = await got('https://mysql.songs-of-war.com/api/index.php?PlayerUUID=' + uuid)
        response = await JSON.parse(response.body)
        if(response === responsecache) return
        responsecache = response

        if(response.message === 'success') {
            // Set OC
            let imageKey = response.Species
            let species = response.Species
            if(typeof response.Clan === 'string') {
                imageKey += '_' + response.Clan
                species = response.Clan
            }
            imageKey = imageKey.toLowerCase()
            if(response.Name !== null) {
                DiscordWrapper.updateOC(response.Name, species, imageKey)
            }

            // Set location
            if(typeof response.CurrentPosition === 'string') {
                DiscordWrapper.updateDetails('In ' + response.CurrentPosition)

            } else {
                //Check if user left server, since there is no way to do it through the minecraft logs this will have to do.
                if(joinedServer) {
                    joinedServer = false
                    DiscordWrapper.updateDetails('In the main menu', new Date().getTime())
                    DiscordWrapper.resetOC()
                }
            }


        }
    } catch(error) {
        return
    }
}

refreshMojangStatuses()
// Server Status is refreshed in uibinder.js on distributionIndexDone.

// Set refresh rate to once every 5 minutes.
//let mojangStatusListener = setInterval(() => refreshMojangStatuses(true), 300000)
// Set refresh rate to once every minute since it is required for rich presence we refresh this one faster.
let serverStatusListener = setInterval(() => refreshServerStatus(true), 60000)
// Set refresh rate to every 15 seconds.
let APIPlayerInfoListener = setInterval(() => refreshRPC(true), 15000)

/**
 * Shows an error overlay, toggles off the launch area.
 * 
 * @param {string} title The overlay title.
 * @param {string} desc The overlay description.
 */
function showLaunchFailure(title, desc){
    setOverlayContent(
        title,
        desc,
        'Okay'
    )
    setOverlayHandler(null)
    toggleOverlay(true)
    toggleLaunchArea(false)
}

/**
 * Shows a non closable overlay
 *
 * @param {string} title The overlay title.
 * @param {string} desc The overlay description.
 */
function showNotClosableMessage(title, desc){
    setOverlayContentNoButton(
        title,
        desc,
    )
    setOverlayHandler(null)
    toggleOverlay(true)
    toggleLaunchArea(false)
}

/* System (Java) Scan */

let sysAEx
let scanAt

let extractListener

/**
 * Asynchronously scan the system for valid Java installations.
 * 
 * @param {string} mcVersion The Minecraft version we are scanning for.
 * @param {boolean} launchAfter Whether we should begin to launch after scanning. 
 */
function asyncSystemScan(mcVersion, launchAfter = true){

    setLaunchDetails('Please wait..')
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    const loggerSysAEx = LoggerUtil('%c[SysAEx]', 'color: #353232; font-weight: bold')

    const forkEnv = JSON.parse(JSON.stringify(process.env))
    forkEnv.CONFIG_DIRECT_PATH = ConfigManager.getLauncherDirectory()

    compMode = compatibility.isCompatibilityEnabled()
    let p2 = compatibility.getExpectedJava8UpdateRevision()
    let p3 = compatibility.getStandardOSManifestLink()




    // Fork a process to run validations.
    sysAEx = cp.fork(path.join(__dirname, 'assets', 'js', 'assetexec.js'), [
        'JavaGuard',
        mcVersion,
        compMode,
        p2,
        p3
    ], {
        env: forkEnv,
        stdio: 'pipe'
    })
    // Stdout
    sysAEx.stdio[1].setEncoding('utf8')
    sysAEx.stdio[1].on('data', (data) => {
        loggerSysAEx.log(data)
    })
    // Stderr
    sysAEx.stdio[2].setEncoding('utf8')
    sysAEx.stdio[2].on('data', (data) => {
        loggerSysAEx.log(data)
    })
    
    sysAEx.on('message', (m) => {

        if(m.context === 'validateJava'){
            if(m.result == null){
                // If the result is null, no valid Java installation was found.
                // Show this information to the user.
                if(compatibility.isCompatibilityEnabled()) {
                    // Disallow the manual install of a java version as it requires the mojang specific one which I doubt anyone cares / knows about.
                    // If the user tries to install a java version themselves anyway it will fail as it will be detected as an invalid version.
                    setOverlayContent(
                        'No Compatible<br>Java Installation Found',
                        'In order to join Songs of War, you need a 64-bit installation of Java 8. Would you like us to install a copy? By installing, you accept <a href="http://www.oracle.com/technetwork/java/javase/terms/license/index.html">Oracle\'s license agreement</a>. Warning! You are in compatibility mode, you cannot install one manually.',
                        'Install Java'
                    )
                } else {
                    setOverlayContent(
                        'No Compatible<br>Java Installation Found',
                        'In order to join Songs of War, you need a 64-bit installation of Java 8. Would you like us to install a copy? By installing, you accept <a href="http://www.oracle.com/technetwork/java/javase/terms/license/index.html">Oracle\'s license agreement</a>.',
                        'Install Java',
                        'Install Manually'
                    )
                }

                setOverlayHandler(() => {
                    setLaunchDetails('Preparing Java Download..')
                    sysAEx.send({task: 'changeContext', class: 'AssetGuard', args: [ConfigManager.getCommonDirectory(),ConfigManager.getJavaExecutable()]})
                    sysAEx.send({task: 'execute', function: '_enqueueOpenJDK', argsArr: [ConfigManager.getDataDirectory()]})
                    toggleOverlay(false)
                })
                setDismissHandler(() => {
                    $('#overlayContent').fadeOut(250, () => {
                        //$('#overlayDismiss').toggle(false)
                        setOverlayContent(
                            'Java is Required<br>to Launch',
                            'A valid x64 installation of Java 8 is required to launch.',
                            'I Understand',
                            'Go Back'
                        )
                        setOverlayHandler(() => {
                            toggleLaunchArea(false)
                            toggleOverlay(false)
                        })
                        setDismissHandler(() => {
                            toggleOverlay(false, true)
                            asyncSystemScan()
                        })
                        $('#overlayContent').fadeIn(250)
                    })
                })
                toggleOverlay(true, true)

            } else {
                // Java installation found, use this to launch the game.
                ConfigManager.setJavaExecutable(m.result)
                ConfigManager.save()

                // We need to make sure that the updated value is on the settings UI.
                // Just incase the settings UI is already open.
                settingsJavaExecVal.value = m.result
                populateJavaExecDetails(settingsJavaExecVal.value)

                if(launchAfter){
                    dlAsync()
                }
                sysAEx.disconnect()
            }
        } else if(m.context === '_enqueueOpenJDK'){

            console.log(m.result)

            if(m.result === true){

                // Oracle JRE enqueued successfully, begin download.
                setLaunchDetails('Downloading Java..')
                sysAEx.send({task: 'execute', function: 'processDlQueues', argsArr: [[{id:'java', limit:1}]]})

            } else {

                // Oracle JRE enqueue failed. Probably due to a change in their website format.
                // User will have to follow the guide to install Java.
                setOverlayContent(
                    'Unexpected Issue:<br>Java Download Failed',
                    'Unfortunately we\'ve encountered an issue while attempting to install Java. You will need to manually install a copy.',
                    'I Understand'
                )
                setOverlayHandler(() => {
                    toggleOverlay(false)
                    toggleLaunchArea(false)
                })
                toggleOverlay(true)
                sysAEx.disconnect()

            }

        } else if(m.context === 'progress'){

            switch(m.data){
                case 'download':
                    // Downloading..
                    setLaunchDetails(`Downloading (${Math.round(m.value/1000000)}/${Math.round(m.total/1000000)} MB)`)
                    setDownloadPercentage(m.value, m.total, m.percent)
                    break
            }

        } else if(m.context === 'complete'){

            switch(m.data){
                case 'download': {
                    // Show installing progress bar.
                    remote.getCurrentWindow().setProgressBar(2)

                    // Wait for extration to complete.
                    const eLStr = 'Extracting'
                    let dotStr = ''
                    setLaunchDetails(eLStr)
                    extractListener = setInterval(() => {
                        if(dotStr.length >= 3){
                            dotStr = ''
                        } else {
                            dotStr += '.'
                        }
                        setLaunchDetails(eLStr + dotStr)
                    }, 750)
                    break
                }
                case 'java':
                // Download & extraction complete, remove the loading from the OS progress bar.
                    remote.getCurrentWindow().setProgressBar(-1)

                    // Extraction completed successfully.
                    ConfigManager.setJavaExecutable(m.args[0])
                    ConfigManager.save()

                    if(extractListener != null){
                        clearInterval(extractListener)
                        extractListener = null
                    }

                    setLaunchDetails('Java Installed!')

                    if(launchAfter){
                        dlAsync()
                    }

                    sysAEx.disconnect()
                    break
            }

        } else if(m.context === 'error'){
            console.log(m.error)
        }
    })

    // Begin system Java scan.
    setLaunchDetails('Checking system info..')
    sysAEx.send({task: 'execute', function: 'validateJava', argsArr: [ConfigManager.getDataDirectory(), compatibility]})

}

// Keep reference to Minecraft Process
let proc
// Is DiscordRPC enabled
// Joined server regex
// Change this if your server uses something different.
const SERVER_JOINED_REGEX = /\[.+\]: \[CHAT\] \[\+\] [a-zA-Z0-9_]{1,16} has entered Ardonia/
const GAME_JOINED_REGEX = /\[.+\]: Sound engine started/
const GAME_LAUNCH_REGEX = /^\[.+\]: (?:MinecraftForge .+ Initialized|ModLauncher .+ starting: .+)$/
const MIN_LINGER = 5000

let aEx
let serv
let versionData
let forgeData

let progressListener

/**
 * Use a default options.txt that comes with the launcher.
 *
 * @param {string} optionsPath - Path to instance options.txt
 */
function useDefaultOptions(optionsPath, optifineOnly = false) {

    if(!optifineOnly) {
        fs.copyFileSync(path.join(__dirname, 'assets/txt', 'defaults', 'options.txt'), optionsPath)
    }
    fs.copyFileSync(path.join(__dirname, 'assets/txt', 'defaults', 'optionsof.txt'), path.join(path.dirname(optionsPath), 'optionsof.txt'))
}


/**
 * Copied from uibinder.js
 *
 * Verify login tokens
 *
 * @returns boolean
 */
async function landingValidateSelectedAccount(){
    const selectedAcc = ConfigManager.getSelectedAccount()
    if(selectedAcc != null){
        const val = await AuthManager.validateSelected()
        if(!val){
            ConfigManager.removeAuthAccount(selectedAcc.uuid)
            ConfigManager.save()
            const accLen = Object.keys(ConfigManager.getAuthAccounts()).length
            setOverlayContent(
                'Failed to Refresh Login',
                `We were unable to refresh the login for <strong>${selectedAcc.displayName}</strong>. Please ${accLen > 0 ? 'select another account or ' : ''} login again.`,
                'Login',
                'Select Another Account'
            )
            setOverlayHandler(() => {
                document.getElementById('loginUsername').value = selectedAcc.username
                validateEmail(selectedAcc.username)
                loginViewOnSuccess = getCurrentView()
                loginViewOnCancel = getCurrentView()
                if(accLen > 0){
                    loginViewCancelHandler = () => {
                        ConfigManager.addAuthAccount(selectedAcc.uuid, selectedAcc.accessToken, selectedAcc.username, selectedAcc.displayName)
                        ConfigManager.save()
                        validateSelectedAccount()
                    }
                    loginCancelEnabled(true)
                }
                toggleOverlay(false)
                switchView(getCurrentView(), VIEWS.login)
            })
            setDismissHandler(() => {
                if(accLen > 1){
                    prepareAccountSelectionList()
                    $('#overlayContent').fadeOut(250, () => {
                        bindOverlayKeys(true, 'accountSelectContent', true)
                        $('#accountSelectContent').fadeIn(250)
                    })
                } else {
                    const accountsObj = ConfigManager.getAuthAccounts()
                    const accounts = Array.from(Object.keys(accountsObj), v => accountsObj[v])
                    // This function validates the account switch.
                    setSelectedAccount(accounts[0].uuid)
                    toggleOverlay(false)
                }
            })
            toggleOverlay(true, accLen > 0)
        } else {
            return true
        }
    } else {
        return true
    }
}

function dlAsync(login = true){


    // Check if the connection token is still valid while starting the game, this prevents users from having to restart
    // The launcher and only have to restart the game to fix the "Failed to verify username" error
    setLaunchDetails('Validating Token...')
    toggleLaunchArea(true)
    if(!landingValidateSelectedAccount()) return


    // Login parameter is temporary for debug purposes. Allows testing the validation/downloads without
    // launching the game.

    if(login) {
        if(ConfigManager.getSelectedAccount() == null){
            loggerLanding.error('You must be logged into an account.')
            return
        }
    }

    if(GameInstanceStarted) {
        setLaunchEnabled(false)
        toggleLaunchArea(false)
        return
    }




    setLaunchDetails('Please wait..')
    DiscordWrapper.updateDetails('Preparing to launch...', new Date().getTime())
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)


    const loggerAEx = LoggerUtil('%c[AEx]', 'color: #353232; font-weight: bold')
    const loggerLaunchSuite = LoggerUtil('%c[LaunchSuite]', 'color: #000668; font-weight: bold')

    const forkEnv = JSON.parse(JSON.stringify(process.env))
    forkEnv.CONFIG_DIRECT_PATH = ConfigManager.getLauncherDirectory()

    // Start AssetExec to run validations and downloads in a forked process.
    aEx = cp.fork(path.join(__dirname, 'assets', 'js', 'assetexec.js'), [
        'AssetGuard',
        ConfigManager.getCommonDirectory(),
        ConfigManager.getJavaExecutable()
    ], {
        env: forkEnv,
        stdio: 'pipe'
    })
    // Stdout
    aEx.stdio[1].setEncoding('utf8')
    aEx.stdio[1].on('data', (data) => {
        loggerAEx.log(data)
    })
    // Stderr
    aEx.stdio[2].setEncoding('utf8')
    aEx.stdio[2].on('data', (data) => {
        loggerAEx.log(data)
    })
    aEx.on('error', (err) => {
        loggerLaunchSuite.error('Error during launch', err)
        DiscordWrapper.updateDetails('In the Launcher', new Date().getTime())
        showNotClosableMessage(
            'Please wait...',
            'The launcher is currently gathering information, this won\'t take long!'
        )

        let reportdata = fs.readFileSync(ConfigManager.getLauncherDirectory() + '/latest.log', 'utf-8');

        (async function() {
            await new Promise((resolve, reject) => {
                setTimeout(function() { resolve() }, 3000) //Wait 3 seconds
            })
            try {
                let body = await got.post('https://mysql.songs-of-war.com/reporting/reporting.php', {
                    form: {
                        ReportData: reportdata
                    },
                }).json()
                if(body['message'] == 'Success') {
                    showLaunchFailure('Error During Launch', '\nIf you require further assistance please write this code down and ask on our discord:\n' + body['ReportID'])
                } else {
                    showLaunchFailure('Error During Launch', ' \nWe were not able to make an error report automatically.')
                }
            } catch(err) {
                showLaunchFailure('Error During Launch', '\nWe were not able to make an error report automatically.' + err)
            }
        })()

    })
    aEx.on('close', (code, signal) => {
        if(code !== 0){
            loggerLaunchSuite.error(`AssetExec exited with code ${code}, assuming error.`)
            loggerLaunchSuite.error(signal)
            DiscordWrapper.updateDetails('In the Launcher', new Date().getTime())
            showNotClosableMessage(
                'Please wait...',
                'The launcher is currently gathering information, this won\'t take long!'
            )

            let reportdata = fs.readFileSync(ConfigManager.getLauncherDirectory() + '/latest.log', 'utf-8');

            (async function() {
                await new Promise((resolve, reject) => {
                    setTimeout(function() { resolve() }, 3000) //Wait 3 seconds
                })
                try {
                    let body = await got.post('https://mysql.songs-of-war.com/reporting/reporting.php', {
                        form: {
                            ReportData: reportdata
                        },
                    }).json()
                    if(body['message'] == 'Success') {
                        showLaunchFailure('Error During Launch', '\nIf you require further assistance please write this code down and ask on our discord:\n' + body['ReportID'])
                    } else {
                        showLaunchFailure('Error During Launch', ' \nWe were not able to make an error report automatically.')
                    }
                } catch(err) {
                    showLaunchFailure('Error During Launch', ' \nWe were not able to make an error report automatically. ' + err)
                }
            })()

        }
    })

    // Establish communications between the AssetExec and current process.
    aEx.on('message', (m) => {

        if(m.context === 'validate'){
            switch(m.data){
                case 'distribution':
                    setLaunchPercentage(20, 100)
                    loggerLaunchSuite.log('Validated distribution index.')
                    setLaunchDetails('Loading version information..')
                    break
                case 'version':
                    setLaunchPercentage(40, 100)
                    loggerLaunchSuite.log('Version data loaded.')
                    setLaunchDetails('Validating asset integrity..')
                    break
                case 'assets':
                    setLaunchPercentage(60, 100)
                    loggerLaunchSuite.log('Asset Validation Complete')
                    setLaunchDetails('Validating library integrity..')
                    break
                case 'libraries':
                    setLaunchPercentage(80, 100)
                    loggerLaunchSuite.log('Library validation complete.')
                    setLaunchDetails('Validating miscellaneous file integrity..')
                    break
                case 'dlforge':
                    setLaunchPercentage(35, 100)
                    loggerLaunchSuite.log('Misc file loaded.')
                    setLaunchDetails('Downloading Forge..')
                    break
                case 'dlforgelibs':
                    setLaunchPercentage(40, 100)
                    loggerLaunchSuite.log('Forge loaded.')
                    setLaunchDetails('Downloading libraries..')
                    break
                case 'buildingforge':
                    setLaunchPercentage(50, 100)
                    loggerLaunchSuite.log('Building forge.')
                    setLaunchDetails('Building Forge..')
                    break
                case 'buildingforge2':
                    setLaunchPercentage(60, 100)
                    loggerLaunchSuite.log('Building Forge 2.')
                    setLaunchDetails('Building forge..')
                    break
                case 'forgeremap':
                    setLaunchPercentage(80, 100)
                    loggerLaunchSuite.log('Remapping jar.')
                    setLaunchDetails('Remapping forge..')
                    break
                case 'forgepatch':
                    setLaunchPercentage(80, 100)
                    loggerLaunchSuite.log('Patch jar.')
                    setLaunchDetails('Patching Forge..')
                    break
                case 'files':
                    setLaunchPercentage(100, 100)
                    loggerLaunchSuite.log('File validation complete.')
                    setLaunchDetails('Downloading files..')
                    break
            }
        } else if(m.context === 'progress'){
            switch(m.data){
                case 'assets': {
                    const perc = (m.value/m.total)*20
                    setLaunchPercentage(40+perc, 100, parseInt(40+perc))
                    break
                }
                case 'download':
                    setLaunchDetails(`Downloading (${Math.round(m.value/1000000)}/${Math.round(m.total/1000000)} MB)`)
                    setDownloadPercentage(m.value, m.total, m.percent)
                    break
                case 'extract': {
                    // Show installing progress bar.
                    remote.getCurrentWindow().setProgressBar(2)

                    // Download done, extracting.
                    const eLStr = 'Extracting libraries'
                    let dotStr = ''
                    setLaunchDetails(eLStr)
                    progressListener = setInterval(() => {
                        if(dotStr.length >= 3){
                            dotStr = ''
                        } else {
                            dotStr += '.'
                        }
                        setLaunchDetails(eLStr + dotStr)
                    }, 750)
                    break
                }
            }
        } else if(m.context === 'complete'){
            switch(m.data){
                case 'download':
                    // Download and extraction complete, remove the loading from the OS progress bar.
                    remote.getCurrentWindow().setProgressBar(-1)
                    if(progressListener != null){
                        clearInterval(progressListener)
                        progressListener = null
                    }

                    setLaunchDetails('Preparing to launch..')
                    DiscordWrapper.updateDetails('Game launching...', new Date().getTime())
                    break
            }
        } else if(m.context === 'error'){
            switch(m.data){
                case 'download':
                    loggerLaunchSuite.error('Error while downloading:', m.error)
                    DiscordWrapper.updateDetails('In the Launcher', new Date().getTime())
                    // Failed to connect
                    if(m.error.code === 'ENOENT'){
                        showLaunchFailure(
                            'Download Error',
                            'Could not connect to the file server. Ensure that you are connected to the internet and try again.'
                        )
                    // No space
                    } else if(m.error.code === 'ENOSPC') {
                        showLaunchFailure(
                            'Download Error',
                            'You are out of disk space.'
                        )
                    } else {
                        showLaunchFailure('Download Error', '\nWe were not able to download some files. Error info: ' + m.error)
                    }

                    remote.getCurrentWindow().setProgressBar(-1)

                    // Disconnect from AssetExec
                    aEx.disconnect()
                    break
            }
        } else if(m.context === 'validateEverything'){

            let allGood = true

            // If these properties are not defined it's likely an error.
            if(m.result.forgeData == null || m.result.versionData == null){
                loggerLaunchSuite.error('Error during validation:', m.result)

                DiscordWrapper.updateDetails('In the Launcher', new Date().getTime())
                loggerLaunchSuite.error('Validation Error')
                loggerLaunchSuite.error('Error during launch', m.result.error);
                (async function() {
                    await new Promise((resolve, reject) => {
                        setTimeout(function() { resolve() }, 3000) //Wait 3 seconds
                    })
                    try {
                        let body = await got.post('https://mysql.songs-of-war.com/reporting/reporting.php', {
                            form: {
                                ReportData: reportdata
                            },
                        }).json()
                        if(body['message'] == 'Success') {
                            showLaunchFailure('Error During Launch', '\nIf you require further assistance please write this code down and ask on our discord:\n' + body['ReportID'])
                        } else {
                            showLaunchFailure('Error During Launch', ' \nWe were not able to make an error report automatically.')
                        }
                    } catch(err) {
                        showLaunchFailure('Error During Launch', '\nWe were not able to make an error report automatically.' + err)
                    }
                })()

                allGood = false
            }

            forgeData = m.result.forgeData
            versionData = m.result.versionData

            if(login && allGood) {
                const authUser = ConfigManager.getSelectedAccount()
                loggerLaunchSuite.log(`Sending selected account (${authUser.displayName}) to ProcessBuilder.`)
                let pb = new ProcessBuilder(serv, versionData, forgeData, authUser, remote.app.getVersion())
                setLaunchDetails('Launching game..')

                const onLoadComplete = () => {
                    toggleLaunchArea(false)
                    DiscordWrapper.updateDetails('Loading game...', new Date().getTime())
                    proc.stdout.on('data', gameStateChange)
                    proc.stdout.removeListener('data', tempListener)
                    proc.stderr.removeListener('data', gameErrorListener)
                }
                const start = Date.now()

                // Attach a temporary listener to the client output.
                // Will wait for a certain bit of text meaning that
                // the client application has started, and we can hide
                // the progress bar stuff.
                const tempListener = function(data){
                    if(GAME_LAUNCH_REGEX.test(data.trim())){
                        const diff = Date.now()-start
                        if(diff < MIN_LINGER) {
                            setTimeout(onLoadComplete, MIN_LINGER-diff)
                        } else {
                            onLoadComplete()
                        }
                    }
                }

                // Listener for Discord RPC.
                const gameStateChange = function(data){
                    data = data.trim()
                    if(SERVER_JOINED_REGEX.test(data)){
                        DiscordWrapper.updateDetails('Playing on the server!', new Date().getTime())
                        joinedServer = true
                    } else if(GAME_JOINED_REGEX.test(data)){
                        DiscordWrapper.updateDetails('In the Main Menu', new Date().getTime())
                    }
                }

                const gameErrorListener = function(data){
                    data = data.trim()
                    if(data.indexOf('Could not find or load main class net.minecraft.launchwrapper.Launch') > -1){
                        DiscordWrapper.updateDetails('In the Launcher', new Date().getTime())
                        loggerLaunchSuite.error('Game launch failed, LaunchWrapper was not downloaded properly.');
                        (async function() {
                            await new Promise((resolve, reject) => {
                                setTimeout(function() { resolve() }, 3000) //Wait 3 seconds
                            })
                            try {
                                let body = await got.post('https://mysql.songs-of-war.com/reporting/reporting.php', {
                                    form: {
                                        ReportData: reportdata
                                    },
                                }).json()
                                if(body['message'] == 'Success') {
                                    showLaunchFailure('Error During Launch', 'The main file, LaunchWrapper, failed to download properly. As a result, the game cannot launch.<br><br>To fix this issue, temporarily turn off your antivirus software and launch the game again.<br><br>If you have time, please <a href="https://github.com/Songs-of-War/Songs-Of-War-Launcher/issues">submit an issue</a> and let us know what antivirus software you use. \nIf you require further assistance please write this code down and ask on our discord:\n' + body['ReportID'])
                                } else {
                                    showLaunchFailure('Error During Launch', 'The main file, LaunchWrapper, failed to download properly. As a result, the game cannot launch.<br><br>To fix this issue, temporarily turn off your antivirus software and launch the game again.<br><br>If you have time, please <a href="https://github.com/Songs-of-War/Songs-Of-War-Launcher/issues">submit an issue</a> and let us know what antivirus software you use. \nWe were not able to make an error report automatically.')
                                }
                            } catch(err) {
                                showLaunchFailure('Error During Launch', 'The main file, LaunchWrapper, failed to download properly. As a result, the game cannot launch.<br><br>To fix this issue, temporarily turn off your antivirus software and launch the game again.<br><br>If you have time, please <a href="https://github.com/Songs-of-War/Songs-Of-War-Launcher/issues">submit an issue</a> and let us know what antivirus software you use. \nWe were not able to make an error report automatically.' + err)
                            }
                        })()
                    }
                }


                try {
                    got('https://mysql.songs-of-war.com/maintenance').then(result => {
                        if(result.body.includes('true')) {
                            showLaunchFailure('Server in maintenance', 'Our data server is currently in maintenance. Likely because of an update, please try again later.')
                        } else {
                            try {

                                setLaunchDetails('Done. Enjoy the server!')
                                setLaunchEnabled(false)

                                // Get the game instance
                                const gamePath = path.join(ConfigManager.getInstanceDirectory(), DistroManager.getDistribution().getServer(ConfigManager.getSelectedServer()).getID())

                                const paths = {
                                    mods: path.join(gamePath, 'mods'),
                                    options: path.join(gamePath, 'options.txt'),
                                    shaderpacks: path.join(gamePath, 'shaderpacks')
                                }

                                // Delete forbidden mods
                                if (fs.existsSync(paths.mods)) {
                                    fs.readdirSync(paths.mods).forEach((file) => {
                                        // Prevent optifine to be deleted here because of Java Path issues
                                        // Shit patch but honestly I don't care, I don't have time to implement something better
                                        if(file !== 'OptiFine.jar' && file !== 'MixinBootstrap.jar' && file !== 'nicephore') {
                                            fs.unlinkSync(path.join(paths.mods, file))
                                        }
                                    })
                                }

                                //Setting up the default config for clients and overriding certain options required for the server

                                // If there aren't any options set so far
                                if(!fs.existsSync(paths.options) || !fs.existsSync(path.join(gamePath, 'optionsof.txt'))) {
                                    loggerLaunchSuite.log('Could not find options in instance directory.')

                                    // Try to grab .minecraft/options.txt
                                    const oldOptionsPath = path.join(ConfigManager.getMinecraftDirectory(), 'options.txt')
                                    loggerLaunchSuite.log('Attempting to find ' + oldOptionsPath)
                                    if(fs.existsSync(oldOptionsPath)) {
                                        loggerLaunchSuite.log('Found! Attempting to copy.')
                                        fs.copyFileSync(oldOptionsPath, paths.options)
                                        useDefaultOptions(paths.options, true)

                                    // If it doesn't exist
                                    } else {
                                        useDefaultOptions(paths.options)
                                        loggerLaunchSuite.log('Couldn\'t find options.txt in Minecraft or launcher instance. Launcher defaults used.')
                                    }

                                }

                                // Loop through our options.txt and attempt to override
                                loggerLaunchSuite.log('Validating options...')
                                let data = fs.readFileSync(paths.options, 'utf8').split('\n')
                                let packOn = false, musicOff = false, fullscreenOff = false

                                data.forEach((element, index) => {
                                    if(element.startsWith('resourcePacks:')) {
                                        data[index] = 'resourcePacks:["mod_resources","vanilla","programer_art","file/SoWPack"]'
                                        packOn = true
                                    } else if(element.startsWith('soundCategory_music:')) {
                                        data[index] = 'soundCategory_music:0.0'
                                        musicOff = true
                                    } else if(element.startsWith('fullscreen:')) {
                                        data[index] = 'fullscreen:false'
                                        fullscreenOff = true
                                    }
                                })

                                let optifineOverrides = false

                                if(fs.existsSync(path.join(gamePath, 'optionsof.txt'))) {
                                    loggerLaunchSuite.log('Validating optifine settings')
                                    let dataof = fs.readFileSync(path.join(gamePath, 'optionsof.txt'), 'utf-8').split('\n')
                                    dataof.forEach((element, index) => {
                                        if(element.startsWith('ofShowCapes:')) {
                                            data[index] = 'ofShowCapes:false'
                                            optifineOverrides = true
                                        }
                                    })
                                }

                                // If override successful
                                if(packOn && musicOff && fullscreenOff && optifineOverrides) {
                                    fs.writeFileSync(paths.options, data.join('\n'))
                                    loggerLaunchSuite.log('Options validated.')
                                } else {
                                    useDefaultOptions(paths.options)
                                    loggerLaunchSuite.log('Couldn\'t validate options. Launcher defaults used.')
                                }


                                if(ConfigManager.getShaderMirroring()) {
                                    // Grab shaders while we're at it as well
                                    const oldShadersPath = path.join(ConfigManager.getMinecraftDirectory(), 'shaderpacks')

                                    // Check if there's a place to get shaders and a place to put them
                                    if(fs.existsSync(paths.shaderpacks) && fs.existsSync(oldShadersPath)) {

                                        // Find shaders in .minecraft/shaderpacks that instance doesn't have
                                        let shadersArr = fs.readdirSync(paths.shaderpacks)
                                        fs.readdirSync(oldShadersPath)
                                            .filter(element => !shadersArr.includes(element))
                                            .forEach(element => {

                                                // Attempt to copy shader
                                                try{
                                                    fs.copyFileSync(path.join(oldShadersPath, element), path.join(paths.shaderpacks, element))
                                                    loggerLaunchSuite.log('Copied shader ' + element.slice(0, -4) + ' to launcher instance.')
                                                } catch(error) {
                                                    loggerLaunchSuite.warn('Failed to copy shader '+ element.slice(0, -4) + ' to launcher instance.')
                                                }
                                            })

                                    }
                                } else {
                                    loggerLaunchSuite.log('Shader mirroring disabled in launcher config')
                                }

                                let watcherRecurse = true
                                // Watcher recursiveness is not supported in Linux
                                if(process.platform === 'linux') {
                                    watcherRecurse = false
                                }

                                // Updated as of late: We want to delete the mods / edit the configuration right before the game is launched, so that the launcher gets the change to synchronise the files with the distribution
                                // Fixes ENOENT error without a .songsofwar folder


                                // Setup the watchers right before the process start and just after the asset checker is done
                                // Setup the different file watchers

                                // Note: I have no idea if there's a better way to do this so eh.
                                const ModsWatcher = fs.watch(path.join(ConfigManager.getInstanceDirectory(), DistroManager.getDistribution().getServer(ConfigManager.getSelectedServer()).getID() + '/mods'), {
                                    encoding: 'utf-8',
                                    recursive: watcherRecurse
                                })

                                // Build Minecraft process.
                                // Minecraft process needs to be built after the asset checking is done, prevents game from starting with launcher errors
                                proc = pb.build()

                                remote.getCurrentWindow().hide()
                                // Show the normal launch area after the game starts
                                toggleLaunchArea(false)
                                WindowHidden = true
                                if(process.platform === 'win32') {
                                    const { Tray, Menu } = require('electron').remote


                                    TrayObject = new Tray(path.join(__dirname, '/assets/images/icon.png'))
                                    TrayObject.setToolTip('Songs of War Game - Game Running')
                                    const contextMenu = Menu.buildFromTemplate([
                                        { label: 'Force close the game', type: 'normal', click: function() { proc.kill() }}
                                    ])
                                    TrayObject.setContextMenu(contextMenu)
                                    TrayObject.on('double-click', () => {
                                        if(WindowHidden) {
                                            remote.getCurrentWindow().show()
                                            WindowHidden = false
                                        } else {
                                            remote.getCurrentWindow().hide()
                                            WindowHidden = true
                                        }
                                    })
                                }

                                // Bind listeners to stdout.
                                proc.stdout.on('data', tempListener)
                                proc.stderr.on('data', gameErrorListener)


                                proc.on('message', (data) => {
                                    if(data == 'MinecraftShutdown') {
                                        setLaunchEnabled(true)
                                        joinedServer = false
                                        GameInstanceStarted = false

                                        //Shutdown all the file watchers
                                        ModsWatcher.close()
                                        remote.getCurrentWindow().show()

                                        if(process.platform === 'win32') TrayObject.destroy(); loggerLanding.log('Open window, trigger')
                                        WindowHidden = false
                                    }
                                    if(data == 'GameStarted') {
                                        GameInstanceStarted = true
                                    }
                                })

                                //Receive crash message
                                proc.on('message', (data) => {
                                    if(data === 'Crashed') {
                                        remote.getCurrentWindow().show()
                                        if(process.platform === 'win32') TrayObject.destroy(); loggerLanding.log('Open window, trigger')
                                        WindowHidden = false
                                        setLaunchEnabled(true)
                                        joinedServer = false
                                        showNotClosableMessage(
                                            'Please wait...',
                                            'The launcher is currently gathering information, this won\'t take long!'
                                        );
                                        (async function() {
                                            await new Promise((resolve, reject) => {
                                                setTimeout(function() { resolve() }, 1000) //Wait 1 second
                                            })
                                            if(!ModifyError) {

                                                let reportdata = fs.readFileSync(ConfigManager.getLauncherDirectory() + '/latest.log', 'utf-8')
                                                await new Promise((resolve, reject) => {
                                                    setTimeout(function() { resolve() }, 3000) //Wait 3 seconds
                                                })
                                                try {
                                                    let body = await got.post('https://mysql.songs-of-war.com/reporting/reporting.php', {
                                                        form: {
                                                            ReportData: reportdata
                                                        },
                                                    }).json()
                                                    if(body['message'] == 'Success') {
                                                        showLaunchFailure('Game crashed', '\nIf you require further assistance please write this code down and ask on our discord:\n' + body['ReportID'])
                                                    } else {
                                                        showLaunchFailure('Game crashed', ' \nWe were not able to make an error report automatically.')
                                                    }
                                                } catch(err) {
                                                    showLaunchFailure('Game crashed', '\nWe were not able to make an error report automatically.' + err)
                                                }

                                            } else {
                                                showLaunchFailure('Runtime error', 'A runtime error has occured, most likely due to a file edit.')
                                            }
                                        })()
                                    }
                                    if(data === 'OutOfMemory') {
                                        remote.getCurrentWindow().show()
                                        if(process.platform === 'win32') TrayObject.destroy()
                                        WindowHidden = false
                                        showLaunchFailure('Out of memory', 'Failed to allocate enough memory. Try lowering the amount of RAM allocated to Minecraft or close some RAM hungry programs that are running.')
                                    }
                                    if(data === 'OpenGLDriverUnavailable') {
                                        remote.getCurrentWindow.show()
                                        if(process.platform === 'win32') TrayObject.destroy()
                                        WindowHidden = false
                                        showLaunchFailure('Video driver unavailable', 'WGL: The driver does not appear to support OpenGL\n\nPlease try to update your graphics drivers, for more information\nplease refer to <a href="https://aka.ms/mcdriver/">this guide</a>')
                                    }
                                })


                                ///This is very stupid but oh well
                                let ModifyError = false
                                // Kill the process if the files get changed at runtime
                                ModsWatcher.on('change', (event, filename) => {
                                    loggerLanding.log('File edit: ' + filename)

                                    // This checks and verifies if after a file edit it's hash still matches the one in the distro
                                    // This is not a foolproof protection but should prevent kiddies from injecting their mods easily
                                    // Also this fixes the fuck ton of unjustified runtime errors that happen on 1.10.12 and below
                                    let distroData = DistroManager.getDistribution()

                                    let modFolder = path.join(ConfigManager.getInstanceDirectory(), DistroManager.getDistribution().getServer(ConfigManager.getSelectedServer()).getID() + '/mods')

                                    let currentArtifact
                                    currentArtifact = distroData.getServer(ConfigManager.getSelectedServer()).getModules().filter((e) => {
                                        if (e.artifact.path != null && e.artifact.path == path.join(modFolder, filename).toString()) {
                                            currentArtifact = e.artifact
                                            return true
                                        }
                                        return false
                                    })[0]

                                    console.log("Artifact:")
                                    console.log(currentArtifact)

                                    if(currentArtifact == null) {
                                        if(filename.endsWith('.jar')) {
                                            ModifyError = true
                                            proc.kill()
                                        }
                                    } else {
                                        if(fs.existsSync(path.join(modFolder, filename)) && !fs.lstatSync(path.join(modFolder, filename)).isDirectory()) {
                                            let hash = crypto.createHash('md5').setEncoding('hex').update(fs.readFileSync(path.join(modFolder, filename))).digest('hex')

                                            console.log('File hash on system: ' + hash)
                                            // "MD5" is case sensitive, I hate myself for not realizing that earlier
                                            console.log('File hash in distribution: ' + currentArtifact.artifact.MD5)
                                            if(currentArtifact.artifact.MD5 != null && currentArtifact.artifact.MD5 != hash) {
                                                ModifyError = true
                                                proc.kill()
                                            }
                                        }

                                    }
                                })



                            } catch(err) {

                                DiscordWrapper.updateDetails('In the Launcher', new Date().getTime())
                                setLaunchEnabled(true)
                                remote.getCurrentWindow().show()
                                WindowHidden = false
                                joinedServer = false
                                showNotClosableMessage(
                                    'Please wait...',
                                    'The launcher is currently gathering information, this won\'t take long!'
                                )
                                loggerLaunchSuite.error('Error during launch ', err)
                                loggerLaunchSuite.error('Error Data:')
                                loggerLaunchSuite.error(err)
                                let reportdata = fs.readFileSync(ConfigManager.getLauncherDirectory() + '/latest.log', 'utf-8');
                                (async function() {
                                    await new Promise((resolve, reject) => {
                                        setTimeout(function() { resolve() }, 3000) //Wait 3 seconds
                                    })
                                    try {
                                        let body = await got.post('https://mysql.songs-of-war.com/reporting/reporting.php', {
                                            form: {
                                                ReportData: reportdata
                                            },
                                        }).json()
                                        if(body['message'] == 'Success') {
                                            showLaunchFailure('Error During Launch', '\nIf you require further assistance please write this code down and ask on our discord:\n' + body['ReportID'])
                                        } else {
                                            showLaunchFailure('Error During Launch', ' \nWe were not able to make an error report automatically.')
                                        }
                                    } catch(err) {
                                        showLaunchFailure('Error During Launch', '\nWe were not able to make an error report automatically.' + err)
                                    }
                                })()

                            }
                        }
                    })
                } catch(error) {
                    error(error)
                    setLaunchEnabled(true)
                }
            }

            // Disconnect from AssetExec
            aEx.disconnect()
            setLaunchEnabled(true)

        }
    })

    // Begin Validations

    // Validate Forge files.
    setLaunchDetails('Loading server information..')

    refreshDistributionIndex(true, (data) => {
        onDistroRefresh(data)
        serv = data.getServer(ConfigManager.getSelectedServer())
        aEx.send({task: 'execute', function: 'validateEverything', argsArr: [ConfigManager.getSelectedServer(), DistroManager.isDevMode()]})
    }, (err) => {
        loggerLaunchSuite.log('Error while fetching a fresh copy of the distribution index.', err)
        refreshDistributionIndex(false, (data) => {
            onDistroRefresh(data)
            serv = data.getServer(ConfigManager.getSelectedServer())
            aEx.send({task: 'execute', function: 'validateEverything', argsArr: [ConfigManager.getSelectedServer(), DistroManager.isDevMode()]})
        }, (err) => {
            loggerLaunchSuite.error('Unable to refresh distribution index.', err)
            if(DistroManager.getDistribution() == null){
                showLaunchFailure('Fatal Error', 'Could not load a copy of the distribution index.')

                // Disconnect from AssetExec
                aEx.disconnect()
            } else {
                serv = data.getServer(ConfigManager.getSelectedServer())
                aEx.send({task: 'execute', function: 'validateEverything', argsArr: [ConfigManager.getSelectedServer(), DistroManager.isDevMode()]})
            }
        })
    })
}

/**
 * News Loading Functions
 */

// DOM Cache
const newsContent                   = document.getElementById('newsContent')
const newsArticleTitle              = document.getElementById('newsArticleTitle')
const newsArticleDate               = document.getElementById('newsArticleDate')
const newsArticleAuthor             = document.getElementById('newsArticleAuthor')
const newsNavigationStatus          = document.getElementById('newsNavigationStatus')
const newsArticleContentScrollable  = document.getElementById('newsArticleContentScrollable')
const nELoadSpan                    = document.getElementById('nELoadSpan')

// News slide caches.
let newsActive = false
let newsGlideCount = 0

/**
 * Show the news UI via a slide animation.
 * 
 * @param {boolean} up True to slide up, otherwise false. 
 */
function slide_(up){
    const lCUpper = document.querySelector('#landingContainer > #upper')
    const lCLLeft = document.querySelector('#landingContainer > #lower > #left')
    const lCLCenter = document.querySelector('#landingContainer > #lower > #center')
    const lCLRight = document.querySelector('#landingContainer > #lower > #right')
    const newsBtn = document.querySelector('#landingContainer > #lower > #center #content')
    const landingContainer = document.getElementById('landingContainer')
    const newsContainer = document.querySelector('#landingContainer > #newsContainer')

    newsGlideCount++

    if(up){
        lCUpper.style.top = '-200vh'
        lCLLeft.style.top = '-200vh'
        lCLCenter.style.top = '-200vh'
        lCLRight.style.top = '-200vh'
        newsBtn.style.top = '130vh'
        newsContainer.style.top = '0px'
        //date.toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric'})
        //landingContainer.style.background = 'rgba(29, 29, 29, 0.55)'
        landingContainer.style.background = 'rgba(0, 0, 0, 0.50)'
        setTimeout(() => {
            if(newsGlideCount === 1){
                lCLCenter.style.transition = 'none'
                newsBtn.style.transition = 'none'
            }
            newsGlideCount--
        }, 2000)
    } else {
        setTimeout(() => {
            newsGlideCount--
        }, 2000)
        landingContainer.style.background = null
        lCLCenter.style.transition = null
        newsBtn.style.transition = null
        newsContainer.style.top = '100%'
        lCUpper.style.top = '0px'
        lCLLeft.style.top = '0px'
        lCLCenter.style.top = '0px'
        lCLRight.style.top = '0px'
        newsBtn.style.top = '10px'
    }
}

// Bind news button.
document.getElementById('newsButton').onclick = () => {
    // Toggle tabbing.
    if(newsActive){
        $('#landingContainer *').removeAttr('tabindex')
        $('#newsContainer *').attr('tabindex', '-1')
    } else {
        $('#landingContainer *').attr('tabindex', '-1')
        $('#newsContainer, #newsContainer *, #lower, #lower #center *').removeAttr('tabindex')
        if(newsAlertShown){
            $('#newsButtonAlert').fadeOut(2000)
            newsAlertShown = false
            ConfigManager.setNewsCacheDismissed(true)
            ConfigManager.save()
        }
    }
    slide_(!newsActive)
    newsActive = !newsActive
}

// Array to store article meta.
let newsArr = null

// News load animation listener.
let newsLoadingListener = null

/**
 * Set the news loading animation.
 * 
 * @param {boolean} val True to set loading animation, otherwise false.
 */
function setNewsLoading(val){
    if(val){
        const nLStr = 'Checking for News'
        let dotStr = '..'
        nELoadSpan.innerHTML = nLStr + dotStr
        newsLoadingListener = setInterval(() => {
            if(dotStr.length >= 3){
                dotStr = ''
            } else {
                dotStr += '.'
            }
            nELoadSpan.innerHTML = nLStr + dotStr
        }, 750)
    } else {
        if(newsLoadingListener != null){
            clearInterval(newsLoadingListener)
            newsLoadingListener = null
        }
    }
}

// Bind retry button.
newsErrorRetry.onclick = () => {
    $('#newsErrorFailed').fadeOut(250, () => {
        initNews()
        $('#newsErrorLoading').fadeIn(250)
    })
}

newsArticleContentScrollable.onscroll = (e) => {
    if(e.target.scrollTop > Number.parseFloat($('.newsArticleSpacerTop').css('height'))){
        newsContent.setAttribute('scrolled', '')
    } else {
        newsContent.removeAttribute('scrolled')
    }
}

/**
 * Reload the news without restarting.
 * 
 * @returns {Promise.<void>} A promise which resolves when the news
 * content has finished loading and transitioning.
 */
function reloadNews(){
    return new Promise((resolve, reject) => {
        $('#newsContent').fadeOut(250, () => {
            $('#newsErrorLoading').fadeIn(250)
            initNews().then(() => {
                resolve()
            })
        })
    })
}

let newsAlertShown = false

/**
 * Show the news alert indicating there is new news.
 */
function showNewsAlert(){
    newsAlertShown = true
    $(newsButtonAlert).fadeIn(250)
}

/**
 * Initialize News UI. This will load the news and prepare
 * the UI accordingly.
 * 
 * @returns {Promise.<void>} A promise which resolves when the news
 * content has finished loading and transitioning.
 */
function initNews(){

    return new Promise((resolve, reject) => {
        setNewsLoading(true)

        let news = {}
        loadNews().then(news => {

            newsArr = news.articles || null

            if(newsArr == null){
                // News Loading Failed
                setNewsLoading(false)

                $('#newsErrorLoading').fadeOut(250, () => {
                    $('#newsErrorFailed').fadeIn(250, () => {
                        resolve()
                    })
                })
            } else if(newsArr.length === 0) {
                // No News Articles
                setNewsLoading(false)

                ConfigManager.setNewsCache({
                    date: null,
                    content: null,
                    dismissed: false
                })
                ConfigManager.save()

                $('#newsErrorLoading').fadeOut(250, () => {
                    $('#newsErrorNone').fadeIn(250, () => {
                        resolve()
                    })
                })
            } else {
                // Success
                setNewsLoading(false)

                const lN = newsArr[0]
                const cached = ConfigManager.getNewsCache()
                let newHash = crypto.createHash('sha1').update(lN.content).digest('hex')
                let newDate = new Date(lN.date)
                let isNew = false

                if(cached.date != null && cached.content != null){

                    if(new Date(cached.date) >= newDate){

                        // Compare Content
                        if(cached.content !== newHash){
                            isNew = true
                            showNewsAlert()
                        } else {
                            if(!cached.dismissed){
                                isNew = true
                                showNewsAlert()
                            }
                        }

                    } else {
                        isNew = true
                        showNewsAlert()
                    }

                } else {
                    isNew = true
                    showNewsAlert()
                }

                if(isNew){
                    ConfigManager.setNewsCache({
                        date: newDate.getTime(),
                        content: newHash,
                        dismissed: false
                    })
                    ConfigManager.save()
                }

                const switchHandler = (forward) => {
                    let cArt = parseInt(newsContent.getAttribute('article'))
                    let nxtArt = forward ? (cArt >= newsArr.length-1 ? 0 : cArt + 1) : (cArt <= 0 ? newsArr.length-1 : cArt - 1)
            
                    displayArticle(newsArr[nxtArt], nxtArt+1)
                }

                document.getElementById('newsNavigateRight').onclick = () => { switchHandler(true) }
                document.getElementById('newsNavigateLeft').onclick = () => { switchHandler(false) }

                $('#newsErrorContainer').fadeOut(250, () => {
                    displayArticle(newsArr[0], 1)
                    $('#newsContent').fadeIn(250, () => {
                        resolve()
                    })
                })
            }

        })
        
    })
}

/**
 * Add keyboard controls to the news UI. Left and right arrows toggle
 * between articles. If you are on the landing page, the up arrow will
 * open the news UI.
 */
document.addEventListener('keydown', (e) => {
    if(newsActive){
        if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
            document.getElementById(e.key === 'ArrowRight' ? 'newsNavigateRight' : 'newsNavigateLeft').click()
        }
        // Interferes with scrolling an article using the down arrow.
        // Not sure of a straight forward solution at this point.
        // if(e.key === 'ArrowDown'){
        //     document.getElementById('newsButton').click()
        // }
    } else {
        if(getCurrentView() === VIEWS.landing){
            if(e.key === 'ArrowUp'){
                document.getElementById('newsButton').click()
            }
        }
    }
})

/**
 * Display a news article on the UI.
 * 
 * @param {Object} articleObject The article meta object.
 * @param {number} index The article index.
 */
function displayArticle(articleObject, index){
    newsArticleTitle.innerHTML = articleObject.title
    newsArticleTitle.href = articleObject.link
    newsArticleAuthor.innerHTML = 'by ' + articleObject.author
    newsArticleDate.innerHTML = articleObject.date
    newsArticleContentScrollable.innerHTML = '<div id="newsArticleContentWrapper"><div class="newsArticleSpacerTop"></div>' + articleObject.content + '<div class="newsArticleSpacerBot"></div></div>'
    Array.from(newsArticleContentScrollable.getElementsByClassName('bbCodeSpoilerButton')).forEach(v => {
        v.onclick = () => {
            const text = v.parentElement.getElementsByClassName('bbCodeSpoilerText')[0]
            text.style.display = text.style.display === 'block' ? 'none' : 'block'
        }
    })
    newsNavigationStatus.innerHTML = index + ' of ' + newsArr.length
    newsContent.setAttribute('article', index-1)
}

/**
 * Load news information from the RSS feed specified in the
 * distribution index.
 */
function loadNews(){
    return new Promise((resolve, reject) => {
        const distroData = DistroManager.getDistribution()
        const newsFeed = distroData.getRSS()
        const newsHost = new URL(newsFeed).origin + '/'
        $.ajax({
            url: newsFeed,
            success: (data) => {
                const items = $(data).find('item')
                const articles = []

                for(let i=0; i<items.length; i++){
                // JQuery Element
                    const el = $(items[i])

                    // Resolve date.
                    const date = new Date(el.find('pubDate').text()).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric'})

                    // Resolve comments.
                    let comments = el.find('slash\\:comments').text() || '0'
                    comments = comments + ' Comment' + (comments === '1' ? '' : 's')

                    // Fix relative links in content.
                    let content = el.find('content\\:encoded').text()
                    let regex = /src="(?!http:\/\/|https:\/\/)(.+?)"/g
                    let matches
                    while((matches = regex.exec(content))){
                        content = content.replace(`"${matches[1]}"`, `"${newsHost + matches[1]}"`)
                    }

                    let link   = el.find('link').text()
                    let title  = el.find('title').text()
                    let author = el.find('dc\\:creator').text()

                    // Generate article.
                    articles.push(
                        {
                            link,
                            title,
                            date,
                            author,
                            content,
                            comments,
                            commentsLink: link + '#comments'
                        }
                    )
                }
                resolve({
                    articles
                })
            },
            timeout: 2500
        }).catch(err => {
            resolve({
                articles: null
            })
        })
    })
}