import Router from 'koa-router'
import AppRouter from './app'
import AuthRouter from './auth'
import TeamRouter from './team'
import MessageRouter from './message'

const router = new Router()

router.use('/api/apps', AppRouter.routes(), AppRouter.allowedMethods())
router.use('/api/user', AuthRouter.routes(), AuthRouter.allowedMethods())
router.use('/api/team', TeamRouter.routes(), TeamRouter.allowedMethods())
router.use('/api/message', MessageRouter.routes(), MessageRouter.allowedMethods())

export default router