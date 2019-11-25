// @ts-nocheck
import Router from 'koa-router'

import App from '../model/app_model'
import Team from '../model/team'
import Version from '../model/version'

import fs from 'fs'
import _ from 'lodash'
import fpath from 'path'
import mustache from 'mustache';
import { getIp, responseWrapper } from "../helper/util"

import config from '../config'
import { parseAppAndInsertToDB, upload } from '../helper/upload'

const router = new Router()

const appInTeamAndUserIsManager = async (appId: string, teamId: number, userId: number) => {
    let team = await Team.findOne({
        _id: teamId,
        members: {
            $elemMatch: {
                _id: userId,
                $or: [
                    { role: 'owner' },
                    { role: 'manager' }
                ]
            }
        },
    }, "_id")

    if (!team) throw new Error("应用不存在或您没有权限执行该操作")

    let app = await App.findOne({ _id: appId, ownerId: team._id })

    if (!app) {
        throw new Error("应用不存在或您没有权限执行该操作")
    } else {
        return app
    }
}


// 获取团队下App列表
router.get('/:teamId/', async (ctx, next) => {

    let user = ctx.state.user.data

    let { teamId } = ctx.params

    let result = await App.find({ ownerId: teamId || user.id })

    ctx.body = responseWrapper(result)

})

// 获取某个应用详情
router.get('/:teamId/:id', async (ctx, next) => {

    let user = ctx.state.user.data

    let { teamId, id } = ctx.params
    //todo: 这里其实还要判断该用户在不在team中
    //且该应用也在team中,才有权限查看
    let app = await App.findById(id)

    ctx.body = responseWrapper(app)
})

// 删除某个应用
router.delete('/:teamId/:id', async (ctx, next) => {

    let user = ctx.state.user.data

    let { teamId, id } = ctx.params

    let team = await Team.findOne({
        _id: teamId,
        members: {
            $elemMatch: {
                username: user.username,
                $or: [
                    { role: 'owner' },
                    { role: 'manager' }
                ]
            }
        }
    })

    let app = await App.findOne({
        _id: id,
        ownerId: team._id
    })

    if (!app) {
        throw new Error('应用不存在或您没有权限查询该应用')
    }

    await Version.deleteMany({
        appId: app.id
    })

    await App.deleteOne({
        _id: app.id
    })

    ctx.body = responseWrapper(true, "应用已删除")

})

// 获取某个应用的版本列表(分页)
router.get('/:teamId/:id/versions', async (ctx, next) => {

    let user = ctx.state.user.data

    let { teamId, id } = ctx.params

    let { page, size } = ctx.query

    let team = await Team.findOne({
        _id: teamId,
        members: {
            $elemMatch: {
                username: user.username
            }
        }
    })

    let app = await App.find({
        _id: id,
        ownerId: team._id
    })

    if (!app) {
        throw new Error("应用不存在或您没有权限查询该应用")
    }

    let versions = await Version.find({
        appId: id
    }).limit(size).skip(page * size)

    ctx.body = responseWrapper(versions)

})

// 获取某个应用的某个版本详情
router.get('/:teamId/:id/versions/:versionId', async (ctx, next) => {

    //todo: 好像暂时用不上
    let user = ctx.state.user.data
    let { teamId, id, versionId } = ctx.params

    let team = await Team.find({
        _id: teamId,
        members: {
            $elemMatch: {
                username: user.username
            }
        }
    })

    if (!team) {
        throw new Error("没有权限查看该应用")
    }

    let version = await Version.findById(versionId)

    if (!version) {
        throw new Error("应用不存在")
    }

    ctx.body = responseWrapper(version)

})

// 删除某个版本
router.delete('/:teamId/:id/versions/:versionId', async (ctx, next) => {

    let user = ctx.state.user.data

    let { teamId, id, versionId } = ctx.params

    let app = await appInTeamAndUserIsManager(id, teamId, user._id)

    let result = await Version.deleteOne({ _id: versionId })

    if (versionId == app.releaseVersionId) {
        await App.updateOne({ _id: app._id }, {
            releaseVersionId: null
        })
    }

    if (versionId == app.grayReleaseVersionId) {
        await App.updateOne({ _id: app._id }, {
            grayReleaseVersionId: null,
            grayStrategy: null
        })
    }

    ctx.body = responseWrapper(true, "版本已删除")

})

// 设置应用或版发布更新方式/静默/强制/普通
router.post('/:teamId/:id/updateMode', async (ctx, next) => {

    let user = ctx.state.user.data

    let body = ctx.body

    let { teamId, id } = ctx.params

    let app = await appInTeamAndUserIsManager(id, teamId, user._id)

    if (body.versionId) {

        //更新版本策略
        await Version.findByIdAndUpdate(body.versionId, { updateMode: body.updateMode })

    } else {

        await App.findByIdAndUpdate(id, { updateMode: body.updateMode })

    }

    ctx.body = responseWrapper(true, "版本发布策略设置成功")

})

