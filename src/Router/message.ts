import Router from 'koa-router'
import Message from "../model/message";
import { responseWrapper } from "../helper/util";


const router = new Router()

// 获取该用户未读消息列表
router.get('/', async (ctx, next) => {

    let page = ctx.query.page || 0

    let size = ctx.query.size || 10

    let user = ctx.state.user.data

    let result = await Message.find({ receiver: user._id })
      .limit(size)
      .skip(page * size)

    ctx.body = responseWrapper(result)

})

// 获取消息总条数和未读条数
router.get('/count', async (ctx, next) => {

    let user = ctx.state.user.data

    let count = await Message.count({ receiver: user._id })

    let unread = await Message.count({ receiver: user._id, status: "unread" })

    ctx.body = responseWrapper({ total: count, unread: unread })

})

// 把消息全部标记为已读
router.get('markread', async ctx => {

    let user = ctx.state.user.data

    let result = await Message.update({ receiver: user._id ,status:'unread'},{
        status: "hasread"
    })

    ctx.body = responseWrapper(true,'所有消息已标记已读');

})

// 清空消息列表
router.delete('/', async ctx => {

    let page = ctx.query.page || 0

    let size = ctx.query.size || 10

    let user = ctx.state.user.data

    await Message.deleteMany({ receiver: user._id })

    ctx.body = responseWrapper(true, "消息已清空")

})

export default router