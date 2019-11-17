import Koa from 'koa'
import {
  request,
  summary,
  body,
  tags,
  middlewares,
  description,
  formData,
  responses,
  query,
  path as rpath
} from '../swagger';

import fs from 'fs'
import path from 'path'
import os from 'os'
import mime from 'mime'
import uuidV4 from 'uuid/v4'
// import multer from 'koa-multer'
import multer from 'koa-multer'
import unzip from 'unzipper'
// @ts-ignore
import etl from 'etl'
import mkdirp from 'mkdirp'
// @ts-ignore
// import ipaMataData from 'ipa-metadata2'
// @ts-ignore
import AppInfoParser from 'app-info-parser'
import { compose, maxBy, filter, get } from 'lodash/fp'

import apkParser3 from '../library/apkparser/apkparser'

import config from '../config';

import Team from '../model/team'
import App from '../model/app_model'
import Version from '../model/version'


const { writeFile, readFile, responseWrapper, exec } = require('../helper/util')

const tempDir = path.join(config.fileDir, 'temp')
const uploadDir = path.join(config.fileDir, 'upload')

createFolderIfNeeded(tempDir)

const uploadPrefix = "upload";

function createFolderIfNeeded(path: string) {
  if (!fs.existsSync(path)) {
    // @ts-ignore
    mkdirp.sync(path, function (err) {
      if (err) console.error(err)
    })
  }
}

const storage = multer.diskStorage({
  destination: tempDir,
  filename: (req: any, file: any, cb: any) => cb(null, `${Date.now()}-${file.originalname}`)
});

const tag = tags(['上传']);
const upload = multer({ storage });

class UploadRouter {
  @request('post', '/api/apps/{teamId}/upload')
  @summary('上传apk或者ipa文件到服务器')
  @tag
  @formData({
    file: {
      type: 'file',
      required: 'true',
      description: 'upload file, get url'
    }
  })
  @rpath({ teamId: { type: 'string', required: true } })
  @middlewares([upload.single('file')])
  static async upload(ctx: Koa.ParameterizedContext<Koa.DefaultState, Koa.DefaultContext>, next: Koa.Next) {
    // @ts-ignore
    let file = ctx.req.file
    const { teamId } = ctx.validatedParams;
    let team = await Team.findById(teamId)
    if (!team) {
      throw new Error("没有找到该团队")
    }
    let result: any = await parseAppAndInsertToDB(file, ctx.state.user.data, team);
    await Version.updateOne({ _id: result.version._id }, {
      released: result.app.autoPublish
    })
    if (result.app.autoPublish) {
      await App.updateOne({ _id: result.app._id }, {
        releaseVersionId: result.version._id,
        releaseVersionCode: result.version.versionCode
      })
    }
    console.log(result.app.autoPublish)
    console.log(result.version.released)
    ctx.body = responseWrapper(result);
  }

  static async download(ctx: Koa.ParameterizedContext<Koa.DefaultState, Koa.DefaultContext>, next: Koa.Next) {
    const { body } = ctx.request
    let file = __dirname + ''
    let filename = path.basename(file)
    // @ts-ignore
    let mimetype = mime.lookup(file)
    ctx.body = await fs.createReadStream(__dirname, '/')
    ctx.set('Content-disposition',
      'attachment; filename=' + filename)
    ctx.set('Content-type', mimetype)
  }
}

async function parseAppAndInsertToDB(file: any, user: any, team: any) {
  let filePath = file.path
  let parser, extractor;
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
  let info: any = await parser(filePath);
  let fileName = info.bundleId + "_" + info.versionStr + "_" + info.versionCode
  //解析icon图标
  let icon = await extractor(filePath, fileName, team);

  //移动文件到对应目录
  let fileRelatePath = path.join(team.id, info.platform)
  createFolderIfNeeded(path.join(uploadDir, fileRelatePath))
  let fileRealPath = path.join(uploadDir, fileRelatePath, fileName + path.extname(filePath))
  await fs.renameSync(filePath, fileRealPath)
  info.downloadUrl = path.join(uploadPrefix, fileRelatePath, fileName + path.extname(filePath))

  let app = await App.findOne({ 'platform': info['platform'], 'bundleId': info['bundleId'], 'ownerId': team._id })
  if (!app) {
    info.creator = user.username;
    info.creatorId = user._id;
    // @ts-ignore
    info.icon = path.join(uploadPrefix, icon.fileName);
    info.shortUrl = Math.random().toString(36).substring(2, 5) + Math.random().toString(36).substring(2, 5);
    app = new App(info)
    // @ts-ignore
    app.ownerId = team._id;
    // @ts-ignore
    app.currentVersion = info.versionCode
    await app.save()
    info.uploader = user.username;
    info.uploaderId = user._id;
    info.size = fs.statSync(fileRealPath).size
    // @ts-ignore
    let version = Version(info)
    version.appId = app._id;
    // @ts-ignore
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
    info.uploader = user.username;
    info.uploaderId = user._id;
    info.size = fs.statSync(fileRealPath).size
    // @ts-ignore
    let version = Version(info)
    version.appId = app._id;
    // @ts-ignore
    if (app.platform == 'ios') {
      version.installUrl = mapInstallUrl(app.id, version.id)
    } else {
      version.installUrl = `${config.baseUrl}/${info.downloadUrl}`
    }
    await version.save()
    return { 'app': app, 'version': version }
  } else {
    let err = Error()
    // @ts-ignore
    err.code = 408
    err.message = '当前版本已存在'
    throw err
  }
}