// 更新应用设置
router.post('/:teamId/:id/profile', async (ctx, next) => {

    let user = ctx.state.user.data

    let body = ctx.request.body

    let { teamId, id } = ctx.params

    let app = await appInTeamAndUserIsManager(id, teamId, user._id)

    if (!app) {
        throw new Error("应用不存在或您没有权限执行该操作")
    }

    await App.findByIdAndUpdate(id, body)

    ctx.body = responseWrapper(true, "应用设置已更新")

})

// 更新版本设置设置
router.post('/:teamId/:id/:versionId/profile', async (ctx, next) => {

    let user = ctx.state.user.data

    let body = ctx.request.body

    let { teamId, id, versionId } = ctx.params

    let app = await appInTeamAndUserIsManager(id, teamId, user._id)

    if (!app) {
        throw new Error("应用不存在或您没有权限执行该操作")
    }

    await Version.findByIdAndUpdate(versionId, body)

    ctx.body = responseWrapper(true, "版本设置已更新")

})

// 灰度发布一个版本
router.post('/:teamId/:id/grayPublish', async (ctx, next) => {

    let user = ctx.state.user.data

    let { body } = ctx.request

    let { teamId, id } = ctx.params

    let app = await appInTeamAndUserIsManager(id, teamId, user._id)

    if (!app) {
        throw new Error("应用不存在或您没有权限执行该操作")
    }

    let version = await Version.findById(body.version.versionId, "versionStr")

    await App.updateOne({ _id: app.id }, {
        grayReleaseVersionId: version.id,
        grayStrategy: body.strategy
    })

    ctx.body = responseWrapper(true, "版本已灰度发布")

})

// 发布或者取消发布某个版本
router.post('/:teamId/:id/release', async (ctx, next) => {

    let user = ctx.state.user.data

    let { body } = ctx.request

    let { teamId, id } = ctx.params

    let app = await appInTeamAndUserIsManager(id, teamId, user._id)

    if (!app) {
        throw new Error("应用不存在或您没有权限执行该操作")
    }

    let version: any = await Version.findById(body.versionId)

    if (!version) {
        throw new Error("版本不存在")
    }

    if (body.release) {

        await App.updateOne({ _id: app.id }, {
            releaseVersionId: version._id,
            releaseVersionCode: version.versionCode
        })

    } else {

        await App.updateOne({ _id: app.id }, {
            releaseVersionId: '',
            releaseVersionCode: ''
        })

    }

    ctx.body = responseWrapper(true, body.release ? "版本已发布" : "版本已关闭")

})


// 检查版本更新
router.get('/checkupdate/:teamId/:platform/:bundleId/:currentVersionCode', async (ctx, next) => {

    let { teamID, bundleID, currentVersionCode, platform } = ctx.params

    let app = await App.findOne({
        bundleId: bundleID,
        ownerId: teamID,
        platform: platform
    })

    if (!app) {
        throw new Error("应用不存在或您没有权限执行该操作")
    }
    // let lastVersionCode = app.currentVersion

    // if ( < lastVersionCode) {
    //1.拿出最新的version 最新的非灰度版本

    // 最新的灰度版本
    let lastestGrayVersion = await Version.findOne({
        _id: app.grayReleaseVersionId
    })

    // let version = await Version.findOne({ appId: app._id })
    let normalVersion = await Version.findOne({
        _id: app.releaseVersionId
    })

    let version = normalVersion

    let lastestGrayVersionCode: string | number = 0

    let normalVersionCode: string | number = 0

    if (version && version.versionCode) {

        normalVersionCode = version.versionCode

    }

    if (lastestGrayVersion && lastestGrayVersion.versionCode) {

        lastestGrayVersionCode = lastestGrayVersion.versionCode

    }

    if (app.grayReleaseVersionId && lastestGrayVersionCode > normalVersionCode) {

        let ipType = app.grayStrategy.ipType
        let ipList = app.grayStrategy.ipList

        let clientIp = await getIp(ctx.request)

        console.log(clientIp)

        if (ipType == 'white' && _.includes(ipList, clientIp)) { //如果是white 则允许获得灰度版本

            if (!app.grayStrategy.downloadCountLimit || app.grayStrategy.downloadCountLimit > lastestGrayVersion.downloadCount) {

                version = lastestGrayVersion

            }

        }
    }


    if (!version || version.versionCode <= currentVersionCode) {

        ctx.body = responseWrapper(false, "您已经是最新版本了")

    } else {

        ctx.body = responseWrapper({
            app: app,
            version: version
        })

    }

})

