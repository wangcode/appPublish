import Koa from "Koa";
import cors from "koa-cors";
import koajwt from "koa-jwt";
import serve from "koa-static";
import bodyParser from "koa-bodyparser";

import fs from "fs";
import path from "path";

import { isUndefined } from "util";

import config from './config';
import Varif from './helper/varify';
import Helper from './helper/middle';

const app = new Koa();
const helper = new Helper();

app.use(cors());
app.use(bodyParser())
app.use(serve(path.resolve(config.fileDir)))
app.use(serve(path.join(__dirname, '..', 'client/dist')));

app.use((ctx, next) => {
  if (ctx.request.path.indexOf('/api')!==0) {
    ctx.response.type = 'html';
    ctx.response.body = fs.readFileSync(path.join(__dirname, '..', 'client/dist/index.html'), 'utf8');
  } else {
    return next();
  }
})

let middleware = koajwt({ secret: config.secret, debug: true }).unless({
  path: [
    /\/api\/user\/register/,
    /\/api\/user\/login/,
    /\/api\/user\/resetPassword/,
    /\/api\/swagger/,
    /\/api\/swagger.json/,
    /\/api\/plist\/.+/,
    /\/api\/count\/.+/,
    /\/api\/app\/.+/
  ]
})

app.use(helper.skip(middleware).if((ctx: any) => {
    let key = ctx.request.headers['apikey']
    return !isUndefined(key)
}))

app.use(async (ctx, next) => {

  let key = ctx.request.headers['apikey'];

  if (!isUndefined(key)) {

    let user = await Varif.auth(key).catch(err => {throw err});

    ctx.state.user = { data: user };

    await next();

  } else {
    await next();
  }

})

// app.use

export default app.listen(config.port, () => {
  console.log(`App is listening on ${config.port}.`)
})