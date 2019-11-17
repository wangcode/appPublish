import Koa from 'koa'
import {
  request,
  summary,
  body,
  tags,
  middlewares,
  path,
  query,
  description
} from '../swagger';

import fs from 'fs';
import _ from 'lodash'
import fpath from 'path';
import axios from 'axios'
import mkdirp from 'mkdirp'
import uuidv1 from 'uuid/v1'
import mustache from 'mustache';

import config from '../config'
import { APIError } from "../helper/rest";
import { getIp, responseWrapper } from "../helper/util";

import Miniapp from '../model/miniapp'
import Version from '../model/version'
import App from '../model/app_model'
import Team from '../model/team'

const tag = tags(['MiniAppResource']);

//更新策略

// {
//     updateMode:{type:String,enum:['slient','normal','force']},
//     ipType:{type:String,default:'black',enum:['black','white']},
//     ipList:[String],
//     downloadCountLimit:Number
// }

const grayRelease = {
  strategy: {
    'updateMode': { type: 'string' }, //更新模式  force / silent / normal/ 强制或者静默或者普通升级
    'ipType': { type: 'string' }, //IP地址限制类型 {type:String,default:'black',enum:['black','white']},
    'ipList': { type: 'string' }, //ip地址列表
    'downloadCountLimit': { type: 'number' } //default 0 表示不现在下载次数
  },
  version: {
    versionId: { type: 'string', require: true },
    versionCode: { type: 'string', require: true },
    release: { type: 'bool', require: true }
  }
}

const versionProfile = {
  'installUrl': 'string', //更新文件的安装地址
  'showOnDownloadPage': 'boolean', //是否显示到下载页
  'changelog': 'string', //修改日志
  'updateMode': { type: 'string' } //更新模式  force / silent / normal/ 强制或者静默或者普通升级
}

const appProfile = {
  'shortUrl': 'string', //应用短连接
  'installWithPwd': 'boolean', //应用安装是否需要密码
  'installPwd': 'string', //应用安装的密码
  'autoPublish': 'boolean' //新版本自动发布
}

class MiniAppRouter {
  @request('post', '/api/miniapps/create')
  @summary("创建一个小程序")
  @body({
    name: { type: 'string', require: true },
    appId: { type: 'string', require: true, description: "小程序的appid" },
    appSecret: { type: 'string', require: true, description: "小程序的appSecret" },
    teamId: { type: 'string', require: true, description: "团队id,表示创建到哪个团队下" },
  })
  @tag

  static async createMiniApp(ctx: Koa.ParameterizedContext<Koa.DefaultState, Koa.DefaultContext>, next: Koa.Next) {
    // let page = ctx.query.page || 0
    // let size = ctx.query.size || 10
    let user = ctx.state.user.data;
    let body = ctx.request.body;

    let content = {
      creator: user.username,
      creatorId: user._id,
      appName: body.name,
      appId: body.appId,
      appSecret: body.appSecret,
      ownerId: body.teamId
    }

    let app = new Miniapp(content)
    await app.save()
    // .limit(size).skip(page * size)
    ctx.body = responseWrapper(app)
  }

  @request('get', '/api/miniapps/{teamId}/{id}')
  @summary("获取某个小程序详情")
  @tag
  @path({
    teamId: { type: 'string' },
    id: { type: 'string', description: '应用id' }
  })
  static async getMiniAppDetail(ctx: Koa.ParameterizedContext<Koa.DefaultState, Koa.DefaultContext>, next: Koa.Next) {
    let user = ctx.state.user.data
    let { teamId, id } = ctx.validatedParams;
    //todo: 这里其实还要判断该用户在不在team中
    //且该应用也在team中,才有权限查看
    let app = await Miniapp.findById(id)
    ctx.body = responseWrapper(app)
  }

  @request('delete', '/api/miniapps/{teamId}/{id}')
  @summary("删除某个小程序应用")
  @tag
  @path({
    teamId: { type: 'string' },
    id: { type: 'string', description: '应用id' }
  })
  static async deleteMiniApp(ctx: Koa.ParameterizedContext<Koa.DefaultState, Koa.DefaultContext>, next: Koa.Next) {
    let user = ctx.state.user.data
    let { teamId, id } = ctx.validatedParams;
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
    let app = await Miniapp.findOne({ _id: id, ownerId: team._id })
    if (!app) {
      throw new Error("应用不存在或您没有权限查询该应用")
    }
    await Miniapp.deleteOne({ _id: app.id })
    ctx.body = responseWrapper(true, "应用已删除")
  }