// 通过短链接获取应用最新版本
router.get('/api/app/:appShortUrl', async (ctx, next) => {

    let { appShortUrl } = ctx.params

    let app = await App.findOne({ shortUrl: appShortUrl })

    if (!app) {
        throw new Error("应用不存在")
    }
    // if (!app.releaseVersionId || app.releaseVersionId === '') {
    //     throw new Error("当前没有已发布的版本可供下载")
    // }
    // let version = await Version.findById(app.releaseVersionId)
    // if (!version) {
    //     throw new Error("当前没有已发布的版本可供下载")
    // }

    let lastestGrayVersion = await Version.findOne({ _id: app.grayReleaseVersionId })

    // let version = await Version.findOne({ appId: app._id })

    let normalVersion = await Version.findOne({ _id: app.releaseVersionId })

    let version = normalVersion
    let lastestGrayVersionCode: string | number = 0
    let normalVersionCode: string | number = 0

    if (version && version.versionCode) {

        normalVersionCode = version.versionCode

    }

    if (lastestGrayVersion && lastestGrayVersion.versionCode) {

        lastestGrayVersionCode = lastestGrayVersion.versionCode

    }

    if (app.grayReleaseVersionId && lastestGrayVersionCode > normalVersionCode) {

        let ipType = app.grayStrategy.ipType
        let ipList = app.grayStrategy.ipList

        let clientIp = await getIp(ctx.request)

        if (ipType == 'white' && _.includes(ipList, clientIp)) { //如果是white 则允许获得灰度版本

            if (!app.grayStrategy.downloadCountLimit || app.grayStrategy.downloadCountLimit > lastestGrayVersion.downloadCount) {

                version = lastestGrayVersion

            }

        }

    }

    if (!version) {
        ctx.body = responseWrapper(false, "当前没有可用版本可供下载")
    } else {
        ctx.body = responseWrapper({ app: app, version: version })
    }

    ctx.body = responseWrapper({ 'app': app, 'version': version })

})

// 获取应用的plist文件
router.get('/plist/:appid/:versionId', async (ctx, next) => {

    let { appid, versionId } = ctx.params

    let app = await App.findOne({ _id: appid })

    let version = await Version.findOne({ _id: versionId })


    if (!app) {
        throw new Error("应用不存在")
    }

    if (!version) {
        throw new Error("版本不存在")
    }

    let url = `${config.baseUrl}/${version.downloadUrl}`

    let result = fs.readFileSync(fpath.join(__dirname, "..", 'templates') + '/template.plist')

    let template = result.toString();

    let rendered = mustache.render(template, {
        appName: app.appName,
        bundleID: app.bundleId,
        versionStr: version.versionStr,
        downloadUrl: url,
        fileSize: version.size,
        iconUrl: `${config.baseUrl}/${app.icon}`
    });

    ctx.set('Content-Type', 'text/xml; charset=utf-8');

    ctx.set('Access-Control-Allow-Origin', '*');

    ctx.body = rendered

})


router.get('/count/:appid/:versionId', async (ctx, next) => {

    let { appid, versionId } = ctx.params

    let app = await App.findOne({ _id: appid }, "totalDownloadCount todayDownloadCount")

    let version = await Version.findOne({ _id: versionId }, "downloadCount ")

    if (!app) {
        throw new Error("应用不存在")
    }

    if (!version) {
        throw new Error("版本不存在")
    }

    let todayCount = 1;
    let nowDate = new Date()

    if (app.todayDownloadCount.date.toDateString() == nowDate.toDateString()) {

        todayCount = app.todayDownloadCount.count + 1

    }

    let appTotalCount = 1;

    if (app.totalDownloadCount) {

        appTotalCount = app.totalDownloadCount + 1

    }

    await App.updateOne({ _id: appid }, {
        totalDownloadCount: appTotalCount,
        todayDownloadCount: {
            count: app.totalDownloadCount + 1,
            date: nowDate
        }
    })

    let versionCount = 1;

    if (version.downloadCount) {

        versionCount = version.downloadCount + 1

    }

    await Version.updateOne({ _id: versionId }, {
        downloadCount: versionCount
    })

    ctx.body = responseWrapper(true, '下载次数已更新')

})


// 上传apk或者ipa文件到服务器
router.post('/:teamId/upload', upload.single('file'), async (ctx) => {

    // @ts-ignore
    let file = ctx.req.file

    const { teamId } = ctx.params

    let team = await Team.findById(teamId)

    if (!team) {
        throw new Error("没有找到该团队")
    }

    let result = await parseAppAndInsertToDB(file, ctx.state.user.data, team);

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
    // @ts-ignore
    console.log(result.version.released)

    ctx.body = responseWrapper(result);

})

// 取消发布版本
router.post('/:appId/:versionId', async (ctx, next) => {

    let { appId, versionId } = ctx.params

    let app = await App.findOne({ _id: appId })

    let version = await Version.findOne({ _id: versionId })

    if (!app) {
        throw new Error("应用不存在")
    }

    if (!version) {
        throw new Error("版本不存在")
    }

    if (versionId == app.releaseVersionId) {

        await App.updateOne({ _id: appId }, { releaseVersionId: null })

    }

    if (versionId == app.grayReleaseVersionId) {

        await App.updateOne({ _id: appId }, {
            grayReleaseVersionId: null,
            grayStrategy: null
        })

    }

    ctx.body = responseWrapper('取消版本的发布成功')

})

export default router