///映射可安装的app下载地址
// @ts-ignore
function mapInstallUrl(appId, versionId) {
  return `itms-services://?action=download-manifest&url=${config.baseUrl}/api/plist/${appId}/${versionId}`
}

///移动相关信息到指定目录
// @ts-ignore
function storeInfo(filename, guid) {
  let new_path
  if (path.extname(filename) === '.ipa') {
    // @ts-ignore
    new_path = path.join(ipasDir, guid + '.ipa')
  } else if (path.extname(filename) === '.apk') {
    // @ts-ignore
    new_path = path.join(apksDir, guid + '.apk')
  }
  // @ts-ignore
  fs.rename(filename, new_path)
}

///解析ipa
// @ts-ignore
function parseIpa(filename) {
  const parser = new AppInfoParser(filename)

  return new Promise((resolve, reject) => {
    parser.parse().then((result: any) => {
      console.log('app info ----> ', result)
      console.log('icon base64 ----> ', result.icon)

      let info: any = {}
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
    })

  })
}

///解析ipa icon
// @ts-ignore
async function extractIpaIcon(filename, guid, team) {
  let ipaInfo = await parseIpa(filename)
  // @ts-ignore
  let iconName = ipaInfo.iconName || 'AppIcon';
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
  let exeName = '';
  if (os.type() === 'Darwin') {
    exeName = 'pngfy-osx';
  } else if (os.type() === 'Linux') {
    exeName = 'pngfy-linux';
  } else {
    throw new Error('Unknown OS!');
  }

  let { stderr, stdout } = await exec(path.join(pnfdefryDir, exeName + ' -s _tmp ', tmpOut));
  if (stderr) {
    throw stderr;
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

///解析apk
function parseApk(filename: string) {

  const parser = new AppInfoParser(filename)

  return new Promise((resolve, reject) => {
    parser.parse().then((result: any) => {
      // console.log('app info ----> ', result)
      // console.log('icon base64 ----> ', result.icon)
      // console.log('====================================', JSON.stringify(result));
      let label = undefined

      if (result.application && result.application.label && result.application.label.length > 0) {
        label = result.application.label[0]
      }

      if (label) {
        label = label.replace(/'/g, '')
      }
      let appName = (result['application-label'] || result['application-label-zh-CN'] || result['application-label-es-US'] ||
        result['application-label-zh_CN'] || result['application-label-es_US'] || label || 'unknown')

      let info = {
        'appName': appName.replace(/'/g, ''),
        'versionCode': Number(result.versionCode),
        'bundleId': result.package,
        'versionStr': result.versionName,
        'platform': 'android'
      }
      resolve(info)
    }).catch((err: any) => {
      console.log('err ----> ', err)
    })
    // apkParser3(filename, (err, data) => {
    //     let apkPackage = parseText(data.package)
    //     console.log(data)
    //     console.log("----------------")
    //     console.log(data['application-label'])
    //     let label = undefined
    //     data['launchable-activity']
    //         .split(' ')
    //         .filter(s => s.length != 0)
    //         .map(element => { return element.split('=') })
    //         .forEach(element => {
    //             if (element && element.length > 2 && element[0] == 'label') {
    //                 label = element[1]
    //             }
    //         })
    //     if (label) {
    //         label = label.replace(/'/g, '')
    //     }
    //     let appName = (data['application-label'] || data['application-label-zh-CN'] || data['application-label-es-US'] ||
    //         data['application-label-zh_CN'] || data['application-label-es_US'] || label || 'unknown')
    //     let info = {
    //         'appName': appName.replace(/'/g, ''),
    //         'versionCode': Number(apkPackage.versionCode),
    //         'bundleId': apkPackage.name,
    //         'versionStr': apkPackage.versionName,
    //         'platform': 'android'
    //     }
    //     resolve(info)
    // })
  })
}

///解析apk icon
// @ts-ignore
function extractApkIcon(filepath, guid, team) {
  return new Promise((resolve, reject) => {
    // @ts-ignore
    apkParser3(filepath, (err, data) => {
      let iconPath = false;
      let iconSize = [640, 320, 240, 160]
      for (let i in iconSize) {
        if (typeof data['application-icon-' + iconSize[i]] !== 'undefined') {
          iconPath = data['application-icon-' + iconSize[i]]
          break;
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
      let { ext, dir } = path.parse(iconPath);
      // 获取到最大的png的路径
      // @ts-ignore
      let maxSizePath;
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
            filter(entry => entry.path.indexOf(dir) >= 0 && entry.path.indexOf('.png') >= 0), get('files'));
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

///格式化输入字符串 /用法: "node{0}".format('.js'), 返回'node.js'
// @ts-ignore
String.prototype.format = function () {
  let args = arguments
  // @ts-ignore
  return this.replace(/\{(\d+)\}/g, function (s, i) {
    return args[i]
  })
}

function parseText(text: string) {
  let regx = /(\w+)='([\S]+)'/g
  let match = null;
  let result = {}
  while (match = regx.exec(text)) {
    // @ts-ignore
    result[match[1]] = match[2]
  }
  return result
}

export default UploadRouter