  @request('get', '/api/miniapps/{teamId}')
  @summary("获取团队下小程序列表")
  // @query(
  //     {
  //     page:{type:'number',default:0,description:'分页页码(可选)'},
  //     size:{type:'number',default:10,description:'每页条数(可选)'}
  // })
  @path({ teamId: { type: 'string', description: '团队id' } })
  @tag
  static async getApps(ctx: Koa.ParameterizedContext<Koa.DefaultState, Koa.DefaultContext>, next: Koa.Next) {
    // let page = ctx.query.page || 0
    // let size = ctx.query.size || 10
    let user = ctx.state.user.data;
    let { teamId } = ctx.validatedParams;

    let result = await Miniapp.find({ 'ownerId': teamId || user.id })
    // .limit(size).skip(page * size)
    ctx.body = responseWrapper(result)
  }

  @request('post', '/api/miniapps/adddownloadcode')
  @summary("根据授权码或租户id添加一个下载二维码")
  // @query(
  //     {
  //     page:{type:'number',default:0,description:'分页页码(可选)'},
  //     size:{type:'number',default:10,description:'每页条数(可选)'}
  // })
  @body({
    appId: { type: 'string', require: true, description: "小程序的appid" },
    scene: { type: 'string', require: false, description: "场景参数列如authcode=xxxx&match=xxxx" },
    page: { type: 'string', require: false, description: "入口页面" },
    remark: { type: 'string', require: true, description: "备注信息" },
    teamId: { type: 'string', require: true, description: "团队id" },
  })
  @tag
  static async addDownloadCode(ctx: Koa.ParameterizedContext<Koa.DefaultState, Koa.DefaultContext>, next: Koa.Next) {
    // let page = ctx.query.page || 0
    // let size = ctx.query.size || 10
    let user = ctx.state.user.data;
    let body = ctx.request.body;

    let app: any = await Miniapp.findOne({ appId: body.appId })
    appInTeamAndUserIsManager(app._id, body.teamId, user._id)

    let result = await axios.get(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${app.appId}&secret=${app.appSecret}`)

    let token = result.data.access_token
    console.log(token)
    if (!token) {
      throw new Error("获取token失败，检查网络和appid和appsecret")
    }

    let dir = `upload/mini/${app.appId}`
    let uploadDir = fpath.join(config.fileDir, dir)
    createFolderIfNeeded(uploadDir)
    let imageName = `${uuidv1()}.jpg`;
    if (body.scene) {
      let result = await requestImage(`https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${token}`, {
        scene: body.scene,
        page: body.page
      }, uploadDir, imageName)
      console.log(result)
    } else {
      let result = await requestImage(`https://api.weixin.qq.com/wxa/getwxacode?access_token=${token}`, {
        path: body.page
      }, uploadDir, imageName)
      console.log(result)
    }

    let downloadCodeInfo = {
      remark: body.remark,
      image: `${dir}/${imageName}`,
      param: body.scene,
      page: body.page
    }

    await app.update({
      $push: {
        downloadCodeImage: downloadCodeInfo
      }
    })
    let updatedApp = await Miniapp.findOne({ appId: body.appId })
    ctx.body = responseWrapper(updatedApp)
  }

  @request('post', '/api/miniapps/removedownloadcode')
  @summary("删除一个下载二维码")
  // @query(
  //     {
  //     page:{type:'number',default:0,description:'分页页码(可选)'},
  //     size:{type:'number',default:10,description:'每页条数(可选)'}
  // })
  @body({
    appId: { type: 'string', require: true, description: "小程序的appid" },
    codeId: { type: 'string', require: true, description: "入口页面" },
  })
  @tag
  static async removeDownloadCode(ctx: Koa.ParameterizedContext<Koa.DefaultState, Koa.DefaultContext>, next: Koa.Next) {
    // let page = ctx.query.page || 0
    // let size = ctx.query.size || 10
    let user = ctx.state.user.data;
    let body = ctx.request.body;

    let app = await Miniapp.findOne({ appId: body.appId })
    appInTeamAndUserIsManager(app._id, body.teamId, user._id)

    await app.update({
      $pull: {
        downloadCodeImage: { _id: body.codeId }
      }
    })
    ctx.body = responseWrapper(true, '小程序码已删除')
  }

  // @request('post', '/api/apps/{teamId}/{id}/profile')
  // @summary("更新应用设置")
  // @tag
  // @body(appProfile)
  // @path({ teamId: { type: 'string', required: true }, id: { type: 'string', required: true } })
  // static async setAppProfile(ctx: Koa.ParameterizedContext<Koa.DefaultState, Koa.DefaultContext>, next: Koa.Next) {
  //     let user = ctx.state.user.data;
  //     let body = ctx.request.body;
  //     let { teamId, id } = ctx.validatedParams;

  //     let app = await appInTeamAndUserIsManager(id, teamId, user._id)
  //     if (!app) {
  //         throw new Error("应用不存在或您没有权限执行该操作")
  //     }
  //     await App.findByIdAndUpdate(id, body)
  //     ctx.body = responseWrapper(true, "应用设置已更新")
  // }



  @request('get', '/api/count/{appid}/{versionId}')
  @summary("增加一次下载次数")
  @tag
  @path({ appid: { type: 'string', require: true }, versionId: { type: 'string', require: true } })
  static async addDownloadCount(ctx: Koa.ParameterizedContext<Koa.DefaultState, Koa.DefaultContext>, next: Koa.Next) {
    let { appid, versionId } = ctx.validatedParams
    let app: any = await App.findOne({ _id: appid }, "totalDownloadCount todayDownloadCount")
    let version: any = await Version.findOne({ _id: versionId }, "downloadCount ")

    if (!app) {
      throw new Error("应用不存在")
    }
    if (!version) {
      throw new Error("版本不存在")
    }

    let todayCount = 1;
    let nowDate = new Date()
    if (app.todayDownloadCount.date.toDateString() == nowDate.toDateString()) {
      todayCount = app.todayDownloadCount + 1
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
  }


}


