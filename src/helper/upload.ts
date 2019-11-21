import fs from 'fs'
import os from 'os'
import path from 'path'
import mime from 'mime'
import mkdirp from 'mkdirp'
import unzip from 'unzipper'
import multer from '@koa/multer'

// @ts-ignore
import AppInfoParser from 'app-info-parser'
// import PkgReader from 'reiko-parser'

// @ts-ignore
import etl from 'etl'
import { compose, maxBy, filter, get } from 'lodash/fp'

import config from '../config'

import Team, { ITeam } from '../model/team'
import App from '../model/app_model'
import Version from '../model/version'

import { responseWrapper, exec } from '../helper/util'

const tempDir = path.join(config.fileDir, 'temp')

const uploadDir = path.join(config.fileDir, 'upload')

const uploadPrefix = "upload"

const storage = multer.diskStorage({
    destination: tempDir,
    filename: (req: any, file: any, cb: any) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({ storage });


interface IAppInfo extends IParseIpaInfo {
    downloadUrl?: string
    creator?: string
    creatorId?: string
    icon?: string
    fileName?: string
    shortUrl?: string
    uploader?: string
    uploaderId?: string
    size?: number
}

const parseAppAndInsertToDB = async (file: any, user: any, team: ITeam) => {

    let filePath = file.path
    let parser, extractor

    if (path.extname(filePath) === ".ipa") {

        parser = parseIpa
        extractor = extractIpaIcon

    } else if (path.extname(filePath) === ".apk") {

        parser = parseApk
        extractor = extractApkIcon

    } else {
        throw (new Error("文件类型有误,仅支持IPA或者APK文件的上传."))
    }

    //解析ipa和apk文件
    let info: IAppInfo = await parser(filePath)

    let fileName = info.bundleId + "_" + info.versionStr + "_" + info.versionCode

    //解析icon图标
    let icon = await extractor(filePath, fileName, team)

    //移动文件到对应目录
    let fileRelatePath = path.join(team.id, info.platform)

    createFolderIfNeeded(path.join(uploadDir, fileRelatePath))

    let fileRealPath = path.join(uploadDir, fileRelatePath, fileName + path.extname(filePath))

    await fs.renameSync(filePath, fileRealPath)

    info.downloadUrl = path.join(uploadPrefix, fileRelatePath, fileName + path.extname(filePath))

    let app = await App.findOne({ 'platform': info.platform, 'bundleId': info.bundleId, 'ownerId': team._id })

    if (!app) {

        info.creator = user.username

        info.creatorId = user._id

        info.icon = path.join(uploadPrefix, icon.fileName)

        info.shortUrl = Math.random().toString(36).substring(2, 5) + Math.random().toString(36).substring(2, 5)

        app = new App(info)

        app.ownerId = team._id

        app.currentVersion = info.versionCode

        await app.save()

        info.uploader = user.username

        info.uploaderId = user._id

        info.size = fs.statSync(fileRealPath).size

        let version = new Version(info)

        version.appId = app._id

        if (app.platform == 'ios') {

            version.installUrl = mapInstallUrl(app.id, version.id)

        } else {

            version.installUrl = info.downloadUrl

        }

        await version.save()

        return { 'app': app, 'version': version }

    }


    let version = await Version.findOne({ appId: app.id, versionCode: info.versionCode })

    if (!version) {

        info.uploader = user.username

        info.uploaderId = user._id

        info.size = fs.statSync(fileRealPath).size

        let version = new Version(info)

        version.appId = app._id

        if (app.platform == 'ios') {

            version.installUrl = mapInstallUrl(app.id, version.id)

        } else {

            version.installUrl = `${config.baseUrl}/${info.downloadUrl}`

        }

        await version.save()

        return { 'app': app, 'version': version }

    } else {

        let err: NodeJS.ErrnoException = Error()

        err.code = '408'

        err.message = '当前版本已存在'

        throw err

    }
}


interface IParseIpaInfo {
    platform?: string
    bundleId?: string
    bundleName?: string
    appName?: string
    versionStr?: string
    versionCode?: number
    iconName?: string
    appLevel?: 'appstore'|'enterprise'|'develop'
}

// 解析 IPA
const parseIpa = async (filename: string): Promise<IParseIpaInfo> => {

    const parser = new AppInfoParser(filename)

    return new Promise((resolve, reject) => parser.parse().then( (result: any) => {
        console.log('app info ----> ', result)
        console.log('icon base64 ----> ', result.icon)

        let info: IParseIpaInfo
        info.platform = 'ios'
        info.bundleId = result.CFBundleIdentifier
        info.bundleName = result.CFBundleName
        info.appName = result.CFBundleDisplayName
        info.versionStr = result.CFBundleShortVersionString
        info.versionCode = result.CFBundleVersion
        info.iconName = result.CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconName
        try {
            const environment = result.mobileProvision.Entitlements['aps-environment']
            const active = result.mobileProvision.Entitlements['beta-reports-active']
            if (environment == 'production') {
                info.appLevel = active ? 'appstore' : 'enterprise'
            } else {
                info.appLevel = 'develop'
            }
        } catch (err) {
            info.appLevel = 'develop'
            // reject("应用未签名,暂不支持")
        }
        resolve(info)
    }))
}

// 解析Apk
const parseApk = (filename: string): Promise<IParseIpaInfo> => {

    const parser = new AppInfoParser(filename)

    return new Promise((resolve, reject) => {
        parser.parse().then((result: any) => {
            // console.log('app info ----> ', result)
            // console.log('icon base64 ----> ', result.icon)
            // console.log('====================================', JSON.stringify(result))
            let label = undefined

            if (result.application && result.application.label && result.application.label.length > 0) {
                label = result.application.label[0]
            }

            if (label) {
                label = label.replace(/'/g, '')
            }
            let appName = (result['application-label'] || result['application-label-zh-CN'] || result['application-label-es-US'] ||
                result['application-label-zh_CN'] || result['application-label-es_US'] || label || 'unknown')

            let info: IParseIpaInfo = {
                appName: appName.replace(/'/g, ''),
                versionCode: Number(result.versionCode),
                bundleId: result.package,
                versionStr: result.versionName,
                platform: 'android'
            }

            resolve(info)

        }).catch((err: any) => {
            console.log('err ----> ', err)
        })

    })
}

const extractIpaIcon = async (filename: string, guid: string, team: ITeam): Promise<{success: boolean, fileName: string}> => {
    let ipaInfo = await parseIpa(filename)
    // @ts-ignore
    let iconName = ipaInfo.iconName || 'AppIcon'
    // @ts-ignore
    let tmpOut = tempDir + '/{0}.png'.format(guid)
    let found = false
    let buffer = fs.readFileSync(filename)
    let data = await unzip.Open.buffer(buffer)
    await new Promise((resolve, reject) => {
        data.files.forEach((file: any) => {
            if (file.path.indexOf(iconName + '60x60@2x.png') != -1) {
                found = true
                file.stream()
                    .pipe(fs.createWriteStream(tmpOut))
                    .on('error', reject)
                    .on('finish', resolve)
            }
        })
    }).catch(err => { })

    if (!found) {
        throw (new Error('can not find icon'))
    }

    let pnfdefryDir = path.join(__dirname, '..', 'library/pngdefry')
    //写入成功判断icon是否是被苹果破坏过的图片
    let exeName = ''
    if (os.type() === 'Darwin') {
        exeName = 'pngfy-osx'
    } else if (os.type() === 'Linux') {
        exeName = 'pngfy-linux'
    } else {
        throw new Error('Unknown OS!')
    }

    // @ts-ignore
    let { stderr, stdout } = await exec(path.join(pnfdefryDir, exeName + ' -s _tmp ', tmpOut))
    if (stderr) {
        throw stderr
    }
    //执行pngdefry -s xxxx.png 如果结果显示"not an -iphone crushed PNG file"表示改png不需要修复
    let iconRelatePath = path.join(team.id, "/icon")
    let iconSuffix = "/" + guid + "_i.png"
    createFolderIfNeeded(path.join(uploadDir, iconRelatePath))
    if (stdout.indexOf('not an -iphone crushed PNG file') != -1) {
        await fs.renameSync(tmpOut, path.join(uploadDir, iconRelatePath, iconSuffix))
        return { 'success': true, 'fileName': iconRelatePath + iconSuffix }
    }
    await fs.unlinkSync(tmpOut)
    // @ts-ignore
    fs.renameSync(tempDir + '/{0}_tmp.png'.format(guid), path.join(uploadDir, iconRelatePath, iconSuffix))
    return { 'success': true, 'fileName': iconRelatePath + iconSuffix }

}

const extractApkIcon = (filepath: string, guid: string, team: ITeam): Promise<{success: boolean, fileName: string}> => {
    return new Promise((resolve, reject) => {
        // @ts-ignore
        apkParser3(filepath, (err, data) => {
            let iconPath = false
            let iconSize = [640, 320, 240, 160]
            for (let i in iconSize) {
                if (typeof data['application-icon-' + iconSize[i]] !== 'undefined') {
                    iconPath = data['application-icon-' + iconSize[i]]
                    break
                }
            }
            if (!iconPath) {
                throw ('can not find app icon')
            }
            // @ts-ignore
            iconPath = iconPath.replace(/'/g, '')
            // @ts-ignore
            let dir = path.join(uploadDir, team.id, "icon")
            // @ts-ignore
            let realPath = path.join(team.id, "icon", '/{0}_a.png'.format(guid))
            createFolderIfNeeded(dir)
            let tempOut = path.join(uploadDir, realPath)
            // @ts-ignore
            let { ext, dir } = path.parse(iconPath)
            // 获取到最大的png的路径
            // @ts-ignore
            let maxSizePath
            // if (ext === '.xml') {

            // } else {
            //     fs.createReadStream(filepath)
            //         .pipe(unzip.Parse())
            //         .pipe(etl.map(entry => {
            //             // 适配iconPath为ic_launcher.xml的情况
            //             const entryPath = entry.path
            //             // const isXml = entryPath.indexOf('.xml') >= 0
            //             // if ( (!isXml && entryPath.indexOf(iconPath) != -1) || (isXml && entry.path.indexOf(maxSizePath) != -1)) {
            //             //     console.log(entry.path)
            //             entry.pipe(etl.toFile(tempOut))
            //             resolve({ 'success': true, fileName: realPath })
            //             // } else {
            //             //     entry.autodrain()
            //             // }
            //         }))
            // }

            const initialPromise = ext === '.xml' ?
                unzip.Open.file(filepath).then((directory: any) => {
                    const getMaxSizeImagePath = compose(get('path'), maxBy('compressedSize'),
                        // @ts-ignore
                        filter(entry => entry.path.indexOf(dir) >= 0 && entry.path.indexOf('.png') >= 0), get('files'))
                    maxSizePath = getMaxSizeImagePath(directory)
                }) : new Promise((resolve) => resolve())
            initialPromise.then(() => {
                fs.createReadStream(filepath)
                    .pipe(unzip.Parse())
                    // @ts-ignore
                    .pipe(etl.map(entry => {
                        // 适配iconPath为ic_launcher.xml的情况
                        const entryPath = entry.path
                        const isXml = entryPath.indexOf('.xml') >= 0
                        // @ts-ignore
                        if ((!isXml && entryPath.indexOf(iconPath) != -1) || (isXml && entry.path.indexOf(maxSizePath) != -1)) {
                            console.log(entry.path)
                            entry.pipe(etl.toFile(tempOut))
                            resolve({ 'success': true, fileName: realPath })
                        } else {
                            resolve({ 'success': true, fileName: realPath })
                            entry.autodrain()
                        }
                    }))
            })
        })
    })
}


const createFolderIfNeeded = (path: string) => {
    if (!fs.existsSync(path)) {

        //   mkdirp.sync(path, err => {
        //     if (err) console.error(err)
        //   })

        mkdirp.sync(path)

    }
}

///映射可安装的app下载地址
const mapInstallUrl = (appId: string, versionId: string) => {
    return `itms-services://?action=download-manifest&url=${config.baseUrl}/api/plist/${appId}/${versionId}`
}

export { parseAppAndInsertToDB, upload }