async function requestImage(url: string, data: any, codePath: any, imageName: string) {

  const path = fpath.resolve(codePath, imageName)
  const writer = fs.createWriteStream(path)
  const response = await axios({
    url,
    method: 'POST',
    responseType: 'stream',
    data: data
  })

  response.data.pipe(writer)

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve)
    writer.on('error', reject)
  })
}

async function appInTeamAndUserIsManager(appId: any, teamId: number, userId: number) {
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
  if (!team) {
    throw new Error("应用不存在或您没有权限执行该操作")
  }
  let app = await Miniapp.findOne({ _id: appId, ownerId: team._id })
  if (!app) {
    throw new Error("应用不存在或您没有权限执行该操作")
  } else {
    return app
  }
}

async function appAndUserInTeam(appId: any, teamId: number, userId: number) {
  let team = await Team.findOne({
    _id: teamId,
    members: {
      $elemMatch: {
        _id: userId
      }
    },
  }, "_id")
  let app = await App.find({ _id: appId, ownerId: team._id })
  if (!app) {
    throw new Error("应用不存在或您不在该团队中")
  } else {
    return app
  }
}

async function userInTeam(appId: any, teamId: number, userId: number) {
  let team = await Team.findOne({
    _id: teamId,
    members: {
      $elemMatch: {
        _id: userId
      }
    },
  }, "_id")

  //@ts-ignore
  let app = await App.findOne({ _id: id, ownerId: team._id })
  if (!app) {
    throw new Error("应用不存在或您不在该团队中")
  } else {
    return app
  }
}

//设置模糊查询
function modifyFilter(filter: any) {
  let result: any = {}
  for (let key in filter) {
    result[key] = { $regex: filter[key] }
  }
  return result
}

function createFolderIfNeeded(path: string) {
  if (!fs.existsSync(path)) {
    // @ts-ignore
    mkdirp.sync(path, (err) => {
      if (err) console.error(err)
    })
  }
}

export default MiniAppRouter